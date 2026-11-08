/** Official Oxen acceptance. Creates one synthetic project; never touches benchmark projects. */
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createApp} from '../apps/server/src/app.js';
import {loadConfig,projectRoot} from '../apps/server/src/config.js';
import {LiveProvider} from '../apps/server/src/live.js';
const directory=path.join(projectRoot,'.data/r8-native');await mkdir(directory,{recursive:true});
const token=randomBytes(32).toString('base64url'),key={namespace:'local',repo:process.env.R8_ACCEPTANCE_REPO??'r8-project-acceptance-'+Date.now().toString(36)},base='/api/repos/local/'+key.repo;
if(!/^r8-project-acceptance-[a-z0-9-]+$/.test(key.repo))throw new Error('Only the R8 synthetic acceptance namespace is allowed.');
process.env.OXEN_CONFIG_DIR=path.join(projectRoot,'infra/oxen/config/client');
const config=loadConfig({DEMO_MODE:'false',DEMO_DATA_FILE:path.join(directory,'state.json'),OXEN_SERVER_URL:process.env.OXEN_SERVER_URL??'http://127.0.0.1:3002',OXEN_NAMESPACES:'local',OXEN_CLI_ROOT:path.join(directory,'clones'),OXEN_CLI_BIN:process.env.OXEN_CLI_BIN??path.join(projectRoot,'infra/oxen/bin',process.platform==='win32'?'oxen.exe':'oxen'),BFF_TOKEN:token});
const provider=new LiveProvider(config);await provider.init();const app=await createApp(config,provider);
async function call(method:'GET'|'POST'|'PUT'|'PATCH',url:string,payload?:unknown,status=200){const result=await app.inject({method,url,headers:{authorization:'Bearer '+token},...(payload===undefined?{}:{payload})});assert.equal(result.statusCode,status,`${method} ${url.split('?')[0]}: ${result.json()?.error?.code??'ERROR'}`);return result.json();}
try{
 if(!(await provider.repos('local')).some(repo=>repo.name===key.repo))await call('POST','/api/repos',{namespace:key.namespace,name:key.repo,description:'Synthetic R8 official acceptance',visibility:'private'},201);
 let setup=await call('GET',base+'/dataset/setup?ref=main');assert.equal(setup.configured,false);assert.equal(setup.canInitialize,true);
 const readme=await call('GET',base+'/readme?ref=main'),readmeSaved=await call('PUT',base+'/readme',{ref:'main',expectedCommit:readme.commitId,content:'# Synthetic R8 dataset\n\nInert acceptance records only.\n',message:'Synthetic README before first sample'});
 assert.notEqual(readmeSaved.commitId,readme.commitId);setup=await call('GET',base+'/dataset/setup?ref=main');
 const initialized=await call('POST',base+'/dataset/initialize-empty',{ref:'main',expectedCommit:setup.commitId});
 let page=await call('GET',base+'/dataset?ref=main');assert.equal(page.totalRows,0);assert.equal((await provider.raw(key,page.commitId,page.path)).content.length,0);
 const manual=await call('POST',base+'/dataset/save',{ref:'main',expectedCommit:page.commitId,message:'Synthetic first manual sample',operations:[{op:'append',record:{id:'manual-one',text:'Synthetic manual content',score:3}}]});assert.equal(manual.totalRows,1);
 const bytes=Buffer.from('{"id":"imported-one","text":"Synthetic imported short","score":1}\n{"id":"imported-two","text":"Synthetic imported longer explanation","score":2}\n'),boundary='r8-synthetic-boundary',payload=Buffer.concat([Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="synthetic.jsonl"\r\nContent-Type: application/octet-stream\r\n\r\n'),bytes,Buffer.from('\r\n--'+boundary+'--\r\n')]);
 const upload=await app.inject({method:'POST',url:base+'/dataset/import/inspect',headers:{authorization:'Bearer '+token,'content-type':'multipart/form-data; boundary='+boundary},payload});assert.equal(upload.statusCode,200,upload.json()?.error?.code);const inspection=upload.json();
 const mapping={mode:'tables',paths:['synthetic.jsonl']},plan=await call('POST','/api/import/zip/'+inspection.id+'/plan',mapping),input={ref:'main',expectedCommit:manual.commitId,mapping,fingerprint:plan.fingerprint},preview=await call('POST',base+'/dataset/import/'+inspection.id+'/preview',input);
 assert.equal(preview.totalRows,3);const imported=await call('POST',base+'/dataset/import/'+inspection.id+'/commit',{...input,previewFingerprint:preview.previewFingerprint,message:'Synthetic append JSONL import'});assert.equal(imported.totalRows,3);
 page=await call('POST',base+'/dataset/query',{ref:'main',page:1,pageSize:2,sort:{column:'score',direction:'asc'}});assert.deepEqual(page.rows.map((row:any)=>row.score),[1,2]);const second=await call('POST',base+'/dataset/query',{ref:'main',page:2,pageSize:2,sort:{column:'score',direction:'asc'}});assert.equal(second.rows[0].score,3);
 const widths=await call('POST',base+'/dataset/fields/auto-width',{ref:'main',expectedCommit:imported.commitId,fields:[{id:'id'},{id:'text'},{id:'score'}]});assert.equal(widths.sampledRows,3);assert.ok(widths.fields.find((field:any)=>field.id==='text').weight>widths.fields.find((field:any)=>field.id==='score').weight);
 const history=await call('GET',base+'/readme/history?ref=main');assert.ok(history.items.some((item:any)=>item.id===readmeSaved.commitId));const diff=await call('GET',base+'/readme/diff?ref=main&commit='+readmeSaved.commitId);assert.ok(diff.after.includes('# Synthetic R8 dataset'));
 const settings=await call('GET',base+'/settings'),renamed=await call('PATCH',base,{expectedCommit:settings.commitId,displayName:'Synthetic R8 display name',description:'Synthetic updated introduction'});assert.equal(renamed.displayName,'Synthetic R8 display name');
 const lifecycle=await call('GET',base+'/lifecycle'),removed=await call('POST',base+'/lifecycle/remove',{confirmation:key.namespace+'/'+key.repo,expectedRevision:lifecycle.expectedRevision});assert.equal(removed.status,'removed');await call('GET',base+'/dataset?ref=main',undefined,410);assert.equal((await call('GET','/api/repos')).some((repo:any)=>repo.name===key.repo),false);
 const restored=await call('POST',base+'/lifecycle/restore',{confirmation:key.namespace+'/'+key.repo,removalId:removed.removalId,revision:removed.revision});assert.equal(restored.status,'active');const final=await call('GET',base+'/dataset?ref=main');assert.equal(final.totalRows,3);assert.equal((await provider.raw(key,final.commitId,final.path)).content.length,0);
 const receipt={version:1,officialOxen:'0.67.0',syntheticRepo:key.repo,readmeBeforeDataset:true,emptyCanonicalBytes:0,manualFirstSample:true,appendImportRows:2,finalRows:3,globalSortBeforePagination:true,autoWidthSampled:widths.sampledRows,readmeHistoryAndDiff:true,displayNameAndIntroduction:true,recoverableRemovalAndRestore:true,readmeCommit:readmeSaved.commitId,emptyCommit:initialized.commitId,importCommit:imported.commitId,sourceUntouched:true};
 await writeFile(path.join(directory,'verification.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{await app.close();}
