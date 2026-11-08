import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DemoProvider } from '../src/demo.js';
import { DatasetService, DATASET_DESCRIPTOR_PATH } from '../src/dataset.js';
import { DatasetFieldsService, datasetFieldsSaveSchema } from '../src/dataset-fields.js';
import { DatasetDraftService, datasetDraftSchemaHashes } from '../src/dataset-drafts.js';
import { datasetHash } from '../src/dataset-storage.js';
import { sampleTemplateHash } from '../src/workflow.js';
import { ApiError } from '../src/errors.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { DatasetCapability, RequestIdentity } from '../../../packages/shared/src/index.js';
import type { DatasetFieldMetadata } from '../../../packages/shared/src/field-metadata.js';

const owner:RequestIdentity={id:'owner',name:'Synthetic owner',kind:'owner',source:'local'};
const other:RequestIdentity={id:'another',name:'Another synthetic actor',kind:'collaborator',source:'bearer'};
const configuration:Record<string,DatasetFieldMetadata>={
  bucket:{displayName:'类别',type:'string',nullable:false,required:true,enum:['a','b']},
  score:{type:'integer',enum:[0,1]},safe:{type:'boolean',nullable:false},
  themes:{type:'array',items:{type:'string',enum:['x','y']}},
  new_column:{displayName:'新逻辑列',type:'string',required:false},
};
async function fixture(t:{after:(work:()=>Promise<void>)=>void},rows:Record<string,unknown>[]=[{id:'one',text:'Synthetic private body',bucket:'a',score:0,safe:false,themes:['x'],ground_truth:'source-only'},{id:'two',text:'Synthetic second body',bucket:'b',score:1,safe:true,themes:[] }]){
  const root=path.resolve('.data/tests');await mkdir(root,{recursive:true});const directory=await mkdtemp(path.join(root,'dataset-fields-'));
  t.after(async()=>{if(!path.resolve(directory).startsWith(root+path.sep))throw new Error('Unsafe fixture cleanup');await rm(directory,{recursive:true,force:true});});
  const provider=new DemoProvider(path.join(directory,'state.json'));await provider.init();const key={namespace:'local',repo:'synthetic-fields'};await provider.createRepo({namespace:key.namespace,name:key.repo,description:'Synthetic field configuration'});
  let allowed=true;const access={requireCapability:async(_key:unknown,identity:RequestIdentity,capability:DatasetCapability)=>{if(identity.id==='denied'||capability==='schema.bind'&&(identity.id!=='owner'||!allowed))throw new ApiError(403,'CAPABILITY_REQUIRED','Synthetic denied');}};
  const datasets=new DatasetService(provider,{authorize:async()=>{}}),snapshot=await datasets.initialize(key,owner,{ref:'main',expectedCommit:(await provider.branches(key))[0]!.commitId,rows,labels:{version:1,columns:[{id:'review',name:'判定',type:'single',options:[{value:'safe'},{value:'risk'}]}],assignments:[]}}),fields=new DatasetFieldsService({provider,datasets,access}),draftDirectory=path.join(directory,'drafts'),drafts=new DatasetDraftService(datasets,draftDirectory);
  const head=async(ref='main')=>(await provider.branches(key)).find(branch=>branch.name===ref)!.commitId;
  return {directory,key,provider,access,datasets,snapshot,fields,drafts,draftDirectory,head,revoke:()=>{allowed=false;}};
}

