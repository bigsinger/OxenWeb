import type { DatasetFieldMetadata } from '../../../packages/shared/src/field-metadata.js';
import type { DatasetFieldsSaveInput, DatasetFieldsState, DatasetFieldSummary } from '../../../packages/shared/src/dataset-field-types.js';
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
import { inferColumns } from './jsonl.js';
import { ApiError } from './errors.js';

export const datasetFieldsSaveSchema=z.object({ref:z.string().min(1).max(160).transform(safeRef),expectedCommit:z.string().min(1).max(160).transform(safeRef),fields:datasetFieldsSchema,message:z.string().trim().min(1).max(4000).optional()}).strict();
export interface DatasetFieldsOptions {
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
    const protectedFields=new Set<string>();
    for(const row of snapshot.rows){for(const id of protectedSourceFieldIds(row,snapshot.descriptor.identityField))protectedFields.add(id);for(const field of fields){if(!Object.hasOwn(row,field.id)){field.missing++;continue;}field.present++;if(row[field.id]===null)field.nulls++;const type=datasetValueType(row[field.id]);field.observedTypes[type]=(field.observedTypes[type]??0)+1;}}
    return {ref,commitId:snapshot.commitId,path:snapshot.path,totalRows:snapshot.totalRows,configuration,fields,protectedFields:[...protectedFields],capabilities:{edit:await this.editable(key,identity,ref,snapshot.commitId)}};
  }
  async read(key:RepoKey,identity:RequestIdentity,ref:string):Promise<DatasetFieldsState>{await this.options.access.requireCapability(key,identity,'read');const snapshot=await this.options.datasets.read(key,safeRef(ref));return this.state(key,identity,ref,snapshot);}
  save(key:RepoKey,identity:RequestIdentity,input:DatasetFieldsSaveInput):Promise<DatasetFieldsState>{const parsed=datasetFieldsSaveSchema.parse(input);return this.serial(key,async()=>{
    await this.options.access.requireCapability(key,identity,'read');await this.options.access.requireCapability(key,identity,'schema.bind');if(identity.kind==='guest')throw new ApiError(401,'AUTH_REQUIRED','请登录后维护样本字段。');
    await this.options.datasets.assertDraftHead(key,parsed.ref,parsed.expectedCommit);const snapshot=await this.options.datasets.read(key,parsed.expectedCommit);
    if(canonicalJson(snapshot.descriptor.fields??{})===canonicalJson(parsed.fields))return this.state(key,identity,parsed.ref,snapshot);
    const presentationOnly=canonicalJson(semanticDatasetFields(snapshot.descriptor.fields))===canonicalJson(semanticDatasetFields(parsed.fields));
    await this.options.beforeSave?.(key,identity,parsed.ref,snapshot,parsed.fields,presentationOnly);
    assertDatasetFields(snapshot.rows,snapshot.rowIds,parsed.fields);
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
