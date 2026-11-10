import type { DatasetFieldMetadata } from '../../../packages/shared/src/field-metadata.js';
import type { DatasetFieldsSaveInput, DatasetFieldsState, DatasetFieldSummary, DatasetFieldDeleteInput } from '../../../packages/shared/src/dataset-field-types.js';
import type { DatasetSnapshot } from '../../../packages/shared/src/dataset.js';
import type { DatasetCapability, RequestIdentity } from '../../../packages/shared/src/index.js';
import type { Provider, RepoKey } from './provider.js';
import { z } from 'zod';
import { safeRef } from './safety.js';
import { DATASET_DESCRIPTOR_PATH, DatasetService } from './dataset.js';
import { assertDatasetFields, datasetFieldsSchema } from './dataset-field-schema.js';
import { canonicalJson } from './dataset-storage.js';
import { protectedSourceFieldIds } from '../../../packages/shared/src/source-record.js';
import { datasetValueType, semanticDatasetFields } from '../../../packages/shared/src/field-metadata.js';
import { orderDatasetFields } from '../../../packages/shared/src/field-order.js';
import { inferColumns } from './jsonl.js';
import { ApiError } from './errors.js';
import { GLOBAL_DATASET_FIELD_IDS, isGlobalDatasetField } from '../../../packages/shared/src/global-fields.js';