test('field configuration is a single versioned descriptor write with missing logical columns and unchanged source',async t=>{
  const f=await fixture(t),source=(await f.provider.raw(f.key,f.snapshot.commitId,f.snapshot.path)).content,commits=(await f.provider.commits(f.key,'main')).length;
  await f.provider.createBranch(f.key,'another',f.snapshot.commitId);
  const saved=await f.fields.save(f.key,owner,{ref:'main',expectedCommit:f.snapshot.commitId,fields:configuration,message:'Configure synthetic fields'});
  assert.equal(saved.ref,'main');assert.equal(saved.capabilities.edit,true);assert.equal(saved.fields.find(field=>field.id==='new_column')!.missing,2);assert.equal(saved.fields.find(field=>field.id==='safe')!.observedTypes.boolean,2);
  assert.deepEqual(saved.configuration,configuration);assert.deepEqual((await f.provider.commit(f.key,saved.commitId)).files.map(file=>file.path),[DATASET_DESCRIPTOR_PATH]);assert.equal((await f.provider.commits(f.key,'main')).length,commits+1);
  assert.deepEqual((await f.provider.raw(f.key,saved.commitId,f.snapshot.path)).content,source);assert.equal((await f.datasets.read(f.key,'another')).descriptor.fields,undefined);
  const current=await f.datasets.read(f.key,'main');assert.equal(current.columns.find(column=>column.name==='new_column')?.dtype,'string');assert.equal(Object.hasOwn(current.rows[0]!,'new_column'),false);assert.equal(current.rows[0]!.ground_truth,'source-only');
  assert.equal((await f.fields.read(f.key,owner,f.snapshot.commitId)).capabilities.edit,false);
  const same=await f.fields.save(f.key,owner,{ref:'main',expectedCommit:saved.commitId,fields:configuration});assert.equal(same.commitId,saved.commitId);assert.deepEqual(await f.provider.workspaces(f.key),[]);
});

test('preflight scans all rows, returns bounded conflict IDs without record bodies, and does not convert types',async t=>{
  const f=await fixture(t,Array.from({length:130},(_,index)=>({id:'synthetic-'+index,secret_body:'Do not include this body',score:index===0?0:'0'}))),before=await f.head();
  await assert.rejects(()=>f.fields.save(f.key,owner,{ref:'main',expectedCommit:before,fields:{score:{type:'integer',enum:[0]}}}),(error:any)=>{
    assert.equal(error.code,'DATASET_FIELD_CONFLICTS');assert.equal(error.details.conflictCount,129);assert.equal(error.details.affectedRows,129);assert.equal(error.details.conflicts.length,100);assert.equal(error.details.truncated,true);assert.ok(error.details.conflicts.every((item:any)=>item.field==='score'&&item.code==='type'&&typeof item.rowId==='string'));
    assert.equal(JSON.stringify(error.details).includes('Do not include this body'),false);return true;
  });
  assert.equal(await f.head(),before);assert.deepEqual(await f.provider.workspaces(f.key),[]);
});

test('required, nullability, exact enums and array elements reject incompatible configurations',async t=>{
  const f=await fixture(t),before=await f.head();
  for(const fields of [{new_column:{type:'string',required:true}},{score:{enum:['0','1']}},{safe:{enum:['false','true']}},{themes:{type:'array',items:{type:'string',enum:['y']}}}] as Record<string,DatasetFieldMetadata>[]){await assert.rejects(()=>f.fields.save(f.key,owner,{ref:'main',expectedCommit:before,fields}),(error:any)=>error.code==='DATASET_FIELD_CONFLICTS');}
  const first=f.snapshot.rowIds[0]!,changed=await f.datasets.save(f.key,owner,{ref:'main',expectedCommit:before,message:'Synthetic null',operations:[{op:'update',rowId:first,record:{...f.snapshot.rows[0],score:null}}]});
  const accepted=await f.fields.save(f.key,owner,{ref:'main',expectedCommit:changed.commitId,fields:{score:{type:'number',nullable:true}}});assert.equal(accepted.fields.find(field=>field.id==='score')!.nulls,1);
  await assert.rejects(()=>f.fields.save(f.key,owner,{ref:'main',expectedCommit:accepted.commitId,fields:{score:{type:'number',nullable:false}}}),(error:any)=>error.details.conflicts[0].code==='null');
});

