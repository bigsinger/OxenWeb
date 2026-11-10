import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import type {RequestIdentity} from '../../../packages/shared/src/index.js';
import {DemoProvider} from '../src/demo.js';
import {DatasetService} from '../src/dataset.js';
import {DATASET_ACTIVITY_PATH,datasetSourceFileActivity} from '../src/dataset-activity.js';
import {sha256,readZipMembers} from '../src/zip-io.js';
import {ReleaseService} from '../src/releases.js';
import {ApiError} from '../src/errors.js';

const importer:RequestIdentity={id:'importer',name:'Synthetic importer',kind:'owner',source:'local'};
const editor:RequestIdentity={id:'editor',name:'Synthetic editor',kind:'owner',source:'local'};
async function setup(t:{after:(work:()=>Promise<void>)=>void}){
  const root=path.resolve('.data/tests');await mkdir(root,{recursive:true});const directory=await mkdtemp(path.join(root,'row-activity-'));
  t.after(async()=>{if(!directory.startsWith(root+path.sep))throw new Error('Unsafe fixture cleanup');await rm(directory,{recursive:true,force:true});});
  const provider=new DemoProvider(path.join(directory,'demo.json'));await provider.init();const key={namespace:'local',repo:'synthetic-activity'};await provider.createRepo({...key,name:key.repo,description:'Synthetic activity evidence'});
  const datasets=new DatasetService(provider),head=(await provider.branches(key))[0]!.commitId;
  const initial=await datasets.initialize(key,importer,{ref:'main',expectedCommit:head,rows:[{id:'one',text:'Synthetic one',updated_at:'original-source-value'},{id:'two',text:'Synthetic two'},{id:'three',text:'Synthetic three'}],labels:{version:1,columns:[{id:'judge',name:'判定',type:'single',options:[{value:'safe'}]}],assignments:[]}});
  return {provider,key,datasets,initial,directory};
}

test('import, content and row annotations retain committed actor evidence without changing source fields or history',async t=>{
  const f=await setup(t),[one,two]=f.initial.rowIds,source=(await f.provider.raw(f.key,f.initial.commitId,f.initial.path)).content;
  assert.ok(f.initial.rowActivity?.[one!]!.updatedAt);assert.equal(f.initial.rowActivity?.[one!]!.actor?.id,'importer');assert.equal(f.initial.rowActivity?.[one!]!.kind,'import');
  const plan=await f.datasets.plan(f.key,editor,{ref:'main',expectedCommit:f.initial.commitId,message:'Synthetic uncommitted preview',operations:[{op:'update',rowId:two!,record:{...f.initial.rows[1],text:'Preview only'}}]});
  assert.equal(plan.snapshot.rows[1]!.text,'Preview only');assert.deepEqual(plan.snapshot.rowActivity,f.initial.rowActivity,'A private draft is not committed evidence');
  const changed=await f.datasets.save(f.key,editor,{ref:'main',expectedCommit:f.initial.commitId,message:'Synthetic committed edit',operations:[{op:'update',rowId:two!,record:{...f.initial.rows[1],text:'Committed content'}}]});
  assert.ok((await f.provider.commit(f.key,changed.commitId)).files.every(file=>file.path!==DATASET_ACTIVITY_PATH),'Different samples do not contend on a shared activity file');assert.equal(changed.rowActivity?.[two!]!.actor?.id,'editor');assert.equal(changed.rowActivity?.[two!]!.kind,'content');assert.equal(changed.rowActivity?.[two!]!.createdAt,f.initial.rowActivity?.[two!]!.createdAt);
  const annotated=await f.datasets.save(f.key,editor,{ref:'main',expectedCommit:changed.commitId,message:'Synthetic row annotation',operations:[{op:'assign',scope:'row',rowId:one!,values:{judge:'safe'}}]});
  assert.equal(annotated.rowActivity?.[one!]!.kind,'annotation');assert.equal(annotated.rowActivity?.[one!]!.actor?.id,'editor');
  assert.deepEqual((await f.datasets.read(f.key,f.initial.commitId)).rowActivity,f.initial.rowActivity,'Fixed history does not inherit later operation metadata');
  assert.deepEqual((await f.provider.raw(f.key,annotated.commitId,annotated.path)).content,source);assert.equal(annotated.rows[0]!.updated_at,'original-source-value');assert.equal(Object.hasOwn(annotated.rows[0]!,'rowActivity'),false);
  const withAppend=await f.datasets.save(f.key,editor,{ref:'main',expectedCommit:annotated.commitId,message:'Synthetic appended batch',operations:[{op:'append',record:{id:'four',text:'Synthetic batch'}}]});
  const appended=withAppend.rowIds.at(-1)!;assert.equal(withAppend.rowActivity?.[appended]!.actor?.id,'editor');assert.equal(withAppend.rowActivity?.[appended]!.kind,'import');
});

