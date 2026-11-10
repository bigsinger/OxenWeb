import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import {createApp} from '../src/app.js';
import {DemoProvider} from '../src/demo.js';
import {loadConfig} from '../src/config.js';
import {DatasetService} from '../src/dataset.js';
import {defaultGlobalFieldCatalog,globalFieldMetadata,adoptGlobalFieldMetadata,type GlobalFieldDefinition} from '../../../packages/shared/src/global-fields.js';
import {createSampleFieldDraft,sampleFieldMetadata} from '../../web/src/sample-field-config.js';

const token='r18-global-synthetic-admin';
async function setup(t:{after:(callback:()=>Promise<void>)=>void}){
  const root=path.resolve('.data/tests');await mkdir(root,{recursive:true});const directory=await mkdtemp(path.join(root,'r18-global-'));
  const config=loadConfig({DEMO_MODE:'true',DEMO_DATA_FILE:path.join(directory,'state.json'),BFF_TOKEN:token}),provider=new DemoProvider(config.demoFile),app=await createApp(config,provider);
  t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});
  const call=(method:'GET'|'POST'|'PUT',url:string,payload?:unknown,credential=token)=>app.inject({method,url,headers:{authorization:'Bearer '+credential},...(payload===undefined?{}:{payload})});
  return {call,provider,config,directory};
}
const custom:GlobalFieldDefinition={id:'review_priority',displayName:'复核优先级',description:'Synthetic priority only',type:'single',options:[{id:'normal',displayName:'普通',color:'#2563EB'},{id:'urgent',displayName:'紧急',color:'#DC2626'}]};
async function project(provider:DemoProvider,name:string,rows:Record<string,unknown>[]){const key={namespace:'oxen',repo:name};await provider.createRepo({namespace:key.namespace,name:key.repo,description:'Synthetic R18 field lifecycle',visibility:'private'});const head=(await provider.branches(key)).find(item=>item.name==='main')!;const snapshot=await new DatasetService(provider).initialize(key,{kind:'owner',id:'synthetic',name:'Synthetic'},{ref:'main',expectedCommit:head.commitId,rows});return {key,snapshot};}

test('R18 admin can create edit retire every global field and options; immutable history survives restart',async t=>{
  const {call,config,directory}=await setup(t),initial=(await call('GET','/api/global-fields')).json();
  const fields=[...initial.catalog.fields,structuredClone(custom)];let response=await call('PUT','/api/global-fields',{expectedRevision:1,fields});assert.equal(response.statusCode,200,response.body);
  const r2=structuredClone(response.json().catalog);const changed=structuredClone(fields);changed[0].type='multi';changed[0].options=[{id:'testing',displayName:'测试用途示例',color:'#123456'}];changed.at(-1)!.options[0]!.id='standard';changed.at(-1)!.options.splice(1,1);
  response=await call('PUT','/api/global-fields',{expectedRevision:2,fields:changed});assert.equal(response.statusCode,200,response.body);
  response=await call('PUT','/api/global-fields',{expectedRevision:3,fields:[]});assert.equal(response.statusCode,200,response.body);assert.deepEqual(response.json().catalog.fields,[]);
  assert.deepEqual((await call('GET','/api/global-fields/history/2')).json(),r2);
  const versions=(await call('GET','/api/global-fields/history')).json().versions;assert.deepEqual(versions.map((item:any)=>[item.revision,item.fieldCount]),[[1,4],[2,5],[3,5],[4,0]]);assert.ok(!Object.hasOwn(versions[1],'fields'));
  const disk=JSON.parse(await readFile(path.join(directory,'governance.json'),'utf8'));assert.deepEqual(disk.globalFieldHistory[1],r2);
  const restarted=await createApp(config);t.after(()=>restarted.close());const persisted=await restarted.inject({url:'/api/global-fields/history/2',headers:{authorization:'Bearer '+token}});assert.deepEqual(persisted.json(),r2);assert.deepEqual((await restarted.inject({url:'/api/global-fields/catalog',headers:{authorization:'Bearer '+token}})).json().catalog.fields,[]);
});

