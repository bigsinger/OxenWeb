import test from 'node:test';
import assert from 'node:assert/strict';
import {ref} from 'vue';
import type {DatasetRelease} from '../../../packages/shared/src/releases.js';
import {createReleaseCandidateSaver,createReleaseReader,createReleaseRequestScope,releaseListEmptyState,retainReleaseResult} from '../../web/src/release-requests.js';
import {canAcceptReleaseHint} from '../../web/src/release-form-hints.js';

function deferred<T>(){let resolve!:(value:T)=>void,reject!:(cause:Error)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const record=(patch:Partial<DatasetRelease>={})=>({id:'candidate',kind:'release',status:'draft',revision:1,version:'v0.1.0',assets:[],...patch}) as DatasetRelease;

test('background reads retain the last confirmed result and never clear an independent action error',async()=>{
  const initial=record(),items=ref([initial]),actionError=ref('发布被409拒绝'),first=deferred<DatasetRelease[]>();
  let request=()=>first.promise;
  const reader=createReleaseReader({context:()=>'/repo',request:()=>request(),accept:value=>{items.value=value;}});
  const pending=reader.read();assert.equal(reader.loading.value,true);first.reject(new Error('列表暂时不可用'));await pending;
  assert.equal(items.value[0]!.id,initial.id);assert.equal(reader.error.value,'列表暂时不可用');assert.equal(actionError.value,'发布被409拒绝');
  request=async()=>[record({revision:2})];await reader.read();await reader.read();
  assert.equal(reader.error.value,'');assert.equal(items.value[0]!.revision,2);assert.equal(actionError.value,'发布被409拒绝');
});

test('late share results cannot overwrite another project, identity, credential or selected release',async()=>{
  for(const changed of ['project-b','identity-b','credential-b','release-b']){
    let context='project-a:identity-a:credential-a:release-a';const first=deferred<string[]>(),second=deferred<string[]>(),seen:string[][]=[];
    let request=()=>first.promise;const reader=createReleaseReader({context:()=>context,request:()=>request(),accept:value=>seen.push(value)});
    const old=reader.read();context=changed;reader.reset();request=()=>second.promise;const fresh=reader.read();
    second.resolve(['current']);await fresh;first.resolve(['private-old-result']);await old;
    assert.deepEqual(seen,[['current']],changed);assert.deepEqual(reader.value.value,['current']);assert.equal(reader.error.value,'');
  }
});

test('a late read rejection and an explicitly invalidated write ticket stay in their original scope',async()=>{
  let context='same-project:credential-a',accepted=0;const pending=deferred<string>();
  const reader=createReleaseReader({context:()=>context,request:()=>pending.promise,accept:()=>accepted++}),scope=createReleaseRequestScope(()=>context);
  const current=scope.capture(),read=reader.read();context='same-project:credential-b';reader.reset();scope.invalidate();pending.reject(new Error('old identity error'));await read;
  assert.equal(current(),false);assert.equal(accepted,0);assert.equal(reader.error.value,'');assert.equal(reader.loading.value,false);
});

test('a successful candidate remains visible through a failing GET and read-only retry never repeats POST',async()=>{
  let items:DatasetRelease[]=[],writes=0,reads=0;const saved=record();
  const flow=createReleaseCandidateSaver();const result=await flow.save({write:async()=>{writes++;return saved;},accept:value=>{items=retainReleaseResult(items,value);},current:()=>true});
  assert.equal(result.state,'saved');assert.deepEqual(items,[saved]);
  const reader=createReleaseReader({context:()=>'/repo',request:async()=>{reads++;if(reads===1)throw new Error('readback failed');return [saved];},accept:value=>{items=value;}});
  const failed=await reader.read();assert.equal(failed.ok,false);assert.equal(items[0]!.id,saved.id);
  assert.equal((await reader.read()).ok,true);assert.equal(writes,1);assert.equal(reads,2);assert.equal(items[0]!.id,saved.id);
});

test('a list GET started before the confirmed POST cannot remove its returned candidate',async()=>{
  let items:DatasetRelease[]=[];const old=deferred<DatasetRelease[]>();
  const reader=createReleaseReader({context:()=>'/repo',request:()=>old.promise,accept:value=>{items=value;}});
  const pending=reader.read(),saved=record({id:'newly-confirmed'});
  reader.invalidate();items=retainReleaseResult(items,saved);old.resolve([]);await pending;
  assert.equal(items[0]!.id,saved.id);assert.equal(reader.loading.value,false);
});

test('save and validate retain the returned ID before build, serialize double clicks and use its exact revision',async()=>{
  const write=deferred<DatasetRelease>(),build=deferred<DatasetRelease>(),flow=createReleaseCandidateSaver(),events:string[]=[];
  const options={write:()=>{events.push('save');return write.promise;},build:(saved:DatasetRelease)=>{events.push('build:'+saved.id+':'+saved.revision);return build.promise;},accept:(value:DatasetRelease)=>events.push('retain:'+value.status),current:()=>true};
  const first=flow.save(options);assert.equal((await flow.save(options)).state,'busy');assert.deepEqual(events,['save']);
  write.resolve(record({id:'confirmed-id',revision:7}));await Promise.resolve();await Promise.resolve();
  assert.deepEqual(events,['save','retain:draft','build:confirmed-id:7']);
  build.resolve(record({id:'confirmed-id',revision:8,status:'queued'}));const result=await first;
  assert.equal(result.state,'queued');assert.deepEqual(events,['save','retain:draft','build:confirmed-id:7','retain:queued']);
});

test('failed validation preserves the saved candidate, and retry builds that candidate without recreating it',async()=>{
  let saves=0,builds=0;const saved=record({id:'already-saved',revision:4});let retained:DatasetRelease|undefined;
  const flow=createReleaseCandidateSaver();const result=await flow.save({write:async()=>{saves++;return saved;},build:async()=>{builds++;throw new Error('validation failed');},accept:value=>{retained=value;},current:()=>true});
  assert.equal(result.state,'build-failed');assert.equal(retained!.id,saved.id);assert.equal(saves,1);
  const retry=async(item:DatasetRelease)=>{builds++;assert.equal(item.id,saved.id);assert.equal(item.revision,4);return {...item,status:'queued' as const};};
  retained=await retry(retained!);assert.equal(saves,1);assert.equal(builds,2);assert.equal(retained.status,'queued');
});

test('a save completing after a scope change does not expose its record or enqueue a build',async()=>{
  const pending=deferred<DatasetRelease>();let current=true,retains=0,builds=0;
  const result=createReleaseCandidateSaver().save({write:()=>pending.promise,build:async item=>{builds++;return item;},accept:()=>{retains++;},current:()=>current});
  current=false;pending.resolve(record());assert.equal((await result).state,'stale');assert.equal(retains,0);assert.equal(builds,0);
});

test('a pending project A save does not silently block project B, while returning to A keeps same-scope deduplication',async()=>{
  const first=deferred<DatasetRelease>(),second=deferred<DatasetRelease>(),flow=createReleaseCandidateSaver(),accepted:string[]=[],writes:string[]=[];
  let context='actor-a:project-a';
  const saveA=()=>flow.save({context:'actor-a:project-a',current:()=>context==='actor-a:project-a',write:()=>{writes.push('A');return first.promise;},accept:item=>accepted.push(item.id)});
  const pendingA=saveA();context='actor-a:project-b';
  const pendingB=flow.save({context:'actor-a:project-b',current:()=>context==='actor-a:project-b',write:()=>{writes.push('B');return second.promise;},accept:item=>accepted.push(item.id)});
  assert.deepEqual(writes,['A','B']);
  second.resolve(record({id:'project-b-saved'}));assert.equal((await pendingB).state,'saved');assert.deepEqual(accepted,['project-b-saved']);
  context='actor-a:project-a';assert.equal((await saveA()).state,'busy');assert.deepEqual(writes,['A','B'],'returning to a still-pending scope must not send another POST');
  context='actor-a:project-b';first.resolve(record({id:'project-a-saved'}));assert.equal((await pendingA).state,'stale');assert.deepEqual(accepted,['project-b-saved']);
});

test('confirmed publication replaces only the old publication and keeps draft candidates',()=>{
  const candidate=record(),published=record({id:'old-published',status:'published'}),next=record({id:'new-published',status:'published'});
  assert.deepEqual(retainReleaseResult([published,candidate],next).map(item=>item.id),['new-published','candidate']);
  const ready=record({id:'same-snapshot',kind:'snapshot',revision:4,status:'ready'});
  assert.deepEqual(retainReleaseResult([ready],{...ready,revision:2,status:'queued'}),[ready],'an older POST readback must not downgrade a later ready result');
});

test('filtered empty results clear conditions while true first-time empty permits creation',()=>{
  assert.deepEqual(releaseListEmptyState(2,true,'releases'),{title:'没有匹配的版本',clear:true,create:false});
  assert.deepEqual(releaseListEmptyState(0,false,'releases'),{title:'尚未发布版本',clear:false,create:true});
  assert.deepEqual(releaseListEmptyState(0,false,'snapshots'),{title:'尚未创建工作快照',clear:false,create:false});
});

test('Tab hints ignore IME composition and modified keys while keeping plain Tab available',()=>{
  const event={key:'Tab',isComposing:false,shiftKey:false,altKey:false,ctrlKey:false,metaKey:false};
  assert.equal(canAcceptReleaseHint(event),true);assert.equal(canAcceptReleaseHint({...event,isComposing:true}),false);
  for(const key of ['shiftKey','altKey','ctrlKey','metaKey'])assert.equal(canAcceptReleaseHint({...event,[key]:true}),false);
  assert.equal(canAcceptReleaseHint({...event,key:'Enter'}),false);
});
