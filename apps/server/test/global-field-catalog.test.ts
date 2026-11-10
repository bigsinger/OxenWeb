import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { DemoProvider } from '../src/demo.js';
import { loadConfig } from '../src/config.js';
import { defaultGlobalFieldCatalog, globalFieldMetadata, adoptGlobalFieldMetadata } from '../../../packages/shared/src/global-fields.js';
import { semanticDatasetFields } from '../../../packages/shared/src/field-metadata.js';
import { validateGlobalFieldDefinitions } from '../src/global-field-catalog.js';
import { DatasetService } from '../src/dataset.js';
import {randomUUID} from 'node:crypto';
import Fastify from 'fastify';
import {GovernanceService} from '../src/governance.js';
import {OperationJournal} from '../src/operation-journal.js';
import {installOperationHttp} from '../src/operation-http.js';
import {ApiError} from '../src/errors.js';

const ownerToken = 'global-fields-synthetic-test-owner';
async function setup(t: {after: (callback: () => Promise<void>) => void}) {
  const root = path.resolve('.data/tests'); await mkdir(root, {recursive:true}); const directory = await mkdtemp(path.join(root,'global-fields-'));
  const config = loadConfig({DEMO_MODE:'true', DEMO_DATA_FILE:path.join(directory,'state.json'), BFF_TOKEN:ownerToken}), provider = new DemoProvider(config.demoFile), app = await createApp(config,provider);
  t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});
  const call = (method:'GET'|'POST'|'PUT', url:string, payload?:unknown, token=ownerToken) => app.inject({method,url,headers:{authorization:`Bearer ${token}`},...(payload===undefined?{}:{payload})});
  return {provider,app,call,config};
}

test('four orthogonal builtin fields keep stable values and purposes is multi, with presentation-only labels',()=>{
  const catalog=defaultGlobalFieldCatalog(), fields=globalFieldMetadata(catalog);
  assert.deepEqual(Object.keys(fields),['split','quality','purposes','visibility']);
  assert.deepEqual(fields.split?.enum,['train','dev','test']);
  assert.equal(fields.purposes?.type,'array'); assert.deepEqual(fields.purposes?.items?.enum,['training','regression','smoke','evaluation']);
  const previous={...fields,split:{...fields.split,width:{mode:'fixed' as const,value:170},export:false,visible:false,order:3}};
  const lowercase=structuredClone(catalog);lowercase.fields[0]!.options[0]!.color='#aabbcc';assert.equal(globalFieldMetadata(lowercase).split!.optionColors!['["string","train"]'],'#AABBCC');
  const updated=adoptGlobalFieldMetadata(previous,catalog); assert.equal(updated.split?.width?.value,170); assert.equal(updated.split?.export,false);assert.equal(updated.split?.visible,false);
  assert.deepEqual(semanticDatasetFields(fields),semanticDatasetFields({...fields,quality:{...fields.quality,optionLabels:{'["string","normal"]':'常规'}}}));
  const changed=structuredClone(catalog.fields); changed.find(field=>field.id==='purposes')!.type='single'; validateGlobalFieldDefinitions(changed);
  const removed=structuredClone(catalog.fields); removed[0]!.options.pop(); validateGlobalFieldDefinitions(removed);
});

test('global catalog denies ordinary editors, CAS persists and designated viewers cannot write',async t=>{
  const {call,config}=await setup(t), base='/api/repos/oxen/visual-search';
  const grant=(await call('POST',base+'/access',{name:'Synthetic field consumer',role:'editor'})).json();
  assert.equal((await call('GET','/api/global-fields',undefined,grant.token)).statusCode,403);
  assert.equal((await call('GET','/api/global-fields/catalog',undefined,grant.token)).statusCode,200);
  const state=(await call('GET','/api/global-fields')).json(), next=structuredClone(state.catalog.fields);next[1].displayName='审核质量';
  assert.equal((await call('PUT','/api/global-fields',{expectedRevision:state.catalog.revision,fields:next},grant.token)).statusCode,403);
  let result=await call('PUT','/api/global-fields',{expectedRevision:state.catalog.revision,fields:next});assert.equal(result.statusCode,200,result.body);assert.equal(result.json().catalog.revision,2);
  assert.equal((await call('PUT','/api/global-fields',{expectedRevision:1,fields:next})).statusCode,409);
  const org=(await call('GET','/api/governance/organizations/oxen')).json().organization;
  result=await call('POST','/api/governance/organizations/oxen/maintainers',{identityId:grant.collaborator.id,enabled:true,expectedRevision:org.revision});assert.equal(result.statusCode,200,result.body);
  assert.equal((await call('GET','/api/global-fields',undefined,grant.token)).statusCode,403);
  result=await call('POST','/api/global-fields/maintainers',{identityId:grant.collaborator.id,enabled:true,expectedRevision:2});assert.equal(result.statusCode,200,result.body);
  assert.equal((await call('GET','/api/global-fields',undefined,grant.token)).statusCode,200);
  assert.equal((await call('PUT','/api/global-fields',{expectedRevision:3,fields:next},grant.token)).statusCode,403);
  const restarted=await createApp(config);t.after(()=>restarted.close());
  const persisted=await restarted.inject({url:'/api/global-fields',headers:{authorization:`Bearer ${ownerToken}`}});assert.equal(persisted.statusCode,200,persisted.body);assert.equal(persisted.json().catalog.fields[1].displayName,'审核质量');
});

