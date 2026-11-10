export interface DatasetCellFocusIntent {rowId:string;field:string;context:string;request:number}
export interface DatasetCellFocusState {context:string;request:number;editorOpen:boolean;blocked:boolean;focus:'origin'|'document'|'elsewhere';originConnected:boolean}
/** Restore by stable sample/field identity only, after Vue has removed the owned editor. */
export async function restoreDatasetCellFocus<T>(intent:DatasetCellFocusIntent,actions:{nextRender:()=>Promise<unknown>;state:()=>DatasetCellFocusState;findCell:(rowId:string,field:string)=>T|undefined;focus:(cell:T)=>void}):Promise<boolean>{
  await actions.nextRender();const state=actions.state();
  if(state.context!==intent.context||state.request!==intent.request||state.editorOpen||state.blocked)return false;
  if(state.focus!=='origin'&&!(state.focus==='document'&&!state.originConnected))return false;
  const cell=actions.findCell(intent.rowId,intent.field);if(!cell)return false;actions.focus(cell);return true;
}
