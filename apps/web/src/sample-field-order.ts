import {sampleFieldDraftHasConfiguration,type SampleFieldDraft} from './sample-field-config';
import type {DatasetFieldMetadata} from '../../../packages/shared/src/field-metadata';

/** Reorder only visible slots. Hidden fields, raw editor input and stable identities are retained. */
export function reorderSampleFieldDrafts(fields:readonly SampleFieldDraft[],visibleIds:readonly string[],sourceId:string,targetId:string,placement:'before'|'after'='before'):SampleFieldDraft[]{
  const visible=new Set(visibleIds),selected=fields.filter(field=>visible.has(field.id));
  const from=selected.findIndex(field=>field.id===sourceId),target=selected.findIndex(field=>field.id===targetId);
  if(from<0||target<0||sourceId===targetId)return [...fields];
  const next=[...selected],moved=next.splice(from,1)[0]!;
  const to=next.findIndex(field=>field.id===targetId)+(placement==='after'?1:0);next.splice(to,0,moved);
  if(next.every((field,index)=>field===selected[index]))return [...fields];
  if(fields.length>500)throw new Error('最多保存500个字段的展示配置；当前顺序未修改。');
  if(fields.some(field=>['__proto__','constructor','prototype'].includes(field.id.toLowerCase())))throw new Error('当前源记录包含对象保留字段ID，不能为它创建展示配置；当前顺序未修改。');
  let index=0;
  return fields.map(field=>visible.has(field.id)?next[index++]!:field).map((field,order)=>({...field,enabled:true,order}));
}

/** Reset positions only, retaining aliases, unfinished option values and newly added logical fields. */
export function resetSampleFieldDraftOrder(fields:readonly SampleFieldDraft[],savedIds:readonly string[],configuration:Readonly<Record<string,DatasetFieldMetadata>>):SampleFieldDraft[]{
  const byId=new Map(fields.map(field=>[field.id,field])),saved=new Set(savedIds),ids=[...savedIds.filter(id=>byId.has(id)),...fields.filter(field=>!saved.has(field.id)).map(field=>field.id)];
  return ids.map(id=>{
    const field={...byId.get(id)!},order=Object.hasOwn(configuration,id)?configuration[id]?.order:undefined;
    if(order===undefined)delete field.order;else field.order=order;
    if(!sampleFieldDraftHasConfiguration(field))field.enabled=false;
    return field;
  });
}
