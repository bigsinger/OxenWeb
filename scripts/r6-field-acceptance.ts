/** Native Oxen acceptance; operates only on the retained synthetic acceptance project. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../apps/server/src/app.js';
import { loadConfig, projectRoot } from '../apps/server/src/config.js';
import { LiveProvider } from '../apps/server/src/live.js';
import { sha256 } from '../apps/server/src/zip-io.js';
const folder=path.join(projectRoot,'.data/r6-field-acceptance');await mkdir(folder,{recursive:true});
const token=randomBytes(32).toString('base64url'),key={namespace:'local',repo:'r3-draft-acceptance-20261108'},base='/api/repos/local/'+key.repo;
process.env.OXEN_CONFIG_DIR=path.join(projectRoot,'infra/oxen/config/client');
const config=loadConfig({DEMO_MODE:'false',DEMO_DATA_FILE:path.join(folder,'state.json'),OXEN_SERVER_URL:'http://127.0.0.1:3002',OXEN_NAMESPACES:'local',OXEN_CLI_ROOT:path.join(folder,'clones'),OXEN_CLI_BIN:path.join(projectRoot,'infra/oxen/bin/oxen.exe'),BFF_TOKEN:token});
const provider=new LiveProvider(config);await provider.init();const app=await createApp(config,provider);
const call=async(method:'GET'|'POST'|'PUT',url:string,payload?:unknown,status=200)=>{const result=await app.inject({method,url,headers:{authorization:'Bearer '+token},...(payload===undefined?{}:{payload})});assert.equal(result.statusCode,status,`Unexpected status ${result.statusCode}: ${result.json()?.error?.code??'ERROR'}`);return result.json();};
try{
 const page=await call('GET',base+'/dataset?ref=main'),original=await provider.raw(key,page.commitId,page.path),before=await call('GET',base+'/dataset/fields?ref=main');
 const fields={...before.configuration,r6_enabled:{displayName:'合成开关',type:'boolean',nullable:false},r6_priority:{displayName:'合成优先级',type:'string',enum:['low','high'],nullable:false},r6_categories:{displayName:'合成类别',type:'array',items:{type:'string',enum:['alpha','beta']},nullable:false},r6_quota:{displayName:'合成整数',type:'integer',nullable:false}};
 const configured=await call('PUT',base+'/dataset/fields',{ref:'main',expectedCommit:before.commitId,fields});
 assert.notEqual(configured.commitId,before.commitId);assert.deepEqual((await provider.commit(key,configured.commitId)).files.map(file=>file.path),['.oxenweb/dataset.json']);
 const fresh=await call('GET',base+'/dataset?ref=main');assert.ok(fresh.columns.some((column:any)=>column.name==='r6_enabled'));
 const index=6,rowId=fresh.rowIds[index],record={...fresh.rows[index],r6_enabled:false,r6_priority:'high',r6_categories:['beta'],r6_quota:7};
 const op=(value:any)=>[{op:'update',rowId,record:value,expectedContentHash:fresh.contentHashes[rowId]}];
 const invalids=[{...record,r6_enabled:'false'},{...record,r6_priority:'unknown'},{...record,r6_categories:['unknown']},{...record,r6_quota:1.5}];
 const workspaces=await provider.workspaces(key);
 for(const invalid of invalids)await call('PUT',base+'/dataset/draft',{ref:'main',expectedCommit:fresh.commitId,draftRevision:0,operations:op(invalid)},422);
 assert.deepEqual(await provider.workspaces(key),workspaces);
 const draft=await call('PUT',base+'/dataset/draft',{ref:'main',expectedCommit:fresh.commitId,draftRevision:0,operations:op(record)});
 const overlay=await call('POST',base+'/dataset/draft/query',{ref:'main',draftRevision:draft.draft.draftRevision,expectedDraftId:draft.draft.id,sample:rowId});
 assert.equal(overlay.rows[overlay.rowIds.indexOf(rowId)].r6_enabled,false);assert.equal(overlay.baseRows[rowId].r6_enabled,undefined);
 const committed=await call('POST',base+'/dataset/draft/commit',{ref:'main',expectedCommit:fresh.commitId,draftRevision:draft.draft.draftRevision,expectedDraftId:draft.draft.id,message:'Synthetic R6 configured field editors acceptance'});
 const final=await call('GET',base+'/dataset?ref=main');assert.equal(final.totalRows,page.totalRows);assert.equal(final.rows[index].r6_enabled,false);assert.deepEqual(final.rows[index].r6_categories,['beta']);
 assert.equal(sha256((await provider.raw(key,committed.commitId,page.path)).content),sha256(original.content));
 const conflicts=await call('PUT',base+'/dataset/fields',{ref:'main',expectedCommit:committed.commitId,fields:{...fields,r6_priority:{...fields.r6_priority,enum:['low']}}},422);assert.equal(conflicts.error.code,'DATASET_FIELD_CONFLICTS');
 assert.equal((await call('GET',base+'/dataset/fields?ref=main')).commitId,committed.commitId);
 const report={version:1,officialOxen:'0.67.0',syntheticRepo:key.repo,metadataCommit:configured.commitId,sampleCommit:committed.commitId,invalidTypedEditsRejected:invalids.length,noWorkspaceForInvalidEdits:true,enumConfigurationConflictsRejected:true,newLogicalColumnsVisible:true,booleanPreserved:true,multiSelectionPreserved:true,baselineRowsAvailable:true,rows:final.totalRows,sourceUnchanged:true};
 await writeFile(path.join(folder,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await app.close();}
