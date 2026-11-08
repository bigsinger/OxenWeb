/** Synthetic live acceptance: no benchmark records are read or modified. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../apps/server/src/app.js';
import { loadConfig, projectRoot } from '../apps/server/src/config.js';
import { LiveProvider } from '../apps/server/src/live.js';
import { sha256 } from '../apps/server/src/zip-io.js';

const folder=path.join(projectRoot,'.data/r3-live-acceptance'),repo='r3-draft-acceptance-20261108',key={namespace:'local',repo},base='/api/repos/local/'+repo,token=randomBytes(32).toString('base64url');
await mkdir(folder,{recursive:true});
process.env.OXEN_CONFIG_DIR=path.join(projectRoot,'infra/oxen/config/client');
const config=loadConfig({DEMO_MODE:'false',DEMO_DATA_FILE:path.join(folder,'control-plane/state.json'),OXEN_SERVER_URL:'http://127.0.0.1:3002',OXEN_NAMESPACES:'local',OXEN_CLI_ROOT:path.join(folder,'clones'),OXEN_CLI_BIN:path.join(projectRoot,'infra/oxen/bin/oxen.exe'),BFF_TOKEN:token});
const provider=new LiveProvider(config);await provider.init();
const exists=(await provider.repos()).some(item=>item.name===repo),recheck=process.argv.includes('--recheck');
if(exists&&!recheck)throw new Error('Acceptance project already exists; use --recheck only for this synthetic fixture.');
if(!exists)await provider.createRepo({namespace:'local',name:repo,description:'R3 当前合成验收：私有草稿保存、多页编辑与一次正式提交。'});
const original=Buffer.from(Array.from({length:120},(_,i)=>JSON.stringify({id:'synthetic-'+i,text:'Synthetic baseline '+i})).join('\n')+'\n');
if(!exists){
const workspace=await provider.createWorkspace(key,'Synthetic R3 baseline','main');
await provider.writeWorkspace(key,workspace.id,'data/samples.jsonl',original);
await provider.writeWorkspace(key,workspace.id,'bundle-manifest.json',Buffer.from('{"canonical_data":"data/samples.jsonl"}'));
await provider.writeWorkspace(key,workspace.id,'.oxenweb/labels.json',Buffer.from('{"version":1,"columns":[],"assignments":[]}'));
await provider.commitWorkspace(key,workspace.id,'Synthetic R3 immutable baseline');await provider.deleteWorkspace(key,workspace.id);
}
let app=await createApp(config,provider);
const call=async(method:'GET'|'POST'|'PUT',url:string,payload?:unknown,bearer=token)=>{
 const result=await app.inject({method,url,headers:{authorization:'Bearer '+bearer},...(payload===undefined?{}:{payload})});
 assert.ok(result.statusCode<300,`HTTP ${result.statusCode}: ${result.json()?.error?.code??'ERROR'}`);return result.json();
};
try{
 const org='/api/governance/organizations/local',layers:Record<string,unknown>={};
 if(!exists){
 for(const [scope,presetId]of [['dataset','dataset-ai-safety'],['sample','sample-quality']]){const id='r3_'+scope,draft=await call('POST',org+'/templates/from-preset',{presetId,id,name:'R3 '+scope});await call('POST',org+'/templates/'+id+'/publish',{expectedRevision:draft.revision});layers[scope!]={organizationId:'local',templateId:id,templateVersion:1};}
 const page=await call('GET',base+'/dataset?ref=main');await call('POST',base+'/schema/layers',{ref:'main',expectedCommit:page.commitId,layers});
 }
 const viewer=await call('POST',base+'/access',{name:'Synthetic read-only observer',role:'viewer'});
 const page=await call('GET',base+'/dataset?ref=main&pageSize=50');const second=await call('GET',base+'/dataset?ref=main&page=2&pageSize=50'),baseline=page.commitId,beforeHistory=await provider.commits(key,'main',1,500),beforeWorkspaces=await provider.workspaces(key);
 const previousText=page.rows[0].text;
 const firstId=page.rowIds[0],secondId=second.rowIds[0],operations:any[]=[{op:'update',rowId:firstId,record:{...page.rows[0],text:'Synthetic staged first'},expectedContentHash:page.contentHashes[firstId]}];
 let state=await call('PUT',base+'/dataset/draft',{ref:'main',expectedCommit:baseline,draftRevision:0,operations});
 assert.equal((await provider.branches(key)).find(item=>item.name==='main')!.commitId,baseline);
 operations.push({op:'update',rowId:secondId,record:{...second.rows[0],text:'Synthetic staged second'},expectedContentHash:second.contentHashes[secondId]});
 const quality=page.columnsByScope.row.find((column:any)=>column.id==='sample_quality'),topic=page.columnsByScope.dataset.find((column:any)=>column.id==='dataset_subject');
 operations.push({op:'assign',scope:'row',rowId:firstId,values:{sample_quality:quality.options[0].value}},{op:'assign',scope:'dataset',values:{dataset_subject:[topic.options[0].value]}});
 state=await call('PUT',base+'/dataset/draft',{ref:'main',expectedCommit:baseline,draftRevision:state.draft.draftRevision,expectedDraftId:state.draft.id,operations});
 assert.equal((await provider.branches(key)).find(item=>item.name==='main')!.commitId,baseline);
 assert.deepEqual(await provider.workspaces(key),beforeWorkspaces);
 const privatePage=await call('POST',base+'/dataset/draft/query',{ref:'main',draftRevision:state.draft.draftRevision,expectedDraftId:state.draft.id,search:'Synthetic staged',pageSize:1,page:2});assert.equal(privatePage.matchedRows,2);assert.equal(privatePage.rows[0].text,'Synthetic staged second');
 assert.deepEqual(await call('GET',base+'/dataset/draft?ref=main',undefined,viewer.token),{});
 const observer=await call('GET',base+'/dataset?ref=main',undefined,viewer.token);assert.equal(observer.rows[0].text,previousText);
 const diff=await call('GET',base+'/dataset/draft/diff?ref=main');assert.equal(diff.changes.length,4);
 await app.close();app=await createApp(config,provider);const restored=await call('GET',base+'/dataset/draft?ref=main');assert.equal(restored.draft.draftRevision,2);assert.equal(restored.draft.operations.length,4);
 const committed=await call('POST',base+'/dataset/draft/commit',{ref:'main',expectedCommit:baseline,draftRevision:2,expectedDraftId:restored.draft.id,message:'Commit four synthetic draft operations once'});
 assert.notEqual(committed.commitId,baseline);assert.equal((await provider.commits(key,'main',1,500)).length-beforeHistory.length,1);
 assert.deepEqual(await call('GET',base+'/dataset/draft?ref=main'),{});
 assert.equal(sha256((await provider.raw(key,committed.commitId,'data/samples.jsonl')).content),sha256(original));
 const final=await call('GET',base+'/dataset?ref=main');assert.equal(final.totalRows,120);assert.equal(final.rows[0].text,'Synthetic staged first');
 const receipt={version:1,mode:'official-oxen-0.67',repo,baseCommit:baseline,commitId:committed.commitId,saveCount:2,operationCount:4,commitCount:1,multiPageOverlay:true,restartRestored:true,identityIsolated:true,noWorkspaceOnSave:true,sourceSha256:sha256(original),sourceUnchanged:true,rows:120};
 await writeFile(path.join(folder,'verification.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
}finally{await app.close();}
