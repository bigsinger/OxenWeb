import type {DatasetFieldMetadata} from '../../../packages/shared/src/field-metadata';
import type {DatasetFieldsState} from '../../../packages/shared/src/dataset-field-types';
import {createSampleFieldDraft,type SampleFieldDraft} from './sample-field-config';

/** Local form state, including intentionally unfinished controls, is separate from committed metadata. */
export interface SampleFieldFormCheckpoint {
  version:1;baseCommit:string;baseConfiguration:Record<string,DatasetFieldMetadata>;drafts:SampleFieldDraft[];
  selected:string;search:string;newId:string;message:string;
}
const clone=<T,>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
function canonical(value:unknown):string{
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>JSON.stringify(key)+':'+canonical(item)).join(',')+'}';
  return JSON.stringify(value)??'undefined';
}
const isObject=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const ownField=(fields:Record<string,DatasetFieldMetadata>,id:string)=>Object.hasOwn(fields,id)?fields[id]:undefined;
const controls=new Set(['auto','string','number','integer','boolean','array','object','enum','multiselect']);
const scalars=new Set(['auto','string','number','integer','boolean']);
export function parseSampleFieldCheckpoint(value:unknown):SampleFieldFormCheckpoint{
  if(!isObject(value)||value.version!==1||typeof value.baseCommit!=='string'||!isObject(value.baseConfiguration)||!Array.isArray(value.drafts)||value.drafts.length>500)throw new Error('配置草稿格式不受支持；尚未覆盖或删除原草稿。');
  for(const key of ['selected','search','newId','message'])if(typeof value[key]!=='string')throw new Error('配置草稿的页面状态不完整。');
  const ids=new Set<string>();
  for(const field of value.drafts){
    if(!isObject(field)||typeof field.id!=='string'||!field.id||ids.has(field.id)||!Array.isArray(field.options)||!controls.has(String(field.control))||!scalars.has(String(field.optionType))||!['auto','fixed','weight'].includes(String(field.widthMode)))throw new Error('配置草稿包含无法识别的字段控件。');
    ids.add(field.id);
    for(const key of ['displayName','description','initial','widthValue'])if(typeof field[key]!=='string')throw new Error('配置草稿的字段输入不完整。');
    for(const key of ['enabled','displayNameSet','descriptionSet','nullable','required','nullableSet','requiredSet'])if(typeof field[key]!=='boolean')throw new Error('配置草稿的显式字段状态不完整。');
    for(const option of field.options)if(!isObject(option)||!['string','number','boolean'].includes(String(option.type))||typeof option.text!=='string')throw new Error('配置草稿的原始选项输入不完整。');
  }
  return clone(value as unknown as SampleFieldFormCheckpoint);
}
export function sampleFieldCheckpointChanges(checkpoint:SampleFieldFormCheckpoint,current:DatasetFieldsState){
  const ids=[...new Set([...Object.keys(checkpoint.baseConfiguration),...Object.keys(current.configuration)])];
  return ids.filter(id=>canonical(ownField(checkpoint.baseConfiguration,id))!==canonical(ownField(current.configuration,id))).map(id=>({id,before:ownField(checkpoint.baseConfiguration,id),current:ownField(current.configuration,id)}));
}
/** Only locally edited fields replace fresh config after an explicit external-change decision. */
export function restoreSampleFieldCheckpoint(checkpoint:SampleFieldFormCheckpoint,current:DatasetFieldsState){
  const oldDrafts=new Map(checkpoint.drafts.map(field=>[field.id,field])),ids=[...checkpoint.drafts.map(field=>field.id),...current.fields.map(field=>field.id).filter(id=>!oldDrafts.has(id))];
  const baseline=ids.map(id=>createSampleFieldDraft(id,ownField(current.configuration,id)));
  const drafts=baseline.map(fresh=>{
    const prior=oldDrafts.get(fresh.id);if(!prior)return fresh;
    const oldBaseline=createSampleFieldDraft(fresh.id,ownField(checkpoint.baseConfiguration,fresh.id));
    return canonical(prior)===canonical(oldBaseline)?fresh:clone(prior);
  });
  return {drafts,baseline,configurationChanges:sampleFieldCheckpointChanges(checkpoint,current),advanced:checkpoint.baseCommit!==current.commitId};
}
