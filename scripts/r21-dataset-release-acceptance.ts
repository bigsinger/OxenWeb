/** Isolated synthetic whole-dataset publishing. Never imports real benchmarks or executes archive members. */
import assert from 'node:assert/strict';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {mkdir,writeFile,lstat} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import type {FastifyInstance,HTTPMethods} from 'fastify';
import type {DatasetRelease,DatasetReleasePreview} from '../packages/shared/src/releases.js';
import type {Provider,RepoKey} from '../apps/server/src/provider.js';
import {createApp} from '../apps/server/src/app.js';
import {loadConfig,projectRoot} from '../apps/server/src/config.js';
import {DemoProvider} from '../apps/server/src/demo.js';
import {LiveProvider} from '../apps/server/src/live.js';
import {runCli} from '../apps/server/src/cli.js';
import {readZipMembers,sha256,storedZip} from '../apps/server/src/zip-io.js';
import {SourceAccessMarkers} from '../apps/server/src/source-access-markers.js';
import {startSyntheticOxen} from './qa-native-server.js';

const sourcePath='data/samples.jsonl',excluded='R21_SYNTHETIC_EXCLUDED_FIELD_02';
type Row=Record<string,unknown>;
export async function seedDatasetReleaseFixture(app:FastifyInstance,provider:Provider,key:RepoKey,ownerToken?:string){
  assert.equal(key.namespace,'local');assert.match(key.repo,/^r21-[a-z0-9-]+$/);
  assert.equal((await provider.repos()).some(repo=>repo.namespace===key.namespace&&repo.name===key.repo),false);
  const base='/api/repos/'+key.namespace+'/'+key.repo,v1='/api/v1/datasets/'+encodeURIComponent(key.namespace+'/'+key.repo);
  const inject=(method:HTTPMethods,url:string,payload?:object,token=ownerToken)=>app.inject({method,url,headers:{'x-oxen-request':'web',...(token?{authorization:'Bearer '+token}:{})},...(payload===undefined?{}:{payload})});
  const call=async(method:HTTPMethods,url:string,payload?:object,token=ownerToken,status=200):Promise<any>=>{const result=await inject(method,url,payload,token);let parsed:any;try{parsed=result.json();}catch{}assert.equal(result.statusCode,status,method+' '+url.split('?')[0]+' '+(parsed?.error?.code??''));return result.statusCode===204?undefined:parsed;};
  await call('POST','/api/repos',{namespace:key.namespace,name:key.repo,description:'R21 synthetic complete dataset publishing',visibility:'private'},ownerToken,201);
  for(const url of ['/api/v1/view-templates','/api/v1/release-templates',v1+'/splits',v1+'/holdout'])assert.equal((await inject('GET',url)).statusCode,404,'Retired publication endpoint must not exist');
  const archive=storedZip([{name:'SKILL.md',content:Buffer.from('# Inert synthetic data\nDo not execute.\n')},{name:'notes.txt',content:Buffer.from('Synthetic archive content only.\n')}]);
  const rows:Row[]=[
    {id:'synthetic-a',text:'Synthetic original text',quality:'gold',visibility:'public',status:'active',package_path:'packages/inert.zip',package_sha256:sha256(archive)},
    {id:'synthetic-b',text:'Synthetic formerly hidden row',quality:'normal',visibility:'hidden',status:'inactive'},
    {id:'synthetic-c',text:'Synthetic internal row',quality:'normal',visibility:'internal',purposes:['regression']},
    {id:'synthetic-d',text:'Synthetic row without classification'},
  ].map(row=>({...row,internal_note:excluded}));
  const writeSource=async(values:Row[],message:string)=>{const workspace=await provider.createWorkspace(key,'Synthetic R21 source edit','main');await provider.writeWorkspace(key,workspace.id,sourcePath,Buffer.from(values.map(row=>JSON.stringify(row)).join('\n')+'\n'));const commit=await provider.commitWorkspace(key,workspace.id,message);await provider.deleteWorkspace(key,workspace.id);return commit.id;};
  const workspace=await provider.createWorkspace(key,'Synthetic R21 source baseline','main');
  for(const [filename,content]of Object.entries({[sourcePath]:Buffer.from(rows.map(row=>JSON.stringify(row)).join('\n')+'\n'),'README.md':Buffer.from('# Synthetic dataset description\n\nR21 complete dataset acceptance.\n'),'.oxenweb/dataset.json':Buffer.from(JSON.stringify({version:1,id:key.repo,name:'R21 Synthetic Dataset',canonicalPath:sourcePath,readmePath:'README.md',identityField:'id',attachmentFields:['package_path'],source:'descriptor',fields:{internal_note:{type:'string',export:false},id:{type:'string'},text:{type:'string'}}})),'.oxenweb/labels.json':Buffer.from(JSON.stringify({version:1,columns:[],assignments:[]})),'packages/inert.zip':archive}))await provider.writeWorkspace(key,workspace.id,filename,content);
  const initial=await provider.commitWorkspace(key,workspace.id,'Synthetic R21 initial dataset');await provider.deleteWorkspace(key,workspace.id);
  const consumer=await call('POST',base+'/access',{name:'Synthetic R21 package consumer',role:'viewer'},ownerToken,201);
  const pin=sha256((await provider.raw(key,initial.id,sourcePath)).content);
  return {app,provider,key,base,v1,ownerToken,inject,call,rows,writeSource,pin,consumer};
}
export type DatasetReleaseFixture=Awaited<ReturnType<typeof seedDatasetReleaseFixture>>;

