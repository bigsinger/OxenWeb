import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {DemoProvider} from '../src/demo.js';
import {DatasetService} from '../src/dataset.js';
import {ApiError} from '../src/errors.js';
import {DatasetAutoWidthService,datasetAutoWidthSchema,displayUnits,estimateAutoWidths,randomSampleIndices} from '../src/dataset-auto-width.js';
import type {RequestIdentity} from '../../../packages/shared/src/index.js';

test('random subset covers the entire index range without duplicates, including samples beyond page one',()=>{
  const indices=randomSampleIndices(1000,200,max=>max-1);
  assert.equal(indices.length,200);assert.equal(new Set(indices).size,200);assert.equal(indices[0],999);assert.ok(indices.every(index=>index>=0&&index<1000));
  assert.deepEqual([...randomSampleIndices(4,200,()=>0)].sort((a,b)=>a-b),[0,1,2,3]);assert.deepEqual(randomSampleIndices(0),[]);
});
test('width estimate gives long content more weight, resists rare outliers and handles Unicode, missing and nested values',()=>{
  const rows=Array.from({length:100},(_,index)=>({id:index,body:'x'.repeat(index===0?10000:80),flag:false,nested:{a:'synthetic'}}));
  const fields=estimateAutoWidths(rows,[{id:'id'},{id:'body'},{id:'flag'},{id:'absent',displayName:'来源'},{id:'nested'}],rows.map((_,index)=>index));
  assert.ok(fields[1]!.weight>fields[0]!.weight*4);assert.equal(fields[1]!.displayUnits,80);assert.equal(fields[3]!.sampledValues,0);assert.ok(fields.every(field=>field.weight>=1&&field.weight<=11.5));
  assert.equal(displayUnits('中a文'),5);assert.equal(displayUnits('a\nabc'),3);assert.equal(displayUnits('e\u0301'),1);assert.equal(displayUnits('😀'),2);assert.equal(displayUnits({a:{b:{c:{d:{e:{f:{g:'x'.repeat(50000)}}}}}}})<=112,true);
  assert.equal(datasetAutoWidthSchema.safeParse({ref:'main',expectedCommit:'a',fields:[{id:'x'},{id:'x'}]}).success,false);
});
test('sampling is read-only, returns statistics without body values, and enforces permission plus current branch head',async t=>{
  const root=path.resolve('.data/tests');await mkdir(root,{recursive:true});const directory=await mkdtemp(path.join(root,'auto-width-'));
  t.after(async()=>{if(!directory.startsWith(root+path.sep))throw new Error('Unsafe fixture cleanup');await rm(directory,{recursive:true,force:true});});
  const provider=new DemoProvider(path.join(directory,'state.json'));await provider.init();const key={namespace:'local',repo:'synthetic-auto-width'},actor:RequestIdentity={id:'owner',name:'Synthetic owner',kind:'owner',source:'local'};
  await provider.createRepo({...key,name:key.repo,description:'Synthetic autosizing'});
  const datasets=new DatasetService(provider,{authorize:async()=>{}}),initial=(await provider.branches(key))[0]!.commitId;
  const snapshot=await datasets.initialize(key,actor,{ref:'main',expectedCommit:initial,rows:Array.from({length:250},(_,index)=>({id:index,text:'DO_NOT_RETURN_BODY '+index})),labels:{version:1,columns:[],assignments:[]}});
  let checks=0,allowed=true;const service=new DatasetAutoWidthService(datasets,async()=>{checks++;if(!allowed)throw new ApiError(403,'DENIED','Synthetic denied');});
  const input={ref:'main',expectedCommit:snapshot.commitId,fields:[{id:'id'},{id:'text'}]},count=(await provider.commits(key,'main')).length,plan=await service.plan(key,actor,input);
  assert.equal(plan.sampledRows,200);assert.equal(plan.totalRows,250);assert.equal(checks,2);assert.equal(JSON.stringify(plan).includes('DO_NOT_RETURN_BODY'),false);assert.equal((await provider.commits(key,'main')).length,count);assert.deepEqual(await provider.workspaces(key),[]);
  await assert.rejects(()=>service.plan(key,actor,{...input,expectedCommit:initial}),(error:any)=>error.code==='DATASET_VERSION_CONFLICT');
  allowed=false;await assert.rejects(()=>service.plan(key,actor,input),(error:any)=>error.status===403);
});
