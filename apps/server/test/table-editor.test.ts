import test from 'node:test';
import assert from 'node:assert/strict';
import {applyTableOperations,moveRowLabels} from '../src/table-editor.js';
import {stableRowIds} from '../src/jsonl.js';
test('JSONL edits preserve nested types and move row annotations with the edited item',()=>{
 const rows=[{id:'a',text:'old',meta:{safe:false}},{id:'b',text:'keep',meta:null}];const ids=stableRowIds(rows);
 const result=applyTableOperations(rows,[{op:'update',rowId:ids[0]!,record:{id:'a',text:'new',meta:{safe:true}}},{op:'add-column',name:'review',value:null}]);
 const labels=moveRowLabels({version:1,columns:[{id:'status',name:'状态',type:'single',options:[{value:'checked'}]}],assignments:[{id:'old',scope:'row',path:'a.jsonl',rowId:ids[0]!,values:{status:'checked'}}]},'a.jsonl',result.mapping);
 assert.equal(labels.assignments[0]?.rowId,stableRowIds(result.rows)[0]);assert.deepEqual(result.rows[0]?.meta,{safe:true});assert.equal(result.rows[0]?.review,null);assert.equal(rows[0]?.text,'old');
});
test('Deleted rows remove their labels; stale rows and duplicate columns fail',()=>{
 const rows=[{id:'a'},{id:'b'}],ids=stableRowIds(rows);const result=applyTableOperations(rows,[{op:'delete',rowId:ids[0]!}]);assert.equal(result.rows.length,1);assert.equal(result.mapping.has(ids[0]!),false);
 assert.throws(()=>applyTableOperations(rows,[{op:'update',rowId:'stale',record:{}}]),/目标行/);assert.throws(()=>applyTableOperations(rows,[{op:'add-column',name:'id',value:null}]),/已经存在|已存在/);
});
