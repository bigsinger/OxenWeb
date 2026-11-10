import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {DemoProvider} from '../src/demo.js';
import {ReleaseService,type ReleaseOptions} from '../src/releases.js';
import {projectReleaseFields,datasetFieldExportPolicy} from '../src/release-field-projection.js';
import {ApiError} from '../src/errors.js';
import {sha256,storedZip,readZipMembers} from '../src/zip-io.js';
import {datasetFieldsSchema} from '../src/dataset-field-schema.js';
import {sampleTemplateHash} from '../src/workflow.js';
import {DatasetService} from '../src/dataset.js';
import {ZipImportService} from '../src/zip-import.js';
import {createSampleFieldDraft,sampleFieldMetadata} from '../../web/src/sample-field-config.js';
import {resetSampleFieldDraftOrder} from '../../web/src/sample-field-order.js';
import {parseSampleFieldCheckpoint,type SampleFieldFormCheckpoint} from '../../web/src/sample-field-checkpoint.js';
import type {DatasetSnapshot} from '../../../packages/shared/src/dataset.js';
import type {RequestIdentity} from '../../../packages/shared/src/index.js';
import type {DatasetFieldMetadata} from '../../../packages/shared/src/field-metadata.js';

const key={namespace:'oxen',repo:'visual-search'},owner:RequestIdentity={kind:'owner',id:'export-owner',name:'Export owner',source:'bearer'};
const secret='SYNTHETIC_EXCLUDED_FIELD_SENTINEL';
async function fixture(t:{after:(fn:()=>Promise<void>)=>void}){
  const testRoot=path.resolve('.data/tests');await mkdir(testRoot,{recursive:true});const directory=await mkdtemp(path.join(testRoot,'r11-release-fields-'));
  assert(directory.startsWith(testRoot+path.sep));t.after(()=>rm(directory,{recursive:true,force:true}));
  const provider=new DemoProvider(path.join(directory,'state.json'));await provider.init();
  const rows=[{id:'original-A',public:'Visible A',secret,nested:{secret},'literal.dot':secret,private_path:'skills/private.zip',public_path:'skills/shared.zip'},{id:'original-B',public:'Visible B',secret,private_path:'skills/shared.zip'}];
  const workspace=await provider.createWorkspace(key,'Synthetic field export fixture','main');
  const files=[{path:'skills/private.zip',content:storedZip([{name:'SKILL.md',content:Buffer.from(secret)}])},{path:'skills/shared.zip',content:storedZip([{name:'SKILL.md',content:Buffer.from('Synthetic inert visible package')}])},{path:'source/archives/original.zip',content:storedZip([{name:'rows.jsonl',content:Buffer.from(JSON.stringify(rows))}])},{path:'provenance/imported-raw.json',content:Buffer.from(JSON.stringify({raw:secret}))},{path:'provenance/import-manifest.json',content:Buffer.from(JSON.stringify({archivePath:'source/archives/original.zip',evidenceFiles:['provenance/imported-raw.json']}))}];
  files.push({path:'data/samples.jsonl',content:Buffer.from(rows.map(row=>JSON.stringify(row)).join('\n')+'\n')});for(const file of files)await provider.writeWorkspace(key,workspace.id,file.path,file.content);
  const commitId=(await provider.commitWorkspace(key,workspace.id,'Synthetic source and provenance')).id;
  const fine=[{id:'visible',pointer:'/public',sourceHash:sha256('Visible A'),start:0,end:1,values:{}},{id:'hidden',pointer:'/secret',sourceHash:sha256(secret),start:0,end:1,values:{},note:secret},{id:'nested',pointer:'/nested/secret',sourceHash:sha256(secret),start:0,end:1,values:{},note:secret},{id:'dot',pointer:'/literal.dot',sourceHash:sha256(secret),start:0,end:1,values:{},note:secret},{id:'root',pointer:'',sourceHash:sha256(JSON.stringify(rows[0])),start:0,end:1,values:{},note:secret}];
  const snapshot:DatasetSnapshot={...key,ref:commitId,commitId,path:'data/samples.jsonl',descriptor:{version:1,id:'synthetic-export',name:'Synthetic export',canonicalPath:'data/samples.jsonl',readmePath:'README.md',identityField:'id',attachmentFields:['private_path','public_path'],source:'descriptor',importManifestPath:'provenance/import-manifest.json',identityMapPath:'.oxenweb/row-identities.json'},rows,rowIds:['stable-A','stable-B'],columns:[],totalRows:2,contentHashes:{'stable-A':sha256(JSON.stringify(rows[0])),'stable-B':sha256(JSON.stringify(rows[1]))},labels:{version:1,columns:[],assignments:[],ref:commitId,commitId,storagePath:'.oxenweb/labels.json',legacyCount:0},labelRecords:[{version:1,scope:'row',path:'data/samples.jsonl',rowId:'stable-A',actor:{id:'annotator',name:'Synthetic annotator'},values:{},spans:fine,steps:[{id:'hidden-step',pointer:'/nested',sourceHash:sha256('nested'),values:{},note:secret}],sourceCommitId:commitId,updatedAt:new Date(0).toISOString(),fingerprint:'synthetic',templateSnapshot:{columns:[]}}],labelConflicts:[],attachments:[{path:'skills/private.zip',name:'private.zip',rowIds:['stable-A'],kind:'zip'},{path:'skills/shared.zip',name:'shared.zip',rowIds:['stable-A','stable-B'],kind:'zip'}],feedback:[{id:'feedback',message:secret,actor:{id:'annotator',name:'Synthetic annotator'},createdAt:new Date(0).toISOString(),sourceCommitId:commitId}],readme:'# Synthetic export\n',readmePath:'README.md',orphanAssignments:[],warnings:[]};
  const snapshots=new Map([[commitId,snapshot]]);
  const options:ReleaseOptions={provider,rootDir:path.join(directory,'releases'),authorize:async()=>{},readDataset:async(_key,ref)=>structuredClone(snapshots.get(ref)!),preflight:async(_key,snapshot)=>({ok:true,issues:[],acceptedValues:Object.fromEntries(snapshot.rowIds.map(id=>[id,{}])),acceptedFineAnnotations:{'stable-A':{actorId:'annotator',spans:snapshot.labelRecords[0]!.spans,steps:snapshot.labelRecords[0]!.steps}}})};
  const service=new ReleaseService(options);await service.init();return {provider,service,snapshot,snapshots,options};
}
async function build(service:ReleaseService,version:string,kind:'release'|'snapshot'='release'){const draft=await service.create(key,owner,{version,title:version,notes:'Synthetic only',sourceRef:'main',prerelease:false},kind);await service.build(key,draft.id,owner,draft.revision);await service.waitForBuild(draft.id);return service.get(key,draft.id,owner);}
async function members(service:ReleaseService,item:Awaited<ReturnType<typeof build>>){assert.equal(item.status,'ready',item.error);return new Map((await readZipMembers((await service.download(key,item.id,item.assets.find(asset=>asset.mime==='application/zip')!.id,owner)).content)).map(file=>[file.name,file.content]));}

