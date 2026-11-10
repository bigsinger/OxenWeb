/** Recovery-only probes. Expected values come from ONE verified backup generation.
 * Reads real restored BFF routes; never prints bodies, names, token values or signed paths.
 * All temporary grants/restores affect only the caller's isolated recovery copy.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import {lstat,readFile} from 'node:fs/promises';
import type {FastifyInstance,InjectOptions} from 'fastify';
import type {BackupManifest} from '../apps/server/src/backup.js';
import type {Provider,RepoKey} from '../apps/server/src/provider.js';
import {datasetHash} from '../apps/server/src/dataset-storage.js';
import {sha256} from '../apps/server/src/zip-io.js';
import {workflowHash} from '../apps/server/src/workflow.js';
import {inspectReleaseRetention} from '../apps/server/src/release-retention.js';

type RecordValue=Record<string,any>;
const base=(key:RepoKey)=>'/api/repos/'+encodeURIComponent(key.namespace)+'/'+encodeURIComponent(key.repo);
const same=(a:RepoKey,b:RepoKey)=>a.namespace===b.namespace&&a.repo===b.repo;
const select=(value:RecordValue,keys:string[])=>Object.fromEntries(keys.map(key=>[key,value[key]]));
const equal=(actual:unknown,expected:unknown,check:string)=>assert.equal(datasetHash(actual),datasetHash(expected),check);

/** Recovery only serves current dataset publications. Purged history never gets a DTO. */
export function recoveredReleaseProjection(expected:RecordValue){
  assert.equal(expected.publishingVersion,'dataset-v1','Only the current dataset release format may be restored');
  return select(expected,Object.keys(expected).filter(key=>!['identity','fingerprint','sourceFingerprint','attemptId','memberships'].includes(key)));
}
export class RecoveryControlCheckError extends Error {
  constructor(readonly check:string){super('RECOVERY_CONTROL_'+check);}
}

