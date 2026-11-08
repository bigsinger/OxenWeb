import test from 'node:test';
import assert from 'node:assert/strict';
import {createSampleFieldDraft,sampleFieldConfiguration,sampleFieldMetadata,setSampleFieldControl} from '../../web/src/sample-field-config.js';
import type {DatasetFieldMetadata} from '../../../packages/shared/src/field-metadata.js';

test('opening field settings round-trips explicit metadata without defaults or value conversion',()=>{
  const configuration:Record<string,DatasetFieldMetadata>={title:{displayName:'标题'},empty:{displayName:'',description:'',nullable:false,required:true},priority:{type:'string',enum:['normal','high','']},category:{type:'array',items:{type:'string',enum:['alpha','beta']}},mixed:{enum:[false,0,'0']},plain:{}};
  const drafts=Object.entries(configuration).map(([id,metadata])=>createSampleFieldDraft(id,metadata));
  assert.deepEqual(JSON.parse(JSON.stringify(sampleFieldConfiguration(drafts))),configuration);
  assert.deepEqual(sampleFieldMetadata(createSampleFieldDraft('unknown')),undefined,'Unconfigured source fields do not become constraints on open');
  assert.deepEqual(configuration.priority!.enum,['normal','high',''],'The source definition is never mutated');
});

test('editing aliases and nullability preserves separate missing, null and empty-string semantics',()=>{
  const draft=createSampleFieldDraft('title',{type:'string'});
  draft.displayName='';draft.displayNameSet=true;draft.description='说明';draft.descriptionSet=true;
  draft.required=true;draft.requiredSet=true;draft.nullable=true;draft.nullableSet=true;
  assert.deepEqual(sampleFieldMetadata(draft),{displayName:'',description:'说明',nullable:true,required:true,type:'string'});
  const newField=createSampleFieldDraft('review_note',{});
  assert.deepEqual(sampleFieldMetadata(newField),{},'New logical fields have no default source value or forced required/null constraints');
});

test('enum options retain raw number, boolean and string values rather than casting',()=>{
  const draft=createSampleFieldDraft('result',{});setSampleFieldControl(draft,'enum');draft.optionType='auto';
  draft.options=[{type:'boolean',text:'false'},{type:'number',text:'0'},{type:'string',text:'0'},{type:'string',text:''}];
  assert.deepEqual(sampleFieldMetadata(draft),{enum:[false,0,'0','']});
  draft.optionType='number';assert.throws(()=>sampleFieldMetadata(draft),/类型不一致/);
  draft.options=[{type:'number',text:'"1"'}];assert.throws(()=>sampleFieldMetadata(draft),/有限数字/);
  draft.options=[{type:'number',text:'1e999'}];assert.throws(()=>sampleFieldMetadata(draft),/有限数字/);
  draft.options=[{type:'number',text:''}];assert.throws(()=>sampleFieldMetadata(draft),/不能为空/);
  draft.options=[{type:'boolean',text:'0'}];assert.throws(()=>sampleFieldMetadata(draft),/true 或 false/);
});

test('multi-select and explicit type changes produce independent constraints and reject duplicate/invalid values',()=>{
  const draft=createSampleFieldDraft('categories',{});setSampleFieldControl(draft,'multiselect');
  draft.options=[{type:'string',text:'alpha'},{type:'string',text:'beta'}];
  assert.deepEqual(sampleFieldMetadata(draft),{type:'array',items:{type:'string',enum:['alpha','beta']}});
  draft.options.push({type:'string',text:'alpha'});assert.throws(()=>sampleFieldMetadata(draft),/不能重复/);
  setSampleFieldControl(draft,'integer');assert.deepEqual(sampleFieldMetadata(draft),{type:'integer'});
  setSampleFieldControl(draft,'enum');draft.optionType='integer';draft.options=[{type:'number',text:'1.5'}];assert.throws(()=>sampleFieldMetadata(draft),/类型不一致/);
  setSampleFieldControl(draft,'multiselect');assert.throws(()=>sampleFieldMetadata(draft),/至少需要一个选项/);
  draft.enabled=false;assert.deepEqual(Object.keys(sampleFieldConfiguration([draft])),[],'Removing config never removes the source field');
});

test('presentation widths round-trip without changing constraints and use bounded numeric units',()=>{
  const metadata:DatasetFieldMetadata={type:'string',enum:[''],nullable:false,width:{mode:'fixed',value:240}};
  const draft=createSampleFieldDraft('title',metadata);assert.deepEqual(sampleFieldMetadata(draft),metadata);
  draft.widthMode='weight';draft.widthValue='5';assert.deepEqual(sampleFieldMetadata(draft),{type:'string',enum:[''],nullable:false,width:{mode:'weight',value:5}});
  draft.widthMode='auto';assert.deepEqual(sampleFieldMetadata(draft),{type:'string',enum:[''],nullable:false},'Auto removes only presentation width');
  draft.widthMode='fixed';for(const value of ['47','2401','1.5','"120"','','0x40']){draft.widthValue=value;assert.throws(()=>sampleFieldMetadata(draft));}
  for(const value of ['48','2400']){draft.widthValue=value;assert.equal(sampleFieldMetadata(draft)?.width?.value,Number(value));}
  draft.widthMode='weight';for(const value of ['0','-1','1001','true','Infinity']){draft.widthValue=value;assert.throws(()=>sampleFieldMetadata(draft));}
  draft.widthValue='0.25';assert.equal(sampleFieldMetadata(draft)?.width?.value,.25);
});
