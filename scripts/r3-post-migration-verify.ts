/** Verify real repository metadata without logging sample bodies or assignment values. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const folder=path.resolve(process.argv[2]??'.data/r3-schema-migration/2026-11-08T08-19-33-451Z-9dd7bf'),origin='http://127.0.0.1:3001';
const preview=JSON.parse(await readFile(path.join(folder,'preview.json'),'utf8')),applied=JSON.parse(await readFile(path.join(folder,'applied.json'),'utf8'));
async function json(url:string){const response=await fetch(origin+url);assert.ok(response.ok,'Verification request rejected '+response.status);return response.json();}
async function digest(url:string){const response=await fetch(origin+url);assert.ok(response.ok);return createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');}
const results=[];
for(const planned of preview.repositories){
 const actual=applied.results.find((item:any)=>item.repository===planned.repository),base='/api/repos/'+planned.repository;
 const page=await json(base+'/dataset?'+new URLSearchParams({ref:actual.commitId,pageSize:'1'}));
 assert.equal(page.totalRows,planned.rows);assert.equal(page.binding.version,2);
 assert.equal(page.labels.assignments.filter((item:any)=>item.scope==='dataset').length,0,'No new dataset value is fabricated');
 assert.ok(page.columnsByScope.dataset.every((column:any)=>column.scopes.includes('dataset')&&!column.scopes.includes('row')));
 assert.ok(page.columnsByScope.row.every((column:any)=>!['risk_category','dataset_subject','source','purpose'].includes(column.id)));
 const labelUrl=(ref:string)=>base+'/raw?'+new URLSearchParams({ref,path:'.oxenweb/labels.json'});
 assert.equal(await digest(labelUrl(actual.commitId)),await digest(labelUrl(planned.expectedCommit)),'Old label document bytes changed');
 const detail=await json(base+'/commits/'+actual.commitId);assert.deepEqual(detail.files.map((item:any)=>item.path),['.oxenweb/schema-binding.json']);
 const counts=Object.fromEntries(['dataset','file','row'].map(scope=>[scope,(page.compatibility?.legacyAssignments??[]).filter((item:any)=>item.scope===scope).length]));
 assert.deepEqual(counts,planned.assignmentCounts,'Existing opinions must remain discoverable as compatibility records');
 results.push({repository:planned.repository,commitId:actual.commitId,rows:page.totalRows,legacyCounts:counts,oldLabelDocumentUnchanged:true,bindingOnlyCommit:true});
}
const repos=await json('/api/repos');assert.equal(repos.length,12);
for(const item of repos)if(item.sampleCountState==='ready'&&item.catalog?.commitId)assert.equal(item.sampleCountCommitId,item.catalog.commitId,'Card count and labels must share the pinned head');
for(const result of results){const card=repos.find((item:any)=>item.namespace+'/'+item.name===result.repository);assert.equal(card.sampleCount,result.rows);assert.equal(card.catalog.state,'unassigned');assert.equal(card.catalog.templates.sample.legacy,false);}
const receipt={version:1,checkedAt:new Date().toISOString(),repositories:results,totalProjects:repos.length,cardCountAndLabelVersionConsistent:true};
await writeFile(path.join(folder,'post-verify.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
