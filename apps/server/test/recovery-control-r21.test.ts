import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {cp,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import Fastify from 'fastify';
import type {RequestIdentity} from '../../../packages/shared/src/index.js';
import type {Provider} from '../src/provider.js';
import {ReleaseService} from '../src/releases.js';
import {SourceAccessMarkers} from '../src/source-access-markers.js';
import {controlBackupSources} from '../src/backup-control-sources.js';
import {createColdBackup,restoreBackup} from '../src/backup.js';
import {ApiError} from '../src/errors.js';
import {sha256} from '../src/zip-io.js';
import {verifyRecoveredControl,RecoveryControlCheckError} from '../../../scripts/recovery-control-acceptance.js';

const owner:RequestIdentity={id:'owner',name:'Synthetic recovery owner',kind:'owner',source:'local'},key={namespace:'local',repo:'r21-recovery'};
async function fixture(t:{after:(work:()=>Promise<void>)=>void}){
  const parent=path.resolve('.data/tests');await mkdir(parent,{recursive:true});const directory=await mkdtemp(path.join(parent,'r21-recovery-')),original=path.join(directory,'original-control'),control=path.join(directory,'active-control'),backup=path.join(directory,'backup'),restoreRoot=path.join(directory,'restored');
  await mkdir(original,{recursive:true});await mkdir(control,{recursive:true});t.after(async()=>{assert.ok(path.resolve(directory).startsWith(parent+path.sep));await rm(directory,{recursive:true,force:true});});
  const markers=new SourceAccessMarkers({filename:path.join(original,'source-access-markers.json')});await markers.init();await markers.retainRestrictions([key]);
  const releases:any[]=[],shares:any[]=[],now='2026-11-10T00:00:00.000Z';
  for(const [version,status,format,kind,hasAsset,day]of [
    ['removed-format','published','obsolete','release',true,'01'],['older','published','dataset-v1','release',true,'02'],['latest','published','dataset-v1','release',true,'03'],['withdrawn','withdrawn','dataset-v1','release',true,'04'],['draft','draft','dataset-v1','release',true,'05'],['interrupted','queued','dataset-v1','release',false,'06'],['internal-snapshot','ready','dataset-v1','snapshot',true,'07'],['removed-snapshot','ready','obsolete','snapshot',true,'08'],
  ] as const){
    const id=randomUUID(),content=Buffer.from('Synthetic immutable artifact '+version),asset={id:randomUUID(),name:version+'.zip',size:content.length,sha256:sha256(content),mime:'application/zip',audience:kind==='snapshot'?'internal':'shared'};
    const record={...key,id,version,title:version,notes:'Synthetic only',sourceRef:'main',commitId:'fixed-commit',publishingVersion:format,deliveryMode:'dataset',kind,status,latest:false,revision:2,createdBy:{id:'owner',name:owner.name},createdAt:now,updatedAt:now,...(['published','withdrawn'].includes(status)?{publishedAt:'2026-11-'+day+'T00:00:00.000Z'}:{}),assets:hasAsset?[asset]:[],issues:[],audit:[],identity:owner,fingerprint:'private-fingerprint',sourceFingerprint:'private-source-fingerprint',attemptId:randomUUID(),memberships:{shared:{rowIds:['synthetic-'+version],familyIds:[],attachmentHashes:[],contentHashes:[sha256(version)]},holdout:{rowIds:[],familyIds:[],attachmentHashes:[]}}};releases.push(record);
    if(hasAsset){await mkdir(path.join(original,'releases/assets',id),{recursive:true});await writeFile(path.join(original,'releases/assets',id,asset.id),content);}
    if(['published','withdrawn'].includes(status))shares.push({id:randomUUID(),...key,releaseId:id,assetId:asset.id,tokenHash:'synthetic-private-token-hash',identity:owner,createdBy:record.createdBy,createdAt:now,expiresAt:'2030-01-01T00:00:00.000Z'});
  }
  await writeFile(path.join(original,'releases/records.json'),JSON.stringify({version:1,releases,shares}));const oxen=path.join(directory,'synthetic-source.json');await writeFile(oxen,'{"synthetic":true}');
  const manifest=await createColdBackup({sources:[{id:'oxen',kind:'oxen',root:oxen,required:true},...controlBackupSources(original)],destination:backup,authority:'synthetic-only',applicationVersion:'0.1.0',oxenVersion:'synthetic',assertQuiescent:async()=>{}});
  await restoreBackup({backup,destination:restoreRoot,assertIsolated:async target=>{assert.equal(target,restoreRoot);assert.ok(target.startsWith(directory+path.sep));}});
  await cp(path.join(restoreRoot,'data/source-access-markers/source-access-markers.json'),path.join(control,'source-access-markers.json'));await cp(path.join(restoreRoot,'data/releases'),path.join(control,'releases'),{recursive:true});
  const provider={} as Provider,service=new ReleaseService({provider,rootDir:path.join(control,'releases'),readDataset:async()=>{throw new Error('Synthetic immutable recovery does not read source samples');},authorize:async()=>{}});await service.init();
  const app=Fastify();t.after(()=>app.close());app.setErrorHandler((error,request,reply)=>{const value=error as ApiError;reply.code(value.status??500).send({code:value.code??'SYNTHETIC_ERROR'});});app.get('/api/repository-recycle-bin',()=>[]);
  for(const kind of ['releases','snapshots']){const base='/api/repos/:namespace/:repo/'+kind+'/:id';app.get(base,request=>service.get(key,(request.params as {id:string}).id,owner));app.get(base+'/assets/:assetId',async(request,reply)=>{const p=request.params as {id:string;assetId:string},result=await service.download(key,p.id,p.assetId,owner);return reply.header('X-Artifact-SHA256',result.asset.sha256).send(result.content);});}
  app.get('/api/repos/:namespace/:repo/releases/:id/shares',request=>service.shares(key,(request.params as {id:string}).id,owner));
  return {app,provider,backup,manifest,restoreRoot,control,ownerToken:'synthetic-only',releases};
}

test('R21 recovery intentionally purges older publications and restores only the latest dataset release',async t=>{
  const f=await fixture(t),result=await verifyRecoveredControl(f);
  assert.equal(result.releases,3);assert.equal(result.snapshots,1);assert.equal(result.retainedAssetsVerified,3);assert.equal(result.releaseAssetsReadViaBff,2);assert.equal(result.nonReadyAssetsBlocked,1);assert.equal(result.interruptedBuildsFailClosed,1);assert.equal(result.purgedReleaseIdsVerified,4);assert.equal(result.purgedAssetFilesVerified,4);assert.equal(result.purgedSharesVerified,3);assert.equal(result.sharesDisabled,1);assert.equal(result.sourceAccessMarkersVerified,1);
  const ledger=JSON.parse(await readFile(path.join(f.control,'releases/exposure-ledger.json'),'utf8'));assert.ok(ledger.projects[0].rowIds.includes('synthetic-older'));assert.ok(ledger.projects[0].rowIds.includes('synthetic-removed-format'));
});

test('R21 recovery does not excuse corrupted retained artifacts as intentional deletion',async t=>{
  const f=await fixture(t),latest=f.releases.find(item=>item.version==='latest');await writeFile(path.join(f.control,'releases/assets',latest.id,latest.assets[0].id),'changed bytes');
  await assert.rejects(()=>verifyRecoveredControl(f),(error:unknown)=>error instanceof RecoveryControlCheckError&&error.check==='RELEASES_AND_ASSETS');
});

test('R21 recovery rejects absent purge proofs and exposure-ledger rollback',async t=>{
  const f=await fixture(t),filename=path.join(f.control,'releases/records.json'),stored=JSON.parse(await readFile(filename,'utf8'));stored.retention.purgedReleaseIds=[];await writeFile(filename,JSON.stringify(stored));
  await assert.rejects(()=>verifyRecoveredControl(f),(error:unknown)=>error instanceof RecoveryControlCheckError&&error.check==='RELEASE_RETENTION');
  const original=JSON.parse(await readFile(filename,'utf8'));original.retention.purgedReleaseIds=f.releases.filter(item=>['removed-format','older','withdrawn','removed-snapshot'].includes(item.version)).map(item=>item.id);await writeFile(filename,JSON.stringify(original));
  const ledgerFile=path.join(f.control,'releases/exposure-ledger.json'),ledger=JSON.parse(await readFile(ledgerFile,'utf8'));ledger.revision=0;await writeFile(ledgerFile,JSON.stringify(ledger));
  await assert.rejects(()=>verifyRecoveredControl(f),(error:unknown)=>error instanceof RecoveryControlCheckError&&error.check==='RELEASE_RETENTION');
});
