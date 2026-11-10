import type {DatasetFieldMetadata} from './field-metadata.js';

/** Explicit positions precede unconfigured fields; equal/missing positions preserve input order. */
function ordered<T>(items:readonly T[],id:(item:T)=>string,fields?:Readonly<Record<string,DatasetFieldMetadata>>):T[]{
  return items.map((item,index)=>{
    const key=id(item),field=fields&&Object.hasOwn(fields,key)?fields[key]:undefined,position=field&&Object.hasOwn(field,'order')?field.order:undefined;
    const order=typeof position==='number'&&Number.isSafeInteger(position)&&position>=0?position:undefined;
    return {item,index,order};
  }).sort((a,b)=>a.order===undefined?b.order===undefined?a.index-b.index:1:b.order===undefined?-1:a.order-b.order||a.index-b.index).map(item=>item.item);
}
export function orderDatasetFields<T extends {id:string}>(fields:readonly T[],metadata?:Readonly<Record<string,DatasetFieldMetadata>>):T[]{return ordered(fields,field=>field.id,metadata);}
export function orderDatasetColumns<T extends {name:string}>(columns:readonly T[],metadata?:Readonly<Record<string,DatasetFieldMetadata>>):T[]{return ordered(columns,column=>column.name,metadata);}
