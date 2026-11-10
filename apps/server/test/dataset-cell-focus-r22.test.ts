import test from 'node:test';
import assert from 'node:assert/strict';
import {restoreDatasetCellFocus,type DatasetCellFocusState} from '../../web/src/dataset-cell-focus.js';

function fixture(){let finish!:()=>void;const rendered=new Promise<void>(resolve=>{finish=resolve;}),intent={rowId:'stable:row"one',field:'literal.dot',context:'project-a/main/commit-a/page-1',request:3},state:DatasetCellFocusState={context:intent.context,request:intent.request,editorOpen:false,blocked:false,focus:'document',originConnected:false},original={rowId:intent.rowId,field:intent.field},other={rowId:'other-row',field:'other-field'},cells=[other,original],focused:unknown[]=[];return {intent,state,original,other,cells,focused,finish,actions:{nextRender:()=>rendered,state:()=>state,findCell:(rowId:string,field:string)=>cells.find(cell=>cell.rowId===rowId&&cell.field===field),focus:(cell:unknown)=>{focused.push(cell);}}};}

test('save or cancel waits for the editor DOM removal and returns focus to its exact stable sample/field',async()=>{const f=fixture(),result=restoreDatasetCellFocus(f.intent,f.actions);assert.deepEqual(f.focused,[]);f.finish();assert.equal(await result,true);assert.deepEqual(f.focused,[f.original]);});

test('reordering rows or columns cannot redirect restored focus to the previous visual position',async()=>{const f=fixture(),result=restoreDatasetCellFocus(f.intent,f.actions);f.cells.reverse();f.cells.unshift({rowId:f.intent.rowId,field:'neighbor-column'});f.finish();assert.equal(await result,true);assert.deepEqual(f.focused,[f.original]);assert.notEqual(f.focused[0],f.cells[0]);});

test('a filtered-out row or hidden/deleted field never falls back to a different cell',async()=>{for(const removed of ['row','field']){const f=fixture(),result=restoreDatasetCellFocus(f.intent,f.actions);f.cells.splice(f.cells.indexOf(f.original),1);if(removed==='field')f.cells.push({rowId:f.intent.rowId,field:'another-field'});else f.cells.push({rowId:'replacement-at-same-index',field:f.intent.field});f.finish();assert.equal(await result,false);assert.deepEqual(f.focused,[]);}});

test('late render completion after project/branch/page context change or a newer editor request cannot steal focus',async()=>{for(const change of ['context','request'] as const){const f=fixture(),result=restoreDatasetCellFocus(f.intent,f.actions);if(change==='context')f.state.context='project-b/dev/commit-b/page-2';else f.state.request++;f.finish();assert.equal(await result,false);assert.deepEqual(f.focused,[]);}});

test('explicitly focused controls and an existing modal/editor retain their focus ownership',async()=>{for(const change of ['elsewhere','editor','modal','connected-origin'] as const){const f=fixture(),result=restoreDatasetCellFocus(f.intent,f.actions);if(change==='elsewhere')f.state.focus='elsewhere';else if(change==='editor')f.state.editorOpen=true;else if(change==='modal')f.state.blocked=true;else f.state.originConnected=true;f.finish();assert.equal(await result,false);assert.deepEqual(f.focused,[]);}});

test('an unchanged owned cell/control may restore without needing a disconnected-element fallback',async()=>{const f=fixture();f.state.focus='origin';f.state.originConnected=true;const result=restoreDatasetCellFocus(f.intent,f.actions);f.finish();assert.equal(await result,true);assert.deepEqual(f.focused,[f.original]);});
