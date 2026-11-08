import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {createApp} from '../src/app.js';
import {DemoProvider} from '../src/demo.js';
import {loadConfig} from '../src/config.js';
import {DatasetService} from '../src/dataset.js';
import type {RequestIdentity} from '../../../packages/shared/src/index.js';
const owner:RequestIdentity={id:'owner',name:'Synthetic owner',kind:'owner',source:'local'},ownerToken='synthetic-project-management-owner';
async function fixture(t:{after:(callback:()=>Promise<void>)=>void},initialize=true){
 const root=path.resolve('.data/tests');await mkdir(root,{recursive:true});const directory=await mkdtemp(path.join(root,'project-management-')),config=loadConfig({DEMO_MODE:'true',DEMO_DATA_FILE:path.join(directory,'demo.json'),BFF_TOKEN:ownerToken}),provider=new DemoProvider(config.demoFile);await provider.init();const key={namespace:'local',repo:'management-fixture'};await provider.createRepo({namespace:key.namespace,name:key.repo,description:'Synthetic project',visibility:'private'});const datasets=new DatasetService(provider);if(initialize)await datasets.initialize(key,owner,{ref:'main',expectedCommit:(await provider.branches(key))[0]!.commitId,rows:[{id:'one',text:'Synthetic body',ground_truth:'Source truth'}],readme:'# Synthetic baseline\n'});
 let app=await createApp(config,provider);t.after(async()=>{await app.close();if(!path.resolve(directory).startsWith(root+path.sep))throw new Error('Unsafe fixture cleanup');await rm(directory,{recursive:true,force:true});});const base='/api/repos/'+key.namespace+'/'+key.repo,call=(method:any,url:string,payload?:unknown,token=ownerToken)=>app.inject({method,url,headers:{authorization:'Bearer '+token},...(payload!==undefined?{payload:payload as any}:{})});
 return {provider,datasets,key,base,call,head:async(ref='main')=>(await provider.branches(key)).find(branch=>branch.name===ref)!.commitId,restart:async()=>{await app.close();app=await createApp(config,provider);}};
}

test('display name and description are versioned metadata with stable repository identity and CAS',async t=>{
 const f=await fixture(t),settings=(await f.call('GET',f.base+'/settings')).json(),before=await f.head(),source=(await f.provider.raw(f.key,before,'data/samples.jsonl')).content;
 let response=await f.call('PATCH',f.base+'/settings',{displayName:'AI 安全研究样本',description:'Updated synthetic description',expectedCommit:settings.commitId});assert.equal(response.statusCode,200,response.body);const saved=response.json();assert.equal(saved.policy.displayName,'AI 安全研究样本');assert.notEqual(saved.commitId,before);
 assert.deepEqual((await f.provider.commit(f.key,saved.commitId)).files.map(file=>file.path),['.oxenweb/repository.json']);assert.deepEqual((await f.provider.raw(f.key,saved.commitId,'data/samples.jsonl')).content,source);
 const summary=(await f.call('GET',f.base)).json();assert.equal(summary.name,f.key.repo);assert.equal(summary.namespace,f.key.namespace);assert.equal(summary.displayName,'AI 安全研究样本');assert.equal(summary.description,'Updated synthetic description');assert.equal((await f.call('GET','/api/repos')).json().find((repo:any)=>repo.name===f.key.repo).displayName,'AI 安全研究样本');
 response=await f.call('PATCH',f.base+'/settings',{displayName:'Stale edit',expectedCommit:before});assert.equal(response.statusCode,409,response.body);assert.equal(await f.head(),saved.commitId);
});

