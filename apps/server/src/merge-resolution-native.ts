import { mkdir, lstat, realpath, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import type { Config } from './config.js';
import type { MergeOptions, NativeMergeInspection, NativeMergeResolutionInput, RepoKey } from './provider.js';
import type { MergeResolutionResult } from '../../../packages/shared/src/index.js';
import { ApiError } from './errors.js';
import { runCli } from './cli.js';
import { assertClean, assertRemote, cliOptions, localBranchHead, localBranches, provisionClone } from './managed-cli.js';
import { inside, safeFilePath, safeRef } from './safety.js';

export function nativeConflictPaths(status:string):string[]{return [...status.matchAll(/^\s*(?:both modified|both added|deleted by us|deleted by them|both deleted|added by us|added by them):\s*(.+?)\s*$/gm)].map(match=>safeFilePath(match[1]!)).sort();}
export function nativeCommitParents(output:string):string[]{const match=/parent_ids "([a-f0-9,]+)"/.exec(output);if(!match)throw new ApiError(502,'NATIVE_PARENT_UNKNOWN','原生提交未返回可验证的父节点。');return match[1]!.split(',');}
async function writeResolved(cwd:string,filename:string,content:Buffer){const destination=path.resolve(cwd,safeFilePath(filename));if(!inside(cwd,destination))throw new ApiError(400,'INVALID_PATH','裁决路径超出托管仓库。');let current=cwd;for(const part of filename.split('/').slice(0,-1)){current=path.join(current,part);const entry=await lstat(current).catch(error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;return undefined;});if(entry?.isSymbolicLink()||entry&&!entry.isDirectory())throw new ApiError(400,'INVALID_PATH','裁决路径包含链接或非目录。');if(!entry)await mkdir(current);if(!inside(cwd,await realpath(current)))throw new ApiError(400,'INVALID_PATH','裁决路径解析异常。');}const entry=await lstat(destination).catch(error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;return undefined;});if(entry?.isSymbolicLink()||entry&&!entry.isFile())throw new ApiError(400,'INVALID_PATH','裁决目标不是普通文件。');await writeFile(destination,content);}
export interface NativeResolutionChecks { inspect:()=>Promise<NativeMergeInspection>; isAncestor:(ancestor:string,descendant:string)=>Promise<boolean> }
/** Must be called under the provider's repository lock. Never force-resets an existing branch. */
export async function executeNativeMergeResolution(config:Config,key:RepoKey,input:NativeMergeResolutionInput,options:MergeOptions,checks:NativeResolutionChecks):Promise<MergeResolutionResult>{
  safeRef(input.source);safeRef(input.target);if(input.source===input.target)throw new ApiError(400,'MERGE_BRANCHES','源与目标不能相同。');
  const recoveryFile=path.join(path.dirname(config.demoFile),'native-merge-recovery',input.operationId+'.json');let cwd='',started=false,localCommit:string|undefined,stage='preflight';
  const output:string[]=[];
  const recover=async(extra:Record<string,unknown>={})=>{await mkdir(path.dirname(recoveryFile),{recursive:true});const temporary=recoveryFile+'.tmp';await writeFile(temporary,JSON.stringify({version:1,operationId:input.operationId,...key,source:input.source,target:input.target,expectedSourceCommitId:input.expectedSourceCommitId,expectedTargetCommitId:input.expectedTargetCommitId,stage,localCommit,paths:input.files.map(file=>file.path),at:new Date().toISOString(),...extra},null,2)+'\n',{mode:0o600});await rename(temporary,recoveryFile);};
  const check=async()=>{const inspected=await checks.inspect();if(inspected.sourceCommitId!==input.expectedSourceCommitId||inspected.targetCommitId!==input.expectedTargetCommitId)throw new ApiError(409,'MERGE_RESOLUTION_STALE','源或目标分支已变化，未执行推送。');await options.beforeWrite?.();return inspected;};
  const inspection=await check();
  if(!inspection.conflicts.length||JSON.stringify([...new Set(inspection.conflicts)].sort())!==JSON.stringify(input.files.map(file=>safeFilePath(file.path)).sort()))throw new ApiError(409,'MERGE_RESOLUTION_CONFLICTS_CHANGED','原生冲突文件集合与已审阅计划不一致。');
  try{
    cwd=await provisionClone(config,key,input.source);await assertRemote(config,key,cwd);await assertClean(config,cwd);const cli=cliOptions(config);
    output.push(await runCli(['fetch'],cwd,cli));
    const prepare=async(branch:string,expected:string)=>{const branches=await localBranches(config,cwd);if(!branches.has(branch)){// --force is required by 0.67 for an explicit commit; it is used only for a proven absent local name.
        await runCli(['branch','--force',branch,expected],cwd,cli);
      }else{const local=await localBranchHead(config,cwd,branch);if(local!==expected&&!await checks.isAncestor(local,expected))throw new ApiError(409,'CLONE_BRANCH_DIVERGED','托管本地分支包含未发布提交；保留现场，请先检查恢复记录。');}
      output.push(await runCli(['checkout',branch],cwd,cli));if(await localBranchHead(config,cwd,branch)!==expected)output.push(await runCli(['pull','origin',branch],cwd,cli));if(await localBranchHead(config,cwd,branch)!==expected)throw new ApiError(409,'CLONE_BRANCH_DIVERGED','托管分支未达到已审阅版本。');};
    await prepare(input.source,input.expectedSourceCommitId);await prepare(input.target,input.expectedTargetCommitId);output.push(await runCli(['checkout',input.source],cwd,cli));await check();stage='merge-started';await recover();started=true;
    output.push(await runCli(['merge',input.target],cwd,cli));
    const conflictStatus=await runCli(['status'],cwd,cli),actual=nativeConflictPaths(conflictStatus);
    if(!conflictStatus.includes('Merge conflicts:')||JSON.stringify(actual)!==JSON.stringify(input.files.map(file=>file.path).sort()))throw new ApiError(409,'NATIVE_CONFLICT_STATE','CLI 未进入已审阅的原生冲突状态，不能继续裁决。');
    stage='resolving';await recover();
    for(const file of input.files){if(file.content===null)output.push(await runCli(['rm',safeFilePath(file.path)],cwd,cli));else{await writeResolved(cwd,file.path,file.content);output.push(await runCli(['add',safeFilePath(file.path)],cwd,cli));}}
    const staged=await runCli(['status'],cwd,cli);if(nativeConflictPaths(staged).length)throw new ApiError(409,'NATIVE_CONFLICT_UNRESOLVED','仍有原生冲突未标记解决。');await check();
    output.push(await runCli(['commit','-m',input.message],cwd,cli));localCommit=await localBranchHead(config,cwd,input.source);if(localCommit===input.expectedSourceCommitId)throw new ApiError(502,'NATIVE_COMMIT_UNCONFIRMED','原生裁决未生成新提交。');
    const node=await runCli(['node','--node',localCommit,'--revision',input.source,'--verbose'],cwd,cli),parents=nativeCommitParents(node);
    if(parents.length!==2||JSON.stringify([...parents].sort())!==JSON.stringify([input.expectedSourceCommitId,input.expectedTargetCommitId].sort()))throw new ApiError(502,'NATIVE_PARENT_MISMATCH','裁决提交没有保留已审阅的两侧父节点；未推送。');
    await assertClean(config,cwd);stage='committed-not-pushed';await recover({parentIds:parents});await check();stage='push-started';await recover();
    output.push(await runCli(['push','origin',input.source],cwd,cli));
    const after=await checks.inspect();if(after.sourceCommitId!==localCommit)throw new ApiError(502,'MERGE_RESOLUTION_UNCONFIRMED','推送返回后未能确认源分支提交。请检查恢复记录，禁止盲目重试。');
    stage='resolved-on-source';await recover({parentIds:parents,currentTargetCommitId:after.targetCommitId});
    return {operationId:input.operationId,status:'resolved-on-source',source:input.source,target:input.target,previousSourceCommitId:input.expectedSourceCommitId,sourceCommitId:localCommit,targetCommitId:after.targetCommitId,parentIds:parents,requiresReview:true,output:'源分支已更新。请刷新 MR，并对受影响内容重新提交复核；本操作没有合并目标分支。',native:true};
  }catch(error){
    let aborted=false;
    if(cwd&&started&&!localCommit){try{const current=await localBranchHead(config,cwd,input.source);if(current===input.expectedSourceCommitId){await runCli(['merge','--abort'],cwd,cliOptions(config));await assertClean(config,cwd);aborted=true;}else localCommit=current;}catch{/*retain recovery, never reset*/}}
    stage=aborted?'aborted-before-commit':'recovery-required';await recover({errorCode:error instanceof ApiError?error.code:'UNEXPECTED',aborted});
    throw new ApiError(error instanceof ApiError?error.status:500,error instanceof ApiError?error.code:'MERGE_RESOLUTION_FAILED',`${error instanceof Error?error.message:'原生裁决失败。'} ${aborted?'已放弃未提交的本地合并。':'已保留恢复信息；不要盲目重推或重置本地分支。'}`,{operationId:input.operationId,stage,localCommit,requiresInspection:!aborted});
  }
}
