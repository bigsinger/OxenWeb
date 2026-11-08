import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import {randomUUID} from 'node:crypto';
import {DemoProvider} from '../src/demo.js';
import {createApp} from '../src/app.js';
import {loadConfig,projectRoot} from '../src/config.js';
import {registerImportRoutes} from '../src/import-routes.js';
import {ApiError} from '../src/errors.js';
import type {AnnotationTaskView} from '../../../packages/shared/src/workflow-types.js';
const ownerToken='synthetic-jsonl-import-guard-owner';
function upload(fields:Record<string,string>,content='{"id":"one","meta":{"items":[true,null,2]}}\n'){
  const boundary='guard-'+randomUUID(),parts=Object.entries(fields).map(([key,value])=>`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`).join('');
  return {headers:{authorization:`Bearer ${ownerToken}`,'content-type':`multipart/form-data; boundary=${boundary}`},payload:parts+`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="samples.jsonl"\r\nContent-Type: application/x-ndjson\r\n\r\n${content}\r\n--${boundary}--\r\n`};
}
async function fixture(t:{after:(work:()=>Promise<void>)=>void},standalone=false){
  const root=path.resolve(projectRoot,'.data/tests');await mkdir(root,{recursive:true});const directory=await mkdtemp(path.join(root,'jsonl-guard-'));t.after(async()=>{const target=path.resolve(directory);if(!target.startsWith(root+path.sep))throw new Error('unsafe cleanup');await rm(target,{recursive:true,force:true});});
  const config=loadConfig({DEMO_MODE:'true',DEMO_DATA_FILE:path.join(directory,'state.json'),BFF_TOKEN:ownerToken}),provider=new DemoProvider(config.demoFile);await provider.init();const key={namespace:'oxen',repo:'legacy-import-target'};await provider.createRepo({...key,name:key.repo,description:'Synthetic legacy import guard'});
  const app=standalone?Fastify():await createApp(config,provider);t.after(()=>app.close());
  return {app,provider,key,base:`/api/repos/${key.namespace}/${key.repo}`,async head(){return (await provider.branches(key)).find(item=>item.name==='main')!.commitId;},async seed(files:Record<string,string>){const ws=await provider.createWorkspace(key,'Synthetic legacy data','main');for(const [filename,content]of Object.entries(files))await provider.writeWorkspace(key,ws.id,filename,Buffer.from(content));await provider.commitWorkspace(key,ws.id,'Synthetic old data');await provider.deleteWorkspace(key,ws.id);}};
}
test('legacy first import remains usable and preserves original nested JSONL bytes',async t=>{
  const {app,provider}=await fixture(t),name='new-jsonl-'+randomUUID().slice(0,8),content='{"id":"one","text":"A😀BC","nested":{"boolean":true,"nothing":null,"array":[1,{"value":"synthetic"}]}}\n';
  const response=await app.inject({method:'POST',url:'/api/import/jsonl',...upload({namespace:'oxen',repo:name,createRepository:'true',path:'samples.jsonl'},content)});assert.equal(response.statusCode,200,response.body);assert.equal(response.json().rowCount,1);
  const raw=await provider.raw({namespace:'oxen',repo:name},response.json().commitId,'samples.jsonl');assert.equal(raw.content.toString(),content);
});
test('managed markers, protected prefixes and existing tables reject before any workspace write',async t=>{
  const {app,provider,key,head,seed}=await fixture(t);await seed({'old.jsonl':'{"id":"old","truth":"preserved"}\n'});let baseline=await head();
  const count=(await provider.workspaces(key)).length;
  for(const [filename,expected]of [['old.jsonl',409],['source/new.jsonl',403],['packages/new.jsonl',403],['.oxenweb/new.jsonl',403],['SOURCE/new.jsonl',403]] as const){const response=await app.inject({method:'POST',url:'/api/import/jsonl',...upload({namespace:key.namespace,repo:key.repo,expectedCommit:baseline,path:filename})});assert.equal(response.statusCode,expected,response.body);assert.equal(await head(),baseline);assert.equal((await provider.workspaces(key)).length,count);}
  await seed({'bundle-manifest.json':'{"canonical_data":"old.jsonl"}'});baseline=await head();const managed=await app.inject({method:'POST',url:'/api/import/jsonl',...upload({namespace:key.namespace,repo:key.repo,expectedCommit:baseline,path:'new.jsonl'})});assert.equal(managed.statusCode,409,managed.body);assert.equal(managed.json().error.code,'IMPORT_DATASET_WORKBENCH_REQUIRED');assert.equal(await head(),baseline);
});
test('a protected destination cannot create a repository or branch as a side effect',async t=>{
  const {app,provider}=await fixture(t),name='must-not-create-'+randomUUID().slice(0,8);
  const response=await app.inject({method:'POST',url:'/api/import/jsonl',...upload({namespace:'oxen',repo:name,createRepository:'true',branch:'new-branch',path:'.oxenweb/dataset/new.jsonl'})});assert.equal(response.statusCode,403,response.body);assert.ok(!(await provider.repos('oxen')).some(repo=>repo.name===name));
});
test('authorization is rechecked before commit and staged data never becomes a branch commit after revocation',async t=>{
  const {app,provider,key,head}=await fixture(t,true);await app.register(multipart);app.setErrorHandler((error,request,reply)=>{const known=error as ApiError;reply.code(known.status??500).send({error:{code:known.code??'ERROR',message:known.message}});});
  let checks=0;registerImportRoutes(app,provider,async()=>{if(++checks>=3)throw new ApiError(403,'CAPABILITY_REVOKED','Synthetic capability revoked');});const baseline=await head();
  const response=await app.inject({method:'POST',url:'/api/import/jsonl',...upload({namespace:key.namespace,repo:key.repo,expectedCommit:baseline,path:'new.jsonl'})});assert.equal(response.statusCode,403,response.body);assert.equal(checks,3);assert.equal(await head(),baseline);assert.equal((await provider.workspaces(key)).length,1);
});
test('task authorization hook runs before workspace creation and cannot be bypassed by legacy import',async t=>{
  const {app,provider,key,head}=await fixture(t,true);await app.register(multipart);app.setErrorHandler((error,request,reply)=>{const known=error as ApiError;reply.code(known.status??500).send({error:{code:known.code??'ERROR',message:known.message}});});
  let scope:any;registerImportRoutes(app,provider,async()=>{}, {beforeWrite:async(...args)=>{scope=args;throw new ApiError(403,'TASK_SCOPE_DENIED','Synthetic task scope restriction');}});const baseline=await head();
  const response=await app.inject({method:'POST',url:'/api/import/jsonl',...upload({namespace:key.namespace,repo:key.repo,expectedCommit:baseline,path:'new.jsonl'})});assert.equal(response.statusCode,403,response.body);assert.equal(scope[4],'edit-content');assert.equal(scope[5].operations[0].op,'append');assert.equal((await provider.workspaces(key)).length,0);assert.equal(await head(),baseline);
});
test('reviewers cannot use JSONL import as a body-edit capability and active editors cannot escape assigned rows',async t=>{
  const {app,provider,key,base,head,seed}=await fixture(t);await seed({'old.jsonl':'{"id":"one","text":"synthetic"}\n{"id":"two","text":"synthetic"}\n'});
  const grant=async(name:string,role:string)=>{const result=await app.inject({method:'POST',url:base+'/access',headers:{authorization:`Bearer ${ownerToken}`},payload:{name,role}});assert.equal(result.statusCode,201,result.body);return result.json();};
  const reviewer=await grant('Synthetic reviewer','reviewer'),editor=await grant('Synthetic editor','editor'),baseline=await head();
  const reviewerUpload=upload({namespace:key.namespace,repo:key.repo,expectedCommit:baseline,path:'reviewer-import.jsonl'});reviewerUpload.headers.authorization=`Bearer ${reviewer.token}`;const denied=await app.inject({method:'POST',url:'/api/import/jsonl',...reviewerUpload});assert.equal(denied.statusCode,403,denied.body);
  const created=await app.inject({method:'POST',url:base+'/tasks',headers:{authorization:`Bearer ${ownerToken}`},payload:{title:'Synthetic old-project task',ref:'main',expectedCommit:baseline,assigneeIds:[editor.collaborator.id],reviewerId:reviewer.collaborator.id,mode:'review',branchPrefix:'legacy/task'}});assert.equal(created.statusCode,201,created.body);const task=created.json()[0] as AnnotationTaskView,branch=task.participants[0]!.branch;
  const editorUpload=upload({namespace:key.namespace,repo:key.repo,branch,expectedCommit:baseline,path:'task-escape.jsonl'});editorUpload.headers.authorization=`Bearer ${editor.token}`;const escaped=await app.inject({method:'POST',url:'/api/import/jsonl',...editorUpload});assert.equal(escaped.statusCode,403,escaped.body);assert.equal((await provider.branches(key)).find(item=>item.name===branch)!.commitId,baseline);
});
test('generic new and existing workspaces cannot bypass a controlled editor task',async t=>{
  const {app,provider,key,base,head,seed}=await fixture(t);await seed({'old.jsonl':'{"id":"one","text":"synthetic"}\n{"id":"two","text":"synthetic"}\n'});
  const grant=async(name:string,role:string)=>{const result=await app.inject({method:'POST',url:base+'/access',headers:{authorization:`Bearer ${ownerToken}`},payload:{name,role}});assert.equal(result.statusCode,201,result.body);return result.json();};
  const editor=await grant('Synthetic task editor','editor'),reviewer=await grant('Synthetic reviewer','reviewer'),baseline=await head();
  const created=await app.inject({method:'POST',url:base+'/tasks',headers:{authorization:`Bearer ${ownerToken}`},payload:{title:'Synthetic workspace task',ref:'main',expectedCommit:baseline,assigneeIds:[editor.collaborator.id],reviewerId:reviewer.collaborator.id,mode:'review',branchPrefix:'legacy/workspace'}});assert.equal(created.statusCode,201,created.body);const task=created.json()[0] as AnnotationTaskView;
  const deniedCreate=await app.inject({method:'POST',url:base+'/workspaces',headers:{authorization:`Bearer ${editor.token}`},payload:{name:'Task scope bypass',branch:task.participants[0]!.branch}});assert.equal(deniedCreate.statusCode,403,deniedCreate.body);
  const queryCreate=await app.inject({method:'POST',url:base+'/workspaces?context=advanced',headers:{authorization:`Bearer ${editor.token}`},payload:{name:'Query suffix bypass',branch:task.participants[0]!.branch}});assert.equal(queryCreate.statusCode,403,queryCreate.body);
  const existing=await provider.createWorkspace(key,'Synthetic owner workspace','main');
  const deniedWrite=await app.inject({method:'PUT',url:base+`/workspaces/${existing.id}/files`,headers:{authorization:`Bearer ${editor.token}`},payload:{path:'escape.jsonl',content:'{"id":"escape"}\n'}});assert.equal(deniedWrite.statusCode,403,deniedWrite.body);
  assert.equal((await provider.workspace(key,existing.id)).changes.length,0);assert.equal(await head(),baseline);
});
