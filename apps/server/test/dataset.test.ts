import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { DatasetService, datasetHash } from '../src/dataset.js';
import { DemoProvider } from '../src/demo.js';
import { LabelService } from '../src/labels.js';
import {labelFingerprint,labelRecordPath,legacyLabelRecordPath} from '../src/dataset-storage.js';
import type {DatasetLabelRecord} from '../../../packages/shared/src/dataset.js';
import { projectRoot } from '../src/config.js';
import type { LabelColumn, RequestIdentity } from '../../../packages/shared/src/index.js';
const owner:RequestIdentity={id:'owner',name:'Owner',kind:'owner',source:'local'};
const columns:LabelColumn[]=[{id:'judgment',name:'判定',type:'single',options:[{value:'safe'},{value:'risk'}]},{id:'note',name:'备注',type:'text'}];
async function setup(t:{after:(work:()=>Promise<void>)=>void}){
  const root=path.resolve(projectRoot,'.data/tests');await mkdir(root,{recursive:true});const directory=await mkdtemp(path.join(root,'dataset-'));
  t.after(async()=>{const target=path.resolve(directory);if(!target.startsWith(root+path.sep))throw new Error('test cleanup escaped workspace');await rm(target,{recursive:true,force:true});});
  const provider=new DemoProvider(path.join(directory,'state.json'));await provider.init();const key={namespace:'oxen',repo:'dataset-test'};await provider.createRepo({...key,name:key.repo,description:'Synthetic dataset tests'});
  const service=new DatasetService(provider),head=(await provider.branches(key))[0]!.commitId;
  const snapshot=await service.initialize(key,owner,{ref:'main',expectedCommit:head,rows:[{id:'first',text:'A😀BC',ground_truth:{result:'source'}},{id:'second',text:'other',steps:[{tool:'fixture',value:true}]}],labels:{version:1,columns,assignments:[{id:'dataset',scope:'dataset',values:{note:'source dataset context'}}]}});
  return {provider,key,service,snapshot};
}
test('sample overlay preserves baseline, original ground truth, stable IDs and branch snapshots',async t=>{
  const {provider,key,service,snapshot}=await setup(t),id=snapshot.rowIds[0]!,baseline=(await provider.raw(key,snapshot.commitId,snapshot.path)).content.toString();
  await provider.createBranch(key,'other',snapshot.commitId);
  const changed=await service.save(key,owner,{ref:'main',expectedCommit:snapshot.commitId,message:'Edit synthetic sample',operations:[{op:'update',rowId:id,record:{...snapshot.rows[0],text:'changed'},expectedContentHash:snapshot.contentHashes[id]}]});
  assert.equal(changed.rows[0]!.text,'changed');assert.deepEqual(changed.rows[0]!.ground_truth,{result:'source'});assert.equal(changed.rowIds[0],id);
  assert.equal((await provider.raw(key,changed.commitId,snapshot.path)).content.toString(),baseline);
  assert.equal((await service.read(key,'other')).rows[0]!.text,'A😀BC');assert.equal((await service.read(key,snapshot.commitId)).rows[0]!.text,'A😀BC');
  await assert.rejects(()=>service.save(key,owner,{ref:'main',expectedCommit:snapshot.commitId,message:'stale',operations:[{op:'delete',rowId:id}]}),(error:any)=>error.code==='DATASET_VERSION_CONFLICT');
});

test('inline body editing cannot change existing source truth or identity and rejects before workspace creation',async t=>{
  const {provider,key,service,snapshot}=await setup(t),before=await provider.workspaces(key),rowId=snapshot.rowIds[0]!;
  for(const [field,value]of [['ground_truth',{result:'forged'}],['id','changed-id'],['uid','added-identity']] as const){
    await assert.rejects(()=>service.save(key,owner,{ref:'main',expectedCommit:snapshot.commitId,message:'Forbidden inline fixture',operations:[{op:'update',rowId,record:{...snapshot.rows[0],[field]:value},expectedContentHash:snapshot.contentHashes[rowId]}]}),(error:any)=>['DATASET_IDENTITY_READONLY','DATASET_SOURCE_TRUTH_READONLY'].includes(error.code));
  }
  assert.deepEqual(await provider.workspaces(key),before);assert.equal((await provider.branches(key)).find(item=>item.name==='main')!.commitId,snapshot.commitId);
});

