import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import type { DatasetCapability, LabelColumn, ProjectSchemaBinding, ProjectSchemaState, PublishedTemplateSnapshot, RequestIdentity } from '../../../packages/shared/src/index.js';
import { DemoProvider } from '../src/demo.js';
import { ProjectLabelService, projectLabelSaveSchema } from '../src/project-labels.js';
import { DatasetCatalogService } from '../src/dataset-catalog.js';
import { DatasetService } from '../src/dataset.js';
import { DatasetDraftService } from '../src/dataset-drafts.js';
import { ApiError } from '../src/errors.js';
import { DATASET_LABELS_PATH } from '../src/dataset-label-summary.js';

const owner:RequestIdentity={id:'owner',name:'Synthetic owner',kind:'owner',source:'local'},annotator:RequestIdentity={id:'annotator',name:'Synthetic annotator',kind:'collaborator',source:'bearer'};
const columns:LabelColumn[]=[{id:'dataset_subject',name:'研究主题',type:'multi',scopes:['dataset'],options:[{value:'prompt',optionId:'prompt',displayName:'提示词注入'},{value:'skill',optionId:'skill',displayName:'Skill'}],semanticKey:'dataset.subject'},{id:'source',name:'来源',type:'single',scopes:['dataset'],options:[{value:'synthetic',optionId:'synthetic',displayName:'人工构造'},{value:'public',optionId:'public',displayName:'公开基准'}],semanticKey:'dataset.source'}];
const snapshot:PublishedTemplateSnapshot={id:'project_catalog',name:'Synthetic project catalog',domain:'aisec',description:'Synthetic only',organizationId:'local',version:1,checksum:'a'.repeat(64),publishedAt:'2026-11-08T00:00:00Z',publishedBy:'owner',targetKind:'dataset',bindings:columns.map((column,index)=>({dimensionId:column.id,dimensionVersion:1,scopes:['dataset'],required:false,order:index})),dimensions:columns.map(column=>({id:column.id,displayName:column.name,type:column.type,description:'Synthetic only',semanticKey:column.semanticKey,options:(column.options??[]).map(option=>({id:option.optionId??option.value,displayName:option.displayName??option.value})),version:1,checksum:'f'.repeat(64),publishedAt:'2026-11-08',publishedBy:'owner'})),columns};
const binding:ProjectSchemaBinding={version:2,layers:{dataset:{organizationId:'local',templateId:snapshot.id,templateVersion:1,checksum:snapshot.checksum,snapshot,boundAt:'2026-11-08',boundBy:'owner'}},checksum:'b'.repeat(64),boundAt:'2026-11-08',boundBy:'owner'};
async function fixture(t:{after:(callback:()=>Promise<void>)=>void}){
 const parent=path.resolve('.data/tests');await mkdir(parent,{recursive:true});const directory=await mkdtemp(path.join(parent,'project-labels-'));t.after(async()=>{if(!path.resolve(directory).startsWith(parent+path.sep))throw new Error('Unsafe test cleanup');await rm(directory,{recursive:true,force:true});});
 const provider=new DemoProvider(path.join(directory,'demo.json'));await provider.init();const key={namespace:'local',repo:'project-labels-fixture'};await provider.createRepo({namespace:key.namespace,name:key.repo,description:'Synthetic project label fixture'});
 let allowed=true,selected:ProjectSchemaBinding|undefined=binding;
 const access={requireCapability:async(_key:unknown,identity:RequestIdentity,capability:DatasetCapability)=>{if(identity.id==='denied'||capability==='dataset.assign'&&(identity.id!=='owner'||!allowed))throw new ApiError(403,'CAPABILITY_REQUIRED','Synthetic denied');}};
 const readBinding=async(_key:unknown,commitId:string):Promise<ProjectSchemaState>=>({commitId,...(selected?{binding:selected}:{}),columnsByScope:{dataset:selected?columns:[],row:[],file:[]}});
 const datasets=new DatasetService(provider,{governance:{snapshot:readBinding}}),initial=await datasets.initialize(key,owner,{ref:'main',expectedCommit:(await provider.branches(key))[0]!.commitId,rows:[{id:'synthetic-one',text:'Source one'},{id:'synthetic-two',text:'Source two'}]});
 const service=new ProjectLabelService({provider,access,readBinding}),catalog=new DatasetCatalogService({provider,authorize:(key,identity)=>access.requireCapability(key,identity,'read'),readBinding});
 return {provider,key,service,catalog,datasets,initial,directory,head:async(branch='main')=>(await provider.branches(key)).find(item=>item.name===branch)!.commitId,revoke:()=>{allowed=false;},setBinding:(next:ProjectSchemaBinding|undefined)=>{selected=next;}};
}

