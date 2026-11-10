import test from 'node:test';
import assert from 'node:assert/strict';
import {datasetGridHeader,datasetInspectorOutsideAction,openDatasetInspectorRow,openDatasetRowLabelEditor,populatedDatasetLabels} from '../../web/src/dataset-grid-ui.js';
import {orderDatasetColumns} from '../../../packages/shared/src/field-order.js';

test('sequence clicks switch the already-open inspector without a close or query while body/outside clicks close it',async()=>{
  let selected='first',open=true,closes=0;
  const before=datasetInspectorOutsideAction(open,{insideInspector:false,sequenceTrigger:true,otherDialog:false});if(before==='close'){open=false;closes++;}
  assert.equal(await openDatasetInspectorRow('second',{context:()=>1,select:async id=>{selected=id;return true;},open:()=>{open=true;}}),true);
  assert.equal(selected,'second');assert.equal(open,true);assert.equal(closes,0);
  assert.equal(datasetInspectorOutsideAction(open,{insideInspector:false,sequenceTrigger:false,otherDialog:false}),'close');
  assert.equal(datasetInspectorOutsideAction(open,{insideInspector:true,sequenceTrigger:false,otherDialog:false}),'keep');
  assert.equal(datasetInspectorOutsideAction(open,{insideInspector:false,sequenceTrigger:false,otherDialog:true}),'keep');
});
test('invalid raw input blocks row switching without closing an existing inspector or replacing its selection',async()=>{
  let selected='first',open=true,generation=1;
  assert.equal(await openDatasetInspectorRow('second',{context:()=>generation,select:async()=>false,open:()=>{selected='second';open=true;}}),false);
  assert.equal(selected,'first');assert.equal(open,true);
  assert.equal(await openDatasetInspectorRow('second',{context:()=>generation,select:async()=>{generation++;return true;},open:()=>{selected='second';}}),false);
  assert.equal(selected,'first');
});
test('table headers retain source IDs, use configured/common aliases and help, and never invent unknown aliases',()=>{
  const configured=datasetGridHeader('lang',{lang:{displayName:'语言',description:'源样本的语言代码'}});
  assert.equal(configured.id,'lang');assert.equal(configured.displayName,'语言');assert.match(configured.title,/源样本的语言代码/);assert.match(configured.sortName,/lang（语言）/);
  assert.equal(datasetGridHeader('title').displayName,'标题');
  assert.equal(datasetGridHeader('unknown_source_field').displayName,undefined);
  assert.equal(datasetGridHeader('title',{title:{displayName:''}}).displayName,undefined);
});
test('project field order remains authoritative when the private checkpoint keeps a different visible-field sequence',()=>{
  const columns=[{name:'id'},{name:'body'},{name:'score'}],visibleFromCheckpoint=['score','id','body'];
  const shown=orderDatasetColumns(columns,{body:{order:0},id:{order:1},score:{order:2}}).filter(column=>visibleFromCheckpoint.includes(column.name));
  assert.deepEqual(shown.map(column=>column.name),['body','id','score']);assert.deepEqual(columns.map(column=>column.name),['id','body','score']);
});

test('explicit row label editing opens independently while invalid content, revoked scope and context changes block it',async()=>{
  let selected='one',opened=0,generation=1,allowed=true;
  const actions={context:()=>generation,mayAssign:()=>allowed,select:async(id:string)=>{selected=id;return true;},open:()=>{opened++;}};
  assert.equal(await openDatasetRowLabelEditor('two',actions),true);assert.equal(selected,'two');assert.equal(opened,1);
  assert.equal(await openDatasetRowLabelEditor('three',{...actions,select:async()=>false}),false);assert.equal(selected,'two');assert.equal(opened,1,'An invalid source edit stays active instead of opening another sample editor');
  allowed=false;assert.equal(await openDatasetRowLabelEditor('three',actions),false);assert.equal(selected,'two');
  allowed=true;assert.equal(await openDatasetRowLabelEditor('three',{...actions,select:async()=>{allowed=false;return true;}}),false);assert.equal(opened,1,'Permissions are rechecked after asynchronous selection');
  allowed=true;assert.equal(await openDatasetRowLabelEditor('three',{...actions,select:async()=>{generation++;return true;}}),false);assert.equal(opened,1);
});

test('clearing text, multi-choice or single-choice labels removes empty chips without treating uncertain as empty',()=>{
  const values={risk:'uncertain',empty:null,text:'',multi:[],sources:['synthetic']};
  assert.deepEqual(populatedDatasetLabels(values),{risk:'uncertain',sources:['synthetic']});assert.equal(values.empty,null);
});
