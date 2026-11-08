import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DatasetLabelRecord } from '../../../packages/shared/src/dataset.js';
import type { ProjectSchemaState } from '../../../packages/shared/src/governance-types.js';
import type { DatasetCapability, RequestIdentity } from '../../../packages/shared/src/index.js';
import type { ProjectLabelSaveInput, ProjectLabelState, ProjectLabelValues } from '../../../packages/shared/src/project-label-types.js';
import type { Provider, RepoKey } from './provider.js';
import { ApiError } from './errors.js';
import { getBindingColumns, getBindingSnapshot, validateGovernedAssignment } from './governance.js';
import { recordUsesActiveLayer } from './dataset-layer-compat.js';
import { DATASET_LABELS_PATH, readDatasetLabelAuthority } from './dataset-label-summary.js';
import { canonicalJson, labelFingerprint, optionalRaw } from './dataset-storage.js';
import { REPOSITORY_POLICY_PATH } from './repository-settings.js';
import { assignmentId, validateLabelDocument } from './labels.js';
import { safeRef } from './safety.js';

export const PROJECT_LABEL_REF = 'main' as const;
const value=z.union([z.string().max(8000),z.array(z.string().max(120)).max(200)]);
export const projectLabelSaveSchema=z.object({expectedCommit:z.string().min(1).max(160).transform(safeRef),values:z.record(z.string().min(1).max(100),value.nullable()),message:z.string().trim().min(1).max(4000).optional()}).strict();
export async function readMainProjectKeywords(provider:Provider,key:RepoKey,commitId:string):Promise<string[]>{
  const raw=await optionalRaw(provider,key,commitId,REPOSITORY_POLICY_PATH);if(!raw)return [];
  if(raw.content.length>1024*1024)throw new ApiError(413,'PROJECT_KEYWORDS_LIMIT','main 项目元数据超过1MiB，未改用其他分支关键词。');
  try{return [...new Set(z.object({tags:z.array(z.string().trim().min(1).max(60)).max(20)}).parse(JSON.parse(raw.content.toString('utf8'))).tags)];}
  catch{throw new ApiError(422,'PROJECT_KEYWORDS_INVALID','main 项目关键词格式无效，未改用其他分支元数据。');}
}
export interface ProjectLabelOptions {
  provider:Provider;
  access:{requireCapability:(key:RepoKey,identity:RequestIdentity,capability:DatasetCapability)=>Promise<unknown>};
  readBinding:(key:RepoKey,commitId:string)=>Promise<ProjectSchemaState>;
}