test('project label save commits one main metadata file, leaves sample drafts and user workspaces untouched, and never reads source rows',async t=>{
 const f=await fixture(t),source=(await f.provider.raw(f.key,f.initial.commitId,f.initial.path)).content;
 await f.provider.createBranch(f.key,'annotate/alice',await f.head());
 const drafts=new DatasetDraftService(f.datasets,path.join(f.directory,'sample-drafts'));
 const draft=(await drafts.save(f.key,owner,{ref:'annotate/alice',expectedCommit:await f.head('annotate/alice'),draftRevision:0,operations:[{op:'update',rowId:f.initial.rowIds[0]!,record:{...f.initial.rows[0],text:'Private uncommitted sample'}}]})).draft!;
 const dirty=await f.provider.createWorkspace(f.key,'User pending workspace','main');await f.provider.writeWorkspace(f.key,dirty.id,'notes.txt',Buffer.from('Uncommitted user note'));
 const beforeWorkspaces=await f.provider.workspaces(f.key),beforeCommits=(await f.provider.commits(f.key,'main')).length,beforeBranch=await f.head('annotate/alice');
 const raw=f.provider.raw.bind(f.provider);f.provider.raw=async(key,ref,filename)=>{assert.notEqual(filename,f.initial.path,'Project tag save must not scan samples');return raw(key,ref,filename);};
 const saved=await f.service.save(f.key,owner,{expectedCommit:await f.head(),values:{dataset_subject:['prompt'],source:'public'}});
 assert.equal(saved.ref,'main');assert.equal(saved.state,'ready');assert.deepEqual(saved.values,{dataset_subject:['prompt'],source:'public'});
 assert.equal((await f.provider.commits(f.key,'main')).length-beforeCommits,1);assert.equal(await f.head('annotate/alice'),beforeBranch);
 assert.deepEqual((await f.provider.commit(f.key,saved.commitId!)).files.map(file=>file.path),[DATASET_LABELS_PATH]);
 assert.deepEqual(await f.provider.workspaces(f.key),beforeWorkspaces);
 f.provider.raw=raw;assert.deepEqual((await drafts.read(f.key,owner,'annotate/alice')).draft,draft);assert.deepEqual((await raw(f.key,saved.commitId!,f.initial.path)).content,source);
});

