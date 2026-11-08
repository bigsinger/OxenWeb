import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DemoProvider } from '../src/demo.js';
import { DatasetService } from '../src/dataset.js';
import { DatasetDraftService } from '../src/dataset-drafts.js';
import { registerDatasetDraftRoutes } from '../src/dataset-draft-routes.js';
import { readDatasetLabelSummary } from '../src/dataset-label-summary.js';
import { LabelService } from '../src/labels.js';
import { ApiError } from '../src/errors.js';
import { projectRoot } from '../src/config.js';
import { datasetHash } from '../src/dataset-storage.js';
import type { RequestIdentity } from '../../../packages/shared/src/index.js';
import type { DatasetOperation } from '../../../packages/shared/src/dataset.js';

const owner:RequestIdentity={id:'owner',name:'Owner',kind:'owner',source:'local'};
const other:RequestIdentity={...owner,id:'second',name:'Second'};
async function fixture(t:{after:(callback:()=>Promise<void>)=>void}){
  const root=path.resolve(projectRoot,'.data/tests');await mkdir(root,{recursive:true});const directory=await mkdtemp(path.join(root,'dataset-drafts-'));
  t.after(async()=>{if(!path.resolve(directory).startsWith(root+path.sep))throw new Error('unsafe fixture cleanup');await rm(directory,{recursive:true,force:true});});
  const provider=new DemoProvider(path.join(directory,'provider.json'));await provider.init();const key={namespace:'oxen',repo:'draft-fixture'};await provider.createRepo({...key,name:key.repo,description:'Synthetic draft tests'});
  const service=new DatasetService(provider),snapshot=await service.initialize(key,owner,{ref:'main',expectedCommit:(await provider.branches(key))[0]!.commitId,rows:Array.from({length:7},(_,index)=>({id:`synthetic-${index}`,text:`before-${index}`,ground_truth:{source:'unchanged'}})),labels:{version:1,columns:[{id:'judgment',name:'判断',type:'single',options:[{value:'safe'},{value:'risk'}],scopes:['row']},{id:'context',name:'来源说明',type:'text',scopes:['dataset']}],assignments:[]}});
  const draftDirectory=path.join(directory,'drafts'),drafts=new DatasetDraftService(service,draftDirectory);
  return {provider,key,service,snapshot,drafts,draftDirectory};
}
test('saving and replacing private drafts creates no workspace or commit; explicit commit creates exactly one',async t=>{
  const f=await fixture(t),{key,snapshot,provider,drafts}=f;const originalRaw=(await provider.raw(key,snapshot.commitId,snapshot.path)).content,initialCommits=(await provider.commits(key,'main')).length;let workspaceCalls=0;const originalCreate=provider.createWorkspace.bind(provider);provider.createWorkspace=async(...args)=>{workspaceCalls++;return originalCreate(...args);};
  const first:DatasetOperation={op:'update',rowId:snapshot.rowIds[0]!,record:{...snapshot.rows[0],text:'first draft'}};
  let state=await drafts.save(key,owner,{ref:'main',expectedCommit:snapshot.commitId,draftRevision:0,operations:[first]});
  state=await drafts.save(key,owner,{ref:'main',expectedCommit:snapshot.commitId,draftRevision:state.draft!.draftRevision,expectedDraftId:state.draft!.id,operations:[{...first,record:{...snapshot.rows[0],text:'second draft'}},{op:'assign',scope:'row',rowId:snapshot.rowIds[6],values:{judgment:'risk'}}]});
  assert.equal(workspaceCalls,0);assert.equal((await provider.branches(key))[0]!.commitId,snapshot.commitId);assert.equal((await provider.commits(key,'main')).length,initialCommits);
  const committed=await drafts.commit(key,owner,{ref:'main',expectedCommit:snapshot.commitId,draftRevision:state.draft!.draftRevision,expectedDraftId:state.draft!.id,message:'One explicit synthetic commit'});
  assert.equal(workspaceCalls,1);assert.equal((await provider.commits(key,'main')).length,initialCommits+1);assert.notEqual(committed.commitId,snapshot.commitId);assert.deepEqual(await drafts.read(key,owner,'main'),{});
  const current=await f.service.read(key,'main');assert.equal(current.rows[0]!.text,'second draft');assert.deepEqual(current.rows[0]!.ground_truth,{source:'unchanged'});assert.equal(current.labels.assignments.find(item=>item.scope==='row')?.values.judgment,'risk');assert.deepEqual((await provider.raw(key,current.commitId,snapshot.path)).content,originalRaw);
});
test('full-table draft preview supports multiple pages, filter/count queries, additions and deletion without changing branch',async t=>{
  const {drafts,key,snapshot,provider}=await fixture(t);
  const state=await drafts.save(key,owner,{ref:'main',expectedCommit:snapshot.commitId,draftRevision:0,operations:[{op:'update',rowId:snapshot.rowIds[6]!,record:{...snapshot.rows[6],text:'draft needle'}},{op:'assign',scope:'row',rowId:snapshot.rowIds[6],values:{judgment:'risk'}},{op:'delete',rowId:snapshot.rowIds[0]!},{op:'append',record:{text:'new draft row'}}]});
  const last=await drafts.page(key,owner,'main',{page:4,pageSize:2},state.draft!.draftRevision,state.draft!.id);assert.equal(last.totalRows,7);assert.equal(last.rows.length,1);assert.ok(last.rows.some(row=>row.text==='new draft row'));
  const filtered=await drafts.page(key,owner,'main',{search:'draft needle',filters:[{column:'label.judgment',operator:'eq',value:'risk'}]});assert.equal(filtered.matchedRows,1);assert.equal(filtered.rows[0]!.text,'draft needle');assert.equal(filtered.baseContentHashes?.[snapshot.rowIds[6]!],snapshot.contentHashes[snapshot.rowIds[6]!]);
  const count=await drafts.page(key,owner,'main',{prompt:'总数多少',pageSize:2});assert.equal(count.matchedRows,7);assert.equal(count.rows.length,2);assert.equal((await provider.branches(key))[0]!.commitId,snapshot.commitId);
  assert.equal((await drafts.diff(key,owner,'main'))!.changes.length,4);
});
test('restart restores drafts and identity, repository and branch namespaces stay isolated',async t=>{
  const f=await fixture(t),{drafts,key,snapshot,provider}=f;await provider.createBranch(key,'other-branch',snapshot.commitId);
  await drafts.save(key,owner,{ref:'main',expectedCommit:snapshot.commitId,draftRevision:0,operations:[{op:'assign',scope:'row',rowId:snapshot.rowIds[0],values:{judgment:'safe'}}]});
  const restarted=new DatasetDraftService(new DatasetService(provider),f.draftDirectory);assert.equal((await restarted.read(key,owner,'main')).draft?.operations.length,1);assert.deepEqual(await restarted.read(key,other,'main'),{});assert.deepEqual(await restarted.read(key,owner,'other-branch'),{});assert.deepEqual(await restarted.read({...key,repo:'another'},owner,'main'),{});
  assert.equal((await restarted.readActivity(key,owner)).draftCount,1);assert.equal((await restarted.readActivity(key,other)).draftCount,0);await assert.rejects(()=>restarted.read(key,{...owner,kind:'guest'},'main'),(error:any)=>error.code==='AUTH_REQUIRED');
});
test('draft revision CAS prevents stale tabs from overwriting, deleting or committing a newer draft',async t=>{
  const {drafts,key,snapshot}=await fixture(t),input={ref:'main',expectedCommit:snapshot.commitId,draftRevision:0,operations:[{op:'assign',scope:'dataset',values:{context:'private'}} as DatasetOperation]};
  const state=await drafts.save(key,owner,input);await assert.rejects(()=>drafts.save(key,owner,input),(error:any)=>error.code==='DATASET_DRAFT_REVISION_CONFLICT');await assert.rejects(()=>drafts.discard(key,owner,'main',0,state.draft!.id),(error:any)=>error.code==='DATASET_DRAFT_REVISION_CONFLICT');await assert.rejects(()=>drafts.commit(key,owner,{ref:input.ref,expectedCommit:input.expectedCommit,draftRevision:0,expectedDraftId:state.draft!.id,message:'stale'}),(error:any)=>error.code==='DATASET_DRAFT_REVISION_CONFLICT');assert.equal((await drafts.read(key,owner,'main')).draft!.draftRevision,state.draft!.draftRevision);
});
test('revoked authorization and task range changes deny recovery, preview and commit while preserving stored draft',async t=>{
  const f=await fixture(t);let allowed=true,allowedRow=f.snapshot.rowIds[0];const service=new DatasetService(f.provider,{authorize:async()=>{if(!allowed)throw new ApiError(403,'REVOKED','Synthetic authorization revoked');},beforeWrite:async(_key,_identity,_branch,ids)=>{if(ids.some(id=>id!==allowedRow))throw new ApiError(403,'TASK_RANGE','Synthetic task range denied');}}),drafts=new DatasetDraftService(service,f.draftDirectory);
  const state=await drafts.save(f.key,owner,{ref:'main',expectedCommit:f.snapshot.commitId,draftRevision:0,operations:[{op:'assign',scope:'row',rowId:allowedRow,values:{judgment:'safe'}}]});
  allowed=false;const denied=await drafts.read(f.key,owner,'main');assert.equal(denied.issue?.code,'REVOKED');assert.equal(denied.draft,undefined);assert.equal(denied.summary!.operationCount,1);await assert.rejects(()=>drafts.page(f.key,owner,'main'),(error:any)=>error.code==='REVOKED');
  allowed=true;allowedRow=f.snapshot.rowIds[1];await assert.rejects(()=>drafts.commit(f.key,owner,{ref:'main',expectedCommit:f.snapshot.commitId,draftRevision:state.draft!.draftRevision,expectedDraftId:state.draft!.id,message:'out of range'}),(error:any)=>error.code==='TASK_RANGE');
  allowedRow=f.snapshot.rowIds[0];assert.ok((await drafts.read(f.key,owner,'main')).draft);assert.equal((await f.provider.branches(f.key))[0]!.commitId,f.snapshot.commitId);
});
test('a concurrent branch commit makes draft stale instead of rebasing or dropping it',async t=>{
  const f=await fixture(t),state=await f.drafts.save(f.key,owner,{ref:'main',expectedCommit:f.snapshot.commitId,draftRevision:0,operations:[{op:'assign',scope:'row',rowId:f.snapshot.rowIds[0],values:{judgment:'risk'}}]});
  await f.service.save(f.key,other,{ref:'main',expectedCommit:f.snapshot.commitId,message:'Separate branch change',operations:[{op:'readme',content:'Synthetic new version'}]});
  const stale=await f.drafts.read(f.key,owner,'main');assert.equal(stale.issue?.code,'DATASET_VERSION_CONFLICT');assert.equal(stale.summary?.draftRevision,state.draft!.draftRevision);assert.equal(stale.draft,undefined);await assert.rejects(()=>f.drafts.commit(f.key,owner,{ref:'main',expectedCommit:f.snapshot.commitId,draftRevision:state.draft!.draftRevision,expectedDraftId:state.draft!.id,message:'must not rebase'}),(error:any)=>error.code==='DATASET_VERSION_CONFLICT');assert.equal((await f.drafts.readActivity(f.key,owner)).draftCount,1);
});
test('commit failure keeps the same durable draft and can be retried with its original revision',async t=>{
  const f=await fixture(t),state=await f.drafts.save(f.key,owner,{ref:'main',expectedCommit:f.snapshot.commitId,draftRevision:0,operations:[{op:'assign',scope:'row',rowId:f.snapshot.rowIds[0],values:{judgment:'risk'}}]}),original=f.provider.commitWorkspace.bind(f.provider);
  f.provider.commitWorkspace=async()=>{throw new ApiError(503,'SYNTHETIC_COMMIT_FAILURE','Synthetic commit failed');};
  const input={ref:'main',expectedCommit:f.snapshot.commitId,draftRevision:state.draft!.draftRevision,expectedDraftId:state.draft!.id,message:'Explicit retry'};await assert.rejects(()=>f.drafts.commit(f.key,owner,input),(error:any)=>error.code==='SYNTHETIC_COMMIT_FAILURE');assert.equal((await f.drafts.read(f.key,owner,'main')).draft?.draftRevision,state.draft!.draftRevision);assert.equal((await f.provider.branches(f.key))[0]!.commitId,f.snapshot.commitId);
  f.provider.commitWorkspace=original;await f.drafts.commit(f.key,owner,input);assert.deepEqual(await f.drafts.read(f.key,owner,'main'),{});
});
test('data set labels have one branch-effective value while row actor opinions remain independent',async t=>{
  const f=await fixture(t);let current=await f.service.save(f.key,owner,{ref:'main',expectedCommit:f.snapshot.commitId,message:'First dataset value',operations:[{op:'assign',scope:'dataset',values:{context:'first'}},{op:'assign',scope:'row',rowId:f.snapshot.rowIds[0],values:{judgment:'safe'}}]});
  current=await f.service.save(f.key,other,{ref:'main',expectedCommit:current.commitId,message:'Next dataset value',operations:[{op:'assign',scope:'dataset',values:{context:'second'}},{op:'assign',scope:'row',rowId:f.snapshot.rowIds[0],values:{judgment:'risk'}}]});
  assert.equal(current.labels.assignments.find(item=>item.scope==='dataset')?.values.context,'second');assert.equal(current.labelConflicts.filter(item=>item.scope==='dataset').length,0);assert.equal(current.labelConflicts.filter(item=>item.scope==='row').length,1);assert.equal((await new LabelService(f.provider).read(f.key,'main')).assignments.find(item=>item.scope==='dataset')?.values.context,'second');
  const raw=f.provider.raw.bind(f.provider);f.provider.raw=async(key,ref,filename)=>{assert.notEqual(filename,current.path,'summary must not read canonical records');return raw(key,ref,filename);};assert.equal((await readDatasetLabelSummary(f.provider,f.key,current.commitId)).assignment?.values.context,'second');
});

