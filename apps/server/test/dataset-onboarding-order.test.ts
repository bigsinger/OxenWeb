import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import Fastify from 'fastify';
import type {RequestIdentity} from '../../../packages/shared/src/index.js';
import type {RepositoryAccessService} from '../src/repository-access.js';
import {DemoProvider} from '../src/demo.js';
import {DatasetService} from '../src/dataset.js';
import {DatasetDraftService} from '../src/dataset-drafts.js';
import {ZipImportService} from '../src/zip-import.js';
import {registerDatasetImportRoutes} from '../src/dataset-import-routes.js';
import {orderedDatasetIds} from '../src/dataset-order.js';
import {storedZip} from '../src/zip-io.js';
import {ApiError} from '../src/errors.js';
import {parseJsonl} from '../src/jsonl.js';
import {projectRoot} from '../src/config.js';
const owner:RequestIdentity={id:'owner',name:'Synthetic Owner',kind:'owner',source:'local'};
async function fixture(t:{after:(fn:()=>Promise<void>)=>void}){
  const root=path.resolve(projectRoot,'.data/tests');await mkdir(root,{recursive:true});const dir=await mkdtemp(path.join(root,'onboarding-order-'));t.after(async()=>{if(!path.resolve(dir).startsWith(root+path.sep))throw new Error('unsafe cleanup');await rm(dir,{recursive:true,force:true});});
  const provider=new DemoProvider(path.join(dir,'state.json'));await provider.init();const key={namespace:'oxen',repo:'synthetic-empty'};await provider.createRepo({...key,name:key.repo,description:'Synthetic onboarding'});const datasets=new DatasetService(provider),drafts=new DatasetDraftService(datasets,path.join(dir,'drafts')),head=(await provider.branches(key))[0]!.commitId;
  const zipImports=new ZipImportService({provider,authorize:async()=>{},importDataset:(repository,identity,input)=>datasets.initialize(repository,identity,input)});
  return {provider,key,datasets,drafts,head,zipImports};
}
test('a real zero-sample baseline can be configured and receive the first sample through a private draft',async t=>{
  const f=await fixture(t),status=await f.datasets.setupState(f.key,'main');assert.equal(status.canInitialize,true);
  const empty=await f.datasets.initialize(f.key,owner,{ref:'main',expectedCommit:f.head,rows:[],descriptor:{fields:{text:{type:'string',required:true,displayName:'正文'}}}});
  assert.equal(empty.totalRows,0);assert.equal((await f.provider.raw(f.key,empty.commitId,empty.path)).content.length,0);assert.equal((await f.datasets.page(f.key,'main')).columns[0]?.name,'text');
  assert.throws(()=>parseJsonl(Buffer.alloc(0)),(cause:any)=>cause.code==='JSONL_EMPTY','Import still refuses empty files');
  const commits=(await f.provider.commits(f.key,'main')).length;
  const stored=await f.drafts.save(f.key,owner,{ref:'main',expectedCommit:empty.commitId,draftRevision:0,operations:[{op:'append',rowId:'new:first',record:{id:'first',text:'Synthetic first record'}}]});
  assert.equal((await f.provider.commits(f.key,'main')).length,commits);assert.equal((await f.drafts.page(f.key,owner,'main')).rows[0]?.text,'Synthetic first record');
  const result=await f.drafts.commit(f.key,owner,{ref:'main',expectedCommit:empty.commitId,expectedDraftId:stored.draft!.id,draftRevision:stored.draft!.draftRevision,message:'First sample'});
  assert.equal(result.totalRows,1);assert.equal((await f.datasets.read(f.key,'main')).rowIds[0],'new:first');
});
test('sorting uses native scalar types, stable ties and null/missing last in both directions',()=>{
  const values:Record<string,unknown>={n2:2,n10:10,f:false,t:true,s:'2',empty:'',nil:null,missing:undefined,equal:2},ids=Object.keys(values);
  assert.deepEqual(orderedDatasetIds(ids,id=>values[id],'asc'),['n2','equal','n10','f','t','empty','s','nil','missing']);
  assert.deepEqual(orderedDatasetIds(ids,id=>values[id],'desc'),['s','empty','t','f','n10','n2','equal','nil','missing']);
});
test('full filtered dataset sorting occurs before pagination and includes private updates, appends and deletions',async t=>{
  const f=await fixture(t),snapshot=await f.datasets.initialize(f.key,owner,{ref:'main',expectedCommit:f.head,rows:Array.from({length:130},(_,index)=>({id:`row-${index}`,score:129-index,group:index%2?'odd':'even'}))});
  const second=await f.datasets.page(f.key,'main',{sort:{column:'score',direction:'asc'},page:2,pageSize:10});assert.deepEqual(second.rows.map(row=>row.score),[10,11,12,13,14,15,16,17,18,19]);
  const filtered=await f.datasets.page(f.key,'main',{filters:[{column:'group',operator:'eq',value:'even'}],sort:{column:'score',direction:'desc'},pageSize:3});assert.equal(filtered.matchedRows,65);assert.deepEqual(filtered.rows.map(row=>row.score),[129,127,125]);
  await f.drafts.save(f.key,owner,{ref:'main',expectedCommit:snapshot.commitId,draftRevision:0,operations:[{op:'delete',rowId:snapshot.rowIds[0]!},{op:'append',rowId:'new:lowest',record:{id:'lowest',score:-1,group:'even'}},{op:'update',rowId:snapshot.rowIds[1]!,record:{...snapshot.rows[1],score:-2}}]});
  const page=await f.drafts.page(f.key,owner,'main',{sort:{column:'score',direction:'asc'},pageSize:3});assert.deepEqual(page.rows.map(row=>row.score),[-2,-1,0]);assert.equal(page.matchedRows,130);assert.equal((await f.provider.branches(f.key))[0]!.commitId,snapshot.commitId);
  await assert.rejects(()=>f.datasets.page(f.key,'main',{sort:{column:'absent',direction:'asc'}}),(cause:any)=>cause.code==='QUERY_UNKNOWN_COLUMN');
});
test('append import preview is read-only; commit preserves baseline bytes, source truth, identities and ZIP references',async t=>{
  const f=await fixture(t),before=await f.datasets.initialize(f.key,owner,{ref:'main',expectedCommit:f.head,rows:[{id:'old',text:'Original',ground_truth:'source-only'}]}),raw=(await f.provider.raw(f.key,before.commitId,before.path)).content,zip=storedZip([{name:'SKILL.md',content:Buffer.from('Synthetic inert archive data')}]);
  const input={ref:'main',expectedCommit:before.commitId,rows:[{id:'new',skill_path:'attachments/inert.zip',ground_truth:'unreviewed-source'}],rowIds:['import:one'],files:[{path:'attachments/inert.zip',content:zip}],descriptor:{attachmentFields:['skill_path']}};
  const workspaces=await f.provider.workspaces(f.key),preview=await f.datasets.appendImport(f.key,owner,input,true);assert.equal(preview.totalRows,2);assert.deepEqual(await f.provider.workspaces(f.key),workspaces);assert.equal((await f.provider.branches(f.key))[0]!.commitId,before.commitId);
  const after=await f.datasets.appendImport(f.key,owner,input);assert.equal(after.totalRows,2);assert.equal(after.rowIds[0],before.rowIds[0]);assert.equal(after.rows[0]?.ground_truth,'source-only');assert.equal(after.attachments[0]?.path,'attachments/inert.zip');assert.equal((await f.provider.raw(f.key,after.commitId,after.path)).content.equals(raw),true);assert.equal((await f.provider.raw(f.key,after.commitId,'attachments/inert.zip')).content.equals(zip),true);
  await assert.rejects(()=>f.datasets.appendImport(f.key,owner,{...input,expectedCommit:after.commitId,rowIds:['import:another'],rows:[{id:'old'}]},true),(cause:any)=>cause.code==='DATASET_DUPLICATE_ID');
  await assert.rejects(()=>f.datasets.appendImport(f.key,owner,input,true),(cause:any)=>cause.code==='DATASET_VERSION_CONFLICT');
});
test('large append imports validate once as a bulk workflow operation rather than a 500-row public draft',async t=>{
  const f=await fixture(t),empty=await f.datasets.initialize(f.key,owner,{ref:'main',expectedCommit:f.head,rows:[]});let checked=0;
  const service=new DatasetService(f.provider,{authorize:async()=>{},beforeWrite:async(_key,_actor,_ref,ids,_operation,context)=>{checked++;assert.equal(ids.length,501);assert.equal(context.operations.length,501);}});
  const preview=await service.appendImport(f.key,owner,{ref:'main',expectedCommit:empty.commitId,rows:Array.from({length:501},(_,index)=>({id:`bulk-${index}`,score:index}))},true);
  assert.equal(preview.totalRows,501);assert.equal(checked,2);assert.equal((await f.provider.branches(f.key))[0]!.commitId,empty.commitId);
});
test('onboarding import routes preview and commit CSV, JSONL append and opaque Skill ZIP with strict private-draft protection',async t=>{
  const f=await fixture(t),app=Fastify();t.after(()=>app.close());app.addHook('onRequest',async request=>{request.oxenIdentity=owner;});app.setErrorHandler((cause,_request,reply)=>reply.code(cause instanceof ApiError?cause.status:500).send({error:{code:cause instanceof ApiError?cause.code:'ERROR',message:cause.message}}));
  const access={require:async()=>{},requireCapability:async()=>{}} as unknown as RepositoryAccessService;registerDatasetImportRoutes(app,{...f,access});const base=`/api/repos/${f.key.namespace}/${f.key.repo}/dataset`;
  async function run(content:Buffer,filename:string,mapping:{mode:'tables'|'directories';paths:string[]}){const inspection=await f.zipImports.inspectData(content,filename,owner),generic=f.zipImports.plan(inspection.id,owner,mapping),expectedCommit=(await f.provider.branches(f.key))[0]!.commitId,input={ref:'main',expectedCommit,mapping,fingerprint:generic.fingerprint};const preview=await app.inject({method:'POST',url:base+'/import/'+inspection.id+'/preview',payload:input});assert.equal(preview.statusCode,200,preview.body);const commit=await app.inject({method:'POST',url:base+'/import/'+inspection.id+'/commit',payload:{...input,previewFingerprint:preview.json().previewFingerprint,message:'Synthetic import'}});assert.equal(commit.statusCode,200,commit.body);return commit.json();}
  assert.equal((await run(Buffer.from('id,text\ncsv-one,Synthetic CSV\n'),'input.csv',{mode:'tables',paths:['input.csv']})).totalRows,1);
  assert.equal((await run(Buffer.from('{"id":"json-two","score":2}\n'),'input.jsonl',{mode:'tables',paths:['input.jsonl']})).totalRows,2);
  const zip=storedZip([{name:'skills/one/SKILL.md',content:Buffer.from('Synthetic inert Skill data')}]);assert.equal((await run(zip,'skills.zip',{mode:'directories',paths:['skills/one']})).totalRows,3);
  const current=await f.datasets.read(f.key,'main');await f.drafts.save(f.key,owner,{ref:'main',expectedCommit:current.commitId,draftRevision:0,operations:[{op:'update',rowId:current.rowIds[0]!,record:{...current.rows[0],text:'Private edit'}}]});
  const inspection=await f.zipImports.inspectData(Buffer.from('{"id":"later"}\n'),'later.jsonl',owner),mapping={mode:'tables' as const,paths:['later.jsonl']},generic=f.zipImports.plan(inspection.id,owner,mapping),blocked=await app.inject({method:'POST',url:base+'/import/'+inspection.id+'/preview',payload:{ref:'main',expectedCommit:current.commitId,mapping,fingerprint:generic.fingerprint}});
  assert.equal(blocked.statusCode,409);assert.equal(blocked.json().error.code,'IMPORT_PRIVATE_DRAFT_PRESENT');assert.equal((await f.drafts.export(f.key,owner,'main')).draft?.operations.length,1);assert.equal((await f.provider.branches(f.key))[0]!.commitId,current.commitId);
});
