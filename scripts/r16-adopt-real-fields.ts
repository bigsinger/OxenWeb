/** Four explicitly authorized real projects; local schema adoption only. Never assigns sample values. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {lstat,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {loadConfig,projectRoot} from '../apps/server/src/config.js';
import {canonicalJson,datasetHash} from '../apps/server/src/dataset-storage.js';
import {adoptGlobalFieldMetadata,GLOBAL_DATASET_FIELD_IDS,type GlobalFieldCatalogState,type GlobalFieldSynchronizationResult} from '../packages/shared/src/global-fields.js';
import type {DatasetPage} from '../packages/shared/src/dataset.js';
import type {DatasetFieldsState} from '../packages/shared/src/dataset-field-types.js';
import {workbenchHasUnfinishedInput,sampleFieldCheckpointHasUnfinishedInput} from './analysis/field-adoption-inputs.js';

const targets=[{namespace:'local',repo:'benchmark-sensitive-data',rows:2000},{namespace:'local',repo:'benchmark-prompt-injection',rows:2000},{namespace:'local',repo:'benchmark-skills',rows:1000},{namespace:'local',repo:'benchmark-behavior-drift',rows:1719}] as const;
let runDirectory='',stage='startup';
const execute=process.argv.includes('--execute'),sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const hash=(value:unknown)=>sha(canonicalJson(value));
const own=(value:unknown):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value);
async function optionalJson(filename:string){try{const bytes=await readFile(filename);assert.ok(bytes.length<=64*1024*1024,'Control file over bounded reading limit');return JSON.parse(bytes.toString('utf8'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}}
async function privateJson(directory:string,name:string,value:unknown){assert.equal(path.dirname(path.resolve(directory,name)),path.resolve(directory));await writeFile(path.join(directory,name),JSON.stringify(value,null,2)+'\n',{mode:0o600});}
async function checkedFiles(root:string):Promise<string[]>{
  const result:string[]=[];
  async function walk(directory:string){let entries;try{entries=await readdir(directory,{withFileTypes:true});}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
    for(const entry of entries){const filename=path.join(directory,entry.name),relative=path.relative(root,filename);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));const stat=await lstat(filename);assert.equal(stat.isSymbolicLink(),false,'Control-state links require manual inspection');if(stat.isDirectory())await walk(filename);else{assert.equal(stat.isFile(),true);assert.ok(stat.size<=24*1024*1024+4096,'Private draft exceeds bounded reader');if(entry.name.endsWith('.json'))result.push(filename);}}
  }await walk(root);return result.sort();
}
/** Inspect metadata locally; never print or copy private record bodies into the receipt. */
async function controlPreflight(controlRoot:string,target:typeof targets[number]){
  const key={namespace:target.namespace,repo:target.repo},draftRoot=path.join(controlRoot,'dataset-drafts',datasetHash(key)),uiRoot=path.join(controlRoot,'dataset-ui-state',datasetHash(key));
  let pendingDrafts=0,pendingWorkbenchInputs=0,pendingFieldInputs=0,mainCheckpoints=0;const fileDigests:Array<[string,string]>=[];
  for(const [type,root] of [['draft',draftRoot],['ui',uiRoot]] as const)for(const filename of await checkedFiles(root)){
    const bytes=await readFile(filename),document=JSON.parse(bytes.toString('utf8'));assert.equal(document.version,1,'Unknown private state envelope');assert.equal(document.namespace,target.namespace);assert.equal(document.repo,target.repo);fileDigests.push([type+'/'+path.relative(root,filename).replaceAll('\\','/'),sha(bytes)]);
    if(type==='draft'){assert.ok(own(document.draft)&&Array.isArray(document.draft.operations),'Unknown draft format');if(document.draft.ref==='main'&&document.draft.operations.length)pendingDrafts++;continue;}
    assert.ok(own(document.state),'Unknown UI checkpoint format');if(document.state.ref!=='main')continue;mainCheckpoints++;const payload=document.state.payload;
    if(document.state.kind==='workbench'){
      if(workbenchHasUnfinishedInput(payload))pendingWorkbenchInputs++;
    }else if(document.state.kind==='field-settings'){
      if(sampleFieldCheckpointHasUnfinishedInput(payload))pendingFieldInputs++;
    }
  }
  const tasks=await optionalJson(path.join(controlRoot,'annotation-tasks.json'));if(tasks!==undefined)assert.ok(tasks.version===1&&Array.isArray(tasks.tasks),'Unknown annotation-task control file');
  const related=(tasks?.tasks??[]).filter((task:any)=>task.namespace===target.namespace&&task.repo===target.repo),activeTasks=related.filter((task:any)=>!['merged','cancelled','setup-failed'].includes(task.status)).length;
  const result={pendingDrafts,pendingWorkbenchInputs,pendingFieldInputs,mainCheckpoints,activeTasks,privateStateHash:hash(fileDigests)};
  assert.equal(pendingDrafts+pendingWorkbenchInputs+pendingFieldInputs+activeTasks,0,`Unfinished drafts, form inputs or annotation tasks: ${target.namespace}/${target.repo}`);
  return result;
}