test('R18 option removals and type edits block incompatible project sync, keeping source and adopted definitions pinned',async t=>{
  const {call,provider}=await setup(t);let fields=[...defaultGlobalFieldCatalog().fields,structuredClone(custom)],response=await call('PUT','/api/global-fields',{expectedRevision:1,fields});assert.equal(response.statusCode,200,response.body);
  const {key,snapshot}=await project(provider,'r18-pinned',[{id:'synthetic-1',text:'Synthetic',review_priority:'urgent'}]);
  response=await call('POST','/api/global-fields/synchronize',{expectedRevision:2,targets:[{...key,ref:'main',expectedCommit:snapshot.commitId}]});assert.equal(response.json().results[0].status,'updated',response.body);
  const datasets=new DatasetService(provider),adopted=await datasets.read(key,'main'),bytes=(await provider.raw(key,adopted.commitId,adopted.path)).content;
  assert.deepEqual(adopted.descriptor.fields?.review_priority?.globalField,{id:'review_priority',revision:2});
  fields=structuredClone(fields);fields.at(-1)!.options.splice(1,1);response=await call('PUT','/api/global-fields',{expectedRevision:2,fields});assert.equal(response.statusCode,200,response.body);
  response=await call('POST','/api/global-fields/synchronize',{expectedRevision:3,targets:[{...key,ref:'main',expectedCommit:adopted.commitId}]});assert.equal(response.json().results[0].code,'DATASET_FIELD_CONFLICTS',response.body);
  assert.equal((await datasets.read(key,'main')).commitId,adopted.commitId);assert.deepEqual((await provider.raw(key,'main',adopted.path)).content,bytes);
  fields.at(-1)!.type='multi';response=await call('PUT','/api/global-fields',{expectedRevision:3,fields});assert.equal(response.statusCode,200,response.body);
  response=await call('POST','/api/global-fields/synchronize',{expectedRevision:4,targets:[{...key,ref:'main',expectedCommit:adopted.commitId}]});assert.equal(response.json().results[0].code,'DATASET_FIELD_CONFLICTS',response.body);
  assert.deepEqual((await datasets.read(key,'main')).descriptor,adopted.descriptor);assert.deepEqual((await datasets.read(key,snapshot.commitId)).descriptor,snapshot.descriptor);
});

test('R18 active custom fields are protected, retirement retains project values, explicit local deletion is versioned',async t=>{
  const {call,provider,directory}=await setup(t);let response=await call('PUT','/api/global-fields',{expectedRevision:1,fields:[custom]});assert.equal(response.statusCode,200,response.body);
  const {key,snapshot}=await project(provider,'r18-retired',[{id:'synthetic-1',review_priority:'urgent',text:'Synthetic'}]);const base=`/api/repos/${key.namespace}/${key.repo}`;
  response=await call('POST','/api/global-fields/synchronize',{expectedRevision:2,targets:[{...key,ref:'main',expectedCommit:snapshot.commitId}]});assert.equal(response.json().results[0].status,'updated',response.body);
  const datasets=new DatasetService(provider),adopted=await datasets.read(key,'main');let state=(await call('GET',base+'/dataset/fields?ref=main')).json();assert.ok(state.protectedFields.includes(custom.id));
  response=await call('PUT',base+'/dataset/fields',{ref:'main',expectedCommit:adopted.commitId,fields:{}});assert.equal(response.json().error.code,'GLOBAL_FIELD_REQUIRED',response.body);
  const override=structuredClone(adopted.descriptor.fields!);override.review_priority!.displayName='Local override';response=await call('PUT',base+'/dataset/fields',{ref:'main',expectedCommit:adopted.commitId,fields:override});assert.equal(response.json().error.code,'GLOBAL_FIELD_MANAGED',response.body);
  response=await call('PUT','/api/global-fields',{expectedRevision:2,fields:[]});assert.equal(response.statusCode,200,response.body);
  state=(await call('GET',base+'/dataset/fields?ref=main')).json();assert.ok(!state.protectedFields.includes(custom.id));assert.deepEqual(state.globalFields.retired,[custom.id]);assert.deepEqual(state.configuration,adopted.descriptor.fields);
  response=await call('PUT',base+'/dataset/fields',{ref:'main',expectedCommit:adopted.commitId,fields:{}});assert.equal(response.json().error.code,'GLOBAL_FIELD_SNAPSHOT_REQUIRED',response.body);
  const forged=structuredClone(adopted.descriptor.fields!);forged.review_priority!.globalField!.revision=999;response=await call('PUT',base+'/dataset/fields',{ref:'main',expectedCommit:adopted.commitId,fields:forged});assert.equal(response.json().error.code,'GLOBAL_FIELD_ORIGIN_INVALID',response.body);
  const status=(await call('GET',base+'/dataset/fields/global?ref=main')).json();assert.deepEqual(status.retired,[custom.id]);assert.equal(status.needsAdoption,false);
  response=await call('POST','/api/global-fields/synchronize',{expectedRevision:3,targets:[{...key,ref:'main',expectedCommit:adopted.commitId}]});assert.equal(response.json().results[0].status,'current');assert.equal((await datasets.read(key,'main')).commitId,adopted.commitId);
  response=await call('POST',base+'/dataset/fields/delete',{ref:'main',expectedCommit:adopted.commitId,fieldId:custom.id,confirmFieldId:custom.id});assert.equal(response.statusCode,200,response.body);
  const deleted=await datasets.read(key,'main');assert.notEqual(deleted.commitId,adopted.commitId);assert.equal(deleted.rows[0]!.review_priority,undefined);assert.equal(deleted.descriptor.fields?.review_priority,undefined);assert.equal((await datasets.read(key,adopted.commitId)).rows[0]!.review_priority,'urgent');
  const disk=JSON.parse(await readFile(path.join(directory,'governance.json'),'utf8'));assert.ok(disk.globalFieldProjects.some((item:any)=>item.repo===key.repo),'a single custom global adoption establishes sticky governance');
});

