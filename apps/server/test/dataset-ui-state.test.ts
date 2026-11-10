import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { DatasetUiStateService, uiStateSaveSchema } from '../src/dataset-ui-state.js';
import { ApiError } from '../src/errors.js';
import type { DatasetCapability, RequestIdentity } from '../../../packages/shared/src/index.js';
import { DemoProvider } from '../src/demo.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const owner:RequestIdentity={id:'owner',name:'Synthetic owner',kind:'owner',source:'local'},other:RequestIdentity={id:'other',name:'Synthetic other',kind:'collaborator',source:'bearer'},key={namespace:'local',repo:'ui-state-fixture'};
test('personal table layouts persist for read-only members without touching sample branches and use actor/ref CAS',async t=>{
  const f=await fixture(t);f.setWrite(false);
  const payload={version:1,order:['source:text','system:human-labels','source:id'],widths:{'source:text':640,'source:id':96}};
  const longId='source:'+encodeURIComponent('字'.repeat(500));
  const unicodeSaved=await f.service.save(key,other,{kind:'table-layout',ref:'unicode',revision:0,payload:{version:1,order:[longId],widths:{[longId]:240}}});assert.equal((unicodeSaved.state!.payload as {order:string[]}).order[0],longId);
  const saved=(await f.service.save(key,other,{kind:'table-layout',ref:'main',revision:0,payload})).state!;
  assert.equal(saved.revision,1);assert.deepEqual((await f.service.read(key,other,'main','table-layout')).state?.payload,payload);
  assert.deepEqual(await f.service.read(key,owner,'main','table-layout'),{});assert.deepEqual(await f.service.read(key,other,'other','table-layout'),{});
  await assert.rejects(f.service.save(key,other,{kind:'table-layout',ref:'main',revision:0,payload}),{code:'UI_STATE_REVISION_CONFLICT'});
  for(const bad of [{...payload,order:['source:id','source:id']},{...payload,widths:{'source:id':71}},{...payload,widths:{'source:id':1201}},{...payload,widths:{'source:id':100.5}}])await assert.rejects(f.service.save(key,other,{kind:'table-layout',ref:'main',revision:1,expectedId:saved.id,payload:bad}));
  f.setRead(false);await assert.rejects(f.service.read(key,other,'main','table-layout'),{code:'CAPABILITY_REQUIRED'});
});
async function fixture(t:{after:(work:()=>Promise<void>)=>void}){
  const root=path.resolve('.data/tests');await mkdir(root,{recursive:true});const directory=await mkdtemp(path.join(root,'ui-state-'));
  t.after(async()=>{if(!path.resolve(directory).startsWith(root+path.sep))throw new Error('Unsafe fixture cleanup');await rm(directory,{recursive:true,force:true});});
  let read=true,write=true;const access={requireCapability:async(_key:unknown,_identity:RequestIdentity,capability:DatasetCapability)=>{if(capability==='read'?!read:!write)throw new ApiError(403,'CAPABILITY_REQUIRED','Synthetic access revoked');}};
  const service=new DatasetUiStateService({directory:path.join(directory,'checkpoints'),access});return {directory,service,access,setRead:(value:boolean)=>{read=value;},setWrite:(value:boolean)=>{write=value;}};
}

test('opaque invalid UI input survives restart without a current branch, valid draft, or provider write',async t=>{
  const f=await fixture(t),payload=JSON.parse('{"cell":"invalid-number","fullJson":"{ unfinished","newField":"","typedOptions":"true\\nnot bool","__proto__":{"note":"data only"}}');
  const saved=(await f.service.save(key,owner,{ref:'work/not-existing',kind:'field-settings',revision:0,baseCommit:'old-unavailable-commit',payload})).state!;
  assert.equal(saved.revision,1);assert.equal(saved.ref,'work/not-existing');assert.deepEqual(saved.payload,payload);assert.equal(Object.hasOwn(saved.payload as object,'__proto__'),true);
  const restarted=new DatasetUiStateService({directory:path.join(f.directory,'checkpoints'),access:f.access});assert.deepEqual((await restarted.read(key,owner,'work/not-existing','field-settings')).state,saved);
  for(const [repository,identity,ref,kind]of [[key,other,saved.ref,saved.kind],[key,owner,'other',saved.kind],[key,owner,saved.ref,'workbench'],[{...key,repo:'other-repo'},owner,saved.ref,saved.kind]] as const)assert.deepEqual(await restarted.read(repository,identity,ref,kind),{});
});

