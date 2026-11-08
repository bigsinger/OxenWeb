import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {createApp} from '../src/app.js';
import {loadConfig,projectRoot} from '../src/config.js';
test('real JSONL source editing preserves row labels in the same commit and leaves the source branch intact',{skip:process.env.OXEN_TABLE_LIVE_TEST!=='true',timeout:180000},async t=>{
 process.loadEnvFile(path.join(projectRoot,'infra/oxen/local.env'));
 const directoryRoot=path.join(projectRoot,'.data/tests');await mkdir(directoryRoot,{recursive:true});const temporary=await mkdtemp(path.join(directoryRoot,'table-'));
 t.after(()=>rm(temporary,{recursive:true,force:true}));
 const config=loadConfig({...process.env,DEMO_DATA_FILE:path.join(temporary,'state.json')});const app=await createApp(config);t.after(()=>app.close());
 const headers={'x-oxen-request':'web',...(config.token?{authorization:`Bearer ${config.token}`}:{})};const base='/api/repos/local/prompt-injection-bench',filename='data/prompt_injection_bench.jsonl';
 async function get(url:string){const response=await app.inject({url,headers});assert.equal(response.statusCode,200,response.body);return response.json();}
 async function post(url:string,payload:Record<string,unknown>){const response=await app.inject({method:'POST',url,headers,payload});assert.ok([200,201].includes(response.statusCode),response.body);return response.json();}
 const source=await get(`${base}/file?ref=main&path=${encodeURIComponent(filename)}&pageSize=1`),branch=`table-edit-${Date.now()}`;
 await post(base+'/branches',{name:branch,from:'main'});
 let labels=await get(`${base}/labels?ref=${branch}`);
 labels=await post(base+'/labels/columns',{ref:branch,expectedCommit:labels.commitId,column:{id:'review',name:'审核',type:'single',options:[{value:'checked'}]}});
 labels=await post(base+'/labels/assignments',{ref:branch,expectedCommit:labels.commitId,scope:'row',path:filename,rowId:source.rowIds[0],values:{review:'checked'}});
 const updated={...source.rows[0],text:'Local data editor integration record',meta:{...source.rows[0].meta,editor_test:true}};
 const result=await post(base+'/table/edit',{ref:branch,expectedCommit:labels.commitId,path:filename,operations:[{op:'update',rowId:source.rowIds[0],record:updated},{op:'add-column',name:'editor_note',value:null},{op:'append',record:{id:'EDITOR-INTEGRATION-APPEND',text:'New local record',meta:{test:true}}}],message:'Verify structured JSONL editing and row-label preservation'});
 const after=await get(`${base}/file?ref=${result.commitId}&path=${encodeURIComponent(filename)}&pageSize=1`),afterLabels=await get(`${base}/labels?ref=${result.commitId}`);
 assert.equal(after.totalRows,2001);assert.equal(after.rows[0].text,updated.text);assert.equal(after.rows[0].meta.editor_test,true);assert.equal(after.rows[0].editor_note,null);
 assert.equal(afterLabels.assignments.find((assignment:{rowId?:string})=>assignment.rowId===after.rowIds[0]).values.review,'checked');
 const main=await get(`${base}/file?ref=main&path=${encodeURIComponent(filename)}&pageSize=1`);assert.equal(main.rows[0].text,source.rows[0].text);assert.equal(main.totalRows,2000);
 const stale=await app.inject({method:'POST',url:base+'/table/edit',headers,payload:{ref:branch,expectedCommit:labels.commitId,path:filename,operations:[{op:'delete',rowId:source.rowIds[0]}],message:'Stale test'}});assert.equal(stale.statusCode,409);
 console.log(JSON.stringify({branch,commitId:result.commitId,rows:after.totalRows,sourceRows:main.totalRows,rowLabelPreserved:true,staleRejected:true}));
});