test('main is the only authority for catalog, requested branches and non-main default branch never replace it',async t=>{
 const f=await fixture(t);const first=await f.service.save(f.key,owner,{expectedCommit:await f.head(),values:{dataset_subject:['prompt']}});
 await f.provider.createBranch(f.key,'alternate',first.commitId!);const workspace=await f.provider.createWorkspace(f.key,'Synthetic unrelated alternate','alternate');await f.provider.writeWorkspace(f.key,workspace.id,'README.md',Buffer.from('Alternate branch content'));await f.provider.commitWorkspace(f.key,workspace.id,'Newer alternate branch');await f.provider.updateRepo(f.key,{defaultBranch:'alternate'});
 const summary=await f.catalog.enrichSummary(await f.provider.repo(f.key),owner),requested=await f.catalog.branchSummary(f.key,'alternate',owner);
 assert.equal(summary.catalog?.branch,'main');assert.equal(summary.catalog?.commitId,first.commitId);assert.equal(requested.commitId,first.commitId);assert.equal(requested.fields.find(field=>field.dimensionId==='dataset_subject')?.values[0]?.value,'prompt');
 const branches=f.provider.branches.bind(f.provider);f.provider.branches=async key=>(await branches(key)).filter(branch=>branch.name!=='main');
 const missing=await f.service.read(f.key,owner);assert.equal(missing.state,'missing-main');assert.deepEqual(missing.values,{});assert.equal(missing.capabilities.edit,false);assert.equal((await f.catalog.enrichSummary(await f.provider.repo(f.key),owner)).catalog?.commitId,undefined);
 await assert.rejects(()=>f.service.save(f.key,owner,{expectedCommit:first.commitId!,values:{source:'public'}}),(error:unknown)=>error instanceof ApiError&&error.code==='PROJECT_LABELS_MAIN_REQUIRED');
});

test('permissions, stale CAS, invalid scopes and source refs fail before project label writes',async t=>{
 const f=await fixture(t);const initial=await f.service.read(f.key,owner);assert.equal(initial.state,'unassigned');assert.deepEqual(initial.values,{});assert.equal((await f.service.read(f.key,annotator)).capabilities.edit,false);
 let creates=0;const create=f.provider.createWorkspace.bind(f.provider);f.provider.createWorkspace=async(...args)=>{creates++;return create(...args);};
 await assert.rejects(()=>f.service.save(f.key,annotator,{expectedCommit:initial.commitId!,values:{source:'public'}}),(error:unknown)=>error instanceof ApiError&&error.status===403);
 await assert.rejects(()=>f.service.save(f.key,owner,{expectedCommit:initial.commitId!,values:{sample_judgment:'unsafe'}}),(error:unknown)=>error instanceof ApiError&&error.code==='LABEL_UNKNOWN_COLUMN');
 await assert.rejects(()=>f.service.save(f.key,owner,{expectedCommit:initial.commitId!,values:{source:'not-published'}}));
 assert.throws(()=>projectLabelSaveSchema.parse({expectedCommit:initial.commitId,ref:'alternate',values:{}}));assert.equal(creates,0);
 const saved=await f.service.save(f.key,owner,{expectedCommit:initial.commitId!,values:{source:'public'}});
 await assert.rejects(()=>f.service.save(f.key,owner,{expectedCommit:initial.commitId!,values:{source:'synthetic'}}),(error:unknown)=>error instanceof ApiError&&error.code==='PROJECT_LABELS_VERSION_CONFLICT');
 assert.equal(await f.head(),saved.commitId);assert.equal(creates,1);
});

test('full value replacement and null clear are explicit, no-op save does not commit, and no template has a distinct state',async t=>{
 const f=await fixture(t);let saved=await f.service.save(f.key,owner,{expectedCommit:await f.head(),values:{source:'public',dataset_subject:['prompt']}});
 saved=await f.service.save(f.key,owner,{expectedCommit:saved.commitId!,values:{source:null,dataset_subject:['skill']}});assert.deepEqual(saved.values,{dataset_subject:['skill']});
 const before=saved.commitId;saved=await f.service.save(f.key,owner,{expectedCommit:before!,values:{dataset_subject:['skill']}});assert.equal(saved.commitId,before);
 saved=await f.service.save(f.key,owner,{expectedCommit:before!,values:{}});assert.equal(saved.state,'unassigned');assert.deepEqual(saved.values,{});
 f.setBinding(undefined);assert.equal((await f.service.read(f.key,owner)).state,'unconfigured');await assert.rejects(()=>f.service.save(f.key,owner,{expectedCommit:saved.commitId!,values:{}}),(error:unknown)=>error instanceof ApiError&&error.code==='PROJECT_LABELS_TEMPLATE_REQUIRED');
});