test('system time filtering and sorting operate on every matched row before pagination and never shadow source fields',async t=>{
  const f=await setup(t),[one,two,three]=f.initial.rowIds,digest=sha256((await f.provider.raw(f.key,f.initial.commitId,f.initial.path)).content),workspace=await f.provider.createWorkspace(f.key,'Synthetic fixed clocks','main');
  const row=(updatedAt:string,name:string)=>({createdAt:'2020-01-01T00:00:00.000Z',updatedAt,actor:{id:name,name},kind:'content'});
  await f.provider.writeWorkspace(f.key,workspace.id,DATASET_ACTIVITY_PATH,Buffer.from(JSON.stringify({version:1,baselineSha256:digest,rows:{[one!]:row('2021-01-01T00:00:00.000Z','A'),[two!]:row('2023-01-01T00:00:00.000Z','B'),[three!]:row('2022-01-01T00:00:00.000Z','C')}})));
  await f.provider.commitWorkspace(f.key,workspace.id,'Synthetic fixed clocks');await f.provider.deleteWorkspace(f.key,workspace.id);
  const first=await f.datasets.page(f.key,'main',{sort:{column:'system.updated_at',direction:'desc'},page:1,pageSize:1});assert.deepEqual(first.rowIds,[two]);assert.deepEqual(Object.keys(first.rowActivity!),[two]);
  const second=await f.datasets.page(f.key,'main',{sort:{column:'system.updated_at',direction:'desc'},page:2,pageSize:1});assert.deepEqual(second.rowIds,[three]);
  const filtered=await f.datasets.page(f.key,'main',{filters:[{column:'system.updated_at',operator:'gt',value:'2021-06-01T00:00:00.000Z'}],sort:{column:'system.actor',direction:'desc'},pageSize:1});assert.equal(filtered.matchedRows,2);assert.deepEqual(filtered.rowIds,[three]);
  assert.equal((await f.datasets.page(f.key,'main',{filters:[{column:'data.updated_at',operator:'eq',value:'original-source-value'}]})).matchedRows,1);
  await assert.rejects(()=>f.datasets.page(f.key,'main',{filters:[{column:'system.updated_at',operator:'gt',value:'not-a-time'}]}),(error:any)=>error.code==='QUERY_DATE_REQUIRED');
  await assert.rejects(()=>f.datasets.page(f.key,'main',{sort:{column:'system.secret',direction:'asc'}}),(error:any)=>error.code==='QUERY_UNKNOWN_COLUMN');
});

