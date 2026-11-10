import {datasetValueType,resolveDatasetFieldMetadata,type DatasetFieldMetadata} from '../../../packages/shared/src/field-metadata';
import {orderDatasetFields} from '../../../packages/shared/src/field-order';
import {datasetFieldOptionLabel} from '../../../packages/shared/src/field-option-labels';

export interface DatasetPropertyRow {
  id:string; displayName?:string; description?:string; type:string; declaredType?:string;
  present:boolean; value:unknown; text:string; optionLabel?:string; long:boolean;
}

/** A missing property, a JSON null and an empty string have different source meanings. */
export function datasetPropertyText(value:unknown,present=true):string {
  if(!present)return '（未设置）';
  if(value===null)return 'null';
  if(value==='')return '（空字符串）';
  if(typeof value==='string')return value;
  return JSON.stringify(value,null,2)??String(value);
}

/** Descriptor-only fields stay visible here even when a particular source record omits the key. */
export function datasetPropertyRows(record:Readonly<Record<string,unknown>>,fields?:Readonly<Record<string,DatasetFieldMetadata>>):DatasetPropertyRow[] {
  const ids=[...new Set([...Object.keys(record),...Object.keys(fields??{})])];
  return orderDatasetFields(ids.map(id=>{
    const present=Object.hasOwn(record,id),value=present?record[id]:undefined;
    const metadata=fields&&Object.hasOwn(fields,id)?fields[id]:undefined;
    const text=datasetPropertyText(value,present),optionLabel=datasetFieldOptionLabel(metadata,value);
    return {...resolveDatasetFieldMetadata(id,fields),present,value,text,
      type:present?datasetValueType(value):'未设置',declaredType:metadata?.type,
      ...(optionLabel?{optionLabel}:{}),long:text.length>480||text.split('\n').length>6};
  }),fields);
}

/** Search describes fields; it neither executes text nor changes the underlying record or schema. */
export function filterDatasetProperties(rows:readonly DatasetPropertyRow[],query:string,alphabetical=false):DatasetPropertyRow[] {
  const needle=query.trim().toLocaleLowerCase();
  const result=rows.filter(row=>!needle||[row.id,row.displayName,row.description,row.type,row.declaredType].some(value=>value?.toLocaleLowerCase().includes(needle)));
  return alphabetical?[...result].sort((a,b)=>a.id.localeCompare(b.id,'en',{numeric:true})):result;
}