test('field export defaults true and persists explicit false without changing annotation review semantics',async t=>{
  const {snapshot}=await fixture(t);assert.deepEqual(projectReleaseFields(snapshot,true).rows,snapshot.rows);
  assert.deepEqual(datasetFieldExportPolicy(snapshot),{version:1,excludedFields:[]});
  const defaultDraft=createSampleFieldDraft('secret');assert.notEqual(defaultDraft.export,false);defaultDraft.enabled=true;defaultDraft.export=false;
  assert.deepEqual(sampleFieldMetadata(defaultDraft),{export:false});assert.deepEqual(sampleFieldMetadata(createSampleFieldDraft('secret',{export:true})),{export:true});
  const checkpoint:SampleFieldFormCheckpoint={version:1,baseCommit:snapshot.commitId,baseConfiguration:{},drafts:[defaultDraft],selected:'secret',search:'',newId:'',message:'Synthetic export choice'};
  assert.equal(parseSampleFieldCheckpoint(JSON.parse(JSON.stringify(checkpoint))).drafts[0]!.export,false);
  assert.throws(()=>parseSampleFieldCheckpoint({...checkpoint,drafts:[{...defaultDraft,export:'false'}]}));assert.equal(datasetFieldsSchema.safeParse({secret:{export:'false'}}).success,false);
  const before=sampleTemplateHash(snapshot);snapshot.descriptor.fields={secret:{export:false}};assert.equal(sampleTemplateHash(snapshot),before,'Delivery projection does not invalidate otherwise unchanged independent review');
});

