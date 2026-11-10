/** Local BFF/native-0.67 acceptance. Synthetic records only; plan unless --execute. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {loadConfig,projectRoot} from '../apps/server/src/config.js';
import {adoptGlobalFieldMetadata,GLOBAL_DATASET_FIELD_IDS,type GlobalFieldCatalogState} from '../packages/shared/src/global-fields.js';
import type {DatasetPage} from '../packages/shared/src/dataset.js';
import type {DatasetFieldsState} from '../packages/shared/src/dataset-field-types.js';

const plan={operation:'r16-local-bff-native-fields-acceptance',executed:false,bffPort:3001,officialPort:3002,syntheticOnly:true,realProjectsTouched:false,globalCatalogWrites:false,sourceArchivesExecuted:false,executeFlagRequired:true,scenarios:['New imported dataset includes four global definitions with visible/export enabled, without inventing row values','Global adoption preserves existing values and project display/export checkbox choices; mandatory fields reject deletion (the disabled button and hint require browser evidence)','Deleting a custom key removes values and definition atomically while retaining source/history/identities','Protected builtins, identity and source truth cannot be removed; exact confirmation and stale CAS rejected']};
async function execute(){
  for(const file of ['.env','infra/oxen/local.env'])try{process.loadEnvFile(path.join(projectRoot,file));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const config=loadConfig();assert.equal(config.demo,false,'Requires live local BFF');assert.equal(config.port,3001);assert.equal(new URL(config.upstream!).port,'3002');assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(config.upstream!).hostname));
  const origin='http://127.0.0.1:3001',auth={...(config.token?{authorization:'Bearer '+config.token}:{}),'x-oxen-request':'web'},name='r16-synthetic-fields-'+Date.now().toString(36),base='/api/repos/local/'+name;
  const call=async<T=any>(method:string,url:string,body?:unknown,expected=200):Promise<T>=>{
    const form=body instanceof FormData,response=await fetch(origin+url,{method,headers:{...auth,...(body===undefined||form?{}:{'content-type':'application/json'}),...(['GET','HEAD'].includes(method)?{}:{'x-operation-id':randomUUID()})},...(body===undefined?{}:{body:form?body:JSON.stringify(body)}),signal:AbortSignal.timeout(180000)});
    const text=await response.text();let parsed:any;try{parsed=JSON.parse(text);}catch{parsed=undefined;}
    assert.equal(response.status,expected,`${method} ${url.split('?')[0]} failed with ${response.status} / ${parsed?.error?.code??'response'}`);return parsed as T;
  };
  const raw=async(ref:string,filename:string)=>{const response=await fetch(origin+base+'/raw?'+new URLSearchParams({ref,path:filename}),{headers:auth,signal:AbortSignal.timeout(30000)});assert.equal(response.status,200,'Synthetic fixed source read');return Buffer.from(await response.arrayBuffer());};
  const sha=(value:Buffer)=>createHash('sha256').update(value).digest('hex');
  const health=await call('GET','/api/health');assert.equal(health.ready,true);assert.equal(health.mode,'live');assert.equal(health.runtime.acceptsWrites,true);
  const version=await fetch(new URL('/api/version',config.upstream!),{signal:AbortSignal.timeout(5000)}).then(response=>response.json()) as {oxen_version?:string};assert.equal(version.oxen_version,'0.67.0');
  const catalog=await call<GlobalFieldCatalogState>('GET','/api/global-fields/catalog');assert.equal(catalog.catalog.fields.find(field=>field.id==='purposes')!.type,'multi');
  await call('POST','/api/repos',{namespace:'local',name,description:'Synthetic R16 field schema and deletion acceptance',visibility:'private'},201);
  const branches=await call('GET',base+'/branches'),head=branches.find((branch:{name:string})=>branch.name==='main').commitId;
  const rows=[{id:'synthetic-1',title:'合成标题',temporary:'Delete this synthetic value',long_text:'Synthetic long content '.repeat(70),split:'train',ground_truth:'source reference only'},{id:'synthetic-2',title:'Short',temporary:'Delete second value',long_text:'Short content',split:'dev',ground_truth:'source reference only'},{id:'synthetic-3',title:'Synthetic third',long_text:'Another synthetic line',split:'test',ground_truth:'source reference only'}];
  const upload=new FormData();upload.append('file',new Blob([rows.map(row=>JSON.stringify(row)).join('\n')+'\n'],{type:'application/x-ndjson'}),'synthetic-r16.jsonl');
  const inspection=await call('POST',base+'/dataset/import/inspect',upload),candidate=inspection.candidates.find((item:{mode:string})=>item.mode==='tables');assert.ok(candidate);
  const mapping={mode:'tables',paths:candidate.paths,idField:'id'},generic=await call('POST','/api/import/zip/'+inspection.id+'/plan',mapping),target={ref:'main',expectedCommit:head,mapping,fingerprint:generic.fingerprint},preview=await call('POST',base+'/dataset/import/'+inspection.id+'/preview',target);
  await call('POST',base+'/dataset/import/'+inspection.id+'/commit',{...target,previewFingerprint:preview.previewFingerprint,message:'Import synthetic R16 field acceptance'});
  const before=await call<DatasetPage>('GET',base+'/dataset?ref=main'),originalSourceSha=sha(await raw(before.commitId,before.path));assert.equal(before.totalRows,3);
  for(const id of GLOBAL_DATASET_FIELD_IDS){assert.ok(before.descriptor.fields?.[id],`Preset definition missing: ${id}`);assert.equal(before.descriptor.fields[id]!.visible,true);assert.equal(before.descriptor.fields[id]!.export,true);}
  assert.deepEqual(before.rows.map(row=>row.split),['train','dev','test']);for(const row of before.rows)for(const id of ['quality','purposes','visibility'])assert.equal(Object.hasOwn(row,id),false,'No classification may be invented');
  let current=await call<DatasetFieldsState>('GET',base+'/dataset/fields?ref=main');
  const adopted=await call<DatasetFieldsState>('PUT',base+'/dataset/fields',{ref:'main',expectedCommit:current.commitId,fields:adoptGlobalFieldMetadata(current.configuration,catalog.catalog),message:'Confirm current global field schema'});assert.equal(adopted.commitId,current.commitId,'Current global adoption is a no-op');
  const configured={...current.configuration,split:{...current.configuration.split,visible:false,export:false},temporary:{type:'string',required:false},unused:{type:'string'},long_text:{visible:false}};
  current=await call<DatasetFieldsState>('PUT',base+'/dataset/fields',{ref:'main',expectedCommit:current.commitId,fields:configured,message:'Configure synthetic removable fields and hidden width'});
  const preserved=await call<DatasetFieldsState>('PUT',base+'/dataset/fields',{ref:'main',expectedCommit:current.commitId,fields:adoptGlobalFieldMetadata(current.configuration,catalog.catalog),message:'Confirm project display and export choices survive adoption'});assert.equal(preserved.commitId,current.commitId);assert.equal(preserved.configuration.split!.visible,false);assert.equal(preserved.configuration.split!.export,false);
  await call('POST',base+'/dataset/fields/delete',{ref:'main',expectedCommit:current.commitId,fieldId:'temporary',confirmFieldId:'Temporary'},422);
  for(const fieldId of [...GLOBAL_DATASET_FIELD_IDS,'id','ground_truth']){const response=await call('POST',base+'/dataset/fields/delete',{ref:'main',expectedCommit:current.commitId,fieldId,confirmFieldId:fieldId},422);assert.equal(response.error.code,'DATASET_FIELD_DELETE_PROTECTED');}
  const beforeDelete=await call<DatasetPage>('GET',base+'/dataset?ref=main'),commitCount=(await call('GET',base+'/commits?ref=main&pageSize=100')).length;
  const deleted=await call<DatasetFieldsState>('POST',base+'/dataset/fields/delete',{ref:'main',expectedCommit:current.commitId,fieldId:'temporary',confirmFieldId:'temporary',message:'Delete synthetic temporary field'}),after=await call<DatasetPage>('GET',base+'/dataset?ref=main');
  assert.equal(after.commitId,deleted.commitId);assert.deepEqual(after.rowIds,beforeDelete.rowIds);assert.ok(after.rows.every(row=>!Object.hasOwn(row,'temporary')));assert.equal(after.columns.some(column=>column.name==='temporary'),false);assert.equal((await call('GET',base+'/commits?ref=main&pageSize=100')).length,commitCount+1);
  assert.equal(sha(await raw(after.commitId,after.path)),originalSourceSha);const historical=await call<DatasetPage>('GET',base+'/dataset?ref='+beforeDelete.commitId);assert.equal(historical.rows[0]!.temporary,'Delete this synthetic value');assert.deepEqual(after.rows.map(row=>row.split),['train','dev','test']);assert.equal(deleted.configuration.split!.visible,false);assert.equal(deleted.configuration.split!.export,false);
  const stale=await call('POST',base+'/dataset/fields/delete',{ref:'main',expectedCommit:beforeDelete.commitId,fieldId:'unused',confirmFieldId:'unused'},409);assert.equal(stale.error.code,'DATASET_VERSION_CONFLICT');assert.equal((await call('GET',base+'/dataset?ref=main')).commitId,after.commitId);
  const directory=path.join(projectRoot,'.data/r16-native-fields',name);await mkdir(directory,{recursive:true});
  const receipt={...plan,executed:true,passed:true,official:version.oxen_version,project:'local/'+name,rows:after.totalRows,catalogRevision:catalog.catalog.revision,initialCommit:before.commitId,preDeleteCommit:beforeDelete.commitId,deletedCommit:after.commitId,originalSourceSha256:originalSourceSha,predefinedFieldsPresent:true,predefinedVisibleExportDefaultTrue:true,projectVisibleExportChoicesPreserved:true,existingSplitsPreserved:true,noClassificationInvented:true,explicitAdoptionNoOp:true,fieldRemovalOneCommit:true,historicalValuesPreserved:true,stableRowIdentities:true,sourceBytesPreserved:true,protectedFieldsRejected:true,exactConfirmationRejected:true,staleCasRejected:true,completedAt:new Date().toISOString()};
  await writeFile(path.join(directory,'verification.json'),JSON.stringify(receipt,null,2)+'\n');await writeFile(path.join(projectRoot,'.data/r16-native-fields/latest.json'),JSON.stringify({directory,...receipt},null,2)+'\n');console.log(JSON.stringify(receipt));
}
if(process.argv.includes('--execute'))await execute().catch(error=>{console.error(error instanceof Error?error.message:'Synthetic R16 acceptance failed');process.exitCode=1;});else console.log(JSON.stringify(plan));
