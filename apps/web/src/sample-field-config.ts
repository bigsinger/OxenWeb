import type {DatasetFieldMetadata,DatasetFieldOption,DatasetFieldType} from '../../../packages/shared/src/field-metadata';

import {fieldOptionKey,nextFieldOptionColor,validFieldOptionColor} from '../../../packages/shared/src/field-option-colors';

export type SampleFieldControl='auto'|DatasetFieldType|'enum'|'multiselect';
export type SampleFieldScalar='auto'|'string'|'number'|'integer'|'boolean';
export interface SampleFieldOptionDraft{type:'string'|'number'|'boolean';text:string;color?:string}
export interface SampleFieldDraft{
  id:string;enabled:boolean;displayName:string;description:string;displayNameSet:boolean;descriptionSet:boolean;
  control:SampleFieldControl;optionType:SampleFieldScalar;nullable:boolean;required:boolean;nullableSet:boolean;requiredSet:boolean;
  order?:number;
  export?:boolean;
  visible?:boolean;
  options:SampleFieldOptionDraft[];original?:DatasetFieldMetadata;initial:string;
}
const copy=<T,>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
const signature=(draft:Omit<SampleFieldDraft,'initial'>|SampleFieldDraft)=>JSON.stringify({...draft,original:undefined,initial:undefined});
function scalar(value:DatasetFieldOption):SampleFieldOptionDraft{return {type:typeof value as SampleFieldOptionDraft['type'],text:typeof value==='string'?value:JSON.stringify(value)};}
export function createSampleFieldDraft(id:string,metadata?:DatasetFieldMetadata):SampleFieldDraft{
  const control:SampleFieldControl=metadata?.enum?'enum':metadata?.type==='array'&&metadata.items?.enum?'multiselect':metadata?.type??'auto';
  const optionType:SampleFieldScalar=control==='multiselect'||control==='array'?metadata?.items?.type??'auto':control==='enum'&&metadata?.type&&metadata.type!=='array'&&metadata.type!=='object'?metadata.type:'auto';
  const draft:SampleFieldDraft={id,enabled:metadata!==undefined,displayName:metadata?.displayName??'',description:metadata?.description??'',displayNameSet:metadata?.displayName!==undefined,descriptionSet:metadata?.description!==undefined,control,optionType,nullable:metadata?.nullable!==false,required:metadata?.required===true,nullableSet:metadata?.nullable!==undefined,requiredSet:metadata?.required!==undefined,options:(control==='multiselect'?metadata?.items?.enum:metadata?.enum)?.map(value=>({...scalar(value),...(metadata?.optionColors?.[fieldOptionKey(value)]?{color:metadata.optionColors[fieldOptionKey(value)]}:{})}))??[],...(metadata?{original:copy(metadata)}:{}),initial:''};
  if(metadata?.order!==undefined)draft.order=metadata.order;
  if(metadata?.export!==undefined)draft.export=metadata.export;
  if(metadata?.visible!==undefined)draft.visible=metadata.visible;
  draft.initial=signature(draft);return draft;
}
export function setSampleFieldControl(draft:SampleFieldDraft,control:SampleFieldControl){draft.enabled=true;draft.control=control;draft.optionType=control==='enum'||control==='multiselect'?'string':'auto';draft.options=[];}
function optionValue(option:SampleFieldOptionDraft):DatasetFieldOption{
  if(option.type==='string')return option.text;
  if(option.type==='boolean'){if(option.text==='true')return true;if(option.text==='false')return false;throw new Error('布尔选项只能是 true 或 false。');}
  if(!option.text.trim())throw new Error('数字选项不能为空。');
  let value:unknown;try{value=JSON.parse(option.text);}catch{throw new Error('请输入有效的 JSON 数字选项。');}
  if(typeof value!=='number'||!Number.isFinite(value))throw new Error('数字选项必须是有限数字。');
  return value;
}
export function sampleFieldMetadata(draft:SampleFieldDraft):DatasetFieldMetadata|undefined{
  if(!draft.enabled)return undefined;
  if(!draft.id||draft.id.length>500)throw new Error('字段 ID 不能为空，最多500个字符。');
  if(draft.displayName.length>120||draft.description.length>4000)throw new Error('显示名称最多120个字符，帮助说明最多4000个字符。');
  if(signature(draft)===draft.initial&&draft.original)return copy(draft.original);
  const metadata:DatasetFieldMetadata={...(draft.original?.globalField?{globalField:copy(draft.original.globalField)}:{}),...(draft.original?.width?{width:copy(draft.original.width)}:{}),...(draft.displayNameSet?{displayName:draft.displayName}:{}),...(draft.descriptionSet?{description:draft.description}:{}),...(draft.nullableSet?{nullable:draft.nullable}:{}),...(draft.requiredSet?{required:draft.required}:{})};
  if(draft.export!==undefined)metadata.export=draft.export;
  if(draft.visible!==undefined)metadata.visible=draft.visible;
  if(draft.order!==undefined){if(!Number.isSafeInteger(draft.order)||draft.order<0)throw new Error('字段顺序须为非负安全整数。');metadata.order=draft.order;}
  if(draft.control==='enum'||draft.control==='multiselect'){
    if(!draft.options.length)throw new Error('单选或多选字段至少需要一个选项。');
    const options=draft.options.map(optionValue),ids=options.map(value=>JSON.stringify(value));
    if(new Set(ids).size!==ids.length)throw new Error('选项原值不能重复。');
    if(draft.optionType!=='auto')for(const option of options){if(draft.optionType==='integer'?typeof option!=='number'||!Number.isSafeInteger(option):typeof option!==draft.optionType)throw new Error('选项原值类型与选项类型不一致，请明确修改原值或类型。');}
    const colors=Object.fromEntries(draft.options.flatMap((option,index)=>{if(option.color===undefined)return [];if(!validFieldOptionColor(option.color))throw new Error('选项颜色须为#RRGGBB。');return [[fieldOptionKey(options[index]!),option.color.toUpperCase()]];}));if(Object.keys(colors).length)metadata.optionColors=colors;
    // Choice names are owned by the catalog, not this project presentation form.
    // Retain labels only for exact typed choices still present after a local edit.
    const optionLabels=Object.fromEntries(options.flatMap(value=>{const key=fieldOptionKey(value),label=draft.original?.optionLabels?.[key];return label===undefined?[]:[[key,label]];}));
    if(Object.keys(optionLabels).length)metadata.optionLabels=optionLabels;
    if(draft.control==='multiselect'){metadata.type='array';metadata.items={...(draft.optionType!=='auto'?{type:draft.optionType}:{}),enum:options};}
    else{if(draft.optionType!=='auto')metadata.type=draft.optionType;metadata.enum=options;}
  }else if(draft.control!=='auto'){
    metadata.type=draft.control;
    if(draft.control==='array'&&draft.optionType!=='auto')metadata.items={type:draft.optionType};
  }
  return metadata;
}
export function sampleFieldConfiguration(drafts:SampleFieldDraft[]){
  const fields:Record<string,DatasetFieldMetadata>=Object.create(null);
  for(const draft of drafts){try{const metadata=sampleFieldMetadata(draft);if(metadata)fields[draft.id]=metadata;}catch(cause){throw new Error(`${draft.id}：${(cause as Error).message}`);}}
  if(Object.keys(fields).length>500)throw new Error('最多配置500个字段。');return fields;
}

export function sampleFieldDraftHasConfiguration(field:SampleFieldDraft):boolean{return !!(field.original||field.displayNameSet||field.descriptionSet||field.control!=='auto'||field.nullableSet||field.requiredSet||field.options.length||field.order!==undefined||field.export!==undefined||field.visible!==undefined);}
export function sampleFieldOptionColor(draft:SampleFieldDraft,index:number):string{const used:string[]=[];for(let position=0;position<=index;position++){const color=draft.options[position]?.color;used.push(validFieldOptionColor(color)?color:nextFieldOptionColor(used));}return used[index]??nextFieldOptionColor(used);}
export function newSampleFieldOption(draft:SampleFieldDraft):SampleFieldOptionDraft{const type=draft.optionType==='number'||draft.optionType==='integer'?'number':draft.optionType==='boolean'?'boolean':'string';return {type,text:type==='boolean'?'false':'',color:nextFieldOptionColor(draft.options.map((_option,index)=>sampleFieldOptionColor(draft,index)))};}
