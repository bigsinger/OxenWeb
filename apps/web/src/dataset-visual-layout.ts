export interface DatasetVisualLayout {version:1;order:string[];widths:Record<string,number>}
export type DatasetVisualColumn<T extends {name:string}, E extends {id:string;name:string;widthToken:string}> =
  | {kind:'source';key:string;column:T}
  | {kind:'labels';key:'system:human-labels'}
  | {kind:'evaluation';key:string;column:E}
  | {kind:'system';key:string;column:{id:'system.updated_at'|'system.actor';name:string}};
export function sourceLayoutKey(name:string){try{return 'source:'+encodeURIComponent(name);}catch{return 'source:invalid-utf16:'+Array.from({length:name.length},(_,index)=>name.charCodeAt(index).toString(16).padStart(4,'0')).join('');}}
export const emptyDatasetVisualLayout=():DatasetVisualLayout=>({version:1,order:[],widths:{}});
/** Copy the plain transport shape; Vue's reactive proxies cannot be structured-cloned. */
export function datasetVisualLayoutPayload(layout:DatasetVisualLayout):DatasetVisualLayout{return {version:1,order:[...layout.order],widths:Object.fromEntries(Object.entries(layout.widths))};}
export function parseDatasetVisualLayout(value:unknown):DatasetVisualLayout|undefined{
  if(!value||typeof value!=='object'||Array.isArray(value))return;
  const item=value as DatasetVisualLayout;
  if(item.version!==1||!Array.isArray(item.order)||item.order.length>520||new Set(item.order).size!==item.order.length||item.order.some(id=>typeof id!=='string'||!id||id.length>6000)||!item.widths||typeof item.widths!=='object'||Array.isArray(item.widths)||Object.keys(item.widths).length>520)return;
  if(Object.entries(item.widths).some(([id,width])=>!id||id.length>6000||!Number.isInteger(width)||width<72||width>1200))return;
  return {version:1,order:[...item.order],widths:Object.fromEntries(Object.entries(item.widths))};
}
export function datasetVisualLayoutSignature(layout:DatasetVisualLayout){return JSON.stringify({order:layout.order,widths:Object.fromEntries(Object.entries(layout.widths).sort(([a],[b])=>a.localeCompare(b)))});}
/** Column IDs are namespaced, so a source key cannot impersonate a system column. */
export function datasetVisualColumns<T extends {name:string},E extends {id:string;name:string;widthToken:string}>(sources:T[],evaluation:E[]):DatasetVisualColumn<T,E>[]{
  const columns:DatasetVisualColumn<T,E>[]=sources.map(column=>({kind:'source',key:sourceLayoutKey(column.name),column}));
  columns.splice(sources.findIndex(column=>column.name==='id')+1,0,{kind:'labels',key:'system:human-labels'});
  for(const column of evaluation)columns.push({kind:'evaluation',key:column.id==='evaluation.family_id'?'system:family':column.id==='evaluation.visibility'?'system:evaluation-visibility':'system:evaluation-suites',column});
  columns.push({kind:'system',key:'system:updated-at',column:{id:'system.updated_at',name:'最后修改时间'}},{kind:'system',key:'system:actor',column:{id:'system.actor',name:'最后操作人'}});
  return columns;
}
export function orderDatasetVisualColumns<T extends {key:string}>(columns:T[],order:readonly string[]):T[]{
  const positions=new Map(order.map((id,index)=>[id,index]));
  return columns.map((column,index)=>({column,index,position:positions.get(column.key)})).sort((a,b)=>a.position===undefined?b.position===undefined?a.index-b.index:1:b.position===undefined?-1:a.position-b.position).map(item=>item.column);
}
/** Hidden and not-currently-present preferences survive a drag on the visible subset. */
export function moveDatasetVisualColumn(layout:DatasetVisualLayout,defaultKeys:readonly string[],from:string,to:string,after=false):DatasetVisualLayout{
  if(from===to||!defaultKeys.includes(from)||!defaultKeys.includes(to))return layout;
  const known=orderDatasetVisualColumns(defaultKeys.map(key=>({key})),layout.order).map(column=>column.key),rest=layout.order.filter(key=>!defaultKeys.includes(key));
  const next=known.filter(key=>key!==from),at=next.indexOf(to);next.splice(at+(after?1:0),0,from);
  return {...layout,order:[...next,...rest]};
}
export const clampDatasetVisualWidth=(width:number)=>Math.round(Math.max(72,Math.min(1200,width)));
/** Exact pixel widths; the table's sum can exceed the viewport. No weighted allocation. */
export function datasetVisualWidths(columns:Array<{key:string;natural:number}>,layout:DatasetVisualLayout,utilityWidth=96){
  const widths=Object.fromEntries(columns.map(column=>[column.key,clampDatasetVisualWidth(layout.widths[column.key]??Math.min(500,column.natural))]));
  return {widths,total:utilityWidth+Object.values(widths).reduce((sum,value)=>sum+value,0)};
}
