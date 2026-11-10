import {durableWriteFile} from './durable-store.js';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { DatasetDraft, DatasetDraftChange, DatasetDraftCommitInput, DatasetDraftDiff, DatasetDraftRebaseInput, DatasetDraftSaveInput, DatasetDraftState, DatasetDraftSummary, DatasetQueryInput, DatasetSnapshot } from '../../../packages/shared/src/dataset.js';
import type { ProjectSchemaBinding } from '../../../packages/shared/src/governance-types.js';
import type { RequestIdentity } from '../../../packages/shared/src/index.js';
import type { RepoKey } from './provider.js';
import { DatasetService, datasetOperationSchema } from './dataset.js';
import { canonicalJson, datasetHash } from './dataset-storage.js';
import { ApiError } from './errors.js';
import { safeRef } from './safety.js';
import { getBindingColumns, getBindingSnapshot } from './governance.js';
import { semanticDatasetFields } from '../../../packages/shared/src/field-metadata.js';

const MAX_DRAFT_BYTES=24*1024*1024;
const revision=z.number().int().nonnegative();
export const draftSaveSchema=z.object({ref:z.string().transform(safeRef),expectedCommit:z.string().transform(safeRef),draftRevision:revision,expectedDraftId:z.string().uuid().optional(),operations:z.array(datasetOperationSchema).min(1).max(500)}).strict();
export const draftCommitSchema=draftSaveSchema.omit({operations:true}).extend({expectedDraftId:z.string().uuid(),message:z.string().trim().min(1).max(4000)}).strict();
export const draftRefSchema=z.object({ref:z.string().transform(safeRef)}).strict();
export const draftDiscardSchema=draftRefSchema.extend({draftRevision:revision,expectedDraftId:z.string().uuid()}).strict();
export const draftRebaseSchema=z.object({ref:z.string().transform(safeRef),expectedBaseCommit:z.string().transform(safeRef),expectedCommit:z.string().transform(safeRef),draftRevision:revision,expectedDraftId:z.string().uuid().optional(),operations:z.array(datasetOperationSchema).max(500).optional()}).strict();
const storedSchema=z.object({version:z.literal(1),namespace:z.string(),repo:z.string(),owner:z.string(),draft:z.object({id:z.string().uuid(),ref:z.string().transform(safeRef),baseCommit:z.string().transform(safeRef),draftRevision:revision,schemaHash:z.string().regex(/^[a-f0-9]{64}$/),schemaHashes:z.object({dataset:z.string(),sample:z.string()}).strict(),createdAt:z.string(),updatedAt:z.string(),operationCount:revision,operations:z.array(datasetOperationSchema).min(1).max(500)}).strict()}).strict();
type Stored=z.infer<typeof storedSchema>;
function principal(identity:RequestIdentity){if(identity.kind==='guest')throw new ApiError(401,'AUTH_REQUIRED','请登录后使用私有本机草稿。');return `${identity.kind}:${identity.id}`;}
export function draftSummary(draft:DatasetDraft):DatasetDraftSummary{const {operations:_operations,...summary}=draft;return summary;}
export function datasetDraftSchemaHashes(snapshot:DatasetSnapshot){
  const binding=snapshot.binding as ProjectSchemaBinding|undefined,fields=semanticDatasetFields(snapshot.descriptor.fields);
  const layer=(scope:'dataset'|'row')=>datasetHash({snapshot:getBindingSnapshot(binding,scope)??null,columns:binding?getBindingColumns(binding,scope):snapshot.labels.columns.filter(column=>!column.scopes||column.scopes.includes(scope)),...(scope==='row'&&Object.keys(fields).length?{fields}:{})});
  return {dataset:layer('dataset'),sample:layer('row')};
}