test('double CAS serializes concurrent saves and prevents delete/recreate ABA overwrites',async t=>{
  const f=await fixture(t),input={ref:'main',kind:'workbench' as const,revision:0,payload:{text:'first'}};
  const concurrent=await Promise.allSettled([f.service.save(key,owner,input),f.service.save(key,owner,{...input,payload:{text:'other tab'}})]);assert.equal(concurrent.filter(result=>result.status==='fulfilled').length,1);assert.equal((concurrent.find(result=>result.status==='rejected') as PromiseRejectedResult).reason.code,'UI_STATE_REVISION_CONFLICT');
  const original=(await f.service.read(key,owner,'main','workbench')).state!;
  await assert.rejects(()=>f.service.save(key,owner,{...input,revision:original.revision,expectedId:'00000000-0000-4000-8000-000000000000'}),(error:any)=>error.code==='UI_STATE_REVISION_CONFLICT');
  await f.service.delete(key,owner,{ref:'main',kind:'workbench',revision:original.revision,expectedId:original.id});
  const replaced=(await f.service.save(key,owner,input)).state!;assert.equal(replaced.revision,original.revision);assert.notEqual(replaced.id,original.id);
  await assert.rejects(()=>f.service.delete(key,owner,{ref:'main',kind:'workbench',revision:original.revision,expectedId:original.id}),(error:any)=>error.code==='UI_STATE_REVISION_CONFLICT');
  await assert.rejects(()=>f.service.save(key,owner,{...input,revision:original.revision,expectedId:original.id}),(error:any)=>error.code==='UI_STATE_REVISION_CONFLICT');
  const updated=(await f.service.save(key,owner,{...input,revision:replaced.revision,expectedId:replaced.id,payload:{text:'second'}})).state!;assert.equal(updated.revision,2);assert.equal(updated.id,replaced.id);
});

test('revoked write capability retains only own existing UI input, while read revocation denies every operation',async t=>{
  const f=await fixture(t),saved=(await f.service.save(key,owner,{ref:'main',kind:'field-settings',revision:0,payload:{options:'invalid'}})).state!;
  f.setWrite(false);assert.equal((await f.service.read(key,owner,'main','field-settings')).state!.id,saved.id);
  const retained=(await f.service.save(key,owner,{ref:'main',kind:'field-settings',revision:saved.revision,expectedId:saved.id,payload:{options:'still unfinished'}})).state!;
  await assert.rejects(()=>f.service.save(key,owner,{ref:'main',kind:'workbench',revision:0,payload:{pending:[]}}),(error:any)=>error.code==='UI_STATE_CAPABILITY_REQUIRED');
  await assert.rejects(()=>f.service.save(key,other,{ref:'main',kind:'field-settings',revision:0,payload:{copy:'no'}}),(error:any)=>error.code==='UI_STATE_CAPABILITY_REQUIRED');
  f.setRead(false);await assert.rejects(()=>f.service.read(key,owner,'main','field-settings'),(error:any)=>error.status===403);
  await assert.rejects(()=>f.service.save(key,owner,{ref:'main',kind:'field-settings',revision:retained.revision,expectedId:retained.id,payload:null}),(error:any)=>error.status===403);
  await assert.rejects(()=>f.service.delete(key,owner,{ref:'main',kind:'field-settings',revision:retained.revision,expectedId:retained.id}),(error:any)=>error.status===403);
  f.setRead(true);assert.equal((await f.service.read(key,owner,'main','field-settings')).state!.revision,retained.revision);
  await assert.rejects(()=>f.service.read(key,{...owner,kind:'guest'},'main','field-settings'),(error:any)=>error.status===401);
});

test('bounded pure JSON rejects invalid payloads and preserves the existing checkpoint',async t=>{
  const f=await fixture(t),input={ref:'main',kind:'workbench' as const,revision:0,payload:{text:'kept'}},saved=(await f.service.save(key,owner,input)).state!;
  const cycle:any={};cycle.self=cycle;
  for(const value of [undefined,NaN,BigInt(1),new Date(),cycle,{value:undefined},'x'.repeat(24*1024*1024+1)]){
    assert.equal(uiStateSaveSchema.safeParse({...input,payload:value}).success,false);
  }
  assert.equal(uiStateSaveSchema.safeParse({...input,revision:1}).success,false);assert.equal(uiStateSaveSchema.safeParse({...input,expectedId:saved.id}).success,false);assert.deepEqual((await f.service.read(key,owner,'main','workbench')).state,saved);
});