test('resetting field order preserves an independently edited export choice and restores untouched defaults',()=>{
  for(const selected of [false,true]){
    const field=createSampleFieldDraft('secret');
    field.enabled=true;field.export=selected;
    assert.equal(field.enabled,true);assert.deepEqual(sampleFieldMetadata(field),{export:selected});
    field.order=0;const [reset]=resetSampleFieldDraftOrder([field],['secret'],{});assert.equal(reset!.enabled,true);assert.deepEqual(sampleFieldMetadata(reset!),{export:selected});
  }
});

test('complete ZIP and its JSONL exchange file project exact top-level fields, identities, attachments and fine evidence without raw provenance bypass',async t=>{
  const {service,snapshot,provider}=await fixture(t),originalRows=structuredClone(snapshot.rows);
  snapshot.descriptor.fields=Object.fromEntries(['id','secret','nested','literal.dot','private_path'].map(id=>[id,{export:false}]));
  const item=await build(service,'projected'),files=await members(service,item),samples=files.get('samples.jsonl')!.toString().trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(samples.map(row=>row.data),[{public:'Visible A',public_path:'skills/shared.zip'},{public:'Visible B'}]);
  assert.deepEqual(samples.map(row=>row.sample_id),snapshot.rowIds,'Stable sample IDs preserve annotation joins even when source id is excluded');
  assert.deepEqual(samples[0].fine_annotations.spans.map((span:{id:string})=>span.id),['visible']);assert.equal(samples[0].fine_annotations.steps.length,0);
  const manifest=JSON.parse(files.get('dataset.json')!.toString());assert.equal(manifest.descriptor.identityField,'');assert.equal(manifest.descriptor.importManifestPath,undefined);assert.equal(manifest.descriptor.identityMapPath,undefined);assert.deepEqual(manifest.descriptor.attachmentFields,['public_path']);
  assert.deepEqual(manifest.attachments.map((attachment:{sourcePath:string;rowIds:string[]})=>({path:attachment.sourcePath,rows:attachment.rowIds})),[{path:'skills/shared.zip',rows:['stable-A']}]);
  assert.equal(files.has('attachments/skills/private.zip'),false);assert.equal(files.has('attachments/skills/shared.zip'),true);assert.equal(files.has('provenance/import-manifest.json'),false);assert.equal(files.has('provenance/imported-raw.json'),false);assert.equal(files.has('provenance/feedback.json'),false);
  for(const [filename,content]of files)assert.equal(content.includes(Buffer.from(secret)),false,filename+' must not contain excluded raw fixture text');
  assert.deepEqual(snapshot.rows,originalRows,'Projection never mutates the source records');
  const datasets=new DatasetService(provider),target={namespace:'local',repo:'projected-import'};await provider.createRepo({...target,name:target.repo,description:'Synthetic projected import'});
  const importer=new ZipImportService({provider,authorize:async()=>{},importDataset:(key,identity,input)=>datasets.initialize(key,identity,input)}),archive=await service.download(key,item.id,item.assets.find(asset=>asset.mime==='application/zip')!.id,owner),inspection=await importer.inspect(archive.content,'projected.zip',owner),mapping={mode:'release' as const,paths:['dataset.json']},plan=importer.plan(inspection.id,owner,mapping),head=(await provider.branches(target))[0]!.commitId;
  const imported=await importer.commit(inspection.id,owner,{mapping,fingerprint:plan.fingerprint,...target,branch:'main',expectedCommit:head}),restored=await datasets.read(target,imported.commitId);assert.deepEqual(restored.rows,samples.map(row=>row.data));assert.deepEqual(restored.rowIds,snapshot.rowIds);assert.equal(restored.descriptor.identityField,'');assert.equal((await provider.raw(target,imported.commitId,'skills/shared.zip')).content.equals(files.get('attachments/skills/shared.zip')!),true);
  snapshot.descriptor.fields.public_path={export:false};const withoutAttachments=await build(service,'standalone');const projectedFiles=await members(service,withoutAttachments),plain=projectedFiles.get('samples.jsonl')!;assert.equal(plain.includes(Buffer.from(secret)),false);assert.equal(plain.includes(Buffer.from('skills/')),false);
});

