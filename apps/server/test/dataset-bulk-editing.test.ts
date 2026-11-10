import test from 'node:test';
import assert from 'node:assert/strict';
import {bulkLabelDefinition,datasetBulkDraftLimitIssue,emptyDatasetBulkEditRequest,isDatasetBulkEditRequest,planDatasetBulkEdit,stageDatasetBulkPlan,type DatasetBulkContext,type DatasetBulkEditRequest} from '../../web/src/dataset-bulk-editing.js';
import type {DatasetOperation} from '../../../packages/shared/src/dataset.js';
import {fieldOptionKey} from '../../../packages/shared/src/field-option-colors.js';
import {workbenchHasUnfinishedInput} from '../../../scripts/analysis/field-adoption-inputs.js';

function context():DatasetBulkContext{return {selectedIds:['a','b','c'],identityField:'id',sourceFieldIds:['id','quality','purposes','optional','required','ground_truth'],fields:{quality:{type:'string',enum:['normal','gold']},purposes:{type:'array',items:{type:'string',enum:['regression','smoke','training']}},optional:{type:'string',nullable:true},required:{type:'boolean',nullable:false,required:true}},labelColumns:[{id:'risk',name:'风险',type:'single',scopes:['row'],options:[{value:'benign',displayName:'正常'},{value:'uncertain',displayName:'不确定'},{value:'old',displayName:'旧',deprecated:true}]},{id:'channels',name:'渠道',type:'multi',scopes:['row'],options:[{value:'internal',displayName:'内部'},{value:'synthetic',displayName:'合成'}]}],rows:[{id:'a',record:{id:'a',quality:'normal',purposes:['regression'],optional:'keep',required:true,ground_truth:'original',unrelated:'kept'},labels:{risk:'benign',channels:['internal']},canEdit:true,canAssign:true,expectedContentHash:'base-a'},{id:'b',record:{id:'b',quality:'normal',purposes:['regression','smoke'],required:true},labels:{risk:'benign',channels:['internal','synthetic']},canEdit:false,canAssign:true,expectedContentHash:'base-b'},{id:'c',record:{id:'c',quality:'gold',purposes:[],required:false},labels:{risk:'uncertain'},canEdit:true,canAssign:false,expectedContentHash:'base-c'}]};}
function request(scope:'source'|'label',id:string,text:string,action:DatasetBulkEditRequest['action']='replace',kind:DatasetBulkEditRequest['draft']['kind']='string'):DatasetBulkEditRequest{return {target:{scope,id},action,draft:{kind,text,presence:'value'}};}