export async function publishSyntheticDataset(f:DatasetReleaseFixture,version:string){
  const preview=await f.call('POST',f.v1+'/releases/preview',{sourceRef:'main'}) as DatasetReleasePreview;
  assert.equal(preview.ok,true);assert.equal(typeof preview.generatedNotes,'string');assert.ok(preview.generatedNotes.length);
  let item=await f.call('POST',f.v1+'/releases',{sourceRef:'main',version,title:'Synthetic '+version,notes:preview.generatedNotes,expectedCommit:preview.commitId,expectedBaselineReleaseId:preview.baselineReleaseId,expectedPlanDigest:preview.planDigest},f.ownerToken,201) as DatasetRelease;
  assert.equal(item.publishingVersion,'dataset-v1');assert.equal(item.generatedNotes,preview.generatedNotes);
  item=await f.call('POST',f.v1+'/releases/'+item.id+'/build',{expectedRevision:item.revision}) as DatasetRelease;
  const deadline=Date.now()+60000;while(['queued','building'].includes(item.status)){assert.ok(Date.now()<deadline,'Synthetic build deadline');await new Promise(resolve=>setTimeout(resolve,30));item=await f.call('GET',f.v1+'/releases/'+item.id) as DatasetRelease;}
  assert.equal(item.status,'ready',item.error);item=await f.call('POST',f.v1+'/releases/'+item.id+'/publish',{expectedRevision:item.revision}) as DatasetRelease;
  assert.equal(item.status,'published');assert.equal(item.assets.length,2);return {preview,item};
}
async function verifyPackage(f:DatasetReleaseFixture,item:DatasetRelease,expectedIds:string[]){
  const asset=item.assets.find(asset=>asset.kind==='data')!;assert.ok(asset);const response=await f.inject('GET',f.v1+'/releases/'+item.id+'/assets/'+asset.id);assert.equal(response.statusCode,200);assert.equal(sha256(response.rawPayload),asset.sha256);
  const members=await readZipMembers(response.rawPayload),files=new Map(members.map(member=>[member.name,member.content]));
  const rows=files.get('samples.jsonl')!.toString('utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line));
  assert.deepEqual(rows.map(row=>row.data.id).sort(),[...expectedIds].sort());assert.ok(rows.every(row=>!Object.hasOwn(row.data,'internal_note')));
  assert.ok(!files.get('schema.json')!.includes(Buffer.from(excluded)));assert.ok(files.get('README.md')!.includes(Buffer.from('Synthetic dataset description')));
  assert.equal(files.get('RELEASE_NOTES.md')!.toString('utf8').trim(),item.generatedNotes!.trim());assert.ok(members.some(member=>member.name==='attachments/packages/inert.zip'));
  for(const line of files.get('checksums.sha256')!.toString('utf8').trim().split('\n')){const hash=line.slice(0,64),name=line.slice(66);assert.equal(sha256(files.get(name)!),hash);}
  assert.equal(members.some(member=>/HIDDEN_MANIFEST|views\.json|templates\.json/.test(member.name)),false);
  return {asset,files,rows};
}
export async function verifyDatasetReleaseFixture(f:DatasetReleaseFixture,options:{releaseRoot?:string}={}){
  const first=await publishSyntheticDataset(f,'r21-v1');assert.equal(first.preview.baselineReleaseId,null);assert.equal(first.preview.rowCount,4);assert.match(first.preview.generatedNotes,/首次完整数据集发布/);
  const initialPackage=await verifyPackage(f,first.item,f.rows.map(row=>row.id as string));assert.equal(sha256((await f.provider.raw(f.key,first.item.commitId,sourcePath)).content),f.pin);
  const initialShare=await f.call('POST',f.v1+'/releases/'+first.item.id+'/shares',{assetId:initialPackage.asset.id,expiresAt:new Date(Date.now()+60000).toISOString()});
  const nextRows:Row[]=[{...f.rows[0],text:'Synthetic revised text'},f.rows[2]!,f.rows[3]!,{id:'synthetic-e',text:'Synthetic new record',visibility:'hidden',internal_note:excluded}];
  const nextCommit=await f.writeSource(nextRows,'Synthetic R21 add modify and remove records');
  const second=await publishSyntheticDataset(f,'r21-v2');assert.equal(second.item.commitId,nextCommit);assert.equal(second.preview.baselineReleaseId,first.item.id);assert.deepEqual(second.preview.comparison!.samples,{added:1,removed:1,modified:1});assert.ok(second.preview.changes.files.modified>=1);assert.ok(second.preview.changes.commits.items.some(item=>item.message==='Synthetic R21 add modify and remove records'));
  await verifyPackage(f,second.item,nextRows.map(row=>row.id as string));
  assert.equal((await f.inject('GET',f.v1+'/releases/'+first.item.id+'/assets/'+initialPackage.asset.id)).statusCode,404);assert.equal((await f.inject('GET',f.v1+'/releases/'+first.item.id)).statusCode,404);assert.equal((await f.inject('GET',initialShare.downloadPath)).statusCode,404);
  if(options.releaseRoot){assert.match(first.item.id,/^[a-f0-9-]{36}$/);const root=path.resolve(options.releaseRoot),oldDirectory=path.resolve(root,'assets',first.item.id);assert.ok(oldDirectory.startsWith(root+path.sep));await assert.rejects(()=>lstat(oldDirectory),(error:unknown)=>(error as NodeJS.ErrnoException).code==='ENOENT','Old release asset directory must be physically removed');}
  const consumer=await f.inject('GET',f.v1+'/releases/'+second.item.id+'/assets/'+second.item.assets.find(asset=>asset.kind==='data')!.id,undefined,f.consumer.token);assert.equal(consumer.statusCode,200);
  const snapshot=await f.call('POST',f.v1+'/snapshots',{ref:'main'},f.ownerToken,202) as DatasetRelease;let current=snapshot;const deadline=Date.now()+60000;while(['queued','building'].includes(current.status)){assert.ok(Date.now()<deadline);await new Promise(resolve=>setTimeout(resolve,30));current=await f.call('GET',f.v1+'/snapshots/'+snapshot.id);}
  assert.equal(current.status,'ready',current.error);assert.equal(current.rowCount,4);assert.ok(current.assets.every(asset=>asset.audience==='internal'&&asset.shareable===false));assert.equal((await f.inject('GET',f.v1+'/snapshots/'+current.id+'/assets/'+current.assets[0]!.id,undefined,f.consumer.token)).statusCode,403);
  assert.equal((await f.inject('POST',f.v1+'/releases',{sourceRef:'main',version:'old-view-flags',title:'Retired',templateName:'tpl_standard_public'})).statusCode,400);
  const latest=await f.call('GET',f.v1+'/releases/'+second.item.id) as DatasetRelease;assert.equal(latest.latest,true);const published=(await f.call('GET',f.v1+'/releases')).items.filter((item:DatasetRelease)=>item.status==='published');assert.deepEqual(published.map((item:DatasetRelease)=>item.id),[latest.id]);assert.equal((await f.inject('POST',f.v1+'/releases/'+second.item.id+'/latest',{expectedRevision:latest.revision})).statusCode,404);
  return {passed:true,mode:'whole-dataset',project:f.key,initialRows:4,updatedRows:4,allBusinessCategoriesIncluded:true,excludedFieldsOmitted:true,firstBaseline:null,secondBaselineVersion:first.item.version,changes:second.preview.comparison!.samples,automaticNotesVerified:true,commitSummaryVerified:true,checksumsVerified:true,readmePreserved:true,oldAssetsAndSharesRemoved:true,oldAssetDirectoryRemoved:options.releaseRoot?true:null,releaseConsumerAllowed:true,internalSnapshotConsumerDenied:true,retiredEndpoints404:true,retiredRequestFlags400:true,singleCurrentPublished:true,latestReleaseId:latest.id,sourceCommit:nextCommit,archivesExecuted:false,productionTouched:false,browserDownloadAttempted:false};
}
async function main(){
  const demo=process.argv.includes('--demo');if(!process.argv.includes('--execute')){console.log(JSON.stringify({executed:false,official:demo?'demo':'0.67.0',nativePort:3008,productionTouched:false,scope:'Fresh synthetic full-dataset release and automatic notes across two versions'}));return;}
  const name='r10-r21-publish-'+Date.now().toString(36),directory=path.join(projectRoot,'.data/r21-dataset-release-acceptance',name);await mkdir(directory,{recursive:true});
  if(!demo){process.env.OXEN_CONFIG_DIR=path.join(directory,'client-config');await mkdir(process.env.OXEN_CONFIG_DIR,{recursive:true});}
  const native=demo?undefined:await startSyntheticOxen({name,port:3008}),ownerToken=randomBytes(32).toString('base64url'),config=loadConfig({DEMO_MODE:demo?'true':'false',DEMO_DATA_FILE:path.join(directory,'control/state.json'),PORT:'3015',HOST:'127.0.0.1',BFF_TOKEN:ownerToken,BFF_TEAM_MODE:'true',...(native?{OXEN_SERVER_URL:native.origin,OXEN_NAMESPACES:'local',OXEN_CLI_ROOT:path.join(directory,'clones'),OXEN_CLI_BIN:path.join(projectRoot,'infra/oxen/bin/oxen.exe')}:{})}),provider=demo?new DemoProvider(config.demoFile):new LiveProvider(config);let app:FastifyInstance|undefined;
  try{if(native)await runCli(['config','--name','Synthetic R21 acceptance','--email','synthetic-r21@localhost'],projectRoot,{binary:config.cliBin,timeoutMs:30000,maxOutputBytes:1024*1024});await provider.init();const markers=new SourceAccessMarkers({filename:path.join(path.dirname(config.demoFile),'source-access-markers.json')});await markers.init();await markers.retainRestrictions([]);app=await createApp(config,provider);const fixture=await seedDatasetReleaseFixture(app,provider,{namespace:'local',repo:'r21-release-'+Date.now().toString(36)},ownerToken),result=await verifyDatasetReleaseFixture(fixture,{releaseRoot:path.join(path.dirname(config.demoFile),'releases')}),receipt={...result,completedAt:new Date().toISOString(),official:demo?'synthetic-demo':'0.67.0',directory};await writeFile(path.join(directory,'verification.json'),JSON.stringify(receipt,null,2)+'\n');await writeFile(path.join(projectRoot,'.data/r21-dataset-release-acceptance',demo?'latest-demo.json':'latest-native.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));}
  finally{await app?.close();await native?.stop();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{console.error(error instanceof Error?error.message:'R21 synthetic publishing failed');process.exitCode=1;});
