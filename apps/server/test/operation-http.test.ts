import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../src/app.js';
import {DemoProvider} from '../src/demo.js';
import {loadConfig} from '../src/config.js';
import {ApiError} from '../src/errors.js';
import {installOperationHttp,reconcileOperation} from '../src/operation-http.js';
import {OperationJournal} from '../src/operation-journal.js';
import {operationContext} from '../src/operation-context.js';
import Fastify from 'fastify';
import {InstanceRuntime} from '../src/instance-runtime.js';
import {GlobalAuditService} from '../src/global-audit.js';
import {tracksOperation} from '../../web/src/operation-errors.js';

async function fixture(t:any){const root=path.resolve('.data/tests');await mkdir(root,{recursive:true});const directory=await mkdtemp(path.join(root,'operation-http-')),token='synthetic-r10-operation-owner-token',config=loadConfig({DEMO_MODE:'true',DEMO_DATA_FILE:path.join(directory,'demo.json'),BFF_TOKEN:token}),provider=new DemoProvider(config.demoFile);await provider.init();await provider.createRepo({namespace:'local',name:'synthetic-operation',description:'Synthetic fixture'});const key={namespace:'local',repo:'synthetic-operation'},base='/api/repos/local/synthetic-operation',headers={authorization:'Bearer '+token};const runtime=new InstanceRuntime();let app=await createApp(config,provider,runtime);t.after(async()=>{await app.close();if(!directory.startsWith(root+path.sep))throw new Error('Unsafe fixture cleanup');await rm(directory,{recursive:true,force:true});});return {directory,key,base,headers,provider,config,runtime,get app(){return app;},async restart(){await app.close();app=await createApp(config,provider,new InstanceRuntime());}};}