test('invalid config structures, duplicate typed options and reserved field IDs fail before writes',async t=>{
  const f=await fixture(t);
  for(const fields of [{safe:{type:'boolean',enum:['true']}},{themes:{type:'array',enum:['x']}},{score:{type:'number',items:{enum:[1]}}},{score:{enum:[1,1]}},{Constructor:{type:'string'}},JSON.parse('{"__proto__":{"type":"string"}}')])assert.equal(datasetFieldsSaveSchema.safeParse({ref:'main',expectedCommit:f.snapshot.commitId,fields}).success,false);
  const parsed=datasetFieldsSaveSchema.parse({ref:'main',expectedCommit:f.snapshot.commitId,fields:{typed:{enum:[false,0,'0']}}});assert.deepEqual(parsed.fields.typed!.enum,[false,0,'0']);assert.equal(await f.head(),f.snapshot.commitId);
});

test('fixed and weighted widths round trip as presentation while limits and semantic fingerprints stay strict',async t=>{
  const f=await fixture(t);
  for(const width of [{mode:'fixed',value:47},{mode:'fixed',value:2401},{mode:'fixed',value:60.5},{mode:'weight',value:0},{mode:'weight',value:1001},{mode:'flex',value:1}])assert.equal(datasetFieldsSaveSchema.safeParse({ref:'main',expectedCommit:f.snapshot.commitId,fields:{text:{width}}}).success,false);
  const widths={text:{width:{mode:'fixed' as const,value:480}},logical:{width:{mode:'weight' as const,value:2.5}}},saved=await f.fields.save(f.key,owner,{ref:'main',expectedCommit:f.snapshot.commitId,fields:widths}),snapshot=await f.datasets.read(f.key,saved.commitId);
  assert.deepEqual(saved.configuration,widths);assert.deepEqual(datasetDraftSchemaHashes(snapshot),datasetDraftSchemaHashes(f.snapshot));assert.equal(sampleTemplateHash(snapshot),sampleTemplateHash(f.snapshot));
  assert.notEqual(sampleTemplateHash({...snapshot,descriptor:{...snapshot.descriptor,fields:{...widths,text:{...widths.text,description:'Semantic explanation'}}}}),sampleTemplateHash(snapshot));
});

test('explicit width-only synchronization keeps own draft, source and rules unchanged and creates no commit',async t=>{
  const f=await fixture(t),configured=await f.fields.save(f.key,owner,{ref:'main',expectedCommit:f.snapshot.commitId,fields:configuration}),snapshot=await f.datasets.read(f.key,configured.commitId),rowId=snapshot.rowIds[0]!,draft=(await f.drafts.save(f.key,owner,{ref:'main',expectedCommit:configured.commitId,draftRevision:0,operations:[{op:'update',rowId,record:{...snapshot.rows[0],text:'Uncommitted sample content'}}]})).draft!;
  let checks=0;const guarded=new DatasetFieldsService({provider:f.provider,datasets:f.datasets,access:f.access,beforeSave:async(_key,_actor,_ref,_snapshot,_fields,presentationOnly)=>{checks++;if(!presentationOnly)throw new ApiError(409,'SYNTHETIC_SEMANTIC_GUARD','Synthetic semantic mutation blocked');}});
  const width=await guarded.save(f.key,owner,{ref:'main',expectedCommit:configured.commitId,fields:{...configuration,text:{width:{mode:'fixed',value:320}}}});assert.equal(checks,2);assert.equal((await f.drafts.read(f.key,owner,'main')).issue?.code,'DATASET_VERSION_CONFLICT');
  const commits=(await f.provider.commits(f.key,'main')).length,rebased=(await f.drafts.rebase(f.key,owner,{ref:'main',expectedBaseCommit:configured.commitId,expectedCommit:width.commitId,draftRevision:draft.draftRevision,expectedDraftId:draft.id})).draft!;
  assert.equal(rebased.draftRevision,draft.draftRevision+1);assert.deepEqual(rebased.operations,draft.operations);assert.equal(rebased.baseCommit,width.commitId);assert.equal((await f.provider.commits(f.key,'main')).length,commits);assert.deepEqual(await f.provider.workspaces(f.key),[]);
  const source=(await f.provider.raw(f.key,configured.commitId,snapshot.path)).content;assert.deepEqual((await f.provider.raw(f.key,width.commitId,snapshot.path)).content,source);
  const semantic=await f.fields.save(f.key,owner,{ref:'main',expectedCommit:width.commitId,fields:{...configuration,text:{type:'string',width:{mode:'fixed',value:500}}}});
  await assert.rejects(()=>f.drafts.rebase(f.key,owner,{ref:'main',expectedBaseCommit:width.commitId,expectedCommit:semantic.commitId,draftRevision:rebased.draftRevision,expectedDraftId:rebased.id}),(error:any)=>error.code==='DATASET_DRAFT_REBASE_UNSUPPORTED');
  assert.equal((await f.drafts.export(f.key,owner,'main')).draft!.baseCommit,width.commitId);
});