test('all excluded data fields fail explicitly; the new engine never includes original-source archives',async t=>{
  const {service,snapshot}=await fixture(t);snapshot.descriptor.fields=Object.fromEntries([...new Set(snapshot.rows.flatMap(Object.keys))].map(id=>[id,{export:false}]));
  assert.throws(()=>projectReleaseFields(snapshot,true),(error:unknown)=>error instanceof ApiError&&error.status===422&&error.code==='RELEASE_FIELDS_EMPTY');
  await assert.rejects(()=>build(service,'empty'),(error:unknown)=>error instanceof ApiError&&error.code==='RELEASE_FIELDS_EMPTY');assert.equal((await service.list(key,owner)).items.length,0);
  snapshot.descriptor.fields={secret:{export:false}};const projected=await build(service,'projected-no-archives'),files=await members(service,projected);assert.equal([...files.keys()].some(name=>name.startsWith('provenance/')),false);assert.equal([...files.keys()].some(name=>name.startsWith('source/archives/')),false);
});

test('projected Releases reject source-table self references and known provenance/control attachments instead of reintroducing original fields',async t=>{
  const {service,snapshot,provider}=await fixture(t);snapshot.descriptor.fields={secret:{export:false}};
  assert((await provider.raw(key,snapshot.commitId,snapshot.path)).content.includes(Buffer.from(secret)),'Fixture source table really contains excluded source bytes');
  for(const sourcePath of [snapshot.path,snapshot.descriptor.importManifestPath!,snapshot.descriptor.identityMapPath!,'source/archives/original.zip','provenance/imported-raw.json']){
    snapshot.rows[0]!.public_path=sourcePath;snapshot.attachments.push({path:sourcePath,name:'source-copy',rowIds:['stable-A'],kind:'file'});
    assert.throws(()=>projectReleaseFields(snapshot,true),(error:unknown)=>error instanceof ApiError&&error.status===422&&error.code==='RELEASE_EXPORT_SOURCE_ATTACHMENT');
    snapshot.attachments.pop();
  }
  snapshot.rows[0]!.public_path=snapshot.path;snapshot.attachments.push({path:snapshot.path,name:'source-copy',rowIds:['stable-A'],kind:'file'});
  await assert.rejects(()=>build(service,'source-self-reference'),(error:unknown)=>error instanceof ApiError&&error.code==='RELEASE_EXPORT_SOURCE_ATTACHMENT');assert.equal((await service.list(key,owner)).items.length,0);
  assert.equal(projectReleaseFields(snapshot,false).filtered,false,'Internal snapshots retain existing complete source-copy semantics');
});

test('delivery-policy changes invalidate a ready candidate while old fixed Releases retain bytes and internal snapshots obey field projection',async t=>{
  const {service,snapshot,provider,snapshots}=await fixture(t);let first=await build(service,'before');first=await service.publish(key,first.id,owner,first.revision);const originalAsset=await service.download(key,first.id,first.assets[0]!.id,owner),oldCommit=snapshot.commitId;
  const workspace=await provider.createWorkspace(key,'Synthetic delivery policy','main');await provider.writeWorkspace(key,workspace.id,'policy-note.txt',Buffer.from('Synthetic change'));const newCommit=(await provider.commitWorkspace(key,workspace.id,'Synthetic policy version')).id;
  const next=structuredClone(snapshot);next.commitId=newCommit;next.ref=newCommit;next.descriptor.fields={secret:{export:false}};snapshots.set(newCommit,next);
  const internal=await build(service,'internal','snapshot'),internalFiles=await members(service,internal);assert.equal(JSON.parse(internalFiles.get('samples.jsonl')!.toString().split('\n')[0]!).data.secret,undefined);assert(internal.assets.every(asset=>asset.audience==='internal'));
  const projected=await build(service,'after'),projectedFiles=await members(service,projected);assert.equal(JSON.parse(projectedFiles.get('samples.jsonl')!.toString().split('\n')[0]!).data.secret,undefined);
  assert.equal((await service.download(key,first.id,first.assets[0]!.id,owner)).content.equals(originalAsset.content),true);assert.equal(first.commitId,oldCommit);
  // This intentionally simulates corrupted fixed-source metadata; publication must not bless an old projection.
  next.descriptor.fields.secret={export:true};await assert.rejects(service.publish(key,projected.id,owner,projected.revision),(error:unknown)=>error instanceof ApiError&&error.code==='RELEASE_CANDIDATE_CHANGED');
});