test('removal requires admin, exact identity and latest branch/workspace state, then gates all repository operations',async t=>{
 const f=await fixture(t);let response=await f.call('POST',f.base+'/access',{name:'Synthetic viewer',role:'viewer'});assert.equal(response.statusCode,201,response.body);const viewer=response.json(),identity=f.key.namespace+'/'+f.key.repo;
 let preview=(await f.call('GET',f.base+'/lifecycle')).json();response=await f.call('POST',f.base+'/lifecycle/remove',{confirmation:identity,expectedRevision:preview.expectedRevision},viewer.token);assert.equal(response.statusCode,403,response.body);
 response=await f.call('POST',f.base+'/lifecycle/remove',{confirmation:f.key.repo,expectedRevision:preview.expectedRevision});assert.equal(response.statusCode,422,response.body);
 const workspace=await f.provider.createWorkspace(f.key,'Synthetic user work','main');await f.provider.writeWorkspace(f.key,workspace.id,'notes.txt',Buffer.from('Uncommitted synthetic note'));
 response=await f.call('POST',f.base+'/lifecycle/remove',{confirmation:identity,expectedRevision:preview.expectedRevision});assert.equal(response.statusCode,409,response.body);preview=(await f.call('GET',f.base+'/lifecycle')).json();
 const head=await f.head(),raw=(await f.provider.raw(f.key,head,'data/samples.jsonl')).content,commits=(await f.provider.commits(f.key,'main')).length;
 response=await f.call('POST',f.base+'/lifecycle/remove',{confirmation:identity,expectedRevision:preview.expectedRevision});assert.equal(response.statusCode,200,response.body);const removed=response.json();assert.equal(removed.status,'removed');assert.equal(removed.workspaceCount,1);
 for(const [method,tail,payload]of [['GET','',undefined],['GET','/raw?ref=main&path=data%2Fsamples.jsonl',undefined],['GET','/dataset/ui-state?ref=main&kind=workbench',undefined],['POST','/branches',{name:'forbidden',from:'main'}]] as const){response=await f.call(method,f.base+tail,payload);assert.equal(response.statusCode,410,response.body);}
 assert.equal((await f.call('GET','/api/repos')).json().some((repo:any)=>repo.name===f.key.repo),false);assert.equal((await f.call('GET','/api/repository-recycle-bin')).json().length,1);assert.deepEqual((await f.call('GET','/api/repository-recycle-bin',undefined,viewer.token)).json(),[]);
 assert.equal((await f.provider.repo(f.key)).name,f.key.repo);assert.equal(await f.head(),head);assert.deepEqual((await f.provider.raw(f.key,head,'data/samples.jsonl')).content,raw);assert.equal((await f.provider.commits(f.key,'main')).length,commits);assert.equal((await f.provider.workspace(f.key,workspace.id)).changes.length,1);
 await f.restart();response=await f.call('GET',f.base);assert.equal(response.statusCode,410,response.body);
 response=await f.call('POST',f.base+'/lifecycle/restore',{confirmation:identity,removalId:removed.removalId,revision:removed.revision},viewer.token);assert.equal(response.statusCode,403,response.body);
 response=await f.call('POST',f.base+'/lifecycle/restore',{confirmation:identity,removalId:removed.removalId,revision:removed.revision+1});assert.equal(response.statusCode,409,response.body);
 response=await f.call('POST',f.base+'/lifecycle/restore',{confirmation:identity,removalId:removed.removalId,revision:removed.revision});assert.equal(response.statusCode,200,response.body);assert.equal((await f.call('GET',f.base)).statusCode,200);assert.equal(await f.head(),head);assert.deepEqual((await f.call('GET','/api/repository-recycle-bin')).json(),[]);
 response=await f.call('POST',f.base+'/lifecycle/restore',{confirmation:identity,removalId:removed.removalId,revision:removed.revision});assert.equal(response.statusCode,409,response.body);
});

test('an unconfigured new project can save README first with one real branch commit',async t=>{
 const f=await fixture(t,false),before=await f.head(),initial=(await f.call('GET',f.base+'/readme?ref=main')).json();assert.equal(initial.canEdit,true);
 let response=await f.call('PUT',f.base+'/readme',{ref:'main',expectedCommit:before,content:'# Purpose before import\n',message:'Document synthetic empty project'});assert.equal(response.statusCode,200,response.body);const saved=response.json();assert.notEqual(saved.commitId,before);assert.equal(saved.content,'# Purpose before import\n');assert.deepEqual((await f.provider.commit(f.key,saved.commitId)).files.map(file=>file.path),['README.md']);
 response=await f.call('GET',f.base+'/dataset/fields?ref=main');assert.equal(response.statusCode,409,response.body);assert.equal(response.json().error.code,'DATASET_NOT_CONFIGURED');
 response=await f.call('PUT',f.base+'/readme',{ref:'main',expectedCommit:before,content:'stale',message:'stale edit'});assert.equal(response.statusCode,409,response.body);assert.equal(await f.head(),saved.commitId);
});