async function main(){
  for(const file of ['.env','infra/oxen/local.env'])try{process.loadEnvFile(path.join(projectRoot,file));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const config=loadConfig();assert.equal(config.demo,false);assert.equal(config.port,3001);assert.equal(new URL(config.upstream!).port,'3002');assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(config.upstream!).hostname));
  const origin='http://127.0.0.1:3001',auth={...(config.token?{authorization:'Bearer '+config.token}:{}),'x-oxen-request':'web'},controlRoot=path.dirname(config.demoFile),requestCounts={GET:0,POST:0},operationId=randomUUID();
  const call=async<T=any>(url:string,body?:unknown):Promise<T>=>{
    const method=body===undefined?'GET':'POST';if(method==='POST'){assert.equal(execute,true,'Plan denies HTTP mutation');assert.equal(url,'/api/global-fields/synchronize','Only explicit global field adoption is allowed');requestCounts.POST++;}else requestCounts.GET++;
    const response=await fetch(origin+url,{method,headers:{...auth,...(body===undefined?{}:{'content-type':'application/json','x-operation-id':operationId})},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(240000)}),text=await response.text();let value:any;try{value=JSON.parse(text);}catch{throw Error(`Unexpected local response ${response.status}`);}
    assert.equal(response.ok,true,`Local ${method} ${url.split('?')[0]} failed (${response.status}, ${value?.error?.code??'response'})`);return value as T;
  };
  const raw=async(base:string,ref:string,filename:string)=>{requestCounts.GET++;const response=await fetch(origin+base+'/raw?'+new URLSearchParams({ref,path:filename}),{headers:auth,redirect:'error',signal:AbortSignal.timeout(240000)});assert.equal(response.status,200,'Fixed source could not be read');return Buffer.from(await response.arrayBuffer());};
  const health=await call('/api/health');assert.equal(health.ready,true);assert.equal(health.mode,'live');assert.equal(health.runtime.acceptsWrites,true);assert.equal(health.pendingReconciliation,false,'Resolve unknown previous writes before real schema adoption');
  const status=await call('/api/status');assert.equal(status.identity.kind,'owner','Real schema adoption requires the active instance owner');
  const catalog=await call<GlobalFieldCatalogState>('/api/global-fields/catalog');assert.equal(catalog.canManage,true);assert.equal(catalog.catalog.fields.find(field=>field.id==='purposes')!.type,'multi');
  const directory=path.join(projectRoot,'.data/r16-real-fields','run-'+new Date().toISOString().replace(/[:.]/g,'-')+(execute?'-execute':'-plan'));await mkdir(directory,{recursive:true,mode:0o700});runDirectory=directory;stage='read-only-before-capture';
  const capture=async(target:typeof targets[number],fixedCommit?:string)=>{
    const base='/api/repos/'+target.namespace+'/'+target.repo,branches=await call<Array<{name:string;commitId:string}>>(base+'/branches'),head=branches.find(branch=>branch.name==='main');assert.ok(head,'Expected main branch');const commit=fixedCommit??head.commitId;
    const first=await call<DatasetPage>(base+'/dataset?'+new URLSearchParams({ref:commit,page:'1',pageSize:'200'}));assert.equal(first.commitId,commit);assert.equal(first.totalRows,target.rows,'Real dataset row count changed; review new inventory before adoption');assert.equal(first.matchedRows,target.rows);assert.equal(first.page,1);
    const pages=[first];for(let page=2;page<=Math.ceil(first.totalRows/200);page++)pages.push(await call<DatasetPage>(base+'/dataset?'+new URLSearchParams({ref:commit,page:String(page),pageSize:'200'})));
    const records:Array<{id:string;record:Record<string,unknown>}>=[],contentHashes:Record<string,string>=Object.create(null),activities:Record<string,unknown>=Object.create(null),evaluationRows:Record<string,unknown>=Object.create(null),labelRecords=new Map<string,unknown>();
    const {ref:_labelRef,commitId:_labelCommit,...labelDocument}=first.labels,{fields:_fieldConfig,...otherDescriptor}=first.descriptor,commonHash=hash({descriptor:first.descriptor,labels:labelDocument,evaluation:{enabled:first.evaluation?.enabled,counts:first.evaluation?.counts}});
    for(let index=0;index<pages.length;index++){
      const page=pages[index]!,{ref:_ref,commitId:_commit,...labels}=page.labels;assert.equal(page.commitId,commit);assert.equal(page.page,index+1);assert.equal(page.totalRows,target.rows);assert.equal(page.matchedRows,target.rows);assert.equal(page.rowIds.length,page.rows.length);assert.equal(hash({descriptor:page.descriptor,labels,evaluation:{enabled:page.evaluation?.enabled,counts:page.evaluation?.counts}}),commonHash,'Pinned page metadata changed during read');
      for(let row=0;row<page.rowIds.length;row++){const id=page.rowIds[row]!;assert.equal(Object.hasOwn(contentHashes,id),false,'Repeated row identity across pages');assert.equal(datasetHash(page.rows[row]),page.contentHashes[id],'Returned content hash does not match effective source record');records.push({id,record:page.rows[row]!});contentHashes[id]=page.contentHashes[id]!;activities[id]=page.rowActivity?.[id]??null;evaluationRows[id]=page.evaluation?.rows[id]??null;}
      for(const record of page.labelRecords)labelRecords.set(hash(record),record);
    }
    assert.equal(records.length,target.rows);const sourceSha256=sha(await raw(base,commit,first.path)),fields=await call<DatasetFieldsState>(base+'/dataset/fields?'+new URLSearchParams({ref:commit}));assert.equal(fields.commitId,commit);
    const splitCounts={train:0,dev:0,test:0,null:0,missing:0,other:0};for(const {record}of records){if(!Object.hasOwn(record,'split'))splitCounts.missing++;else if(record.split===null)splitCounts.null++;else if(['train','dev','test'].includes(String(record.split)))splitCounts[record.split as 'train'|'dev'|'test']++;else splitCounts.other++;}
    if(target.repo==='benchmark-prompt-injection')assert.deepEqual(splitCounts,{train:1600,dev:200,test:200,null:0,missing:0,other:0},'Existing imported prompt split differs from the confirmed inventory; no values will be overwritten');
    if(target.repo==='benchmark-behavior-drift')assert.deepEqual(splitCounts,{train:0,dev:0,test:0,null:1719,missing:0,other:0},'Existing null drift split differs from the confirmed inventory; review before adoption');
    const nextFields=adoptGlobalFieldMetadata(fields.configuration,catalog.catalog),changedFields=GLOBAL_DATASET_FIELD_IDS.filter(id=>hash(fields.configuration[id]??null)!==hash(nextFields[id]));
    return {namespace:target.namespace,repo:target.repo,ref:'main' as const,headAtCapture:head.commitId,commitId:commit,rows:records.length,pages:pages.length,branches,canonicalPath:first.path,configuration:fields.configuration,changedFields,splitCounts,hashes:{sourceSha256,effectiveRowsSha256:hash(records),rowIdsSha256:hash(records.map(record=>record.id)),contentHashesSha256:hash(contentHashes),labelsSha256:hash({document:labelDocument,records:[...labelRecords.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,record])=>record),superseded:first.supersededLabelRecords,conflicts:first.labelConflicts,orphans:first.orphanAssignments}),evaluationSha256:hash({enabled:first.evaluation?.enabled,counts:first.evaluation?.counts,rows:evaluationRows}),rowActivitySha256:hash(activities),attachmentsSha256:hash(first.attachments),feedbackSha256:hash(first.feedback),readmeSha256:sha(first.readme),bindingSha256:hash(first.binding??null),descriptorExceptFieldsSha256:hash(otherDescriptor)},preflight:await controlPreflight(controlRoot,target)};
  };
  type Pin=Awaited<ReturnType<typeof capture>>;
  const before:Pin[]=[];for(const target of targets)before.push(await capture(target));
  const catalogGuard=hash(catalog.catalog),catalogAfterRead=await call<GlobalFieldCatalogState>('/api/global-fields/catalog');assert.equal(hash(catalogAfterRead.catalog),catalogGuard,'Global catalog changed while capturing the plan');
  for(const pin of before){const branches=await call<Array<{name:string;commitId:string}>>('/api/repos/'+pin.namespace+'/'+pin.repo+'/branches');assert.equal(branches.find(branch=>branch.name==='main')?.commitId,pin.commitId,'Target changed while capturing the plan');}
  await privateJson(directory,'before.json',{version:1,createdAt:new Date().toISOString(),mode:execute?'execute':'plan',operationId,catalog:catalog.catalog,projects:before});
  if(!execute){const result={executed:false,passed:true,readOnly:true,realRows:before.reduce((sum,pin)=>sum+pin.rows,0),catalogRevision:catalog.catalog.revision,projects:before.map(({namespace,repo,commitId,rows,pages,changedFields,splitCounts,hashes,preflight})=>({namespace,repo,commitId,rows,pages,changedFields,splitCounts,hashes,preflight})),requestCounts,directory};await privateJson(directory,'plan.json',result);console.log(JSON.stringify(result));return;}
  // Re-check every private actor's unfinished work immediately before the one allowed HTTP mutation.
  for(const target of targets)await controlPreflight(controlRoot,target);
  stage='schema-adoption-request';
  let synchronization:GlobalFieldSynchronizationResult;
  try{synchronization=await call<GlobalFieldSynchronizationResult>('/api/global-fields/synchronize',{expectedRevision:catalog.catalog.revision,targets:before.map(pin=>({namespace:pin.namespace,repo:pin.repo,ref:'main',expectedCommit:pin.commitId}))});await privateJson(directory,'synchronization.json',synchronization);}
  catch(error){await privateJson(directory,'failure.json',{passed:false,requiresReconciliation:true,operationId,reason:error instanceof Error?error.message:'Adoption request failed',at:new Date().toISOString(),retryAutomatically:false});throw error;}
  stage='after-readback';
  const after:Pin[]=[];for(const target of targets)after.push(await capture(target));
  await privateJson(directory,'after.json',{projects:after});
  const checks=[];for(const prior of before){const current=after.find(pin=>pin.repo===prior.repo)!,result=synchronization.results.find(item=>item.repo===prior.repo&&item.namespace===prior.namespace);assert.ok(result);assert.notEqual(result.status,'blocked',`Project adoption blocked: ${prior.repo} (${result.code??'unknown'})`);assert.equal(current.commitId,result.commitId);assert.deepEqual(current.hashes,prior.hashes,'A source record, label, evaluation mapping or non-field metadata changed');assert.deepEqual(current.configuration,adoptGlobalFieldMetadata(prior.configuration,catalog.catalog),'Non-preset field settings or project display/export choices changed');assert.deepEqual(current.splitCounts,prior.splitCounts);assert.equal(current.preflight.privateStateHash,prior.preflight.privateStateHash,'Private editor input changed during adoption');for(const branch of prior.branches.filter(branch=>branch.name!=='main'))assert.equal(current.branches.find(item=>item.name===branch.name)?.commitId,branch.commitId,'A different branch changed');assert.equal(current.changedFields.length,0,'Current project has not adopted all catalog rules');
    if(result.status==='updated'){const detail=await call('/api/repos/'+prior.namespace+'/'+prior.repo+'/commits/'+current.commitId);assert.deepEqual(detail.parentIds,[prior.commitId],'Unexpected schema commit ancestry');assert.deepEqual(detail.files.map((file:{path:string})=>file.path),['.oxenweb/dataset.json'],'Schema adoption must only version the dataset descriptor');}
    checks.push({namespace:prior.namespace,repo:prior.repo,rows:current.rows,beforeCommit:prior.commitId,afterCommit:current.commitId,status:result.status,changedFields:prior.changedFields,sourceAndAllEffectiveRecordsUnchanged:true,allRowsChecked:current.rows,allPagesChecked:current.pages,labelsEvaluationActivityUnchanged:true,privateInputsAndOtherBranchesUnchanged:true,sourceSha256:current.hashes.sourceSha256,effectiveRowsSha256:current.hashes.effectiveRowsSha256,splitCounts:current.splitCounts,globalFieldsPresent:GLOBAL_DATASET_FIELD_IDS.every(id=>!!current.configuration[id]),unclassifiedValuesLeftUntouched:true});
  }
  const finalCatalog=await call<GlobalFieldCatalogState>('/api/global-fields/catalog');assert.equal(hash(finalCatalog.catalog),catalogGuard,'Global catalog definitions were changed unexpectedly');
  const receipt={version:1,executed:true,passed:true,completedAt:new Date().toISOString(),operationId,catalogRevision:catalog.catalog.revision,realRows:after.reduce((sum,pin)=>sum+pin.rows,0),projects:checks,onlyDefinitionsAdopted:true,recordsAssigned:false,sourceBodiesWrittenToReceipt:false,rawBodiesSentExternally:false,globalCatalogDefinitionWrites:false,stickyManagedProjectPolicyMayBeRecorded:true,r14ArtifactsTouched:false,requestCounts,directory};
  await privateJson(directory,'after.json',{projects:after});await privateJson(directory,'verification.json',receipt);await mkdir(path.join(projectRoot,'.data/r16-real-fields'),{recursive:true});await privateJson(path.join(projectRoot,'.data/r16-real-fields'),'latest.json',receipt);console.log(JSON.stringify(receipt));
}
if(process.argv.includes('--help'))console.log('Read-only plan: npx tsx scripts/r16-adopt-real-fields.ts\nAuthorized schema-only adoption: npx tsx scripts/r16-adopt-real-fields.ts --execute');else await main().catch(async error=>{if(runDirectory)await privateJson(runDirectory,'execution-error.json',{passed:false,executed:execute,stage,reason:error instanceof Error?error.message:'Local real-field adoption failed',automaticallyRetried:false,at:new Date().toISOString()});console.error(error instanceof Error?error.message:'Local real-field adoption failed');process.exitCode=1;});
