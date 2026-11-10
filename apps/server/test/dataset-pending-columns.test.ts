import test from 'node:test';
import assert from 'node:assert/strict';
import type {DatasetOperation} from '../../../packages/shared/src/dataset.js';
import {datasetTableColumns,exposeNewDatasetColumns,pendingDatasetColumns,refreshedDatasetColumnVisibility,restoreDatasetColumnVisibility} from '../../web/src/dataset-pending-columns.js';

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

test('all configured columns appear initially while later deliberate hidden columns stay hidden',()=>{
  const columns=['id','text','score','skill_path','package_sha256','__bundle_provenance'].map(name=>({name,dtype:'str'})),base={columns,attachmentFields:['skill_path'],visible:['id'],knownSource:new Set(columns.map(column=>column.name)),knownConfigured:new Set(columns.map(column=>column.name))};
  const fields=Object.fromEntries(columns.map((column,order)=>[column.name,{order,width:{mode:'fixed' as const,value:100}}]));
  assert.deepEqual(refreshedDatasetColumnVisibility({...base,fields}).visible,['id']);
  assert.deepEqual(refreshedDatasetColumnVisibility({...base,fields,visible:[]}).visible,[]);
  const first=refreshedDatasetColumnVisibility({...base,fields,visible:[],knownSource:new Set(),knownConfigured:new Set()});
  assert.deepEqual(first.visible,columns.map(column=>column.name),'All explicitly configured fields are visible, including presentation-only settings');
});

test('a genuinely new logical source field or a new semantic configuration is exposed without reopening other hidden fields',()=>{
  const columns=[{name:'id',dtype:'str'},{name:'text',dtype:'str'},{name:'new_slot',dtype:'missing'}],base={columns,attachmentFields:[],visible:['id'],knownSource:new Set(['id','text']),knownConfigured:new Set(['id','text'])};
  const source=refreshedDatasetColumnVisibility({...base,fields:{id:{order:1},text:{order:2},new_slot:{order:0}}});
  assert.deepEqual(source.visible,['id','new_slot']);assert.deepEqual(source.configured,['id','text','new_slot']);
  const semantic=refreshedDatasetColumnVisibility({...base,knownSource:new Set(columns.map(column=>column.name)),knownConfigured:new Set(['id']),fields:{text:{displayName:'正文',order:0},id:{width:{mode:'fixed',value:100}}}});
  assert.deepEqual(semantic.visible,['id','text']);assert.deepEqual(semantic.configured,['text','id']);
});

test('old limited checkpoints expose the full source once and later checkpoints preserve explicit hiding',()=>{const columns=['id','text','extra'].map(name=>({name,dtype:'str'})),fields={text:{order:0},extra:{width:{mode:'fixed' as const,value:100}}};assert.deepEqual(restoreDatasetColumnVisibility(['id'],undefined,fields,columns),['id','text','extra']);assert.deepEqual(restoreDatasetColumnVisibility(['id'],['text','extra'],fields,columns,['id','text','extra']),['id']);assert.deepEqual(restoreDatasetColumnVisibility(['id'],['text'],fields,columns,['id','text','extra']),['id','extra']);});

test('the initial grid includes all source columns beyond six including attachments without custom presentation metadata',()=>{
  const names=['id','text','score','enabled','messages','note','extra','skill_path','package_sha256','__bundle_provenance'],columns=names.map(name=>({name,dtype:'str'}));
  assert.deepEqual(refreshedDatasetColumnVisibility({columns,fields:{},attachmentFields:['skill_path'],visible:[],knownSource:new Set(),knownConfigured:new Set()}).visible,names);
  assert.deepEqual(restoreDatasetColumnVisibility(['id'],[],{},columns),names,'Old automatically abbreviated layouts should not keep unconfigured fields invisible');
  assert.deepEqual(restoreDatasetColumnVisibility(['id'],[],{},columns,names),['id'],'A deliberate hide after viewing the full layout is retained');
});

test('project display policy masks old private column choices and show-all without changing export or retained preferences',()=>{
  const columns=['id','text','internal','new_slot'].map(name=>({name,dtype:'str'})),fields={id:{visible:true,export:false},text:{export:true},internal:{visible:false,export:true},new_slot:{visible:false}};
  const original=structuredClone(fields),visible=['internal','id'];
  assert.deepEqual(datasetTableColumns(columns,fields,visible).map(column=>column.name),['id']);
  assert.deepEqual(datasetTableColumns(columns,fields).map(column=>column.name),['id','text']);
  const restored=restoreDatasetColumnVisibility(visible,[],fields,columns,['id','text','internal']);
  assert.deepEqual(datasetTableColumns(columns,fields,restored).map(column=>column.name),['id','text']);
  assert.deepEqual(visible,['internal','id']);assert.deepEqual(fields,original);
  assert.deepEqual(datasetTableColumns(columns,{...fields,internal:{...fields.internal,visible:true}},visible).map(column=>column.name),['id','internal'],'Re-enabling follows the retained personal preference and project column order');
});

test('new staged keys still obey an existing project-hidden field definition',()=>{
  const base=[{name:'id',dtype:'str'}],columns=pendingDatasetColumns(base,[{op:'append',rowId:'new:one',record:{id:'one',hidden:'Synthetic hidden field',plain:'Synthetic visible field'}}]);
  const personal=exposeNewDatasetColumns(['id'],new Set(['id']),columns).visible;
  assert.deepEqual(datasetTableColumns(columns,{hidden:{visible:false}},personal).map(column=>column.name),['id','plain']);
  assert.deepEqual(datasetTableColumns(columns,undefined,personal).map(column=>column.name),['id','hidden','plain']);
});