test('remote commit reply loss survives restart and reconciles by a fixed operation marker without re-commit',async t=>{
  const f=await fixture(t),before=(await f.provider.branches(f.key))[0]!.commitId,operationId=randomUUID(),payload={ref:'main',expectedCommit:before,content:'# Synthetic body must stay outside the journal\n',message:'Synthetic commit'},real=f.provider.commitWorkspace.bind(f.provider);let lost=true;
  f.provider.commitWorkspace=async(...args)=>{const value=await real(...args);if(lost)throw new ApiError(504,'SYNTHETIC_REPLY_LOST','Synthetic reply loss');return value;};
  // The app's provider proxy intentionally resolves current methods for fault-injection adapters.
  await f.restart();const response=await f.app.inject({method:'PUT',url:f.base+'/readme',headers:{...f.headers,'x-operation-id':operationId},payload});assert.equal(response.statusCode,504);
  const after=(await f.provider.branches(f.key))[0]!.commitId;assert.notEqual(after,before);const count=(await f.provider.commits(f.key,'main')).length;
  lost=false;await f.restart();const record=(await f.app.inject({url:'/api/operations/'+operationId,headers:f.headers})).json();assert.equal(record.state,'reconciliation-required');assert.equal(record.anchors.commitId,undefined);
  const reconciled=await f.app.inject({method:'POST',url:'/api/operations/'+operationId+'/reconcile',headers:f.headers,payload:{}});assert.equal(reconciled.statusCode,200,reconciled.body);assert.equal(reconciled.json().state,'succeeded');assert.equal(reconciled.json().anchors.commitId,after);
  const replay=await f.app.inject({method:'PUT',url:f.base+'/readme',headers:{...f.headers,'x-operation-id':operationId},payload});assert.equal(replay.statusCode,409);assert.equal(replay.json().error.code,'OPERATION_ALREADY_SUCCEEDED');assert.equal((await f.provider.commits(f.key,'main')).length,count);
  const journal=await readFile(path.join(f.directory,'operation-journal.json'),'utf8'),audit=await readFile(path.join(f.directory,'global-audit.json'),'utf8');assert.equal(journal.includes('Synthetic body must stay'),false);assert.equal(audit.includes('Synthetic body must stay'),false);
});
test('an operation ID is bound to actor, method and payload, with no mutable retry on mismatch',async t=>{
  const f=await fixture(t),operationId=randomUUID(),before=(await f.provider.branches(f.key))[0]!.commitId;
  const first=await f.app.inject({method:'POST',url:f.base+'/branches',headers:{...f.headers,'x-operation-id':operationId},payload:{name:'synthetic-a',from:before}});assert.equal(first.statusCode,201,first.body);
  const second=await f.app.inject({method:'POST',url:f.base+'/branches',headers:{...f.headers,'x-operation-id':operationId},payload:{name:'synthetic-b',from:before}});assert.equal(second.statusCode,409);assert.equal(second.json().error.code,'OPERATION_INPUT_CHANGED');assert.equal((await f.provider.branches(f.key)).some(item=>item.name==='synthetic-b'),false);
});
test('macro audit records project actions but not queries, bodies, tokens or read-only private state',async t=>{
  const f=await fixture(t);const create=await f.app.inject({method:'POST',url:'/api/repos',headers:f.headers,payload:{namespace:'local',name:'another-synthetic',description:'Do not copy the description into audit'}});assert.equal(create.statusCode,201,create.body);
  const events=(await f.app.inject({url:'/api/audit-events',headers:f.headers})).json();assert.ok(events.items.some((item:any)=>item.action==='project.created'&&item.repository.repo==='another-synthetic'));
  const token=await f.app.inject({method:'POST',url:'/api/access-management/grants',headers:f.headers,payload:{scope:'instance',name:'Synthetic read-only auditor',globalRole:'auditor'}});assert.equal(token.statusCode,201,token.body);
  const serialized=await readFile(path.join(f.directory,'operation-journal.json'),'utf8');assert.equal(serialized.includes(token.json().token),false);assert.equal(serialized.includes('Do not copy the description'),false);
  const guest=await f.app.inject('/api/audit-events');assert.ok([401,403].includes(guest.statusCode));
});
test('a real client disconnect does not make an unfinished commit appear drained',async t=>{
  const f=await fixture(t),before=(await f.provider.branches(f.key))[0]!.commitId,real=f.provider.commitWorkspace.bind(f.provider);
  let ready!:()=>void,finish!:()=>void;const started=new Promise<void>(resolve=>ready=resolve);
  f.provider.commitWorkspace=async(...args)=>{ready();await new Promise<void>(resolve=>finish=resolve);return real(...args);};
  const origin=await f.app.listen({host:'127.0.0.1',port:0}),abort=new AbortController();
  const request=fetch(origin+f.base+'/readme',{method:'PUT',headers:{...f.headers,'content-type':'application/json'},body:JSON.stringify({ref:'main',expectedCommit:before,content:'# Synthetic interrupted client\n',message:'Synthetic disconnect'}),signal:abort.signal}).then(()=>false,()=>true);
  await started;abort.abort();assert.equal(await request,true);assert.equal(f.runtime.state().activeWrites,1);
  await assert.rejects(()=>f.runtime.drain(25),(error:any)=>error.code==='DRAIN_TIMEOUT');
  assert.equal(f.runtime.state().activeWrites,1,'The awaited upstream commit still holds its writer lease');
  finish();const drained=await f.runtime.drain(5000);assert.equal(drained.activeWrites,0);assert.notEqual((await f.provider.branches(f.key))[0]!.commitId,before);
});