test('discard and recreate cannot reuse a revision to overwrite, delete or commit a different draft',async t=>{
  const {drafts,key,snapshot}=await fixture(t),input={ref:'main',expectedCommit:snapshot.commitId,draftRevision:0,operations:[{op:'assign',scope:'dataset',values:{context:'first'}} as DatasetOperation]};
  const original=(await drafts.save(key,owner,input)).draft!;await drafts.discard(key,owner,'main',original.draftRevision,original.id);const replacement=(await drafts.save(key,owner,input)).draft!;
  assert.equal(original.draftRevision,replacement.draftRevision);assert.notEqual(original.id,replacement.id);
  await assert.rejects(()=>drafts.save(key,owner,{...input,draftRevision:original.draftRevision,expectedDraftId:original.id}),(error:any)=>error.code==='DATASET_DRAFT_REVISION_CONFLICT');
  await assert.rejects(()=>drafts.discard(key,owner,'main',original.draftRevision,original.id),(error:any)=>error.code==='DATASET_DRAFT_REVISION_CONFLICT');
  await assert.rejects(()=>drafts.commit(key,owner,{ref:'main',expectedCommit:snapshot.commitId,draftRevision:original.draftRevision,expectedDraftId:original.id,message:'Stale old draft'}),(error:any)=>error.code==='DATASET_DRAFT_REVISION_CONFLICT');
  assert.equal((await drafts.read(key,owner,'main')).draft?.id,replacement.id);
});