test('schema.bind, fixed branch CAS and final permission recheck protect metadata commits',async t=>{
  const f=await fixture(t);
  assert.equal((await f.fields.read(f.key,other,'main')).capabilities.edit,false);
  await assert.rejects(()=>f.fields.save(f.key,other,{ref:'main',expectedCommit:f.snapshot.commitId,fields:configuration}),(error:any)=>error.status===403);
  await assert.rejects(()=>f.fields.save(f.key,owner,{ref:f.snapshot.commitId,expectedCommit:f.snapshot.commitId,fields:configuration}),(error:any)=>error.code==='DATASET_BRANCH_REQUIRED');
  const read=await f.fields.save(f.key,owner,{ref:'main',expectedCommit:f.snapshot.commitId,fields:{text:{displayName:'正文'}}});
  await assert.rejects(()=>f.fields.save(f.key,owner,{ref:'main',expectedCommit:f.snapshot.commitId,fields:configuration}),(error:any)=>error.code==='DATASET_VERSION_CONFLICT');
  const write=f.provider.writeWorkspace.bind(f.provider);f.provider.writeWorkspace=async(...args)=>{const result=await write(...args);f.revoke();return result;};
  await assert.rejects(()=>f.fields.save(f.key,owner,{ref:'main',expectedCommit:read.commitId,fields:configuration}),(error:any)=>error.status===403);assert.equal(await f.head(),read.commitId);assert.deepEqual(await f.provider.workspaces(f.key),[]);
});

