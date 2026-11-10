import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {RepositoryVersionRestoreInput,RepositoryVersionRestorePreview,RepositoryVersionRestoreCommitInput,RepositoryVersionRestoreResult,RepositoryVersionRestoreFile,RequestIdentity} from '../../../packages/shared/src/index.js';
import type {DatasetSnapshot} from '../../../packages/shared/src/dataset.js';
import type {Provider,RepoKey} from './provider.js';
import type {DatasetService} from './dataset.js';
import {DATASET_ACTIVITY_PATH} from './dataset-activity.js';
import {canonicalJson} from './dataset-storage.js';
import {REPOSITORY_POLICY_PATH} from './repository-settings.js';
import {ApiError} from './errors.js';
import {safeFilePath,safeRef} from './safety.js';

const ref=z.string().transform(safeRef),commit=z.string().regex(/^[a-f0-9]{1,64}$/);
export const restorePreviewSchema=z.object({ref,expectedCommit:commit,targetCommit:commit}).strict();
export const restoreCommitSchema=restorePreviewSchema.extend({planHash:z.string().regex(/^[a-f0-9]{64}$/),confirmation:z.string(),message:z.string().trim().min(1).max(4000)}).strict();
const sha=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
const preserved=(filename:string)=>filename.toLowerCase()===REPOSITORY_POLICY_PATH;
const proof=(filename:string)=>filename.toLowerCase().startsWith('.oxenweb/reviews/');
const MAX_FILES=50000,MAX_BYTES=256*1024*1024;
export const RESTORE_WORKSPACE_PREFIX='oxenweb-restore-';
export interface RepositoryHistoryOptions {
 provider:Provider;datasets:DatasetService;
 authorize:(key:RepoKey,identity:RequestIdentity)=>Promise<void>;
 beforeRestore:(key:RepoKey,identity:RequestIdentity,branch:string,target:string,head:string)=>Promise<void>;
}
/** Local BFF extension: restore a fixed snapshot by adding a commit, never move/reset a branch. */
export class RepositoryHistoryService {
 private chains=new Map<string,Promise<void>>();
 constructor(readonly options:RepositoryHistoryOptions){}
 private async check(key:RepoKey,identity:RequestIdentity,input:RepositoryVersionRestoreInput){
  await this.options.authorize(key,identity);const branches=await this.options.provider.branches(key),branch=branches.find(item=>item.name===input.ref);
  if(!branch)throw new ApiError(409,'RESTORE_BRANCH_REQUIRED','恢复目标必须是当前存在的分支，固定历史视图不可直接修改。');
  if(branch.commitId!==input.expectedCommit)throw new ApiError(409,'RESTORE_HEAD_CHANGED','分支已变化，请保留输入并重新预览恢复。');
  if(input.targetCommit===input.expectedCommit)throw new ApiError(409,'RESTORE_ALREADY_CURRENT','所选提交已是当前分支版本，无需恢复。');
  const resolved=await this.options.datasets.resolve(key,input.targetCommit);if(resolved!==input.targetCommit)throw new ApiError(409,'RESTORE_FIXED_COMMIT_REQUIRED','请选择完整固定提交ID。');
  await this.options.beforeRestore(key,identity,input.ref,input.targetCommit,input.expectedCommit);
 }
 private async tree(key:RepoKey,revision:string){
  const files=new Map<string,Buffer>(),seen=new Set<string>();let bytes=0,nodes=0;
  const walk=async(directory:string,depth:number)=>{if(depth>64)throw new ApiError(413,'RESTORE_TREE_LIMIT','文件树层级超过恢复支持范围。');
   const entries=await this.options.provider.tree(key,revision,directory),prefix=directory?directory+'/':'';
   for(const entry of entries){const filename=safeFilePath(entry.path);if(!filename.startsWith(prefix)||filename.slice(prefix.length).includes('/')||seen.has(filename))throw new ApiError(502,'RESTORE_TREE_INVALID','文件树返回越界、重复或非直接子项，未生成恢复计划。');seen.add(filename);if(++nodes>MAX_FILES)throw new ApiError(413,'RESTORE_TREE_LIMIT','恢复最多支持50000个目录及文件。');
    if(entry.kind==='directory')await walk(filename,depth+1);else{const raw=await this.options.provider.raw(key,revision,filename);bytes+=raw.content.length;if(bytes>MAX_BYTES)throw new ApiError(413,'RESTORE_BYTES_LIMIT','单个版本超过256MiB恢复预算，请使用受控CLI工作流。');files.set(filename,raw.content);}
   }
  };await walk('',0);return files;
 }
 private async dataset(key:RepoKey,revision:string){try{return await this.options.datasets.read(key,revision);}catch(error){if(error instanceof ApiError&&error.code==='DATASET_NOT_CONFIGURED')return undefined;throw error;}}
 private async prepared(key:RepoKey,identity:RequestIdentity,input:RepositoryVersionRestoreInput){
  await this.check(key,identity,input);const before=await this.tree(key,input.expectedCommit),target=await this.tree(key,input.targetCommit),after=new Map(target),preservedPaths:string[]=[];
  for(const filename of new Set([...before.keys(),...target.keys()])){if(preserved(filename)){preservedPaths.push(filename);if(before.has(filename))after.set(filename,before.get(filename)!);else after.delete(filename);}if(proof(filename))after.delete(filename);}
  // The source snapshot is restored; operational clocks remain current evidence, not historical edits.
  const [currentDataset,targetDataset]=await Promise.all([this.dataset(key,input.expectedCommit),this.dataset(key,input.targetCommit)]);
  const changedAttachments=new Set([...new Set([...before.keys(),...after.keys()])].filter(filename=>{const a=before.get(filename),b=after.get(filename);return !a||!b||!a.equals(b);}));
  const changedRows=targetDataset?.rowIds.filter(id=>this.rowSignature(currentDataset,id)!==this.rowSignature(targetDataset,id)||targetDataset.attachments.some(file=>file.rowIds.includes(id)&&changedAttachments.has(file.path)))??[];
  let generated=false;
  if(targetDataset){
   const raw=target.get(targetDataset.descriptor.canonicalPath);if(!raw)throw new ApiError(422,'RESTORE_DATASET_SOURCE_MISSING','目标数据集源文件不在完整文件树中。');
   const now=new Date().toISOString(),changed=new Set(changedRows),rows=Object.fromEntries(targetDataset.rowIds.map(id=>{const historical=targetDataset.rowActivity?.[id],current=currentDataset?.rowActivity?.[id],entry=changed.has(id)?{createdAt:historical?.createdAt??current?.createdAt??now,updatedAt:now,actor:{id:identity.id,name:identity.name},kind:'content' as const,source:'web-operation' as const}:current??historical;return [id,{createdAt:entry?.createdAt??null,updatedAt:entry?.updatedAt??null,source:entry?.source??'unknown',...(entry?.actor?{actor:entry.actor}:{}),...(entry?.kind?{kind:entry.kind}:{})}];}));
   const currentRaw=currentDataset&&before.get(currentDataset.descriptor.canonicalPath),baselineChanged=!currentRaw||sha(currentRaw)!==sha(raw);
   if(changedRows.length||baselineChanged){const metadata=Buffer.from(JSON.stringify({version:1,baselineSha256:sha(raw),rows},null,2)+'\n');if(metadata.length>8*1024*1024)throw new ApiError(413,'RESTORE_ACTIVITY_LIMIT','恢复后的逐条操作记录超过8MiB支持范围，未执行部分恢复。');after.set(DATASET_ACTIVITY_PATH,metadata);generated=true;}
   else if(before.has(DATASET_ACTIVITY_PATH))after.set(DATASET_ACTIVITY_PATH,before.get(DATASET_ACTIVITY_PATH)!);else after.delete(DATASET_ACTIVITY_PATH);
  }
  const files:RepositoryVersionRestoreFile[]=[];
  for(const filename of [...new Set([...before.keys(),...after.keys()])].sort()){
   const a=before.get(filename),b=after.get(filename);if(a&&b&&a.equals(b)||!a&&!b)continue;
   files.push({path:filename,status:!b?'removed':!a?'added':'modified',...(a?{beforeSha256:sha(a)}:{}),...(b&&!(generated&&filename===DATASET_ACTIVITY_PATH)?{afterSha256:sha(b)}:{}),bytes:b?.length??0,...(generated&&filename===DATASET_ACTIVITY_PATH?{generated:true}:{})});
  }
  const planHash=sha(canonicalJson({...key,...input,files:files.map(({bytes:_bytes,...file})=>file),preservedPaths}));
  await this.check(key,identity,input);return {before,after,preview:{...input,planHash,files,preservedPaths,requiresReview:true as const,canRestore:files.length>0,warnings:['新增恢复提交并保留原历史；不会执行reset或强制推送。','项目名称、简介、可见性及访问策略保持当前值；历史复核证明不恢复，恢复后的内容需要重新复核。','本人和其他人的私有输入不会被删除；旧基点草稿仍需重新核对。']}};
 }
 private rowSignature(snapshot:DatasetSnapshot|undefined,id:string){return snapshot?.rowIds.includes(id)?canonicalJson({content:snapshot.contentHashes[id],labels:snapshot.labelRecords.filter(record=>record.scope==='row'&&record.rowId===id).map(record=>record.fingerprint).sort(),assignments:snapshot.labels.assignments.filter(record=>record.scope==='row'&&record.rowId===id).map(record=>record.values)}):'absent';}
 async preview(key:RepoKey,identity:RequestIdentity,input:RepositoryVersionRestoreInput):Promise<RepositoryVersionRestorePreview>{return (await this.prepared(key,identity,restorePreviewSchema.parse(input))).preview;}
 async restore(key:RepoKey,identity:RequestIdentity,input:RepositoryVersionRestoreCommitInput):Promise<RepositoryVersionRestoreResult>{
  const parsed=restoreCommitSchema.parse(input),serial=key.namespace+'/'+key.repo,previous=this.chains.get(serial)??Promise.resolve();
  const work=previous.then(async()=>{const plain={ref:parsed.ref,expectedCommit:parsed.expectedCommit,targetCommit:parsed.targetCommit};if(parsed.confirmation!==`${key.namespace}/${key.repo}@${parsed.ref}`)throw new ApiError(422,'RESTORE_CONFIRMATION_REQUIRED','请输入完整的namespace/project@branch以确认恢复。');const prepared=await this.prepared(key,identity,plain);if(prepared.preview.planHash!==parsed.planHash)throw new ApiError(409,'RESTORE_PLAN_CHANGED','恢复计划已变化，请重新预览，未提交。');if(!prepared.preview.canRestore)throw new ApiError(409,'RESTORE_NO_CHANGES','此版本与当前可恢复内容相同，无需新提交。');if(prepared.preview.files.some(file=>file.status==='removed')&&!this.options.provider.removeWorkspaceFiles)throw new ApiError(503,'RESTORE_DELETE_UNAVAILABLE','当前Provider不支持可靠删除暂存，未执行部分恢复。');
   if(!this.options.provider.rawWorkspaceFile)throw new ApiError(503,'RESTORE_STAGE_VERIFY_UNAVAILABLE','当前Provider不支持暂存原始字节核验，未执行部分恢复。');
   const workspace=await this.options.provider.createWorkspace(key,RESTORE_WORKSPACE_PREFIX+parsed.targetCommit.slice(0,12)+'-'+randomUUID(),parsed.ref);let commitStarted=false,complete=false;
   try{if(workspace.baseCommitId&&workspace.baseCommitId!==parsed.expectedCommit)throw new ApiError(409,'RESTORE_HEAD_CHANGED','创建恢复工作区时分支已变化。');
    for(const file of prepared.preview.files.filter(file=>file.status!=='removed'))await this.options.provider.writeWorkspace(key,workspace.id,file.path,prepared.after.get(file.path)!);
    const removed=prepared.preview.files.filter(file=>file.status==='removed').map(file=>file.path);if(removed.length)await this.options.provider.removeWorkspaceFiles!(key,workspace.id,removed);
    const verify=async()=>{const staged=await this.options.provider.workspace(key,workspace.id);if(canonicalJson(staged.changes.map(change=>({path:change.path,status:change.status})).sort((a,b)=>a.path.localeCompare(b.path)))!==canonicalJson(prepared.preview.files.map(({path,status})=>({path,status})).sort((a,b)=>a.path.localeCompare(b.path))))throw new ApiError(409,'RESTORE_STAGE_MISMATCH','原生暂存文件集合与已审阅计划不同，未提交。');for(const file of prepared.preview.files.filter(file=>file.status!=='removed')){const raw=await this.options.provider.rawWorkspaceFile!(key,workspace.id,file.path);if(!raw.content.equals(prepared.after.get(file.path)!))throw new ApiError(409,'RESTORE_STAGE_BYTES_CHANGED','恢复暂存字节与已审阅版本不同，未提交。');}};
    await verify();await this.check(key,identity,plain);commitStarted=true;const saved=await this.options.provider.commitWorkspace(key,workspace.id,parsed.message+'\n\nRestored-From: '+parsed.targetCommit,parsed.expectedCommit,async()=>{await this.check(key,identity,plain);await verify();});complete=true;
    if(!saved.parentIds.includes(parsed.expectedCommit))throw new ApiError(502,'RESTORE_PARENT_UNCONFIRMED','恢复结果没有预期父提交，请通过操作核对检查，禁止盲目重试。');
    return {commitId:saved.id,previousCommitId:parsed.expectedCommit,restoredFrom:parsed.targetCommit,ref:parsed.ref,requiresReview:true as const};
   }finally{if(!commitStarted||complete)await this.options.provider.deleteWorkspace(key,workspace.id).catch(()=>{});}
  });const settled=work.then(()=>{},()=>{});this.chains.set(serial,settled);void settled.then(()=>{if(this.chains.get(serial)===settled)this.chains.delete(serial);});return work;
 }
}