test('invalid schema fingerprints reject recovery and commit without deleting the private file',async t=>{
  const f=await fixture(t),state=await f.drafts.save(f.key,owner,{ref:'main',expectedCommit:f.snapshot.commitId,draftRevision:0,operations:[{op:'assign',scope:'row',rowId:f.snapshot.rowIds[0],values:{judgment:'risk'}}]});
  const filename=path.join(f.draftDirectory,datasetHash(f.key),datasetHash('owner:owner'),datasetHash('main')+'.json'),stored=JSON.parse(await readFile(filename,'utf8'));stored.draft.schemaHash='0'.repeat(64);await writeFile(filename,JSON.stringify(stored));
  const restored=await new DatasetDraftService(f.service,f.draftDirectory).read(f.key,owner,'main');assert.equal(restored.issue?.code,'DATASET_DRAFT_SCHEMA_CHANGED');assert.equal(restored.draft,undefined);
  await assert.rejects(()=>f.drafts.commit(f.key,owner,{ref:'main',expectedCommit:f.snapshot.commitId,draftRevision:state.draft!.draftRevision,expectedDraftId:state.draft!.id,message:'Invalid schema'}),(error:any)=>error.code==='DATASET_DRAFT_SCHEMA_CHANGED');
  assert.equal((await f.drafts.readActivity(f.key,owner)).draftCount,1);assert.equal((await f.provider.branches(f.key))[0]!.commitId,f.snapshot.commitId);
});

