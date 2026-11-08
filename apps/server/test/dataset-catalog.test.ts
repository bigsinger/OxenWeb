import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import type {LabelColumn,ProjectSchemaBinding,ProjectSchemaState,PublishedTemplateSnapshot,RepoSummary,RequestIdentity} from '../../../packages/shared/src/index.js';
import type {DatasetLabelRecord} from '../../../packages/shared/src/dataset.js';
import type {DatasetCatalogField,RepositoryLocalActivity} from '../../../packages/shared/src/catalog-types.js';
import {DatasetCatalogService} from '../src/dataset-catalog.js';
import {DemoProvider} from '../src/demo.js';
import {DATASET_LABELS_PATH} from '../src/dataset-label-summary.js';
import {labelFingerprint,labelRecordPath} from '../src/dataset-storage.js';
import {ApiError} from '../src/errors.js';
import {catalogFacets,catalogKeyword,filterCatalogRepos,sortCatalogRepos} from '../../web/src/catalog.js';

const key={namespace:'oxen',repo:'visual-search'},owner:RequestIdentity={id:'owner',name:'Synthetic owner',kind:'owner',source:'local'};
const columns:LabelColumn[]=[
  {id:'dataset_subject',name:'研究主题',semanticKey:'dataset.subject',description:'Synthetic subject',type:'multi',scopes:['dataset'],options:[{value:'prompt',optionId:'prompt',displayName:'提示词注入'},{value:'skill',optionId:'skill',displayName:'Skill 供应链'}]},
  {id:'purpose',name:'用途',semanticKey:'dataset.purpose',type:'multi',scopes:['dataset'],options:[{value:'research',displayName:'研究'},{value:'evaluation',displayName:'评测'}]},
  {id:'source',name:'来源',semanticKey:'dataset.source',type:'single',scopes:['dataset'],options:[{value:'synthetic',displayName:'人工构造'},{value:'public',displayName:'公开基准'}]},
];
const snapshot:PublishedTemplateSnapshot={id:'dataset_catalog',name:'Synthetic dataset catalog',domain:'ai-safety',description:'Synthetic only',organizationId:'oxen',version:1,checksum:'a'.repeat(64),publishedAt:'2026-11-08T00:00:00Z',publishedBy:'owner',targetKind:'dataset',bindings:columns.map((column,index)=>({dimensionId:column.id,dimensionVersion:1,scopes:['dataset'],required:false,order:index})),dimensions:columns.map(column=>({id:column.id,displayName:column.name,type:column.type,description:column.description??'',semanticKey:column.semanticKey,options:(column.options??[]).map(option=>({id:option.optionId??option.value,displayName:option.displayName??option.value})),version:1,checksum:'f'.repeat(64),publishedAt:'2026-11-08T00:00:00Z',publishedBy:'owner'})),columns};
const layer={organizationId:'oxen',templateId:snapshot.id,templateVersion:1,checksum:snapshot.checksum,snapshot,boundAt:'2026-11-08T00:00:00Z',boundBy:'owner'};
const binding:ProjectSchemaBinding={version:2,layers:{dataset:layer},checksum:'b'.repeat(64),boundAt:layer.boundAt,boundBy:'owner'};
function schema(commitId:string,selected:ProjectSchemaBinding|undefined=binding):ProjectSchemaState{return {commitId,...(selected?{binding:selected}:{}),columnsByScope:{dataset:columns,row:[],file:[]},compatibility:{mode:selected?'layered-v2':'unbound',legacyColumnsByScope:{dataset:[],row:[],file:[]},warnings:[]}};}
async function setup(t:{after:(callback:()=>Promise<void>)=>void}){
  await mkdir(path.resolve('.data/tests'),{recursive:true});const directory=await mkdtemp(path.resolve('.data/tests/dataset-catalog-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const provider=new DemoProvider(path.join(directory,'demo.json'));await provider.init();const calls:string[]=[],raw=provider.raw.bind(provider);provider.raw=async(k,ref,filename)=>{calls.push(filename);if(/\.(csv|jsonl|ndjson)$/.test(filename))throw new Error('Catalog must not read canonical sample rows');return raw(k,ref,filename);};
  let selected:ProjectSchemaBinding|undefined=binding,local:RepositoryLocalActivity={};let bindingReads=0;
  const service=new DatasetCatalogService({provider,authorize:async(_key,identity)=>{if(identity.id==='denied')throw new ApiError(403,'FORBIDDEN','Synthetic read denied');},readBinding:async(_key,commitId)=>{bindingReads++;return schema(commitId,selected);},readActivity:async(_key,identity)=>identity.id==='owner'?local:{}});
  const head=async(branch='main')=>(await provider.branches(key)).find(item=>item.name===branch)!.commitId;
  const authority=async(branch:string,values:DatasetLabelRecord['values'],recordBinding:ProjectSchemaBinding|undefined=binding)=>{
    const expected=await head(branch),workspace=await provider.createWorkspace(key,'Synthetic catalog metadata',branch),record:DatasetLabelRecord={version:1,scope:'dataset',actor:{id:'owner',name:'Synthetic'},values,spans:[],steps:[],sourceCommitId:expected,updatedAt:'2026-11-08T01:00:00Z',fingerprint:'',templateSnapshot:{columns,...(recordBinding?{binding:recordBinding}:{})}};record.fingerprint=labelFingerprint(record);await provider.writeWorkspace(key,workspace.id,DATASET_LABELS_PATH,Buffer.from(JSON.stringify(record)));return provider.commitWorkspace(key,workspace.id,'Synthetic dataset catalog update');
  };
  return {provider,service,calls,authority,head,setBinding:(value:ProjectSchemaBinding|undefined)=>{selected=value;},setLocal:(value:RepositoryLocalActivity)=>{local=value;},bindingReads:()=>bindingReads};
}

test('catalog fixes main independent of the configured default, reads only metadata, and invalidates by actual main head',async t=>{
  const {provider,service,calls,authority,bindingReads}=await setup(t);const main=await authority('main',{dataset_subject:['prompt'],purpose:['research'],source:'synthetic'});await provider.createBranch(key,'catalog-review','main');const review=await authority('catalog-review',{dataset_subject:['skill'],purpose:['evaluation'],source:'public'});
  const summary={...await provider.repo(key),defaultBranch:'catalog-review',updatedAt:'2000-01-01T00:00:00Z'},first=await service.enrichSummary(summary,owner);
  assert.equal(first.catalog?.branch,'main');assert.equal(first.catalog?.commitId,main.id);assert.equal(first.catalog?.fields.find(field=>field.dimensionId==='dataset_subject')?.values[0]?.id,'prompt');assert.equal(first.catalog?.state,'ready');
  assert.equal(first.catalog?.templates.dataset?.version,1);assert.equal(first.catalog?.templates.dataset?.legacy,false);assert.equal(calls.some(filename=>/\.(csv|jsonl)$/.test(filename)),false);
  const before=bindingReads();await service.enrichSummary(summary,owner);assert.equal(bindingReads(),before,'immutable fixed-commit labels can be reused');
  const next=await authority('main',{dataset_subject:['prompt','skill'],purpose:['research'],source:'synthetic'}),changed=await service.enrichSummary(summary,owner);
  assert.equal(changed.catalog?.commitId,next.id);assert.deepEqual(changed.catalog?.fields.find(field=>field.dimensionId==='dataset_subject')?.values.map(value=>value.id),['prompt','skill']);assert.equal(bindingReads(),before+1);
  const history=await service.branchSummary(key,review.id,owner);assert.equal(history.commitId,next.id);assert.equal(history.fields.find(field=>field.dimensionId==='source')?.values[0]?.id,'synthetic');
});

test('a commit on a nondefault branch updates activity while project labels remain on main',async t=>{
  const {provider,service,authority,head,setLocal}=await setup(t);const main=await authority('main',{dataset_subject:['prompt']});await provider.createBranch(key,'work','main');const work=await authority('work',{dataset_subject:['skill']});
  const original=provider.commits.bind(provider);provider.commits=async(...args)=>(await original(...args)).map(item=>({...item,timestamp:item.id===work.id?'2026-11-08T05:00:00Z':'2026-11-08T01:00:00Z'}));
  const summary={...await provider.repo(key),updatedAt:'1999-01-01T00:00:00Z'},result=await service.enrichSummary(summary,owner);
  assert.equal(result.updatedAt,'2026-11-08T05:00:00.000Z');assert.equal(result.activity?.source,'commit');assert.equal(result.activity?.branch,'work');assert.equal(result.activity?.commitId,work.id);assert.equal(result.catalog?.commitId,main.id);assert.equal(await head('main'),main.id);
  setLocal({createdAt:'2026-11-08T00:00:00Z',localDraftAt:'2026-11-08T06:00:00Z'});const draft=await service.enrichSummary(summary,owner);assert.equal(draft.activity?.source,'local-draft');assert.equal(draft.activity?.committedAt,'2026-11-08T05:00:00.000Z');assert.equal(draft.catalog?.commitId,main.id);
  const other=await service.enrichSummary(summary,{...owner,id:'another-reader'});assert.equal(other.activity?.localDraftAt,undefined);assert.equal(other.updatedAt,'2026-11-08T05:00:00.000Z');
});

test('unknown times stay unknown and denied identities cause no metadata read',async t=>{
  const {provider,service,calls}=await setup(t),summary=await provider.repo(key);const before=calls.length;let branchReads=0;const branches=provider.branches.bind(provider);provider.branches=async(...args)=>{branchReads++;return branches(...args);};
  await assert.rejects(service.enrichSummary(summary,{...owner,id:'denied'}),(error:unknown)=>error instanceof ApiError&&error.status===403);assert.equal(branchReads,0);assert.equal(calls.length,before);
  const commits=provider.commits.bind(provider);provider.commits=async(...args)=>(await commits(...args)).map(item=>({...item,timestamp:'invalid-time'}));
  const result=await service.enrichSummary({...summary,updatedAt:'2020-01-01T00:00:00Z'},owner);assert.equal(result.updatedAt,'');assert.equal(result.createdAt,undefined);assert.equal(result.activity?.modifiedAt,undefined);assert.equal(result.activity?.state,'partial');
});

test('new dataset layers do not reinterpret legacy same-ID values or count conflicts as unassigned',async t=>{
  const {provider,service,authority}=await setup(t);const legacy:ProjectSchemaBinding={version:1,...layer,snapshot:{...snapshot,targetKind:undefined,checksum:'c'.repeat(64)},checksum:'c'.repeat(64)};
  await authority('main',{source:'public'},legacy);const result=await service.enrichSummary(await provider.repo(key),owner);assert.equal(result.catalog?.state,'unassigned');assert.equal(result.catalog?.fields.find(field=>field.dimensionId==='source')?.values.length,0);assert.equal(result.catalog?.warnings.length,0);
  const bad=await authority('main',{source:'not-in-published-options'});const unavailable=await service.enrichSummary(await provider.repo(key),owner);assert.equal(unavailable.catalog?.commitId,bad.id);assert.equal(unavailable.catalog?.state,'unavailable');
});

test('compatible optional template upgrades retain actual values, while switching templates excludes retired values',async t=>{
  const {provider,service,authority,setBinding}=await setup(t);await authority('main',{source:'public'});
  const upgraded:ProjectSchemaBinding={...binding,version:2,layers:{dataset:{...layer,templateVersion:2,checksum:'d'.repeat(64),snapshot:{...snapshot,version:2,checksum:'d'.repeat(64),columns:[...columns,{id:'optional_note',name:'Optional note',type:'text',scopes:['dataset']}],bindings:[...snapshot.bindings,{dimensionId:'optional_note',dimensionVersion:1,scopes:['dataset'],required:false,order:4}]}}}};
  setBinding(upgraded);let workspace=await provider.createWorkspace(key,'Synthetic optional version','main');await provider.writeWorkspace(key,workspace.id,'.oxenweb/schema-binding.json',Buffer.from(JSON.stringify(upgraded)));await provider.commitWorkspace(key,workspace.id,'Synthetic compatible dataset template upgrade');
  const result=await service.enrichSummary(await provider.repo(key),owner);assert.equal(result.catalog?.templates.dataset?.version,2);assert.equal(result.catalog?.state,'ready');assert.equal(result.catalog?.fields.find(field=>field.dimensionId==='source')?.values[0]?.id,'public');assert.equal(result.catalog?.fields.find(field=>field.dimensionId==='optional_note')?.values.length,0);
  const switched:ProjectSchemaBinding={...upgraded,layers:{dataset:{...upgraded.layers.dataset!,templateId:'different_template',snapshot:{...upgraded.layers.dataset!.snapshot,id:'different_template'},checksum:'e'.repeat(64)}}};setBinding(switched);workspace=await provider.createWorkspace(key,'Synthetic different template','main');await provider.writeWorkspace(key,workspace.id,'.oxenweb/schema-binding.json',Buffer.from(JSON.stringify(switched)));await provider.commitWorkspace(key,workspace.id,'Synthetic explicit different template');
  const other=await service.enrichSummary(await provider.repo(key),owner);assert.equal(other.catalog?.state,'unassigned');assert.equal(other.catalog?.fields.find(field=>field.dimensionId==='source')?.values.length,0);assert.equal(other.catalog?.warnings.length,0);
});

test('retired mixed schemas do not create directory facets or load old opinions',async t=>{
  const {provider,service,setBinding,calls,head}=await setup(t);const legacy:ProjectSchemaBinding={version:1,...layer};setBinding(legacy);
  const expected=await head(),workspace=await provider.createWorkspace(key,'Synthetic legacy disagreement','main');
  await provider.writeWorkspace(key,workspace.id,'.oxenweb/labels.json',Buffer.from(JSON.stringify({version:1,columns,assignments:[]})));
  await provider.writeWorkspace(key,workspace.id,'.oxenweb/dataset/format.json',Buffer.from('{"version":1}'));
  for(const [id,value]of [['reviewer-a','public'],['reviewer-b','synthetic']]){
    const record:DatasetLabelRecord={version:1,scope:'dataset',actor:{id:id!,name:'Synthetic actor'},values:{source:value!},spans:[],steps:[],sourceCommitId:expected,updatedAt:'2026-11-08T01:00:00Z',fingerprint:'',templateSnapshot:{columns,binding:legacy}};record.fingerprint=labelFingerprint(record);await provider.writeWorkspace(key,workspace.id,labelRecordPath(record,id!),Buffer.from(JSON.stringify(record)));
  }
  await provider.writeWorkspace(key,workspace.id,'.oxenweb/dataset/labels/row/not-catalog.json',Buffer.from('{"synthetic":"Do not load sample opinion bodies into a catalog"}'));
  await provider.commitWorkspace(key,workspace.id,'Synthetic legacy label disagreement');
  const result=await service.enrichSummary(await provider.repo(key),owner),source=result.catalog?.fields.find(field=>field.dimensionId==='source');
  assert.equal(result.catalog?.state,'unconfigured');assert.equal(source,undefined);assert.equal(result.catalog?.fields.length,0);assert.deepEqual(result.catalog?.templates,{});
  assert.equal(calls.some(filename=>filename.includes('/labels/row/')),false);assert.equal(filterCatalogRepos([result],[],'unassigned').length,0);
});

function repo(name:string,organizationId='org-a',subject='prompt',purpose='research'):RepoSummary{
  const field=(id:string,role:DatasetCatalogField['role'],selected:string):DatasetCatalogField=>({key:JSON.stringify([organizationId,id]),organizationId,dimensionId:id,name:id,type:'multi',description:'Synthetic facet',role,options:[{id:selected,value:selected,label:selected},{id:'other',value:'other',label:'other'}],values:[{id:selected,value:selected,label:selected}],conflicted:false});
  return {namespace:organizationId,name,description:'Synthetic',tags:['legacy-keyword'],defaultBranch:'main',updatedAt:'',size:1,fileCount:1,visibility:'private',catalog:{branch:'main',commitId:name,state:'ready',fields:[field('dataset_subject','subject',subject),field('purpose','purpose',purpose)],templates:{dataset:{organizationId,id:'catalog',name:'Synthetic catalog',version:1,checksum:'a',domain:'ai-safety',legacy:false}},warnings:[]}};
}
test('structured filters use OR within a dimension, AND across dimensions, and count the full authorized input',()=>{
  const rows=Array.from({length:47},(_,index)=>repo('repo-'+String(index).padStart(2,'0'),'org-a',index%2?'skill':'prompt',index%3?'research':'evaluation'));
  const subjectKey=JSON.stringify(['org-a','dataset_subject']),purposeKey=JSON.stringify(['org-a','purpose']);
  assert.equal(filterCatalogRepos(rows,[{key:subjectKey,values:['skill','prompt']}]).length,47);
  const result=filterCatalogRepos(rows,[{key:subjectKey,values:['skill']},{key:purposeKey,values:['evaluation']}]);assert.equal(result.length,8);
  const facets=catalogFacets(rows,[{key:purposeKey,values:['evaluation']}]);assert.equal(facets.find(facet=>facet.key===subjectKey)?.options.find(option=>option.id==='prompt')?.count,8);assert.equal(facets.find(facet=>facet.key===subjectKey)?.options.find(option=>option.id==='skill')?.count,8);
  const privateOtherOrg=repo('not-authorized','org-b');assert.equal(catalogFacets(rows,[]).some(facet=>facet.organizationId===privateOtherOrg.namespace),false);assert.equal(filterCatalogRepos([...rows,privateOtherOrg],[{key:subjectKey,values:['prompt']}]).some(item=>item.namespace==='org-b'),false);
  const unassigned=repo('unset');unassigned.catalog!.state='unassigned';unassigned.catalog!.fields.forEach(field=>field.values=[]);const conflict=repo('conflict');conflict.catalog!.state='conflicted';conflict.catalog!.fields[0]!.conflicted=true;
  assert.deepEqual(filterCatalogRepos([unassigned,conflict],[{key:subjectKey,values:[],unset:true}]).map(item=>item.name),['unset']);assert.deepEqual(filterCatalogRepos([unassigned,conflict],[],'unassigned').map(item=>item.name),['unset']);
  assert.ok(catalogKeyword(rows[0]!).includes('legacy-keyword'));assert.equal(filterCatalogRepos(rows,[{key:subjectKey,values:['legacy-keyword']}]).length,0,'free keywords never become structured labels');
});

test('created/modified descending sorting puts unknown times last and has deterministic ties',()=>{
  const a=repo('a'),b=repo('b'),c=repo('c'),unknown=repo('0-unknown');
  a.activity={modifiedAt:'2026-11-08T04:00:00Z',createdAt:'2026-11-08T01:00:00Z',source:'commit',state:'ready'};
  b.activity={modifiedAt:'2026-11-08T05:00:00Z',createdAt:'2026-11-08T02:00:00Z',source:'local-draft',state:'ready'};
  c.activity={...b.activity};unknown.activity={source:'unknown',state:'unavailable'};unknown.updatedAt='2099-01-01T00:00:00Z';
  assert.deepEqual(sortCatalogRepos([unknown,c,a,b],'updated').map(item=>item.name),['b','c','a','0-unknown']);assert.deepEqual(sortCatalogRepos([c,unknown,a,b],'created').map(item=>item.name),['b','c','a','0-unknown']);
  const epoch=repo('epoch');epoch.activity={source:'commit',state:'ready',modifiedAt:'1970-01-01T00:00:00Z'};assert.deepEqual(sortCatalogRepos([unknown,epoch],'updated').map(item=>item.name),['epoch','0-unknown']);
});
