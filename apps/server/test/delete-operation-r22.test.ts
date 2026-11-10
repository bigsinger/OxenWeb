import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {createApp} from '../src/app.js';
import {DemoProvider} from '../src/demo.js';
import {loadConfig} from '../src/config.js';
import {GlobalAuditService} from '../src/global-audit.js';
import {ReleaseService} from '../src/releases.js';
import {ApiError as ServerError} from '../src/errors.js';
import {OperationJournal} from '../src/operation-journal.js';
import {reconcileOperation} from '../src/operation-http.js';
import {ApiError,removeAndVerify,verifyDeletion,request,isUnknownOperationError} from '../../web/src/api.js';
import {operationIssue,tracksOperation} from '../../web/src/operation-errors.js';
import type {ReleaseShare} from '../../../packages/shared/src/releases.js';

async function fixture(t:{after:(fn:()=>Promise<void>)=>void}){
  operationIssue.value=undefined;const root=path.resolve('.data/tests');await mkdir(root,{recursive:true});const directory=await mkdtemp(path.join(root,'r22-delete-')),token='synthetic-r22-owner',config=loadConfig({DEMO_MODE:'true',DEMO_DATA_FILE:path.join(directory,'state.json'),BFF_TOKEN:token}),provider=new DemoProvider(config.demoFile);let app=await createApp(config,provider);
  t.after(async()=>{operationIssue.value=undefined;await app.close();assert.ok(directory.startsWith(root+path.sep));await rm(directory,{recursive:true,force:true});});
  const call=async(method:'GET'|'POST'|'DELETE',url:string,payload?:object,credential=token)=>{const result=await app.inject({method,url:'/api'+url,headers:{authorization:'Bearer '+credential},...(payload?{payload}:{})});assert.ok(result.statusCode<300,result.body);return result.statusCode===204?undefined:result.json();};
  const publish=async(repo:string)=>{const base='/repos/local/'+repo;await call('POST','/repos',{namespace:'local',name:repo,visibility:'private'});let record=await call('POST',base+'/releases',{version:'v1',title:'Synthetic delete acceptance',notes:'Synthetic only',sourceRef:'main'});record=await call('POST',base+'/releases/'+record.id+'/build',{expectedRevision:record.revision});for(let i=0;i<200&&['queued','building'].includes(record.status);i++){await delay(5);record=await call('GET',base+'/releases/'+record.id);}assert.equal(record.status,'ready');record=await call('POST',base+'/releases/'+record.id+'/publish',{expectedRevision:record.revision});const share=await call('POST',base+'/releases/'+record.id+'/shares',{assetId:record.assets.find((asset:any)=>asset.kind==='data').id,expiresAt:new Date(Date.now()+600000).toISOString()});return {base,record,share,sharesPath:base+'/releases/'+record.id+'/shares',deletePath:base+'/releases/'+record.id+'/shares/'+share.id};};
  const primary=await publish('synthetic-delete');return {directory,token,config,provider,call,publish,...primary,get app(){return app;},async restart(){await app.close();app=await createApp(config,provider);}};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
function connect(t:any,f:Fixture,options:{token?:()=>string;after?:(method:string,url:string,result:any)=>void}={}){
  const calls:Array<{method:string;url:string;operationId:string|null;state:string|undefined}>=[];
  t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init:RequestInit={})=>{const url=typeof input==='string'?input:input instanceof URL?input.href:input.url,method=init.method??'GET',headers=new Headers(init.headers);headers.set('authorization','Bearer '+(options.token?.()??f.token));const result=await f.app.inject({method:method as any,url,headers:Object.fromEntries(headers.entries()),...(typeof init.body==='string'?{payload:init.body}:{})});calls.push({method,url,operationId:headers.get('X-Operation-Id'),state:result.headers['x-operation-state'] as string|undefined});options.after?.(method,url,result);const responseHeaders=Object.fromEntries(Object.entries(result.headers).filter(([,value])=>value!==undefined).map(([name,value])=>[name,Array.isArray(value)?value.join(','):String(value)]));return new Response(result.statusCode===204?null:result.body,{status:result.statusCode,headers:responseHeaders});});return calls;
}
const verification=(f:Fixture)=>({readCurrent:()=>request<ReleaseShare[]>(f.sharesPath),isRemoved:(shares:ReleaseShare[])=>!!shares.find(share=>share.id===f.share.id)?.revokedAt});

