import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import Fastify from 'fastify';
import {createApp} from '../src/app.js';
import {loadConfig} from '../src/config.js';
import {DemoProvider} from '../src/demo.js';
import {OperationJournal} from '../src/operation-journal.js';
import {GlobalAuditService} from '../src/global-audit.js';
import {installOperationHttp} from '../src/operation-http.js';
import {operationContext} from '../src/operation-context.js';
import {ApiError} from '../src/errors.js';

async function temporary(t:{after:(fn:()=>Promise<void>)=>void}){const root=path.resolve('.data/tests');await mkdir(root,{recursive:true});const value=await mkdtemp(path.join(root,'r20-publish-operation-'));t.after(async()=>{assert.ok(value.startsWith(root+path.sep));await rm(value,{recursive:true,force:true});});return value;}

test('v1 release CAS rejection is bound to its decoded project and confirmed unwritten, without initializing retired publishing configuration or a release',async t=>{
  const directory=await temporary(t),token='synthetic-r20-owner',config=loadConfig({DEMO_MODE:'true',DEMO_DATA_FILE:path.join(directory,'state.json'),BFF_TOKEN:token}),provider=new DemoProvider(config.demoFile),app=await createApp(config,provider);t.after(()=>app.close());
  const headers={authorization:'Bearer '+token},repo='synthetic-dataset-cas';const created=await app.inject({method:'POST',url:'/api/repos',headers,payload:{namespace:'local',name:repo,visibility:'private'}});assert.equal(created.statusCode,201,created.body);
  const key={namespace:'local',repo},before=await provider.branches(key),id=randomUUID(),base='/api/v1/datasets/'+encodeURIComponent('local/'+repo)+'/releases';
  const checked=await app.inject({method:'POST',url:base+'/preview',headers,payload:{sourceRef:'main'}});assert.equal(checked.statusCode,200,checked.body);const preview=checked.json();assert.equal(preview.baselineReleaseId,null);
  const rejected=await app.inject({method:'POST',url:base,headers:{...headers,'x-operation-id':id},payload:{sourceRef:'main',version:'synthetic-v1',title:'Synthetic CAS rejection',notes:'',expectedCommit:preview.commitId,expectedBaselineReleaseId:randomUUID(),expectedPlanDigest:preview.planDigest}});assert.equal(rejected.statusCode,409,rejected.body);assert.equal(rejected.json().error.code,'RELEASE_PREVIEW_CHANGED');
  const record=(await app.inject({url:'/api/operations/'+id,headers})).json();assert.equal(record.state,'failed');assert.deepEqual(record.key,key);assert.equal(record.kind,'release.create');assert.equal((await app.inject({url:base,headers})).json().items.length,0);assert.deepEqual(await provider.branches(key),before);
  const journal=await readFile(path.join(directory,'operation-journal.json'),'utf8');assert.equal(journal.includes('Synthetic CAS rejection'),false);assert.equal((await app.inject({url:'/api/health',headers})).json().pendingReconciliation,false);
});

test('a v1 validation-shaped error after an attempted control write remains unknown and is never silently retried',async t=>{
  const directory=await temporary(t),journal=new OperationJournal(path.join(directory,'journal.json')),audit=new GlobalAuditService(path.join(directory,'audit.json'));await journal.init();await audit.init();const app=Fastify();t.after(()=>app.close());
  app.addHook('onRequest',async request=>{request.oxenIdentity={id:'owner',name:'Synthetic owner',kind:'owner',source:'local'};});
  installOperationHttp(app,{provider:{} as any,access:{requireCapability:async()=>{},require:async()=>{}} as any,journal,audit});let calls=0;
  app.post('/api/v1/datasets/:datasetId/releases',async()=>{calls++;operationContext.getStore()!.writeAttempted=true;throw new ApiError(409,'RELEASE_PREVIEW_CHANGED','Synthetic error after a control write attempt');});
  const id=randomUUID(),input={method:'POST' as const,url:'/api/v1/datasets/'+encodeURIComponent('local/synthetic')+'/releases',headers:{'x-operation-id':id},payload:{sourceRef:'main'}};
  assert.equal((await app.inject(input)).statusCode,409);assert.equal(journal.get(id).state,'reconciliation-required');assert.equal((await app.inject(input)).statusCode,409);assert.equal(calls,1);
});