test('full record updates, append, private draft save and commit share the same typed validation',async t=>{
  const f=await fixture(t),configured=await f.fields.save(f.key,owner,{ref:'main',expectedCommit:f.snapshot.commitId,fields:configuration}),snapshot=await f.datasets.read(f.key,'main'),rowId=snapshot.rowIds[0]!;
  for(const patch of [{score:'0'},{score:0.5},{safe:'false'},{themes:['unknown']},{bucket:undefined}]){
    const record={...snapshot.rows[0],...patch};if(patch.bucket===undefined&&Object.hasOwn(patch,'bucket'))delete record.bucket;
    const operations=[{op:'update' as const,rowId,record,expectedContentHash:snapshot.contentHashes[rowId]}];
    await assert.rejects(()=>f.datasets.save(f.key,owner,{ref:'main',expectedCommit:configured.commitId,message:'Invalid JSON record',operations}),(error:any)=>error.code==='DATASET_FIELD_CONFLICTS');
    await assert.rejects(()=>f.drafts.save(f.key,owner,{ref:'main',expectedCommit:configured.commitId,draftRevision:0,operations}),(error:any)=>error.code==='DATASET_FIELD_CONFLICTS');
  }
  await assert.rejects(()=>f.datasets.save(f.key,owner,{ref:'main',expectedCommit:configured.commitId,message:'Invalid append',operations:[{op:'append',rowId:'new:typed',record:{id:'unique',bucket:'c'}}]}),(error:any)=>error.code==='DATASET_FIELD_CONFLICTS');
  const draft=(await f.drafts.save(f.key,owner,{ref:'main',expectedCommit:configured.commitId,draftRevision:0,operations:[{op:'update',rowId,record:{...snapshot.rows[0],score:1}}]})).draft!;
  const filename=path.join(f.draftDirectory,datasetHash(f.key),datasetHash('owner:owner'),datasetHash('main')+'.json'),stored=JSON.parse(await readFile(filename,'utf8'));stored.draft.operations[0].record.score='1';await writeFile(filename,JSON.stringify(stored));
  await assert.rejects(()=>f.drafts.commit(f.key,owner,{ref:'main',expectedCommit:configured.commitId,draftRevision:draft.draftRevision,expectedDraftId:draft.id,message:'Cannot bypass validation'}),(error:any)=>error.code==='DATASET_FIELD_CONFLICTS');
  assert.equal((await f.drafts.export(f.key,owner,'main')).draft!.id,draft.id);assert.equal(await f.head(),configured.commitId);assert.deepEqual(await f.provider.workspaces(f.key),[]);
});

test('initial configured imports and reserved candidate source keys reject before a workspace exists',async t=>{
  const f=await fixture(t),rowId=f.snapshot.rowIds[0]!;
  await assert.rejects(()=>f.datasets.save(f.key,owner,{ref:'main',expectedCommit:f.snapshot.commitId,message:'Reserved update',operations:[{op:'update',rowId,record:{...f.snapshot.rows[0],Constructor:'payload'}}]}),(error:any)=>error.code==='DATASET_SOURCE_TRUTH_READONLY');
  await assert.rejects(()=>f.datasets.save(f.key,owner,{ref:'main',expectedCommit:f.snapshot.commitId,message:'Reserved append',operations:[{op:'append',record:{id:'unique',Prototype:'payload'}}]}),(error:any)=>error.code==='DATASET_FIELD_RESERVED_ID');
  const key={namespace:'local',repo:'configured-import'};await f.provider.createRepo({namespace:key.namespace,name:key.repo,description:'Synthetic configured import'});const before=(await f.provider.branches(key))[0]!.commitId;
  await assert.rejects(()=>f.datasets.initialize(key,owner,{ref:'main',expectedCommit:before,rows:[{id:'one',safe:'false'}],descriptor:{fields:{safe:{type:'boolean'}}}}),(error:any)=>error.code==='DATASET_FIELD_CONFLICTS');assert.deepEqual(await f.provider.workspaces(key),[]);
});

test('an own reserved source key is retained read-only while other source content remains editable',async t=>{
  const original=JSON.parse('{"id":"reserved-source","text":"Original synthetic content","__proto__":{"note":"Source data only"}}'),f=await fixture(t,[original]),rowId=f.snapshot.rowIds[0]!;
  const saved=await f.datasets.save(f.key,owner,{ref:'main',expectedCommit:f.snapshot.commitId,message:'Edit ordinary source text',operations:[{op:'update',rowId,record:{...f.snapshot.rows[0],text:'Edited ordinary content'}}]});
  assert.equal(saved.rows[0]!.text,'Edited ordinary content');assert.equal(Object.hasOwn(saved.rows[0]!,'__proto__'),true);assert.deepEqual(saved.rows[0]!.__proto__,{note:'Source data only'});assert.equal(Object.getPrototypeOf(saved.rows[0]!),Object.prototype);
  const changed=JSON.parse(JSON.stringify(saved.rows[0]));changed.__proto__={note:'Changed source truth'};
  await assert.rejects(()=>f.datasets.save(f.key,owner,{ref:'main',expectedCommit:saved.commitId,message:'Cannot edit reserved source key',operations:[{op:'update',rowId,record:changed}]}),(error:any)=>error.code==='DATASET_SOURCE_TRUTH_READONLY');assert.equal(await f.head(),saved.commitId);
});