test('operation list scope is filtered before pagination even for the same actor with two project credentials',async t=>{
  const f=await fixture(t),other={namespace:'local',repo:'synthetic-other-scope'},otherBase='/api/repos/local/synthetic-other-scope';await f.provider.createRepo({...other,name:other.repo,description:"Synthetic scoped journal fixture"});
  const grant=async(payload:Record<string,unknown>)=>{const result=await f.app.inject({method:'POST',url:'/api/access-management/grants',headers:f.headers,payload});assert.equal(result.statusCode,201,result.body);return result.json();};
  const first=await grant({scope:'project',repository:f.key,name:'Synthetic shared person',role:'editor'}),second=await grant({scope:'project',repository:other,existingActorId:first.collaborator.id,role:'editor'});
  const ownOperation=randomUUID(),otherOperation=randomUUID();
  for(const [base,token,operationId,name]of [[f.base,first.token,ownOperation,'scope-a'],[otherBase,second.token,otherOperation,'scope-b']] as const){const result=await f.app.inject({method:'POST',url:base+'/branches',headers:{authorization:'Bearer '+token,'x-operation-id':operationId},payload:{name,from:'main'}});assert.equal(result.statusCode,201,result.body);}
  const list=await f.app.inject({url:'/api/operations?pageSize=1',headers:{authorization:'Bearer '+first.token}});assert.equal(list.statusCode,200,list.body);assert.equal(list.json().total,1);assert.deepEqual(list.json().items.map((item:any)=>item.id),[ownOperation]);assert.equal(list.body.includes(other.repo),false);
  assert.equal((await f.app.inject({url:'/api/operations/'+otherOperation,headers:{authorization:'Bearer '+first.token}})).statusCode,403);
  const ownB=await f.app.inject({url:'/api/operations',headers:{authorization:'Bearer '+second.token}});assert.equal(ownB.json().total,1);assert.deepEqual(ownB.json().items.map((item:any)=>item.id),[otherOperation]);
});

test('maintenance drains writes while health and read-only queries remain available',async t=>{
  const f=await fixture(t),drained=await f.app.inject({method:'POST',url:'/api/maintenance/drain',headers:f.headers,payload:{}});assert.equal(drained.statusCode,200,drained.body);assert.equal(drained.json().activeWrites,0);assert.equal(typeof drained.json().pid,'number');
  assert.equal((await f.app.inject('/api/health')).json().runtime.acceptsWrites,false);
  const blocked=await f.app.inject({method:'POST',url:f.base+'/branches',headers:f.headers,payload:{name:'blocked',from:'main'}});assert.equal(blocked.statusCode,503);
  assert.equal((await f.app.inject({method:'POST',url:'/api/maintenance/resume',headers:f.headers,payload:{}})).statusCode,200);
  assert.equal((await f.app.inject({method:'POST',url:f.base+'/branches',headers:f.headers,payload:{name:'after-maintenance',from:'main'}})).statusCode,201);
});
test('a ready release cannot prove a failed publication and failed asset validation never yields success',async()=>{
  const record:any={id:randomUUID(),kind:'release.publish',key:{namespace:'local',repo:'synthetic'},state:'reconciliation-required',anchors:{releaseId:randomUUID()},actorId:'owner',actorName:'Synthetic owner'},identity:any={id:'owner',name:'Synthetic owner',kind:'owner'},services:any={release:async()=>({status:'ready',assets:[{sha256:'a'.repeat(64)}]})};
  assert.equal((await reconcileOperation(record,identity,services)).state,'reconciliation-required');
  services.release=async()=>{throw new ApiError(409,'RELEASE_ASSET_INTEGRITY','Synthetic corrupt asset');};await assert.rejects(()=>reconcileOperation({...record,kind:'release.build'},identity,services),(error:any)=>error.code==='RELEASE_ASSET_INTEGRITY');
});

