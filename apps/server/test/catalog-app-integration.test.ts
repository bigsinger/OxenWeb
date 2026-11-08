import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import type {RepoSummary,RequestIdentity} from '../../../packages/shared/src/index.js';
import {createApp} from '../src/app.js';
import {loadConfig} from '../src/config.js';
import {DemoProvider} from '../src/demo.js';
import {DatasetService} from '../src/dataset.js';
import {ApiError} from '../src/errors.js';
import {storedZip} from '../src/zip-io.js';

const token='synthetic-catalog-app-owner-token';
const headers={authorization:'Bearer '+token,'x-oxen-request':'web'};
const owner:RequestIdentity={id:'owner',name:'Synthetic owner',kind:'owner',source:'bearer'};
async function fixture(t:{after:(callback:()=>Promise<void>)=>void}){
  const parent=path.resolve('.data/tests');await mkdir(parent,{recursive:true});const directory=await mkdtemp(path.join(parent,'catalog-app-'));
  const config=loadConfig({DEMO_MODE:'true',DEMO_DATA_FILE:path.join(directory,'provider.json'),BFF_TOKEN:token});
  const provider=new DemoProvider(config.demoFile);await provider.init();const apps:Awaited<ReturnType<typeof createApp>>[]=[];
  const start=async()=>{const app=await createApp(config,provider);apps.push(app);return app;};
  t.after(async()=>{for(const app of apps)await app.close();assert.ok(path.resolve(directory).startsWith(parent+path.sep));await rm(directory,{recursive:true,force:true});});
  return {provider,start};
}
function multipart(filename:string,content:Buffer,fields:Record<string,string>={}){
  const boundary='catalog-app-synthetic-boundary',parts:Buffer[]=[];
  for(const [name,value]of Object.entries(fields))parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),content,Buffer.from(`\r\n--${boundary}--\r\n`));
  return {headers:{...headers,'content-type':`multipart/form-data; boundary=${boundary}`},payload:Buffer.concat(parts)};
}
function assertCreated(summary:RepoSummary,start:number,end:number){
  assert.ok(summary.createdAt,'newly created import must expose a known creation time');
  const time=Date.parse(summary.createdAt!);assert.ok(Number.isFinite(time));assert.ok(time>=start&&time<=end,summary.createdAt);
  assert.equal(summary.activity?.createdAt,summary.createdAt);assert.notEqual(summary.activity?.source,'unknown');
}

for(const list of [false,true])test(`app ${list?'repository list':'single repository'} keeps sample count and catalog on one pinned head during a concurrent commit`,async t=>{
  const {provider,start}=await fixture(t),key={namespace:'local',repo:'catalog-race-'+(list?'list':'detail')};
  await provider.createRepo({...key,name:key.repo,description:'Synthetic pinned summary race'});
  const writer=new DatasetService(provider),initial=await writer.initialize(key,owner,{ref:'main',expectedCommit:(await provider.branches(key))[0]!.commitId,rows:[{id:'one',text:'Synthetic first record'}]});
  const app=await start(),originalRaw=provider.raw.bind(provider);let armed=true,advanced:string|undefined;
  provider.raw=async(repository,reference,filename)=>{
    const bytes=await originalRaw(repository,reference,filename);
    if(armed&&repository.namespace===key.namespace&&repository.repo===key.repo&&reference===initial.commitId&&filename===initial.path){
      armed=false;
      // Advance after the summary chose a version, while its fixed canonical bytes are being read.
      // With the old count-then-catalog wiring this yields count(A) plus catalog(B).
      advanced=(await writer.save(key,owner,{ref:'main',expectedCommit:initial.commitId,message:'Concurrent synthetic append',operations:[{op:'append',record:{id:'two',text:'Synthetic concurrent record'}}]})).commitId;
    }
    return bytes;
  };
  const url=list?'/api/repos':`/api/repos/${key.namespace}/${key.repo}`,response=await app.inject({url,headers});assert.equal(response.statusCode,200,response.body);
  const summary=list?response.json<RepoSummary[]>().find(item=>item.namespace===key.namespace&&item.name===key.repo)!:response.json<RepoSummary>();
  assert.ok(advanced,'race fixture must actually advance the branch');assert.notEqual(advanced,initial.commitId);
  assert.equal(summary.sampleCount,1);assert.equal(summary.sampleCountCommitId,initial.commitId);assert.equal(summary.catalog?.commitId,initial.commitId);assert.equal(summary.sampleCountCommitId,summary.catalog?.commitId);
  const next=await app.inject({url:`/api/repos/${key.namespace}/${key.repo}`,headers});assert.equal(next.statusCode,200,next.body);const latest=next.json<RepoSummary>();
  assert.equal(latest.sampleCount,2);assert.equal(latest.sampleCountCommitId,advanced);assert.equal(latest.catalog?.commitId,advanced);
});