test('missing historical timestamps remain unknown while available canonical file evidence is explicitly coarse',async t=>{
  const f=await setup(t),originalTree=f.provider.tree.bind(f.provider);f.provider.tree=async(...args)=>(await originalTree(...args)).map(item=>item.path===f.initial.path?{...item,updatedAt:'2020-04-03T02:01:00.000Z'}:item);
  const coarse=await datasetSourceFileActivity(f.provider,f.key,f.initial.commitId,f.initial.path);assert.deepEqual(coarse,{createdAt:'2020-04-03T02:01:00.000Z',updatedAt:'2020-04-03T02:01:00.000Z',source:'source-file'});assert.equal(coarse.actor,undefined);
  f.provider.tree=async()=>{throw new ApiError(503,'SYNTHETIC_UNAVAILABLE','Unavailable');};
  assert.deepEqual(await datasetSourceFileActivity(f.provider,f.key,f.initial.commitId,f.initial.path),{createdAt:null,updatedAt:null,source:'unknown'});
});

test('Release and JSONL assets exclude the system activity map and last-operation-only identity',async t=>{
  const f=await setup(t),snapshot=structuredClone(f.initial);snapshot.rowActivity=Object.fromEntries(snapshot.rowIds.map(id=>[id,{createdAt:'2020-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z',actor:{id:'system-actor-only',name:'SYSTEM_OP_ONLY_SENTINEL'},source:'web-operation'}]));
  const service=new ReleaseService({provider:f.provider,rootDir:path.join(f.directory,'releases'),readDataset:async()=>snapshot,authorize:async()=>{}});await service.init();t.after(()=>service.close());
  let item=await service.create(f.key,importer,{version:'activity-export',title:'Synthetic export exclusion',notes:'Synthetic',sourceRef:'main',prerelease:false},'snapshot');await service.build(f.key,item.id,importer,item.revision);await service.waitForBuild(item.id);item=await service.get(f.key,item.id,importer);assert.equal(item.status,'ready',item.error);
  for(const asset of item.assets){const download=await service.download(f.key,item.id,asset.id,importer);if(asset.mime==='application/zip'){const files=await readZipMembers(download.content);assert.ok(files.every(file=>!file.name.endsWith('/activity.json')));assert.ok(files.every(file=>!file.content.includes(Buffer.from('SYSTEM_OP_ONLY_SENTINEL'))));const rows=files.find(file=>file.name==='samples.jsonl')!.content.toString('utf8').trim().split('\n').map(line=>JSON.parse(line));assert.equal(rows[0].data.updated_at,'original-source-value');assert.equal(Object.hasOwn(rows[0],'rowActivity'),false);}else if(asset.name==='samples.jsonl'){assert.equal(download.content.includes(Buffer.from('SYSTEM_OP_ONLY_SENTINEL')),false);}}
});

