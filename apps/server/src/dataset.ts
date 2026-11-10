import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import type { DatasetAttachment, DatasetBeforeWrite, DatasetDescriptor, DatasetFeedback, DatasetLabelRecord, DatasetOperation, DatasetPage, DatasetQueryInput, DatasetSaveInput, DatasetSnapshot, DatasetSpan, DatasetStep, DatasetWriteOperation } from '../../../packages/shared/src/dataset.js';
import type { FilePreview, LabelDocument, LabelState, QueryResult, RequestIdentity } from '../../../packages/shared/src/index.js';
import type { Provider, RepoKey } from './provider.js';
import { ApiError } from './errors.js';
import { LabelService, assignmentId, validateLabelDocument } from './labels.js';
import { inferColumns, parseJsonl, stableRowIds } from './jsonl.js';
import { tableFrom } from './preview.js';
import { naturalQuery } from './natural-query.js';
import { modelQuery } from './query-planner.js';
import { safeFilePath, safeRef } from './safety.js';
import { getBindingColumns, getBindingSnapshot, validateGovernedAssignment } from './governance.js';
import { recordUsesActiveLayer, separateDatasetLayers } from './dataset-layer-compat.js';
import { protectedSourceFieldIds } from '../../../packages/shared/src/source-record.js';
import type { DatasetFieldMetadata } from '../../../packages/shared/src/field-metadata.js';
import { semanticDatasetFields } from '../../../packages/shared/src/field-metadata.js';
import { orderDatasetColumns } from '../../../packages/shared/src/field-order.js';
import { assertDatasetFields, datasetFieldsSchema } from './dataset-field-schema.js';
import { datasetOverlayProvider } from './dataset-overlay.js';
import { DATASET_LABELS_PATH, readDatasetLabelAuthority } from './dataset-label-summary.js';
import { orderedDatasetIds } from './dataset-order.js';
import {DATASET_ACTIVITY_PATH,datasetRowActivities,datasetSourceFileActivity,readDatasetActivity} from './dataset-activity.js';
import type {DatasetRowActivity} from '../../../packages/shared/src/dataset.js';
import type {EvaluationExposure} from '../../../packages/shared/src/evaluation.js';
import { DATASET_EVALUATION_PATH, evaluationPatchSchema, readEvaluationDocument, evaluationView, assertEvaluationFamilies, assertEvaluationExposure } from './dataset-evaluation.js';
import type { ProjectSchemaBinding, PublishedTemplateSnapshot } from '../../../packages/shared/src/governance-types.js';
import { DATASET_FORMAT_PATH, DATASET_ROOT, canonicalJson, concurrentMap, datasetFiles, datasetHash, labelFingerprint, labelRecordPath, materializeLabelAssignments, optionalRaw, readLabelRecordStore, rowRecordPath, storedJson, targetKey } from './dataset-storage.js';

export { datasetHash } from './dataset-storage.js';
export type { DatasetSnapshot, DatasetSaveInput } from '../../../packages/shared/src/dataset.js';
export const DATASET_DESCRIPTOR_PATH = '.oxenweb/dataset.json';
const IDENTITY_PATH = `${DATASET_ROOT}/identity-map.json`;
const MAX_ROWS = 250_000;
// Preserve source keys as data, including an existing own __proto__ key. Record
// parsing must not silently remove it before the source-readonly checks run.
const jsonRecord = z.custom<Record<string,unknown>>(value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null),'样本内容必须是普通 JSON 对象。').transform(value=>Object.fromEntries(Object.entries(value)));
const labelValue = z.union([z.string().max(8000), z.array(z.string().max(120)).max(200)]);
const spanSchema = z.object({id:z.string().min(1).max(100),pointer:z.string().max(1024),sourceHash:z.string().regex(/^[a-f0-9]{64}$/),start:z.number().int().min(0),end:z.number().int().min(1),values:z.record(z.string(),labelValue),note:z.string().max(8000).optional()}).strict();
const stepSchema = spanSchema.omit({start:true,end:true});
export const datasetOperationSchema = z.discriminatedUnion('op',[
  z.object({op:z.literal('evaluation'),rowIds:z.array(z.string().min(1).max(200)).min(1).max(250000),patch:evaluationPatchSchema}).strict(),
  z.object({op:z.literal('update'),rowId:z.string().min(1).max(200),record:jsonRecord,expectedContentHash:z.string().optional()}).strict(),
  z.object({op:z.literal('append'),record:jsonRecord,rowId:z.string().min(1).max(200).optional()}).strict(),
  z.object({op:z.literal('delete'),rowId:z.string().min(1).max(200),expectedContentHash:z.string().optional()}).strict(),
  z.object({op:z.literal('assign'),scope:z.enum(['dataset','file','row']),path:z.string().max(1024).optional(),rowId:z.string().min(1).max(200).optional(),values:z.record(z.string(),labelValue.nullable()),spans:z.array(spanSchema).max(500).optional(),steps:z.array(stepSchema).max(500).optional()}).strict(),
  z.object({op:z.literal('feedback'),rowId:z.string().max(200).optional(),columnId:z.string().max(100).optional(),message:z.string().trim().min(1).max(8000)}).strict(),
  z.object({op:z.literal('readme'),content:z.string().max(2*1024*1024)}).strict(),
]);
export const datasetSaveSchema = z.object({ref:z.string().transform(safeRef),expectedCommit:z.string().transform(safeRef),message:z.string().trim().min(1).max(4000),operations:z.array(datasetOperationSchema).min(1).max(500)}).strict();
const descriptorSchema = z.object({version:z.literal(1),id:z.string().min(1).max(200),name:z.string().min(1).max(300),canonicalPath:z.string().transform(safeFilePath),readmePath:z.string().transform(safeFilePath),identityField:z.string().max(200),attachmentFields:z.array(z.string().max(200)).max(100),source:z.enum(['descriptor','bundle-manifest','single-table']),importManifestPath:z.string().optional(),identityMapPath:z.string().transform(safeFilePath).optional(),fields:datasetFieldsSchema.optional()}).strict();
interface RowRecord {version:1;rowId:string;op:'upsert'|'delete';record?:Record<string,unknown>;baseHash?:string;isNew:boolean;actor:{id:string;name:string};updatedAt:string;createdAt?:string}
export interface DatasetServiceOptions {
  globalFields?: () => Record<string, DatasetFieldMetadata>;
  beforeGlobalFieldsAdoption?:(key:RepoKey)=>Promise<void>;
  evaluation?: { enabled:(key:RepoKey)=>Promise<boolean>; assertPrivate?:(key:RepoKey)=>Promise<void>; exposed?:(key:RepoKey)=>Promise<EvaluationExposure> };
  onEvaluationCommitted?:(key:RepoKey,identity:RequestIdentity,count:number,commitId:string)=>Promise<void>;
  beforeWrite?: DatasetBeforeWrite;
  authorize?: (key:RepoKey,identity:RequestIdentity,operation:DatasetWriteOperation)=>Promise<void>;
  governance?: {snapshot:(key:RepoKey,ref:string)=>Promise<{binding?:unknown}>};
  workflowFields?: (key:RepoKey,snapshot:DatasetSnapshot)=>Promise<Record<string,Record<string,unknown>>>;
  queryModel?: (table:FilePreview,prompt:string)=>Promise<QueryResult>;
}
export interface DatasetPlan { baseline:DatasetSnapshot; snapshot:DatasetSnapshot; writes:Map<string,Buffer>; input:DatasetSaveInput }
export interface DatasetInitializeInput { ref:string; expectedCommit:string; path?:string; rows:Record<string,unknown>[]; rowIds?:string[]; readme?:string; descriptor?:Partial<DatasetDescriptor>; files?:Array<{path:string;content:Buffer}>; labels?:LabelDocument; message?:string }
function jsonBuffer(value:unknown):Buffer{return Buffer.from(JSON.stringify(value,null,2)+'\n');}
function parseDatasetJsonl(content:Buffer){return content.toString('utf8').replace(/^\uFEFF/,'').trim()?parseJsonl(content):{rows:[],rowIds:[],columns:[]};}
function configuredColumns(rows:Record<string,unknown>[],fields?:Record<string,DatasetFieldMetadata>){const columns=inferColumns(rows);for(const [name,field]of Object.entries(fields??{})){const existing=columns.find(column=>column.name===name);if(existing){if(field.type)existing.dtype=field.type;}else columns.push({name,dtype:field.type??'missing'});}return orderDatasetColumns(columns,fields);}
function pointerValue(record:unknown,pointer:string):unknown {
  if(pointer==='')return record;
  if(!pointer.startsWith('/')||/\~(?:[^01]|$)/.test(pointer))throw new ApiError(422,'DATASET_POINTER_INVALID','字段位置必须使用有效 JSON Pointer。');
  let value=record;
  for(const encoded of pointer.slice(1).split('/')){const key=encoded.replace(/~1/g,'/').replace(/~0/g,'~');if(value===null||typeof value!=='object'||!Object.hasOwn(value,key))throw new ApiError(422,'DATASET_POINTER_MISSING','标注指向的字段或步骤不存在。');value=(value as Record<string,unknown>)[key];}
  return value;
}
function validateFineTarget(record:Record<string,unknown>,annotation:DatasetSpan|DatasetStep,span:boolean){
  const value=pointerValue(record,annotation.pointer);
  if(datasetHash(value)!==annotation.sourceHash)throw new ApiError(409,'DATASET_ANCHOR_STALE','内容已改变，片段或步骤标注需要重新定位。');
  if(span){const item=annotation as DatasetSpan;if(typeof value!=='string'||item.start>=item.end||item.end>Array.from(value).length)throw new ApiError(422,'DATASET_SPAN_RANGE','字符片段需使用源文本的 Unicode 码点 [start,end) 范围。');}
  else if(value===null||typeof value!=='object')throw new ApiError(422,'DATASET_STEP_TARGET','步骤标注必须指向真实的结构化步骤对象或数组。');
}
function operationKind(op:DatasetOperation):DatasetWriteOperation{return op.op==='evaluation'?'edit-evaluation':op.op==='assign'?op.spans?.length||op.steps?.length?'annotate-fragment':op.scope==='dataset'?'edit-dataset-labels':op.scope==='file'?'edit-file-labels':'assign-labels':op.op==='feedback'?'feedback':op.op==='readme'?'edit-readme':'edit-content';}