test('bulk source change uses exact stable selection, reports permissions/noops and leaves all inputs untouched',()=>{
  const value=context(),before=JSON.stringify(value),plan=planDatasetBulkEdit(value,request('source','quality','gold'));
  assert.deepEqual(plan.selectedIds,['a','b','c']);assert.deepEqual(plan.eligibleIds,['a','c']);assert.deepEqual(plan.changes.map(row=>row.id),['a']);assert.deepEqual(plan.unchangedIds,['c']);assert.deepEqual(plan.excluded.map(row=>row.id),['b']);
  assert.equal(plan.operations.length,1);const operation=plan.operations[0]!;assert.equal(operation.op,'update');if(operation.op==='update'){assert.equal(operation.expectedContentHash,'base-a');assert.equal(operation.record.unrelated,'kept');assert.equal(operation.record.ground_truth,'original');}
  assert.equal(JSON.stringify(value),before);
});
test('multi option add/remove/replace/clear retains unrelated choices and primitive types',()=>{
  const value=context();value.selectedIds=['a'];
  const get=(input:DatasetBulkEditRequest)=>{const operation=planDatasetBulkEdit(value,input).operations[0];return operation?.op==='update'?operation.record.purposes:undefined;};
  assert.deepEqual(get(request('source','purposes','["smoke"]','add','array')),['regression','smoke']);assert.deepEqual(get(request('source','purposes','["regression"]','remove','array')),[]);
  assert.deepEqual(get(request('source','purposes','["training"]','replace','array')),['training']);assert.deepEqual(get(request('source','purposes','ignored','clear','array')),[]);
  assert.throws(()=>get(request('source','purposes','[]','add','array')),/至少选择/);
  value.fields.purposes={type:'array',items:{enum:[1,'1',true]}};value.rows[0]!.record!.purposes=[1];assert.deepEqual(get(request('source','purposes','["1",true]','add','array')),[1,'1',true]);
});
test('removing options from unclassified rows leaves missing/null values and empty own opinions unchanged',()=>{
  const value=context();value.selectedIds=['a'];delete value.rows[0]!.record!.purposes;
  assert.equal(planDatasetBulkEdit(value,request('source','purposes','["smoke"]','remove','array')).operations.length,0);
  value.rows[0]!.record!.purposes=null;assert.equal(planDatasetBulkEdit(value,request('source','purposes','["smoke"]','remove','array')).operations.length,0);
  value.rows[0]!.labels={};assert.equal(planDatasetBulkEdit(value,request('label','channels','["synthetic"]','remove','array')).operations.length,0);
});
test('bulk null/missing are distinct; required, enum and protected identities/truth cannot bypass validation',()=>{
  const value=context();value.selectedIds=['a'];
  const nullPlan=planDatasetBulkEdit(value,request('source','optional','','null')),missingPlan=planDatasetBulkEdit(value,request('source','optional','','missing'));
  assert.deepEqual(nullPlan.changes[0]!.after,{present:true,value:null});assert.deepEqual(missingPlan.changes[0]!.after,{present:false});
  for(const id of ['id','ground_truth'])assert.throws(()=>planDatasetBulkEdit(value,request('source',id,'changed')),/不能批量修改/);
  assert.throws(()=>planDatasetBulkEdit(value,request('source','quality','arbitrary')),/配置中的选项/);
  assert.throws(()=>planDatasetBulkEdit(value,request('source','required','','null')),/不允许 null/);assert.throws(()=>planDatasetBulkEdit(value,request('source','required','','missing')),/必须提供/);
});
test('missing or duplicated selection blocks the batch instead of silently editing the visible subset',()=>{
  const value=context();value.selectedIds=['a','missing'];assert.throws(()=>planDatasetBulkEdit(value,request('source','quality','gold')),/尚未读取/);
  value.selectedIds=['a','a'];assert.throws(()=>planDatasetBulkEdit(value,request('source','quality','gold')),/身份重复/);
  value.selectedIds=Array.from({length:501},(_,index)=>String(index));assert.throws(()=>planDatasetBulkEdit(value,request('source','quality','gold')),/1–500/);
});
test('human labels modify only own chosen dimension; explicit null clears and deprecated new opinions reject',()=>{
  const value=context(),plan=planDatasetBulkEdit(value,request('label','channels','["synthetic"]','add','array'));
  assert.deepEqual(plan.changes.map(row=>row.id),['a']);assert.deepEqual(plan.unchangedIds,['b']);assert.deepEqual(plan.excluded.map(row=>row.id),['c']);
  assert.deepEqual(plan.operations,[{op:'assign',scope:'row',rowId:'a',values:{channels:['internal','synthetic']}}]);
  value.selectedIds=['a'];assert.deepEqual(planDatasetBulkEdit(value,request('label','channels','','clear')).operations,[{op:'assign',scope:'row',rowId:'a',values:{channels:null}}]);
  assert.throws(()=>planDatasetBulkEdit(value,request('label','risk','old')),/已弃用/);
  const definition=bulkLabelDefinition(value.labelColumns[0]!);assert.equal(definition.optionLabels?.[fieldOptionKey('benign')],'正常');
});
test('confirmed plans coalesce with existing appends, retain original CAS and preserve other labels/spans',()=>{
  const value=context();value.selectedIds=['a'];value.rows[0]!.record!.unrelated='already edited';
  const pending:DatasetOperation[]=[{op:'update',rowId:'a',record:{...value.rows[0]!.record!},expectedContentHash:'original-hash'},{op:'append',rowId:'new',record:{id:'new',quality:'normal'}},{op:'assign',scope:'row',rowId:'a',values:{risk:'uncertain'},spans:[{id:'span',pointer:'/text',sourceHash:'0'.repeat(64),start:0,end:1,values:{}}]}];
  const original=JSON.stringify(pending),merged=stageDatasetBulkPlan(pending,planDatasetBulkEdit(value,request('source','quality','gold'))),update=merged.find(operation=>operation.op==='update');
  assert.equal(update?.op==='update'&&update.expectedContentHash,'original-hash');assert.equal(update?.op==='update'&&update.record.unrelated,'already edited');assert.equal(JSON.stringify(pending),original);
  const labeled=stageDatasetBulkPlan(merged,planDatasetBulkEdit(value,request('label','channels','','clear'))),assignment=labeled.find(operation=>operation.op==='assign');
  assert.deepEqual(assignment?.op==='assign'&&assignment.values,{risk:'uncertain',channels:null});assert.equal(assignment?.op==='assign'&&assignment.spans?.length,1);
  value.selectedIds=['new'];value.rows=[{id:'new',record:{id:'new',quality:'normal',required:true},canEdit:true,canAssign:true}];
  const appended=stageDatasetBulkPlan(pending,planDatasetBulkEdit(value,request('source','quality','gold')));assert.equal(appended.filter(operation=>operation.op==='append').length,1);assert.equal(appended.filter(operation=>operation.op==='update'&&operation.rowId==='new').length,0);assert.equal(appended.find(operation=>operation.op==='append')?.record.quality,'gold');
});
test('raw unfinished bulk input validates structure without parsing away invalid text',()=>{
  const empty=emptyDatasetBulkEditRequest();assert.equal(isDatasetBulkEditRequest(empty),true);const invalid=request('source','required','{unfinished','replace','boolean');assert.equal(isDatasetBulkEditRequest(invalid),true);
  assert.equal(isDatasetBulkEditRequest({...invalid,draft:{...invalid.draft,kind:'arbitrary'}}),false);
});
test('preview accounts for existing draft operations before admitting a new batch',()=>{
  const value=context();value.selectedIds=['a'];const plan=planDatasetBulkEdit(value,request('label','risk','uncertain'));
  const pending:DatasetOperation[]=Array.from({length:500},(_,index)=>({op:'update',rowId:'other-'+index,record:{id:'other-'+index}}));
  assert.match(datasetBulkDraftLimitIssue(pending,plan)??'',/501.*500/);assert.equal(datasetBulkDraftLimitIssue(pending.slice(0,499),plan),undefined);
  const sameRow:DatasetOperation[]=[...pending.slice(0,499),{op:'assign',scope:'row',rowId:'a',values:{channels:['internal']}}];assert.equal(datasetBulkDraftLimitIssue(sameRow,plan),undefined);
});
test('real schema adoption preflight keeps unfinished bulk input protected without flagging an empty selection form',()=>{
  const blank={version:2,operations:[],sourceBulk:{request:emptyDatasetBulkEditRequest(),rowIds:['a']}};
  assert.equal(workbenchHasUnfinishedInput(blank),false);
  assert.equal(workbenchHasUnfinishedInput({...blank,sourceBulk:{request:request('source','quality','invalid'),rowIds:['a']}}),true);
  assert.equal(workbenchHasUnfinishedInput({...blank,sourceBulk:{request:request('label','risk','','clear'),rowIds:['a']}}),true);
  assert.throws(()=>workbenchHasUnfinishedInput({...blank,sourceBulk:{request:{invalid:true},rowIds:['a']}}),/Unknown bulk/);
});