test('new own reserved keys are explicitly rejected instead of being silently stripped by JSON validation',async t=>{
  const f=await fixture(t),rowId=f.snapshot.rowIds[0]!,record=Object.fromEntries([...Object.entries(f.snapshot.rows[0]!),['__proto__',{note:'New synthetic key'}]]);
  await assert.rejects(()=>f.datasets.save(f.key,owner,{ref:'main',expectedCommit:f.snapshot.commitId,message:'New reserved update',operations:[{op:'update',rowId,record}]}),(error:any)=>error.code==='DATASET_SOURCE_TRUTH_READONLY');
  await assert.rejects(()=>f.datasets.save(f.key,owner,{ref:'main',expectedCommit:f.snapshot.commitId,message:'New reserved append',operations:[{op:'append',record:JSON.parse('{"id":"unique","__proto__":{"note":"No execution"}}')}]}),(error:any)=>error.code==='DATASET_FIELD_RESERVED_ID');assert.equal(await f.head(),f.snapshot.commitId);assert.deepEqual(await f.provider.workspaces(f.key),[]);
});

test('field configuration participates in draft/review fingerprints, and page baselines are bounded to own visible records',async t=>{
  const f=await fixture(t),id=f.snapshot.rowIds[0]!;
  let current=await f.datasets.save(f.key,owner,{ref:'main',expectedCommit:f.snapshot.commitId,message:'Own baseline labels',operations:[{op:'assign',scope:'row',rowId:id,values:{review:'safe'}},{op:'assign',scope:'file',path:f.snapshot.path,values:{review:'safe'}}]});
  current=await f.datasets.save(f.key,other,{ref:'main',expectedCommit:current.commitId,message:'Other baseline labels',operations:[{op:'assign',scope:'row',rowId:id,values:{review:'risk'}},{op:'assign',scope:'file',path:f.snapshot.path,values:{review:'risk'}}]});
  const clean=await f.drafts.page(f.key,owner,'main',{pageSize:1});assert.deepEqual(Object.keys(clean.baseRows!),[id]);assert.equal(clean.baseOwnLabelRecords![id]!.values.review,'safe');assert.equal(clean.baseOwnFileLabelRecords![f.snapshot.path]!.actor.id,'owner');
  const draft=(await f.drafts.save(f.key,owner,{ref:'main',expectedCommit:current.commitId,draftRevision:0,operations:[{op:'update',rowId:id,record:{...current.rows[0],text:'Edited locally'}},{op:'assign',scope:'row',rowId:id,values:{review:'risk'}},{op:'append',rowId:'new:baseline',record:{id:'new',text:'New row'}}]})).draft!;
  const page=await f.drafts.page(f.key,owner,'main',{pageSize:1},draft.draftRevision,draft.id);assert.equal(page.rows[0]!.text,'Edited locally');assert.equal(page.baseRows![id]!.text,current.rows[0]!.text);assert.equal(page.baseOwnLabelRecords![id]!.values.review,'safe');
  const added=await f.drafts.page(f.key,owner,'main',{page:3,pageSize:1},draft.draftRevision,draft.id);assert.deepEqual(added.baseRows,{});
  const metadata={...current,descriptor:{...current.descriptor,fields:{safe:{type:'boolean' as const}}}};assert.notEqual(datasetDraftSchemaHashes(current).sample,datasetDraftSchemaHashes(metadata).sample);assert.equal(datasetDraftSchemaHashes(current).dataset,datasetDraftSchemaHashes(metadata).dataset);assert.notEqual(sampleTemplateHash(current),sampleTemplateHash(metadata));
});

