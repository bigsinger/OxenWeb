/** Official Oxen synthetic acceptance. Never reads or edits a benchmark sample body. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../apps/server/src/app.js';
import { loadConfig, projectRoot } from '../apps/server/src/config.js';
import { LiveProvider } from '../apps/server/src/live.js';
import { sha256 } from '../apps/server/src/zip-io.js';
const folder=path.join(projectRoot,'.data/r5-live-acceptance');await mkdir(folder,{recursive:true});
const token=randomBytes(32).toString('base64url'),key={namespace:'local',repo:'r3-draft-acceptance-20261108'},base='/api/repos/local/'+key.repo,branch='r5-edit-smoke';
process.env.OXEN_CONFIG_DIR=path.join(projectRoot,'infra/oxen/config/client');
const config=loadConfig({DEMO_MODE:'false',DEMO_DATA_FILE:path.join(folder,'state.json'),OXEN_SERVER_URL:'http://127.0.0.1:3002',OXEN_NAMESPACES:'local',OXEN_CLI_ROOT:path.join(folder,'clones'),OXEN_CLI_BIN:path.join(projectRoot,'infra/oxen/bin/oxen.exe'),BFF_TOKEN:token});
const provider=new LiveProvider(config);await provider.init();
if(!(await provider.branches(key)).some(item=>item.name===branch))await provider.createBranch(key,branch,'main');
const app=await createApp(config,provider);
const call=async(method:'GET'|'POST'|'PUT',url:string,payload?:unknown,status=200)=>{const result=await app.inject({method,url,headers:{authorization:'Bearer '+token},...(payload===undefined?{}:{payload})});assert.equal(result.statusCode,status,`Unexpected status ${result.statusCode}: ${result.json()?.error?.code??'ERROR'}`);return result.json();};
try{
 const page=await call('GET',base+'/dataset?ref='+branch),rowId=page.rowIds[1],record={...page.rows[1],text:'Synthetic inline edit '+randomUUID().slice(0,8)};
 const operations:any[]=[{op:'update',rowId,record,expectedContentHash:page.contentHashes[rowId]}];
 let draft=await call('PUT',base+'/dataset/draft',{ref:branch,expectedCommit:page.commitId,draftRevision:0,operations});
 const workspaceBefore=await provider.workspaces(key),source=await provider.raw(key,page.commitId,page.path),project=await call('GET',base+'/project-labels');
 const column=project.columns.find((item:any)=>item.id==='dataset_subject'),next=column.options.find((item:any)=>!project.values.dataset_subject?.includes(item.value))??column.options[0],values={...project.values,dataset_subject:[next.value]};
 const saved=await call('PUT',base+'/project-labels',{expectedCommit:project.commitId,values,message:'Synthetic R5 project labels only'});
 assert.notEqual(saved.commitId,project.commitId);assert.deepEqual((await provider.commit(key,saved.commitId)).files.map(item=>item.path),['.oxenweb/dataset/dataset-labels.json']);
 assert.deepEqual(await provider.workspaces(key),workspaceBefore);assert.equal((await provider.branches(key)).find(item=>item.name===branch)!.commitId,page.commitId);
 const preserved=await call('GET',base+'/dataset/draft?ref='+branch);assert.deepEqual(preserved.draft,draft.draft);
 const noop=await call('PUT',base+'/project-labels',{expectedCommit:saved.commitId,values});assert.equal(noop.commitId,saved.commitId);
 await call('PUT',base+'/project-labels',{expectedCommit:project.commitId,values},409);
 const copied={...record,id:'synthetic-copy-'+randomUUID()},copyId='new:'+randomUUID();operations.push({op:'append',rowId:copyId,record:copied});
 draft=await call('PUT',base+'/dataset/draft',{ref:branch,expectedCommit:page.commitId,draftRevision:draft.draft.draftRevision,expectedDraftId:draft.draft.id,operations});
 const overlay=await call('POST',base+'/dataset/draft/query',{ref:branch,draftRevision:draft.draft.draftRevision,expectedDraftId:draft.draft.id,sample:copyId});assert.ok(overlay.rowIds.includes(copyId));assert.equal(overlay.totalRows,page.totalRows+1);
 const committed=await call('POST',base+'/dataset/draft/commit',{ref:branch,expectedCommit:page.commitId,draftRevision:draft.draft.draftRevision,expectedDraftId:draft.draft.id,message:'Synthetic inline edit and copied sample in one commit'});
 assert.equal(sha256((await provider.raw(key,committed.commitId,page.path)).content),sha256(source.content));
 const final=await call('GET',base+'/project-labels');assert.equal(final.commitId,saved.commitId);assert.deepEqual(final.values,values);
 const current=await call('GET',base+'/dataset?ref='+branch);assert.equal(current.totalRows,page.totalRows+1);assert.equal(current.labels.assignments.some((item:any)=>item.scope==='row'&&item.rowId===copyId),false);
 const report={version:1,officialOxen:'0.67.0',repo:key.repo,branch,projectLabelCommit:saved.commitId,sampleCommit:committed.commitId,projectSaveOnlyOneFile:true,sampleDraftPreserved:true,noOpNoCommit:true,staleRejected:true,sourceUnchanged:true,copiedRowHasNoAnnotation:true,rowsBefore:page.totalRows,rowsAfter:current.totalRows};
 await writeFile(path.join(folder,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await app.close();}
