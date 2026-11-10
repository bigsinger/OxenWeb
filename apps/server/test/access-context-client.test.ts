import test from 'node:test';
import assert from 'node:assert/strict';
import {reactive,nextTick} from 'vue';
import {QueryClient} from '@tanstack/vue-query';
import {actorContext,credentialContext,createContextLoadGate,repositoryQueryKey,rotateForCurrentContext,routedAccessContext,watchCredentialContext,type AccessIdentity} from '../../web/src/access-context.js';

const a:AccessIdentity={id:'synthetic-same-person',kind:'collaborator',credentialId:'synthetic-project-a'},b:AccessIdentity={...a,credentialId:'synthetic-project-b'};
const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};};

test('same person with another project credential discards ordinary routed pages while access pages retain only their component identity',()=>{
  assert.equal(actorContext(a),actorContext(b),'Private actor ownership is stable across credentials');assert.notEqual(credentialContext(a),credentialContext(b));
  for(const route of [undefined,'activity','operations'])assert.notEqual(routedAccessContext(a,route,'local','project-a'),routedAccessContext(b,route,'local','project-a'),'Old project, audit and operations page instances must be discarded');
  for(const route of ['access','my-tokens'])assert.equal(routedAccessContext(a,route,'',''),routedAccessContext(b,route,'',''),'Access page controls its own one-time handoff instead of remounting');
  assert.notEqual(routedAccessContext(a,'access','',''),routedAccessContext({...a,kind:'owner'},'access','',''),'An actor kind change cannot retain the privileged page');
  assert.notEqual(routedAccessContext(a,undefined,'local','project-a'),routedAccessContext(a,undefined,'local','project-b'));
});

test('credential refresh clears header state synchronously and refuses both previous-scope and older same-scope replies',async()=>{
  const state=reactive({identity:{...a},projects:['Synthetic private project A'],canReadAudit:true}),gate=createContextLoadGate(()=>state.identity),old=deferred<string[]>();
  const stop=watchCredentialContext(()=>state.identity,()=>{gate.invalidate();state.projects=[];state.canReadAudit=false;});
  try{
    state.projects=['Synthetic private project A'];state.canReadAudit=true;const first=gate.begin(),pending=old.promise.then(value=>{if(gate.accepts(first)){state.projects=value;state.canReadAudit=true;}});
    state.identity={...b};assert.deepEqual(state.projects,[],'Clear before Vue render or another request completes');assert.equal(state.canReadAudit,false);
    const second=gate.begin();assert.equal(gate.accepts(second),true);state.projects=['Synthetic allowed project B'];old.resolve(['Stale privileged project A']);await pending;assert.deepEqual(state.projects,['Synthetic allowed project B']);assert.equal(state.canReadAudit,false);
    const olderRefresh=gate.begin(),newerRefresh=gate.begin();assert.equal(gate.accepts(olderRefresh),false,'A slow refresh cannot overwrite a more recent response in the same scope');assert.equal(gate.accepts(newerRefresh),true);
    state.identity={...b,kind:'owner'};assert.deepEqual(state.projects,[]);assert.equal(gate.accepts(newerRefresh),false);
  }finally{stop();}
});

test('repository query data and a cancelled late fetch cannot cross same-actor credential scopes',async()=>{
  const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}}),state=reactive({identity:{...a}}),late=deferred<string[]>();
  const stop=watchCredentialContext(()=>state.identity,()=>{void cache.cancelQueries();cache.removeQueries();});
  try{
    cache.setQueryData(repositoryQueryKey(a),['Synthetic A only']);assert.equal(cache.getQueryData(repositoryQueryKey(b)),undefined,'A scope cannot seed B cache');
    const request=cache.fetchQuery({queryKey:repositoryQueryKey(a),queryFn:()=>late.promise}).then(()=>{},()=>{});
    state.identity={...b};assert.equal(cache.getQueryData(repositoryQueryKey(a)),undefined);assert.equal(cache.getQueryData(repositoryQueryKey(b)),undefined);
    cache.setQueryData(repositoryQueryKey(b),['Synthetic B allowed']);late.resolve(['Late A private result']);await request;await nextTick();
    assert.equal(cache.getQueryData(repositoryQueryKey(a)),undefined);assert.deepEqual(cache.getQueryData(repositoryQueryKey(b)),['Synthetic B allowed']);
  }finally{stop();cache.clear();}
});

test('self rotation clears old displayed token then shows the new value once only after the returned credential context is verified',async()=>{
  const state=reactive({identity:{...a},issued:'Synthetic previously visible token',rows:['Old management result']}),resets:string[]=[];
  const stop=watchCredentialContext(()=>state.identity,()=>{state.issued='';state.rows=[];resets.push(credentialContext(state.identity));});
  try{
    state.issued='Synthetic previous token';const pageKey=routedAccessContext(state.identity,'my-tokens','','');
    const value=await rotateForCurrentContext({current:()=>state.identity,credentialId:a.credentialId!,rotate:async()=>({token:'Synthetic rotated once-only token',credential:{id:'synthetic-rotated-a',actorId:a.id}}),login:async()=>{state.identity={...a,credentialId:'synthetic-rotated-a'};assert.equal(state.issued,'','Old token must clear within the context transition');}});
    assert.equal(state.issued,'');assert.deepEqual(state.rows,[]);assert.equal(value,'Synthetic rotated once-only token');state.issued=value!;
    assert.equal(routedAccessContext(state.identity,'my-tokens','',''),pageKey,'No access page remount destroys the one-time result');assert.equal(resets.length,2);
    state.identity={...b};assert.equal(state.issued,'','An external same-actor scope switch immediately hides the newly displayed token');
  }finally{stop();}
});

test('a rotation reply from an earlier credential cannot log in, show its token or accept an unverified new context',async()=>{
  const state=reactive({identity:{...a}}),late=deferred<{token:string;credential:{id:string;actorId:string}}>();let logins=0;
  const pending=rotateForCurrentContext({current:()=>state.identity,credentialId:a.credentialId!,rotate:()=>late.promise,login:async()=>{logins++;}});state.identity={...b};late.resolve({token:'Synthetic stale rotation value',credential:{id:'synthetic-old-result',actorId:a.id}});assert.equal(await pending,undefined);assert.equal(logins,0);
  state.identity={...a};assert.equal(await rotateForCurrentContext({current:()=>state.identity,credentialId:a.credentialId!,rotate:async()=>({token:'Synthetic unverified result',credential:{id:'synthetic-new-result',actorId:a.id}}),login:async()=>{logins++;}}),undefined,'No returned token until status confirms the new credential');
  assert.equal(await rotateForCurrentContext({current:()=>state.identity,credentialId:a.credentialId!,rotate:async()=>({token:'Synthetic wrong actor',credential:{id:'synthetic-new-result',actorId:'synthetic-other-person'}}),login:async()=>{logins++;}}),undefined);assert.equal(logins,1);
});

test('rotating another issued credential preserves the current session and only reveals the result to its unchanged issuer context',async()=>{
  let logins=0;const value=await rotateForCurrentContext({current:()=>a,credentialId:'synthetic-other-credential',rotate:async()=>({token:'Synthetic issued replacement',credential:{id:'synthetic-other-replacement',actorId:'synthetic-other-person'}}),login:async()=>{logins++;}});assert.equal(value,'Synthetic issued replacement');assert.equal(logins,0);
});