test('retired labels are excluded from current layers, searches and saved records without creating compatibility archives',async t=>{
  const f=await fixture(t),id=f.snapshot.rowIds[0]!;const old=await f.service.save(f.key,owner,{ref:'main',expectedCommit:f.snapshot.commitId,message:'Legacy opinion',operations:[{op:'assign',scope:'row',rowId:id,values:{judgment:'safe'}}]});
  const snapshot:any={id:'sample_template',name:'Synthetic sample',organizationId:'oxen',targetKind:'sample',version:1,domain:'synthetic',description:'Synthetic only',checksum:'synthetic-layer-checksum',publishedAt:'2026-11-08',publishedBy:'owner',columns:[{id:'judgment',name:'判断',type:'single',options:[{value:'safe',optionId:'safe'},{value:'risk',optionId:'risk'}],scopes:['row'],semanticKey:'synthetic.judgment'}],dimensions:[{id:'judgment',displayName:'判断',type:'single',semanticKey:'synthetic.judgment',description:'Synthetic only',version:1,options:[{id:'safe',displayName:'Safe'},{id:'risk',displayName:'Risk'}]}],bindings:[{dimensionId:'judgment',dimensionVersion:1,scopes:['row'],required:false,order:0}]};
  const binding:any={version:2,layers:{sample:{organizationId:'oxen',templateId:snapshot.id,templateVersion:1,checksum:snapshot.checksum,snapshot,boundAt:'2026-11-08',boundBy:'owner'}},legacyColumns:old.labels.columns,checksum:'synthetic-binding',boundAt:'2026-11-08',boundBy:'owner'};
  const service=new DatasetService(f.provider,{governance:{snapshot:async()=>({binding})}}),before=await service.read(f.key,'main');
  assert.equal(before.labels.assignments.find(item=>item.scope==='row'),undefined);assert.equal(Object.hasOwn(before,'compatibility'),false);assert.equal(before.labels.columns.some(column=>column.id==='context'),false);
  const saved=await service.save(f.key,owner,{ref:'main',expectedCommit:old.commitId,message:'New-layer own opinion',operations:[{op:'assign',scope:'row',rowId:id,values:{judgment:'risk'}}]});
  assert.equal(saved.labels.assignments.find(item=>item.scope==='row')?.values.judgment,'risk');assert.equal(Object.hasOwn(saved,'compatibility'),false);assert.equal(saved.labelRecords.some(record=>record.values.judgment==='safe'),false);
  await assert.rejects(()=>f.provider.raw(f.key,saved.commitId,'.oxenweb/dataset/legacy-labels/'+datasetHash(old.labelRecords[0])+'.json'),(error:any)=>error.status===404);
  await assert.rejects(()=>service.page(f.key,'main',{filters:[{column:'legacy.label.judgment',operator:'eq',value:'safe'}]}),(error:any)=>error.code==='QUERY_UNKNOWN_COLUMN');assert.equal((await service.page(f.key,'main',{filters:[{column:'label.judgment',operator:'eq',value:'risk'}]})).matchedRows,1);
  assert.deepEqual((await f.provider.raw(f.key,saved.commitId,saved.path)).content,(await f.provider.raw(f.key,f.snapshot.commitId,f.snapshot.path)).content);
});

