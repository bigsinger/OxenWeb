import test from 'node:test';
import assert from 'node:assert/strict';
import {createSampleFieldDraft,sampleFieldConfiguration,setSampleFieldControl} from '../../web/src/sample-field-config.js';
import {parseSampleFieldCheckpoint,restoreSampleFieldCheckpoint,sampleFieldCheckpointChanges,type SampleFieldFormCheckpoint} from '../../web/src/sample-field-checkpoint.js';
import type {DatasetFieldsState} from '../../../packages/shared/src/dataset-field-types.js';

function fixture():{state:DatasetFieldsState;checkpoint:SampleFieldFormCheckpoint}{
  const configuration={title:{displayName:'标题',type:'string' as const},enabled:{type:'boolean' as const,nullable:false}};
  const state:DatasetFieldsState={ref:'review',commitId:'base',path:'samples.jsonl',totalRows:12,configuration,fields:Object.keys(configuration).map(id=>({id,inferredType:'value',present:12,missing:0,nulls:0,observedTypes:{}})),protectedFields:[],capabilities:{edit:true}};
  const checkpoint:SampleFieldFormCheckpoint={version:1,baseCommit:state.commitId,baseConfiguration:configuration,drafts:Object.entries(configuration).map(([id,metadata])=>createSampleFieldDraft(id,metadata)),selected:'title',search:'title',newId:'unfinished_new_field',message:'保留配置'};
  return {state,checkpoint};
}
test('unfinished options, invalid width, explicit blanks and boolean/null flags survive local checkpoint serialization',()=>{
  const {checkpoint,state}=fixture(),draft=checkpoint.drafts[0]!;setSampleFieldControl(draft,'enum');draft.options=[{type:'number',text:'-'},{type:'string',text:''},{type:'boolean',text:'false'}];draft.optionType='auto';draft.displayName='';draft.displayNameSet=true;draft.nullable=false;draft.nullableSet=true;draft.required=true;draft.requiredSet=true;draft.widthMode='fixed';draft.widthValue='12.';
  assert.throws(()=>sampleFieldConfiguration(checkpoint.drafts),'Half-complete forms are not valid committed fields');
  const roundtrip=parseSampleFieldCheckpoint(JSON.parse(JSON.stringify(checkpoint)));assert.deepEqual(roundtrip,checkpoint);
  const recovered=restoreSampleFieldCheckpoint(roundtrip,state);assert.deepEqual(recovered.drafts[0],draft);assert.equal(roundtrip.selected,'title');assert.equal(roundtrip.search,'title');assert.equal(roundtrip.newId,'unfinished_new_field');assert.equal(roundtrip.message,'保留配置');
});
test('sample-only commits allow recovery against latest commit and append newly observed fields',()=>{
  const {checkpoint,state}=fixture();checkpoint.drafts[0]!.description='未提交帮助';checkpoint.drafts[0]!.descriptionSet=true;
  const fresh={...state,commitId:'sample-commit',fields:[...state.fields,{id:'new_source',inferredType:'string',present:1,missing:11,nulls:0,observedTypes:{string:1}}]};
  assert.deepEqual(sampleFieldCheckpointChanges(checkpoint,fresh),[]);const result=restoreSampleFieldCheckpoint(checkpoint,fresh);assert.equal(result.advanced,true);assert.equal(result.drafts[0]!.description,'未提交帮助');assert.equal(result.drafts.at(-1)?.id,'new_source');assert.equal(result.drafts.at(-1)?.enabled,false);assert.equal(fresh.commitId,'sample-commit');
});
test('external config changes are detected and only locally changed fields replace latest after explicit recovery',()=>{
  const {checkpoint,state}=fixture();checkpoint.drafts[0]!.displayName='我的标题';checkpoint.drafts[0]!.displayNameSet=true;
  const fresh={...state,commitId:'config-commit',configuration:{title:{displayName:'他人标题',type:'string' as const},enabled:{type:'boolean' as const,nullable:true}}};
  assert.deepEqual(sampleFieldCheckpointChanges(checkpoint,fresh).map(item=>item.id),['title','enabled']);const result=restoreSampleFieldCheckpoint(checkpoint,fresh);assert.equal(result.drafts[0]!.displayName,'我的标题');assert.equal(result.drafts[1]!.nullable,true,'Untouched fields retain the latest external config');assert.equal(result.baseline[0]!.displayName,'他人标题');assert.equal(fresh.configuration.title.displayName,'他人标题','Recovery never mutates committed config');
});
test('unsupported payloads cannot be silently interpreted or applied',()=>{
  assert.throws(()=>parseSampleFieldCheckpoint({version:2}));const {checkpoint}=fixture();checkpoint.drafts[0]!.options=[{type:'string',text:''}];assert.doesNotThrow(()=>parseSampleFieldCheckpoint(checkpoint));assert.throws(()=>parseSampleFieldCheckpoint({...checkpoint,drafts:[checkpoint.drafts[0],checkpoint.drafts[0]]}));
});
