import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {DemoProvider} from '../src/demo.js';
import {DatasetService} from '../src/dataset.js';
import {ReleaseService} from '../src/releases.js';
import {ApiError} from '../src/errors.js';

test('permission revoked while reading a fixed snapshot cannot turn generated assets into a ready download',async t=>{
  const root=path.resolve('.data/tests');await mkdir(root,{recursive:true});const directory=await mkdtemp(path.join(root,'release-final-auth-'));
  t.after(async()=>{if(!directory.startsWith(root+path.sep))throw new Error('Unsafe synthetic cleanup');await rm(directory,{recursive:true,force:true});});
  const provider=new DemoProvider(path.join(directory,'demo.json'));await provider.init();const key={namespace:'local',repo:'synthetic-revoked-build'},actor:any={id:'owner',name:'Synthetic owner',kind:'owner',source:'local'};
  await provider.createRepo({namespace:key.namespace,name:key.repo,description:'Synthetic revocation fixture'});
  const datasets=new DatasetService(provider),snapshot=await datasets.initialize(key,actor,{ref:'main',expectedCommit:(await provider.branches(key))[0]!.commitId,rows:[{id:'synthetic-one',text:'Inert source'}]});let allowed=true,revokeOnRead=false;
  const service=new ReleaseService({provider,rootDir:path.join(directory,'releases'),readDataset:async()=>{if(revokeOnRead)allowed=false;return snapshot;},authorize:async()=>{if(!allowed)throw new ApiError(403,'SYNTHETIC_REVOKED','Synthetic access revoked during build');}});await service.init();t.after(()=>service.close());
  const item=await service.create(key,actor,{version:'revocation-check',title:'Synthetic',notes:'Synthetic',sourceRef:'main',prerelease:false},'snapshot');revokeOnRead=true;await service.build(key,item.id,actor,item.revision);await service.waitForBuild(item.id);allowed=true;
  const result=await service.get(key,item.id,actor);assert.equal(result.status,'failed');assert.deepEqual(result.assets,[]);assert.match(result.error??'',/revoked/);
});