test('removed manual-latest requests have no operation matcher or current-release success evidence',async t=>{
  const f=await fixture(t),id=randomUUID(),before=(await f.app.inject({url:'/api/operations',headers:f.headers})).json().total;
  assert.equal(tracksOperation('/repos/local/synthetic-operation/releases/'+id+'/latest','POST'),false);
  for(const action of ['build','publish','withdraw'])assert.equal(tracksOperation('/repos/local/synthetic-operation/releases/'+id+'/'+action,'POST'),true);
  const response=await f.app.inject({method:'POST',url:f.base+'/releases/'+id+'/latest',headers:{...f.headers,'x-operation-id':randomUUID()},payload:{expectedRevision:1}});
  assert.equal(response.statusCode,404);assert.equal(response.headers['x-operation-id'],undefined);assert.equal((await f.app.inject({url:'/api/operations',headers:f.headers})).json().total,before);
  const historical:any={id:randomUUID(),kind:'release.latest',key:f.key,state:'reconciliation-required',anchors:{releaseId:id}},identity:any={id:'owner',name:'Synthetic owner',kind:'owner'},services:any={release:async()=>({id,status:'published',latest:true,assets:[{sha256:'a'.repeat(64)}]})};
  assert.equal((await reconcileOperation(historical,identity,services)).state,'reconciliation-required');
});

test('stored manual-latest journal and macro audit events remain generically readable without rewriting history',async t=>{
  const root=path.resolve('.data/tests');await mkdir(root,{recursive:true});const directory=await mkdtemp(path.join(root,'operation-history-read-')),filename=path.join(directory,'operation-journal.json'),auditFile=path.join(directory,'global-audit.json'),key={namespace:'local',repo:'synthetic-history'},token='synthetic-history-owner',id=randomUUID(),actor={id:'owner',name:'Synthetic owner',kind:'owner' as const,source:'local' as const};
  const journal=new OperationJournal(filename);await journal.init();await journal.run({id,actorId:actor.id,actorName:actor.name,kind:'release.latest',key,payload:{synthetic:true}},async()=>({value:{},anchors:{releaseId:randomUUID()}}));
  const audit=new GlobalAuditService(auditFile);await audit.init();await audit.record({action:'release.latest_changed',actor,repository:key});const journalBefore=await readFile(filename),auditBefore=await readFile(auditFile);
  const config=loadConfig({DEMO_MODE:'true',DEMO_DATA_FILE:path.join(directory,'demo.json'),BFF_TOKEN:token}),provider=new DemoProvider(config.demoFile);await provider.init();await provider.createRepo({...key,name:key.repo,description:'Synthetic immutable history fixture'});const app=await createApp(config,provider);
  t.after(async()=>{await app.close();assert.ok(directory.startsWith(root+path.sep));await rm(directory,{recursive:true,force:true});});
  const headers={authorization:'Bearer '+token},readback=await app.inject({url:'/api/operations/'+id,headers});assert.equal(readback.statusCode,200,readback.body);assert.equal(readback.json().kind,'release.latest');
  const events=await app.inject({url:'/api/audit-events',headers});assert.equal(events.statusCode,200);assert.ok(events.json().items.some((event:any)=>event.action==='release.latest_changed'));
  assert.deepEqual(await readFile(filename),journalBefore);assert.deepEqual(await readFile(auditFile),auditBefore);
});

test('field-delete confirmation, protected-field and stale-head rejections are terminal failed before writes, not pending reconciliation',async t=>{
  const f=await fixture(t),initial=(await f.provider.branches(f.key))[0]!.commitId;
  const initialized=await f.app.inject({method:'POST',url:f.base+'/dataset/initialize-empty',headers:f.headers,payload:{ref:'main',expectedCommit:initial}});assert.equal(initialized.statusCode,200,initialized.body);const head=initialized.json().commitId;
  for(const [payload,status,reason]of [
    [{ref:'main',expectedCommit:head,fieldId:'split',confirmFieldId:'Split'},422,'DATASET_FIELD_DELETE_CONFIRM'],
    [{ref:'main',expectedCommit:head,fieldId:'split',confirmFieldId:'split'},422,'DATASET_FIELD_DELETE_PROTECTED'],
    [{ref:'main',expectedCommit:initial,fieldId:'unused',confirmFieldId:'unused'},409,'DATASET_VERSION_CONFLICT'],
  ] as const){const operationId=randomUUID(),response=await f.app.inject({method:'POST',url:f.base+'/dataset/fields/delete',headers:{...f.headers,'x-operation-id':operationId},payload});assert.equal(response.statusCode,status,response.body);assert.equal(response.json().error.code,reason);const record=(await f.app.inject({url:'/api/operations/'+operationId,headers:f.headers})).json();assert.equal(record.state,'failed');assert.equal(record.reasonCode,reason);assert.deepEqual(record.anchors,{});}
  assert.equal((await f.provider.branches(f.key))[0]!.commitId,head);assert.equal((await f.provider.workspaces(f.key)).length,0);
  const health=(await f.app.inject('/api/health')).json();assert.equal(health.pendingReconciliation,false);
});

