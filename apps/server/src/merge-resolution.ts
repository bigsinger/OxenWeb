import {durableWriteJson} from './durable-store.js';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CommitItem, MergeFieldConflict, MergeResolutionDecision, MergeResolutionFile, MergeResolutionPreview, MergeResolutionRequest, MergeResolutionResult, RequestIdentity } from '../../../packages/shared/src/index.js';
import type { DatasetLabelRecord } from '../../../packages/shared/src/dataset.js';
import type { Provider, RepoKey } from './provider.js';
import { ApiError } from './errors.js';
import { safeFilePath, safeRef } from './safety.js';
import { canonicalJson, labelFingerprint, labelRecordPath, rowRecordPath } from './dataset-storage.js';

const missing = Symbol('missing');
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const equal = (a: unknown, b: unknown) => a === missing || b === missing ? a === b : canonicalJson(a) === canonicalJson(b);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const protectedKey = /^(id|uid|_oxen_id|_oxen_row_id|ground_truth|label|label_name|expected_detection|__bundle_provenance)$/i;
function token(value: string) { return value.replaceAll('~','~0').replaceAll('/','~1'); }
function mergeJson(base: unknown, source: unknown, target: unknown, pointer: string, decisions: Map<string,'source'|'target'> | undefined, conflicts: MergeFieldConflict[], depth=0): unknown {
  if (depth>30||conflicts.length>500) throw new ApiError(413,'MERGE_RESOLUTION_COMPLEX','冲突结构超过支持范围，请拆分后处理。');
  if (equal(source,target)) return source;
  if (equal(source,base)) return target;
  if (equal(target,base)) return source;
  if (object(source)&&object(target)&&(object(base)||base===missing)) {
    const output:Record<string,unknown>={};
    for(const key of new Set([...Object.keys(base===missing?{}:base as object),...Object.keys(source),...Object.keys(target)])) {
      if(['__proto__','constructor','prototype'].includes(key)) throw new ApiError(422,'MERGE_RESOLUTION_KEY','此 JSON 含有不支持的保留键。');
      const before=object(base)&&Object.hasOwn(base,key)?base[key]:missing;
      const value=mergeJson(before,Object.hasOwn(source,key)?source[key]:missing,Object.hasOwn(target,key)?target[key]:missing,pointer+'/'+token(key),decisions,conflicts,depth+1);
      if(value!==missing)Object.defineProperty(output,key,{value,enumerable:true,writable:true,configurable:true});
    }return output;
  }
  const choice=decisions?.get(pointer);if(choice)return choice==='source'?source:target;
  conflicts.push({pointer,baseMissing:base===missing,sourceMissing:source===missing,targetMissing:target===missing,...(base!==missing?{base}:{}),...(source!==missing?{source}:{}),...(target!==missing?{target}:{})});return source;
}
export function threeWayJson(base: unknown, source: unknown, target: unknown, decisions?:Array<{pointer:string;choice:'source'|'target'}>) {const conflicts:MergeFieldConflict[]=[];const value=mergeJson(base===undefined?missing:base,source===undefined?missing:source,target===undefined?missing:target,'',decisions?new Map(decisions.map(item=>[item.pointer,item.choice])):undefined,conflicts);return {value:value===missing?undefined:value,conflicts};}
interface Blob { content:Buffer; sha:string; text?:string; json?:unknown }
async function blob(provider:Provider,key:RepoKey,ref:string,filename:string):Promise<Blob|undefined>{try{const raw=await provider.raw(key,ref,filename);if(raw.content.length>64*1024*1024)throw new ApiError(413,'MERGE_RESOLUTION_LIMIT','单个冲突文件超过64MiB。');const result:Blob={content:raw.content,sha:hash(raw.content)};if(raw.content.length<=1024*1024&&!raw.content.includes(0)){try{result.text=new TextDecoder('utf-8',{fatal:true}).decode(raw.content);try{result.json=JSON.parse(result.text);}catch{/*plain text*/}}catch{/*binary*/}}return result;}catch(error){if(error instanceof ApiError&&error.status===404)return undefined;throw error;}}
function managedKind(filename:string):MergeResolutionFile['kind']{if(/^\.oxenweb\/dataset\/rows\/[a-f0-9]{64}\.json$/.test(filename))return 'managed-row';if(/^\.oxenweb\/dataset\/labels\/(dataset|file|row)\/[a-f0-9]{64}-[a-f0-9]{64}\.json$/.test(filename))return 'managed-label';if(/^\.oxenweb(?:\/|$)/.test(filename)||/^(data|source)\//.test(filename)||filename==='bundle-manifest.json')return 'protected';return 'text';}
function invariant(kind:MergeResolutionFile['kind'],source:unknown,target:unknown):string|undefined{
  if(!object(source)||!object(target))return '托管记录必须保留完整的有效 JSON 结构。';
  const keys=kind==='managed-row'?['version','rowId','baseHash','isNew']:['version','scope','path','rowId','templateSnapshot'];
  if(keys.some(key=>!equal(source[key],target[key])))return '记录身份、导入基线或规范快照不同，须通过迁移／规范流程处理。';
  if(kind==='managed-label'&&(!object(source.actor)||!object(target.actor)||source.actor.id!==target.actor.id))return '标注执行人身份不一致，不能通过冲突裁决改写。';
  if(kind==='managed-row'&&object(source.record)&&object(target.record)){for(const field of new Set([...Object.keys(source.record),...Object.keys(target.record)]))if(protectedKey.test(field)&&!equal(source.record[field],target.record[field]))return '源标识、来源或原始真值不同，不能通过手工裁决覆盖。';}
}
function payload(kind:MergeResolutionFile['kind'],value:unknown):unknown{if(!object(value))return value;if(kind==='managed-row')return value.record;if(kind==='managed-label')return {values:value.values,spans:value.spans,steps:value.steps};return value;}
function inspectJson(kind:MergeResolutionFile['kind'],base:Blob|undefined,source:Blob|undefined,target:Blob|undefined){return threeWayJson(payload(kind,base?.json),payload(kind,source?.json),payload(kind,target?.json));}
function validateManaged(filename:string,kind:MergeResolutionFile['kind'],record:unknown){
  if(!object(record)||record.version!==1||!object(record.actor)||typeof record.actor.id!=='string')throw new ApiError(422,'MERGE_RECORD_INVALID','托管记录结构或操作者身份无效。');
  if(kind==='managed-row'){if(typeof record.rowId!=='string'||filename!==rowRecordPath(record.rowId)||!['upsert','delete'].includes(String(record.op))||record.op==='upsert'&&!object(record.record))throw new ApiError(422,'MERGE_RECORD_INVALID','样本记录身份与路径不匹配。');}
  else {const value=record as unknown as DatasetLabelRecord;if(filename!==labelRecordPath(value,value.actor.id)||value.fingerprint!==labelFingerprint(value))throw new ApiError(422,'MERGE_RECORD_INVALID','标注记录身份或内容指纹不匹配。');}
}
export interface MergeResolutionOptions {provider:Provider;filename:string;beforeResolve?:(key:RepoKey,identity:RequestIdentity,preview:MergeResolutionPreview)=>Promise<void>;afterResolve?:(key:RepoKey,identity:RequestIdentity,result:MergeResolutionResult)=>Promise<void>}
export class MergeResolutionService {
  private chains=new Map<string,Promise<void>>();private auditChain=Promise.resolve();
  constructor(private options:MergeResolutionOptions){}
  private async history(key:RepoKey,ref:string){const result=new Map<string,CommitItem>();for(let page=1;page<=100;page++){const rows=await this.options.provider.commits(key,ref,page,100);for(const row of rows)result.set(row.id,row);if(rows.length<100)return result;}throw new ApiError(413,'MERGE_HISTORY_LIMIT','共同基线搜索超过10000条历史。');}
  async compare(key:RepoKey,source:string,target:string,requestedBase?:string):Promise<MergeResolutionPreview>{
    safeRef(source);safeRef(target);if(source===target)throw new ApiError(400,'MERGE_BRANCHES','请选择不同的源分支与目标分支。');const {provider}=this.options;
    if(!provider.inspectMerge||!provider.resolveMerge)throw new ApiError(501,'MERGE_RESOLUTION_UNAVAILABLE','当前提供方没有已验证的原生冲突恢复能力。');
    const inspection=await provider.inspectMerge(key,source,target),[sourceHistory,targetHistory]=await Promise.all([this.history(key,inspection.sourceCommitId),this.history(key,inspection.targetCommitId)]);
    const nodes=new Map([...sourceHistory,...targetHistory]);const distances=(start:string)=>{const result=new Map<string,number>(),queue:[[string,number]]|Array<[string,number]>=[[start,0]];for(let i=0;i<queue.length;i++){const [id,distance]=queue[i]!;if(result.has(id))continue;result.set(id,distance);for(const parent of nodes.get(id)?.parentIds??[])queue.push([parent,distance+1]);}return result;};
    const a=distances(inspection.sourceCommitId),b=distances(inspection.targetCommitId),common=[...a.keys()].filter(id=>b.has(id)).sort((x,y)=>(a.get(x)!+b.get(x)!)-(a.get(y)!+b.get(y)!));
    const base=common[0];if(!base)throw new ApiError(409,'UNRELATED_HISTORIES','分支没有共同祖先。');if(common[1]&&(a.get(base)!+b.get(base)!)===(a.get(common[1])!+b.get(common[1])!))throw new ApiError(409,'AMBIGUOUS_MERGE_BASE','存在多个同级共同基线，不能自动选择裁决依据。');if(requestedBase&&requestedBase!==base)throw new ApiError(409,'MERGE_BASE_CHANGED','共同基线与请求不一致，请重新比较。');
    if(inspection.conflicts.length>100)throw new ApiError(413,'MERGE_RESOLUTION_LIMIT','一次最多处理100个原生冲突文件。');
    const files:MergeResolutionFile[]=[];let total=0;
    for(const filename of [...new Set(inspection.conflicts)].sort()){
      safeFilePath(filename);const kind=managedKind(filename);
      if(kind==='protected'){files.push({path:filename,kind,allowedChoices:[],conflicts:[],blockedReason:'规范、身份映射和原始导入基线不能在通用裁决中改写，请使用受控治理或迁移流程。',summary:'受保护的版本对象'});continue;}
      const [before,from,to]=await Promise.all([blob(provider,key,base,filename),blob(provider,key,inspection.sourceCommitId,filename),blob(provider,key,inspection.targetCommitId,filename)]);total+=(before?.content.length??0)+(from?.content.length??0)+(to?.content.length??0);if(total>128*1024*1024)throw new ApiError(413,'MERGE_RESOLUTION_LIMIT','冲突比较总读取超过128MiB。');
      const managed=kind==='managed-row'||kind==='managed-label';let blockedReason=managed?invariant(kind,from?.json,to?.json):undefined;
      if(managed&&!blockedReason){validateManaged(filename,kind,from?.json);validateManaged(filename,kind,to?.json);}
      const file:MergeResolutionFile={path:filename,kind:managed?kind:from?.json!==undefined&&to?.json!==undefined?'json':from?.text!==undefined&&to?.text!==undefined?'text':'binary',allowedChoices:blockedReason?[]:['source','target'],conflicts:[],...(before?{baseHash:before.sha}:{}),...(from?{sourceHash:from.sha}:{}),...(to?{targetHash:to.sha}:{}),summary:managed?'按稳定样本与允许字段比较；裁决会使相关旧审核失效。':'逐文件选择源／目标版本',...(blockedReason?{blockedReason}:{})};
      if(!blockedReason&&file.kind==='json'||!blockedReason&&managed){const inspected=inspectJson(kind,before,from,to);file.conflicts=inspected.conflicts;if(!managed||object(from?.json)&&object(to?.json)&&from.json.op===to.json.op){if(file.conflicts.some(conflict=>conflict.pointer.split('/').some(part=>protectedKey.test(part.replaceAll('~1','/').replaceAll('~0','~'))))){file.blockedReason='受保护的身份或原始真值字段发生冲突，不能进行手工字段覆盖。';file.allowedChoices=[];}else file.allowedChoices.push('fields');}}
      if(file.kind==='text'&&/\.(txt|md|rst|log)$/i.test(filename))file.allowedChoices.push('manual');
      for(const [field,value]of [['baseText',before?.text],['sourceText',from?.text],['targetText',to?.text]] as const)if(value!==undefined&&Buffer.byteLength(value)<=256*1024)file[field]=value;
      files.push(file);
    }
    const preview:MergeResolutionPreview={source,target,baseCommitId:base,sourceCommitId:inspection.sourceCommitId,targetCommitId:inspection.targetCommitId,files,fingerprint:'',canResolve:files.length>0&&files.every(file=>file.allowedChoices.length>0),warnings:['裁决提交将合并目标进入源分支并推送源分支；目标分支不会被本操作合并。','完成后必须刷新 MR，并对受影响内容重新提交复核。',...(!files.length?['没有原生冲突，请使用常规合并请求流程。']:[])],native:inspection.native};
    preview.fingerprint=hash(canonicalJson({...preview,fingerprint:undefined}));return preview;
  }
  private async audit(entry:Record<string,unknown>){const operation=this.auditChain.then(async()=>{let entries:unknown[]=[];try{entries=JSON.parse(await readFile(this.options.filename,'utf8'));if(!Array.isArray(entries))throw new Error('Invalid recovery audit');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}entries.push(entry);await mkdir(path.dirname(this.options.filename),{recursive:true});await durableWriteJson(this.options.filename,entries);});this.auditChain=operation.then(()=>{},()=>{});await operation;}
  resolve(key:RepoKey,identity:RequestIdentity,input:MergeResolutionRequest):Promise<MergeResolutionResult>{const name=key.namespace+'/'+key.repo;const operation=(this.chains.get(name)??Promise.resolve()).then(()=>this.execute(key,identity,input));const settled=operation.then(()=>{},()=>{});this.chains.set(name,settled);void settled.then(()=>{if(this.chains.get(name)===settled)this.chains.delete(name);});return operation;}
  private async execute(key:RepoKey,identity:RequestIdentity,input:MergeResolutionRequest){
    const preview=await this.compare(key,input.source,input.target,input.base);if(preview.sourceCommitId!==input.expectedSourceCommitId||preview.targetCommitId!==input.expectedTargetCommitId||preview.fingerprint!==input.fingerprint)throw new ApiError(409,'MERGE_RESOLUTION_STALE','分支或冲突内容已更新，请重新比较；尚未写入。');if(!preview.canResolve)throw new ApiError(409,'MERGE_RESOLUTION_BLOCKED','包含不支持或受保护的冲突，不能提交裁决。');
    if(input.resolutions.length!==preview.files.length||new Set(input.resolutions.map(item=>item.path)).size!==input.resolutions.length||input.resolutions.some(item=>!preview.files.some(file=>file.path===item.path)))throw new ApiError(422,'MERGE_RESOLUTION_INCOMPLETE','必须为每个真实冲突提供且只提供一项裁决。');
    const files:Array<{path:string;content:Buffer|null}>=[];
    for(const file of preview.files){const decision=input.resolutions.find(item=>item.path===file.path)!;if(!file.allowedChoices.includes(decision.choice))throw new ApiError(403,'MERGE_RESOLUTION_CHOICE','此冲突不允许请求的裁决方式。');const [before,source,target]=await Promise.all([blob(this.options.provider,key,preview.baseCommitId,file.path),blob(this.options.provider,key,preview.sourceCommitId,file.path),blob(this.options.provider,key,preview.targetCommitId,file.path)]);let content:Buffer|null;
      if(decision.choice==='source'||decision.choice==='target')content=(decision.choice==='source'?source:target)?.content??null;
      else if(decision.choice==='manual'){if(decision.content===undefined||Buffer.byteLength(decision.content)>1024*1024||decision.content.includes('\0'))throw new ApiError(422,'MERGE_RESOLUTION_CONTENT','手工文本必须为不超过1MiB的UTF-8文本。');content=Buffer.from(decision.content);}
      else {const choices=decision.fields??[];if(choices.length!==file.conflicts.length||new Set(choices.map(item=>item.pointer)).size!==choices.length||choices.some(item=>!file.conflicts.some(conflict=>conflict.pointer===item.pointer)))throw new ApiError(422,'MERGE_RESOLUTION_FIELDS','所有冲突字段都须明确选择源或目标值。');const kind=file.kind,merged=threeWayJson(payload(kind,before?.json),payload(kind,source?.json),payload(kind,target?.json),choices);if(merged.conflicts.length)throw new ApiError(422,'MERGE_RESOLUTION_FIELDS','仍有未解决的字段。');let result=merged.value;
        if(kind==='managed-row'||kind==='managed-label'){const original=source!.json as Record<string,unknown>;result={...original,...(kind==='managed-row'?{record:merged.value,actor:{id:identity.id,name:identity.name}}:merged.value as object),updatedAt:new Date().toISOString(),resolution:{actor:{id:identity.id,name:identity.name},sourceCommitId:preview.sourceCommitId,targetCommitId:preview.targetCommitId}};if(kind==='managed-label')(result as Record<string,unknown>).fingerprint=labelFingerprint(result as DatasetLabelRecord);validateManaged(file.path,kind,result);}
        content=result===undefined?null:Buffer.from(JSON.stringify(result,null,2)+'\n');
      }files.push({path:file.path,content});
    }
    await this.options.beforeResolve?.(key,identity,preview);const operationId=randomUUID();await this.audit({operationId,...key,source:preview.source,target:preview.target,sourceCommitId:preview.sourceCommitId,targetCommitId:preview.targetCommitId,baseCommitId:preview.baseCommitId,actorId:identity.id,at:new Date().toISOString(),stage:'prepared',decisions:input.resolutions.map(item=>({path:item.path,choice:item.choice,fields:item.fields?.map(field=>({pointer:field.pointer,choice:field.choice})),contentHash:item.content===undefined?undefined:hash(item.content)}))});
    let committed:MergeResolutionResult|undefined;
    try{const result=await this.options.provider.resolveMerge!(key,{operationId,source:preview.source,target:preview.target,expectedSourceCommitId:preview.sourceCommitId,expectedTargetCommitId:preview.targetCommitId,files,message:`Resolve native conflicts into ${preview.source} by ${identity.name} (${identity.id})`},{beforeWrite:()=>this.options.beforeResolve?.(key,identity,preview)??Promise.resolve()});committed=result;await this.audit({operationId,stage:'resolved-on-source',sourceCommitId:result.sourceCommitId,targetCommitId:result.targetCommitId,at:new Date().toISOString()});await this.options.afterResolve?.(key,identity,result);return result;}
    catch(error){if(committed)throw new ApiError(502,'MERGE_RESOLUTION_POSTPROCESS_FAILED','源分支已成功更新，但后续通知或审计失败。请刷新 MR、核对新提交并重新复核，勿重复裁决。',{operationId,sourceCommitId:committed.sourceCommitId,targetCommitId:committed.targetCommitId,requiresReview:true});await this.audit({operationId,stage:'failed-or-interrupted',code:error instanceof ApiError?error.code:'UNEXPECTED',at:new Date().toISOString()});throw error;}
  }
}