interface DatasetSourceEvidence {namespace:string;repo:string;commitId:string;path:string;sha256:string;rows:Record<string,unknown>[];rowIds:string[];hashes:Map<string,string>}
// Evidence shares immutable source-row references with the existing fixed-commit snapshot cache.
// Weak keys add no independent cache lifetime and no raw-byte or authorization cache.
const datasetSourceEvidence=new WeakMap<DatasetSnapshot,DatasetSourceEvidence>();

export class DatasetService {
  private readonly labels:LabelService;
  private readonly chains=new Map<string,Promise<void>>();
  private readonly cache=new Map<string,Promise<DatasetSnapshot>>();
  private readonly sourceActivityCache=new Map<string,Promise<DatasetRowActivity>>();
  private readonly modelQueries=new Map<string,Promise<QueryResult>>();
  constructor(private provider:Provider,private options:DatasetServiceOptions={},private readonly seededSource?:DatasetSourceEvidence){this.labels=new LabelService(provider);}
  /** Current catalog snapshot is adopted only by explicit dataset creation/configuration. */
  predefinedFieldMetadata(): Record<string, DatasetFieldMetadata> { return structuredClone(this.options.globalFields?.() ?? {}); }
  async markGlobalFieldsAdoption(key:RepoKey,fields:Readonly<Record<string,DatasetFieldMetadata>>|undefined):Promise<void> { const active=this.options.globalFields?.()??{};if(Object.entries(fields??{}).some(([id,field])=>!!field.globalField||Object.hasOwn(active,id)||['split','quality','purposes','visibility'].includes(id)))await this.options.beforeGlobalFieldsAdoption?.(key); }
  async resolve(key:RepoKey,reference:string){return this.labels.resolve(key,safeRef(reference));}
  async assertDraftHead(key:RepoKey,branch:string,expectedCommit:string){await this.expected(key,safeRef(branch),safeRef(expectedCommit));}
  /** Explicit synchronization accepts project labels and presentation-only width/order changes. */
  async assertProjectLabelAdvance(key:RepoKey,branch:string,oldCommit:string,newCommit:string){
    await this.assertDraftHead(key,branch,newCommit);
    if(oldCommit===newCommit)throw new ApiError(409,'DATASET_DRAFT_NO_ADVANCE','当前分支没有新的展示元数据版本需要同步。');
    const changes=await this.provider.diff(key,safeRef(oldCommit),safeRef(newCommit));
    if(!changes.length||changes.some(change=>change.path!==DATASET_LABELS_PATH&&change.path!==DATASET_DESCRIPTOR_PATH))throw new ApiError(409,'DATASET_DRAFT_REBASE_UNSUPPORTED','分支存在样本、规范或其他文件变更，不能仅同步展示元数据；请导出草稿后人工对照。');
    if(changes.some(change=>change.path===DATASET_DESCRIPTOR_PATH)){
      const previous=await this.descriptor(key,oldCommit),next=await this.descriptor(key,newCommit);
      if(canonicalJson({...previous,fields:semanticDatasetFields(previous.fields)})!==canonicalJson({...next,fields:semanticDatasetFields(next.fields)}))throw new ApiError(409,'DATASET_DRAFT_REBASE_UNSUPPORTED','字段规则、说明或数据入口发生变化，不能仅同步展示设置；请保留草稿并人工对照。');
    }
    let ancestor=false;
    for(let page=1;page<=20;page++){
      const commits=await this.provider.commits(key,newCommit,page,500);
      if(commits.some(commit=>commit.id===oldCommit)){ancestor=true;break;}
      if(commits.length<500)break;
    }
    if(!ancestor)throw new ApiError(409,'DATASET_DRAFT_REBASE_ANCESTRY','草稿基点不是当前提交的可验证祖先，未同步草稿。');
    await this.assertDraftHead(key,branch,newCommit);
  }
  private lock<T>(key:RepoKey,work:()=>Promise<T>):Promise<T>{const name=`${key.namespace}/${key.repo}`,result=(this.chains.get(name)??Promise.resolve()).then(work),settled=result.then(()=>{},()=>{});this.chains.set(name,settled);void settled.then(()=>{if(this.chains.get(name)===settled)this.chains.delete(name);});return result;}
  private async expected(key:RepoKey,branch:string,expected:string){const head=(await this.provider.branches(key)).find(item=>item.name===branch);if(!head)throw new ApiError(400,'DATASET_BRANCH_REQUIRED','编辑需要选择可写分支，历史提交仅供查看。');if(head.commitId!==expected)throw new ApiError(409,'DATASET_VERSION_CONFLICT','分支已有新提交，本地草稿已保留，请比较最新版本后重试。',{expectedCommit:expected,actualCommit:head.commitId});}
  private async descriptor(key:RepoKey,commitId:string):Promise<DatasetDescriptor>{
    const saved=await storedJson(this.provider,key,commitId,DATASET_DESCRIPTOR_PATH);
    if(saved)return descriptorSchema.parse(saved);
    const manifest=await storedJson(this.provider,key,commitId,'bundle-manifest.json') as {canonical_data?:unknown;repository?:unknown}|undefined;
    if(manifest){if(typeof manifest.canonical_data!=='string')throw new ApiError(422,'DATASET_DESCRIPTOR_INVALID','导入清单没有声明有效的规范样本入口。');return descriptorSchema.parse({version:1,id:`${key.namespace}/${key.repo}`,name:key.repo,canonicalPath:manifest.canonical_data,readmePath:'README.md',identityField:'id',attachmentFields:['package_path','image','image_path','file','file_path','audio','video','pdf'],source:'bundle-manifest',importManifestPath:'bundle-manifest.json'});}
    const candidates:string[]=[];
    const inspect=async(directory:string)=>{let nodes;try{nodes=await this.provider.tree(key,commitId,directory);}catch(error){if(error instanceof ApiError&&error.status===404)return;throw error;}for(const node of nodes)if(node.kind==='file'&&/\.(jsonl|ndjson|csv|tsv)$/i.test(node.path))candidates.push(node.path);};
    await inspect('');await inspect('data');
    if(candidates.length!==1)throw new ApiError(409,'DATASET_NOT_CONFIGURED',candidates.length?'项目有多个数据文件，请由负责人一次性配置规范样本入口。':'当前分支尚未建立数据集，可由有权限的负责人导入样本。');
    return descriptorSchema.parse({version:1,id:`${key.namespace}/${key.repo}`,name:key.repo,canonicalPath:candidates[0],readmePath:'README.md',identityField:'id',attachmentFields:['package_path','image','image_path','file','file_path'],source:'single-table'});
  }
  async read(key:RepoKey,reference:string):Promise<DatasetSnapshot>{
    const commitId=await this.resolve(key,reference),cacheKey=`${key.namespace}/${key.repo}@${commitId}`;
    let pending=this.cache.get(cacheKey);
    if(!pending){pending=this.materialize(key,commitId);this.cache.set(cacheKey,pending);pending.catch(()=>this.cache.delete(cacheKey));if(this.cache.size>4)this.cache.delete(this.cache.keys().next().value!);}
    const snapshot=await pending,copy={...structuredClone(snapshot),ref:reference,labels:{...structuredClone(snapshot.labels),ref:reference}},evidence=datasetSourceEvidence.get(snapshot);if(evidence)datasetSourceEvidence.set(copy,evidence);
    // A fixed-commit data cache must never cache the mutable sticky security policy.
    if(copy.evaluation)copy.evaluation.enabled=await this.options.evaluation?.enabled(key)??false;
    return copy;
  }
  async managedPaths(key:RepoKey,reference:string):Promise<Set<string>>{const snapshot=await this.read(key,reference);return new Set([DATASET_DESCRIPTOR_PATH,DATASET_FORMAT_PATH,DATASET_EVALUATION_PATH,snapshot.path,snapshot.descriptor.identityMapPath??IDENTITY_PATH,DATASET_ACTIVITY_PATH,...snapshot.attachments.map(item=>item.path)]);}
  async setupState(key:RepoKey,reference:string){const commitId=await this.resolve(key,reference);try{await this.read(key,commitId);return {commitId,configured:true,canInitialize:false,candidates:[] as string[]};}catch(cause){if(!(cause instanceof ApiError&&cause.code==='DATASET_NOT_CONFIGURED'))throw cause;}const candidates:string[]=[];for(const directory of ['', 'data']){let entries;try{entries=await this.provider.tree(key,commitId,directory);}catch(cause){if(cause instanceof ApiError&&cause.status===404)continue;throw cause;}for(const entry of entries)if(entry.kind==='file'&&/\.(jsonl|ndjson|csv|tsv)$/i.test(entry.path))candidates.push(entry.path);}return {commitId,configured:false,canInitialize:candidates.length===0,candidates};}
  private async materialize(key:RepoKey,commitId:string):Promise<DatasetSnapshot>{
    const descriptor=await this.descriptor(key,commitId),seed=this.seededSource?.namespace===key.namespace&&this.seededSource.repo===key.repo&&this.seededSource.commitId===commitId&&this.seededSource.path===descriptor.canonicalPath?this.seededSource:undefined,raw=seed?undefined:await this.provider.raw(key,commitId,descriptor.canonicalPath);
    const parsed=seed?{rows:seed.rows}:/\.(jsonl|ndjson)$/i.test(descriptor.canonicalPath)?parseDatasetJsonl(raw!.content):tableFrom(raw!.content.toString('utf8'),descriptor.canonicalPath);
    if(!parsed)throw new ApiError(422,'DATASET_TABLE_REQUIRED','规范样本入口必须为 JSONL、CSV 或 TSV。');
    const baselineSha256=seed?.sha256??createHash('sha256').update(raw!.content).digest('hex'),baseline=parsed.rows;if(baseline.length>MAX_ROWS)throw new ApiError(413,'DATASET_ROW_LIMIT','当前本地数据集最多支持 250000 条；未返回不完整样本。');
    let ids:string[]=seed?[...seed.rowIds]:stableRowIds(baseline);
    const mapping=await storedJson(this.provider,key,commitId,descriptor.identityMapPath??IDENTITY_PATH) as {version?:number;baselineSha256?:string;rowIds?:string[]}|undefined;
    if(mapping){if(mapping.version!==1||mapping.baselineSha256!==baselineSha256||!Array.isArray(mapping.rowIds)||mapping.rowIds.length!==baseline.length||new Set(mapping.rowIds).size!==baseline.length||mapping.rowIds.some(id=>typeof id!=='string'||!id||id.length>200))throw new ApiError(422,'DATASET_IDENTITY_INVALID','规范样本基线与身份映射不匹配，请通过显式迁移修复。');ids=mapping.rowIds;}
    const rows=new Map(ids.map((id,index)=>[id,baseline[index]!]));const baselineHashes=seed?.hashes??new Map(ids.map((id,index)=>[id,datasetHash(baseline[index]) ]));
    const marker=await optionalRaw(this.provider,key,commitId,DATASET_FORMAT_PATH);
    let rowPatches:RowRecord[]=[];
    let records:DatasetLabelRecord[]=[],supersededLabelRecords:NonNullable<DatasetSnapshot['supersededLabelRecords']>=[];const feedback:DatasetFeedback[]=[];
    if(marker){
      const patches=await concurrentMap(await datasetFiles(this.provider,key,commitId,`${DATASET_ROOT}/rows`),filename=>storedJson(this.provider,key,commitId,filename) as Promise<RowRecord>);
      rowPatches=patches;
      for(const patch of patches){if(!patch||patch.version!==1||typeof patch.rowId!=='string'||!['upsert','delete'].includes(patch.op))throw new ApiError(422,'DATASET_STORAGE_INVALID','样本覆盖记录格式无效。');if(!patch.isNew&&baselineHashes.get(patch.rowId)!==patch.baseHash)throw new ApiError(409,'DATASET_BASELINE_CHANGED','样本基线发生变化，不能将旧覆盖记录套用到新内容。');if(patch.op==='delete')rows.delete(patch.rowId);else{if(!patch.record||typeof patch.record!=='object'||Array.isArray(patch.record))throw new ApiError(422,'DATASET_STORAGE_INVALID','样本覆盖缺少有效记录。');rows.set(patch.rowId,patch.record);}}
      const store=await readLabelRecordStore(this.provider,key,commitId);records=store.records;supersededLabelRecords=store.superseded;
      feedback.push(...await concurrentMap(await datasetFiles(this.provider,key,commitId,`${DATASET_ROOT}/feedback`),filename=>storedJson(this.provider,key,commitId,filename) as Promise<DatasetFeedback>));
    }
    if(rows.size>MAX_ROWS)throw new ApiError(413,'DATASET_ROW_LIMIT','数据集超过 250000 条支持上限。');
    const state=await this.labels.readLegacy(key,commitId);
    const binding=await this.options.governance?.snapshot(key,commitId);
    const bound=binding?.binding as ProjectSchemaBinding|undefined;
    const columnsByScope=Object.fromEntries((['dataset','row','file'] as const).map(scope=>[scope,bound?getBindingColumns(bound,scope):state.columns.filter(column=>!column.scopes||column.scopes.includes(scope))]));
    const allColumns=new Map((bound?[]:state.columns).map(column=>[column.id,column]));for(const scope of ['dataset','row','file'] as const)for(const column of columnsByScope[scope]!)allColumns.set(column.id,column);state.columns=[...allColumns.values()];
    const authority=await readDatasetLabelAuthority(this.provider,key,commitId);
    if(authority)records=[...records,authority];
    const activityRecords=records;
    const layered=separateDatasetLayers(state,records,bound),activeAuthority=authority&&recordUsesActiveLayer(authority,bound)?authority:undefined;
    const merged=materializeLabelAssignments(layered.state,activeAuthority?[...layered.records.filter(record=>record.scope!=='dataset'),activeAuthority]:layered.records);
    records=layered.records;
    const attachments:DatasetAttachment[]=[];const attachmentMap=new Map<string,DatasetAttachment>();
    for(const [id,row]of rows)for(const field of descriptor.attachmentFields){const value=row[field];const values=Array.isArray(value)?value:[value];for(const entry of values){if(typeof entry!=='string'||!entry||/^[a-z][a-z0-9+.-]*:/i.test(entry))continue;let filename;try{filename=safeFilePath(entry);}catch{continue;}let attachment=attachmentMap.get(filename);if(!attachment){attachment={path:filename,name:path.posix.basename(filename),rowIds:[],kind:/\.zip$/i.test(filename)?'zip':'file'};attachmentMap.set(filename,attachment);attachments.push(attachment);}attachment.rowIds.push(id);}}
    const targetFiles=new Set([...merged.assignments.filter(item=>item.scope==='file').map(item=>item.path!),...attachments.map(item=>item.path)]);
    const validFiles=new Set<string>();
    await concurrentMap([...new Set([...targetFiles].map(filename=>path.posix.dirname(filename)))],async directory=>{try{for(const item of await this.provider.tree(key,commitId,directory==='.'?'':directory))if(item.kind==='file'){validFiles.add(item.path);const attachment=attachmentMap.get(item.path);if(attachment)attachment.bytes=item.size;}}catch(error){if(!(error instanceof ApiError&&error.status===404))throw error;}});
    const orphanAssignments=merged.assignments.filter(item=>item.scope==='row'&&(item.path!==descriptor.canonicalPath||!rows.has(item.rowId!))||item.scope==='file'&&!validFiles.has(item.path!));
    const assignments=merged.assignments.filter(item=>!orphanAssignments.includes(item));
    const activity=await readDatasetActivity(this.provider,key,commitId,baselineSha256),activityKey=`${key.namespace}/${key.repo}/${descriptor.canonicalPath}@${baselineSha256}`;
    let sourceActivity:DatasetRowActivity={createdAt:null,updatedAt:null,source:'unknown'};
    if(!activity?.initial){let pending=this.sourceActivityCache.get(activityKey);if(!pending){pending=datasetSourceFileActivity(this.provider,key,commitId,descriptor.canonicalPath);this.sourceActivityCache.set(activityKey,pending);if(this.sourceActivityCache.size>8)this.sourceActivityCache.delete(this.sourceActivityCache.keys().next().value!);}sourceActivity=await pending;}
    const rowActivity=datasetRowActivities([...rows.keys()],activity,sourceActivity,rowPatches,activityRecords);
    const evaluationDocument=await readEvaluationDocument(this.provider,key,commitId),evaluation=evaluationView(evaluationDocument,[...rows.keys()],await this.options.evaluation?.enabled(key)??false);
    for(const [id,entry]of Object.entries(evaluationDocument.activity??{})){const current=rowActivity[id];if(current&&(!current.updatedAt||Date.parse(current.updatedAt)<=Date.parse(entry.updatedAt)))rowActivity[id]={...current,updatedAt:entry.updatedAt,actor:entry.actor,source:'web-operation',kind:'evaluation'};}
    const readmeRaw=await optionalRaw(this.provider,key,commitId,descriptor.readmePath);if(readmeRaw&&readmeRaw.content.length>2*1024*1024)throw new ApiError(413,'DATASET_README_LIMIT','README 超过 2 MiB。');
    const result:DatasetSnapshot={...key,ref:commitId,commitId,path:descriptor.canonicalPath,descriptor,rowActivity,rows:[...rows.values()],rowIds:[...rows.keys()],columns:configuredColumns([...rows.values()],descriptor.fields),totalRows:rows.size,contentHashes:Object.fromEntries([...rows].map(([id,row])=>[id,datasetHash(row)])),labels:{...state,assignments},columnsByScope,labelRecords:records,supersededLabelRecords,labelConflicts:merged.conflicts.filter(item=>item.scope==='dataset'||item.scope==='row'&&item.path===descriptor.canonicalPath&&rows.has(item.rowId!)||item.scope==='file'&&validFiles.has(item.path!)),attachments,feedback,readme:readmeRaw?.content.toString('utf8')??'',readmePath:descriptor.readmePath,...(binding?.binding?{binding:binding.binding}:{}),orphanAssignments,warnings:orphanAssignments.length?[`保留了 ${orphanAssignments.length} 条已不存在目标的历史标签，未计入当前样本。`]:[]};
    result.evaluation=evaluation;
    datasetSourceEvidence.set(result,{...key,commitId,path:descriptor.canonicalPath,sha256:baselineSha256,rows:baseline,rowIds:[...ids],hashes:baselineHashes});return result;
  }
  async page(key:RepoKey,reference:string,input:DatasetQueryInput={}):Promise<DatasetPage>{
    return this.pageSnapshot(key,await this.read(key,reference),input);
  }
  /** Called by managed writes, restore and release checks; flags never grant repository read access. */
  async assertEvaluationSafety(key:RepoKey,snapshot:DatasetSnapshot):Promise<void>{
    const evaluation=this.options.evaluation;if(!evaluation||!await evaluation.enabled(key))return;
    await evaluation.assertPrivate?.(key);
    const rows=snapshot.evaluation?.rows??{};assertEvaluationFamilies(rows);
    if(evaluation.exposed){const exposed=await evaluation.exposed(key),attachments=[];
      if(exposed.attachmentHashes?.length)for(const attachment of snapshot.attachments){if(!attachment.rowIds.some(id=>rows[id]?.visibility==='holdout'))continue;const sha256=attachment.sha256??createHash('sha256').update((await this.provider.raw(key,snapshot.commitId,attachment.path)).content).digest('hex');attachments.push({...attachment,sha256});}
      assertEvaluationExposure(rows,exposed,attachments);
    }
  }
  async pageSnapshot(key:RepoKey,snapshot:DatasetSnapshot,input:DatasetQueryInput={}):Promise<DatasetPage>{
    const all=new Map(snapshot.rowIds.map((id,index)=>[id,snapshot.rows[index]!]));let ids=[...snapshot.rowIds];let querySummary:DatasetPage['querySummary'],queryResult:DatasetPage['queryResult'];
    const workflow=await this.options.workflowFields?.(key,snapshot)??{};
    const systemColumns=new Set(['updated_at','actor']),evaluationColumns=new Set(['visibility','suites','family_id']),sourceColumns=new Set(snapshot.columns.map(column=>column.name)),labelColumns=new Set(snapshot.labels.columns.map(column=>column.id)),workflowColumns=new Set(Object.values(workflow).flatMap(fields=>Object.keys(fields)));
    if(input.sort){const column=input.sort.column,namespace=/^(label|dataset|file|span|step|workflow|system|evaluation)\.(.+)$/.exec(column);if(!(column==='sample_id'||(namespace?(namespace[1]==='evaluation'?evaluationColumns.has(namespace[2]!):namespace[1]==='system'?systemColumns.has(namespace[2]!):namespace[1]==='workflow'?workflowColumns.has(namespace[2]!):labelColumns.has(namespace[2]!)):sourceColumns.has(column.replace(/^data\./,'')))))throw new ApiError(400,'QUERY_UNKNOWN_COLUMN','排序字段在当前数据集规范中不存在。');}
    for(const filter of input.filters??[]){
      const namespace=/^(label|dataset|file|span|step|workflow|system|evaluation)\.(.+)$/.exec(filter.column);
      const valid=filter.column==='sample_id'||(namespace?(namespace[1]==='evaluation'?evaluationColumns.has(namespace[2]!):namespace[1]==='system'?systemColumns.has(namespace[2]!):namespace[1]==='workflow'?workflowColumns.has(namespace[2]!):labelColumns.has(namespace[2]!)):sourceColumns.has(filter.column.replace(/^data\./,'')));
      if(!valid)throw new ApiError(400,'QUERY_UNKNOWN_COLUMN','筛选字段在当前样本、标签或工作流规范中不存在。');
      if(['gt','lt'].includes(filter.operator)){if(filter.column==='system.updated_at'){if(!filter.value?.trim()||!Number.isFinite(Date.parse(filter.value)))throw new ApiError(400,'QUERY_DATE_REQUIRED','最后修改时间筛选需要有效时间。');}else if(!filter.value?.trim()||!Number.isFinite(Number(filter.value)))throw new ApiError(400,'QUERY_NUMBER_REQUIRED','数值筛选需要有效数字。');}
    }
    const fine=(id:string,kind:'span'|'step')=>snapshot.labelRecords.filter(record=>record.scope==='row'&&record.rowId===id).flatMap(record=>kind==='span'?record.spans:record.steps).filter(annotation=>{try{validateFineTarget(all.get(id)!,annotation,kind==='span');return true;}catch{return false;}});
    const assignment=(id:string,column:string)=>{const prefix=column.split('.')[0],columnId=column.slice(column.indexOf('.')+1),assignments=snapshot.labels.assignments;if(prefix==='label')return assignments.find(item=>item.scope==='row'&&item.rowId===id&&item.path===snapshot.path)?.values[columnId];if(prefix==='dataset')return assignments.find(item=>item.scope==='dataset')?.values[columnId];if(prefix==='file')return assignments.filter(item=>item.scope==='file'&&(item.path===snapshot.path||snapshot.attachments.some(a=>a.path===item.path&&a.rowIds.includes(id)))).flatMap(item=>item.values[columnId]??[]);if(prefix==='span'||prefix==='step')return fine(id,prefix).flatMap(annotation=>annotation.values[columnId]??[]);return undefined;};
    const evaluationValue=(id:string,column:string)=>{const row=snapshot.evaluation?.rows[id];return column==='visibility'?row?.visibility:column==='suites'?row?.suites:row?.familyId;};
    const value=(id:string,column:string)=>column.startsWith('evaluation.')?evaluationValue(id,column.slice(11)):column==='system.updated_at'?snapshot.rowActivity?.[id]?.updatedAt:column==='system.actor'?snapshot.rowActivity?.[id]?.actor?.name:/^(label|dataset|file|span|step)\./.test(column)?assignment(id,column):column.startsWith('workflow.')?workflow[id]?.[column.slice(9)]:column==='sample_id'?id:all.get(id)?.[column.replace(/^data\./,'')];
    for(const filter of input.filters??[])ids=ids.filter(id=>{const cell=value(id,filter.column),text=typeof cell==='object'?canonicalJson(cell):String(cell??'');if(filter.operator==='unset')return cell===undefined||cell===null||cell===''||Array.isArray(cell)&&!cell.length;if(filter.operator==='contains')return text.toLocaleLowerCase().includes((filter.value??'').toLocaleLowerCase());if(filter.operator==='gt'||filter.operator==='lt'){const actual=filter.column==='system.updated_at'?typeof cell==='string'?Date.parse(cell):Number.NaN:Number(cell),expected=filter.column==='system.updated_at'?Date.parse(filter.value!):Number(filter.value);return cell!==null&&cell!==''&&Number.isFinite(actual)&&(filter.operator==='gt'?actual>expected:actual<expected);}return Array.isArray(cell)?cell.includes(filter.value):text===(filter.value??'');});
    if(input.search?.trim()){const search=input.search.trim().toLocaleLowerCase();ids=ids.filter(id=>canonicalJson({data:all.get(id),labels:snapshot.labels.assignments.filter(item=>item.scope==='dataset'||item.scope==='row'&&item.rowId===id||item.scope==='file'&&(item.path===snapshot.path||snapshot.attachments.some(a=>a.path===item.path&&a.rowIds.includes(id)))),spans:fine(id,'span'),steps:fine(id,'step'),activity:snapshot.rowActivity?.[id],opinions:snapshot.labelRecords.filter(item=>item.scope==='dataset'||item.scope==='row'&&item.rowId===id||item.scope==='file'&&snapshot.attachments.some(a=>a.path===item.path&&a.rowIds.includes(id))),workflow:workflow[id]}).toLocaleLowerCase().includes(search));}
    if(input.prompt?.trim()){
      const joined=ids.map(id=>({...all.get(id),...Object.fromEntries(Object.entries(all.get(id)!).map(([field,value])=>[`data.${field}`,value])),sample_id:id,...Object.fromEntries([...evaluationColumns].map(column=>[`evaluation.${column}`,evaluationValue(id,column)])),...Object.fromEntries(snapshot.labels.columns.flatMap(column=>['label','dataset','file','span','step'].map(scope=>[`${scope}.${column.id}`,assignment(id,`${scope}.${column.id}`)]))),...Object.fromEntries(Object.entries(workflow[id]??{}).map(([field,value])=>[`workflow.${field}`,value]))}));
      const table={kind:'table' as const,path:snapshot.path,mime:'application/x-ndjson',size:0,rows:joined,columns:inferColumns(joined),totalRows:joined.length};
      if(input.engine==='model'&&!input.allowExternalSchema)throw new ApiError(403,'QUERY_SCHEMA_CONSENT_REQUIRED','模型查询只发送字段结构和问题，需要明确授权。');
      let result:QueryResult;
      if(input.engine==='model'){
        const cacheKey=datasetHash({key,commitId:snapshot.commitId,content:snapshot.contentHashes,labels:snapshot.labels.assignments,fine:snapshot.labelRecords.map(({scope,path,rowId,actor,values,spans,steps})=>({scope,path,rowId,actor:actor.id,values,spans,steps})),ids,prompt:input.prompt,workflow});
        let pending=this.modelQueries.get(cacheKey);
        if(!pending){pending=(this.options.queryModel??modelQuery)(table,input.prompt);this.modelQueries.set(cacheKey,pending);pending.catch(()=>this.modelQueries.delete(cacheKey));if(this.modelQueries.size>4)this.modelQueries.delete(this.modelQueries.keys().next().value!);}
        result=await pending;
      }else result=naturalQuery(table,input.prompt,{maxResultRows:MAX_ROWS,defaultLimit:MAX_ROWS,returnMatchingRowsForCount:true});
      querySummary={engine:result.engine,matchedRows:result.totalRows,returnedRows:result.rows.length,truncated:result.totalRows>result.rows.length,explanation:result.explanation};
      const candidates=new Set(ids),selected=result.rows.map(row=>row.sample_id).filter((id):id is string=>typeof id==='string'&&candidates.has(id));
      if(result.rows.length&&selected.length===0)queryResult=result;
      else ids=[...new Set(selected)];
    }
    if(input.sort)ids=orderedDatasetIds(ids,id=>input.sort!.column==='system.updated_at'?(snapshot.rowActivity?.[id]?.updatedAt?Date.parse(snapshot.rowActivity[id]!.updatedAt!):undefined):value(id,input.sort!.column),input.sort.direction);
    const matchedRows=ids.length,pageSize=Math.max(1,Math.min(input.pageSize??50,200)),located=input.sample?ids.indexOf(input.sample):-1,page=Math.max(1,Math.min(located>=0?Math.floor(located/pageSize)+1:input.page??1,Math.max(1,Math.ceil(matchedRows/pageSize)))),shown=ids.slice((page-1)*pageSize,page*pageSize),selected=new Set(shown);
    return {...snapshot,...(snapshot.evaluation?{evaluation:{...snapshot.evaluation,rows:Object.fromEntries(shown.map(id=>[id,snapshot.evaluation!.rows[id]!]))}}:{}),rowActivity:Object.fromEntries(shown.map(id=>[id,snapshot.rowActivity?.[id]??{createdAt:null,updatedAt:null,source:'unknown' as const}])),rows:shown.map(id=>all.get(id)!),rowIds:shown,contentHashes:Object.fromEntries(shown.map(id=>[id,snapshot.contentHashes[id]!])),labelRecords:snapshot.labelRecords.filter(record=>record.scope!=='row'||selected.has(record.rowId!)),workflow:Object.fromEntries(shown.map(id=>[id,workflow[id]??{}])),...(querySummary?{querySummary}:{}),...(queryResult?{queryResult}:{}),matchedRows,page,pageSize};
  }
  /** Batch one phase only. No authorization decision survives a request or a write boundary. */
  private async authorizeOperations(key:RepoKey,identity:RequestIdentity,branch:string,operations:DatasetOperation[],snapshot:DatasetSnapshot){
    if(identity.kind==='guest')throw new ApiError(401,'AUTH_REQUIRED','请登录后修改数据集。');
    const groups=new Map<string,{operation:DatasetWriteOperation;scope?:import('../../../packages/shared/src/index.js').LabelScope;path?:string;ids:Set<string>;operations:DatasetOperation[]}>();
    for(const op of operations){
      const operation=operationKind(op),scope=op.op==='assign'?op.scope:undefined,filename=op.op==='assign'?op.path:undefined,name=JSON.stringify([operation,scope??'',filename??'']);
      let group=groups.get(name);if(!group){group={operation,...(scope?{scope}:{}),...(filename?{path:filename}:{}),ids:new Set(),operations:[]};groups.set(name,group);}
      const ids=op.op==='evaluation'?op.rowIds:op.op==='assign'?op.scope==='row'&&op.rowId?[op.rowId]:op.scope==='file'?(op.path===snapshot.path?snapshot.rowIds:snapshot.attachments.find(item=>item.path===op.path)?.rowIds??[]):[]:'rowId'in op&&op.rowId?[op.rowId]:[];
      for(const id of ids)group.ids.add(id);group.operations.push(op);
    }
    const checked=new Set<DatasetWriteOperation>();
    for(const group of groups.values()){
      // Keep the operation-specific callback contract: a custom authorizer can distinguish README and content.
      if(!checked.has(group.operation)){if(this.options.authorize)await this.options.authorize(key,identity,group.operation);else if(identity.kind!=='owner')throw new ApiError(403,'DATASET_PERMISSION_REQUIRED','此数据集写入尚未配置授权服务。');checked.add(group.operation);}
      await this.options.beforeWrite?.(key,identity,branch,[...group.ids],group.operation,{...(group.scope?{scope:group.scope}:{}),...(group.path?{path:group.path}:{}),operations:group.operations});
    }
  }
  private async authorizeImport(key:RepoKey,identity:RequestIdentity,input:DatasetSaveInput){if(identity.kind==='guest')throw new ApiError(401,'AUTH_REQUIRED','请登录后导入。');if(this.options.authorize)await this.options.authorize(key,identity,'edit-content');else if(identity.kind!=='owner')throw new ApiError(403,'DATASET_PERMISSION_REQUIRED','数据集导入需要明确授权。');await this.options.beforeWrite?.(key,identity,input.ref,input.operations.flatMap(op=>'rowId'in op&&op.rowId?[op.rowId]:[]),'edit-content',{operations:input.operations});}
  /** Validates exactly the same operations as commit, but produces a read-only in-memory view. */
  async plan(key:RepoKey,identity:RequestIdentity,input:DatasetSaveInput,internalImport=false):Promise<DatasetPlan>{
      const parsed=(internalImport?datasetSaveSchema.extend({operations:z.array(datasetOperationSchema).min(1).max(MAX_ROWS)}):datasetSaveSchema).parse(input) as DatasetSaveInput;
      if(internalImport&&parsed.operations.some(op=>op.op!=='append'))throw new ApiError(422,'DATASET_IMPORT_OPERATIONS','批量导入只能新增样本。');
      await this.expected(key,parsed.ref,parsed.expectedCommit);const snapshot=await this.read(key,parsed.expectedCommit);
      const rows=new Map(snapshot.rowIds.map((id,index)=>[id,structuredClone(snapshot.rows[index]!)])),changedRows=new Set<string>(),writes=new Map<string,Buffer>(),businessIds=new Map<string,Set<string>>(),actor={id:identity.id,name:identity.name},now=new Date().toISOString();
      if(internalImport)await this.authorizeImport(key,identity,parsed);
      for(const operation of parsed.operations)if(operation.op==='assign'&&(operation.scope==='dataset'&&(operation.path!==undefined||operation.rowId!==undefined)||operation.scope==='file'&&operation.rowId!==undefined||operation.scope==='row'&&operation.path!==undefined&&operation.path!==snapshot.path))throw new ApiError(422,'LABEL_SCOPE_INVALID','标签目标层级与文件/样本身份不一致。');
      if(!internalImport)await this.authorizeOperations(key,identity,parsed.ref,parsed.operations,snapshot);
      // Apply data first so anchors and labels in the same atomic save bind to the resulting content.
      for(const op of parsed.operations){
        if(op.op!=='update'&&op.op!=='delete'&&op.op!=='append')continue;
        if(op.op==='append'){
          if(Object.keys(op.record).some(field=>['__proto__','constructor','prototype'].includes(field.toLowerCase())))throw new ApiError(422,'DATASET_FIELD_RESERVED_ID','新增样本不能使用对象保留字段。');
          const id=op.rowId??((typeof op.record.id==='string'||typeof op.record.id==='number')?stableRowIds([op.record])[0]!:`new:${randomUUID()}`);
          if(rows.has(id))throw new ApiError(409,'DATASET_DUPLICATE_ID','新增样本身份已存在。');
          for(const field of new Set(['id','uid',snapshot.descriptor.identityField,...Object.keys(op.record).filter(field=>['id','uid'].includes(field.toLowerCase()))].filter(Boolean)))if(Object.hasOwn(op.record,field)){if(!businessIds.has(field))businessIds.set(field,new Set([...rows.values()].filter(row=>Object.hasOwn(row,field)).map(row=>canonicalJson(row[field]))));if(businessIds.get(field)!.has(canonicalJson(op.record[field])))throw new ApiError(409,'DATASET_DUPLICATE_ID','新增样本业务标识重复，请调整身份字段或导入数据。',{field});}
          for(const [field,values]of businessIds)if(Object.hasOwn(op.record,field))values.add(canonicalJson(op.record[field]));
          rows.set(id,op.record);changedRows.add(id);writes.set(rowRecordPath(id),jsonBuffer({version:1,rowId:id,op:'upsert',record:op.record,isNew:true,actor,createdAt:now,updatedAt:now} satisfies RowRecord));
        }else{
          const existing=rows.get(op.rowId);if(!existing)throw new ApiError(404,'DATASET_SAMPLE_NOT_FOUND','选中的样本在当前版本不存在。');
          if(op.expectedContentHash&&datasetHash(existing)!==op.expectedContentHash)throw new ApiError(409,'DATASET_CONTENT_CONFLICT','样本内容已改变，本地编辑已保留。');
          const priorPath=rowRecordPath(op.rowId),previous=(writes.has(priorPath)?JSON.parse(writes.get(priorPath)!.toString()):await storedJson(this.provider,key,snapshot.commitId,priorPath)) as RowRecord|undefined;
          if(op.op==='update'){
            for(const field of protectedSourceFieldIds(existing,snapshot.descriptor.identityField,op.record))if(canonicalJson(existing[field])!==canonicalJson(op.record[field]))throw new ApiError(422,['id','uid','__bundle_provenance',snapshot.descriptor.identityField].includes(field)?'DATASET_IDENTITY_READONLY':'DATASET_SOURCE_TRUTH_READONLY','源身份、来源及既有真值字段只读；人工结论请在样本标注中填写。',{field});
            rows.set(op.rowId,op.record);changedRows.add(op.rowId);
          }else{rows.delete(op.rowId);businessIds.clear();}
          writes.set(rowRecordPath(op.rowId),jsonBuffer({version:1,rowId:op.rowId,op:op.op==='delete'?'delete':'upsert',...(op.op==='update'?{record:op.record}:{}),isNew:previous?.isNew??false,...(previous?.isNew?{}:{baseHash:previous?.baseHash??snapshot.contentHashes[op.rowId]}),actor,createdAt:previous?.createdAt??snapshot.rowActivity?.[op.rowId]?.createdAt??now,updatedAt:now} satisfies RowRecord));
        }
      }
      const checkedIds=[...changedRows].filter(id=>rows.has(id));assertDatasetFields(checkedIds.map(id=>rows.get(id)!),checkedIds,snapshot.descriptor.fields);
      const evaluationOperations=parsed.operations.filter(op=>op.op==='evaluation');
      if(evaluationOperations.length){
        if(!await this.options.evaluation?.enabled(key))throw new ApiError(409,'EVALUATION_NOT_ENABLED','负责人需先在私有主库明确启用发布分组。');
        const document=await readEvaluationDocument(this.provider,key,snapshot.commitId);document.activity??=Object.create(null);
        for(const op of evaluationOperations)for(const id of new Set(op.rowIds)){
          if(!rows.has(id))throw new ApiError(404,'DATASET_SAMPLE_NOT_FOUND','发布分组包含当前版本不存在的样本。');
          document.rows[id]={visibility:null,suites:[],familyId:null,...document.rows[id],...op.patch};
        }
        const changedIds=[...new Set(evaluationOperations.flatMap(op=>op.rowIds))].filter(id=>canonicalJson(document.rows[id])!==canonicalJson(snapshot.evaluation?.rows[id]??{visibility:null,suites:[],familyId:null}));
        for(const id of changedIds)document.activity![id]={updatedAt:now,actor};
        if(changedIds.length)writes.set(DATASET_EVALUATION_PATH,jsonBuffer(document));
      }
      for(const op of parsed.operations){
        if(op.op==='assign'){
          const target={scope:op.scope,...(op.scope==='row'?{path:snapshot.path,rowId:op.rowId}:op.scope==='file'?{path:op.path}:{} )};
          if(op.scope==='row'&&(!op.rowId||!rows.has(op.rowId)))throw new ApiError(422,'DATASET_SAMPLE_NOT_FOUND','样本标签需要当前有效的稳定身份。');
          if(op.scope==='file'){if(!op.path)throw new ApiError(422,'LABEL_PATH_REQUIRED','文件标签需要明确文件。');safeFilePath(op.path);const directory=path.posix.dirname(op.path),files=await this.provider.tree(key,snapshot.commitId,directory==='.'?'':directory);if(!files.some(item=>item.path===op.path&&item.kind==='file'))throw new ApiError(404,'LABEL_FILE_NOT_FOUND','选定文件在当前版本不存在。');}
          if(op.scope!=='row'&&(op.spans?.length||op.steps?.length))throw new ApiError(422,'DATASET_FINE_SCOPE','片段和步骤标注只适用于样本。');
          const filename=op.scope==='dataset'?DATASET_LABELS_PATH:labelRecordPath(target,identity.id),storedPrevious=(writes.has(filename)?JSON.parse(writes.get(filename)!.toString()):await storedJson(this.provider,key,snapshot.commitId,filename)??snapshot.labelRecords.find(record=>record.actor.id===identity.id&&targetKey(record)===targetKey(target))) as DatasetLabelRecord|undefined;
          const previous=storedPrevious&&recordUsesActiveLayer(storedPrevious,snapshot.binding as ProjectSchemaBinding|undefined)?storedPrevious:undefined;
          const values={...(op.scope==='dataset'?snapshot.labels.assignments.find(item=>item.scope==='dataset')?.values:previous?.values),...op.values};
          const effective=Object.fromEntries(Object.entries(values).filter((entry):entry is [string,string|string[]]=>entry[1]!==null));
          const scopedColumns=new Map([...snapshot.labels.columns.filter(column=>!column.scopes||column.scopes.includes(op.scope)),...snapshot.columnsByScope?.[op.scope]??[]].map(column=>[column.id,column]));
          const validate=(recordValues:Record<string,string|string[]>)=>validateLabelDocument({version:1,columns:[...scopedColumns.values()],assignments:[{id:assignmentId(target),...target,values:recordValues}]});
          validate(effective);
          const governed=getBindingSnapshot(snapshot.binding as ProjectSchemaBinding|undefined,op.scope);
          if(governed){const oldValues=op.scope==='dataset'?snapshot.labels.assignments.find(item=>targetKey(item)===targetKey(target))?.values??{}:Object.fromEntries(Object.entries(previous?.values??{}).filter((entry):entry is [string,string|string[]]=>entry[1]!==null));validateGovernedAssignment(governed,op.scope,effective,oldValues);}
          for(const columnId of Object.keys(values))if(!snapshot.labels.columns.some(column=>column.id===columnId))throw new ApiError(422,'LABEL_UNKNOWN_COLUMN','标签列不存在。');
          const spans=op.spans??previous?.spans??[],steps=op.steps??previous?.steps??[];
          if(new Set([...spans,...steps].map(item=>item.id)).size!==spans.length+steps.length)throw new ApiError(422,'DATASET_ANNOTATION_ID','片段和步骤标注 ID 不能重复。');
          if(op.scope==='row')for(const annotation of [...spans,...steps]){validate(annotation.values);if(governed)validateGovernedAssignment(governed,op.scope,annotation.values,[...previous?.spans??[],...previous?.steps??[]].find(item=>item.id===annotation.id)?.values??{});validateFineTarget(rows.get(op.rowId!)!,annotation,'start'in annotation);}
          const record:DatasetLabelRecord={version:1,...target,actor,values,spans,steps,sourceCommitId:snapshot.commitId,...(op.rowId?{contentHash:datasetHash(rows.get(op.rowId)!)}:{}),updatedAt:now,fingerprint:'',templateSnapshot:{columns:structuredClone(snapshot.labels.columns),...(snapshot.labels.templateApplications?{templateApplications:structuredClone(snapshot.labels.templateApplications)}:{}),...(snapshot.binding?{binding:structuredClone(snapshot.binding)}:{})}};
          record.fingerprint=labelFingerprint(record);writes.set(filename,jsonBuffer(record));
        }else if(op.op==='feedback'){
          if(op.rowId&&!rows.has(op.rowId))throw new ApiError(404,'DATASET_SAMPLE_NOT_FOUND','反馈关联样本不存在。');
          const id=randomUUID();writes.set(`${DATASET_ROOT}/feedback/${id}.json`,jsonBuffer({id,...(op.rowId?{rowId:op.rowId}:{}),...(op.columnId?{columnId:op.columnId}:{}),message:op.message,actor,createdAt:now,sourceCommitId:snapshot.commitId} satisfies DatasetFeedback));
        }else if(op.op==='readme')writes.set(snapshot.readmePath,Buffer.from(op.content));
      }
      if(writes.size&&!await optionalRaw(this.provider,key,snapshot.commitId,DATASET_FORMAT_PATH)){
        writes.set(DATASET_FORMAT_PATH,jsonBuffer({version:1,storage:'sample-records-v1'}));
        if(!await optionalRaw(this.provider,key,snapshot.commitId,DATASET_DESCRIPTOR_PATH))writes.set(DATASET_DESCRIPTOR_PATH,jsonBuffer({...snapshot.descriptor,identityMapPath:IDENTITY_PATH}));
        const evidence=datasetSourceEvidence.get(snapshot);if(!evidence)throw new ApiError(500,'DATASET_SOURCE_EVIDENCE_MISSING','缺少固定版本原始表证据，未提交。');
        writes.set(IDENTITY_PATH,jsonBuffer({version:1,baselineSha256:evidence.sha256,rowIds:evidence.rowIds}));
      }
      const overlay=new DatasetService(datasetOverlayProvider(this.provider,writes),this.options,datasetSourceEvidence.get(snapshot));
      const projected=await overlay.read(key,parsed.expectedCommit);projected.rowActivity=structuredClone(snapshot.rowActivity??{});
      await this.assertEvaluationSafety(key,projected);
      if(internalImport)await this.authorizeImport(key,identity,parsed);else await this.authorizeOperations(key,identity,parsed.ref,parsed.operations,snapshot);
      await this.expected(key,parsed.ref,parsed.expectedCommit);
      return {baseline:snapshot,snapshot:projected,writes,input:parsed};
  }
  /** Schema-managed key removal: one versioned overlay, with the same content/task authorization as normal edits. */
  async planFieldDeletion(key:RepoKey,identity:RequestIdentity,input:{ref:string;expectedCommit:string;fieldId:string;fields:Record<string,DatasetFieldMetadata>;message:string}):Promise<DatasetPlan>{
    await this.expected(key,input.ref,input.expectedCommit);
    const snapshot=await this.read(key,input.expectedCommit),operations:DatasetOperation[]=[],writes=new Map<string,Buffer>(),now=new Date().toISOString(),actor={id:identity.id,name:identity.name};
    for(let index=0;index<snapshot.rows.length;index++){
      const existing=snapshot.rows[index]!;if(!Object.hasOwn(existing,input.fieldId))continue;
      if(protectedSourceFieldIds(existing,snapshot.descriptor.identityField).includes(input.fieldId))throw new ApiError(422,'DATASET_FIELD_DELETE_PROTECTED','身份、来源及既有真值字段不能删除。');
      const rowId=snapshot.rowIds[index]!,record={...existing};delete record[input.fieldId];
      operations.push({op:'update',rowId,record,expectedContentHash:snapshot.contentHashes[rowId]});
    }
    const parsed:DatasetSaveInput={ref:input.ref,expectedCommit:input.expectedCommit,message:input.message,operations};
    await this.authorizeOperations(key,identity,input.ref,operations,snapshot);
    await concurrentMap(operations,async operation=>{
      if(operation.op!=='update')return;
      const previous=await storedJson(this.provider,key,snapshot.commitId,rowRecordPath(operation.rowId)) as RowRecord|undefined;
      writes.set(rowRecordPath(operation.rowId),jsonBuffer({version:1,rowId:operation.rowId,op:'upsert',record:operation.record,isNew:previous?.isNew??false,...(previous?.isNew?{}:{baseHash:previous?.baseHash??snapshot.contentHashes[operation.rowId]}),actor,createdAt:previous?.createdAt??snapshot.rowActivity?.[operation.rowId]?.createdAt??now,updatedAt:now} satisfies RowRecord));
    });
    const descriptor={...snapshot.descriptor,fields:input.fields};
    if(operations.length&&!await optionalRaw(this.provider,key,snapshot.commitId,DATASET_FORMAT_PATH)){
      const evidence=datasetSourceEvidence.get(snapshot);if(!evidence)throw new ApiError(500,'DATASET_SOURCE_EVIDENCE_MISSING','缺少固定版本原始表证据，未删除字段。');
      writes.set(DATASET_FORMAT_PATH,jsonBuffer({version:1,storage:'sample-records-v1'}));
      descriptor.identityMapPath??=IDENTITY_PATH;
      writes.set(descriptor.identityMapPath,jsonBuffer({version:1,baselineSha256:evidence.sha256,rowIds:evidence.rowIds}));
    }
    writes.set(DATASET_DESCRIPTOR_PATH,jsonBuffer(descriptor));
    const projected=await new DatasetService(datasetOverlayProvider(this.provider,writes),this.options,datasetSourceEvidence.get(snapshot)).read(key,input.expectedCommit);
    assertDatasetFields(projected.rows,projected.rowIds,input.fields);
    await this.assertEvaluationSafety(key,projected);
    await this.assertFieldDeletionAllowed(key,identity,parsed,snapshot);
    return {baseline:snapshot,snapshot:projected,writes,input:parsed};
  }
  async assertFieldDeletionAllowed(key:RepoKey,identity:RequestIdentity,input:DatasetSaveInput,snapshot:DatasetSnapshot):Promise<void>{
    await this.authorizeOperations(key,identity,input.ref,input.operations,snapshot);
    await this.expected(key,input.ref,input.expectedCommit);
  }
  async save(key:RepoKey,identity:RequestIdentity,input:DatasetSaveInput):Promise<DatasetSnapshot>{
    return this.lock(key,async()=>{
      const plan=await this.plan(key,identity,input),{writes,input:parsed,baseline:snapshot}=plan;
      if(!writes.size)return snapshot;
      const workspace=await this.provider.createWorkspace(key,`Dataset ${randomUUID().slice(0,8)}`,parsed.ref);let committed=false;
      try{
        if(workspace.baseCommitId&&workspace.baseCommitId!==parsed.expectedCommit)throw new ApiError(409,'DATASET_VERSION_CONFLICT','工作区基准发生变化，未提交本地草稿。');
        await this.expected(key,parsed.ref,parsed.expectedCommit);
        if(this.provider.writeWorkspaceBatch)await this.provider.writeWorkspaceBatch(key,workspace.id,[...writes].map(([path,content])=>({path,content})));else for(const [filename,content]of writes)await this.provider.writeWorkspace(key,workspace.id,filename,content);
        await this.authorizeOperations(key,identity,parsed.ref,parsed.operations,snapshot);
        await this.expected(key,parsed.ref,parsed.expectedCommit);
        const commit=await this.provider.commitWorkspace(key,workspace.id,parsed.message,parsed.expectedCommit,async()=>{await this.authorizeOperations(key,identity,parsed.ref,parsed.operations,snapshot);await this.assertEvaluationSafety(key,plan.snapshot);await this.expected(key,parsed.ref,parsed.expectedCommit);});committed=true;
        const evaluationIds=new Set(parsed.operations.flatMap(op=>op.op==='evaluation'?op.rowIds:[]).filter(id=>canonicalJson(plan.snapshot.evaluation?.rows[id])!==canonicalJson(snapshot.evaluation?.rows[id])));if(evaluationIds.size)await this.options.onEvaluationCommitted?.(key,identity,evaluationIds.size,commit.id);
        return this.read(key,commit.id);
      }finally{if(committed)await this.provider.deleteWorkspace(key,workspace.id).catch(()=>{});}
    });
  }
  async appendImport(key:RepoKey,identity:RequestIdentity,input:DatasetInitializeInput,previewOnly=false):Promise<DatasetSnapshot>{
    return this.lock(key,async()=>{
      if(!input.rows.length)throw new ApiError(422,'DATASET_IMPORT_ROWS','请选择至少一个可导入的样本。');
      const ids=input.rowIds??stableRowIds(input.rows),operations=input.rows.map((record,index)=>({op:'append' as const,rowId:ids[index],record}));
      if(ids.length!==input.rows.length)throw new ApiError(422,'DATASET_IDENTITY_INVALID','导入身份数量与样本不一致。');
      const plan=await this.plan(key,identity,{ref:input.ref,expectedCommit:input.expectedCommit,message:input.message??`Append import (${input.rows.length} samples)`,operations},true),writes=plan.writes;
      const protectedPaths=new Set([plan.baseline.path,plan.baseline.readmePath].map(filename=>filename.normalize('NFC').toLowerCase())),seen=new Set<string>();
      for(const file of input.files??[]){const filename=safeFilePath(file.path),normalized=filename.normalize('NFC').toLowerCase();if(normalized.startsWith('.oxen')||protectedPaths.has(normalized)||seen.has(normalized))throw new ApiError(422,'DATASET_IMPORT_PATH','导入附件不能覆盖内部文件、README或规范样本入口。');seen.add(normalized);
        let directory='';const parts=filename.split('/');for(const [index,part]of parts.entries()){let entries;try{entries=await this.provider.tree(key,input.expectedCommit,directory);}catch(cause){if(cause instanceof ApiError&&cause.status===404)break;throw cause;}const item=entries.find(entry=>entry.name.normalize('NFC').toLowerCase()===part.normalize('NFC').toLowerCase());if(!item)break;if(item.name!==part||index===parts.length-1&&item.kind==='directory'||index<parts.length-1&&item.kind!=='directory')throw new ApiError(409,'DATASET_IMPORT_COLLISION','导入路径与现有文件或目录存在冲突。');directory=item.path;}
        const previous=await optionalRaw(this.provider,key,input.expectedCommit,filename);if(previous){if(!previous.content.equals(file.content))throw new ApiError(409,'DATASET_IMPORT_EXISTS','导入附件不能替换现有文件。');continue;}writes.set(filename,file.content);
      }
      const descriptor={...plan.snapshot.descriptor,attachmentFields:[...new Set([...plan.snapshot.descriptor.attachmentFields,...input.descriptor?.attachmentFields??[]])]};writes.set(DATASET_DESCRIPTOR_PATH,jsonBuffer(descriptor));
      const projected=await new DatasetService(datasetOverlayProvider(this.provider,writes),this.options,datasetSourceEvidence.get(plan.baseline)).read(key,input.expectedCommit);
      if(previewOnly)return projected;
      await this.authorizeImport(key,identity,plan.input);await this.expected(key,input.ref,input.expectedCommit);
      const workspace=await this.provider.createWorkspace(key,`Dataset append ${randomUUID().slice(0,8)}`,input.ref);let committed=false;
      try{if(workspace.baseCommitId&&workspace.baseCommitId!==input.expectedCommit)throw new ApiError(409,'DATASET_VERSION_CONFLICT','导入基点已变化，未提交。');if(this.provider.writeWorkspaceBatch)await this.provider.writeWorkspaceBatch(key,workspace.id,[...writes].map(([path,content])=>({path,content})));else for(const [filename,content]of writes)await this.provider.writeWorkspace(key,workspace.id,filename,content);await this.authorizeImport(key,identity,plan.input);await this.expected(key,input.ref,input.expectedCommit);const commit=await this.provider.commitWorkspace(key,workspace.id,plan.input.message,input.expectedCommit);committed=true;return this.read(key,commit.id);}finally{if(committed)await this.provider.deleteWorkspace(key,workspace.id).catch(()=>{});}
    });
  }
  async initialize(key:RepoKey,identity:RequestIdentity,input:DatasetInitializeInput,previewOnly=false):Promise<DatasetSnapshot>{
    return this.lock(key,async()=>{
      await this.expected(key,input.ref,input.expectedCommit);
      if(await optionalRaw(this.provider,key,input.expectedCommit,DATASET_DESCRIPTOR_PATH)||await optionalRaw(this.provider,key,input.expectedCommit,'bundle-manifest.json'))throw new ApiError(409,'DATASET_ALREADY_CONFIGURED','不能用初始化覆盖已有托管数据集。');
      if(input.rows.length>MAX_ROWS)throw new ApiError(422,'DATASET_IMPORT_ROWS','数据集最多支持 250000 个样本。');
      const filename=safeFilePath(input.path??'data/samples.jsonl');if(!/\.(jsonl|ndjson)$/i.test(filename)||filename.toLowerCase().startsWith('.oxen'))throw new ApiError(422,'DATASET_IMPORT_PATH','规范入口必须是普通 JSONL 路径。');
      if(await optionalRaw(this.provider,key,input.expectedCommit,filename))throw new ApiError(409,'DATASET_IMPORT_EXISTS','初始化不能覆盖现有数据文件，请使用显式迁移或样本编辑。');
      const content=Buffer.from(input.rows.map(record=>JSON.stringify(record)).join('\n')+(input.rows.length?'\n':'')),parsed=parseDatasetJsonl(content),ids=input.rowIds??parsed.rowIds;
      if(ids.length!==input.rows.length||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!id||id.length>200))throw new ApiError(422,'DATASET_IDENTITY_INVALID','导入身份必须逐条对应且唯一。');
      const descriptor=descriptorSchema.parse({version:1,id:`${key.namespace}/${key.repo}`,name:key.repo,canonicalPath:filename,readmePath:'README.md',identityField:'id',attachmentFields:['package_path','image','image_path','file','file_path'],source:'descriptor',...input.descriptor,...(Object.keys(this.predefinedFieldMetadata()).length?{fields:{...input.descriptor?.fields,...this.predefinedFieldMetadata()}}:{}),identityMapPath:IDENTITY_PATH});
      assertDatasetFields(input.rows,ids,descriptor.fields);
      if(descriptor.canonicalPath!==filename)throw new ApiError(422,'DATASET_IMPORT_PATH','描述与实际规范入口不一致。');
      if(descriptor.readmePath.toLowerCase().startsWith('.oxen')||descriptor.readmePath.toLowerCase()===filename.toLowerCase())throw new ApiError(422,'DATASET_IMPORT_PATH','README 不能覆盖内部策略或规范样本入口。');
      if(identity.kind==='guest')throw new ApiError(401,'AUTH_REQUIRED','请登录后导入。');if(this.options.authorize)await this.options.authorize(key,identity,'edit-content');else if(identity.kind!=='owner')throw new ApiError(403,'DATASET_PERMISSION_REQUIRED','数据集导入需要明确授权。');
      await this.options.beforeWrite?.(key,identity,input.ref,ids,'edit-content',{operations:[]});
      const files=new Map<string,Buffer>();
      const seen=new Set<string>();
      for(const file of input.files??[]){const target=safeFilePath(file.path),normalized=target.normalize('NFC').toLowerCase();if(normalized.startsWith('.oxen')||normalized===filename.normalize('NFC').toLowerCase()||normalized===descriptor.readmePath.normalize('NFC').toLowerCase()||seen.has(normalized))throw new ApiError(422,'DATASET_IMPORT_PATH','导入附件路径与受保护文件冲突。');seen.add(normalized);if(await optionalRaw(this.provider,key,input.expectedCommit,target))throw new ApiError(409,'DATASET_IMPORT_EXISTS','初始化附件不能覆盖仓库中已有文件。');files.set(target,file.content);}
      const importedAt=new Date().toISOString();files.set(DATASET_ACTIVITY_PATH,jsonBuffer({version:1,baselineSha256:createHash('sha256').update(content).digest('hex'),initial:{createdAt:importedAt,updatedAt:importedAt,actor:{id:identity.id,name:identity.name},kind:'import'},rows:{}}));
      files.set(filename,content);files.set(DATASET_DESCRIPTOR_PATH,jsonBuffer(descriptor));files.set(IDENTITY_PATH,jsonBuffer({version:1,baselineSha256:createHash('sha256').update(content).digest('hex'),rowIds:ids}));files.set(DATASET_FORMAT_PATH,jsonBuffer({version:1,storage:'sample-records-v1'}));
      if(input.readme!==undefined)files.set(descriptor.readmePath,Buffer.from(input.readme));
      if(input.labels){const previous=await this.labels.readLegacy(key,input.expectedCommit),columns=[...previous.columns],assignments=[...previous.assignments];for(const column of input.labels.columns){const old=columns.find(item=>item.id===column.id);if(old&&canonicalJson(old)!==canonicalJson(column))throw new ApiError(409,'DATASET_IMPORT_SCHEMA_CONFLICT','导入规范与现有标签定义冲突，未覆盖原定义。');if(!old)columns.push(column);}for(const assignment of input.labels.assignments){const old=assignments.find(item=>targetKey(item)===targetKey(assignment));if(old&&canonicalJson(old.values)!==canonicalJson(assignment.values))throw new ApiError(409,'DATASET_IMPORT_LABEL_CONFLICT','导入标签与现有赋值冲突，未覆盖原赋值。');if(!old)assignments.push(assignment);}files.set('.oxenweb/labels.json',jsonBuffer(validateLabelDocument({...input.labels,columns,assignments,...(previous.legacyMigration?{legacyMigration:previous.legacyMigration}:{})})));}
      if(previewOnly)return new DatasetService(datasetOverlayProvider(this.provider,files),this.options).read(key,input.expectedCommit);
      await this.markGlobalFieldsAdoption(key,descriptor.fields);
      const workspace=await this.provider.createWorkspace(key,`Dataset import ${randomUUID().slice(0,8)}`,input.ref);let committed=false;
      try{if(workspace.baseCommitId&&workspace.baseCommitId!==input.expectedCommit)throw new ApiError(409,'DATASET_VERSION_CONFLICT','导入基准已更新。');if(this.provider.writeWorkspaceBatch)await this.provider.writeWorkspaceBatch(key,workspace.id,[...files].map(([path,content])=>({path,content})));else for(const [target,data]of files)await this.provider.writeWorkspace(key,workspace.id,target,data);await this.options.beforeWrite?.(key,identity,input.ref,ids,'edit-content',{operations:[]});await this.expected(key,input.ref,input.expectedCommit);const commit=await this.provider.commitWorkspace(key,workspace.id,input.message??`Import dataset (${ids.length} samples)`,input.expectedCommit);committed=true;return this.read(key,commit.id);}finally{if(committed)await this.provider.deleteWorkspace(key,workspace.id).catch(()=>{});}
    });
  }
}
