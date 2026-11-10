import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {DemoProvider} from '../src/demo.js';
import {DatasetService} from '../src/dataset.js';
import {readPublishingDataset} from '../src/publishing-dataset-source.js';
import {ApiError} from '../src/errors.js';

test('an empty project publishes a read-only empty projection without creating sample storage or split fields',async t=>{
  const root=path.resolve('.data/tests');await mkdir(root,{recursive:true});const temporary=await mkdtemp(path.join(root,'r19-empty-publish-'));
  t.after(async()=>{assert.ok(temporary.startsWith(root+path.sep));await rm(temporary,{recursive:true,force:true});});
  const provider=new DemoProvider(path.join(temporary,'state.json'));await provider.init();const key={namespace:'local',repo:'synthetic-empty-views'};await provider.createRepo({namespace:key.namespace,name:key.repo,visibility:'private'});
  const before=await provider.branches(key),datasets=new DatasetService(provider),snapshot=await readPublishingDataset(datasets,key,'main');
  assert.equal(snapshot.totalRows,0);assert.deepEqual(snapshot.rows,[]);assert.deepEqual(snapshot.descriptor.fields,{});assert.deepEqual(await provider.branches(key),before);assert.equal((await datasets.setupState(key,'main')).configured,false);
  const workspace=await provider.createWorkspace(key,'Synthetic ambiguous sources','main');for(const name of ['one.jsonl','two.jsonl'])await provider.writeWorkspace(key,workspace.id,name,Buffer.from('{"id":"synthetic","text":"inert"}\n'));await provider.commitWorkspace(key,workspace.id,'Two unconfigured tables');await provider.deleteWorkspace(key,workspace.id);
  await assert.rejects(()=>readPublishingDataset(datasets,key,'main'),(error:any)=>error instanceof ApiError&&error.code==='DATASET_NOT_CONFIGURED','ambiguous source configuration must not become an empty successful export');
});
