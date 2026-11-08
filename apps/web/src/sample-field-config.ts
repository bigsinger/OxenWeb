import type {DatasetFieldMetadata,DatasetFieldOption,DatasetFieldType} from '../../../packages/shared/src/field-metadata';

export type SampleFieldControl='auto'|DatasetFieldType|'enum'|'multiselect';
export type SampleFieldScalar='auto'|'string'|'number'|'integer'|'boolean';
export interface SampleFieldOptionDraft{type:'string'|'number'|'boolean';text:string}
export interface SampleFieldDraft{
  id:string;enabled:boolean;displayName:string;description:string;displayNameSet:boolean;descriptionSet:boolean;
  control:SampleFieldControl;optionType:SampleFieldScalar;nullable:boolean;required:boolean;nullableSet:boolean;requiredSet:boolean;
  widthMode:'auto'|'fixed'|'weight';widthValue:string;
  options:SampleFieldOptionDraft[];original?:DatasetFieldMetadata;initial:string;
}
const copy=<T,>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
const signature=(draft:Omit<SampleFieldDraft,'initial'>|SampleFieldDraft)=>JSON.stringify({...draft,original:undefined,initial:undefined});
function scalar(value:DatasetFieldOption):SampleFieldOptionDraft{return {type:typeof value as SampleFieldOptionDraft['type'],text:typeof value==='string'?value:JSON.stringify(value)};}
export function createSampleFieldDraft(id:string,metadata?:DatasetFieldMetadata):SampleFieldDraft{
  const control:SampleFieldControl=metadata?.enum?'enum':metadata?.type==='array'&&metadata.items?.enum?'multiselect':metadata?.type??'auto';
  const optionType:SampleFieldScalar=control==='multiselect'||control==='array'?metadata?.items?.type??'auto':control==='enum'&&metadata?.type&&metadata.type!=='array'&&metadata.type!=='object'?metadata.type:'auto';
  const draft:SampleFieldDraft={id,enabled:metadata!==undefined,displayName:metadata?.displayName??'',description:metadata?.description??'',displayNameSet:metadata?.displayName!==undefined,descriptionSet:metadata?.description!==undefined,control,optionType,nullable:metadata?.nullable!==false,required:metadata?.required===true,nullableSet:metadata?.nullable!==undefined,requiredSet:metadata?.required!==undefined,widthMode:metadata?.width?.mode??'auto',widthValue:metadata?.width?String(metadata.width.value):'',options:(control==='multiselect'?metadata?.items?.enum:metadata?.enum)?.map(scalar)??[],...(metadata?{original:copy(metadata)}:{}),initial:''};
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
  const metadata:DatasetFieldMetadata={...(draft.displayNameSet?{displayName:draft.displayName}:{}),...(draft.descriptionSet?{description:draft.description}:{}),...(draft.nullableSet?{nullable:draft.nullable}:{}),...(draft.requiredSet?{required:draft.required}:{})};
  if(draft.widthMode!=='auto'){
    let value:unknown;try{value=JSON.parse(draft.widthValue);}catch{throw new Error('请填写有效列宽数值。');}
    if(typeof value!=='number'||!Number.isFinite(value))throw new Error('请填写有效列宽数值。');
    if(draft.widthMode==='fixed'&&(!Number.isSafeInteger(value)||value<48||value>2400))throw new Error('固定列宽须为48至2400之间的整数像素。');
    if(draft.widthMode==='weight'&&(value<=0||value>1000))throw new Error('列宽权重须大于0且不超过1000。');
    metadata.width={mode:draft.widthMode,value};
  }
  if(draft.control==='enum'||draft.control==='multiselect'){
    if(!draft.options.length)throw new Error('单选或多选字段至少需要一个选项。');
    const options=draft.options.map(optionValue),ids=options.map(value=>JSON.stringify(value));
    if(new Set(ids).size!==ids.length)throw new Error('选项原值不能重复。');
    if(draft.optionType!=='auto')for(const option of options){if(draft.optionType==='integer'?typeof option!=='number'||!Number.isSafeInteger(option):typeof option!==draft.optionType)throw new Error('选项原值类型与选项类型不一致，请明确修改原值或类型。');}
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
