import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {DemoProvider} from '../src/demo.js';
import {DatasetService,DATASET_DESCRIPTOR_PATH} from '../src/dataset.js';
import {DatasetFieldsService} from '../src/dataset-fields.js';
import {ApiError} from '../src/errors.js';
import {datasetHash} from '../src/dataset-storage.js';
import {createApp} from '../src/app.js';
import {loadConfig} from '../src/config.js';
import type {RequestIdentity} from '../../../packages/shared/src/index.js';

const owner:RequestIdentity={id:'owner',name:'Synthetic schema owner',kind:'owner',source:'local'};
async function fixture(t:{after:(fn:()=>Promise<void>)=>void},count=2,legacy=false){
  const root=path.resolve('.data/tests');await mkdir(root,{recursive:true});const directory=await mkdtemp(path.join(root,'delete-field-'));
  t.after(async()=>{if(!path.resolve(directory).startsWith(root+path.sep))throw new Error('Unsafe synthetic cleanup');await rm(directory,{recursive:true,force:true});});
  const provider=new DemoProvider(path.join(directory,'state.json'));await provider.init();const key={namespace:'local',repo:'synthetic-delete-field'};await provider.createRepo({namespace:key.namespace,name:key.repo});
  const rows=Array.from({length:count},(_,index)=>({id:'sample-'+index,text:'Synthetic body '+index,temporary:'Discard '+index,keep:42,ground_truth:'source-only',package_path:'packages/inert.zip'}));
  let denied='',guardCount=0;const access={requireCapability:async(_key:unknown,_identity:RequestIdentity,capability:string)=>{if(capability===denied)throw new ApiError(403,'SYNTHETIC_DENIED','Synthetic denied');}};
  const datasets=new DatasetService(provider,{authorize:async()=>{}});
  if(legacy){const ws=await provider.createWorkspace(key,'Synthetic legacy','main');await provider.writeWorkspace(key,ws.id,'samples.jsonl',Buffer.from(rows.map(row=>JSON.stringify(row)).join('\n')+'\n'));await provider.commitWorkspace(key,ws.id,'Synthetic legacy');await provider.deleteWorkspace(key,ws.id);}
  else await datasets.initialize(key,owner,{ref:'main',expectedCommit:(await provider.branches(key))[0]!.commitId,rows,descriptor:{fields:{temporary:{type:'string',required:true},unused:{type:'string'}}}});
  const fields=new DatasetFieldsService({provider,datasets,access,beforeSave:async(_key,_identity,_ref,_snapshot,_fields,presentationOnly)=>{assert.equal(presentationOnly,false);guardCount++;}}),head=async()=>(await provider.branches(key)).find(branch=>branch.name==='main')!.commitId;
  return {directory,provider,key,datasets,fields,head,deny:(capability:string)=>{denied=capability;},guards:()=>guardCount};
}
test('field deletion removes all current values and definition in one commit, preserving source/history and stable row IDs',async t=>{
  const f=await fixture(t,501),before=await f.datasets.read(f.key,'main'),raw=(await f.provider.raw(f.key,before.commitId,before.path)).content,commits=(await f.provider.commits(f.key,'main')).length;
  const after=await f.fields.delete(f.key,owner,{ref:'main',expectedCommit:before.commitId,fieldId:'temporary',confirmFieldId:'temporary'}),current=await f.datasets.read(f.key,after.commitId);
  assert.equal(current.totalRows,501);assert.deepEqual(current.rowIds,before.rowIds);assert.ok(current.rows.every(row=>!Object.hasOwn(row,'temporary')&&row.keep===42&&row.ground_truth==='source-only'));
  assert.equal(Object.hasOwn(after.configuration,'temporary'),false);assert.equal(after.fields.some(field=>field.id==='temporary'),false);assert.equal((await f.provider.commits(f.key,'main')).length,commits+1);
  assert.deepEqual((await f.provider.raw(f.key,after.commitId,before.path)).content,raw);assert.equal((await f.datasets.read(f.key,before.commitId)).rows[0]!.temporary,'Discard 0');
  assert.equal(current.rowActivity![current.rowIds[0]!]!.actor!.id,owner.id);assert.notEqual(current.contentHashes[current.rowIds[0]!],before.contentHashes[before.rowIds[0]!]);
  assert.ok(f.guards()>=3);assert.deepEqual(await f.provider.workspaces(f.key),[]);
});
test('deleting an unused logical field updates only the versioned descriptor',async t=>{
  const f=await fixture(t),before=await f.datasets.read(f.key,'main'),after=await f.fields.delete(f.key,owner,{ref:'main',expectedCommit:before.commitId,fieldId:'unused',confirmFieldId:'unused'});
  assert.deepEqual((await f.provider.commit(f.key,after.commitId)).files.map(file=>file.path),[DATASET_DESCRIPTOR_PATH]);assert.deepEqual((await f.datasets.read(f.key,'main')).contentHashes,before.contentHashes);
});
test('legacy table deletion establishes source-bound overlay without rewriting original bytes or changing identities',async t=>{
  const f=await fixture(t,2,true),before=await f.datasets.read(f.key,'main'),raw=(await f.provider.raw(f.key,before.commitId,before.path)).content;
  const after=await f.fields.delete(f.key,owner,{ref:'main',expectedCommit:before.commitId,fieldId:'temporary',confirmFieldId:'temporary'}),current=await f.datasets.read(f.key,after.commitId);
  assert.deepEqual(current.rowIds,before.rowIds);assert.ok(current.rows.every(row=>!Object.hasOwn(row,'temporary')));assert.deepEqual((await f.provider.raw(f.key,current.commitId,current.path)).content,raw);assert.ok(current.descriptor.identityMapPath);
});
test('protected IDs, source truth, attachment references, exact confirmation, missing fields and stale heads prevent deletion',async t=>{
  const f=await fixture(t),before=await f.head();
  for(const fieldId of ['id','ground_truth','package_path'])await assert.rejects(()=>f.fields.delete(f.key,owner,{ref:'main',expectedCommit:before,fieldId,confirmFieldId:fieldId}),(error:any)=>error.code==='DATASET_FIELD_DELETE_PROTECTED');
  const state=await f.fields.read(f.key,owner,'main');for(const id of ['split','quality','purposes','visibility'])assert.ok(state.protectedFields.includes(id));
  await assert.rejects(()=>f.fields.delete(f.key,owner,{ref:'main',expectedCommit:before,fieldId:'temporary',confirmFieldId:'Temporary'}),(error:any)=>error.code==='DATASET_FIELD_DELETE_CONFIRM');
  await assert.rejects(()=>f.fields.delete(f.key,owner,{ref:'main',expectedCommit:before,fieldId:'unknown',confirmFieldId:'unknown'}),(error:any)=>error.code==='DATASET_FIELD_NOT_FOUND');
  const after=await f.fields.delete(f.key,owner,{ref:'main',expectedCommit:before,fieldId:'unused',confirmFieldId:'unused'});
  await assert.rejects(()=>f.fields.delete(f.key,owner,{ref:'main',expectedCommit:before,fieldId:'temporary',confirmFieldId:'temporary'}),(error:any)=>error.code==='DATASET_VERSION_CONFLICT');assert.equal(await f.head(),after.commitId);
});
test('delete requires both schema and content capabilities, rechecks revocation and semantic guards, and cleans failed workspaces',async t=>{
  const f=await fixture(t),before=await f.head(),input={ref:'main',expectedCommit:before,fieldId:'temporary',confirmFieldId:'temporary'};
  for(const capability of ['schema.bind','data.edit']){f.deny(capability);await assert.rejects(()=>f.fields.delete(f.key,owner,input),(error:any)=>error.status===403);}f.deny('');
  const guarded=new DatasetFieldsService({provider:f.provider,datasets:f.datasets,access:{requireCapability:async()=>{}},beforeSave:async()=>{throw new ApiError(409,'DATASET_FIELDS_DRAFT_IN_USE','Synthetic pending draft');}});
  await assert.rejects(()=>guarded.delete(f.key,owner,input),(error:any)=>error.code==='DATASET_FIELDS_DRAFT_IN_USE');
  const stage=f.provider.writeWorkspaceBatch!.bind(f.provider);f.provider.writeWorkspaceBatch=async(...args)=>{const result=await stage(...args);f.deny('data.edit');return result;};
  await assert.rejects(()=>f.fields.delete(f.key,owner,input),(error:any)=>error.status===403);assert.equal(await f.head(),before);assert.deepEqual(await f.provider.workspaces(f.key),[]);assert.equal(datasetHash((await f.datasets.read(f.key,before)).rows[0]),datasetHash((await f.datasets.read(f.key,'main')).rows[0]));
});
test('HTTP field deletion retains pending private drafts and allows a guarded atomic delete only after explicit draft handling',async t=>{
  const f=await fixture(t),token='synthetic-delete-http-owner',app=await createApp(loadConfig({DEMO_MODE:'true',DEMO_DATA_FILE:path.join(f.directory,'state.json'),BFF_TOKEN:token}),f.provider);t.after(()=>app.close());
  const base='/api/repos/'+f.key.namespace+'/'+f.key.repo,call=(method:any,url:string,payload?:unknown)=>app.inject({method,url,headers:{authorization:'Bearer '+token},...(payload?{payload:payload as any}:{})}),snapshot=await f.datasets.read(f.key,'main'),rowId=snapshot.rowIds[0]!;
  let response=await call('PUT',base+'/dataset/draft',{ref:'main',expectedCommit:snapshot.commitId,draftRevision:0,operations:[{op:'update',rowId,record:{...snapshot.rows[0],text:'Synthetic draft retained'}}]});assert.equal(response.statusCode,200,response.body);const draft=response.json().draft;
  const input={ref:'main',expectedCommit:snapshot.commitId,fieldId:'temporary',confirmFieldId:'temporary'};
  response=await call('POST',base+'/dataset/fields/delete',input);assert.equal(response.statusCode,409,response.body);assert.equal(response.json().error.code,'DATASET_FIELDS_DRAFT_IN_USE');assert.equal(await f.head(),snapshot.commitId);
  response=await call('GET',base+'/dataset/draft?ref=main');assert.equal(response.statusCode,200,response.body);assert.equal(response.json().draft.operations[0].record.text,'Synthetic draft retained');
  response=await call('POST',base+'/dataset/draft/discard',{ref:'main',draftRevision:draft.draftRevision,expectedDraftId:draft.id});assert.equal(response.statusCode,200,response.body);
  response=await call('POST',base+'/dataset/fields/delete',input);assert.equal(response.statusCode,200,response.body);const saved=response.json();assert.notEqual(saved.commitId,snapshot.commitId);assert.equal(saved.fields.some((field:{id:string})=>field.id==='temporary'),false);
});