test('HTTP fields require delegated schema.bind and guard existing own drafts and active tasks',async t=>{
  const f=await fixture(t),token='synthetic-fields-owner',app=await createApp(loadConfig({DEMO_MODE:'true',DEMO_DATA_FILE:path.join(f.directory,'state.json'),BFF_TOKEN:token}),f.provider);t.after(()=>app.close());
  const base='/api/repos/'+f.key.namespace+'/'+f.key.repo,call=(method:any,url:string,payload?:unknown,auth=token)=>app.inject({method,url,headers:{authorization:'Bearer '+auth},...(payload?{payload:payload as any}:{})});
  let response=await call('POST',base+'/access',{name:'Schema annotator',role:'annotator'});assert.equal(response.statusCode,201,response.body);const annotator=response.json();
  const before=await f.head();response=await call('GET',base+'/dataset/fields?ref=main',undefined,annotator.token);assert.equal(response.statusCode,200,response.body);assert.equal(response.json().capabilities.edit,false);
  response=await call('PUT',base+'/dataset/fields',{ref:'main',expectedCommit:before,fields:configuration},annotator.token);assert.equal(response.statusCode,403,response.body);
  response=await call('PUT',base+'/dataset/draft',{ref:'main',expectedCommit:before,draftRevision:0,operations:[{op:'update',rowId:f.snapshot.rowIds[0],record:{...f.snapshot.rows[0],text:'Private edit'}}]});assert.equal(response.statusCode,200,response.body);const draft=response.json().draft;
  response=await call('PUT',base+'/dataset/fields',{ref:'main',expectedCommit:before,fields:configuration});assert.equal(response.statusCode,409,response.body);assert.equal(response.json().error.code,'DATASET_FIELDS_DRAFT_IN_USE');
  response=await call('PUT',base+'/dataset/fields',{ref:'main',expectedCommit:before,fields:{text:{width:{mode:'fixed',value:300}}}});assert.equal(response.statusCode,200,response.body);const widthCommit=response.json().commitId;
  response=await call('POST',base+'/dataset/draft/rebase',{ref:'main',expectedBaseCommit:before,expectedCommit:widthCommit,draftRevision:draft.draftRevision,expectedDraftId:draft.id});assert.equal(response.statusCode,200,response.body);const recovered=response.json().draft;
  response=await call('POST',base+'/dataset/draft/discard',{ref:'main',draftRevision:recovered.draftRevision,expectedDraftId:recovered.id});assert.equal(response.statusCode,200,response.body);
  response=await call('POST',base+'/access',{name:'Delegated schema maintainer',role:'lead',capabilities:['read','schema.bind']});assert.equal(response.statusCode,201,response.body);const maintainer=response.json(),latest=await f.head();
  response=await call('PUT',base+'/dataset/fields',{ref:'main',expectedCommit:latest,fields:configuration},maintainer.token);assert.equal(response.statusCode,200,response.body);const saved=response.json();
  response=await call('POST',base+'/tasks',{title:'Active synthetic work',ref:'main',expectedCommit:saved.commitId,assigneeIds:[annotator.collaborator.id],reviewerId:'owner',mode:'review',branchPrefix:'annotate/fields'});assert.equal(response.statusCode,201,response.body);
  response=await call('PUT',base+'/dataset/fields',{ref:'main',expectedCommit:saved.commitId,fields:{...configuration,text:{width:{mode:'weight',value:2}}}});assert.equal(response.statusCode,200,response.body);const taskWidthCommit=response.json().commitId;
  response=await call('PUT',base+'/dataset/fields',{ref:'main',expectedCommit:taskWidthCommit,fields:{...configuration,text:{displayName:'正文',width:{mode:'weight',value:2}}}});assert.equal(response.statusCode,409,response.body);assert.equal(response.json().error.code,'TASK_TEMPLATE_IN_USE');assert.equal(await f.head(),taskWidthCommit);
});