for(const kind of ['jsonl','zip'] as const)test(`new ${kind.toUpperCase()} HTTP import records creation activity and retains it after BFF restart`,async t=>{
  const {provider,start}=await fixture(t),app=await start(),repo='catalog-new-'+kind,key={namespace:'local',repo};
  const content=Buffer.from('{"id":"one","text":"Synthetic imported record"}\n'),begin=Date.now();
  if(kind==='jsonl'){
    const response=await app.inject({method:'POST',url:'/api/import/jsonl',...multipart('samples.jsonl',content,{...key,branch:'main',path:'data/samples.jsonl',createRepository:'true',description:'Synthetic creation activity'})});
    assert.equal(response.statusCode,200,response.body);
  }else{
    const archive=storedZip([{name:'samples.jsonl',content}]),inspection=await app.inject({method:'POST',url:'/api/import/zip',...multipart('samples.zip',archive)});assert.equal(inspection.statusCode,200,inspection.body);
    const id=inspection.json().id,mapping={mode:'tables',paths:['samples.jsonl'],idField:'id'},plan=await app.inject({method:'POST',url:`/api/import/zip/${id}/plan`,headers,payload:mapping});assert.equal(plan.statusCode,200,plan.body);
    const committed=await app.inject({method:'POST',url:`/api/import/zip/${id}/commit`,headers,payload:{...key,branch:'main',createRepository:true,mapping,fingerprint:plan.json().fingerprint}});assert.equal(committed.statusCode,200,committed.body);
  }
  const response=await app.inject({url:`/api/repos/local/${repo}`,headers});assert.equal(response.statusCode,200,response.body);const summary=response.json<RepoSummary>();assertCreated(summary,begin,Date.now());assert.equal(summary.sampleCount,1);
  const restarted=await start(),again=await restarted.inject({url:`/api/repos/local/${repo}`,headers});assert.equal(again.statusCode,200,again.body);assert.equal(again.json<RepoSummary>().createdAt,summary.createdAt);
  const untouched=await restarted.inject({url:'/api/repos/oxen/visual-search',headers});assert.equal(untouched.statusCode,200,untouched.body);assert.equal(untouched.json<RepoSummary>().createdAt,undefined,'old repositories must not be backfilled with now');
  assert.equal((await provider.branches(key))[0]!.name,'main');
});

for(const kind of ['jsonl','zip'] as const)test(`${kind.toUpperCase()} import retains creation activity if writing fails after repository creation`,async t=>{
  const {provider,start}=await fixture(t),app=await start(),repo='catalog-failed-'+kind,key={namespace:'local',repo};
  const content=Buffer.from('{"id":"one","text":"Synthetic failed import"}\n'),write=provider.writeWorkspace.bind(provider),begin=Date.now();
  provider.writeWorkspace=async(repository,workspace,filename,bytes)=>{if(repository.repo===repo&&filename.endsWith('.jsonl'))throw new ApiError(409,'SYNTHETIC_WRITE_FAILURE','Synthetic failure after repository creation');return write(repository,workspace,filename,bytes);};
  if(kind==='jsonl'){
    const response=await app.inject({method:'POST',url:'/api/import/jsonl',...multipart('samples.jsonl',content,{...key,branch:'main',path:'data/samples.jsonl',createRepository:'true'})});assert.equal(response.statusCode,409,response.body);assert.equal(response.json().error.code,'SYNTHETIC_WRITE_FAILURE');
  }else{
    const inspection=await app.inject({method:'POST',url:'/api/import/zip',...multipart('samples.zip',storedZip([{name:'samples.jsonl',content}]))});assert.equal(inspection.statusCode,200,inspection.body);const id=inspection.json().id,mapping={mode:'tables',paths:['samples.jsonl']};
    const plan=await app.inject({method:'POST',url:`/api/import/zip/${id}/plan`,headers,payload:mapping});assert.equal(plan.statusCode,200,plan.body);
    const response=await app.inject({method:'POST',url:`/api/import/zip/${id}/commit`,headers,payload:{...key,branch:'main',createRepository:true,mapping,fingerprint:plan.json().fingerprint}});assert.equal(response.statusCode,409,response.body);assert.equal(response.json().error.code,'SYNTHETIC_WRITE_FAILURE');
  }
  const summary=await app.inject({url:`/api/repos/local/${repo}`,headers});assert.equal(summary.statusCode,200,summary.body);assertCreated(summary.json<RepoSummary>(),begin,Date.now());assert.equal(summary.json<RepoSummary>().sampleCount,null);
});