test('revocation during workspace preparation prevents commit without advancing project labels',async t=>{
 const f=await fixture(t),baseline=await f.head(),write=f.provider.writeWorkspace.bind(f.provider);
 f.provider.writeWorkspace=async(...args)=>{const result=await write(...args);f.revoke();return result;};
 await assert.rejects(()=>f.service.save(f.key,owner,{expectedCommit:baseline,values:{source:'public'}}),(error:unknown)=>error instanceof ApiError&&error.status===403);assert.equal(await f.head(),baseline);assert.equal((await f.provider.workspaces(f.key)).length,0);
});

test('main advances during preparation without being overwritten by stale project labels',async t=>{
 const f=await fixture(t),baseline=await f.head(),write=f.provider.writeWorkspace.bind(f.provider);let moved=false,advanced='';
 f.provider.writeWorkspace=async(...args)=>{
   const result=await write(...args);
   if(!moved){moved=true;const other=await f.provider.createWorkspace(f.key,'Concurrent main edit','main');await write(f.key,other.id,'concurrent.txt',Buffer.from('A separately committed change'));advanced=(await f.provider.commitWorkspace(f.key,other.id,'Concurrent main commit',baseline)).id;await f.provider.deleteWorkspace(f.key,other.id);}
   return result;
 };
 await assert.rejects(()=>f.service.save(f.key,owner,{expectedCommit:baseline,values:{source:'public'}}),(error:unknown)=>error instanceof ApiError&&error.code==='PROJECT_LABELS_VERSION_CONFLICT');assert.equal(await f.head(),advanced);assert.equal((await f.service.read(f.key,owner)).state,'unassigned');assert.equal((await f.provider.workspaces(f.key)).length,0);
});

test('free project keywords come only from fixed main policy bytes, with no summary or other branch fallback',async t=>{
 const f=await fixture(t);
 const workspace=await f.provider.createWorkspace(f.key,'Main project keywords','main');await f.provider.writeWorkspace(f.key,workspace.id,'.oxenweb/repository.json',Buffer.from(JSON.stringify({tags:['aisec','benchmark']})));const main=(await f.provider.commitWorkspace(f.key,workspace.id,'Main keyword metadata')).id;await f.provider.deleteWorkspace(f.key,workspace.id);
 await f.provider.createBranch(f.key,'alternate',main);const other=await f.provider.createWorkspace(f.key,'Alternate keywords','alternate');await f.provider.writeWorkspace(f.key,other.id,'.oxenweb/repository.json',Buffer.from(JSON.stringify({tags:['wrong-branch']})));await f.provider.commitWorkspace(f.key,other.id,'Alternate keyword metadata');await f.provider.deleteWorkspace(f.key,other.id);await f.provider.updateRepo(f.key,{defaultBranch:'alternate',tags:['wrong-provider-summary']});
 const state=await f.service.read(f.key,owner),card=await f.catalog.enrichSummary(await f.provider.repo(f.key),owner);assert.deepEqual(state.keywords,['aisec','benchmark']);assert.equal(state.commitId,main);assert.deepEqual(card.catalog?.keywords,['aisec','benchmark']);assert.equal(card.catalog?.commitId,main);
 const invalid=await f.provider.createWorkspace(f.key,'Malformed main keywords','main');await f.provider.writeWorkspace(f.key,invalid.id,'.oxenweb/repository.json',Buffer.from('{"tags":[42]}'));await f.provider.commitWorkspace(f.key,invalid.id,'Invalid synthetic metadata');
 await assert.rejects(()=>f.service.read(f.key,owner),(error:unknown)=>error instanceof ApiError&&error.code==='PROJECT_KEYWORDS_INVALID');const unavailable=await f.catalog.enrichSummary(await f.provider.repo(f.key),owner);assert.equal(unavailable.catalog?.state,'unavailable');assert.notDeepEqual(unavailable.catalog?.keywords,['wrong-branch']);
});
