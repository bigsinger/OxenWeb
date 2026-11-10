import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,realpath,rm} from 'node:fs/promises';
import path from 'node:path';
import {DemoProvider} from '../src/demo.js';
import {DatasetService} from '../src/dataset.js';
import {DatasetFieldsService,datasetFieldsSaveSchema} from '../src/dataset-fields.js';
import {DatasetDraftService,datasetDraftSchemaHashes} from '../src/dataset-drafts.js';
import {sampleTemplateHash} from '../src/workflow.js';
import {projectReleaseFields} from '../src/release-field-projection.js';
import type {RequestIdentity} from '../../../packages/shared/src/index.js';
import {createSampleFieldDraft,sampleFieldMetadata} from '../../web/src/sample-field-config.js';
import {resetSampleFieldDraftOrder} from '../../web/src/sample-field-order.js';
import {parseSampleFieldCheckpoint,restoreSampleFieldCheckpoint,type SampleFieldFormCheckpoint} from '../../web/src/sample-field-checkpoint.js';
import type {DatasetFieldsState} from '../../../packages/shared/src/dataset-field-types.js';

test('source visibility defaults to shown and remains independent from field export through checkpoint and order reset',()=>{
 const defaults=createSampleFieldDraft('text');assert.notEqual(defaults.visible,false);assert.equal(sampleFieldMetadata(defaults),undefined);
 for(const selected of [false,true]){
  const draft=createSampleFieldDraft('text');
  draft.enabled=true;draft.visible=selected;draft.export=!selected;
  assert.equal(draft.enabled,true);assert.deepEqual(sampleFieldMetadata(draft),{export:!selected,visible:selected});
  draft.order=0;const [reset]=resetSampleFieldDraftOrder([draft],['text'],{});assert.deepEqual(sampleFieldMetadata(reset!),{export:!selected,visible:selected});
  const checkpoint:SampleFieldFormCheckpoint={version:1,baseCommit:'synthetic-base',baseConfiguration:{},drafts:[reset!],selected:'text',search:'',newId:'',message:'Synthetic visibility preference'};
  const parsed=parseSampleFieldCheckpoint(JSON.parse(JSON.stringify(checkpoint)));assert.equal(parsed.drafts[0]!.visible,selected);assert.equal(parsed.drafts[0]!.export,!selected);
  assert.throws(()=>parseSampleFieldCheckpoint({...checkpoint,drafts:[{...reset,visible:'false'}]}));
 }
 for(const value of ['false',0,null,{}])assert.equal(datasetFieldsSaveSchema.safeParse({ref:'main',expectedCommit:'synthetic-base',fields:{text:{visible:value}}}).success,false);
});

test('an untouched field checkpoint takes the latest visibility while local changes remain explicitly recoverable',()=>{
 const configuration={text:{type:'string' as const,export:true}},draft=createSampleFieldDraft('text',configuration.text);
 const checkpoint:SampleFieldFormCheckpoint={version:1,baseCommit:'before',baseConfiguration:configuration,drafts:[draft],selected:'text',search:'',newId:'',message:'Synthetic field visibility'};
 const state:DatasetFieldsState={ref:'main',commitId:'after',path:'samples.jsonl',totalRows:1,configuration:{text:{...configuration.text,visible:false}},fields:[{id:'text',present:1,missing:0,nulls:0,inferredType:'string',observedTypes:{string:1}}],protectedFields:[],capabilities:{edit:true}};
 const untouched=restoreSampleFieldCheckpoint(parseSampleFieldCheckpoint(checkpoint),state);assert.equal(untouched.drafts[0]!.visible,false);assert.equal(untouched.drafts[0]!.export,true);
 draft.visible=true;const changed=restoreSampleFieldCheckpoint(parseSampleFieldCheckpoint(checkpoint),state);assert.equal(changed.drafts[0]!.visible,true);assert.equal(changed.baseline[0]!.visible,false);assert.equal(state.configuration.text!.visible,false,'Restoration never changes the committed field definition');
});

