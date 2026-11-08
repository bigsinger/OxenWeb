import type { DatasetLabelRecord } from '../../../packages/shared/src/dataset.js';
import type { LabelDocument } from '../../../packages/shared/src/index.js';
import type { Provider, RepoKey } from './provider.js';
import { ApiError } from './errors.js';
import { labelFingerprint, materializeLabelAssignments, readLabelRecordStore, storedJson } from './dataset-storage.js';

export const DATASET_LABELS_PATH = '.oxenweb/dataset/dataset-labels.json';
export async function readDatasetLabelAuthority(provider:Provider,key:RepoKey,commitId:string):Promise<DatasetLabelRecord|undefined>{
  const record=await storedJson(provider,key,commitId,DATASET_LABELS_PATH) as DatasetLabelRecord|undefined;
  if(!record)return undefined;
  if(record.version!==1||record.scope!=='dataset'||record.path!==undefined||record.rowId!==undefined||!record.actor?.id||!record.values||Array.isArray(record.values)||!Array.isArray(record.spans)||record.spans.length||!Array.isArray(record.steps)||record.steps.length||!Array.isArray(record.templateSnapshot?.columns)||record.fingerprint!==labelFingerprint(record))throw new ApiError(422,'DATASET_STORAGE_INVALID','数据集标签生效记录的身份或指纹不匹配。');
  return record;
}

/** Read only metadata; never materializes or scans the canonical table. */
export async function readDatasetLabelSummary(provider:Provider,key:RepoKey,commitId:string){
  const authority=await readDatasetLabelAuthority(provider,key,commitId);
  if(authority){const merged=materializeLabelAssignments({version:1,columns:authority.templateSnapshot.columns,assignments:[]},[authority]);return {assignment:merged.assignments[0],record:authority,conflicts:merged.conflicts};}
  const document=await storedJson(provider,key,commitId,'.oxenweb/labels.json') as LabelDocument|undefined;
  // Validate current-layer records while listing only dataset metadata.
  const scoped=new Proxy(provider,{get(target,property){if(property==='tree')return async(k:RepoKey,ref:string,directory:string)=>{const entries=await target.tree(k,ref,directory);return directory==='.oxenweb/dataset/labels'?entries.filter(item=>item.path==='.oxenweb/dataset/labels/dataset'):entries;};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
  const store=await readLabelRecordStore(scoped,key,commitId);
  const merged=materializeLabelAssignments({version:1,columns:document?.columns??[],assignments:document?.assignments.filter(item=>item.scope==='dataset')??[]},store.records.filter(item=>item.scope==='dataset'));
  return {assignment:merged.assignments.find(item=>item.scope==='dataset'),record:undefined,conflicts:merged.conflicts};
}