test('a sample appended then edited inside one durable draft keeps its new stable identity after commit',async t=>{
  const f=await fixture(t),rowId='new:synthetic-durable-identity';const state=await f.drafts.save(f.key,owner,{ref:'main',expectedCommit:f.snapshot.commitId,draftRevision:0,operations:[{op:'append',rowId,record:{text:'initial synthetic content'}},{op:'update',rowId,record:{text:'edited synthetic content'}}]});
  const preview=await f.drafts.page(f.key,owner,'main',{sample:rowId});assert.equal(preview.rowIds.includes(rowId),true);assert.equal(preview.rows.find((_,index)=>preview.rowIds[index]===rowId)?.text,'edited synthetic content');
  await f.drafts.commit(f.key,owner,{ref:'main',expectedCommit:f.snapshot.commitId,draftRevision:state.draft!.draftRevision,expectedDraftId:state.draft!.id,message:'Append and edit once'});
  const current=await new DatasetService(f.provider).read(f.key,'main');assert.equal(current.rowIds.includes(rowId),true);assert.equal(current.totalRows,f.snapshot.totalRows+1);assert.deepEqual(current.rows[current.rowIds.indexOf(rowId)],{text:'edited synthetic content'});
});


test('explicit project-label synchronization preserves saved and newer unsaved edits without a workspace or commit',async t=>{
  const f=await fixture(t),rowId=f.snapshot.rowIds[0]!,base=f.snapshot.commitId,original=(await f.provider.raw(f.key,base,f.snapshot.path)).content;
  const stored=(await f.drafts.save(f.key,owner,{ref:'main',expectedCommit:base,draftRevision:0,operations:[{op:'update',rowId,record:{...f.snapshot.rows[0],text:'previous saved edit'},expectedContentHash:f.snapshot.contentHashes[rowId]}]})).draft!;
  const latest=await f.service.save(f.key,owner,{ref:'main',expectedCommit:base,message:'Only project labels changed',operations:[{op:'assign',scope:'dataset',values:{context:'New project metadata'}}]});
  assert.equal((await f.drafts.read(f.key,owner,'main')).issue?.code,'DATASET_VERSION_CONFLICT');assert.equal((await f.drafts.export(f.key,owner,'main')).draft?.operations.length,1);
  const before=(await f.provider.commits(f.key,'main')).length;let workspaces=0;const create=f.provider.createWorkspace.bind(f.provider);f.provider.createWorkspace=async(...args)=>{workspaces++;return create(...args);};
  const operations:DatasetOperation[]=[{op:'update',rowId,record:{...f.snapshot.rows[0],text:'Newest unsaved edit'},expectedContentHash:f.snapshot.contentHashes[rowId]},{op:'assign',scope:'row',rowId:f.snapshot.rowIds[1],values:{judgment:'safe'}}];
  const rebased=(await f.drafts.rebase(f.key,owner,{ref:'main',expectedBaseCommit:base,expectedCommit:latest.commitId,draftRevision:stored.draftRevision,expectedDraftId:stored.id,operations})).draft!;
  assert.equal(rebased.baseCommit,latest.commitId);assert.equal(rebased.id,stored.id);assert.equal(rebased.draftRevision,stored.draftRevision+1);assert.deepEqual(rebased.operations,operations);assert.equal(workspaces,0);assert.equal((await f.provider.commits(f.key,'main')).length,before);
  assert.equal((await f.drafts.page(f.key,owner,'main')).rows[0]!.text,'Newest unsaved edit');
  await f.drafts.commit(f.key,owner,{ref:'main',expectedCommit:latest.commitId,draftRevision:rebased.draftRevision,expectedDraftId:rebased.id,message:'One sample commit after explicit metadata synchronization'});
  assert.equal(workspaces,1);assert.equal((await f.provider.commits(f.key,'main')).length,before+1);assert.deepEqual((await f.provider.raw(f.key,(await f.provider.branches(f.key))[0]!.commitId,f.snapshot.path)).content,original);
});

