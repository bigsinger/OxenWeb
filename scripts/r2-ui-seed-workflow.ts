/** Synthetic QA only: prepare two submitted tasks for manual owner UI review. Never reviews or merges. */
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {projectRoot} from '../apps/server/src/config.js';
import type {DatasetPage,DatasetOperation} from '../packages/shared/src/dataset.js';
import type {AnnotationTaskView,WorkflowSummary} from '../packages/shared/src/workflow-types.js';
import type {RepositorySettingsState} from '../packages/shared/src/index.js';

const origin='http://127.0.0.1:3005',base='/api/repos/local/ai-safety-ui-qa';
type Actor={id:string;name:string;role:string;token:string};
let secrets:string[]=[];
const scrub=(text:string)=>secrets.reduce((value,secret)=>value.split(secret).join('[redacted]'),text);
const fail=(message:string):never=>{throw new Error(message);};
async function main(){
  const input:unknown=JSON.parse(await readFile(path.join(projectRoot,'.data/r2-ui-qa/actors.json'),'utf8'));
  if(!Array.isArray(input))fail('Synthetic actor file has an invalid shape.');
  const actors=input as Actor[];secrets=actors.map(item=>typeof item?.token==='string'?item.token:'').filter(Boolean);
  if(actors.some(item=>!item||typeof item.id!=='string'||typeof item.name!=='string'||typeof item.role!=='string'||typeof item.token!=='string'||!item.token.startsWith('oxw_')))fail('Synthetic actor credentials are invalid; no request was made.');
  const workers=actors.filter(item=>item.role==='annotator').sort((a,b)=>a.name.localeCompare(b.name));
  if(workers.length!==2||new Set(workers.map(item=>item.id)).size!==2)fail('Exactly two distinct synthetic annotators are required.');
  const api=async<T>(method:'GET'|'POST',url:string,body?:unknown,token?:string,expected=200):Promise<T>=>{const response=await fetch(origin+url,{method,redirect:'error',signal:AbortSignal.timeout(60_000),headers:{'X-Oxen-Request':'web',...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const value=await response.json();if(response.status!==expected)fail(scrub(`${method} ${url} returned ${response.status}: ${value?.error?.code??'HTTP_ERROR'} ${value?.error?.message??''}`));return value as T;};
  const session=await api<{identity:{id:string;kind:string};localOwnerEnabled:boolean}>('GET','/api/session');if(!session.localOwnerEnabled||session.identity.kind!=='owner'||session.identity.id!=='owner')fail('3005 must be the loopback synthetic QA service with local owner enabled.');
  const previous=await api<WorkflowSummary>('GET',base+'/tasks');if(!Array.isArray(previous.tasks))fail('Task summary contract is invalid.');if(previous.tasks.length){console.log(JSON.stringify({stage:'skipped-existing-tasks',repository:'local/ai-safety-ui-qa',tasks:previous.tasks.map(task=>({id:task.id,status:task.status}))}));return;}
  const settings=await api<RepositorySettingsState>('GET',base+'/settings');for(const person of workers)if(!settings.policy.collaborators.some(member=>member.id===person.id&&member.role==='annotator'))fail('Synthetic annotator is no longer an active project member.');
  const baseline=await api<DatasetPage>('GET',base+'/dataset?ref=main&pageSize=200');if(baseline.totalRows!==12||baseline.rows.length!==12||baseline.rowIds.length!==12||new Set(baseline.rows.map(row=>row.id)).size!==12||Array.from({length:12},(_,index)=>'qa-'+(index+1)).some(id=>!baseline.rows.some(row=>row.id===id)))fail('The target is not the expected twelve-row synthetic fixture.');
  const column=(id:string)=>baseline.labels.columns.find(item=>item.id===id);
  if(column('risk')?.type!=='single'||!column('risk')?.options?.some(item=>item.value==='benign')||column('source')?.type!=='multi'||!column('source')?.options?.some(item=>item.value==='synthetic')||column('evidence')?.type!=='text')fail('Synthetic fixture dimensions changed; no tasks were created.');
  const qa1=baseline.rowIds[baseline.rows.findIndex(row=>row.id==='qa-1')];
  if(baseline.labelRecords.some(record=>record.actor.id!=='owner'||record.scope!=='row'||record.rowId!==qa1||record.values.risk!=='benign'))fail('Existing annotations extend beyond the retained owner qa-1 fixture; refusing to overwrite or duplicate human work.');
  const tasks=await api<AnnotationTaskView[]>('POST',base+'/tasks',{title:'合成 UI 验收 · 十二条任务分配',ref:'main',expectedCommit:baseline.commitId,assigneeIds:workers.map(person=>person.id),reviewerId:'owner',mode:'review',branchPrefix:'qa/ui-review',rowIds:baseline.rowIds,note:'仅合成 UI 验收。两名标注者各六条；实例管理员在页面手动复核。脚本不会复核或合并。'},undefined,201);
  if(tasks.length!==2||tasks.some(task=>task.status!=='assigned'||task.rowIds.length!==6||task.reviewer.id!=='owner'||task.participants.length!==1)||new Set(tasks.flatMap(task=>task.rowIds)).size!==12)fail('Synthetic task allocation is incomplete. Existing tasks are retained; inspect the task UI before retrying.');
  console.log(JSON.stringify({stage:'tasks-created',repository:'local/ai-safety-ui-qa',baselineCommitId:baseline.commitId,tasks:tasks.map(task=>({id:task.id,branch:task.participants[0]!.branch,samples:task.rowIds.length,reviewer:task.reviewer.id}))}));
  for(const task of tasks){const participant=task.participants[0]!,worker=workers.find(person=>person.id===participant.id);if(!worker)fail('Created task does not match a known synthetic worker.');const branch=participant.branch,view=await api<DatasetPage>('GET',base+'/dataset?ref='+encodeURIComponent(branch)+'&pageSize=200',undefined,worker.token);
    if(view.labelRecords.some(record=>record.actor.id===worker.id)||task.rowIds.some(id=>view.contentHashes[id]!==baseline.contentHashes[id]))fail('A task branch already has worker annotations or changed content; refusing to replace human edits.');
    const operations:DatasetOperation[]=task.rowIds.map(rowId=>({op:'assign',scope:'row',rowId,values:{risk:'benign',source:['synthetic'],evidence:'合成 UI 验收样本，无执行行为；用于验证标注提交与负责人手动复核。'}}));
    const saved=await api<{commitId:string}>('POST',base+'/dataset/save',{ref:branch,expectedCommit:view.commitId,message:'Synthetic UI acceptance annotations by '+worker.name,operations},worker.token);
    const current=await api<AnnotationTaskView>('GET',base+'/tasks/'+task.id,undefined,worker.token);if(current.submissions.length||current.reviews.length)fail('Task acquired a submission or review during preparation; refusing to replace it.');
    const submitted=await api<AnnotationTaskView>('POST',base+'/tasks/'+task.id+'/submit',{expectedRevision:current.revision,expectedCommit:saved.commitId},worker.token);if(submitted.status!=='awaiting-review'||submitted.reviews.length||submitted.submissions.length!==1)fail('Submission did not reach the expected manual review state.');
    console.log(JSON.stringify({stage:'awaiting-owner-review',taskId:submitted.id,branch,sourceCommitId:saved.commitId,samples:submitted.rowIds.length,reviewer:'owner'}));
  }
  const finished=await api<WorkflowSummary>('GET',base+'/tasks');if(finished.tasks.length!==2||finished.tasks.some(task=>task.status!=='awaiting-review'||task.reviews.length))fail('Final task state changed; inspect the UI.');
  const main=await api<DatasetPage>('GET',base+'/dataset?ref=main&pageSize=200');if(main.commitId!==baseline.commitId)fail('Main advanced during preparation. No script review/merge was executed; inspect the new main version.');
  console.log(JSON.stringify({stage:'ready-for-manual-owner-review',repository:'local/ai-safety-ui-qa',tasks:2,samples:12,mainUnchanged:true,automaticReviews:0,automaticMerges:0}));
}
await main().catch(error=>{process.stderr.write(scrub(error instanceof Error?error.message:'Synthetic workflow preparation failed.')+'\n');process.exitCode=1;});