test('DELETE response lost after actual share revocation reads current state and never sends a second DELETE',async t=>{
  const f=await fixture(t);let lost=false;const calls=connect(t,f,{after:method=>{if(method==='DELETE'&&!lost){lost=true;throw new TypeError('Synthetic response lost after the server completed');}}});
  const result=await removeAndVerify(f.deletePath,verification(f));assert.equal(result.state,'confirmed');if(result.state==='confirmed')assert.equal(result.via,'read');assert.equal(calls.filter(call=>call.method==='DELETE').length,1);assert.equal(calls[0]!.state,'succeeded');assert.equal(operationIssue.value,undefined);const id=calls[0]!.operationId!;
  await f.restart();const record=await f.call('GET','/operations/'+id);assert.equal(record.state,'succeeded');assert.equal(record.kind,'release.share.revoke');assert.deepEqual(record.anchors,{releaseId:f.record.id,resourceId:f.share.id});
  const raw=await readFile(path.join(f.directory,'operation-journal.json'),'utf8');assert.equal(raw.includes(f.share.downloadPath.split('/').at(-1)),false);assert.equal(raw.includes(f.token),false);
});

test('one browser intent accepts the same-operation succeeded DELETE receipt after a transport retry without reapplying revocation',async t=>{
  const f=await fixture(t),original=ReleaseService.prototype.revoke;let mutations=0,fetches=0,reads=0,backendRequests=0,operationId='';
  t.mock.method(ReleaseService.prototype,'revoke',async function(this:ReleaseService,...args:Parameters<ReleaseService['revoke']>){mutations++;return original.apply(this,args);});
  t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init:RequestInit={})=>{
    fetches++;assert.equal(init.method,'DELETE');const url=String(input),headers=new Headers(init.headers);headers.set('authorization','Bearer '+f.token);operationId=headers.get('X-Operation-Id')!;assert.ok(operationId);
    backendRequests++;const completed=await f.app.inject({method:'DELETE',url,headers:Object.fromEntries(headers.entries())});assert.equal(completed.statusCode,204);assert.equal(completed.headers['x-operation-state'],'succeeded');
    // The first response is consumed/lost below fetch; the transport resends the same request ID.
    backendRequests++;const receipt=await f.app.inject({method:'DELETE',url,headers:Object.fromEntries(headers.entries())});assert.equal(receipt.statusCode,409);assert.equal(receipt.json().error.code,'OPERATION_ALREADY_SUCCEEDED');assert.equal(receipt.headers['x-operation-state'],'succeeded');assert.equal(receipt.headers['x-operation-id'],operationId);
    operationIssue.value={id:operationId,code:'NETWORK_RESULT_UNKNOWN',message:'Synthetic matching prior transport notice'};
    return new Response(receipt.body,{status:receipt.statusCode,headers:{'X-Operation-Id':operationId,'X-Operation-State':String(receipt.headers['x-operation-state'])}});
  });
  const outcome=await removeAndVerify(f.deletePath,{readCurrent:async()=>{reads++;throw new TypeError('Synthetic list refresh unavailable');},isRemoved:()=>false,isCurrent:()=>true});
  assert.equal(outcome.state,'confirmed');if(outcome.state==='confirmed'){assert.equal(outcome.via,'response');assert.equal(outcome.operationId,operationId);}assert.equal(fetches,1);assert.equal(backendRequests,2);assert.equal(mutations,1);assert.equal(reads,0);assert.equal(operationIssue.value,undefined);
  assert.equal((await f.call('GET','/operations/'+operationId)).state,'succeeded');assert.ok((await f.call('GET',f.sharesPath)).find((share:any)=>share.id===f.share.id)?.revokedAt);
});