test('explicit synchronization can persist previously unsaved operations, while an explicit empty set clears only that own draft',async t=>{
  const f=await fixture(t),base=f.snapshot.commitId;
  let latest=await f.service.save(f.key,owner,{ref:'main',expectedCommit:base,message:'Metadata version one',operations:[{op:'assign',scope:'dataset',values:{context:'one'}}]});
  const state=await f.drafts.rebase(f.key,owner,{ref:'main',expectedBaseCommit:base,expectedCommit:latest.commitId,draftRevision:0,operations:[{op:'update',rowId:f.snapshot.rowIds[0]!,record:{...f.snapshot.rows[0],text:'Never saved before synchronization'}}]});
  assert.equal(state.draft?.draftRevision,1);assert.equal(state.draft?.baseCommit,latest.commitId);
  latest=await f.service.save(f.key,owner,{ref:'main',expectedCommit:latest.commitId,message:'Metadata version two',operations:[{op:'assign',scope:'dataset',values:{context:'two'}}]});
  const count=(await f.provider.commits(f.key,'main')).length;
  assert.deepEqual(await f.drafts.rebase(f.key,owner,{ref:'main',expectedBaseCommit:state.draft!.baseCommit,expectedCommit:latest.commitId,draftRevision:state.draft!.draftRevision,expectedDraftId:state.draft!.id,operations:[]}),{});
  assert.deepEqual(await f.drafts.read(f.key,owner,'main'),{});assert.equal((await f.provider.commits(f.key,'main')).length,count);
});