/** Identity-isolated private BFF files. No provider mutation occurs until explicit commit(). */
export class DatasetDraftService {
  private chains=new Map<string,Promise<void>>();
  constructor(readonly datasets:DatasetService,readonly directory:string){}
  private folder(key:RepoKey,identity?:RequestIdentity){return path.join(path.resolve(this.directory),datasetHash(key),...(identity?[datasetHash(principal(identity))]:[]));}
  private filename(key:RepoKey,identity:RequestIdentity,ref:string){return path.join(this.folder(key,identity),datasetHash(safeRef(ref))+'.json');}
  private lock<T>(filename:string,work:()=>Promise<T>):Promise<T>{const result=(this.chains.get(filename)??Promise.resolve()).then(work),done=result.then(()=>{},()=>{});this.chains.set(filename,done);void done.then(()=>{if(this.chains.get(filename)===done)this.chains.delete(filename);});return result;}
  private async stored(key:RepoKey,identity:RequestIdentity,ref:string):Promise<Stored|undefined>{
    let raw:Buffer;try{raw=await readFile(this.filename(key,identity,ref));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}
    if(raw.length>MAX_DRAFT_BYTES)throw new ApiError(413,'DATASET_DRAFT_LIMIT','本机草稿超过支持上限，原文件已保留。');
    let value:Stored;try{value=storedSchema.parse(JSON.parse(raw.toString('utf8')));}catch{throw new ApiError(422,'DATASET_DRAFT_INVALID','本机草稿文件无效，未应用到数据集。');}
    if(value.namespace!==key.namespace||value.repo!==key.repo||value.owner!==principal(identity)||value.draft.ref!==ref||value.draft.operationCount!==value.draft.operations.length)throw new ApiError(422,'DATASET_DRAFT_INVALID','草稿身份、项目或分支不匹配。');
    return value;
  }
  private async persist(key:RepoKey,identity:RequestIdentity,draft:DatasetDraft){
    const filename=this.filename(key,identity,draft.ref),serialized=JSON.stringify({version:1,...key,owner:principal(identity),draft});
    if(Buffer.byteLength(serialized)>MAX_DRAFT_BYTES)throw new ApiError(413,'DATASET_DRAFT_LIMIT','本机草稿超过 24 MiB，当前编辑仍需保留。');
    await mkdir(path.dirname(filename),{recursive:true,mode:0o700});await durableWriteFile(filename,serialized);
  }
  private async validate(key:RepoKey,identity:RequestIdentity,draft:DatasetDraft){
    const plan=await this.datasets.plan(key,identity,{ref:draft.ref,expectedCommit:draft.baseCommit,message:'Validate private dataset draft',operations:draft.operations});
    if(datasetHash(datasetDraftSchemaHashes(plan.baseline))!==draft.schemaHash)throw new ApiError(409,'DATASET_DRAFT_SCHEMA_CHANGED','草稿采用的标签规范已改变，未应用草稿。');
    return plan;
  }
  async read(key:RepoKey,identity:RequestIdentity,ref:string):Promise<DatasetDraftState>{
    const stored=await this.stored(key,identity,safeRef(ref));if(!stored)return {};
    try{await this.validate(key,identity,stored.draft);return {draft:structuredClone(stored.draft)};}catch(error){if(!(error instanceof ApiError))throw error;return {summary:draftSummary(stored.draft),issue:{code:error.code,message:error.message}};}
  }
  /** Read authorization is performed by the route; stale base revisions do not hide the owner's backup. */
  async export(key:RepoKey,identity:RequestIdentity,ref:string):Promise<DatasetDraftState>{
    const stored=await this.stored(key,identity,safeRef(ref));
    if(!stored)throw new ApiError(404,'DATASET_DRAFT_NOT_FOUND','当前身份在此分支没有已保存的本机草稿。');
    return {draft:structuredClone(stored.draft)};
  }
  async rebase(key:RepoKey,identity:RequestIdentity,input:DatasetDraftRebaseInput):Promise<DatasetDraftState>{
    principal(identity);const parsed=draftRebaseSchema.parse(input),filename=this.filename(key,identity,parsed.ref);
    return this.lock(filename,async()=>{
      const current=await this.stored(key,identity,parsed.ref);
      if((current?.draft.draftRevision??0)!==parsed.draftRevision||parsed.draftRevision>0&&current?.draft.id!==parsed.expectedDraftId||parsed.draftRevision===0&&parsed.expectedDraftId!==undefined)throw new ApiError(409,'DATASET_DRAFT_REVISION_CONFLICT','本人草稿已在其他页面更新，未同步。');
      if(current&&current.draft.baseCommit!==parsed.expectedBaseCommit)throw new ApiError(409,'DATASET_DRAFT_BASE_CHANGED','同步基点与原草稿不匹配。');
      if(!current&&parsed.operations===undefined)throw new ApiError(404,'DATASET_DRAFT_NOT_FOUND','没有已保存或明确提供的本机草稿。');
      const operations=(parsed.operations??current!.draft.operations).map(operation=>operation.op==='append'&&!operation.rowId?{...operation,rowId:`new:${randomUUID()}`}:operation);
      if(operations.some(operation=>operation.op==='assign'&&operation.scope==='dataset'))throw new ApiError(409,'DATASET_DRAFT_REBASE_DATASET_ASSIGNMENT','项目标签须独立保存，不能同步含项目标签赋值的样本草稿。');
      await this.datasets.assertProjectLabelAdvance(key,parsed.ref,parsed.expectedBaseCommit,parsed.expectedCommit);
      const previous=await this.datasets.read(key,parsed.expectedBaseCommit),oldHash=datasetHash(datasetDraftSchemaHashes(previous));
      if(current&&current.draft.schemaHash!==oldHash)throw new ApiError(409,'DATASET_DRAFT_SCHEMA_CHANGED','原草稿的规范指纹不匹配，未同步。');
      const baseline=operations.length?(await this.datasets.plan(key,identity,{ref:parsed.ref,expectedCommit:parsed.expectedCommit,message:'Validate explicit presentation metadata synchronization',operations})).baseline:await this.datasets.read(key,parsed.expectedCommit);
      const schemaHashes=datasetDraftSchemaHashes(baseline),schemaHash=datasetHash(schemaHashes);
      if(schemaHash!==oldHash)throw new ApiError(409,'DATASET_DRAFT_SCHEMA_CHANGED','样本规则或项目模板已经变化，不能仅同步展示元数据。');
      if(previous.path!==baseline.path||canonicalJson(previous.rowIds)!==canonicalJson(baseline.rowIds)||datasetHash(previous.contentHashes)!==datasetHash(baseline.contentHashes))throw new ApiError(409,'DATASET_DRAFT_SOURCE_CHANGED','样本内容或稳定身份已经变化，草稿需要人工对照。');
      await this.datasets.assertDraftHead(key,parsed.ref,parsed.expectedCommit);
      if(!operations.length){if(current)await rm(filename);return {};}
      const now=new Date().toISOString(),draft:DatasetDraft={id:current?.draft.id??randomUUID(),ref:parsed.ref,baseCommit:parsed.expectedCommit,draftRevision:parsed.draftRevision+1,schemaHash,schemaHashes,createdAt:current?.draft.createdAt??now,updatedAt:now,operationCount:operations.length,operations};
      await this.persist(key,identity,draft);return {draft:structuredClone(draft)};
    });
  }
  async save(key:RepoKey,identity:RequestIdentity,input:DatasetDraftSaveInput):Promise<DatasetDraftState>{
    principal(identity);const parsed=draftSaveSchema.parse(input) as DatasetDraftSaveInput;
    return this.lock(this.filename(key,identity,parsed.ref),async()=>{
      const existing=await this.stored(key,identity,parsed.ref);
      if((existing?.draft.draftRevision??0)!==parsed.draftRevision||parsed.draftRevision>0&&existing?.draft.id!==parsed.expectedDraftId||parsed.draftRevision===0&&parsed.expectedDraftId!==undefined)throw new ApiError(409,'DATASET_DRAFT_REVISION_CONFLICT','本机草稿已被另一个页面更新，请重新加载；当前编辑尚未覆盖。');
      if(existing&&existing.draft.baseCommit!==parsed.expectedCommit)throw new ApiError(409,'DATASET_DRAFT_BASE_CHANGED','不能把旧草稿静默套用到其他基点，请先比较或显式放弃旧草稿。');
      const operations=parsed.operations.map(operation=>operation.op==='append'&&!operation.rowId?{...operation,rowId:`new:${randomUUID()}`}:operation);
      const plan=await this.datasets.plan(key,identity,{ref:parsed.ref,expectedCommit:parsed.expectedCommit,message:'Validate private dataset draft',operations});
      const schemaHashes=datasetDraftSchemaHashes(plan.baseline),schemaHash=datasetHash(schemaHashes);
      if(existing&&existing.draft.schemaHash!==schemaHash)throw new ApiError(409,'DATASET_DRAFT_SCHEMA_CHANGED','草稿规范已改变，保存被拒绝；原草稿仍保留。');
      const now=new Date().toISOString(),draft:DatasetDraft={id:existing?.draft.id??randomUUID(),ref:parsed.ref,baseCommit:parsed.expectedCommit,draftRevision:parsed.draftRevision+1,schemaHash,schemaHashes,createdAt:existing?.draft.createdAt??now,updatedAt:now,operationCount:operations.length,operations};
      await this.persist(key,identity,draft);return {draft:structuredClone(draft)};
    });
  }
  async page(key:RepoKey,identity:RequestIdentity,ref:string,input:DatasetQueryInput={},expectedRevision?:number,expectedDraftId?:string){
    const stored=await this.stored(key,identity,safeRef(ref));
    if(!stored){if(expectedRevision)throw new ApiError(409,'DATASET_DRAFT_REVISION_CONFLICT','本机草稿已改变，请重新加载。');const page=await this.datasets.page(key,ref,input);return {...page,...this.pageBase(page,page,identity)};}
    if(expectedRevision!==undefined&&(stored.draft.draftRevision!==expectedRevision||stored.draft.id!==expectedDraftId))throw new ApiError(409,'DATASET_DRAFT_REVISION_CONFLICT','本机草稿已被另一个页面更新，请重新加载。');
    const plan=await this.validate(key,identity,stored.draft),page=await this.datasets.pageSnapshot(key,plan.snapshot,input);
    return {...page,ref,draft:draftSummary(stored.draft),baseContentHashes:Object.fromEntries(page.rowIds.map(id=>[id,plan.baseline.contentHashes[id]!]).filter(([,hash])=>hash!==undefined)),...this.pageBase(plan.baseline,page,identity)};
  }
  private pageBase(baseline:DatasetSnapshot,page:Pick<DatasetSnapshot,'rowIds'|'attachments'>,identity:RequestIdentity){
    const shown=new Set(page.rowIds),source=new Map(baseline.rowIds.map((id,index)=>[id,baseline.rows[index]!]));
    const files=new Set([baseline.path,...page.attachments.filter(attachment=>attachment.rowIds.some(id=>shown.has(id))).map(attachment=>attachment.path)]);
    return {baseEvaluationRows:Object.fromEntries(page.rowIds.map(id=>[id,baseline.evaluation?.rows[id]??{visibility:null,suites:[],familyId:null}])),baseRows:Object.fromEntries(page.rowIds.filter(id=>source.has(id)).map(id=>[id,source.get(id)!])),baseOwnLabelRecords:Object.fromEntries(baseline.labelRecords.filter(record=>record.scope==='row'&&record.path===baseline.path&&record.actor.id===identity.id&&!!record.rowId&&shown.has(record.rowId)).map(record=>[record.rowId!,record])),baseOwnFileLabelRecords:Object.fromEntries(baseline.labelRecords.filter(record=>record.scope==='file'&&record.actor.id===identity.id&&!!record.path&&files.has(record.path)).map(record=>[record.path!,record]))};
  }
  async diff(key:RepoKey,identity:RequestIdentity,ref:string):Promise<DatasetDraftDiff|undefined>{
    const stored=await this.stored(key,identity,safeRef(ref));if(!stored)return undefined;const plan=await this.validate(key,identity,stored.draft);
    const changes:DatasetDraftChange[]=stored.draft.operations.map(operation=>{
      const id='rowId'in operation?operation.rowId:undefined,index=id?plan.baseline.rowIds.indexOf(id):-1;
      if(operation.op==='update'||operation.op==='delete'||operation.op==='append'){const before=index>=0?plan.baseline.rows[index]:undefined,after=operation.op==='delete'?undefined:operation.record;return {op:operation.op,rowId:id,fields:[...new Set([...Object.keys(before??{}),...Object.keys(after??{})])].filter(field=>canonicalJson(before?.[field])!==canonicalJson(after?.[field])),before,after};}
      if(operation.op==='assign'){const own=plan.baseline.labelRecords.find(item=>item.actor.id===identity.id&&item.scope===operation.scope&&(operation.scope!=='row'||item.rowId===operation.rowId)&&(operation.scope!=='file'||item.path===operation.path)),effective=plan.baseline.labels.assignments.find(item=>item.scope===operation.scope&&(operation.scope!=='row'||item.rowId===operation.rowId)&&(operation.scope!=='file'||item.path===operation.path));const before={values:operation.scope==='dataset'?effective?.values??{}:own?.values??{},spans:own?.spans??[],steps:own?.steps??[]};return {op:operation.op,scope:operation.scope,rowId:operation.rowId,path:operation.path,fields:[...Object.keys(operation.values),...(operation.spans?['片段']:[]),...(operation.steps?['步骤']:[])],before,after:{values:operation.values,spans:operation.spans??own?.spans??[],steps:operation.steps??own?.steps??[]}};}
      if(operation.op==='evaluation')return {op:operation.op,...(operation.rowIds.length===1?{rowId:operation.rowIds[0]}:{}),fields:Object.keys(operation.patch).map(field=>'evaluation.'+(field==='familyId'?'family_id':field)),before:Object.fromEntries(operation.rowIds.map(id=>[id,plan.baseline.evaluation?.rows[id]??{visibility:null,suites:[],familyId:null}])),after:Object.fromEntries(operation.rowIds.map(id=>[id,plan.snapshot.evaluation?.rows[id]]))};
      return {op:operation.op,fields:operation.op==='readme'?['README']:['反馈'],before:operation.op==='readme'?plan.baseline.readme:undefined,after:operation.op==='readme'?operation.content:operation.message};
    });return {draft:draftSummary(stored.draft),changes:changes.filter(change=>change.op!=='evaluation'||canonicalJson(change.before)!==canonicalJson(change.after))};
  }
  async commit(key:RepoKey,identity:RequestIdentity,input:DatasetDraftCommitInput){
    const parsed=draftCommitSchema.parse(input);
    return this.lock(this.filename(key,identity,parsed.ref),async()=>{
      const stored=await this.stored(key,identity,parsed.ref);
      if(!stored||stored.draft.draftRevision!==parsed.draftRevision||stored.draft.id!==parsed.expectedDraftId)throw new ApiError(409,'DATASET_DRAFT_REVISION_CONFLICT','本机草稿版本不匹配，未提交。');
      if(stored.draft.baseCommit!==parsed.expectedCommit)throw new ApiError(409,'DATASET_DRAFT_BASE_CHANGED','提交基点与本机草稿不匹配。');
      await this.validate(key,identity,stored.draft);
      // DatasetService performs fresh authorization and branch CAS again immediately before commit.
      const snapshot=await this.datasets.save(key,identity,{ref:parsed.ref,expectedCommit:parsed.expectedCommit,message:parsed.message,operations:stored.draft.operations});
      // If cleanup fails or the process exits after commit, the retained stale draft cannot commit
      // again: its immutable expected base no longer matches the branch head.
      await rm(this.filename(key,identity,parsed.ref),{force:true}).catch(()=>{});
      return {commitId:snapshot.commitId,path:snapshot.path,totalRows:snapshot.totalRows,rowIds:snapshot.rowIds,warnings:snapshot.warnings};
    });
  }
  async discard(key:RepoKey,identity:RequestIdentity,ref:string,expectedRevision:number,expectedDraftId:string){
    return this.lock(this.filename(key,identity,ref),async()=>{const stored=await this.stored(key,identity,ref);if(!stored||(stored.draft.draftRevision!==expectedRevision||stored.draft.id!==expectedDraftId))throw new ApiError(409,'DATASET_DRAFT_REVISION_CONFLICT','草稿版本已改变，未删除。');await rm(this.filename(key,identity,ref));return {discarded:true};});
  }
  async readActivity(key:RepoKey,identity?:RequestIdentity):Promise<{updatedAt?:string;draftCount:number}>{
    if(!identity||identity.kind==='guest')return {draftCount:0};let files:string[];try{files=await readdir(this.folder(key,identity));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {draftCount:0};throw error;}
    let updatedAt:string|undefined,draftCount=0;
    for(const filename of files.filter(filename=>/^[a-f0-9]{64}\.json$/.test(filename))){let value:Stored;try{value=storedSchema.parse(JSON.parse(await readFile(path.join(this.folder(key,identity),filename),'utf8')));}catch{continue;}if(value.namespace!==key.namespace||value.repo!==key.repo||value.owner!==principal(identity))continue;draftCount++;if(!updatedAt||value.draft.updatedAt>updatedAt)updatedAt=value.draft.updatedAt;}
    return {updatedAt,draftCount};
  }
}
