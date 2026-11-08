import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {createApp} from '../src/app.js';
import {DemoProvider} from '../src/demo.js';
import {loadConfig,projectRoot} from '../src/config.js';
import {datasetHash} from '../src/dataset.js';
import {storedZip} from '../src/zip-io.js';
import type {AnnotationTaskView} from '../../../packages/shared/src/workflow-types.js';
import type {DatasetOperation,DatasetPage} from '../../../packages/shared/src/dataset.js';

const ownerToken='workflow-review-synthetic-owner';
async function fixture(rowCount=2){
  const root=path.resolve(projectRoot,'.data/tests');await mkdir(root,{recursive:true});const directory=await mkdtemp(path.join(root,'workflow-review-'));
  const config=loadConfig({DEMO_MODE:'true',DEMO_DATA_FILE:path.join(directory,'state.json'),BFF_TOKEN:ownerToken});
  const provider=new DemoProvider(config.demoFile);await provider.init();const key={namespace:'local',repo:'workflow-review-fixture'};await provider.createRepo({...key,name:key.repo,description:'Isolated synthetic review quality fixture'});
  const workspace=await provider.createWorkspace(key,'Synthetic source fixture','main');
  const rows=Array.from({length:rowCount},(_,index)=>({id:`sample-${index}`,text:'A😀BC',ground_truth:{result:'source-truth'},steps:[{tool:'fixture',argument:'safe'}],package_path:'attachments/shared.zip',package_sha256:'0'.repeat(64)}));
  await provider.writeWorkspace(key,workspace.id,'data/samples.jsonl',Buffer.from(rows.map(row=>JSON.stringify(row)).join('\n')+'\n'));
  await provider.writeWorkspace(key,workspace.id,'bundle-manifest.json',Buffer.from(JSON.stringify({canonical_data:'data/samples.jsonl'})));
  await provider.writeWorkspace(key,workspace.id,'attachments/shared.zip',storedZip([{name:'SKILL.md',content:Buffer.from('Synthetic skill fixture version one.')}],1024*1024));
  await provider.writeWorkspace(key,workspace.id,'.oxenweb/labels.json',Buffer.from(JSON.stringify({version:1,columns:[{id:'risk',name:'Risk',type:'single',scopes:['row'],options:[{value:'benign'},{value:'uncertain'}]},{id:'note',name:'Context',type:'text'}],assignments:[]})));
  await provider.commitWorkspace(key,workspace.id,'Synthetic benchmark baseline');await provider.deleteWorkspace(key,workspace.id);
  const app=await createApp(config,provider),base=`/api/repos/${key.namespace}/${key.repo}`;
  const call=(method:'GET'|'POST'|'PUT'|'PATCH'|'DELETE',url:string,payload?:unknown,token=ownerToken)=>app.inject({method,url,headers:{authorization:`Bearer ${token}`},...(payload===undefined?{}:{payload:payload as object})});
  const grant=async(name:string,role='annotator')=>{const response=await call('POST',`${base}/access`,{name,role});assert.equal(response.statusCode,201,response.body);return response.json() as {collaborator:{id:string};token:string};};
  const head=async(branch='main')=>(await provider.branches(key)).find(item=>item.name===branch)!.commitId;
  const page=async(branch:string,token=ownerToken)=>{const response=await call('GET',`${base}/dataset?ref=${encodeURIComponent(branch)}&pageSize=200`,undefined,token);assert.equal(response.statusCode,200,response.body);return response.json() as DatasetPage;};
  const save=async(branch:string,operations:DatasetOperation[],token=ownerToken)=>{const response=await call('POST',`${base}/dataset/save`,{ref:branch,expectedCommit:await head(branch),message:'Synthetic quality check mutation',operations},token);return response;};
  const create=async(people:Array<{collaborator:{id:string}}>,reviewer:{collaborator:{id:string}},mode:'review'|'independent'='review')=>{const response=await call('POST',`${base}/tasks`,{title:'Synthetic quality review',ref:'main',expectedCommit:await head(),assigneeIds:people.map(item=>item.collaborator.id),reviewerId:reviewer.collaborator.id,mode,branchPrefix:'quality/review'});assert.equal(response.statusCode,201,response.body);return response.json() as AnnotationTaskView[];};
  const get=async(task:AnnotationTaskView,token=ownerToken)=>{const response=await call('GET',`${base}/tasks/${task.id}`,undefined,token);assert.equal(response.statusCode,200,response.body);return response.json() as AnnotationTaskView;};
  const submit=async(task:AnnotationTaskView,person:{collaborator:{id:string};token:string})=>{const current=await get(task,person.token),branch=current.participants.find(item=>item.id===person.collaborator.id)!.branch;const response=await call('POST',`${base}/tasks/${task.id}/submit`,{expectedRevision:current.revision,expectedCommit:await head(branch)},person.token);assert.equal(response.statusCode,200,response.body);return response.json() as AnnotationTaskView;};
  const externalWrite=async(branch:string,filename:string,content:Buffer)=>{const before=await head(branch),ws=await provider.createWorkspace(key,'Controlled out-of-band synthetic change',branch);await provider.writeWorkspace(key,ws.id,filename,content);const commit=await provider.commitWorkspace(key,ws.id,'Simulate versioned external change',before);await provider.deleteWorkspace(key,ws.id);return commit.id;};
  return {app,provider,key,base,rows,call,grant,head,page,save,create,get,submit,externalWrite,async close(){await app.close();const target=path.resolve(directory);if(!target.startsWith(root+path.sep))throw new Error('cleanup outside test workspace');await rm(target,{recursive:true,force:true});}};
}
async function approvedFixture(){
  const f=await fixture(),worker=await f.grant('content-capable-worker','editor'),reviewer=await f.grant('independent-reviewer','reviewer'),task=(await f.create([worker],reviewer))[0]!,branch=task.participants[0]!.branch;
  const saved=await f.save(branch,task.rowIds.map(rowId=>({op:'assign',scope:'row',rowId,values:{risk:'benign'}})),worker.token);assert.equal(saved.statusCode,200,saved.body);
  const submitted=await f.submit(task,worker),response=await f.call('POST',`${f.base}/tasks/${task.id}/review`,{expectedRevision:submitted.revision,decisions:task.rowIds.map(rowId=>({rowId,verdict:'approved',comment:''}))},reviewer.token);assert.equal(response.statusCode,200,response.body);
  const approved=response.json() as AnnotationTaskView;assert.equal(approved.progress.approved,task.rowIds.length);return {f,worker,reviewer,task:approved,branch};
}

