import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { DatasetUiJsonValue, DatasetUiState, DatasetUiStateDeleteInput, DatasetUiStateKind, DatasetUiStateResult, DatasetUiStateSaveInput } from '../../../packages/shared/src/dataset-ui-state.js';
import type { DatasetCapability, RequestIdentity } from '../../../packages/shared/src/index.js';
import type { RepoKey } from './provider.js';
import { datasetHash } from './dataset-storage.js';
import { ApiError } from './errors.js';
import { safeRef } from './safety.js';

const MAX_PAYLOAD=24*1024*1024;
const kind=z.enum(['workbench','field-settings','readme']);
const ref=z.string().transform(safeRef);
function isJson(value:unknown):value is DatasetUiJsonValue{
  const stack:Array<{value:unknown;depth:number}>=[{value,depth:0}],seen=new WeakSet<object>();let count=0;
  while(stack.length){const next=stack.pop()!;if(++count>2_000_000||next.depth>100)return false;const item=next.value;
    if(item===null||typeof item==='string'||typeof item==='boolean'||typeof item==='number'&&Number.isFinite(item))continue;
    if(typeof item!=='object'||!item||seen.has(item)||!Array.isArray(item)&&Object.getPrototypeOf(item)!==Object.prototype&&Object.getPrototypeOf(item)!==null)return false;
    seen.add(item);for(const child of Array.isArray(item)?item:Object.values(item))stack.push({value:child,depth:next.depth+1});
  }return true;
}
const payload=z.custom<DatasetUiJsonValue>(isJson,'检查点内容必须是有限深度的纯 JSON。').superRefine((value,context)=>{if(isJson(value)&&Buffer.byteLength(JSON.stringify(value))>MAX_PAYLOAD)context.addIssue({code:'custom',message:'界面检查点不能超过 24 MiB。'});});
export const uiStateQuerySchema=z.object({ref,kind}).strict();
export const uiStateSaveSchema=uiStateQuerySchema.extend({revision:z.number().int().nonnegative(),expectedId:z.string().uuid().optional(),baseCommit:ref.optional(),payload}).strict().superRefine((input,context)=>{if(input.revision===0&&input.expectedId!==undefined||input.revision>0&&!input.expectedId)context.addIssue({code:'custom',path:['expectedId'],message:'新建检查点不使用 ID，更新必须携带原 ID 与版本。'});});
export const uiStateDeleteSchema=uiStateQuerySchema.extend({revision:z.number().int().positive(),expectedId:z.string().uuid()}).strict();
const storedSchema=z.object({version:z.literal(1),namespace:z.string(),repo:z.string(),owner:z.string(),state:z.object({id:z.string().uuid(),ref,kind,revision:z.number().int().positive(),baseCommit:ref.optional(),payload,updatedAt:z.string()}).strict()}).strict();
interface Options { directory:string;access:{requireCapability:(key:RepoKey,identity:RequestIdentity,capability:DatasetCapability)=>Promise<unknown>} }
function principal(identity:RequestIdentity){if(identity.kind==='guest')throw new ApiError(401,'AUTH_REQUIRED','请登录后保存本人的界面检查点。');return `${identity.kind}:${identity.id}`;}

