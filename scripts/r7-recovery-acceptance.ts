/** Synthetic official Oxen verification: checkpoints + presentation-only width commits. */
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createApp} from '../apps/server/src/app.js';
import {loadConfig,projectRoot} from '../apps/server/src/config.js';
import {LiveProvider} from '../apps/server/src/live.js';
import {sha256} from '../apps/server/src/zip-io.js';
const folder=path.join(projectRoot,'.data/r7-native');await mkdir(folder,{recursive:true});
const token=randomBytes(32).toString('base64url'),key={namespace:'local',repo:'r3-draft-acceptance-20261108'},base='/api/repos/local/'+key.repo;
process.env.OXEN_CONFIG_DIR=path.join(projectRoot,'infra/oxen/config/client');
const config=loadConfig({DEMO_MODE:'false',DEMO_DATA_FILE:path.join(folder,'state.json'),OXEN_SERVER_URL:'http://127.0.0.1:3002',OXEN_NAMESPACES:'local',OXEN_CLI_ROOT:path.join(folder,'clones'),OXEN_CLI_BIN:path.join(projectRoot,'infra/oxen/bin/oxen.exe'),BFF_TOKEN:token});
const provider=new LiveProvider(config);await provider.init();const app=await createApp(config,provider);
const call=async(method:'GET'|'POST'|'PUT'|'DELETE',url:string,payload?:unknown,status=200)=>{const result=await app.inject({method,url,headers:{authorization:'Bearer '+token},...(payload===undefined?{}:{payload})});assert.equal(result.statusCode,status,`Unexpected status ${result.statusCode}: ${result.json()?.error?.code??'ERROR'}`);return result.json();};
try{
 const page=await call('GET',base+'/dataset?ref=main'),original=await provider.raw(key,page.commitId,page.path),before=await call('GET',base+'/dataset/fields?ref=main');
 const heads=await provider.branches(key),workspaces=await provider.workspaces(key),fieldPayload={version:1,rawOption:'',widthText:'',unfinishedText:'Synthetic unsaved field explanation',baseConfiguration:before.configuration};
 const checkpoint=await call('PUT',base+'/dataset/ui-state',{ref:'main',kind:'field-settings',revision:0,baseCommit:page.commitId,payload:fieldPayload});
 const rawCheckpoint=await call('PUT',base+'/dataset/ui-state',{ref:'main',kind:'workbench',revision:0,baseCommit:page.commitId,payload:{version:2,editing:true,json:'{',cellText:'not-a-number',drawer:'append'}});
 assert.deepEqual(await provider.branches(key),heads);assert.deepEqual(await provider.workspaces(key),workspaces);
 const rowId=page.rowIds[9],operations=[{op:'update',rowId,record:{...page.rows[9],text:'Synthetic R7 pending sample remains across width configuration'},expectedContentHash:page.contentHashes[rowId]}];
 const draft=await call('PUT',base+'/dataset/draft',{ref:'main',expectedCommit:page.commitId,draftRevision:0,operations});
 const fields={...before.configuration,text:{...before.configuration.text,width:{mode:'weight',value:5}},r6_priority:{...before.configuration.r6_priority,width:{mode:'fixed',value:88}},r6_quota:{...before.configuration.r6_quota,width:{mode:'weight',value:1}}};
 const width=await call('PUT',base+'/dataset/fields',{ref:'main',expectedCommit:before.commitId,fields,message:'Synthetic R7 fixed and weighted column widths'});
 assert.deepEqual((await provider.commit(key,width.commitId)).files.map(file=>file.path),['.oxenweb/dataset.json']);
 assert.equal((await call('GET',base+'/dataset/ui-state?ref=main&kind=workbench')).state.payload.json,'{');
 const synced=await call('POST',base+'/dataset/draft/rebase',{ref:'main',expectedBaseCommit:page.commitId,expectedCommit:width.commitId,draftRevision:draft.draft.draftRevision,expectedDraftId:draft.draft.id});
 assert.equal(synced.draft.schemaHash,draft.draft.schemaHash);assert.deepEqual(synced.draft.operations,draft.draft.operations);
 const commit=await call('POST',base+'/dataset/draft/commit',{ref:'main',expectedCommit:width.commitId,draftRevision:synced.draft.draftRevision,expectedDraftId:synced.draft.id,message:'Synthetic R7 sample after independent width commit'});
 const kept=await call('GET',base+'/dataset/ui-state?ref=main&kind=field-settings');assert.deepEqual(kept.state.payload,fieldPayload);
 assert.equal((await call('GET',base+'/dataset?ref=main')).totalRows,page.totalRows);assert.equal(sha256((await provider.raw(key,commit.commitId,page.path)).content),sha256(original.content));
 const next=await call('PUT',base+'/dataset/ui-state',{ref:'main',kind:'field-settings',revision:checkpoint.state.revision,expectedId:checkpoint.state.id,baseCommit:commit.commitId,payload:fieldPayload});
 await call('PUT',base+'/dataset/ui-state',{ref:'main',kind:'field-settings',revision:checkpoint.state.revision,expectedId:checkpoint.state.id,payload:fieldPayload},409);
 await call('DELETE',base+'/dataset/ui-state',{ref:'main',kind:'field-settings',revision:next.state.revision,expectedId:next.state.id});
 await call('DELETE',base+'/dataset/ui-state',{ref:'main',kind:'workbench',revision:rawCheckpoint.state.revision,expectedId:rawCheckpoint.state.id});
 const report={version:1,officialOxen:'0.67.0',syntheticRepo:key.repo,checkpointsNoCommitOrWorkspace:true,invalidRawInputsPreserved:true,fieldFormSurvivesSampleCommit:true,checkpointCasRejected:true,widthCommitWithExistingDraft:true,widthAndSampleSchemaHashEqual:true,metadataSyncRetainsDraft:true,sourceUnchanged:true,rows:page.totalRows,widthCommit:width.commitId,sampleCommit:commit.commitId};
 await writeFile(path.join(folder,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await app.close();}