export async function verifyRecoveredControl(options:{app:FastifyInstance;provider:Provider;backup:string;manifest:BackupManifest;restoreRoot:string;control:string;ownerToken:string}){
  const {app,provider,backup,manifest,restoreRoot,control,ownerToken}=options;
  let phase='LOAD_EXPECTED';const issuedIds=new Set<string>();
  const rememberCredential=(token:string)=>{const id=/^oxw_([a-f0-9-]{36})\./.exec(token)?.[1];assert.ok(id,'Verification credential format');issuedIds.add(id);};
  try{
    const sourceFiles=(id:string)=>manifest.files.filter(file=>file.sourceId===id);
    const sourceJson=async(id:string,fallback:RecordValue,suffix?:string):Promise<RecordValue>=>{
      const files=sourceFiles(id).filter(file=>!suffix||file.path.endsWith('/'+suffix));
      if(!files.length){const source=manifest.sources.find(source=>source.id===id);assert.ok(!source||source.directory&&sourceFiles(id).length===0,'A declared control source has no expected record');return fallback;}
      assert.equal(files.length,1,'Expected one control record');
      return JSON.parse(await readFile(path.join(backup,...files[0]!.path.split('/')),'utf8'));
    };
    const taskState=await sourceJson('annotation-tasks',{tasks:[]}),mrState=await sourceJson('merge-requests',{requests:[]}),releaseState=await sourceJson('releases',{releases:[],shares:[]},'records.json'),recycleState=await sourceJson('repository-recycle-bin',{entries:[]}),credentialState=await sourceJson('access-credentials',{credentials:[]});
    const evaluationState=await sourceJson('evaluation-policy',{version:1,projects:{}});let evaluationPoliciesVerified=0;
    const privateRecords:Array<{kind:'draft'|'ui';file:string;expected:RecordValue;sha256:string}>=[];
    for(const [id,kind]of [['dataset-drafts','draft'],['dataset-ui-state','ui']] as const)for(const file of sourceFiles(id)){
      // An interrupted temporary file is retained by the backup, but is not a readable checkpoint.
      if(!file.path.endsWith('.json'))continue;
      const expected=JSON.parse(await readFile(path.join(backup,...file.path.split('/')),'utf8'));
      assert.equal(expected.version,1,'Private recovery format');assert.equal(typeof expected.owner,'string','Private owner');
      assert.ok(expected.namespace&&expected.repo&&(kind==='draft'?expected.draft:expected.state),'Private recovery envelope');
      privateRecords.push({kind,file:file.path,expected,sha256:file.sha256});
    }
    const response=async(method:'GET'|'POST',url:string,credential=ownerToken,payload?:InjectOptions['payload'])=>app.inject({method,url,headers:{authorization:'Bearer '+credential},...(payload===undefined?{}:{payload})});
    const json=async(method:'GET'|'POST',url:string,payload?:InjectOptions['payload'],credential=ownerToken,expectedStatus=200):Promise<RecordValue>=>{
      const result=await response(method,url,credential,payload);assert.equal(result.statusCode,expectedStatus,'Restored BFF status');return result.json();
    };
    const counts={tasks:0,taskSubmissionFingerprints:0,taskReviewFingerprints:0,reviewProofsReadViaBff:0,currentSubmittedTasks:0,staleSubmittedTasks:0,mergeRequests:0,interruptedMergesFailClosed:0,releases:0,snapshots:0,releaseAssetsReadViaBff:0,releaseAssetBytes:0,retainedAssetsVerified:0,purgedReleaseIdsVerified:0,purgedAssetFilesVerified:0,purgedSharesVerified:0,sourceAccessMarkersVerified:0,nonReadyAssetsBlocked:0,interruptedBuildsFailClosed:0,sharesDisabled:0,recycleEntries:0,removedProjectsOpenedInIsolatedCopy:0,privateDraftsReadAsOriginalActor:0,uiCheckpointsReadAsOriginalActor:0,privateCrossActorIsolationChecks:0,verificationCredentialsReissued:0,verificationInstanceCredentialsReissued:0,protectedHistoricalPrivateStates:0,protectedHistoricalActorKinds:0,protectedHistoricalNoMembership:0,protectedHistoricalNoActiveCredential:0};

    phase='CREDENTIAL_REVOCATION';
    const restoredCredentialFile=sourceFiles('access-credentials')[0];
    if(restoredCredentialFile){const restored=JSON.parse(await readFile(path.join(restoreRoot,...restoredCredentialFile.path.split('/')),'utf8'));assert.equal(restored.credentials.length,credentialState.credentials.length,'Credential identities retained');assert.ok(restored.credentials.every((item:RecordValue)=>item.revokedAt),'Old credentials revoked');equal(restored.credentials.map((item:RecordValue)=>select(item,['id','actorId','name','scope','globalRole','hash'])),credentialState.credentials.map((item:RecordValue)=>select(item,['id','actorId','name','scope','globalRole','hash'])),'Credential actors and scopes retained');}

    phase='RECYCLE_BIN';
    const removed=await json('GET','/api/repository-recycle-bin');
    equal((removed as unknown as RecordValue[]).map(item=>item.removalId).sort(),recycleState.entries.filter((item:RecordValue)=>item.removed).map((item:RecordValue)=>item.id).sort(),'Recycle entries visible via BFF');
    for(const expected of recycleState.entries as RecordValue[]){
      const key={namespace:expected.namespace,repo:expected.name},state=await json('GET',base(key)+'/lifecycle');
      equal(select(state,['namespace','name','revision','status']),{namespace:expected.namespace,name:expected.name,revision:expected.revision,status:expected.removed?'removed':'active'},'Lifecycle metadata');counts.recycleEntries++;
      if(expected.removed){
        equal(select(state,['removalId','removedAt','removedBy']),{removalId:expected.id,removedAt:expected.removedAt,removedBy:expected.removedBy},'Removal actor and revision');
        assert.equal((await response('GET',base(key)+'/dataset?ref=main')).statusCode,410,'Removed project remains blocked');
        // Explicitly open only this disposable restored copy so its retained records can be read.
        await json('POST',base(key)+'/lifecycle/restore',{confirmation:key.namespace+'/'+key.repo,removalId:state.removalId,revision:state.revision});counts.removedProjectsOpenedInIsolatedCopy++;
      }
    }

    phase='EVALUATION_POLICY';
    for(const [repository,expected] of Object.entries(evaluationState.projects) as Array<[string,RecordValue]>){
      const segments=repository.split('/');assert.equal(segments.length,2,'Evaluation policy repository key');
      const actual=await json('GET',base({namespace:segments[0]!,repo:segments[1]!})+'/dataset/evaluation/policy');
      equal(actual,expected,'Sticky evaluation policy and original enabling actor survive recovery');evaluationPoliciesVerified++;
    }

    phase='TASKS_AND_REVIEW_PROOFS';
    for(const expected of taskState.tasks as RecordValue[]){
      const actual=await json('GET',base(expected as RepoKey)+'/tasks/'+encodeURIComponent(expected.id));
      // status/progress are a computed view, not a stored approval. Every stored semantic field,
      // including all participant IDs, reviewer, submissions, decisions and fingerprints, must match.
      equal(select(actual,Object.keys(expected).filter(key=>key!=='status')),select(expected,Object.keys(expected).filter(key=>key!=='status')),'Task identities, assignments and review fingerprints');
      if(['merged','cancelled','setup-failed','setting-up'].includes(expected.status))assert.equal(actual.status,expected.status,'Terminal task state');
      counts.tasks++;counts.taskSubmissionFingerprints+=expected.submissions.reduce((sum:number,item:RecordValue)=>sum+Object.keys(item.fingerprints).length,0);
      if(expected.submissions.length){if(actual.current)counts.currentSubmittedTasks++;else counts.staleSubmittedTasks++;}
      for(const review of expected.reviews as RecordValue[]){
        counts.taskReviewFingerprints+=review.submissions.reduce((sum:number,item:RecordValue)=>sum+Object.keys(item.fingerprints).length,0);
        const result=await response('GET',base(expected as RepoKey)+'/raw?'+new URLSearchParams({ref:review.commitId,path:review.storagePath}));assert.equal(result.statusCode,200,'Review proof raw BFF read');
        const proof=JSON.parse(result.rawPayload.toString('utf8')),{proofHash,...payload}=proof;assert.equal(proofHash,review.proofHash,'Stored review proof identity');assert.equal(workflowHash(payload),review.proofHash,'Review proof canonical fingerprint');
        equal(select(review,Object.keys(payload)),payload,'BFF proof matches task review including actor and decisions');counts.reviewProofsReadViaBff++;
      }
    }

    phase='MERGE_REQUESTS';
    for(const expected of mrState.requests as RecordValue[]){
      const actual=await json('GET',base(expected as RepoKey)+'/merge-requests/'+encodeURIComponent(expected.id)),projection=Object.keys(expected).filter(key=>!['namespace','repo','attemptId'].includes(key));
      if(expected.status==='merging'&&!expected.interrupted){
        equal(select(actual,projection.filter(key=>!['updatedAt','revision','mergeError'].includes(key))),{...select(expected,projection.filter(key=>!['updatedAt','revision','mergeError'].includes(key))),...('interrupted' in expected?{interrupted:true}:{})},'Interrupted MR immutable metadata');
        assert.equal(actual.interrupted,true,'Interrupted merge requires reconciliation');assert.equal(actual.revision,expected.revision+1,'Interrupted merge revision');counts.interruptedMergesFailClosed++;
      }else equal(select(actual,projection),select(expected,projection),'Merge request author, comments, heads and state');
      counts.mergeRequests++;
    }

    phase='SOURCE_ACCESS_MARKERS';
    const markerFiles=sourceFiles('source-access-markers');
    if(markerFiles.length){assert.equal(markerFiles.length,1,'One generic source-access marker record per generation');const actual=await readFile(path.join(control,'source-access-markers.json'));assert.equal(sha256(actual),markerFiles[0]!.sha256,'Generic source-access protection survives restore');counts.sourceAccessMarkersVerified=JSON.parse(actual.toString('utf8')).repositories.length;}

    phase='RELEASE_RETENTION';let releaseMembershipsVerified=0,exposureLedgerVerified=0;
    const releaseRoot=path.join(control,'releases'),plan=await inspectReleaseRetention(path.join(backup,'data/releases'));
    assert.equal(plan.blockers.length,0,'Verified backup retention plan has no unsafe paths');
    const restoredReleaseRecords=await readFile(path.join(releaseRoot,'records.json'),'utf8').then(value=>JSON.parse(value) as RecordValue).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT'&&releaseState.releases.length===0)return {releases:[],shares:[]} as RecordValue;throw error;});
    const purged=new Set(plan.removeRecords.map(item=>item.id)),tombstones=new Set<string>(restoredReleaseRecords.retention?.purgedReleaseIds??[]),retainedExpected=(releaseState.releases as RecordValue[]).filter(item=>!purged.has(item.id)),retainedShares=(releaseState.shares as RecordValue[]).filter(item=>!purged.has(item.releaseId));
    equal(restoredReleaseRecords.releases.map((item:RecordValue)=>item.id).sort(),retainedExpected.map(item=>item.id).sort(),'Only the latest published dataset release, current drafts and current snapshots remain readable');
    if(plan.candidates.length){assert.equal(restoredReleaseRecords.retention?.pending.length,0,'Interrupted purge cleanup is completed before recovery passes');for(const item of plan.candidates)assert.ok(tombstones.has(item.releaseId),'Every intentionally purged release has an explicit UUID deletion proof');}
    for(const id of releaseState.retention?.purgedReleaseIds??[])assert.ok(tombstones.has(id),'Existing deletion proofs must not roll back');
    assert.ok((restoredReleaseRecords.retention?.revision??0)>=(releaseState.retention?.revision??0),'Retention proof revision must not roll back');
    assert.ok((restoredReleaseRecords.retention?.exposureRevision??0)>=(releaseState.retention?.exposureRevision??0),'Required permanent safety revision must not roll back');
    for(const project of plan.projects)if(project.keepReleaseId){const kept=restoredReleaseRecords.releases.find((item:RecordValue)=>item.id===project.keepReleaseId);assert.ok(kept?.latest,'The newest published record is the sole latest version');}
    const restoredShares=restoredReleaseRecords.shares??[];equal(restoredShares.map((item:RecordValue)=>item.id).sort(),retainedShares.map(item=>item.id).sort(),'Purged release links disappear and retained sharing identities remain');assert.ok(restoredShares.every((item:RecordValue)=>item.revokedAt),'All restored retained share grants are revoked');
    for(const expected of retainedShares){const restored=restoredShares.find((item:RecordValue)=>item.id===expected.id);equal(select(restored,Object.keys(expected).filter(key=>key!=='revokedAt')),select(expected,Object.keys(expected).filter(key=>key!=='revokedAt')),'Share issuer, hash and scope remain intact');if(expected.revokedAt)assert.equal(restored.revokedAt,expected.revokedAt,'Previously revoked share remains revoked');}
    counts.sharesDisabled=restoredShares.length;counts.purgedSharesVerified=releaseState.shares.length-retainedShares.length;
    for(const asset of plan.assetFiles){assert.equal(await lstat(path.join(releaseRoot,...asset.relativePath.split('/'))).then(()=>true,error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}),false,'Intentionally purged artifact bytes cannot reappear in active storage');counts.purgedAssetFilesVerified++;}
    const ledgerFile=sourceFiles('releases').find(file=>file.path.endsWith('/exposure-ledger.json')),expectedLedger=ledgerFile?JSON.parse(await readFile(path.join(backup,...ledgerFile.path.split('/')),'utf8')):{version:1,revision:0,projects:[]},actualLedger=await readFile(path.join(releaseRoot,'exposure-ledger.json'),'utf8').then(value=>JSON.parse(value) as RecordValue).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT'&&!restoredReleaseRecords.retention?.exposureRevision)return {version:1,revision:0,projects:[]};throw error;});
    assert.ok(actualLedger.revision>=(restoredReleaseRecords.retention?.exposureRevision??0),'Release deletion never rolls back the permanent exposure safety ledger');
    assert.ok(actualLedger.revision>=expectedLedger.revision,'Permanent safety ledger revision is monotonic across restore');
    for(const project of expectedLedger.projects as RecordValue[]){const actual=actualLedger.projects.find((item:RecordValue)=>same(item as RepoKey,project as RepoKey));assert.ok(actual,'Permanent safety summary project retained');for(const field of ['rowIds','familyIds','attachmentHashes','contentHashes'])assert.ok((project[field]??[]).every((value:string)=>(actual[field]??[]).includes(value)),'Published exposure evidence is monotonic even when releases are removed');exposureLedgerVerified++;}

    phase='RELEASES_AND_ASSETS';
    for(const expected of releaseState.releases as RecordValue[]){
      const url=base(expected as RepoKey)+'/'+(expected.kind==='snapshot'?'snapshots':'releases')+'/'+encodeURIComponent(expected.id);
      if(purged.has(expected.id)){assert.ok(tombstones.has(expected.id),'Missing record is explicitly and intentionally purged');assert.equal((await response('GET',url)).statusCode,404,'Removed releases cannot be resurrected through the BFF');for(const asset of expected.assets as RecordValue[])assert.equal((await response('GET',url+'/assets/'+asset.id)).statusCode,404,'Purged artifacts have no download route');counts.purgedReleaseIdsVerified++;continue;}
      const actual=await json('GET',url),expectedDto=recoveredReleaseProjection(expected),projection=Object.keys(expectedDto),stored=restoredReleaseRecords.releases.find((item:RecordValue)=>item.id===expected.id);
      assert.ok(stored,'Retained current release record');for(const privateKey of ['identity','fingerprint','sourceFingerprint','attemptId','memberships'])assert.equal(Object.hasOwn(actual,privateKey),false,'Private release evidence must not enter the DTO');
      const interruptedCurrent=['queued','building'].includes(expected.status),changedKeys=['latest',...(interruptedCurrent?['status','revision','updatedAt','error']:[])],rawProjection=Object.keys(expected).filter(key=>!changedKeys.includes(key));
      equal(select(stored,rawProjection),select(expected,rawProjection),'Retained dataset publication keeps its fixed source, metadata, review and private fingerprints');
      if(expected.memberships){equal(stored.memberships,expected.memberships,'Current publication safety evidence retained');releaseMembershipsVerified++;}
      if(interruptedCurrent){equal(select(actual,projection.filter(key=>!changedKeys.includes(key))),select(expectedDto,projection.filter(key=>!changedKeys.includes(key))),'Interrupted build immutable metadata');assert.equal(actual.status,'failed','Interrupted dataset build fails closed');assert.equal(actual.revision,expected.revision+1,'Interrupted dataset build revision');counts.interruptedBuildsFailClosed++;}
      else equal(select(actual,projection.filter(key=>key!=='latest')),select(expectedDto,projection.filter(key=>key!=='latest')),'Retained complete dataset publication metadata and assets');
      if(expected.kind==='snapshot')counts.snapshots++;else counts.releases++;
      for(const asset of expected.assets as RecordValue[]){
        const file=sourceFiles('releases').find(file=>file.path.endsWith('/assets/'+expected.id+'/'+asset.id));assert.ok(file,'Current release artifact belongs to the same generation');assert.equal(file.sha256,asset.sha256,'Generation asset hash');assert.equal(file.size,asset.size,'Generation asset size');assert.equal(sha256(await readFile(path.join(releaseRoot,'assets',expected.id,asset.id))),asset.sha256,'Restored retained artifact bytes');counts.retainedAssetsVerified++;
        const result=await response('GET',url+'/assets/'+encodeURIComponent(asset.id));
        if(!['ready','published'].includes(actual.status)){assert.equal(result.statusCode,409,'Non-ready artifacts remain blocked');counts.nonReadyAssetsBlocked++;}
        else{assert.equal(result.statusCode,200,'Current dataset artifact download');assert.equal(result.rawPayload.length,asset.size,'Downloaded size');assert.equal(sha256(result.rawPayload),asset.sha256,'Downloaded SHA256');assert.equal(result.headers['x-artifact-sha256'],asset.sha256,'BFF checksum header');counts.releaseAssetsReadViaBff++;counts.releaseAssetBytes+=asset.size;}
      }
      if(expected.kind==='release'){const shares=await json('GET',url+'/shares') as unknown as RecordValue[],original=retainedShares.filter(item=>item.releaseId===expected.id);equal(shares.map(item=>item.id).sort(),original.map(item=>item.id).sort(),'Retained share identities read through BFF');assert.ok(shares.every(item=>item.revokedAt),'Restored sharing remains disabled');}
    }
    phase='PRIVATE_OWNER_READS';
    const accessStates=new Map<string,RecordValue>(),credentials=new Map<string,string>();let isolationCredential:string|undefined;
    const originalActorToken=async(expected:RecordValue):Promise<string|undefined>=>{
      if(expected.owner==='owner:owner')return ownerToken;
      const key={namespace:expected.namespace,repo:expected.repo},scope=key.namespace+'/'+key.repo,cacheKey=scope+'\0'+expected.owner;
      if(credentials.has(cacheKey))return credentials.get(cacheKey)!;
      const separator=expected.owner.indexOf(':'),kind=expected.owner.slice(0,separator),actorId=expected.owner.slice(separator+1);
      if(kind==='owner'){
        const instanceKey='instance\0'+expected.owner;if(credentials.has(instanceKey))return credentials.get(instanceKey)!;
        const known=credentialState.credentials.some((item:RecordValue)=>(item.actorId??item.id)===actorId&&item.globalRole==='administrator'&&!item.revokedAt&&(!item.expiresAt||Date.parse(item.expiresAt)>Date.parse(manifest.cutAt)));
        if(!known){counts.protectedHistoricalNoActiveCredential++;return;}
        const grant=await json('POST','/api/access-management/grants',{scope:'instance',existingActorId:actorId,globalRole:'administrator',expiresAt:new Date(Date.now()+10*60_000).toISOString()},ownerToken,201);rememberCredential(grant.token);
        assert.equal(grant.credential.actorId,actorId,'Reissued instance actor');const me=await json('GET','/api/me/access-tokens',undefined,grant.token);assert.equal(me.identity.id,actorId,'Resolved instance credential actor');assert.equal(me.identity.kind,'owner','Resolved original owner namespace');credentials.set(instanceKey,grant.token);counts.verificationCredentialsReissued++;counts.verificationInstanceCredentialsReissued++;return grant.token;
      }
      if(kind!=='collaborator'){counts.protectedHistoricalActorKinds++;return;}
      if(!accessStates.has(scope))accessStates.set(scope,await json('GET',base(key)+'/access'));
      const member=accessStates.get(scope)!.collaborators.find((item:RecordValue)=>item.id===actorId);
      if(!member){counts.protectedHistoricalNoMembership++;return;}
      const known=credentialState.credentials.some((item:RecordValue)=>(item.actorId??item.id)===actorId&&!item.revokedAt&&(!item.expiresAt||Date.parse(item.expiresAt)>Date.parse(manifest.cutAt))&&!item.globalRole&&(!item.scope||same(item.scope,key)));
      if(!known){counts.protectedHistoricalNoActiveCredential++;return;}
      // Same membership, capabilities and stable actor: issuing a verification credential must not
      // create a policy commit or reactivate former members. Raw token is held in memory only.
      const before=await provider.branches(key),grant=await json('POST','/api/access-management/grants',{scope:'project',repository:key,existingActorId:actorId,role:member.role,...(member.capabilities?{capabilities:member.capabilities}:{}),expiresAt:new Date(Date.now()+10*60_000).toISOString()},ownerToken,201);
      rememberCredential(grant.token);
      assert.equal(grant.collaborator.id,actorId,'Reissued stable actor');equal(await provider.branches(key),before,'Verification grant must not change branch heads');
      const me=await json('GET','/api/me/access-tokens',undefined,grant.token);assert.equal(me.identity.id,actorId,'Resolved credential actor');assert.equal(me.identity.kind,kind,'Resolved credential namespace');credentials.set(cacheKey,grant.token);counts.verificationCredentialsReissued++;return grant.token;
    };
    for(const record of privateRecords){
      const expected=record.expected,key={namespace:expected.namespace,repo:expected.repo},value=record.kind==='draft'?expected.draft:expected.state,credential=await originalActorToken(expected),query=new URLSearchParams({ref:value.ref,...(record.kind==='ui'?{kind:value.kind}:{})}),url=base(key)+'/dataset/'+(record.kind==='draft'?'draft/export':'ui-state')+'?'+query;
      assert.equal(sha256(await readFile(path.join(control,...record.file.split('/').slice(1)))),record.sha256,'Preserved private state bytes');
      if(credential){
        const actual=await json('GET',url,undefined,credential);equal(actual[record.kind==='draft'?'draft':'state'],value,'Original actor retrieves complete private recovery state');
        if(record.kind==='draft')counts.privateDraftsReadAsOriginalActor++;else counts.uiCheckpointsReadAsOriginalActor++;
      }else counts.protectedHistoricalPrivateStates++;
      if(expected.owner==='owner:owner'&&!isolationCredential){const grant=await json('POST','/api/access-management/grants',{scope:'instance',name:'Synthetic recovery isolation probe',globalRole:'auditor',expiresAt:new Date(Date.now()+10*60_000).toISOString()},ownerToken,201);rememberCredential(grant.token);isolationCredential=grant.token;credentials.set('synthetic-isolation-probe',grant.token);}
      const other=await response('GET',url,expected.owner==='owner:owner'?isolationCredential!:ownerToken);assert.ok([200,403,404].includes(other.statusCode),'Other actor read is empty or forbidden');
      if(other.statusCode===200)assert.notEqual(other.json()[record.kind==='draft'?'draft':'state']?.id,value.id,'Other actor must not receive target private state');counts.privateCrossActorIsolationChecks++;
    }
    phase='VERIFY_EPHEMERAL_CREDENTIAL_DISPOSAL';
    // Verification credentials are not handed out or left usable in the disposable copy.
    for(const credential of credentials.values()){
      const me=await json('GET','/api/me/access-tokens',undefined,credential),id=me.identity.credentialId;assert.ok(id,'Verification credential identity');await json('POST','/api/me/access-tokens/'+encodeURIComponent(id)+'/revoke',{},ownerToken);assert.equal((await response('GET','/api/me/access-tokens',credential)).statusCode,401,'Verification credential revoked');
    }
    return {baseline:'same-verified-backup-generation',...counts,latestReleaseRetentionVerified:true,exposureLedgerVerified,evaluationPoliciesVerified,releaseMembershipsVerified,privateFullApiCoverage:counts.protectedHistoricalPrivateStates===0,privateStateFileDigestsVerified:privateRecords.length,credentialsDisposedAfterVerification:true,bodiesLogged:false,tokensLogged:false};
  }catch{throw new RecoveryControlCheckError(phase);}
  finally{
    // Even a failed assertion cannot leave this probe's temporary actor credentials usable.
    for(const id of issuedIds)await app.inject({method:'POST',url:'/api/me/access-tokens/'+encodeURIComponent(id)+'/revoke',headers:{authorization:'Bearer '+ownerToken},payload:{}}).catch(()=>{});
  }
}