test('visibility-only field commits preserve source, search, review semantics and private sample drafts',async t=>{
 const root=path.resolve('.data/tests');await mkdir(root,{recursive:true});const directory=await mkdtemp(path.join(root,'r13-field-visibility-'));
 t.after(async()=>{const actual=await realpath(directory);assert.equal(path.dirname(actual),await realpath(root));await rm(actual,{recursive:true,force:true});});
 const provider=new DemoProvider(path.join(directory,'demo.json'));await provider.init();const key={namespace:'local',repo:'synthetic-visible-fields'};await provider.createRepo({namespace:key.namespace,name:key.repo,description:'Synthetic visibility fixture'});
 const owner:RequestIdentity={id:'owner',name:'Synthetic owner',kind:'owner',source:'local'},datasets=new DatasetService(provider),access={requireCapability:async()=>{}},before=await datasets.initialize(key,owner,{ref:'main',expectedCommit:(await provider.branches(key))[0]!.commitId,rows:[{id:'one',text:'Synthetic searchable hidden-table content'},{id:'two',text:'Synthetic second record'}]});
 const drafts=new DatasetDraftService(datasets,path.join(directory,'drafts')),rowId=before.rowIds[0]!,draft=(await drafts.save(key,owner,{ref:'main',expectedCommit:before.commitId,draftRevision:0,operations:[{op:'update',rowId,record:{...before.rows[0],text:'Uncommitted synthetic text'}}]})).draft!;
 let presentationChecks=0;const fields=new DatasetFieldsService({provider,datasets,access,beforeSave:async(_key,_actor,_branch,_snapshot,_fields,presentationOnly)=>{assert.equal(presentationOnly,true);presentationChecks++;}}),source=(await provider.raw(key,before.commitId,before.path)).content;
 const saved=await fields.save(key,owner,{ref:'main',expectedCommit:before.commitId,fields:{text:{visible:false,export:true},id:{visible:true,export:false}}}),after=await datasets.read(key,saved.commitId);
 assert.equal(presentationChecks,2);assert.equal(saved.configuration.text!.visible,false);assert.equal(saved.configuration.id!.visible,true);
 assert.deepEqual(after.rows,before.rows);assert.deepEqual(after.rowIds,before.rowIds);assert.deepEqual((await provider.raw(key,after.commitId,after.path)).content,source);
 assert.equal(after.columns.some(column=>column.name==='text'),true,'The server retains hidden table fields for detail and query');
 const query=await datasets.page(key,'main',{search:'searchable hidden-table content',page:1,pageSize:50});assert.equal(query.matchedRows,1);assert.equal(query.rows[0]!.text,before.rows[0]!.text);
 assert.deepEqual(datasetDraftSchemaHashes(after),datasetDraftSchemaHashes(before));assert.equal(sampleTemplateHash(after),sampleTemplateHash(before));
 const projected=projectReleaseFields(after,true);assert.equal(projected.rows[0]!.text,before.rows[0]!.text,'Table-hidden and export-enabled remains in formal source data');assert.equal(Object.hasOwn(projected.rows[0]!,'id'),false,'Table-shown and export-disabled remains excluded from formal source data');
 const rebased=(await drafts.rebase(key,owner,{ref:'main',expectedBaseCommit:before.commitId,expectedCommit:after.commitId,draftRevision:draft.draftRevision,expectedDraftId:draft.id})).draft!;assert.deepEqual(rebased.operations,draft.operations);assert.equal(rebased.baseCommit,after.commitId);
 const same=await fields.save(key,owner,{ref:'main',expectedCommit:after.commitId,fields:saved.configuration});assert.equal(same.commitId,after.commitId,'No-op field save does not generate a new commit');assert.deepEqual(await provider.workspaces(key),[]);
});