test('R18 arbitrary identity and source-truth field IDs cannot be added to global catalog',async t=>{
  const {call}=await setup(t);for(const id of ['id','uid','label','ground_truth','constructor','prototype','__bundle_provenance']){const response=await call('PUT','/api/global-fields',{expectedRevision:1,fields:[{...custom,id}]});assert.equal(response.statusCode,400,response.body);}assert.equal((await call('GET','/api/global-fields')).json().catalog.revision,1);
});

test('R18 retired legacy four-dimensional snapshots cannot be silently stripped via project configuration',async t=>{
  const {call,provider}=await setup(t),{key,snapshot}=await project(provider,'r18-legacy-snapshot',[{id:'synthetic-1',split:'train'}]);
  const metadata=globalFieldMetadata(defaultGlobalFieldCatalog());for(const value of Object.values(metadata))delete value.globalField;
  const datasets=new DatasetService(provider),workspace=await provider.createWorkspace(key,'Synthetic legacy metadata','main');
  await provider.writeWorkspace(key,workspace.id,'.oxenweb/dataset.json',Buffer.from(JSON.stringify({...snapshot.descriptor,fields:metadata})));await provider.commitWorkspace(key,workspace.id,'Synthetic legacy definitions',snapshot.commitId);await provider.deleteWorkspace(key,workspace.id);
  const adopted=await datasets.read(key,'main');assert.ok(adopted.descriptor.fields?.split,'fixture path must be the descriptor');
  assert.equal((await call('PUT','/api/global-fields',{expectedRevision:1,fields:[]})).statusCode,200);
  const response=await call('PUT',`/api/repos/${key.namespace}/${key.repo}/dataset/fields`,{ref:'main',expectedCommit:adopted.commitId,fields:{}});assert.equal(response.json().error.code,'GLOBAL_FIELD_SNAPSHOT_REQUIRED',response.body);
});

test('R18 project admins and designated catalog viewers cannot mutate catalog or batch synchronize',async t=>{
  const {call}=await setup(t),grant=(await call('POST','/api/repos/oxen/visual-search/access',{name:'Synthetic project admin',role:'admin'})).json();assert.ok(grant.token);
  let response=await call('POST','/api/global-fields/maintainers',{identityId:grant.collaborator.id,enabled:true,expectedRevision:1});assert.equal(response.statusCode,200,response.body);
  const state=(await call('GET','/api/global-fields',undefined,grant.token)).json();assert.equal(state.canManage,true);assert.equal(state.canEdit,false);assert.equal((await call('GET','/api/global-fields/history',undefined,grant.token)).statusCode,200);
  response=await call('PUT','/api/global-fields',{expectedRevision:2,fields:[custom]},grant.token);assert.equal(response.statusCode,403,response.body);assert.equal(response.json().error.code,'GLOBAL_FIELD_ADMIN_REQUIRED');
  response=await call('POST','/api/global-fields/synchronize',{expectedRevision:2,targets:[{namespace:'oxen',repo:'visual-search',ref:'main',expectedCommit:'synthetic'}]},grant.token);assert.equal(response.statusCode,403,response.body);
});

test('R18 project presentation edits preserve catalog origin and never assign values',()=>{
  const catalog={...defaultGlobalFieldCatalog(),revision:7,fields:[custom]},metadata=globalFieldMetadata(catalog),draft=createSampleFieldDraft(custom.id,metadata[custom.id]);draft.visible=false;draft.export=false;draft.order=4;
  const edited=sampleFieldMetadata(draft)!;assert.deepEqual(edited.globalField,{id:custom.id,revision:7});assert.equal(edited.visible,false);assert.equal(edited.export,false);assert.deepEqual(adoptGlobalFieldMetadata({review_priority:edited},{...catalog,fields:[]}),{review_priority:edited});
});
