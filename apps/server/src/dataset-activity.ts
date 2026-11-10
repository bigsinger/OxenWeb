import path from 'node:path';
import {z} from 'zod';
import type {DatasetActor,DatasetLabelRecord,DatasetRowActivity} from '../../../packages/shared/src/dataset.js';
import type {Provider,RepoKey} from './provider.js';
import {DATASET_ROOT,storedJson} from './dataset-storage.js';
import {ApiError} from './errors.js';

export const DATASET_ACTIVITY_PATH=`${DATASET_ROOT}/activity.json`;
const timestamp=z.string().datetime({offset:true});
const actor=z.object({id:z.string().min(1).max(500),name:z.string().min(1).max(500)}).strict();
const entry=z.object({createdAt:timestamp.nullable(),updatedAt:timestamp.nullable(),actor:actor.optional(),kind:z.enum(['import','content','annotation','evaluation']).optional(),source:z.enum(['web-operation','source-file','unknown']).optional()}).strict();
const document=z.object({version:z.literal(1),baselineSha256:z.string().regex(/^[a-f0-9]{64}$/),initial:entry.optional(),rows:z.record(z.string().min(1).max(200),entry)}).strict();
export type DatasetActivityDocument=z.infer<typeof document>;
export type DatasetActivityEntry=z.infer<typeof entry>;
export async function readDatasetActivity(provider:Provider,key:RepoKey,ref:string,baselineSha256:string):Promise<DatasetActivityDocument|undefined>{
  const saved=await storedJson(provider,key,ref,DATASET_ACTIVITY_PATH);if(saved===undefined)return;
  const parsed=document.safeParse(saved);
  if(!parsed.success||parsed.data.baselineSha256!==baselineSha256)throw new ApiError(422,'DATASET_ACTIVITY_INVALID','样本操作元数据与规范源文件不匹配，未显示推测的时间或操作人。');
  return parsed.data;
}
const validTime=(value:unknown):value is string=>typeof value==='string'&&Number.isFinite(Date.parse(value));
/** A file-level clock is an honest fallback, never claimed to be an exact per-row edit time. */
export async function datasetSourceFileActivity(provider:Provider,key:RepoKey,ref:string,filename:string):Promise<DatasetRowActivity>{
  try{
    const directory=path.posix.dirname(filename),file=(await provider.tree(key,ref,directory==='.'?'':directory)).find(item=>item.path===filename&&item.kind==='file');
    if(validTime(file?.updatedAt))return {createdAt:file.updatedAt,updatedAt:file.updatedAt,source:'source-file'};
    // Demo/older providers may lack per-file timestamps. Bound this historical lookup.
    for(const commit of await provider.commits(key,ref,1,16)){
      const detail=await provider.commit(key,commit.id);
      if(detail.files.some(file=>file.path===filename&&file.status!=='removed')&&validTime(commit.timestamp))return {createdAt:commit.timestamp,updatedAt:commit.timestamp,source:'source-file'};
    }
  }catch{/* Optional historical evidence may be unavailable; never replace it with the current clock. */}
  return {createdAt:null,updatedAt:null,source:'unknown'};
}
export function datasetRowActivities(ids:string[],document:DatasetActivityDocument|undefined,source:DatasetRowActivity,patches:Array<{rowId:string;actor?:DatasetActor;createdAt?:string;updatedAt?:string;isNew?:boolean}>,labels:DatasetLabelRecord[]):Record<string,DatasetRowActivity>{
  const initial:DatasetRowActivity=document?.initial?{...document.initial,source:document.initial.source??'web-operation'}:source;
  const output=Object.fromEntries(ids.map(id=>[id,document?.rows[id]?{...document.rows[id]!,source:document.rows[id]!.source??'web-operation'}:{...initial}]));
  const newer=(id:string,updatedAt:unknown,actor:DatasetActor|undefined,kind:'import'|'content'|'annotation')=>{
    if(!Object.hasOwn(output,id)||!validTime(updatedAt))return;
    const current=output[id]!;if(current.updatedAt&&Date.parse(current.updatedAt)>Date.parse(updatedAt))return;
    output[id]={createdAt:current.createdAt??updatedAt,updatedAt,...(actor&&typeof actor.id==='string'&&typeof actor.name==='string'?{actor}:{}),source:'web-operation',kind};
  };
  for(const patch of patches){if(Object.hasOwn(output,patch.rowId)&&validTime(patch.createdAt))output[patch.rowId]!.createdAt=patch.createdAt;newer(patch.rowId,patch.updatedAt,patch.actor,patch.isNew&&patch.createdAt===patch.updatedAt?'import':'content');}
  for(const label of labels)if(label.scope==='row'&&label.rowId)newer(label.rowId,label.updatedAt,label.actor,'annotation');
  return output;
}