test('legacy field-delete guard reconciliation requires a complete anchored history and no managed workspace or mutation anchors',async()=>{
  const id=randomUUID(),record:any={id,kind:'dataset.fields.delete',key:{namespace:'local',repo:'synthetic-rejected-delete'},ref:'main',expectedHead:'before',state:'reconciliation-required',anchors:{},reasonCode:'DATASET_VERSION_CONFLICT'},identity:any={id:'owner',name:'Synthetic owner',kind:'owner'};
  const provider:any={commits:async()=>[{id:'later',message:'Synthetic unrelated successful change',parentIds:['before']},{id:'before',message:'Synthetic base',parentIds:[]}],workspaces:async()=>[]},services:any={provider};
  for(const reasonCode of ['DATASET_FIELD_DELETE_CONFIRM','DATASET_FIELD_DELETE_PROTECTED','DATASET_VERSION_CONFLICT']){const result=await reconcileOperation({...record,reasonCode},identity,services);assert.equal(result.state,'failed');assert.equal(result.reasonCode,'FIELD_DELETE_PREWRITE_REJECTION_VERIFIED');}
  assert.equal((await reconcileOperation({...record,kind:'dataset.commit'},identity,services)).state,'reconciliation-required');
  assert.equal((await reconcileOperation({...record,anchors:{workspaceId:'uncertain-workspace'}},identity,services)).state,'reconciliation-required');
  provider.workspaces=async()=>[{id:'pending',name:'Delete sample field'}];assert.equal((await reconcileOperation(record,identity,services)).reasonCode,'FIELD_DELETE_WORKSPACE_REQUIRES_INSPECTION');
  provider.workspaces=async()=>[];provider.commits=async()=>[{id:'unrelated',message:'Synthetic incomplete history',parentIds:[]}];assert.equal((await reconcileOperation(record,identity,services)).state,'reconciliation-required');
});

test('Release local prewrite guards are failed only before any control/provider write attempt; unknown failures stay unresolved',async t=>{
  const root=path.resolve('.data/tests');await mkdir(root,{recursive:true});const directory=await mkdtemp(path.join(root,'release-prewrite-')),journal=new OperationJournal(path.join(directory,'journal.json'));await journal.init();const app=Fastify();t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});
  app.addHook('onRequest',async request=>{request.oxenIdentity={id:'synthetic-owner',name:'Synthetic owner',kind:'owner',source:'bearer'};});
  const services:any={journal,provider:{},access:{require:async()=>{},requireCapability:async()=>{}},audit:{record:async()=>{}}};installOperationHttp(app,services);
  app.post('/api/repos/:namespace/:repo/releases',async request=>{const input=request.body as {code:string;status:number;write?:boolean};if(input.write)operationContext.getStore()!.writeAttempted=true;throw new ApiError(input.status,input.code,'Synthetic local guard');});
  for(const [code,status,write,expected]of [['CAPACITY_BUSY',429,false,'failed'],['CAPACITY_BUSY',429,true,'reconciliation-required'],['RELEASE_PREVIEW_CHANGED',409,false,'failed'],['RELEASE_VERSION_EXISTS',409,false,'failed'],['RELEASE_BASELINE_UNAVAILABLE',503,false,'failed'],['RELEASE_ATTACHMENT_REFERENCE',422,false,'failed'],['RELEASE_NO_VIEWS',422,false,'reconciliation-required'],['EVALUATION_POLICY_REQUIRED',409,false,'reconciliation-required'],['RELEASE_PREVIEW_CHANGED',409,true,'reconciliation-required'],['RELEASE_VERSION_EXISTS',409,true,'reconciliation-required'],['RELEASE_VERSION_EXISTS',422,false,'reconciliation-required'],['RESULT_UNKNOWN',409,false,'reconciliation-required'],['OXEN_CONFLICT',409,false,'reconciliation-required']] as const){const id=randomUUID(),response=await app.inject({method:'POST',url:'/api/repos/local/synthetic/releases',headers:{'x-operation-id':id},payload:{code,status,write}});assert.equal(response.statusCode,status,response.body);assert.equal(journal.get(id).state,expected,code+' write='+write);}
});