test('explicit catalog adoption commits definitions only and leaves source records and historical descriptors unchanged',async t=>{
  const {call,provider,config}=await setup(t), key={namespace:'oxen',repo:'adoption-source'}; await provider.createRepo({namespace:key.namespace,name:key.repo,description:'Synthetic unclassified source',visibility:'private'}); const start=(await provider.branches(key)).find(branch=>branch.name==='main')!; const before=await new DatasetService(provider).initialize(key,{kind:'owner',id:'synthetic-owner',name:'Synthetic owner'},{ref:'main',expectedCommit:start.commitId,rows:[{id:'synthetic-1',text:'Synthetic test only',split:'train'},{id:'synthetic-2',text:'Synthetic unassigned'}]});
  const previousBytes=Buffer.from((await provider.raw(key,before.commitId,before.path)).content), previousRows=JSON.stringify(before.rows);
  let result=await call('GET','/api/global-fields/projects');assert.equal(result.statusCode,200,result.body);const target=result.json().projects.find((item:any)=>item.repo===key.repo);assert.ok(target.needsAdoption);
  result=await call('POST','/api/global-fields/synchronize',{expectedRevision:1,targets:[{...key,ref:'main',expectedCommit:before.commitId}]});assert.equal(result.statusCode,200,result.body);assert.equal(result.json().results[0].status,'updated');
  const after=await new DatasetService(provider).read(key,'main');assert.notEqual(after.commitId,before.commitId);assert.equal(JSON.stringify(after.rows),previousRows);assert.deepEqual((await provider.raw(key,after.commitId,after.path)).content,previousBytes);
  const control=JSON.parse(await readFile(path.join(path.dirname(config.demoFile),'governance.json'),'utf8'));assert.ok(control.globalFieldProjects.some((item:any)=>item.namespace===key.namespace&&item.repo===key.repo));
  for(const id of ['split','quality','purposes','visibility'])assert.ok(after.descriptor.fields?.[id]);
  const removed={...after.descriptor.fields};delete removed.quality;
  result=await call('PUT',`/api/repos/${key.namespace}/${key.repo}/dataset/fields`,{ref:'main',expectedCommit:after.commitId,fields:removed});assert.equal(result.statusCode,422,result.body);assert.equal(result.json().error.code,'GLOBAL_FIELD_REQUIRED');
  const misleading=structuredClone(after.descriptor.fields!);misleading.split!.optionLabels!['["string","train"]']='隐藏验收';
  result=await call('PUT',`/api/repos/${key.namespace}/${key.repo}/dataset/fields`,{ref:'main',expectedCommit:after.commitId,fields:misleading});assert.equal(result.statusCode,403,result.body);assert.equal(result.json().error.code,'GLOBAL_FIELD_MANAGED');
  assert.deepEqual((await new DatasetService(provider).read(key,before.commitId)).descriptor,before.descriptor);
  result=await call('POST','/api/global-fields/synchronize',{expectedRevision:1,targets:[{...key,ref:'main',expectedCommit:before.commitId}]});assert.equal(result.json().results[0].status,'blocked');assert.equal(result.json().results[0].code,'DATASET_VERSION_CONFLICT');
});

test('empty dataset initialization adopts current global definitions without assigning any sample classification',async t=>{
  const {call,provider}=await setup(t), key={namespace:'oxen',repo:'empty-global-fields'};let result=await call('POST','/api/repos',{namespace:key.namespace,name:key.repo,description:'Synthetic global defaults',visibility:'private'});assert.equal(result.statusCode,201,result.body);
  const branch=(await provider.branches(key)).find(branch=>branch.name==='main')!;
  result=await call('POST',`/api/repos/${key.namespace}/${key.repo}/dataset/initialize-empty`,{ref:'main',expectedCommit:branch.commitId});assert.equal(result.statusCode,200,result.body);
  const state=await new DatasetService(provider).read(key,'main');assert.equal(state.totalRows,0);assert.deepEqual(Object.keys(state.descriptor.fields??{}),['split','quality','purposes','visibility']);
});

