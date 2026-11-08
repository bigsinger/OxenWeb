/** Synthetic native Oxen acceptance for explicit metadata-only draft base synchronization. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../apps/server/src/app.js';
import { loadConfig, projectRoot } from '../apps/server/src/config.js';
import { LiveProvider } from '../apps/server/src/live.js';
import { sha256 } from '../apps/server/src/zip-io.js';
const folder=path.join(projectRoot,'.data/r5-main-draft-acceptance');await mkdir(folder,{recursive:true});
const token=randomBytes(32).toString('base64url'),key={namespace:'local',repo:'r3-draft-acceptance-20261108'},base='/api/repos/local/'+key.repo;
process.env.OXEN_CONFIG_DIR=path.join(projectRoot,'infra/oxen/config/client');
const config=loadConfig({DEMO_MODE:'false',DEMO_DATA_FILE:path.join(folder,'state.json'),OXEN_SERVER_URL:'http://127.0.0.1:3002',OXEN_NAMESPACES:'local',OXEN_CLI_ROOT:path.join(folder,'clones'),OXEN_CLI_BIN:path.join(projectRoot,'infra/oxen/bin/oxen.exe'),BFF_TOKEN:token});
const provider=new LiveProvider(config);await provider.init();const app=await createApp(config,provider);
const call=async(method:'GET'|'POST'|'PUT',url:string,payload?:unknown,status=200)=>{const result=await app.inject({method,url,headers:{authorization:'Bearer '+token},...(payload===undefined?{}:{payload})});assert.equal(result.statusCode,status,`Unexpected status ${result.statusCode}: ${result.json()?.error?.code??'ERROR'}`);return result.json();};
try{
 const page=await call('GET',base+'/dataset?ref=main'),rowId=page.rowIds[3],record={...page.rows[3],text:'Synthetic main draft before project label edit'};
 const original=await provider.raw(key,page.commitId,page.path),operations=[{op:'update',rowId,record,expectedContentHash:page.contentHashes[rowId]}];
 const saved=await call('PUT',base+'/dataset/draft',{ref:'main',expectedCommit:page.commitId,draftRevision:0,operations});
 const project=await call('GET',base+'/project-labels'),column=project.columns.find((item:any)=>item.id==='dataset_subject'),next=column.options.find((item:any)=>!project.values.dataset_subject?.includes(item.value));
 assert.ok(next);const tagged=await call('PUT',base+'/project-labels',{expectedCommit:project.commitId,values:{...project.values,dataset_subject:[next.value]},message:'Synthetic main draft label advance'});
 const stale=await call('GET',base+'/dataset/draft?ref=main');assert.ok(stale.issue);assert.equal(stale.summary.id,saved.draft.id);
 const exported=await call('GET',base+'/dataset/draft/export?ref=main');assert.deepEqual(exported.draft.operations,operations);
 const workspaces=await provider.workspaces(key),heads=await provider.branches(key);
 const edited=[{...operations[0],record:{...record,text:'Synthetic main draft after explicit project label synchronization'}}];
 const rebased=await call('POST',base+'/dataset/draft/rebase',{ref:'main',expectedBaseCommit:page.commitId,expectedCommit:tagged.commitId,draftRevision:saved.draft.draftRevision,expectedDraftId:saved.draft.id,operations:edited});
 assert.equal(rebased.draft.baseCommit,tagged.commitId);assert.equal(rebased.draft.draftRevision,saved.draft.draftRevision+1);assert.deepEqual(rebased.draft.operations,edited);
 assert.deepEqual(await provider.workspaces(key),workspaces);assert.deepEqual(await provider.branches(key),heads);
 const committed=await call('POST',base+'/dataset/draft/commit',{ref:'main',expectedCommit:rebased.draft.baseCommit,draftRevision:rebased.draft.draftRevision,expectedDraftId:rebased.draft.id,message:'Synthetic main draft explicit synchronization acceptance'});
 assert.equal(sha256((await provider.raw(key,committed.commitId,page.path)).content),sha256(original.content));
 const final=await call('GET',base+'/dataset?ref=main');assert.equal(final.totalRows,page.totalRows);assert.equal(final.rows[3].text,edited[0].record.text);
 const report={version:1,officialOxen:'0.67.0',repo:key.repo,branch:'main',staleDraftRetained:true,staleExportExact:true,explicitSyncPreservesLatestEdits:true,syncCreatesNoCommitOrWorkspace:true,sourceUnchanged:true,rows:final.totalRows,labelCommit:tagged.commitId,sampleCommit:committed.commitId};
 await writeFile(path.join(folder,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await app.close();}