test('historical unanchored policy-required create rejection reconciles after journal reload without touching existing drafts or replaying',async t=>{
  const root=path.resolve('.data/tests');await mkdir(root,{recursive:true});const directory=await mkdtemp(path.join(root,'legacy-release-reconcile-'));t.after(()=>rm(directory,{recursive:true,force:true}));const filename=path.join(directory,'journal.json'),draft=path.join(directory,'private-draft.json'),draftBytes=Buffer.from('{"synthetic":"existing unsaved private work","revision":7}\n');await writeFile(draft,draftBytes);
  const journal=new OperationJournal(filename);await journal.init();const key={namespace:'local',repo:'synthetic-existing-draft'},inputs=[1,2].map(()=>({id:randomUUID(),actorId:'owner',actorName:'Synthetic owner',kind:'release.create',key,ref:'main',payload:{synthetic:true}}));
  for(const input of inputs)await assert.rejects(journal.run(input,async()=>{throw new ApiError(409,'EVALUATION_POLICY_REQUIRED','Synthetic R16 pure guard');}));
  const restarted=new OperationJournal(filename);await restarted.init();assert.equal(restarted.pending(),2);let providerReads=0,releaseReads=0;
  const identity:any={id:'owner',name:'Synthetic owner',kind:'owner'},services:any={provider:{commits:async()=>{providerReads++;return[];}},release:async()=>{releaseReads++;return{status:'draft'};},evaluationPolicy:async()=>({enabled:true,operationId:'different-later-policy-operation'})};
  for(const input of inputs){const result=await restarted.reconcile(input.id,record=>reconcileOperation(record,identity,services));assert.equal(result.state,'failed');assert.equal(result.reasonCode,'RELEASE_CREATE_PREWRITE_REJECTION_VERIFIED');assert.deepEqual(result.anchors,{});let replayed=false;await assert.rejects(restarted.run(input,async()=>{replayed=true;return{value:{},anchors:{}};}),(error:any)=>error.code==='OPERATION_RECONCILIATION_REQUIRED');assert.equal(replayed,false);}
  assert.equal(restarted.pending(),0);assert.equal(providerReads,0);assert.equal(releaseReads,0);assert.ok((await readFile(draft)).equals(draftBytes));
  const record=restarted.get(inputs[0]!.id),unknown={...record,state:'reconciliation-required' as const,reasonCode:'EVALUATION_POLICY_REQUIRED'};
  for(const changed of [{reasonCode:'PROCESS_INTERRUPTED'},{reasonCode:'EVALUATION_PRIVATE_REQUIRED'},{kind:'snapshot.build'},{kind:'release.update'},{anchors:{assetHashes:[]}},{anchors:{workspaceId:'positive-write-anchor'}},{anchors:{releaseId:'known-candidate'}}]){assert.equal((await reconcileOperation({...unknown,...changed},identity,services)).state,'reconciliation-required');}
  services.evaluationPolicy=async()=>({enabled:true,operationId:record.id});assert.equal((await reconcileOperation(unknown,identity,services)).reasonCode,'RELEASE_CREATE_POLICY_WRITE_REQUIRES_INSPECTION');assert.ok((await readFile(draft)).equals(draftBytes));
});