test('catalog and maintainer stale/invalid guards are terminal failed before control writes',async t=>{
  const {call,app}=await setup(t),initial=(await call('GET','/api/global-fields')).json();
  let result=await call('PUT','/api/global-fields',{expectedRevision:initial.catalog.revision,fields:initial.catalog.fields});assert.equal(result.statusCode,200,result.body);const state=result.json();
  const invalid=structuredClone(state.catalog.fields);invalid.push(structuredClone(invalid[0]));
  const removed=structuredClone(state.catalog.fields);removed[0].options.push(structuredClone(removed[0].options[0]));
  for(const [method,url,payload,status,code]of [
    ['PUT','/api/global-fields',{expectedRevision:1,fields:state.catalog.fields},409,'GLOBAL_FIELDS_REVISION_CONFLICT'],
    ['PUT','/api/global-fields',{expectedRevision:2,fields:invalid},422,'GLOBAL_FIELD_DUPLICATE'],
    ['PUT','/api/global-fields',{expectedRevision:2,fields:removed},422,'GLOBAL_FIELD_OPTION_DUPLICATE'],
    ['POST','/api/global-fields/maintainers',{expectedRevision:1,identityId:randomUUID(),enabled:true},409,'GLOBAL_FIELDS_REVISION_CONFLICT'],
    ['POST','/api/global-fields/maintainers',{expectedRevision:2,identityId:randomUUID(),enabled:true},404,'IDENTITY_NOT_FOUND'],
  ] as const){const operationId=randomUUID(),response=await app.inject({method,url,headers:{authorization:'Bearer '+ownerToken,'x-operation-id':operationId},payload});assert.equal(response.statusCode,status,response.body);assert.equal(response.json().error.code,code);const record=(await call('GET','/api/operations/'+operationId)).json();assert.equal(record.state,'failed');assert.equal(record.reasonCode,code);}
  assert.equal((await call('GET','/api/global-fields')).json().catalog.revision,2);
  assert.equal((await call('GET','/api/health')).json().pendingReconciliation,false);
});

test('a catalog write followed by a guarded response failure or audit failure remains unknown instead of falsely failed',async t=>{
  const root=path.resolve('.data/tests');await mkdir(root,{recursive:true});const directory=await mkdtemp(path.join(root,'global-fields-written-fault-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const actor:any={id:'owner',kind:'owner',name:'Synthetic owner',source:'local'},access:any={active:async()=>true,setSchemaAuthorizer:()=>{}},provider:any={},governance=new GovernanceService(provider,access,path.join(directory,'governance.json'));await governance.init(['local']);
  const journal=new OperationJournal(path.join(directory,'journal.json'));await journal.init();let phase='post-write',calls=0;
  const normalAccess=governance.globalFieldAccess.bind(governance);governance.globalFieldAccess=async identity=>{calls++;if(phase==='post-write'&&calls===3)throw new ApiError(409,'GLOBAL_FIELDS_REVISION_CONFLICT','Synthetic failure after the durable write');return normalAccess(identity);};
  const app=Fastify();t.after(()=>app.close());app.setErrorHandler((error,_request,reply)=>reply.code(error instanceof ApiError?error.status:500).send({error:{code:error instanceof ApiError?error.code:'SYNTHETIC_ERROR'}}));app.addHook('onRequest',async request=>{request.oxenIdentity=actor;});
  const audit:any={record:async()=>{if(phase==='audit')throw new ApiError(500,'SYNTHETIC_AUDIT_FAILURE','Synthetic audit failure after mutation');}};
  installOperationHttp(app,{provider,access,journal,audit});app.put('/api/global-fields',request=>{const input=request.body as any;return governance.saveGlobalFields(actor,input.fields,input.expectedRevision);});
  const firstId=randomUUID(),first=await app.inject({method:'PUT',url:'/api/global-fields',headers:{'x-operation-id':firstId},payload:{expectedRevision:1,fields:defaultGlobalFieldCatalog().fields}});assert.equal(first.statusCode,409,first.body);assert.equal(journal.get(firstId).state,'reconciliation-required');assert.equal(JSON.parse(await readFile(path.join(directory,'governance.json'),'utf8')).globalFields.revision,2);
  phase='audit';const secondId=randomUUID(),second=await app.inject({method:'PUT',url:'/api/global-fields',headers:{'x-operation-id':secondId},payload:{expectedRevision:2,fields:defaultGlobalFieldCatalog().fields}});assert.equal(second.statusCode,500,second.body);assert.equal(journal.get(secondId).state,'reconciliation-required');assert.equal(JSON.parse(await readFile(path.join(directory,'governance.json'),'utf8')).globalFields.revision,3);
});
