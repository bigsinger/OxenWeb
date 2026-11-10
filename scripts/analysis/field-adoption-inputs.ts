import assert from 'node:assert/strict';
import type {DatasetFieldMetadata} from '../../packages/shared/src/field-metadata.js';
import {createSampleFieldDraft} from '../../apps/web/src/sample-field-config.js';
import {isDatasetBulkEditRequest} from '../../apps/web/src/dataset-bulk-editing.js';

const object=(value:unknown):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const keys=(value:unknown)=>object(value)?Object.keys(value).length:0;
const canonical=(value:unknown):string=>JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(item=>JSON.parse(canonical(item))):Object.fromEntries(Object.entries(value).filter(([,item])=>item!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,JSON.parse(canonical(item))])):value);
const fieldInput=(draft:Record<string,any>)=>{const {original:_original,initial:_initial,...input}=draft;return input;};

/** Match actual unfinished editing, not an open detail panel, selection, or the default empty bulk object. */
export function workbenchHasUnfinishedInput(value:unknown,depth=0):boolean{
  assert.ok(object(value)&&value.version===2&&Array.isArray(value.operations),'Unknown workbench checkpoint');assert.ok(depth<=100,'Retained workbench input depth exceeded');
  if(value.operations.length)return true;
  if(value.editing&&value.json!==value.jsonBaseline)return true;
  if(object(value.cellEdit)&&(value.cellEdit.text!==value.cellEdit.baseline||value.cellEdit.kind!==value.cellEdit.originalKind||value.cellEdit.presence!==value.cellEdit.originalPresence))return true;
  if(value.drawer==='append'&&value.json!==value.jsonBaseline)return true;
  if(value.drawer==='evaluation'){
    // Current checkpoints wrap patch + rowIds; old synthetic captures may hold just {}.
    const bulk=value.evaluationBulk,patch=object(bulk)&&Object.hasOwn(bulk,'patch')?bulk.patch:bulk;
    if(keys(patch))return true;
  }
  if(value.drawer==='bulk'&&keys(value.bulkValues))return true;
  if(value.sourceBulk!==undefined){
    assert.ok(object(value.sourceBulk)&&Array.isArray(value.sourceBulk.rowIds)&&value.sourceBulk.rowIds.length<=500,'Unknown bulk edit checkpoint');
    const request=value.sourceBulk.request;
    if(request!==undefined){assert.ok(isDatasetBulkEditRequest(request),'Unknown bulk edit input');if(request.target.id||request.draft.text)return true;}
  }
  if(value.drawer==='fine'&&(value.fine?.pointer||value.fine?.note||keys(value.fine?.values)))return true;
  if(value.drawer==='feedback'&&typeof value.feedback==='string'&&value.feedback.trim())return true;
  return Array.isArray(value.retainedInputs)&&value.retainedInputs.some(input=>workbenchHasUnfinishedInput(input,depth+1));
}

/** Compare field inputs with the saved configuration, including resets; search/selection are view preferences. */
export function sampleFieldCheckpointHasUnfinishedInput(value:unknown):boolean{
  assert.ok(object(value)&&value.version===1&&Array.isArray(value.drafts)&&object(value.baseConfiguration),'Unknown field checkpoint');
  if(typeof value.newId==='string'&&value.newId.trim())return true;
  const ids=new Set<string>();
  for(const draft of value.drafts){assert.ok(object(draft)&&typeof draft.id==='string'&&typeof draft.initial==='string','Unknown field draft');assert.equal(ids.has(draft.id),false,'Duplicate checkpoint field ID');ids.add(draft.id);
    const metadata=Object.hasOwn(value.baseConfiguration,draft.id)?value.baseConfiguration[draft.id] as DatasetFieldMetadata:undefined,baseline=createSampleFieldDraft(draft.id,metadata);
    if(canonical(fieldInput(draft))!==canonical(fieldInput(baseline)))return true;
  }
  return Object.keys(value.baseConfiguration).some(id=>!ids.has(id));
}