test('HTTP recovery state accepts larger raw input than a draft, keeps repositories private, and never creates a commit',async t=>{
  const f=await fixture(t),provider=new DemoProvider(path.join(f.directory,'demo.json'));await provider.init();await provider.createRepo({namespace:key.namespace,name:key.repo,description:'Synthetic UI state',visibility:'private'});
  const token='synthetic-ui-state-owner',app=await createApp(loadConfig({DEMO_MODE:'true',DEMO_DATA_FILE:path.join(f.directory,'demo.json'),BFF_TOKEN:token}),provider);t.after(()=>app.close());const url='/api/repos/'+key.namespace+'/'+key.repo+'/dataset/ui-state',headers={authorization:'Bearer '+token},head=(await provider.branches(key))[0]!.commitId;
  let response=await app.inject({method:'PUT',url,headers,payload:{ref:'missing-branch',kind:'workbench',revision:0,baseCommit:'not-current',payload:{incomplete:'{',large:'x'.repeat(13*1024*1024)}}});assert.equal(response.statusCode,200,response.body.slice(0,200));const state=response.json().state;
  response=await app.inject({url:url+'?ref=missing-branch&kind=workbench',headers});assert.equal(response.statusCode,200);assert.equal(response.json().state.payload.incomplete,'{');
  response=await app.inject({url:url+'?ref=missing-branch&kind=workbench'});assert.ok([401,403].includes(response.statusCode));
  response=await app.inject({method:'DELETE',url,headers,payload:{ref:'missing-branch',kind:'workbench',revision:state.revision,expectedId:state.id}});assert.equal(response.statusCode,200,response.body);
  assert.equal((await provider.branches(key))[0]!.commitId,head);assert.deepEqual(await provider.workspaces(key),[]);
});

test('HTTP write revocation still allows own checkpoint retention but never grants dataset mutation',async t=>{
  const f=await fixture(t),provider=new DemoProvider(path.join(f.directory,'demo.json'));await provider.init();await provider.createRepo({namespace:key.namespace,name:key.repo,description:'Synthetic capability checkpoint',visibility:'private'});
  const token='synthetic-ui-state-owner',app=await createApp(loadConfig({DEMO_MODE:'true',DEMO_DATA_FILE:path.join(f.directory,'demo.json'),BFF_TOKEN:token}),provider);t.after(()=>app.close());const base='/api/repos/'+key.namespace+'/'+key.repo,ownerHeaders={authorization:'Bearer '+token};
  let response=await app.inject({method:'POST',url:base+'/access',headers:ownerHeaders,payload:{name:'Synthetic field maintainer',role:'lead',capabilities:['read','schema.bind']}});assert.equal(response.statusCode,201,response.body);const granted=response.json(),headers={authorization:'Bearer '+granted.token};
  response=await app.inject({method:'PUT',url:base+'/dataset/ui-state',headers,payload:{ref:'main',kind:'field-settings',revision:0,payload:{unfinished:'true\nwrong boolean'}}});assert.equal(response.statusCode,200,response.body);const original=response.json().state;
  response=await app.inject({method:'PATCH',url:base+'/access/'+granted.collaborator.id,headers:ownerHeaders,payload:{role:'viewer',capabilities:['read']}});assert.equal(response.statusCode,200,response.body);const head=(await provider.branches(key))[0]!.commitId;
  response=await app.inject({method:'PUT',url:base+'/dataset/ui-state',headers,payload:{ref:'main',kind:'field-settings',revision:original.revision,expectedId:original.id,payload:{unfinished:'Preserved after write revocation'}}});assert.equal(response.statusCode,200,response.body);const retained=response.json().state;
  response=await app.inject({method:'PUT',url:base+'/dataset/fields',headers,payload:{ref:'main',expectedCommit:head,fields:{safe:{type:'boolean'}}}});assert.equal(response.statusCode,403,response.body);
  response=await app.inject({method:'PUT',url:base+'/dataset/ui-state',headers,payload:{ref:'another',kind:'field-settings',revision:0,payload:null}});assert.equal(response.statusCode,403,response.body);
  response=await app.inject({url:base+'/dataset/ui-state?ref=main&kind=field-settings',headers:ownerHeaders});assert.deepEqual(response.json(),{});
  response=await app.inject({method:'DELETE',url:base+'/dataset/ui-state',headers,payload:{ref:'main',kind:'field-settings',revision:retained.revision,expectedId:retained.id}});assert.equal(response.statusCode,200,response.body);assert.equal((await provider.branches(key))[0]!.commitId,head);
});