export const datasetFieldsSaveSchema=z.object({ref:z.string().min(1).max(160).transform(safeRef),expectedCommit:z.string().min(1).max(160).transform(safeRef),fields:datasetFieldsSchema,message:z.string().trim().min(1).max(4000).optional()}).strict();
export const datasetFieldDeleteSchema=z.object({ref:z.string().min(1).max(160).transform(safeRef),expectedCommit:z.string().min(1).max(160).transform(safeRef),fieldId:z.string().min(1).max(500),confirmFieldId:z.string().min(1).max(500),message:z.string().trim().min(1).max(4000).optional()}).strict();
export interface DatasetFieldsOptions {
  globalFields?:()=>Record<string,DatasetFieldMetadata>;
  provider:Provider; datasets:DatasetService;
  access:{requireCapability:(key:RepoKey,identity:RequestIdentity,capability:DatasetCapability)=>Promise<unknown>};
  beforeSave?:(key:RepoKey,identity:RequestIdentity,branch:string,snapshot:DatasetSnapshot,fields:Record<string,DatasetFieldMetadata>,presentationOnly:boolean)=>Promise<void>;
}
export class DatasetFieldsService {
  private chains=new Map<string,Promise<void>>();
  constructor(readonly options:DatasetFieldsOptions){}
  private serial<T>(key:RepoKey,work:()=>Promise<T>):Promise<T>{const id=key.namespace+'/'+key.repo,result=(this.chains.get(id)??Promise.resolve()).then(work),done=result.then(()=>{},()=>{});this.chains.set(id,done);void done.then(()=>{if(this.chains.get(id)===done)this.chains.delete(id);});return result;}
  private async editable(key:RepoKey,identity:RequestIdentity,ref:string,commitId:string){try{if(identity.kind==='guest')return false;await this.options.access.requireCapability(key,identity,'schema.bind');return (await this.options.provider.branches(key)).some(branch=>branch.name===ref&&branch.commitId===commitId);}catch(cause){if(cause instanceof ApiError&&[401,403].includes(cause.status))return false;throw cause;}}
  private async state(key:RepoKey,identity:RequestIdentity,ref:string,snapshot:DatasetSnapshot):Promise<DatasetFieldsState>{
    const configuration=snapshot.descriptor.fields??{},inferred=inferColumns(snapshot.rows),ids=[...new Set([...inferred.map(column=>column.name),...Object.keys(configuration)])],fields:DatasetFieldSummary[]=ids.map(id=>({id,inferredType:inferred.find(column=>column.name===id)?.dtype??'missing',...(Object.hasOwn(configuration,id)?{configured:configuration[id]}:{}),present:0,missing:0,nulls:0,observedTypes:Object.create(null)}));
    const activeGlobal=this.options.globalFields?Object.keys(this.options.globalFields()):[...GLOBAL_DATASET_FIELD_IDS],retired=Object.entries(configuration).filter(([id,rules])=>(rules.globalField||isGlobalDatasetField(id))&&!activeGlobal.includes(id)).map(([id])=>id);
    const protectedFields=new Set<string>([snapshot.descriptor.identityField,'id','uid','__bundle_provenance',...activeGlobal,...snapshot.descriptor.attachmentFields]);
    for(const row of snapshot.rows){for(const id of protectedSourceFieldIds(row,snapshot.descriptor.identityField))protectedFields.add(id);for(const field of fields){if(!Object.hasOwn(row,field.id)){field.missing++;continue;}field.present++;if(row[field.id]===null)field.nulls++;const type=datasetValueType(row[field.id]);field.observedTypes[type]=(field.observedTypes[type]??0)+1;}}
    const edit=await this.editable(key,identity,ref,snapshot.commitId);let mayDelete=edit;
    if(mayDelete)try{await this.options.access.requireCapability(key,identity,'data.edit');}catch(cause){if(cause instanceof ApiError&&[401,403].includes(cause.status))mayDelete=false;else throw cause;}
    return {ref,commitId:snapshot.commitId,path:snapshot.path,totalRows:snapshot.totalRows,configuration,fields:orderDatasetFields(fields,configuration),protectedFields:[...protectedFields],globalFields:{active:activeGlobal,retired},capabilities:{edit,delete:mayDelete}};
  }
  async read(key:RepoKey,identity:RequestIdentity,ref:string):Promise<DatasetFieldsState>{await this.options.access.requireCapability(key,identity,'read');const snapshot=await this.options.datasets.read(key,safeRef(ref));return this.state(key,identity,ref,snapshot);}
  delete(key:RepoKey,identity:RequestIdentity,input:DatasetFieldDeleteInput):Promise<DatasetFieldsState>{const parsed=datasetFieldDeleteSchema.parse(input);return this.serial(key,async()=>{
    const authorize=async()=>{if(identity.kind==='guest')throw new ApiError(401,'AUTH_REQUIRED','请登录后删除样本字段。');for(const capability of ['read','schema.bind','data.edit'] as const)await this.options.access.requireCapability(key,identity,capability);};
    await authorize();await this.options.datasets.assertDraftHead(key,parsed.ref,parsed.expectedCommit);
    const snapshot=await this.options.datasets.read(key,parsed.expectedCommit),current=await this.state(key,identity,parsed.ref,snapshot);
    if(parsed.confirmFieldId!==parsed.fieldId)throw new ApiError(422,'DATASET_FIELD_DELETE_CONFIRM','请输入完全相同的字段 ID 确认删除。');
    if(!current.fields.some(field=>field.id===parsed.fieldId))throw new ApiError(404,'DATASET_FIELD_NOT_FOUND','当前版本不存在此样本字段。');
    if(current.protectedFields.includes(parsed.fieldId))throw new ApiError(422,'DATASET_FIELD_DELETE_PROTECTED','全局预置字段、身份、来源、附件引用及既有真值字段不能删除。');
    const fields={...snapshot.descriptor.fields};delete fields[parsed.fieldId];
    await this.options.beforeSave?.(key,identity,parsed.ref,snapshot,fields,false);
    const plan=await this.options.datasets.planFieldDeletion(key,identity,{...parsed,fields,message:parsed.message??`删除样本字段 ${parsed.fieldId}`});
    const recheck=async()=>{await authorize();await this.options.beforeSave?.(key,identity,parsed.ref,snapshot,fields,false);await this.options.datasets.assertFieldDeletionAllowed(key,identity,plan.input,snapshot);await this.options.datasets.assertEvaluationSafety(key,plan.snapshot);};
    const workspace=await this.options.provider.createWorkspace(key,'Delete sample field',parsed.ref);let commitId:string|undefined;
    try{
      if(workspace.baseCommitId&&workspace.baseCommitId!==parsed.expectedCommit)throw new ApiError(409,'DATASET_VERSION_CONFLICT','字段删除工作区基点已经变化。');
      await recheck();
      if(this.options.provider.writeWorkspaceBatch)await this.options.provider.writeWorkspaceBatch(key,workspace.id,[...plan.writes].map(([path,content])=>({path,content})));else for(const [path,content]of plan.writes)await this.options.provider.writeWorkspace(key,workspace.id,path,content);
      await recheck();commitId=(await this.options.provider.commitWorkspace(key,workspace.id,plan.input.message,parsed.expectedCommit,recheck)).id;
    }finally{await this.options.provider.deleteWorkspace(key,workspace.id).catch(()=>{});}
    return this.state(key,identity,parsed.ref,await this.options.datasets.read(key,commitId!));
  });}
  save(key:RepoKey,identity:RequestIdentity,input:DatasetFieldsSaveInput):Promise<DatasetFieldsState>{const parsed=datasetFieldsSaveSchema.parse(input);return this.serial(key,async()=>{
    await this.options.access.requireCapability(key,identity,'read');await this.options.access.requireCapability(key,identity,'schema.bind');if(identity.kind==='guest')throw new ApiError(401,'AUTH_REQUIRED','请登录后维护样本字段。');
    await this.options.datasets.assertDraftHead(key,parsed.ref,parsed.expectedCommit);const snapshot=await this.options.datasets.read(key,parsed.expectedCommit);
    if(this.options.globalFields){
      const latest=this.options.globalFields(),withoutPresentation=(field:DatasetFieldMetadata)=>{const {width:_width,order:_order,export:_export,visible:_visible,...rules}=field;return rules;};
      for(const id of Object.keys(latest)){
        const previous=snapshot.descriptor.fields?.[id],next=parsed.fields[id];
        if(previous&&!next)throw new ApiError(422,'GLOBAL_FIELD_REQUIRED',`活动全局字段 ${id} 不能从项目中移除；管理员需先在全局目录退出该字段。`);
        if(next&&canonicalJson(withoutPresentation(next))!==canonicalJson(withoutPresentation(latest[id]!))&&(!previous||canonicalJson(withoutPresentation(next))!==canonicalJson(withoutPresentation(previous))))throw new ApiError(403,'GLOBAL_FIELD_MANAGED',`字段 ${id} 的类型、选项和释义由全局字段管理维护；请同步已发布规范。`);
      }
      for(const [id,next] of Object.entries(parsed.fields))if(next.globalField){
        const previous=snapshot.descriptor.fields?.[id];
        if(next.globalField.id!==id||canonicalJson(next.globalField)!==canonicalJson(previous?.globalField)&&canonicalJson(next.globalField)!==canonicalJson(latest[id]?.globalField))throw new ApiError(403,'GLOBAL_FIELD_ORIGIN_INVALID','不能自行创建或改写全局字段来源；请采用目录中已发布的定义。');
      }
      for(const [id,previous] of Object.entries(snapshot.descriptor.fields??{}))if((previous.globalField||isGlobalDatasetField(id))&&(!parsed.fields[id]||previous.globalField&&canonicalJson(parsed.fields[id]!.globalField)!==canonicalJson(previous.globalField)&&!Object.hasOwn(latest,id)))throw new ApiError(422,'GLOBAL_FIELD_SNAPSHOT_REQUIRED',`字段 ${id} 的全局来源快照必须保留；若不再需要，请使用明确确认的“删除字段”操作。`);
    }
    if(canonicalJson(snapshot.descriptor.fields??{})===canonicalJson(parsed.fields))return this.state(key,identity,parsed.ref,snapshot);
    const presentationOnly=canonicalJson(semanticDatasetFields(snapshot.descriptor.fields))===canonicalJson(semanticDatasetFields(parsed.fields));
    await this.options.beforeSave?.(key,identity,parsed.ref,snapshot,parsed.fields,presentationOnly);
    assertDatasetFields(snapshot.rows,snapshot.rowIds,parsed.fields);
    await this.options.datasets.markGlobalFieldsAdoption(key,parsed.fields);
    const descriptor={...snapshot.descriptor,fields:parsed.fields},workspace=await this.options.provider.createWorkspace(key,'Configure sample fields',parsed.ref);let commitId:string|undefined;
    try{
      if(workspace.baseCommitId&&workspace.baseCommitId!==parsed.expectedCommit)throw new ApiError(409,'DATASET_VERSION_CONFLICT','字段配置工作区基点已经变化。');
      await this.options.provider.writeWorkspace(key,workspace.id,DATASET_DESCRIPTOR_PATH,Buffer.from(JSON.stringify(descriptor,null,2)+'\n'));
      await this.options.access.requireCapability(key,identity,'schema.bind');await this.options.access.requireCapability(key,identity,'read');
      await this.options.beforeSave?.(key,identity,parsed.ref,snapshot,parsed.fields,presentationOnly);await this.options.datasets.assertDraftHead(key,parsed.ref,parsed.expectedCommit);
      commitId=(await this.options.provider.commitWorkspace(key,workspace.id,parsed.message??'更新样本字段配置',parsed.expectedCommit)).id;
    }finally{await this.options.provider.deleteWorkspace(key,workspace.id).catch(()=>{});}
    return this.state(key,identity,parsed.ref,await this.options.datasets.read(key,commitId!));
  });}
}