test('DELETE completion requires matching operation receipt and cannot relax POST or stale-context handling',async t=>{
  operationIssue.value=undefined;t.after(()=>{operationIssue.value=undefined;});let receipt:'missing-state'|'wrong-id'|'matched'='missing-state',reads=0;
  t.mock.method(globalThis,'fetch',async(_input:RequestInfo|URL,init:RequestInit={})=>{const outgoing=new Headers(init.headers).get('X-Operation-Id')!,headers:Record<string,string>={'X-Operation-Id':receipt==='wrong-id'?randomUUID():outgoing};if(receipt!=='missing-state')headers['X-Operation-State']='succeeded';return new Response(JSON.stringify({error:{code:'OPERATION_ALREADY_SUCCEEDED',message:'此操作已完成，请读取已记录的结果。'}}),{status:409,headers});});
  for(const variant of ['missing-state','wrong-id'] as const){receipt=variant;const outcome=await removeAndVerify('/repos/local/synthetic/access/'+randomUUID(),{readCurrent:async()=>{reads++;throw new TypeError('Synthetic read unavailable');},isRemoved:()=>true,isCurrent:()=>true});assert.equal(outcome.state,'unknown');if(outcome.state==='unknown'){assert.equal(isUnknownOperationError(outcome.error),true);assert.match(outcome.error.message,/缺少匹配的已确认状态/);}}
  assert.equal(reads,2);receipt='matched';const stale=await removeAndVerify('/repos/local/synthetic/access/'+randomUUID(),{readCurrent:async()=>{reads++;return [];},isRemoved:()=>true,isCurrent:()=>false});assert.equal(stale.state,'unknown');assert.equal(reads,2);
  await assert.rejects(()=>request('/repos/local/synthetic/branches',{method:'POST',body:JSON.stringify({name:'synthetic'})}),(error:unknown)=>error instanceof ApiError&&error.code==='OPERATION_ALREADY_SUCCEEDED'&&error.operationState==='succeeded'&&isUnknownOperationError(error));
});

test('a write-completed 409 stays unknown and reconciles from scoped redacted share state after restart',async t=>{
  const f=await fixture(t),original=GlobalAuditService.prototype.record;let faulted=false;t.mock.method(GlobalAuditService.prototype,'record',async function(this:GlobalAuditService,input:any){if(input.action==='release.share_revoked'&&!faulted){faulted=true;throw new ServerError(409,'SYNTHETIC_POST_WRITE_FAILURE','Synthetic failure after durable revocation');}return original.call(this,input);});const calls=connect(t,f);
  const result=await removeAndVerify(f.deletePath,verification(f));assert.equal(result.state,'confirmed');if(result.state==='confirmed')assert.equal(result.via,'read');const id=calls[0]!.operationId!;assert.equal(calls[0]!.state,'reconciliation-required');assert.equal((await f.call('GET','/operations/'+id)).state,'reconciliation-required');
  await f.restart();const reconciled=await f.call('POST','/operations/'+id+'/reconcile',{});assert.equal(reconciled.state,'succeeded');assert.equal(reconciled.reasonCode,'SHARE_REVOCATION_STATE_VERIFIED');assert.equal(calls.filter(call=>call.method==='DELETE').length,1);
});

test('a permission rejection is definitive and does not attempt unauthorized readback',async t=>{
  const f=await fixture(t),grant=await f.call('POST',f.base+'/access',{name:'Synthetic viewer',role:'viewer'}),calls=connect(t,f,{token:()=>grant.token});let reads=0;
  await assert.rejects(()=>removeAndVerify(f.deletePath,{readCurrent:async()=>{reads++;return [];},isRemoved:()=>true}),(error:unknown)=>error instanceof ApiError&&error.status===403&&!isUnknownOperationError(error));assert.equal(reads,0);assert.equal(calls.length,1);assert.equal((await f.call('GET',f.sharesPath)).find((share:any)=>share.id===f.share.id).revokedAt,undefined);
});

test('readback permission loss and transport failure remain unknown; explicit recheck performs only GET',async t=>{
  const f=await fixture(t),grant=await f.call('POST',f.base+'/access',{name:'Synthetic reader after context revocation',role:'viewer'});let readToken=f.token,lost=false;const calls=connect(t,f,{token:()=>readToken,after:method=>{if(method==='DELETE'&&!lost){lost=true;readToken=grant.token;throw new TypeError('Synthetic lost response');}}});
  const unknown=await removeAndVerify(f.deletePath,verification(f));assert.equal(unknown.state,'unknown');if(unknown.state!=='unknown')throw new Error('Expected unknown delete result');assert.ok(unknown.verificationError instanceof ApiError);assert.equal((unknown.verificationError as ApiError).status,403);assert.equal(calls.filter(call=>call.method==='DELETE').length,1);
  const unavailable=await verifyDeletion(unknown.error,{readCurrent:async()=>{throw new TypeError('Synthetic read transport failure');},isRemoved:()=>true});assert.equal(unavailable.state,'unknown');
  readToken=f.token;const checked=await verifyDeletion(unknown.error,verification(f));assert.equal(checked.state,'confirmed');assert.equal(calls.filter(call=>call.method==='DELETE').length,1);
});

