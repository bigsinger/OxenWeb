import test from 'node:test';
import assert from 'node:assert/strict';
import {orderDatasetColumns,orderDatasetFields} from '../../../packages/shared/src/field-order.js';
import {semanticDatasetFields,type DatasetFieldMetadata} from '../../../packages/shared/src/field-metadata.js';
import {createSampleFieldDraft,sampleFieldConfiguration} from '../../web/src/sample-field-config.js';
import {reorderSampleFieldDrafts,resetSampleFieldDraftOrder} from '../../web/src/sample-field-order.js';
import {parseSampleFieldCheckpoint,restoreSampleFieldCheckpoint,type SampleFieldFormCheckpoint} from '../../web/src/sample-field-checkpoint.js';
import type {DatasetFieldsState} from '../../../packages/shared/src/dataset-field-types.js';

test('source-column order is stable, exact-ID based and presentation only',()=>{
  const columns=['id','title','prompt','extra','later'].map(name=>({name,dtype:'string'})),before=JSON.stringify(columns);
  const metadata:Record<string,DatasetFieldMetadata>={prompt:{order:0},title:{order:0},id:{order:2,width:{mode:'fixed',value:80}},extra:{type:'string'}};
  assert.deepEqual(orderDatasetColumns(columns,metadata).map(field=>field.name),['title','prompt','id','extra','later']);
  assert.deepEqual(orderDatasetFields(columns.map(field=>({id:field.name})),metadata).map(field=>field.id),['title','prompt','id','extra','later']);
  assert.equal(JSON.stringify(columns),before);assert.deepEqual(semanticDatasetFields(metadata),{extra:{type:'string'}});
  assert.deepEqual(orderDatasetColumns(columns,{prompt:{order:-1},id:{order:Number.NaN}}).map(field=>field.name),columns.map(field=>field.name));
  assert.deepEqual(orderDatasetColumns(columns,Object.create({prompt:{order:0}})).map(field=>field.name),columns.map(field=>field.name),'Inherited metadata never changes source order');
  assert.deepEqual(orderDatasetColumns(columns,{prompt:Object.create({order:0})}).map(field=>field.name),columns.map(field=>field.name),'Inherited positions are not an explicit display choice');
});

test('filtered drag and keyboard moves retain every hidden field and all unfinished form values',()=>{
  const fields=['id','first','hidden','second','tail'].map(id=>createSampleFieldDraft(id));
  const edited=fields[1]!;edited.enabled=true;edited.displayName='';edited.displayNameSet=true;edited.control='enum';edited.optionType='auto';edited.options=[{type:'number',text:'-'},{type:'boolean',text:'false'},{type:'string',text:''}];edited.nullable=false;edited.nullableSet=true;
  const before=JSON.stringify(fields),moved=reorderSampleFieldDrafts(fields,['first','second'],'second','first','before');
  assert.deepEqual(moved.map(field=>field.id),['id','second','hidden','first','tail']);assert.equal(moved[2]!.id,'hidden');assert.equal(moved[4]!.id,'tail');
  assert.deepEqual(moved.map(field=>field.order),[0,1,2,3,4]);assert.deepEqual(moved[3]!.options,edited.options);assert.equal(moved[3]!.displayName,'');assert.equal(moved[3]!.nullable,false);assert.equal(JSON.stringify(fields),before);
  const back=reorderSampleFieldDrafts(moved,['second','first'],'second','first','after');assert.deepEqual(back.map(field=>field.id),fields.map(field=>field.id));
  assert.equal(reorderSampleFieldDrafts(fields,['first','second'],'first','second','before').every((field,index)=>field===fields[index]),true,'A no-op causes no new field metadata');
  assert.deepEqual(reorderSampleFieldDrafts(fields,['first','second'],'missing','first').map(field=>field.id),fields.map(field=>field.id));
});

test('order-only metadata round-trips, reset restores saved positions without dropping content drafts',()=>{
  const configuration:Record<string,DatasetFieldMetadata>={prompt:{displayName:'正文',order:0},id:{order:1}};
  const fields=['prompt','id','new'].map(id=>createSampleFieldDraft(id,id==='new'?{}:configuration[id]));fields[0]!.description='未保存帮助';fields[0]!.descriptionSet=true;
  const moved=reorderSampleFieldDrafts(fields,fields.map(field=>field.id),'id','prompt');
  assert.equal(sampleFieldConfiguration(moved).id!.order,0);assert.equal(sampleFieldConfiguration(moved).prompt!.order,1);
  const reset=resetSampleFieldDraftOrder(moved,['prompt','id'],configuration);
  assert.deepEqual(reset.map(field=>field.id),['prompt','id','new']);assert.equal(reset[0]!.description,'未保存帮助');assert.equal(reset[0]!.order,0);assert.equal(reset[2]!.enabled,true,'New logical fields are not discarded by resetting positions');
  assert.equal(reset[2]!.order,undefined);assert.equal(sampleFieldConfiguration(reset).prompt!.description,'未保存帮助');
});

test('checkpoint recovery preserves the original reordered raw array across a sample-only commit',()=>{
  const configuration={title:{displayName:'标题'}},fields=['id','title','hidden','prompt'].map(id=>createSampleFieldDraft(id,Object.hasOwn(configuration,id)?configuration[id as 'title']:undefined));
  const moved=reorderSampleFieldDrafts(fields,['title','prompt'],'prompt','title');moved[1]!.control='enum';moved[1]!.options=[{type:'number',text:'-'}];
  const checkpoint:SampleFieldFormCheckpoint={version:1,baseCommit:'old',baseConfiguration:configuration,drafts:moved,selected:'prompt',search:'p',newId:'pending',message:'排序稍后保存'};
  const stored=parseSampleFieldCheckpoint(JSON.parse(JSON.stringify(checkpoint))),current:DatasetFieldsState={ref:'main',commitId:'sample-commit',path:'samples.jsonl',totalRows:2,configuration,fields:fields.map(field=>({id:field.id,inferredType:'string',present:2,missing:0,nulls:0,observedTypes:{}})),protectedFields:[],capabilities:{edit:true}};
  const restored=restoreSampleFieldCheckpoint(stored,current);assert.deepEqual(restored.drafts.map(field=>field.id),moved.map(field=>field.id));assert.deepEqual(restored.drafts.map(field=>field.order),moved.map(field=>field.order));assert.equal(restored.drafts[1]!.options[0]!.text,'-');assert.equal(restored.advanced,true);assert.deepEqual(restored.configurationChanges,[]);
});
