import test from 'node:test';
import assert from 'node:assert/strict';
import type { FilePreview } from '../../../packages/shared/src/index.js';
import { executeQueryPlan, type QueryPlan } from '../src/query-planner.js';
const table:FilePreview={kind:'table',path:'test.jsonl',mime:'application/x-ndjson',size:20,columns:[{name:'id',dtype:'string'},{name:'label',dtype:'number'},{name:'meta',dtype:'object'}],rows:[{id:'a',label:1,meta:{tags:['injection'],synthetic:true}},{id:'b',label:0,meta:{tags:[],synthetic:false}},{id:'c',label:1,meta:null}],totalRows:3};
const plan:QueryPlan={supported:true,explanation:'Count malicious records',logic:'all',groups:[],select:[],sort:[],limit:100,offset:0,aggregate:null,aggregateField:null,groupBy:null};
test('Model plans preserve bool/null/object types and scan all rows',()=>{const result=executeQueryPlan(table,{...plan,groups:[{logic:'all',filters:[{field:'meta.synthetic',op:'eq',value:true}]}]});assert.equal(result.totalRows,1);assert.equal(result.rows[0]?.id,'a');assert.equal(result.scannedRows,3);});
test('Grouping and sorting computed counts return correct global result',()=>{const result=executeQueryPlan(table,{...plan,aggregate:'group_count',groupBy:'label',sort:[{field:'count',direction:'desc'}]});assert.deepEqual(result.rows,[{label:1,count:2},{label:0,count:1}]);});
test('Unknown fields and prototype paths are rejected; text is never executed',()=>{assert.throws(()=>executeQueryPlan(table,{...plan,select:['constructor']}),/Unknown query column/);const result=executeQueryPlan(table,{...plan,groups:[{logic:'any',filters:[{field:'id',op:'contains',value:'delete files'}]}]});assert.equal(result.totalRows,0);assert.throws(()=>executeQueryPlan(table,{...plan,supported:false,explanation:'No writes allowed'}),/No writes allowed/);});