test('independent double annotation supports one sample and requires distinct identities',async()=>{
  const f=await fixture(1);try{const a=await f.grant('annotator-a'),b=await f.grant('annotator-b'),r=await f.grant('reviewer','reviewer');const tasks=await f.create([a,b],r,'independent');assert.equal(tasks.length,1);assert.equal(tasks[0]!.participants.length,2);assert.equal(tasks[0]!.rowIds.length,1);}finally{await f.close();}
});
test('independent conflicting row opinions require explicit adjudication and cannot be self-reviewed',async()=>{
  const f=await fixture();try{const a=await f.grant('annotator-a'),b=await f.grant('annotator-b'),r=await f.grant('reviewer','reviewer'),task=(await f.create([a,b],r,'independent'))[0]!;
    for(const [index,person]of [a,b].entries()){const branch=task.participants.find(item=>item.id===person.collaborator.id)!.branch,response=await f.save(branch,task.rowIds.map(rowId=>({op:'assign',scope:'row',rowId,values:{risk:index?'uncertain':'benign'}})),person.token);assert.equal(response.statusCode,200,response.body);await f.submit(task,person);}
    const current=await f.get(task),payload={expectedRevision:current.revision,decisions:task.rowIds.map(rowId=>({rowId,verdict:'approved',comment:''}))};
    const rejected=await f.call('POST',`${f.base}/tasks/${task.id}/review`,payload,r.token);assert.equal(rejected.statusCode,409,rejected.body);assert.equal(rejected.json().error.code,'TASK_ADJUDICATION_REQUIRED');
    assert.equal((await f.call('POST',`${f.base}/tasks/${task.id}/review`,payload,a.token)).statusCode,403);
    const resolved=await f.call('POST',`${f.base}/tasks/${task.id}/review`,{...payload,decisions:task.rowIds.map(rowId=>({rowId,verdict:'approved',comment:'Explicit synthetic arbitration',values:{risk:'benign'}}))},r.token);assert.equal(resolved.statusCode,200,resolved.body);assert.equal(resolved.json().progress.approved,2);
  }finally{await f.close();}
});
test('different fine-grained opinions need an explicit adopted actor rather than silently approving equal row labels',async()=>{
  const f=await fixture();try{const a=await f.grant('annotator-a'),b=await f.grant('annotator-b'),r=await f.grant('reviewer','reviewer'),task=(await f.create([a,b],r,'independent'))[0]!;
    for(const [index,person]of [a,b].entries()){const branch=task.participants.find(item=>item.id===person.collaborator.id)!.branch,response=await f.save(branch,task.rowIds.map(rowId=>({op:'assign',scope:'row',rowId,values:{risk:'benign'},spans:[{id:`synthetic-span-${index}`,pointer:'/text',sourceHash:datasetHash('A😀BC'),start:index,end:index+1,values:{risk:index?'uncertain':'benign'}}]})),person.token);assert.equal(response.statusCode,200,response.body);await f.submit(task,person);}
    const current=await f.get(task),decisions=task.rowIds.map(rowId=>({rowId,verdict:'approved',comment:'Synthetic fine review'}));
    const rejected=await f.call('POST',`${f.base}/tasks/${task.id}/review`,{expectedRevision:current.revision,decisions},r.token);assert.equal(rejected.statusCode,409,rejected.body);
    const resolved=await f.call('POST',`${f.base}/tasks/${task.id}/review`,{expectedRevision:current.revision,decisions:decisions.map(item=>({...item,annotationActorId:a.collaborator.id}))},r.token);assert.equal(resolved.statusCode,200,resolved.body);
    assert.ok(resolved.json().reviews.at(-1).decisions.every((item:any)=>item.annotationActorId===a.collaborator.id));
  }finally{await f.close();}
});
test('semantic-equivalent fine annotations with different system IDs do not manufacture an adjudication conflict',async()=>{
  const f=await fixture();try{const a=await f.grant('annotator-a'),b=await f.grant('annotator-b'),r=await f.grant('reviewer','reviewer'),task=(await f.create([a,b],r,'independent'))[0]!;
    for(const [index,person]of [a,b].entries()){const branch=task.participants.find(item=>item.id===person.collaborator.id)!.branch,response=await f.save(branch,task.rowIds.map(rowId=>({op:'assign',scope:'row',rowId,values:{risk:'benign'},spans:[{id:`different-system-id-${index}`,pointer:'/text',sourceHash:datasetHash('A😀BC'),start:1,end:2,values:{risk:'benign'},note:'same evidence'}]})),person.token);assert.equal(response.statusCode,200,response.body);await f.submit(task,person);}
    const current=await f.get(task),response=await f.call('POST',`${f.base}/tasks/${task.id}/review`,{expectedRevision:current.revision,decisions:task.rowIds.map(rowId=>({rowId,verdict:'approved',comment:''}))},r.token);assert.equal(response.statusCode,200,response.body);
  }finally{await f.close();}
});
for(const mutation of ['content','labels','schema','zip-bytes','file-labels'] as const)test(`approved review becomes stale after ${mutation} changes`,async()=>{
  const {f,worker,task,branch}=await approvedFixture();try{
    const current=await f.page(branch),id=task.rowIds[0]!;
    if(mutation==='content'){const index=current.rowIds.indexOf(id),response=await f.save(branch,[{op:'update',rowId:id,record:{...current.rows[index],text:'different synthetic content'}}],worker.token);assert.equal(response.statusCode,200,response.body);}
    if(mutation==='labels'){const response=await f.save(branch,[{op:'assign',scope:'row',rowId:id,values:{risk:'uncertain'}}],worker.token);assert.equal(response.statusCode,200,response.body);}
    if(mutation==='schema'){const response=await f.call('POST',`${f.base}/labels/columns`,{ref:branch,expectedCommit:await f.head(branch),column:{id:'new_context',name:'New context',type:'text'}});assert.equal(response.statusCode,200,response.body);}
    if(mutation==='zip-bytes')await f.externalWrite(branch,'attachments/shared.zip',storedZip([{name:'SKILL.md',content:Buffer.from('Synthetic skill fixture version TWO.')}],1024*1024));
    if(mutation==='dataset-labels'||mutation==='file-labels'){const response=await f.save(branch,[{op:'assign',scope:mutation==='file-labels'?'file':'dataset',...(mutation==='file-labels'?{path:'attachments/shared.zip'}:{}),values:{note:'changed relevant context'}}]);assert.equal(response.statusCode,200,response.body);}
    const stale=await f.get(task);assert.equal(stale.current,false,`${mutation} must invalidate review`);assert.equal(stale.progress.approved,0);
    const merge=await f.call('POST',`${f.base}/merge`,{source:branch,target:'main'});assert.equal(merge.statusCode,409,merge.body);
    if(mutation==='zip-bytes'){const after=await f.page(branch);assert.ok(after.rows.every(row=>row.package_sha256==='0'.repeat(64)));}
  }finally{await f.close();}
});
test('cancelled task branches never regain write or submit authority when no active task remains',async()=>{
  const f=await fixture();try{const worker=await f.grant('worker'),reviewer=await f.grant('reviewer','reviewer'),task=(await f.create([worker],reviewer))[0]!,branch=task.participants[0]!.branch;
    const cancelled=await f.call('POST',`${f.base}/tasks/${task.id}/cancel`,{expectedRevision:task.revision,reason:'Synthetic authorization revocation'});assert.equal(cancelled.statusCode,200,cancelled.body);
    const before=await f.head(branch),write=await f.save(branch,[{op:'assign',scope:'row',rowId:task.rowIds[0],values:{risk:'benign'}}],worker.token);assert.equal(write.statusCode,403,write.body);assert.equal(await f.head(branch),before);
    const submit=await f.call('POST',`${f.base}/tasks/${task.id}/submit`,{expectedRevision:cancelled.json().revision,expectedCommit:before},worker.token);assert.equal(submit.statusCode,403,submit.body);
  }finally{await f.close();}
});
test('task and schema privilege boundaries reject scope escape, forged actors, invalid anchors and source identity changes',async()=>{
  const f=await fixture(4);try{const a=await f.grant('annotator'),b=await f.grant('editor','editor'),r=await f.grant('reviewer','reviewer'),tasks=await f.create([a,b],r),task=tasks[0]!,other=tasks[1]!,branch=task.participants[0]!.branch,before=await f.head(branch),source=(await f.provider.raw(f.key,before,'data/samples.jsonl')).content;
    assert.equal((await f.save(branch,[{op:'assign',scope:'row',rowId:other.rowIds[0],values:{risk:'benign'}}],a.token)).statusCode,403);
    assert.equal((await f.save(branch,[{op:'assign',scope:'dataset',values:{note:'not permitted'}}],a.token)).statusCode,403);
    assert.equal((await f.save(branch,[{op:'assign',scope:'file',path:'attachments/shared.zip',values:{note:'shared with unassigned samples'}}],a.token)).statusCode,403);
    assert.equal((await f.save(branch,[{op:'update',rowId:task.rowIds[0]!,record:{id:'sample-0',text:'unauthorized body'}}],a.token)).statusCode,403);
    const badSpan=await f.save(branch,[{op:'assign',scope:'row',rowId:task.rowIds[0],values:{risk:'benign'},spans:[{id:'wrong-source',pointer:'/text',sourceHash:'0'.repeat(64),start:1,end:2,values:{risk:'benign'}}]}],a.token);assert.equal(badSpan.statusCode,409,badSpan.body);
    const badStep=await f.save(branch,[{op:'assign',scope:'row',rowId:task.rowIds[0],values:{risk:'benign'},steps:[{id:'wrong-step',pointer:'/steps/0',sourceHash:'0'.repeat(64),values:{risk:'benign'}}]}],a.token);assert.equal(badStep.statusCode,409,badStep.body);
    const forged=await f.call('POST',`${f.base}/dataset/save`,{ref:branch,expectedCommit:before,message:'forged actor',operations:[{op:'assign',scope:'row',rowId:task.rowIds[0],values:{risk:'benign'},actor:{id:r.collaborator.id}}]},a.token);assert.equal(forged.statusCode,400,forged.body);
    const editorBranch=other.participants[0]!.branch,page=await f.page(editorBranch),index=page.rowIds.indexOf(other.rowIds[0]!);const identityChange=await f.save(editorBranch,[{op:'update',rowId:other.rowIds[0]!,record:{...page.rows[index],id:'changed-business-id'}}],b.token);assert.equal(identityChange.statusCode,422,identityChange.body);
    assert.equal(await f.head(branch),before);assert.deepEqual((await f.provider.raw(f.key,branch,'data/samples.jsonl')).content,source);
    const revoked=await f.call('DELETE',`${f.base}/access/${a.collaborator.id}`);assert.equal(revoked.statusCode,200,revoked.body);assert.equal((await f.call('GET',`${f.base}/tasks/${task.id}`,undefined,a.token)).statusCode,401);
  }finally{await f.close();}
});
test('an uninitialized fixed baseline rejects task allocation without creating branches, tasks or workspaces',async()=>{
  const f=await fixture();try{
    const key={namespace:'local',repo:'uninitialized-workflow-baseline'},base=`/api/repos/${key.namespace}/${key.repo}`;await f.provider.createRepo({...key,name:key.repo,description:'Synthetic uninitialized baseline'});
    const workspace=await f.provider.createWorkspace(key,'Synthetic uninitialized table','main');await f.provider.writeWorkspace(key,workspace.id,'samples.jsonl',Buffer.from('{"id":"one","text":"synthetic"}\n'));const baseline=await f.provider.commitWorkspace(key,workspace.id,'Uninitialized baseline');await f.provider.deleteWorkspace(key,workspace.id);await f.provider.createBranch(key,'bare-baseline','main');
    const worker=(await f.call('POST',base+'/access',{name:'Synthetic worker',role:'annotator'})).json(),reviewer=(await f.call('POST',base+'/access',{name:'Synthetic reviewer',role:'reviewer'})).json();
    const beforeBranches=await f.provider.branches(key),beforeWorkspaces=await f.provider.workspaces(key);
    const response=await f.call('POST',base+'/tasks',{title:'Must initialize first',ref:'bare-baseline',expectedCommit:baseline.id,assigneeIds:[worker.collaborator.id],reviewerId:reviewer.collaborator.id,mode:'review',branchPrefix:'must-not-exist'});
    assert.equal(response.statusCode,409,response.body);assert.equal(response.json().error.code,'TASK_DATASET_INITIALIZATION_REQUIRED');assert.deepEqual(await f.provider.branches(key),beforeBranches);assert.deepEqual(await f.provider.workspaces(key),beforeWorkspaces);assert.equal((await f.call('GET',base+'/tasks')).json().total,0);
  }finally{await f.close();}
});
test('1000 synthetic samples complete three disjoint annotation branches, independent review and merges without loss',{timeout:180000},async()=>{
  const f=await fixture(1000);try{
    const workers=[await f.grant('Synthetic worker A'),await f.grant('Synthetic worker B'),await f.grant('Synthetic worker C')],reviewer=await f.grant('Synthetic full-scale reviewer','reviewer'),baseline=await f.head(),original=(await f.provider.raw(f.key,baseline,'data/samples.jsonl')).content,tasks=await f.create(workers,reviewer);
    assert.deepEqual(tasks.map(task=>task.rowIds.length),[334,333,333]);assert.equal(new Set(tasks.flatMap(task=>task.rowIds)).size,1000);
    for(const [index,task]of tasks.entries()){
      const worker=workers[index]!,branch=task.participants[0]!.branch,saved=await f.save(branch,task.rowIds.map(rowId=>({op:'assign',scope:'row',rowId,values:{risk:'benign'}})),worker.token);assert.equal(saved.statusCode,200,saved.body);
      const submitted=await f.submit(task,worker),reviewed=await f.call('POST',`${f.base}/tasks/${task.id}/review`,{expectedRevision:submitted.revision,decisions:task.rowIds.map(rowId=>({rowId,verdict:'approved',comment:'Synthetic independent full-scale test review'}))},reviewer.token);assert.equal(reviewed.statusCode,200,reviewed.body);assert.equal(reviewed.json().progress.approved,task.rowIds.length);
      const merged=await f.call('POST',`${f.base}/merge`,{source:branch,target:'main'});assert.equal(merged.statusCode,200,merged.body);
    }
    const preflight=await f.call('GET',f.base+'/workflow/preflight?ref=main');assert.equal(preflight.statusCode,200,preflight.body);assert.equal(preflight.json().ok,true,JSON.stringify(preflight.json().issues));assert.equal(Object.keys(preflight.json().acceptedValues).length,1000);
    const current=await f.page('main');assert.equal(current.totalRows,1000);assert.equal(current.labels.assignments.filter(item=>item.scope==='row').length,1000);assert.ok(current.labels.assignments.filter(item=>item.scope==='row').every(item=>item.values.risk==='benign'));assert.deepEqual((await f.provider.raw(f.key,'main','data/samples.jsonl')).content,original);
    const queue=await f.call('GET',f.base+'/tasks');assert.ok(queue.json().tasks.every((task:AnnotationTaskView)=>task.status==='merged'));
  }finally{await f.close();}
});
