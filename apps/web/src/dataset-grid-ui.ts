import {resolveDatasetFieldMetadata,type DatasetFieldMetadata} from '../../../packages/shared/src/field-metadata';

export function datasetGridHeader(id:string,fields?:Readonly<Record<string,DatasetFieldMetadata>>){
  const metadata=resolveDatasetFieldMetadata(id,fields),name=id+(metadata.displayName?`（${metadata.displayName}）`: '');
  return {...metadata,title:[name,metadata.description,'点击按全部匹配样本排序：升序、降序、清除。'].filter(Boolean).join('\n'),sortName:`按 ${name} 排序`};
}
/** The drawer is non-modal: exposed sequence buttons must keep it open before switching rows. */
export function datasetInspectorOutsideAction(open:boolean,target:{insideInspector:boolean;sequenceTrigger:boolean;otherDialog:boolean}):'keep'|'close'{
  return open&&!target.insideInspector&&!target.sequenceTrigger&&!target.otherDialog?'close':'keep';
}
export async function openDatasetInspectorRow(id:string,actions:{context:()=>unknown;select:(id:string)=>Promise<boolean>;open:()=>void}):Promise<boolean>{
  const context=actions.context();if(!await actions.select(id)||context!==actions.context())return false;actions.open();return true;
}

/** Editing a label is an explicit action, independent from opening the content inspector. */
export async function openDatasetRowLabelEditor(id:string,actions:{context:()=>unknown;mayAssign:(id:string)=>boolean;select:(id:string)=>Promise<boolean>;open:()=>void}):Promise<boolean>{
  if(!actions.mayAssign(id))return false;
  const context=actions.context();
  if(!await actions.select(id)||context!==actions.context()||!actions.mayAssign(id))return false;
  actions.open();return true;
}

export function populatedDatasetLabels(values:Readonly<Record<string,string|string[]|null>>):Record<string,string|string[]>{
  return Object.fromEntries(Object.entries(values).filter((entry):entry is [string,string|string[]]=>entry[1]!==null&&entry[1]!==''&&(!Array.isArray(entry[1])||entry[1].length>0)));
}