test('batch authorization keeps full row scopes and rechecks each operation kind at the actual commit boundary',async t=>{
  const f=await setup(t),authorizations:Array<{kind:string;native:boolean}>=[],checks:Array<{kind:string;ids:string[];count:number;native:boolean}>=[];let insideNativeCommit=false;
  const nativeCommit=f.provider.commitWorkspace.bind(f.provider);f.provider.commitWorkspace=async(...args)=>{insideNativeCommit=true;try{return await nativeCommit(...args);}finally{insideNativeCommit=false;}};
  const guarded=new DatasetService(f.provider,{authorize:async(_key,_actor,kind)=>{authorizations.push({kind,native:insideNativeCommit});},beforeWrite:async(_key,_actor,_branch,ids,kind,context)=>{checks.push({kind,ids,count:context.operations.length,native:insideNativeCommit});}});
  const operations=f.initial.rowIds.flatMap((rowId,index)=>[{op:'update' as const,rowId,record:{...f.initial.rows[index],note:'Synthetic batched change'}},{op:'assign' as const,scope:'row' as const,rowId,values:{judge:'safe'}}]);
  const changed=await guarded.save(f.key,editor,{ref:'main',expectedCommit:f.initial.commitId,message:'Synthetic batched authorization',operations});
  assert.equal(changed.totalRows,3);assert.deepEqual(new Set(authorizations.map(check=>check.kind)),new Set(['edit-content','assign-labels']));assert.ok(checks.every(check=>check.count===3&&check.ids.length===3&&f.initial.rowIds.every(id=>check.ids.includes(id))));
  for(const kind of ['edit-content','assign-labels']){assert.ok(authorizations.some(check=>check.kind===kind&&check.native),`${kind} authority is rechecked inside provider commit`);assert.ok(checks.some(check=>check.kind===kind&&check.native),`${kind} full scope is rechecked inside provider commit`);assert.ok(checks.some(check=>check.kind===kind&&!check.native),`${kind} is validated before staging`);}
  let revoked=false;f.provider.commitWorkspace=async(...args)=>{revoked=true;return nativeCommit(...args);};
  const denied=new DatasetService(f.provider,{authorize:async()=>{},beforeWrite:async()=>{if(revoked)throw new ApiError(403,'SYNTHETIC_REVOKED','Synthetic permission revoked at the native commit boundary');}});
  const next=changed.rowIds.flatMap((rowId,index)=>[{op:'update' as const,rowId,record:{...changed.rows[index],note:'Must not commit'}},{op:'assign' as const,scope:'row' as const,rowId,values:{judge:'safe'}}]);
  await assert.rejects(()=>denied.save(f.key,editor,{ref:'main',expectedCommit:changed.commitId,message:'Must not commit after revocation',operations:next}),(error:any)=>error.code==='SYNTHETIC_REVOKED');assert.equal(revoked,true,'the rejection occurs after entering native commit, not an assumed callback count');assert.equal((await f.provider.branches(f.key))[0]!.commitId,changed.commitId);
  const specific=new DatasetService(f.provider,{authorize:async(_key,_actor,kind)=>{if(kind==='edit-readme')throw new ApiError(403,'SYNTHETIC_README_DENIED','A custom authorizer distinguishes operations with the same route capability');}});
  await assert.rejects(()=>specific.plan(f.key,editor,{ref:'main',expectedCommit:changed.commitId,message:'Keep custom callback semantics',operations:[next[0]!,{op:'readme',content:'# Synthetic README'}]}),(error:any)=>error.code==='SYNTHETIC_README_DENIED');
});

test('a cold private plan reads the immutable canonical source once, warm plans isolate actors and mutable returned rows',async t=>{
  const f=await setup(t),raw=f.provider.raw.bind(f.provider);let reads=0;f.provider.raw=async(...args)=>{if(args[2]===f.initial.path)reads++;return raw(...args);};
  const service=new DatasetService(f.provider),rowId=f.initial.rowIds[0]!,input={ref:'main',expectedCommit:f.initial.commitId,message:'Synthetic exact-base plan',operations:[{op:'update' as const,rowId,record:{...f.initial.rows[0],text:'First projected input'}}]};
  const first=await service.plan(f.key,editor,input);assert.equal(reads,1,'Cold validation does not fetch/parse the whole source again for its overlay');
  first.snapshot.rows[1]!.text='Mutable caller copy must not poison immutable source evidence';
  const another={...editor,id:'another',name:'Another synthetic actor'},second=await service.plan(f.key,another,{...input,operations:[{...input.operations[0]!,record:{...f.initial.rows[0],text:'Second projected input'}}]});
  assert.equal(reads,1,'The existing fixed-commit cache shares immutable source references without raw-byte retention');assert.equal(second.snapshot.rows[1]!.text,f.initial.rows[1]!.text);assert.equal(second.snapshot.rows[0]!.text,'Second projected input');assert.ok([...second.writes.values()].some(bytes=>bytes.includes(Buffer.from('Another synthetic actor'))));assert.ok([...second.writes.values()].every(bytes=>!bytes.includes(Buffer.from('First projected input'))));
  const saved=await service.save(f.key,editor,input);assert.ok(reads>=2,'A new fixed commit is materialized independently');await assert.rejects(()=>service.plan(f.key,another,input),(error:any)=>error.code==='DATASET_VERSION_CONFLICT');assert.equal((await service.read(f.key,saved.commitId)).rows[0]!.text,'First projected input');
});
