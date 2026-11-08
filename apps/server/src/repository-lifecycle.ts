import {randomUUID} from 'node:crypto';
import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import type {RepoSummary,RequestIdentity,RepositoryLifecycleState,RepositoryRemoveInput,RepositoryRestoreInput} from '../../../packages/shared/src/index.js';
import type {Provider,RepoKey} from './provider.js';
import type {RepositoryAccessService} from './repository-access.js';
import {datasetHash} from './dataset-storage.js';
import {ApiError} from './errors.js';

const entrySchema=z.object({namespace:z.string(),name:z.string(),id:z.string().uuid(),revision:z.number().int().positive(),removed:z.boolean(),removedAt:z.string(),removedBy:z.string(),displayName:z.string(),restoredAt:z.string().optional()}).strict();
type Entry=z.infer<typeof entrySchema>;
export const repositoryRemoveSchema=z.object({confirmation:z.string().max(250),expectedRevision:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const repositoryRestoreSchema=z.object({confirmation:z.string().max(250),removalId:z.string().uuid(),revision:z.number().int().positive()}).strict();
const id=(key:RepoKey)=>key.namespace+'/'+key.repo;

/** Local BFF removal control plane. Oxen repositories, commits, drafts and files remain intact. */
export class RepositoryLifecycleService{
  private entries=new Map<string,Entry>();private chain=Promise.resolve();
  constructor(readonly options:{filename:string;provider:Provider;access:RepositoryAccessService}){}
  async init(){try{const data=z.object({version:z.literal(1),entries:z.array(entrySchema).max(50000)}).strict().parse(JSON.parse(await readFile(this.options.filename,'utf8')));this.entries=new Map(data.entries.map(entry=>[entry.namespace+'/'+entry.name,entry]));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
  isRemoved(key:RepoKey){return this.entries.get(id(key))?.removed===true;}
  assertAvailable(key:RepoKey){if(this.isRemoved(key))throw new ApiError(410,'REPOSITORY_REMOVED','项目已移入本地回收站。Oxen版本及未完成工作均保留，请由管理员恢复。');}
  filter(items:RepoSummary[]){return items.filter(item=>!this.isRemoved({namespace:item.namespace,repo:item.name}));}
  private async admin(key:RepoKey,identity:RequestIdentity){if(identity.kind==='guest')throw new ApiError(401,'AUTH_REQUIRED','请以项目管理员身份登录。');await this.options.access.requireCapability(key,identity,'project.admin');}
  private async state(key:RepoKey):Promise<RepositoryLifecycleState>{
    const [settings,branches,workspaces]=await Promise.all([this.options.access.settings.read(key),this.options.provider.branches(key),this.options.provider.workspaces(key)]),entry=this.entries.get(id(key));
    return {namespace:key.namespace,name:key.repo,displayName:settings.policy.displayName||key.repo,status:entry?.removed?'removed':'active',revision:entry?.revision??0,...(entry?.removed?{removalId:entry.id,removedAt:entry.removedAt,removedBy:entry.removedBy}:{}),expectedRevision:datasetHash({policy:settings.commitId,branches:[...branches].sort((a,b)=>a.name.localeCompare(b.name)),workspaces:[...workspaces].sort((a,b)=>a.id.localeCompare(b.id)),entry:entry??null}),branchCount:branches.length,workspaceCount:workspaces.length,recovery:'bff-local'};
  }
  async read(key:RepoKey,identity:RequestIdentity){await this.admin(key,identity);return this.state(key);}
  async removed(identity:RequestIdentity){const result:RepositoryLifecycleState[]=[];if(identity.kind==='guest')return result;for(const entry of this.entries.values()){if(!entry.removed)continue;try{await this.admin({namespace:entry.namespace,repo:entry.name},identity);result.push(await this.state({namespace:entry.namespace,repo:entry.name}));}catch(error){if(!(error instanceof ApiError)||![401,403,404].includes(error.status))throw error;}}return result.sort((a,b)=>(b.removedAt??'').localeCompare(a.removedAt??''));}
  private serial<T>(work:()=>Promise<T>){const result=this.chain.then(work);this.chain=result.then(()=>{},()=>{});return result;}
  private async persist(entries:Map<string,Entry>){await mkdir(path.dirname(this.options.filename),{recursive:true});const temporary=this.options.filename+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify({version:1,entries:[...entries.values()]},null,2),{mode:0o600});await rename(temporary,this.options.filename);this.entries=entries;}
  remove(key:RepoKey,identity:RequestIdentity,input:RepositoryRemoveInput){const parsed=repositoryRemoveSchema.parse(input);return this.serial(async()=>{await this.admin(key,identity);const current=await this.state(key);if(parsed.confirmation!==id(key))throw new ApiError(422,'REPOSITORY_CONFIRMATION_REQUIRED','请输入完整的 namespace/name 项目标识。');if(current.status==='removed'||current.expectedRevision!==parsed.expectedRevision)throw new ApiError(409,'REPOSITORY_LIFECYCLE_CONFLICT','项目状态、分支或工作区已有变化，请重新核对后确认移除。');await this.admin(key,identity);const entry:Entry={namespace:key.namespace,name:key.repo,id:randomUUID(),revision:current.revision+1,removed:true,removedAt:new Date().toISOString(),removedBy:identity.id,displayName:current.displayName},entries=new Map(this.entries);entries.set(id(key),entry);await this.persist(entries);return this.state(key);});}
  restore(key:RepoKey,identity:RequestIdentity,input:RepositoryRestoreInput){const parsed=repositoryRestoreSchema.parse(input);return this.serial(async()=>{await this.admin(key,identity);const entry=this.entries.get(id(key));if(parsed.confirmation!==id(key))throw new ApiError(422,'REPOSITORY_CONFIRMATION_REQUIRED','请输入完整的 namespace/name 项目标识。');if(!entry?.removed||entry.id!==parsed.removalId||entry.revision!==parsed.revision)throw new ApiError(409,'REPOSITORY_LIFECYCLE_CONFLICT','回收记录已更新，请重新读取后恢复。');const entries=new Map(this.entries);entries.set(id(key),{...entry,removed:false,revision:entry.revision+1,restoredAt:new Date().toISOString()});await this.admin(key,identity);await this.persist(entries);return this.state(key);});}
}