test('synchronization rejects non-label advances, stale tabs, dataset assignments and non-ancestor bases without replacing the draft',async t=>{
  const f=await fixture(t),base=f.snapshot.commitId,rowId=f.snapshot.rowIds[0]!;
  const stored=(await f.drafts.save(f.key,owner,{ref:'main',expectedCommit:base,draftRevision:0,operations:[{op:'assign',scope:'row',rowId,values:{judgment:'safe'}}]})).draft!;
  const labels=await f.service.save(f.key,owner,{ref:'main',expectedCommit:base,message:'Project metadata advance',operations:[{op:'assign',scope:'dataset',values:{context:'metadata'}}]});
  const input={ref:'main',expectedBaseCommit:base,expectedCommit:labels.commitId,draftRevision:stored.draftRevision,expectedDraftId:stored.id};
  await assert.rejects(()=>f.drafts.rebase(f.key,owner,{...input,expectedDraftId:'00000000-0000-4000-8000-000000000000'}),(error:any)=>error.code==='DATASET_DRAFT_REVISION_CONFLICT');
  await assert.rejects(()=>f.drafts.rebase(f.key,owner,{...input,operations:[{op:'assign',scope:'dataset',values:{context:'must not merge project labels'}}]}),(error:any)=>error.code==='DATASET_DRAFT_REBASE_DATASET_ASSIGNMENT');
  const changed=await f.service.save(f.key,owner,{ref:'main',expectedCommit:labels.commitId,message:'Real sample changed',operations:[{op:'update',rowId:f.snapshot.rowIds[1]!,record:{...f.snapshot.rows[1],text:'A real source overlay changed'}}]});
  await assert.rejects(()=>f.drafts.rebase(f.key,owner,{...input,expectedCommit:changed.commitId}),(error:any)=>error.code==='DATASET_DRAFT_REBASE_UNSUPPORTED');
  assert.deepEqual((await f.drafts.export(f.key,owner,'main')).draft,stored);
  await f.provider.createBranch(f.key,'sibling',base);const sibling=await f.service.save(f.key,owner,{ref:'sibling',expectedCommit:base,message:'Sibling metadata',operations:[{op:'assign',scope:'dataset',values:{context:'sibling'}}]});
  const rawDiff=f.provider.diff.bind(f.provider);f.provider.diff=async()=>[{path:'.oxenweb/dataset/dataset-labels.json',status:'modified'}];
  await assert.rejects(()=>f.drafts.rebase(f.key,owner,{...input,expectedCommit:changed.commitId}),(error:any)=>error.code==='DATASET_DRAFT_SOURCE_CHANGED');
  await assert.rejects(()=>f.drafts.rebase(f.key,other,{ref:'main',expectedBaseCommit:sibling.commitId,expectedCommit:changed.commitId,draftRevision:0,operations:stored.operations}),(error:any)=>error.code==='DATASET_DRAFT_REBASE_ANCESTRY');
  f.provider.diff=rawDiff;
});