/** Opaque UI recovery state never grants mutation authority and never calls a provider or dataset plan. */
export class DatasetUiStateService {
  private chains=new Map<string,Promise<void>>();
  constructor(readonly options:Options){}
  private filename(key:RepoKey,identity:RequestIdentity,branch:string,type:DatasetUiStateKind){return path.join(path.resolve(this.options.directory),datasetHash(key),datasetHash(principal(identity)),datasetHash({ref:safeRef(branch),kind:type})+'.json');}
  private lock<T>(filename:string,work:()=>Promise<T>):Promise<T>{const result=(this.chains.get(filename)??Promise.resolve()).then(work),done=result.then(()=>{},()=>{});this.chains.set(filename,done);void done.then(()=>{if(this.chains.get(filename)===done)this.chains.delete(filename);});return result;}
  private async authorize(key:RepoKey,identity:RequestIdentity){principal(identity);await this.options.access.requireCapability(key,identity,'read');}
  private async mayCreate(key:RepoKey,identity:RequestIdentity,type:DatasetUiStateKind){
    const capabilities:DatasetCapability[]=type==='field-settings'?['schema.bind']:type==='readme'?['data.edit']:['data.edit','annotation.assign'];
    for(const capability of capabilities)try{await this.options.access.requireCapability(key,identity,capability);return;}catch(error){if(!(error instanceof ApiError)||error.status!==403)throw error;}
    throw new ApiError(403,'UI_STATE_CAPABILITY_REQUIRED','当前身份不能新建此类编辑检查点；本人已有检查点仍可取回或保留。');
  }
  private async stored(key:RepoKey,identity:RequestIdentity,branch:string,type:DatasetUiStateKind):Promise<DatasetUiState|undefined>{
    const filename=this.filename(key,identity,branch,type);let content:Buffer;
    try{if((await stat(filename)).size>MAX_PAYLOAD+4096)throw new ApiError(413,'UI_STATE_LIMIT','检查点文件超出上限，未删除原文件。');content=await readFile(filename);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}
    let parsed:z.infer<typeof storedSchema>;try{parsed=storedSchema.parse(JSON.parse(content.toString('utf8')));}catch{throw new ApiError(422,'UI_STATE_INVALID','本人界面检查点格式无效，原文件已保留。');}
    if(parsed.namespace!==key.namespace||parsed.repo!==key.repo||parsed.owner!==principal(identity)||parsed.state.ref!==branch||parsed.state.kind!==type)throw new ApiError(422,'UI_STATE_INVALID','检查点身份、项目、分支或类型不匹配。');
    return parsed.state;
  }
  async read(key:RepoKey,identity:RequestIdentity,branch:string,type:DatasetUiStateKind):Promise<DatasetUiStateResult>{await this.authorize(key,identity);const state=await this.stored(key,identity,safeRef(branch),kind.parse(type));return state?{state}:{};}
  async save(key:RepoKey,identity:RequestIdentity,input:DatasetUiStateSaveInput):Promise<DatasetUiStateResult>{
    const parsed=uiStateSaveSchema.parse(input),filename=this.filename(key,identity,parsed.ref,parsed.kind);return this.lock(filename,async()=>{
      await this.authorize(key,identity);const existing=await this.stored(key,identity,parsed.ref,parsed.kind);
      if((existing?.revision??0)!==parsed.revision||existing?.id!==parsed.expectedId)throw new ApiError(409,'UI_STATE_REVISION_CONFLICT','本人界面检查点已在另一个页面更新，当前输入未覆盖该版本。');
      if(!existing)await this.mayCreate(key,identity,parsed.kind);
      const state:DatasetUiState={id:existing?.id??randomUUID(),ref:parsed.ref,kind:parsed.kind,revision:parsed.revision+1,...(parsed.baseCommit?{baseCommit:parsed.baseCommit}:{}),payload:parsed.payload,updatedAt:new Date().toISOString()};
      const serialized=JSON.stringify({version:1,...key,owner:principal(identity),state});await mkdir(path.dirname(filename),{recursive:true,mode:0o700});const temporary=filename+'.'+randomUUID()+'.tmp';
      try{await writeFile(temporary,serialized,{encoding:'utf8',mode:0o600,flag:'wx'});await this.authorize(key,identity);if(!existing)await this.mayCreate(key,identity,parsed.kind);await rename(temporary,filename);}finally{await rm(temporary,{force:true}).catch(()=>{});}
      return {state:JSON.parse(JSON.stringify(state)) as DatasetUiState};
    });
  }
  async delete(key:RepoKey,identity:RequestIdentity,input:DatasetUiStateDeleteInput):Promise<DatasetUiStateResult>{const parsed=uiStateDeleteSchema.parse(input),filename=this.filename(key,identity,parsed.ref,parsed.kind);return this.lock(filename,async()=>{await this.authorize(key,identity);const existing=await this.stored(key,identity,parsed.ref,parsed.kind);if(!existing||existing.revision!==parsed.revision||existing.id!==parsed.expectedId)throw new ApiError(409,'UI_STATE_REVISION_CONFLICT','检查点已更新或清除，未删除其他版本。');await this.authorize(key,identity);await rm(filename);return {};});}
}
