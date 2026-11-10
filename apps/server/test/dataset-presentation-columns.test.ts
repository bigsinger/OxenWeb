import test from 'node:test';
import assert from 'node:assert/strict';
import {datasetPresentationColumns} from '../../web/src/dataset-presentation-columns.js';
import {datasetTableColumns} from '../../web/src/dataset-pending-columns.js';

const order=(columns:ReturnType<typeof datasetPresentationColumns>)=>columns.map(item=>item.kind==='labels'?'人工标签':item.column.name);

test('human labels follow the visible id without changing the configured source order or references',()=>{
  const source=[{name:'score',dtype:'i64'},{name:'id',dtype:'str'},{name:'content',dtype:'str'}],copy=structuredClone(source);
  const columns=datasetPresentationColumns(source);
  assert.deepEqual(order(columns),['score','id','人工标签','content']);assert.deepEqual(source,copy);
  assert.equal(columns[0]?.kind==='source'&&columns[0].column,source[0]);
  assert.equal(columns[1]?.kind==='source'&&columns[1].column,source[1]);
});

test('an absent, project-hidden or personally-hidden id leaves labels immediately after the sequence controls',()=>{
  const source=[{name:'id'},{name:'content'},{name:'score'}];
  assert.deepEqual(order(datasetPresentationColumns(datasetTableColumns(source,{id:{visible:false}}))),['人工标签','content','score']);
  assert.deepEqual(order(datasetPresentationColumns(datasetTableColumns(source,{},['content','score']))),['人工标签','content','score']);
  assert.deepEqual(order(datasetPresentationColumns([{name:'uid'},{name:'title'}])),['人工标签','uid','title']);
  assert.deepEqual(order(datasetPresentationColumns([])),['人工标签']);
});

test('source names cannot collide with the system label slot and a final id still anchors annotations',()=>{
  const columns=datasetPresentationColumns([{name:'system:human-labels'},{name:'id'}]);
  assert.deepEqual(order(columns),['system:human-labels','id','人工标签']);
  assert.equal(new Set(columns.map(item=>item.key)).size,columns.length);
});
