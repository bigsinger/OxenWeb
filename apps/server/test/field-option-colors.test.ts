import test from 'node:test';
import assert from 'node:assert/strict';
import {fieldOptionKey,datasetFieldOptionColor,nextFieldOptionColor} from '../../../packages/shared/src/field-option-colors.js';
import {semanticDatasetFields} from '../../../packages/shared/src/field-metadata.js';
import {datasetFieldMetadataSchema} from '../src/dataset-field-schema.js';
import {createSampleFieldDraft,newSampleFieldOption,sampleFieldMetadata} from '../../web/src/sample-field-config.js';

test('new option defaults are distinct, custom colors retain typed values and colors do not affect semantic rules',()=>{
  const draft=createSampleFieldDraft('status',{});draft.control='enum';draft.optionType='auto';
  for(const [type,text]of [['boolean','false'],['number','0'],['string','0']] as const){const option=newSampleFieldOption(draft);option.type=type;option.text=text;draft.options.push(option);}
  assert.equal(new Set(draft.options.map(option=>option.color)).size,3);draft.options[1]!.color='#abcdef';
  const metadata=sampleFieldMetadata(draft)!;assert.deepEqual(metadata.enum,[false,0,'0']);assert.equal(metadata.optionColors?.[fieldOptionKey(0)],'#ABCDEF');assert.notEqual(metadata.optionColors?.[fieldOptionKey(0)],metadata.optionColors?.[fieldOptionKey('0')]);
  assert.equal(datasetFieldOptionColor(metadata,0),'#ABCDEF');assert.equal(datasetFieldOptionColor(metadata,'unconfigured'),undefined);assert.deepEqual(semanticDatasetFields({status:metadata}),{status:{enum:[false,0,'0']}});
  assert.deepEqual(sampleFieldMetadata(createSampleFieldDraft('status',metadata)),metadata);
  const many:string[]=[];for(let index=0;index<200;index++)many.push(nextFieldOptionColor(many));assert.equal(new Set(many).size,200);
});

test('server rejects CSS injection and option-color keys outside the declared choices while allowing multiselect colors',()=>{
  const good={type:'array',items:{type:'string',enum:['a','b']},optionColors:{[fieldOptionKey('a')]:'#88aacc'}};
  assert.equal(datasetFieldMetadataSchema.safeParse(good).success,true);
  assert.equal(datasetFieldMetadataSchema.safeParse({...good,optionColors:{[fieldOptionKey('a')]:'red;display:none'}}).success,false);
  assert.equal(datasetFieldMetadataSchema.safeParse({...good,optionColors:{[fieldOptionKey('missing')]:'#88aacc'}}).success,false);
  assert.equal(datasetFieldMetadataSchema.safeParse({optionColors:{[fieldOptionKey('a')]:'#88aacc'}}).success,false);
  assert.equal(datasetFieldOptionColor({type:'array',items:{enum:['a','b']}},'a'),nextFieldOptionColor());
});