test('a missing share and cross-release resource cannot be treated as successful deletion',async t=>{
  const f=await fixture(t),foreign=await f.publish('synthetic-foreign-delete'),calls=connect(t,f);let reads=0;const target=f.sharesPath+'/'+foreign.share.id;
  await assert.rejects(()=>removeAndVerify(target,{readCurrent:async()=>{reads++;return [];},isRemoved:()=>true}),(error:unknown)=>error instanceof ApiError&&error.status===404&&error.operationState==='failed');assert.equal(reads,0);const id=calls[0]!.operationId!,record=await f.call('GET','/operations/'+id);assert.equal(record.state,'failed');assert.equal(record.anchors.resourceId,foreign.share.id);assert.deepEqual(record.key,{namespace:'local',repo:'synthetic-delete'});assert.equal((await f.call('GET',foreign.sharesPath)).find((share:any)=>share.id===foreign.share.id).revokedAt,undefined);
  const unresolved=await reconcileOperation({...record,state:'reconciliation-required'}, {id:'owner',name:'Synthetic',kind:'owner',source:'local'}, {provider:f.provider,releaseShares:async()=>await f.call('GET',f.sharesPath)} as any);assert.equal(unresolved.state,'reconciliation-required');
});

test('workspace deletion and collaborator stale-CAS rejection bind their existing operations',async t=>{
  const f=await fixture(t),workspace=await f.call('POST',f.base+'/workspaces',{name:'Synthetic disposable workspace',branch:'main'}),deleted=await f.app.inject({method:'DELETE',url:'/api'+f.base+'/workspaces/'+workspace.id,headers:{authorization:'Bearer '+f.token,'x-operation-id':randomUUID()}});assert.equal(deleted.statusCode,204);assert.equal(deleted.headers['x-operation-state'],'succeeded');const operation=await f.call('GET','/operations/'+deleted.headers['x-operation-id']);assert.equal(operation.kind,'workspace.delete');assert.equal(operation.anchors.workspaceId,workspace.id);
  const before=await f.call('GET',f.base+'/settings'),grant=await f.call('POST',f.base+'/access',{name:'Synthetic CAS collaborator',role:'viewer'}),id=randomUUID(),rejected=await f.app.inject({method:'DELETE',url:'/api'+f.base+'/access/'+grant.collaborator.id+'?expectedCommit='+before.commitId,headers:{authorization:'Bearer '+f.token,'x-operation-id':id}});assert.equal(rejected.statusCode,409);assert.equal(rejected.headers['x-operation-state'],'failed');assert.equal((await f.call('GET','/operations/'+id)).state,'failed');
});

test('workspace and collaborator response loss are confirmed by their complete scoped lists without replay',async t=>{
  const f=await fixture(t),workspace=await f.call('POST',f.base+'/workspaces',{name:'Synthetic lost-response workspace',branch:'main'}),grant=await f.call('POST',f.base+'/access',{name:'Synthetic lost-response collaborator',role:'viewer'}),policy=await f.call('GET',f.base+'/access');
  const calls=connect(t,f,{after:method=>{if(method==='DELETE')throw new TypeError('Synthetic response lost after durable resource deletion');}});
  const workspaceOutcome=await removeAndVerify(f.base+'/workspaces/'+workspace.id,{readCurrent:()=>request<Array<{id:string}>>(f.base+'/workspaces'),isRemoved:items=>!items.some(item=>item.id===workspace.id),isCurrent:()=>true});
  assert.equal(workspaceOutcome.state,'confirmed');if(workspaceOutcome.state==='confirmed')assert.equal(workspaceOutcome.via,'read');
  const accessOutcome=await removeAndVerify(f.base+'/access/'+grant.collaborator.id+'?expectedCommit='+encodeURIComponent(policy.commitId),{readCurrent:()=>request<{collaborators:Array<{id:string}>}>(f.base+'/access'),isRemoved:current=>!current.collaborators.some(item=>item.id===grant.collaborator.id),isCurrent:()=>true});
  assert.equal(accessOutcome.state,'confirmed');if(accessOutcome.state==='confirmed')assert.equal(accessOutcome.via,'read');
  assert.equal(calls.filter(call=>call.method==='DELETE').length,2);assert.equal(calls.filter(call=>call.method==='GET').length,2);assert.equal(operationIssue.value,undefined);
  const deletes=calls.filter(call=>call.method==='DELETE'),record=await f.call('GET','/operations/'+deletes[1]!.operationId);assert.equal(record.kind,'access.revoke');assert.equal(record.state,'succeeded');assert.equal(record.anchors.resourceId,grant.collaborator.id);
});

