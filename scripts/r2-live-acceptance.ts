/** Isolated synthetic acceptance against the official local Oxen 0.67 server.
 * No real benchmark repositories or production BFF processes are modified.
 * Owner/collaborator tokens live in memory only and are never logged.
 */
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,readFile,realpath,rename,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createApp} from '../apps/server/src/app.js';
import {loadConfig,projectRoot} from '../apps/server/src/config.js';
import {LiveProvider} from '../apps/server/src/live.js';
import {DatasetService,datasetHash} from '../apps/server/src/dataset.js';
import {readZipMembers,sha256,storedZip} from '../apps/server/src/zip-io.js';
import type {DatasetPage,DatasetOperation} from '../packages/shared/src/dataset.js';
import type {AnnotationTaskView} from '../packages/shared/src/workflow-types.js';
import type {DatasetRelease} from '../packages/shared/src/releases.js';
import type {GovernanceDimension,GovernanceTemplate} from '../packages/shared/src/governance-types.js';

const inspectRun=process.argv[2]==='--inspect-run'?process.argv[3]:undefined;
if(inspectRun&&!/^[a-z0-9]+-[a-f0-9]{6}$/.test(inspectRun))throw new Error('Invalid inspection run identifier.');
const runId=inspectRun??Date.now().toString(36)+'-'+randomUUID().slice(0,6),runRoot=path.join(projectRoot,'.data/r2-acceptance',runId);
const ownerToken=randomBytes(32).toString('base64url'),secrets=[ownerToken];
const sourceName=`r2-workflow-acceptance-${runId}`,importName=`r2-workflow-roundtrip-${runId}`,allocationName=`r2-workflow-allocation-${runId}`;
const key={namespace:'local',repo:sourceName},base=`/api/repos/local/${sourceName}`;
const evidence:{version:number;runId:string;mode:string;stage:string;status:string;root:string;repositories:Record<string,string>;checks:Record<string,unknown>;error?:string}={version:1,runId,mode:'live-official-oxen',stage:'starting',status:'running',root:runRoot,repositories:{source:sourceName,roundtrip:importName,allocation:allocationName},checks:{}};
const scrub=(value:string)=>secrets.reduce((text,secret)=>text.split(secret).join('[redacted]'),value);
const persist=async()=>{const temporary=path.join(runRoot,'verification.json.partial');await writeFile(temporary,JSON.stringify(evidence,null,2)+'\n');await rename(temporary,path.join(runRoot,'verification.json'));};
async function stage(name:string,details:Record<string,unknown>={}){evidence.stage=name;Object.assign(evidence.checks,details);await persist();process.stdout.write(JSON.stringify({stage:name,...details})+'\n');}
const delay=(milliseconds:number)=>new Promise(resolve=>setTimeout(resolve,milliseconds));
async function inspectExistingRun(){
  const metadata=JSON.parse(await readFile(path.join(runRoot,'control-plane/annotation-tasks.json'),'utf8')) as {tasks:AnnotationTaskView[]};
  const config=loadConfig({DEMO_MODE:'false',DEMO_DATA_FILE:path.join(runRoot,'control-plane/state.json'),OXEN_SERVER_URL:'http://127.0.0.1:3002',OXEN_NAMESPACES:'local'}),provider=new LiveProvider(config);await provider.init();
  const raw=provider.raw.bind(provider);provider.raw=async(repository,ref,filename)=>{try{return await raw(repository,ref,filename);}catch(error){if(error instanceof Error)error.message=`fixed-read failed: ${ref}/${filename}; ${(error as {code?:string}).code??'ERROR'}`;throw error;}};
  for(const task of metadata.tasks)for(const participant of task.participants){const branch=(await provider.branches(key)).find(item=>item.name===participant.branch);if(!branch)continue;try{const snapshot=await new DatasetService(provider).read(key,branch.commitId),unexpected=snapshot.labelRecords.filter(record=>record.scope==='row'&&record.actor.id!==participant.id);process.stdout.write(JSON.stringify({inspection:'fresh-materialization',branch:participant.branch,commitId:branch.commitId,rows:snapshot.totalRows,rowLabelRecords:snapshot.labelRecords.filter(record=>record.scope==='row').length,unexpectedRowActors:unexpected.map(record=>record.actor.id),ok:!unexpected.length})+'\n');if(unexpected.length)process.exitCode=1;}catch(error){process.stdout.write(JSON.stringify({inspection:'fresh-materialization',branch:participant.branch,commitId:branch.commitId,ok:false,error:(error as Error).message})+'\n');process.exitCode=1;}}
}
async function main(){
  await mkdir(path.dirname(runRoot),{recursive:true});const actualParent=await realpath(path.dirname(runRoot)),intendedParent=path.resolve(projectRoot,'.data/r2-acceptance');assert.equal(actualParent.toLowerCase(),intendedParent.toLowerCase(),'acceptance directory must not resolve through an external junction');await mkdir(runRoot);const versionResponse=await fetch('http://127.0.0.1:3002/api/version',{redirect:'error',signal:AbortSignal.timeout(5000)});const version=await versionResponse.json() as {oxen_version?:string};assert.equal(version.oxen_version,'0.67.0');
  process.env.OXEN_CONFIG_DIR=path.join(projectRoot,'infra/oxen/config/client');
  const config=loadConfig({DEMO_MODE:'false',DEMO_DATA_FILE:path.join(runRoot,'control-plane/state.json'),OXEN_SERVER_URL:'http://127.0.0.1:3002',OXEN_NAMESPACES:'local',OXEN_CLI_ROOT:path.join(runRoot,'clones'),OXEN_CLI_BIN:path.join(projectRoot,'infra/oxen/bin/oxen.exe'),OXEN_CLI_TIMEOUT_MS:'180000',BFF_TOKEN:ownerToken});
  const provider=new LiveProvider(config);await provider.init();const app=await createApp(config,provider);
  const inject=async(method:'GET'|'POST'|'PATCH'|'DELETE',url:string,payload?:unknown,token=ownerToken)=>app.inject({method,url,headers:{authorization:`Bearer ${token}`},...(payload===undefined?{}:{payload:payload as object})});
  const api=async<T=any>(method:'GET'|'POST'|'PATCH'|'DELETE',url:string,payload?:unknown,expected=200,token=ownerToken):Promise<T>=>{const response=await inject(method,url,payload,token);if(response.statusCode!==expected){let error:any;try{error=response.json().error;}catch{}throw new Error(scrub(`${method} ${url} returned ${response.statusCode}, expected ${expected}: ${error?.code??'HTTP_ERROR'} ${error?.message??''}${error?.details?.upstreamPath?' upstream='+error.details.upstreamPath:''}`));}return response.statusCode===204?undefined as T:response.json() as T;};
  const head=async(repo=key,branch='main')=>(await provider.branches(repo)).find(item=>item.name===branch)!.commitId;
  const page=async(branch='main',location=base,token=ownerToken)=>api<DatasetPage>('GET',`${location}/dataset?ref=${encodeURIComponent(branch)}&pageSize=200`,undefined,200,token);
  const grant=async(location:string,name:string,role:string)=>{const result=await api<{collaborator:{id:string};token:string}>('POST',`${location}/access`,{name,role},201);secrets.push(result.token);return result;};
  const save=async(branch:string,operations:DatasetOperation[],token=ownerToken)=>api<{commitId:string}>('POST',`${base}/dataset/save`,{ref:branch,expectedCommit:await head(key,branch),message:'Synthetic live acceptance changes',operations},200,token);
  const pollJob=async(id:string)=>{const deadline=Date.now()+240000;for(;;){const job=await api('GET',`/api/jobs/${id}`);if(job.status==='succeeded')return job;if(job.status==='failed')throw new Error(scrub('Merge job failed: '+(job.error??'unknown')));if(Date.now()>deadline)throw new Error('Merge job timeout; inspect the isolated repository before retrying.');await delay(200);}};
  try{
    assert.equal((await api('GET','/api/health')).mode,'live');await stage('live-configuration',{oxenVersion:version.oxen_version,sourceRepository:`local/${sourceName}`});
    await api('POST','/api/repos',{namespace:'local',name:sourceName,description:'Synthetic R2 acceptance fixture; not user benchmark data.',visibility:'private'},201);
    const archiveA=storedZip([{name:'SKILL.md',content:Buffer.from('# Synthetic acceptance skill A\nDo not execute this fixture.\n')},{name:'notes.txt',content:Buffer.from('Synthetic attachment A.')}],1024*1024),archiveB=storedZip([{name:'SKILL.md',content:Buffer.from('# Synthetic acceptance skill B\nFixture only.\n')}],1024*1024);
    const rows=Array.from({length:6},(_,index)=>({id:`synthetic-${index+1}`,text:`Synthetic sample ${index+1} A😀BC`,ground_truth:{result:'synthetic-source-truth',index},steps:[{tool:'fixture',argument:`item-${index}`}],package_path:index<3?'attachments/skill-a.zip':'attachments/skill-b.zip',package_sha256:'0'.repeat(64)}));
    const baseline=Buffer.from(rows.map(row=>JSON.stringify(row)).join('\n')+'\n'),originalZip=storedZip([{name:'samples.jsonl',content:baseline},{name:'skill-a.zip',content:archiveA},{name:'skill-b.zip',content:archiveB}],4*1024*1024);
    const workspace=await provider.createWorkspace(key,'Initialize synthetic six-row dataset','main');const expected=await head();
    for(const [filename,content]of new Map([['data/samples.jsonl',baseline],['bundle-manifest.json',Buffer.from(JSON.stringify({canonical_data:'data/samples.jsonl',files:[{path:'source/archives/synthetic-source.zip',sha256:sha256(originalZip)}]}))],['README.md',Buffer.from('# Synthetic R2 acceptance dataset\n\nSix synthetic records for workflow, review and release verification.\n')],['attachments/skill-a.zip',archiveA],['attachments/skill-b.zip',archiveB],['source/archives/synthetic-source.zip',originalZip]]))await provider.writeWorkspace(key,workspace.id,filename,content);
    const initial=await provider.commitWorkspace(key,workspace.id,'Initialize synthetic acceptance sources',expected);await provider.deleteWorkspace(key,workspace.id);
    assert.equal(sha256((await provider.raw(key,initial.id,'source/archives/synthetic-source.zip')).content),sha256(originalZip));assert.equal(sha256((await provider.raw(key,initial.id,'attachments/skill-a.zip')).content),sha256(archiveA));
    const workers=[await grant(base,'Synthetic editor','editor'),await grant(base,'Synthetic annotator','annotator')],reviewer=await grant(base,'Synthetic independent reviewer','reviewer');
    const org='/api/governance/organizations/local';
    const dimensionDefinitions=[{id:'risk',displayName:'Risk',type:'single',description:'Synthetic review decision.',options:[{id:'benign',displayName:'Benign'},{id:'uncertain',displayName:'Uncertain'}]},{id:'note',displayName:'Context',type:'text',description:'Synthetic scope context.',options:[]}];
    for(const draft of dimensionDefinitions){const dimension=await api<GovernanceDimension>('POST',org+'/dimensions',{draft,expectedRevision:0});await api('POST',org+`/dimensions/${draft.id}/publish`,{expectedRevision:dimension.revision});}
    const template=await api<GovernanceTemplate>('POST',org+'/templates',{draft:{id:'r2_live',name:'Synthetic live review',domain:'acceptance',description:'Synthetic local-only template.',bindings:[{dimensionId:'risk',dimensionVersion:1,scopes:['row'],required:true,order:0},{dimensionId:'note',dimensionVersion:1,scopes:['dataset','file','row'],required:false,order:1}]},expectedRevision:0});
    await api('POST',org+'/templates/r2_live/publish',{expectedRevision:template.revision});
    await api('POST',base+'/schema/binding',{ref:'main',expectedCommit:await head(),organizationId:'local',templateId:'r2_live',templateVersion:1});
    await save('main',[{op:'assign',scope:'dataset',values:{note:'Synthetic six-row dataset'}},{op:'assign',scope:'file',path:'attachments/skill-a.zip',values:{note:'Synthetic attachment A context'}},{op:'assign',scope:'file',path:'attachments/skill-b.zip',values:{note:'Synthetic attachment B context'}}]);
    const beforeTasks=await page(),taskBaseline=await head();assert.equal(beforeTasks.totalRows,6);assert.equal(beforeTasks.attachments.length,2);
    await stage('initialized-and-governed',{initialCommit:initial.id,baselineCommit:taskBaseline,baselineSha256:sha256(baseline),sampleCount:6,attachmentCount:2});
    const tasks=await api<AnnotationTaskView[]>('POST',base+'/tasks',{title:'Synthetic live task allocation',ref:'main',expectedCommit:taskBaseline,assigneeIds:workers.map(person=>person.collaborator.id),reviewerId:reviewer.collaborator.id,mode:'review',branchPrefix:'r2/live'},201);assert.deepEqual(tasks.map(task=>task.rowIds.length),[3,3]);if(tasks.some(task=>task.status!=='assigned'))throw new Error('Native task branch setup failed: '+tasks.map(task=>task.setupError??task.status).join('; '));
    for(const [index,task]of tasks.entries()){
      const worker=workers[index]!,branch=task.participants[0]!.branch,view=await page(branch,base,worker.token),operations:DatasetOperation[]=[];
      for(const [position,rowId]of task.rowIds.entries()){
        const row=view.rows[view.rowIds.indexOf(rowId)]!,updated=index===0&&position===0?{...row,text:String(row.text)+' edited by assigned editor'}:row;
        if(updated!==row)operations.push({op:'update',rowId,record:updated,expectedContentHash:view.contentHashes[rowId]});
        const emojiStart=Array.from(String(updated.text)).indexOf('😀');assert.ok(emojiStart>=0);
        operations.push({op:'assign',scope:'row',rowId,values:{risk:'benign',note:'Synthetic human annotation'},spans:[{id:`span-${position}`,pointer:'/text',sourceHash:datasetHash(updated.text),start:emojiStart,end:emojiStart+1,values:{risk:'benign'},note:'Synthetic Unicode code-point evidence'}],steps:[{id:`step-${position}`,pointer:'/steps/0',sourceHash:datasetHash((updated.steps as unknown[])[0]),values:{risk:'benign'}}]});
      }
      operations.push({op:'assign',scope:'file',path:index===0?'attachments/skill-a.zip':'attachments/skill-b.zip',values:{note:index===0?'Synthetic attachment A context':'Synthetic attachment B context'}});
      const saved=await save(branch,operations,worker.token);
      assert.equal((await page(branch,base,worker.token)).labelConflicts.length,0,'The basic success fixture must not introduce an unadjudicated file-label conflict.');
      const denied=await inject('POST',base+'/dataset/save',{ref:branch,expectedCommit:saved.commitId,message:'Synthetic forbidden scope',operations:[{op:'assign',scope:'row',rowId:tasks[1-index]!.rowIds[0],values:{risk:'benign'}}]},worker.token);assert.equal(denied.statusCode,403);
      const current=await api<AnnotationTaskView>('GET',base+`/tasks/${task.id}`,undefined,200,worker.token),submitted=await api<AnnotationTaskView>('POST',base+`/tasks/${task.id}/submit`,{expectedRevision:current.revision,expectedCommit:saved.commitId},200,worker.token);
      const rejectedOwn=await inject('POST',base+`/tasks/${task.id}/review`,{expectedRevision:submitted.revision,decisions:task.rowIds.map(rowId=>({rowId,verdict:'approved',comment:''}))},worker.token);assert.equal(rejectedOwn.statusCode,403);
      const reviewed=await api<AnnotationTaskView>('POST',base+`/tasks/${task.id}/review`,{expectedRevision:submitted.revision,decisions:task.rowIds.map(rowId=>({rowId,verdict:'approved',comment:'Synthetic independent reviewer approval'}))},200,reviewer.token);assert.equal(reviewed.progress.approved,3);
    }
    await stage('independent-review-complete',{taskCount:tasks.length,annotators:2,reviewers:1,outOfScopeDenied:true,selfReviewDenied:true});
    const tracked=new Set<string>();
    const collectPaths=async(commit:string,directory='')=>{for(const entry of await provider.tree(key,commit,directory)){if(entry.kind==='directory')await collectPaths(commit,entry.path);else tracked.add(entry.path);if(tracked.size>100000)throw new Error('Synthetic native path preflight exceeded its complete-list limit.');}};
    for(const branch of ['main',...tasks.map(task=>task.participants[0]!.branch)])await collectPaths(await head(key,branch));
    const cloneBases=[path.join(config.cliRoot,key.namespace,key.repo),path.join(config.cliRoot,key.namespace,'.provision-'+'0'.repeat(36))],maxClonePath=Math.max(...[...tracked].flatMap(filename=>cloneBases.map(root=>path.join(root,filename).length))),maxCloneTemporary=maxClonePath+20;
    if(process.platform==='win32')assert.ok(maxCloneTemporary<260,`Tracked checkout temporary path would exceed the pinned Windows CLI limit (${maxCloneTemporary} characters).`);
    await stage('native-path-preflight',{trackedPaths:tracked.size,maxClonePathCharacters:maxClonePath,maxCloneTemporaryCharacters:maxCloneTemporary});
    const requests=[];
    for(const [index,task]of tasks.entries()){const branch=task.participants[0]!.branch,comparison=await api('GET',base+'/merge-requests/compare'+`?source=${encodeURIComponent(branch)}&target=main`);assert.equal(comparison.canCreate,true);requests.push(await api('POST',base+'/merge-requests',{title:`Synthetic task ${index+1}`,description:'Synthetic acceptance request',source:branch,target:'main',expectedSourceCommitId:comparison.sourceCommitId,expectedTargetCommitId:comparison.targetCommitId},201,workers[index]!.token));}
    for(const [index,request]of requests.entries()){
      const refreshed=await api('POST',base+`/merge-requests/${request.id}/refresh`,{expectedRevision:request.revision});
      const queued=await api('POST',base+`/merge-requests/${request.id}/merge`,{expectedRevision:refreshed.revision,expectedSourceCommitId:refreshed.sourceCommitId,expectedTargetCommitId:refreshed.targetCommitId});
      await pollJob(queued.job.id);const merged=await api('GET',base+`/merge-requests/${request.id}`);assert.equal(merged.status,'merged');await stage(`native-merge-${index+1}`,{[`merge${index+1}Commit`]:merged.mergedCommitId});
    }
    const main=await page(),preflight=await api('GET',base+'/workflow/preflight?ref=main');assert.equal(preflight.ok,true,JSON.stringify(preflight.issues));assert.equal(Object.keys(preflight.acceptedValues).length,6);assert.equal(main.totalRows,6);assert.equal(sha256((await provider.raw(key,main.commitId,'data/samples.jsonl')).content),sha256(baseline));assert.equal(sha256((await provider.raw(key,main.commitId,'source/archives/synthetic-source.zip')).content),sha256(originalZip));
    assert.equal(main.rows.filter(row=>String(row.text).includes('edited by assigned editor')).length,1);assert.equal(main.labelRecords.filter(record=>record.scope==='row').length,6);
    const fixed=main.commitId;let release=await api<DatasetRelease>('POST',base+'/releases',{version:'v1.0.0',title:'Synthetic official Oxen R2 acceptance',notes:'Synthetic end-to-end acceptance; six records, independent review, native merge and portable package.',sourceRef:fixed,includeArchives:true},201);
    release=await api<DatasetRelease>('POST',base+`/releases/${release.id}/build`,{expectedRevision:release.revision});
    const deadline=Date.now()+120000;while(!['ready','failed'].includes(release.status)){if(Date.now()>deadline)throw new Error('Release build timed out.');await delay(200);release=await api('GET',base+`/releases/${release.id}`);}if(release.status!=='ready')throw new Error(scrub('Release build failed: '+release.error));
    release=await api<DatasetRelease>('POST',base+`/releases/${release.id}/publish`,{expectedRevision:release.revision});assert.equal(release.status,'published');assert.equal(release.commitId,fixed);
    const asset=release.assets.find(item=>item.mime==='application/zip')!;assert.ok(asset);const downloaded=await inject('GET',base+`/releases/${release.id}/assets/${asset.id}`);assert.equal(downloaded.statusCode,200);const artifact=downloaded.rawPayload;assert.equal(sha256(artifact),asset.sha256);assert.equal(artifact.length,asset.size);await writeFile(path.join(runRoot,'synthetic-release.zip'),artifact);
    const members=await readZipMembers(artifact),memberMap=new Map(members.map(item=>[item.name,item])),checksum=memberMap.get('checksums.sha256')!.content.toString('utf8'),declared=new Set<string>();for(const line of checksum.split('\n').filter(Boolean)){const match=/^([a-f0-9]{64})  (.+)$/.exec(line);assert.ok(match);assert.equal(memberMap.get(match[2]!)?.sha256,match[1]);declared.add(match[2]!);}assert.ok(members.filter(member=>member.type==='file'&&member.name!=='checksums.sha256').every(member=>declared.has(member.name)));assert.ok(members.some(member=>member.name.startsWith('provenance/original-archives/')&&member.sha256===sha256(originalZip)));
    for(const required of ['README.md','dataset.json','schema.json','samples.jsonl','labels.json','CHANGELOG.md'])assert.ok(memberMap.has(required));
    const exportedRows=memberMap.get('samples.jsonl')!.content.toString('utf8').trim().split('\n').map(line=>JSON.parse(line));assert.equal(exportedRows.length,6);assert.ok(exportedRows.every(row=>row.annotation_status==='accepted'&&row.annotations.risk==='benign'&&row.fine_annotations.spans.length===1&&row.fine_annotations.steps.length===1));assert.ok(exportedRows.every(row=>Array.from(String(row.data.text)).slice(row.fine_annotations.spans[0].start,row.fine_annotations.spans[0].end).join('')==='😀'));assert.equal(exportedRows.filter(row=>String(row.data.text).includes('edited by assigned editor')).length,1);
    await stage('published-and-verified',{fixedCommit:fixed,releaseId:release.id,releaseVersion:release.version,artifactSha256:asset.sha256,artifactBytes:asset.size,archiveMembers:members.length,checksumsVerified:true,baselineUnchanged:true});
    const boundary='r2-'+randomUUID(),multipart=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic-release.zip"\r\nContent-Type: application/zip\r\n\r\n`),artifact,Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const inspectedResponse=await app.inject({method:'POST',url:'/api/import/zip',headers:{authorization:`Bearer ${ownerToken}`,'content-type':`multipart/form-data; boundary=${boundary}`},payload:multipart});assert.equal(inspectedResponse.statusCode,200);const inspected=inspectedResponse.json();assert.ok(inspected.candidates.some((item:any)=>item.mode==='release'));
    const mapping={mode:'release',paths:['dataset.json']},plan=await api('POST',`/api/import/zip/${inspected.id}/plan`,mapping),imported=await api('POST',`/api/import/zip/${inspected.id}/commit`,{mapping,fingerprint:plan.fingerprint,namespace:'local',repo:importName,branch:'main',createRepository:true,description:'Synthetic portable release reimport fixture'});
    const importedBase=`/api/repos/local/${importName}`,restored=await page('main',importedBase);assert.equal(restored.totalRows,6);assert.deepEqual(restored.rowIds,main.rowIds);assert.deepEqual(restored.rows,main.rows);assert.equal(restored.labels.assignments.filter(item=>item.scope==='row').length,6);assert.equal(restored.attachments.length,2);
    for(const attachment of restored.attachments){const left=(await provider.raw(key,fixed,attachment.path)).content,right=(await provider.raw({namespace:'local',repo:importName},restored.commitId,attachment.path)).content;assert.equal(sha256(left),sha256(right));}
    await stage('portable-roundtrip-complete',{roundtripCommit:imported.commitId,roundtripRows:restored.totalRows,stableIdentitiesPreserved:true,sourceFieldsPreserved:true,attachmentBytesPreserved:true});
    const allocationKey={namespace:'local',repo:allocationName},allocationBase=`/api/repos/local/${allocationName}`;
    await api('POST','/api/repos',{namespace:'local',name:allocationName,description:'Synthetic 1000-row task allocation only.',visibility:'private'},201);
    const allocationWorkspace=await provider.createWorkspace(allocationKey,'Synthetic 1000 rows','main'),allocationBaseHead=await head(allocationKey);
    await provider.writeWorkspace(allocationKey,allocationWorkspace.id,'data/samples.jsonl',Buffer.from(Array.from({length:1000},(_,index)=>JSON.stringify({id:`allocation-${index}`,text:'Synthetic allocation only'})).join('\n')+'\n'));
    await provider.writeWorkspace(allocationKey,allocationWorkspace.id,'bundle-manifest.json',Buffer.from(JSON.stringify({canonical_data:'data/samples.jsonl'})));await provider.commitWorkspace(allocationKey,allocationWorkspace.id,'Synthetic allocation baseline',allocationBaseHead);await provider.deleteWorkspace(allocationKey,allocationWorkspace.id);
    const allocationWorkers=[];for(let i=0;i<3;i++)allocationWorkers.push(await grant(allocationBase,`Synthetic allocation worker ${i+1}`,'annotator'));
    const allocated=await api<AnnotationTaskView[]>('POST',allocationBase+'/tasks',{title:'Synthetic 1000-row balanced assignment',ref:'main',expectedCommit:await head(allocationKey),assigneeIds:allocationWorkers.map(person=>person.collaborator.id),reviewerId:'owner',mode:'review',branchPrefix:'r2/allocation'},201);assert.deepEqual(allocated.map(task=>task.rowIds.length),[334,333,333]);assert.equal(new Set(allocated.flatMap(task=>task.rowIds)).size,1000);
    await stage('allocation-1000-complete',{allocationCounts:allocated.map(task=>task.rowIds.length),allocationUniqueRows:1000});
    evidence.status='passed';await stage('complete',{sourceUrl:`http://127.0.0.1:5173/repos/local/${sourceName}/table`,roundtripUrl:`http://127.0.0.1:5173/repos/local/${importName}/table`,isolatedControlPlane:true});
  }catch(error){evidence.status='failed';evidence.error=scrub(error instanceof Error?error.message:String(error));await persist();throw new Error(evidence.error);}finally{await app.close();}
}
if(inspectRun)await inspectExistingRun().catch(error=>{process.stderr.write(JSON.stringify({inspection:'failed',error:(error as Error).message})+'\n');process.exitCode=1;});
else await main().catch(async error=>{evidence.status='failed';evidence.error=scrub(error.message);await persist().catch(()=>{});process.stderr.write(JSON.stringify({status:'failed',stage:evidence.stage,error:evidence.error,evidence:path.join(runRoot,'verification.json')})+'\n');process.exitCode=1;});