/** Main is the sole project label authority. This never reads or commits sample drafts. */
export class ProjectLabelService {
  private chains=new Map<string,Promise<void>>();
  constructor(readonly options:ProjectLabelOptions){}
  private serial<T>(key:RepoKey,work:()=>Promise<T>):Promise<T>{const id=key.namespace+'/'+key.repo,result=(this.chains.get(id)??Promise.resolve()).then(work),done=result.then(()=>{},()=>{});this.chains.set(id,done);void done.then(()=>{if(this.chains.get(id)===done)this.chains.delete(id);});return result;}
  private async head(key:RepoKey){return (await this.options.provider.branches(key)).find(item=>item.name===PROJECT_LABEL_REF)?.commitId;}
  private async mayEdit(key:RepoKey,identity:RequestIdentity){try{if(identity.kind==='guest')return false;await this.options.access.requireCapability(key,identity,'dataset.assign');return true;}catch(cause){if(cause instanceof ApiError&&[401,403].includes(cause.status))return false;throw cause;}}
  private normalize(state:ProjectLabelState,input:Record<string,string|string[]|null>,retained=false):ProjectLabelValues{
    const values:ProjectLabelValues={};
    for(const [id,raw]of Object.entries(input)){
      if(!state.columns.some(column=>column.id===id))throw new ApiError(422,'LABEL_UNKNOWN_COLUMN','项目标签维度不属于 main 当前的数据集模板。');
      if(raw===null||raw===''||Array.isArray(raw)&&!raw.length)continue;
      values[id]=Array.isArray(raw)?[...new Set(raw)]:raw;
    }
    const target={scope:'dataset' as const};
    validateLabelDocument({version:1,columns:state.columns,assignments:[{...target,id:assignmentId(target),values}]});
    if(state.template)validateGovernedAssignment(state.template,'dataset',values,retained?values:state.values);
    return values;
  }
  private async fixed(key:RepoKey,identity:RequestIdentity,commitId:string):Promise<ProjectLabelState>{
    const keywords=await readMainProjectKeywords(this.options.provider,key,commitId);
    const state=await this.options.readBinding(key,commitId);
    if(state.commitId!==commitId)throw new ApiError(409,'PROJECT_LABELS_VERSION_MISMATCH','项目标签规范没有固定到 main 提交。');
    const binding=state.binding?.version===2?state.binding:undefined,template=binding?.layers.dataset?getBindingSnapshot(binding,'dataset'):undefined;
    if(!template)return {ref:PROJECT_LABEL_REF,commitId,state:'unconfigured',columns:[],values:{},keywords,capabilities:{edit:false}};
    const columns=getBindingColumns(binding,'dataset'),record=await readDatasetLabelAuthority(this.options.provider,key,commitId),selected=record&&recordUsesActiveLayer(record,binding)?record:undefined;
    const initial:ProjectLabelState={ref:PROJECT_LABEL_REF,commitId,state:'unassigned',columns,template,values:{},keywords,capabilities:{edit:false}},values=this.normalize(initial,selected?.values??{},true);
    return {...initial,state:Object.keys(values).length?'ready':'unassigned',values,capabilities:{edit:await this.mayEdit(key,identity)},...(selected?{updatedBy:selected.actor,updatedAt:selected.updatedAt}:{})};
  }
  async read(key:RepoKey,identity:RequestIdentity):Promise<ProjectLabelState>{
    await this.options.access.requireCapability(key,identity,'read');const commitId=await this.head(key);
    return commitId?this.fixed(key,identity,commitId):{ref:PROJECT_LABEL_REF,state:'missing-main',columns:[],values:{},keywords:[],capabilities:{edit:false}};
  }
  private async expected(key:RepoKey,identity:RequestIdentity,expectedCommit:string){
    await this.options.access.requireCapability(key,identity,'dataset.assign');await this.options.access.requireCapability(key,identity,'read');
    if(identity.kind==='guest')throw new ApiError(401,'AUTH_REQUIRED','请登录后保存项目标签。');
    const commitId=await this.head(key);
    if(!commitId)throw new ApiError(409,'PROJECT_LABELS_MAIN_REQUIRED','项目没有 main 分支，请先建立 main；不会改用其他分支。');
    if(commitId!==expectedCommit)throw new ApiError(409,'PROJECT_LABELS_VERSION_CONFLICT','main 已有新提交，当前输入仍保留，请重新核对 main 版本。',{expectedCommit,actualCommit:commitId});
  }
  save(key:RepoKey,identity:RequestIdentity,input:ProjectLabelSaveInput):Promise<ProjectLabelState>{
    const parsed=projectLabelSaveSchema.parse(input);
    return this.serial(key,async()=>{
      await this.expected(key,identity,parsed.expectedCommit);
      const state=await this.fixed(key,identity,parsed.expectedCommit);
      if(!state.template)throw new ApiError(409,'PROJECT_LABELS_TEMPLATE_REQUIRED','请先为 main 采用已发布的数据集标签模板。');
      const values=this.normalize(state,parsed.values);
      if(canonicalJson(values)===canonicalJson(state.values))return state;
      const binding=(await this.options.readBinding(key,state.commitId!)).binding,record:DatasetLabelRecord={version:1,scope:'dataset',actor:{id:identity.id,name:identity.name},values,spans:[],steps:[],sourceCommitId:state.commitId!,updatedAt:new Date().toISOString(),fingerprint:'',templateSnapshot:{columns:state.columns,binding}};
      record.fingerprint=labelFingerprint(record);
      const workspace=await this.options.provider.createWorkspace(key,'Project labels '+randomUUID().slice(0,8),PROJECT_LABEL_REF);let committedId:string|undefined;
      try{
        if(workspace.baseCommitId&&workspace.baseCommitId!==state.commitId)throw new ApiError(409,'PROJECT_LABELS_VERSION_CONFLICT','项目标签工作区基点已经变化。');
        await this.options.provider.writeWorkspace(key,workspace.id,DATASET_LABELS_PATH,Buffer.from(JSON.stringify(record,null,2)+'\n'));
        await this.expected(key,identity,parsed.expectedCommit);
        const latest=await this.options.readBinding(key,parsed.expectedCommit);
        if(getBindingSnapshot(latest.binding,'dataset')?.checksum!==state.template.checksum)throw new ApiError(409,'PROJECT_LABELS_SCHEMA_CHANGED','main 数据集模板已经变化，未保存项目标签。');
        committedId=(await this.options.provider.commitWorkspace(key,workspace.id,parsed.message??'更新项目标签',state.commitId)).id;
      }finally{await this.options.provider.deleteWorkspace(key,workspace.id).catch(()=>{});}
      return this.fixed(key,identity,committedId!);
    });
  }
}