test('late identity changes and untracked DELETE failures never become success or misleading journal links',async t=>{
  operationIssue.value=undefined;t.after(()=>{operationIssue.value=undefined;});let reads=0;const error=new ApiError('NETWORK_RESULT_UNKNOWN','Synthetic pending delete',0,undefined,randomUUID());operationIssue.value={id:error.operationId!,code:error.code,message:error.message};const stale=await verifyDeletion(error,{readCurrent:async()=>{reads++;return [];},isRemoved:()=>true,isCurrent:()=>false});assert.equal(stale.state,'unknown');assert.equal(reads,0);assert.equal(operationIssue.value,undefined);
  const other={id:randomUUID(),code:'NETWORK_RESULT_UNKNOWN',message:'A different pending operation'};operationIssue.value=other;const checked=await verifyDeletion(error,{readCurrent:async()=>[],isRemoved:()=>true,isCurrent:()=>true});assert.equal(checked.state,'confirmed');assert.equal(operationIssue.value?.id,other.id);operationIssue.value=undefined;
  t.mock.method(globalThis,'fetch',async()=>{throw new TypeError('Synthetic untracked checkpoint delete transport failure');});await assert.rejects(()=>request('/repos/local/synthetic/dataset/ui-state',{method:'DELETE'}),(cause:unknown)=>cause instanceof ApiError&&cause.code==='DELETE_RESULT_UNKNOWN'&&cause.operationId===undefined);assert.equal(operationIssue.value,undefined);
  assert.equal(tracksOperation('/repos/local/synthetic/releases/r/shares/s','DELETE'),true);assert.equal(tracksOperation('/v1/datasets/local%2Fsynthetic/releases/r/shares/s','DELETE'),true);assert.equal(tracksOperation('/repos/local/synthetic/dataset/ui-state','DELETE'),false);assert.equal(tracksOperation('/session','DELETE'),false);
});

test('resource anchors reject token-shaped values and unreadable state cannot prove revocation',async t=>{
  const root=path.resolve('.data/tests');await mkdir(root,{recursive:true});const directory=await mkdtemp(path.join(root,'r22-resource-anchor-'));t.after(async()=>{assert.ok(directory.startsWith(root+path.sep));await rm(directory,{recursive:true,force:true});});const journal=new OperationJournal(path.join(directory,'journal.json'));await journal.init();const id=randomUUID();await assert.rejects(()=>journal.run({id,kind:'synthetic-delete',actorId:'owner',actorName:'Synthetic',payload:{}},async context=>{await context.checkpoint({resourceId:'a'.repeat(43)});return {value:{},anchors:{}};}));assert.equal(journal.get(id).anchors.resourceId,undefined);
  const record:any={id:randomUUID(),kind:'release.share.revoke',state:'reconciliation-required',key:{namespace:'local',repo:'synthetic'},anchors:{releaseId:randomUUID(),resourceId:randomUUID()}},identity:any={id:'owner',name:'Synthetic',kind:'owner'};const result=await reconcileOperation(record,identity,{provider:{} as any,releaseShares:async()=>{throw new ServerError(403,'SYNTHETIC_READ_DENIED','Synthetic denied read');}} as any);assert.equal(result.state,'reconciliation-required');assert.equal(result.reasonCode,'SHARE_REVOCATION_READ_UNAVAILABLE');
});

test('an unreadable DELETE response and a late read cannot falsely confirm removal in another identity context',async t=>{
  operationIssue.value=undefined;t.after(()=>{operationIssue.value=undefined;});const id=randomUUID();let deletes=0;
  t.mock.method(globalThis,'fetch',async()=>{deletes++;return new Response('Synthetic malformed JSON',{status:200,headers:{'X-Operation-Id':id,'X-Operation-State':'succeeded'}});});
  const result=await removeAndVerify('/repos/local/synthetic/access/'+randomUUID(),{readCurrent:async()=>[{id:'still-present'}],isRemoved:items=>items.length===0,isCurrent:()=>true});
  assert.equal(result.state,'unknown');if(result.state!=='unknown')throw new Error('Expected unknown');assert.equal(result.error.code,'DELETE_RESPONSE_UNKNOWN');assert.equal(operationIssue.value?.id,id);assert.equal(deletes,1);
  let sameContext=true;const changed=await verifyDeletion(result.error,{readCurrent:async()=>{sameContext=false;return [];},isRemoved:()=>true,isCurrent:()=>sameContext});assert.equal(changed.state,'unknown');assert.equal(deletes,1);assert.equal(operationIssue.value,undefined);
});
