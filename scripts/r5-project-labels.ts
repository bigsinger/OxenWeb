/** Metadata-only initialization for the four already imported benchmark projects. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
const origin='http://127.0.0.1:3001',directory='.data/r5-project-labels';
const projects=[['benchmark-sensitive-data','sensitive-information',2000],['benchmark-prompt-injection','prompt-injection',2000],['benchmark-behavior-drift','behavior-drift',1719],['benchmark-skills','skill-supply-chain',1000]] as const;
async function json(url:string,body?:unknown){const response=await fetch(origin+url,{...(body?{method:'PUT',headers:{'content-type':'application/json','x-oxen-request':'web'},body:JSON.stringify(body)}:{})});if(!response.ok)throw new Error(`HTTP ${response.status} on ${url.split('?')[0]}`);return response.json();}
async function sourceHash(base:string,ref:string,path:string){const response=await fetch(origin+base+'/raw?'+new URLSearchParams({ref,path}));assert.equal(response.status,200);return createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');}
const report=[];
for(const [repo,subject,expectedRows] of projects){
  const base='/api/repos/local/'+repo,before=await json(base+'/project-labels'),overview=await json(base+'/dataset/overview?ref=main');
  assert.equal(before.ref,'main');assert.equal(overview.totalRows,expectedRows);assert.equal(before.commitId,overview.commitId);
  assert.ok(before.columns.find((column:any)=>column.id==='dataset_subject')?.options.some((option:any)=>option.value===subject));
  const hashBefore=await sourceHash(base,before.commitId,overview.descriptor.canonicalPath),values={...before.values};
  // Preserve any classification the user has filled since the R4 cleanup.
  const initialize=!values.dataset_subject||values.dataset_subject.length===0;if(initialize)values.dataset_subject=[subject];
  const saved=initialize?await json(base+'/project-labels',{expectedCommit:before.commitId,values,message:'设置项目研究主题（项目级标签）'}):before;
  assert.deepEqual(saved.values,values);assert.ok(saved.keywords.includes('aisec'));
  const hashAfter=await sourceHash(base,saved.commitId,overview.descriptor.canonicalPath);assert.equal(hashAfter,hashBefore);
  let files:string[]=[];if(saved.commitId!==before.commitId){files=(await json(base+'/commits/'+saved.commitId)).files.map((file:any)=>file.path);assert.deepEqual(files,['.oxenweb/dataset/dataset-labels.json']);}
  const after=await json(base+'/dataset/overview?ref=main');assert.equal(after.totalRows,expectedRows);
  const card=await json(base);assert.equal(card.catalog.branch,'main');assert.deepEqual(card.catalog.fields.find((field:any)=>field.dimensionId==='dataset_subject').values.map((item:any)=>item.value),values.dataset_subject);
  report.push({repo,initialized:initialize,commitBefore:before.commitId,commitAfter:saved.commitId,rows:after.totalRows,sourceSha256:hashAfter,sourceUnchanged:true,files,values,keywords:saved.keywords});
}
await mkdir(directory,{recursive:true});await writeFile(directory+'/verification.json',JSON.stringify({version:1,projects:report},null,2));console.log(JSON.stringify(report.map(({repo,initialized,rows,commitAfter,sourceUnchanged})=>({repo,initialized,rows,commitAfter,sourceUnchanged}))));
