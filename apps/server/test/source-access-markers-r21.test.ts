import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,mkdtemp,readFile,rm,truncate,writeFile} from 'node:fs/promises';
import {SourceAccessMarkers} from '../src/source-access-markers.js';
import {RestrictedMasterAccess} from '../src/restricted-master-access.js';
import {durableWriteJson} from '../src/durable-store.js';
import {controlBackupSources} from '../src/backup-control-sources.js';
import {createColdBackup,restoreBackup} from '../src/backup.js';

const key={namespace:'local',repo:'synthetic-protected'},other={namespace:'local',repo:'other-protected'},code=(expected:string)=>(error:any)=>error?.code===expected;
async function fixture(t:{after:(work:()=>Promise<void>)=>void}){
  const parent=path.resolve('.data/tests');await mkdir(parent,{recursive:true});const directory=await mkdtemp(path.join(parent,'r21-source-access-')),filename=path.join(directory,'source-access-markers.json');
  t.after(async()=>{assert.ok(path.resolve(directory).startsWith(parent+path.sep));await rm(directory,{recursive:true,force:true});});
  const store=new SourceAccessMarkers({filename});await store.init();return {directory,filename,store};
}

test('R21 generic source restrictions survive concurrent retention, restart and empty retention',async t=>{
  const f=await fixture(t);await f.store.retainRestrictions([]);assert.deepEqual(JSON.parse(await readFile(f.filename,'utf8')),{version:1,repositories:[]});
  await Promise.all([f.store.retainRestrictions([key,key]),f.store.retainRestrictions([other])]);await f.store.retainRestrictions([]);
  const restarted=new SourceAccessMarkers({filename:f.filename});await restarted.init();assert.equal(restarted.isRestricted(key),true);assert.equal(restarted.isRestricted(other),true);
  const raw=JSON.parse(await readFile(f.filename,'utf8'));assert.deepEqual(Object.keys(raw).sort(),['repositories','version']);assert.equal(raw.repositories.length,2);for(const absent of ['views','templates','holdout','releasePlan'])assert.equal(absent in raw,false);
  const gate=new RestrictedMasterAccess({permissions:async(_key,identity)=>({read:true,admin:identity.id==='admin',capabilities:{'release.hidden':identity.id==='authorized'}} as any)},repository=>restarted.isRestricted(repository));
  assert.equal(await gate.mayReadSource(key,{id:'qa',name:'Synthetic QA',kind:'collaborator',source:'bearer'}),false);assert.equal(await gate.mayReadSource(key,{id:'authorized',name:'Synthetic trusted',kind:'collaborator',source:'bearer'}),true);assert.equal(await gate.mayReadSource(key,{id:'admin',name:'Synthetic admin',kind:'collaborator',source:'bearer'}),true);
});

test('R21 uncertain durable marker writes never silently remove source protection',async t=>{
  const f=await fixture(t);await f.store.retainRestrictions([key]);const broken=new SourceAccessMarkers({filename:f.filename,persist:async(filename,value)=>durableWriteJson(filename,value,{fault:stage=>{if(stage==='replaced')throw new Error('Synthetic interrupted acknowledgement');}})});await broken.init();
  await assert.rejects(()=>broken.retainRestrictions([other]));assert.throws(()=>broken.isRestricted(key),code('SOURCE_ACCESS_MARKERS_UNCERTAIN'));
  const restarted=new SourceAccessMarkers({filename:f.filename});await restarted.init();assert.equal(restarted.isRestricted(key),true);assert.equal(restarted.isRestricted(other),true);
});

test('R21 malformed, oversized and unsafe marker identities fail closed',async t=>{
  const f=await fixture(t);await writeFile(f.filename,JSON.stringify({version:1,repositories:[{namespace:'local',repo:'../outside'}]}));await assert.rejects(()=>f.store.init(),code('SOURCE_ACCESS_MARKERS_INVALID'));assert.throws(()=>f.store.isRestricted(key),code('SOURCE_ACCESS_MARKERS_UNCERTAIN'));
  await writeFile(f.filename,JSON.stringify({version:1,repositories:[key,key]}));await assert.rejects(()=>f.store.init(),code('SOURCE_ACCESS_MARKERS_INVALID'));
  await truncate(f.filename,32*1024*1024+1);await assert.rejects(()=>f.store.init(),code('SOURCE_ACCESS_MARKERS_INVALID'));
});

test('R21 a missing marker after restart protects all source repositories until explicit initialization',async t=>{
  const f=await fixture(t);assert.equal(f.store.isRestricted(other),true);await f.store.retainRestrictions([key]);await rm(f.filename);
  const restarted=new SourceAccessMarkers({filename:f.filename});await restarted.init();assert.equal(restarted.isRestricted(key),true);assert.equal(restarted.isRestricted(other),true);
  await restarted.retainRestrictions([key]);assert.equal(restarted.isRestricted(key),true);assert.equal(restarted.isRestricted(other),false);
});

test('R21 active cold backup restores generic source protection without retired configuration or physical stores',async t=>{
  const f=await fixture(t);await f.store.retainRestrictions([key]);const oxen=path.join(f.directory,'synthetic-oxen.json');await writeFile(oxen,'{"synthetic":true}');
  const sources=controlBackupSources(f.directory);assert.ok(sources.some(source=>source.id==='source-access-markers'));assert.equal(sources.some(source=>['dataset-view-registry','holdout'].includes(source.id)),false);
  const backup=path.join(f.directory,'backup'),manifest=await createColdBackup({sources:[{id:'oxen',kind:'oxen',root:oxen,required:true},...sources],destination:backup,authority:'synthetic-only',applicationVersion:'0.1.0',oxenVersion:'synthetic',assertQuiescent:async()=>{}});
  assert.ok(manifest.files.some(file=>file.sourceId==='source-access-markers'));const destination=path.join(f.directory,'restored');await restoreBackup({backup,destination,assertIsolated:async target=>{assert.equal(target,destination);assert.ok(target.startsWith(f.directory+path.sep));}});
  const restored=new SourceAccessMarkers({filename:path.join(destination,'data/source-access-markers/source-access-markers.json')});await restored.init();assert.equal(restored.isRestricted(key),true);
});