test('synchronization revalidates write privileges, task range and source hashes before changing private state',async t=>{
  const f=await fixture(t),base=f.snapshot.commitId,rowId=f.snapshot.rowIds[0]!,stored=(await f.drafts.save(f.key,owner,{ref:'main',expectedCommit:base,draftRevision:0,operations:[{op:'update',rowId,record:{...f.snapshot.rows[0],text:'private'}}]})).draft!;
  const latest=await f.service.save(f.key,owner,{ref:'main',expectedCommit:base,message:'Project metadata only',operations:[{op:'assign',scope:'dataset',values:{context:'metadata'}}]});
  const input={ref:'main',expectedBaseCommit:base,expectedCommit:latest.commitId,draftRevision:stored.draftRevision,expectedDraftId:stored.id};
  const denied=new DatasetDraftService(new DatasetService(f.provider,{authorize:async()=>{throw new ApiError(403,'TEST_REVOKED','Synthetic revoked writer');}}),f.draftDirectory);
  await assert.rejects(()=>denied.rebase(f.key,owner,input),(error:any)=>error.code==='TEST_REVOKED');
  const outside=new DatasetDraftService(new DatasetService(f.provider,{beforeWrite:async()=>{throw new ApiError(403,'TASK_ROW_DENIED','Synthetic task range revoked');}}),f.draftDirectory);
  await assert.rejects(()=>outside.rebase(f.key,owner,input),(error:any)=>error.code==='TASK_ROW_DENIED');
  await assert.rejects(()=>f.drafts.rebase(f.key,owner,{...input,operations:[{op:'update',rowId,expectedContentHash:'wrong-source-hash',record:{...f.snapshot.rows[0],text:'private'}}]}),(error:any)=>error.code==='DATASET_CONTENT_CONFLICT');
  assert.deepEqual((await f.drafts.export(f.key,owner,'main')).draft,stored);
});

test('stale draft export is identity isolated and still requires current project read authorization',async t=>{
  const f=await fixture(t),base=f.snapshot.commitId,stored=(await f.drafts.save(f.key,owner,{ref:'main',expectedCommit:base,draftRevision:0,operations:[{op:'assign',scope:'row',rowId:f.snapshot.rowIds[0],values:{judgment:'risk'}}]})).draft!;
  await f.service.save(f.key,owner,{ref:'main',expectedCommit:base,message:'Metadata only export fixture',operations:[{op:'assign',scope:'dataset',values:{context:'new'}}]});
  const app=Fastify();t.after(()=>app.close());app.setErrorHandler((error,_request,reply)=>reply.code(error instanceof ApiError?error.status:500).send({error:{code:error instanceof ApiError?error.code:'ERROR'}}));
  app.addHook('onRequest',async request=>{request.oxenIdentity=request.headers['x-test-identity']==='other'?other:request.headers['x-test-identity']==='guest'?{...owner,kind:'guest'}:owner;});
  registerDatasetDraftRoutes(app,f.service,{directory:f.draftDirectory,service:f.drafts,access:{require:async(_key,_identity)=>{},requireCapability:async()=>{}}});
  const url='/api/repos/'+f.key.namespace+'/'+f.key.repo+'/dataset/draft/export?ref=main';
  let response=await app.inject(url);assert.equal(response.statusCode,200);assert.deepEqual(response.json().draft,stored);assert.equal(response.headers['cache-control'],'no-store');
  response=await app.inject({url,headers:{'x-test-identity':'other'}});assert.equal(response.statusCode,404);response=await app.inject({url,headers:{'x-test-identity':'guest'}});assert.equal(response.statusCode,401);
  const denied=Fastify();t.after(()=>denied.close());denied.setErrorHandler((error,_request,reply)=>reply.code(error instanceof ApiError?error.status:500).send({error:{code:error instanceof ApiError?error.code:'ERROR'}}));denied.addHook('onRequest',async request=>{request.oxenIdentity=owner;});registerDatasetDraftRoutes(denied,f.service,{directory:f.draftDirectory,service:f.drafts,access:{require:async()=>{throw new ApiError(403,'READ_REVOKED','Synthetic reader revoked');}}});
  response=await denied.inject(url);assert.equal(response.statusCode,403);assert.equal(response.json().draft,undefined);
});