test('README saves are branch-local, preserve samples, and history/diff never read unrelated large commit diffs',async t=>{
 const f=await fixture(t),before=await f.head(),raw=(await f.provider.raw(f.key,before,'data/samples.jsonl')).content;await f.provider.createBranch(f.key,'docs',before);
 let response=await f.call('PUT',f.base+'/readme',{ref:'docs',expectedCommit:before,content:'# Changed synthetic documentation\n\nClear instructions.\n',message:'Improve dataset guide'});assert.equal(response.statusCode,200,response.body);const saved=response.json();assert.equal(saved.ref,'docs');assert.equal((await f.call('GET',f.base+'/readme?ref=main')).json().content,'# Synthetic baseline\n');assert.deepEqual((await f.provider.raw(f.key,saved.commitId,'data/samples.jsonl')).content,raw);
 const commit=f.provider.commit.bind(f.provider);f.provider.commit=async()=>{throw new Error('Synthetic unrelated full commit diff exceeds 25 MiB');};
 response=await f.call('GET',f.base+'/readme/history?ref=docs&page=1');assert.equal(response.statusCode,200,response.body);assert.equal(response.json().items[0].id,saved.commitId);
 response=await f.call('GET',f.base+'/readme/diff?ref=docs&commit='+saved.commitId);assert.equal(response.statusCode,200,response.body);assert.equal(response.json().before,'# Synthetic baseline\n');assert.equal(response.json().after,saved.content);f.provider.commit=commit;
 response=await f.call('GET',f.base+'/readme?ref='+saved.commitId);assert.equal(response.json().canEdit,false);assert.deepEqual(await f.provider.workspaces(f.key),[]);
});

test('README blocks own sample drafts, persists independent inputs and enforces data.edit',async t=>{
 const f=await fixture(t),snapshot=await f.datasets.read(f.key,'main');let response=await f.call('POST',f.base+'/access',{name:'Synthetic reader',role:'viewer'});assert.equal(response.statusCode,201,response.body);const viewer=response.json(),head=await f.head();
 response=await f.call('PUT',f.base+'/readme',{ref:'main',expectedCommit:head,content:'not allowed',message:'forbidden'},viewer.token);assert.equal(response.statusCode,403,response.body);
 response=await f.call('PUT',f.base+'/dataset/draft',{ref:'main',expectedCommit:head,draftRevision:0,operations:[{op:'update',rowId:snapshot.rowIds[0],record:{...snapshot.rows[0],text:'Pending synthetic sample'}}]});assert.equal(response.statusCode,200,response.body);const draft=response.json().draft;
 response=await f.call('PUT',f.base+'/dataset/ui-state',{ref:'main',kind:'readme',revision:0,baseCommit:head,payload:{version:1,baseContent:'# Synthetic baseline\n',content:'Unfinished README input',message:'later'}});assert.equal(response.statusCode,200,response.body);
 response=await f.call('PUT',f.base+'/readme',{ref:'main',expectedCommit:head,content:'Unfinished README input',message:'Finish docs'});assert.equal(response.statusCode,409,response.body);assert.equal(response.json().error.code,'README_SAMPLE_DRAFT_IN_USE');assert.equal(await f.head(),head);
 response=await f.call('POST',f.base+'/dataset/draft/commit',{ref:'main',expectedCommit:head,draftRevision:draft.draftRevision,expectedDraftId:draft.id,message:'Commit pending synthetic sample'});assert.equal(response.statusCode,200,response.body);const newHead=await f.head();
 response=await f.call('GET',f.base+'/dataset/ui-state?ref=main&kind=readme');assert.equal(response.statusCode,200,response.body);assert.equal(response.json().state.payload.content,'Unfinished README input');
 response=await f.call('PUT',f.base+'/readme',{ref:'main',expectedCommit:newHead,content:'Unfinished README input',message:'Finish docs'});assert.equal(response.statusCode,200,response.body);assert.equal((await f.datasets.read(f.key,'main')).rows[0]!.text,'Pending synthetic sample');
});
