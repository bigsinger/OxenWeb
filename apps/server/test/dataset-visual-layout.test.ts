import assert from 'node:assert/strict';
import test from 'node:test';
import {reactive} from 'vue';
import {datasetVisualColumns,datasetVisualWidths,emptyDatasetVisualLayout,moveDatasetVisualColumn,orderDatasetVisualColumns,parseDatasetVisualLayout,sourceLayoutKey,datasetVisualLayoutSignature,datasetVisualLayoutPayload} from '../../web/src/dataset-visual-layout.js';

test('default annotation position follows id, with namespaced system columns immune to source collisions',()=>{
  const columns=datasetVisualColumns([{name:'title'},{name:'id'},{name:'system:actor'}],[{id:'evaluation.family_id',name:'家族',widthToken:'x'}]);
  assert.deepEqual(columns.map(item=>item.key),['source:title','source:id','system:human-labels',sourceLayoutKey('system:actor'),'system:family','system:updated-at','system:actor']);
  assert.equal(new Set(columns.map(item=>item.key)).size,columns.length);
  assert.equal(datasetVisualColumns([{name:'title'}],[])[0]!.kind,'labels');
  assert.notEqual(sourceLayoutKey('\ud800'),sourceLayoutKey('\ufffd'));
  const long=sourceLayoutKey('字'.repeat(500));assert.ok(long.length>500);assert.ok(parseDatasetVisualLayout({version:1,order:[long],widths:{[long]:100}}));
});
test('users can move substantive system columns explicitly while missing and hidden preferences survive',()=>{
  const layout={...emptyDatasetVisualLayout(),order:['source:a','source:hidden','source:b','system:human-labels','system:actor','source:not-present']};
  const moved=moveDatasetVisualColumn(layout,['source:a','source:hidden','source:b','system:human-labels','system:actor'],'system:actor','source:a');
  assert.deepEqual(moved.order,['system:actor','source:a','source:hidden','source:b','system:human-labels','source:not-present']);
  assert.deepEqual(orderDatasetVisualColumns([{key:'source:a'},{key:'source:b'},{key:'system:actor'}],moved.order).map(item=>item.key),['system:actor','source:a','source:b']);
  assert.equal(moveDatasetVisualColumn(layout,['source:a'],'unknown','source:a'),layout);
});
test('dragging after a target and back again gives deterministic visible order',()=>{
  const ids=['source:id','system:human-labels','source:title','system:actor'];
  const moved=moveDatasetVisualColumn(emptyDatasetVisualLayout(),ids,'source:id','source:title',true);
  assert.deepEqual(moved.order,['system:human-labels','source:title','source:id','system:actor']);
  const back=moveDatasetVisualColumn(moved,ids,'source:id','system:human-labels');assert.deepEqual(back.order,ids);
});
test('direct widths remain exact pixels for both source and system columns and do not squeeze to a viewport',()=>{
  const layout={...emptyDatasetVisualLayout(),widths:{'source:text':1000,'system:human-labels':320}};
  const result=datasetVisualWidths([{key:'source:id',natural:80},{key:'source:text',natural:344},{key:'system:human-labels',natural:190}],layout);
  assert.deepEqual(result.widths,{'source:id':80,'source:text':1000,'system:human-labels':320});assert.equal(result.total,1496);
  assert.equal(datasetVisualWidths([{key:'x',natural:3000}],emptyDatasetVisualLayout()).widths.x,500);
});
test('stored layout parser rejects malformed, duplicated and out-of-bound widths without mutating input',()=>{
  const original={version:1,order:['source:id'],widths:{'source:id':72}},bytes=JSON.stringify(original);assert.deepEqual(parseDatasetVisualLayout(original),original);assert.equal(JSON.stringify(original),bytes);
  assert.equal(parseDatasetVisualLayout({...original,order:['x','x']}),undefined);
  assert.equal(parseDatasetVisualLayout({...original,widths:{x:71}}),undefined);assert.equal(parseDatasetVisualLayout({...original,widths:{x:1201}}),undefined);assert.equal(parseDatasetVisualLayout({...original,widths:{x:100.2}}),undefined);
  assert.equal(parseDatasetVisualLayout({...original,widths:[]}),undefined);
  const wide=datasetVisualColumns(Array.from({length:500},(_,index)=>({name:'field_'+index})),[]);assert.equal(wide.length,503);assert.ok(parseDatasetVisualLayout({version:1,order:wide.map(column=>column.key),widths:Object.fromEntries(wide.map(column=>[column.key,100]))}));
});
test('width-key serialization order alone is not an unsaved change, but reordered columns are',()=>{
  const a={version:1 as const,order:['a','b'],widths:{a:100,b:200}},b={...a,widths:{b:200,a:100}};assert.equal(datasetVisualLayoutSignature(a),datasetVisualLayoutSignature(b));assert.notEqual(datasetVisualLayoutSignature(a),datasetVisualLayoutSignature({...b,order:['b','a']}));
});
test('saving a reactive layout creates a plain detached transport payload without DataCloneError',()=>{
  const layout=reactive({version:1 as const,order:['source:id','system:actor'],widths:{'source:id':222}});
  const payload=datasetVisualLayoutPayload(layout);assert.doesNotThrow(()=>structuredClone(payload));assert.deepEqual(JSON.parse(JSON.stringify(payload)),{version:1,order:['source:id','system:actor'],widths:{'source:id':222}});
  layout.order.reverse();layout.widths['source:id']=333;assert.deepEqual(payload.order,['source:id','system:actor']);assert.equal(payload.widths['source:id'],222,'A later drag cannot mutate an in-flight save');
});