test('copy append checks custom business identity and UID duplicates across the entire dataset',async t=>{
  const {provider}=await setup(t),key={namespace:'oxen',repo:'copy-identity'};await provider.createRepo({...key,name:key.repo,description:'Synthetic copy identity'});
  const service=new DatasetService(provider),snapshot=await service.initialize(key,owner,{ref:'main',expectedCommit:(await provider.branches(key))[0]!.commitId,descriptor:{identityField:'business_key'},rows:[{id:'a',business_key:'key-a',UID:'uid-a',text:'synthetic'}]});
  for(const record of [{id:'b',business_key:'key-a',UID:'uid-b'},{id:'b',business_key:'key-b',UID:'uid-a'}])await assert.rejects(()=>service.save(key,owner,{ref:'main',expectedCommit:snapshot.commitId,message:'Duplicate copied identity',operations:[{op:'append',rowId:'new:copied',record}]}),(error:any)=>error.code==='DATASET_DUPLICATE_ID');
  const changed=await service.save(key,owner,{ref:'main',expectedCommit:snapshot.commitId,message:'Unique copied identity',operations:[{op:'append',rowId:'new:unique',record:{id:'b',business_key:'key-b',UID:'uid-b',text:'new content'}}]});
  assert.equal(changed.totalRows,2);assert.ok(changed.rowIds.includes('new:unique'));
});
test('row, file and dataset labels use independent records and old route reads without overwriting them',async t=>{
  const {provider,key,service,snapshot}=await setup(t),id=snapshot.rowIds[0]!,legacy=(await provider.raw(key,snapshot.commitId,'.oxenweb/labels.json')).content.toString();
  const changed=await service.save(key,owner,{ref:'main',expectedCommit:snapshot.commitId,message:'Assign three scopes',operations:[{op:'assign',scope:'row',rowId:id,values:{judgment:'risk'},spans:[{id:'emoji',pointer:'/text',sourceHash:datasetHash('A😀BC'),start:1,end:2,values:{judgment:'risk'}}]},{op:'assign',scope:'file',path:snapshot.path,values:{note:'file context'}},{op:'assign',scope:'dataset',values:{note:'new dataset context'}}]});
  assert.equal(changed.labelRecords.length,3);assert.ok(changed.labelRecords.every(record=>record.actor.id==='owner'&&record.fingerprint.length===64&&record.templateSnapshot.columns.length===2));
  assert.equal(changed.labels.assignments.find(record=>record.scope==='row')?.values.judgment,'risk');
  assert.equal((await provider.raw(key,changed.commitId,'.oxenweb/labels.json')).content.toString(),legacy);
  const labels=new LabelService(provider);assert.equal((await labels.read(key,'main')).assignments.find(record=>record.scope==='row')?.values.judgment,'risk');
  await assert.rejects(()=>labels.assign(key,'main',changed.commitId,{scope:'row',path:snapshot.path,rowId:id,values:{judgment:'safe'}}),(error:any)=>error.code==='LABEL_DATASET_WORKBENCH_REQUIRED');
  await assert.rejects(()=>service.save(key,owner,{ref:'main',expectedCommit:changed.commitId,message:'invalid range',operations:[{op:'assign',scope:'row',rowId:id,values:{},spans:[{id:'bad',pointer:'/text',sourceHash:datasetHash('A😀BC'),start:1,end:5,values:{judgment:'risk'}}]}]}),(error:any)=>error.code==='DATASET_SPAN_RANGE');
});
test('independent actor disagreements stay visible and deleted-row labels remain in audit only',async t=>{
  const {key,service,snapshot}=await setup(t),id=snapshot.rowIds[0]!;
  let current=await service.save(key,owner,{ref:'main',expectedCommit:snapshot.commitId,message:'first opinion',operations:[{op:'assign',scope:'row',rowId:id,values:{judgment:'safe'}}]});
  current=await service.save(key,{...owner,id:'second-actor',name:'Second actor'},{ref:'main',expectedCommit:current.commitId,message:'second opinion',operations:[{op:'assign',scope:'row',rowId:id,values:{judgment:'risk'}}]});
  assert.equal(current.labelConflicts.length,1);assert.equal(current.labelRecords.length,2);assert.equal(current.labels.assignments.find(record=>record.scope==='row')?.values.judgment,undefined);
  current=await service.save(key,owner,{ref:'main',expectedCommit:current.commitId,message:'tombstone',operations:[{op:'delete',rowId:id}]});
  assert.equal(current.totalRows,1);assert.equal(current.labels.assignments.filter(record=>record.scope==='row').length,0);assert.equal(current.orphanAssignments.length,1);assert.equal(current.labelRecords.length,2);
});
test('complete-table label filters and namespaced search keep real totals across pages',async t=>{
  const {key,service,snapshot}=await setup(t),id=snapshot.rowIds[1]!;
  await service.save(key,owner,{ref:'main',expectedCommit:snapshot.commitId,message:'set label',operations:[{op:'assign',scope:'row',rowId:id,values:{judgment:'risk'}}]});
  const all=await service.page(key,'main',{page:2,pageSize:1});assert.equal(all.totalRows,2);assert.equal(all.matchedRows,2);assert.equal(all.rows.length,1);
  const filtered=await service.page(key,'main',{filters:[{column:'label.judgment',operator:'eq',value:'risk'}],pageSize:1});assert.equal(filtered.matchedRows,1);assert.equal(filtered.rowIds[0],id);
  const dataset=await service.page(key,'main',{filters:[{column:'dataset.note',operator:'contains',value:'context'}]});assert.equal(dataset.matchedRows,2);
});
test('authorization hooks cover row and dataset scopes before any workspace write',async t=>{
  const {provider,key,snapshot}=await setup(t),calls:any[]=[];
  const service=new DatasetService(provider,{authorize:async()=>{},beforeWrite:async(...args)=>{calls.push(args);if(args[4]==='edit-dataset-labels')throw new Error('dataset denied');}});
  const count=(await provider.workspaces(key)).length;
  await assert.rejects(()=>service.save(key,owner,{ref:'main',expectedCommit:snapshot.commitId,message:'denied',operations:[{op:'assign',scope:'dataset',values:{note:'no'}}]}),/dataset denied/);
  assert.equal((await provider.workspaces(key)).length,count);assert.equal(calls[0][5].scope,'dataset');
});
test('portable initialization preserves explicit stable identities without injecting record fields',async t=>{
  const {provider}=await setup(t),key={namespace:'oxen',repo:'portable'};await provider.createRepo({...key,name:key.repo,description:'portable fixture'});const service=new DatasetService(provider),head=(await provider.branches(key))[0]!.commitId;
  const current=await service.initialize(key,owner,{ref:'main',expectedCommit:head,rows:[{original:'unchanged'}],rowIds:['portable-stable-id']});assert.deepEqual(current.rows,[{original:'unchanged'}]);assert.deepEqual(current.rowIds,['portable-stable-id']);
});
test('span and step filters scan valid anchored annotations and ignore stale spans after edits',async t=>{
  const {key,service,snapshot}=await setup(t),first=snapshot.rowIds[0]!,second=snapshot.rowIds[1]!;
  let current=await service.save(key,owner,{ref:'main',expectedCommit:snapshot.commitId,message:'fine targets',operations:[{op:'assign',scope:'row',rowId:first,values:{},spans:[{id:'span',pointer:'/text',sourceHash:datasetHash('A😀BC'),start:1,end:2,values:{judgment:'risk'},note:'synthetic evidence marker'}]},{op:'assign',scope:'row',rowId:second,values:{},steps:[{id:'step',pointer:'/steps/0',sourceHash:datasetHash({tool:'fixture',value:true}),values:{judgment:'safe'}}]}]});
  assert.equal((await service.page(key,'main',{filters:[{column:'span.judgment',operator:'eq',value:'risk'}]})).matchedRows,1);
  assert.equal((await service.page(key,'main',{filters:[{column:'step.judgment',operator:'eq',value:'safe'}]})).rowIds[0],second);
  assert.equal((await service.page(key,'main',{search:'synthetic evidence marker'})).rowIds[0],first);
  current=await service.save(key,owner,{ref:'main',expectedCommit:current.commitId,message:'invalidate anchor',operations:[{op:'update',rowId:first,record:{...current.rows[0],text:'different'}}]});
  assert.equal((await service.page(key,'main',{filters:[{column:'span.judgment',operator:'eq',value:'risk'}]})).matchedRows,0);
  assert.equal(current.labelRecords.find(record=>record.rowId===first)?.spans.length,1);
});
test('workbench count queries use the full table rather than the legacy 100/500 row result cap',async t=>{
  const {provider}=await setup(t),key={namespace:'oxen',repo:'query-large'};await provider.createRepo({...key,name:key.repo,description:'synthetic count'});const service=new DatasetService(provider),head=(await provider.branches(key))[0]!.commitId;
  await service.initialize(key,owner,{ref:'main',expectedCommit:head,rows:Array.from({length:1201},(_,index)=>({id:`row-${index}`,text:'synthetic'}))});
  const result=await service.page(key,'main',{prompt:'总数多少',pageSize:50,page:3});assert.equal(result.totalRows,1201);assert.equal(result.matchedRows,1201);assert.equal(result.rows.length,50);assert.equal(result.page,3);
});
test('initialization cannot use README or attachment mappings to overwrite protected policy files',async t=>{
  const {provider}=await setup(t),key={namespace:'oxen',repo:'protected-import'};await provider.createRepo({...key,name:key.repo,description:'synthetic protected paths'});const service=new DatasetService(provider),head=(await provider.branches(key))[0]!.commitId;
  await assert.rejects(()=>service.initialize(key,owner,{ref:'main',expectedCommit:head,rows:[{id:'one'}],readme:'{}',descriptor:{readmePath:'.oxenweb/repository.json'}}),(error:any)=>error.code==='DATASET_IMPORT_PATH');
  await assert.rejects(()=>service.initialize(key,owner,{ref:'main',expectedCommit:head,rows:[{id:'one'}],files:[{path:'.OXENWEB/repository.json',content:Buffer.from('{}')}]}),(error:any)=>error.code==='DATASET_IMPORT_PATH');
  assert.equal((await provider.branches(key))[0]!.commitId,head);assert.equal((await provider.workspaces(key)).length,0);
});
test('file labels cannot smuggle a rowId to bypass full-file task authorization',async t=>{
  const {provider,key,snapshot}=await setup(t),calls:any[]=[];const service=new DatasetService(provider,{authorize:async()=>{},beforeWrite:async(...args)=>{calls.push(args);}});
  await assert.rejects(()=>service.save(key,owner,{ref:'main',expectedCommit:snapshot.commitId,message:'forged file scope',operations:[{op:'assign',scope:'file',path:snapshot.path,rowId:snapshot.rowIds[0],values:{note:'forged'}}]}),(error:any)=>error.code==='LABEL_SCOPE_INVALID');
  assert.equal(calls.length,0);
  await service.save(key,owner,{ref:'main',expectedCommit:snapshot.commitId,message:'legitimate file scope',operations:[{op:'assign',scope:'file',path:snapshot.path,values:{note:'whole resource'}}]});
  assert.deepEqual(calls[0][3],snapshot.rowIds);assert.equal(calls[0][4],'edit-file-labels');
});
test('unknown filters and empty numeric comparisons fail rather than silently matching unrelated rows',async t=>{
  const {key,service}=await setup(t);
  await assert.rejects(()=>service.page(key,'main',{filters:[{column:'label.missing_column',operator:'eq',value:''}]}),(error:any)=>error.code==='QUERY_UNKNOWN_COLUMN');
  await assert.rejects(()=>service.page(key,'main',{filters:[{column:'data.missing_column',operator:'unset'}]}),(error:any)=>error.code==='QUERY_UNKNOWN_COLUMN');
  await assert.rejects(()=>service.page(key,'main',{filters:[{column:'data.id',operator:'gt',value:''}]}),(error:any)=>error.code==='QUERY_NUMBER_REQUIRED');
});
test('model pagination reuses a fixed query result and aggregate rows remain distinct from editable samples',async t=>{
  const {provider,key}=await setup(t);let calls=0;
  const service=new DatasetService(provider,{queryModel:async(table,prompt)=>{calls++;return prompt==='count'?{engine:'codex-plan',columns:[{name:'count',dtype:'integer'}],rows:[{count:table.rows!.length}],totalRows:1,explanation:'Synthetic aggregate'}:{engine:'codex-plan',columns:table.columns!,rows:[...table.rows!].reverse(),totalRows:table.rows!.length,explanation:'Synthetic fixed sorted result'};}});
  const first=await service.page(key,'main',{engine:'model',prompt:'sort',allowExternalSchema:true,page:1,pageSize:1}),second=await service.page(key,'main',{engine:'model',prompt:'sort',allowExternalSchema:true,page:2,pageSize:1});assert.equal(calls,1);assert.equal(first.rows[0]!.id,'second');assert.equal(second.rows[0]!.id,'first');
  const count=await service.page(key,'main',{engine:'model',prompt:'count',allowExternalSchema:true});assert.equal(count.queryResult?.rows[0]?.count,2);assert.equal(count.rows.length,2);assert.deepEqual(count.rowIds,(await service.read(key,'main')).rowIds);
  await assert.rejects(()=>service.page(key,'main',{engine:'model',prompt:'count',allowExternalSchema:false}),(error:any)=>error.code==='QUERY_SCHEMA_CONSENT_REQUIRED');assert.equal(calls,2);
});
test('short SHA256 label paths prefer current records while retaining old dual-hash audit',async t=>{
  const {provider,key,service,snapshot}=await setup(t),rowId=snapshot.rowIds[0]!,target={scope:'row' as const,path:snapshot.path,rowId};
  const old:DatasetLabelRecord={version:1,...target,actor:{id:owner.id,name:owner.name},values:{judgment:'safe'},spans:[],steps:[],sourceCommitId:snapshot.commitId,contentHash:snapshot.contentHashes[rowId],updatedAt:new Date().toISOString(),fingerprint:'',templateSnapshot:{columns}};old.fingerprint=labelFingerprint(old);
  const oldPath=legacyLabelRecordPath(target,owner.id),oldBytes=Buffer.from(JSON.stringify(old));const workspace=await provider.createWorkspace(key,'Legacy dual-hash label','main');await provider.writeWorkspace(key,workspace.id,oldPath,oldBytes);const oldCommit=await provider.commitWorkspace(key,workspace.id,'Synthetic legacy record');await provider.deleteWorkspace(key,workspace.id);
  const previous=await service.read(key,oldCommit.id);assert.equal(previous.labelRecords.length,1);assert.equal(previous.labels.assignments.find(item=>item.scope==='row')?.values.judgment,'safe');
  const current=await service.save(key,owner,{ref:'main',expectedCommit:oldCommit.id,message:'Use short canonical path',operations:[{op:'assign',scope:'row',rowId,values:{note:'preserve legacy value'}}]});
  assert.equal(path.posix.basename(labelRecordPath(target,owner.id)).length,69);assert.equal(current.labelRecords.length,1);assert.deepEqual(current.labelRecords[0]!.values,{judgment:'safe',note:'preserve legacy value'});assert.equal(current.supersededLabelRecords?.length,1);assert.equal(current.supersededLabelRecords?.[0]?.path,oldPath);assert.equal(current.labelConflicts.length,0);assert.deepEqual((await provider.raw(key,current.commitId,oldPath)).content,oldBytes);
});
