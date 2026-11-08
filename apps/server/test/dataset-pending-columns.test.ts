import test from 'node:test';
import assert from 'node:assert/strict';
import type {DatasetOperation} from '../../../packages/shared/src/dataset.js';
import {exposeNewDatasetColumns,pendingDatasetColumns} from '../../web/src/dataset-pending-columns.js';

test('an empty baseline immediately projects the first staged sample own fields and JSON types without a query',()=>{
  const record=Object.assign(Object.create({inherited:'must not be a source column'}),{id:'first',text:'Synthetic first sample',score:0,enabled:false,items:['a'],detail:{value:1},note:null});
  const columns=pendingDatasetColumns([],[{op:'append',rowId:'new:first',record}]);
  assert.deepEqual(columns,[{name:'id',dtype:'str'},{name:'text',dtype:'str'},{name:'score',dtype:'i64'},{name:'enabled',dtype:'bool'},{name:'items',dtype:'list'},{name:'detail',dtype:'struct'},{name:'note',dtype:'null'}]);
  assert.deepEqual(exposeNewDatasetColumns([],new Set(),columns).visible,['id','text','score','enabled','items','detail','note']);
});
test('new staged fields appear once while existing configured types and user-hidden columns remain unchanged',()=>{
  const base=[{name:'id',dtype:'str'},{name:'text',dtype:'str'},{name:'score',dtype:'integer'}],operations:DatasetOperation[]=[{op:'update',rowId:'one',record:{id:'one',text:'Changed',score:1,new_value:1}},{op:'append',rowId:'two',record:{id:'two',new_value:2.5}}];
  const columns=pendingDatasetColumns(base,operations),next=exposeNewDatasetColumns(['id'],new Set(base.map(column=>column.name)),columns);
  assert.equal(columns.find(column=>column.name==='score')?.dtype,'integer');assert.equal(columns.find(column=>column.name==='new_value')?.dtype,'f64');assert.deepEqual(next.visible,['id','new_value']);
  assert.deepEqual(exposeNewDatasetColumns(['id'],next.known,pendingDatasetColumns(base,operations)).visible,['id'],'Re-editing a now-hidden staged field must not expose it again');
});
