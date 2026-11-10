import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { DemoProvider } from '../src/demo.js';
import { DatasetService } from '../src/dataset.js';
import { DatasetDraftService } from '../src/dataset-drafts.js';
import { RepositorySettingsService } from '../src/repository-settings.js';
import { EvaluationPolicyService, evaluationView, evaluationDocumentSchema } from '../src/dataset-evaluation.js';
import { ApiError } from '../src/errors.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { OperationJournal } from '../src/operation-journal.js';
import { operationContext } from '../src/operation-context.js';
import { reconcileOperation } from '../src/operation-http.js';
import type { RequestIdentity } from '../../../packages/shared/src/index.js';
import type { EvaluationExposure } from '../../../packages/shared/src/evaluation.js';

const owner:RequestIdentity={id:'owner',name:'Synthetic responsible owner',kind:'owner',source:'local'};
async function fixture(t:{after:(action:()=>Promise<void>)=>void}){
  const root=path.resolve('.data/tests');await mkdir(root,{recursive:true});const directory=await mkdtemp(path.join(root,'evaluation-'));
  t.after(async()=>{if(!path.resolve(directory).startsWith(root+path.sep))throw new Error('unsafe synthetic cleanup');await rm(directory,{recursive:true,force:true});});
  const provider=new DemoProvider(path.join(directory,'demo.json'));await provider.init();const key={namespace:'local',repo:'synthetic-evaluation'};await provider.createRepo({namespace:key.namespace,name:key.repo,description:'Synthetic evaluation',visibility:'private'});
  const settings=new RepositorySettingsService(provider,path.join(directory,'branches.json')),filename=path.join(directory,'evaluation-policy.json');
  let allowed=true,exposed:EvaluationExposure={rowIds:[],familyIds:[],attachmentHashes:[]};
  const authorize=async()=>{if(!allowed)throw new ApiError(403,'SYNTHETIC_PERMISSION_DENIED','Synthetic revoked authority');};
  const policy=new EvaluationPolicyService(filename,settings,authorize);await policy.init();settings.setPolicyValidator((key,value)=>policy.assertVisibility(key,value.visibility));
  const service=new DatasetService(provider,{authorize,evaluation:{enabled:key=>policy.isEnabled(key),assertPrivate:key=>policy.assertPrivate(key),exposed:async()=>exposed}});
  const attachment=Buffer.from('inert synthetic attachment bytes; never executed');
  const initial=await service.initialize(key,owner,{ref:'main',expectedCommit:(await provider.branches(key))[0]!.commitId,rows:[{id:'one',text:'First synthetic text',ground_truth:'original','evaluation.visibility':'source-only',package_path:'packages/synthetic.zip'},{id:'two',text:'Second synthetic text','evaluation.visibility':'source-only'},{id:'three',text:'Third synthetic text','evaluation.visibility':'source-only'}],files:[{path:'packages/synthetic.zip',content:attachment}]});
  const head=async()=>(await provider.branches(key)).find(branch=>branch.name==='main')!.commitId;
  const save=async(rowIds:string[],patch:any)=>service.save(key,owner,{ref:'main',expectedCommit:await head(),message:'Synthetic evaluation management',operations:[{op:'evaluation',rowIds,patch}]});
  return {directory,provider,key,settings,filename,policy,service,initial,attachment,head,save,revoke:()=>{allowed=false;},expose:(value:EvaluationExposure)=>{exposed=value;}};
}

test('evaluation activation is explicit, private, sticky across cached old refs and restart; public mutation is denied',async t=>{
  const f=await fixture(t);assert.equal((await f.service.read(f.key,f.initial.commitId)).evaluation?.enabled,false);
  await assert.rejects(()=>f.save([f.initial.rowIds[0]!],{visibility:'shared'}),(error:any)=>error.code==='EVALUATION_NOT_ENABLED');
  const before=await f.head();await f.policy.activate(f.key,owner);assert.equal(await f.head(),before,'activation changes control policy, not dataset history');
  const historical=await f.service.read(f.key,f.initial.commitId);assert.equal(historical.evaluation?.enabled,true);assert.equal(historical.evaluation?.rows[f.initial.rowIds[0]!]!.visibility,null);
  const restarted=new EvaluationPolicyService(f.filename,f.settings,async()=>{});await restarted.init();assert.equal(await restarted.isEnabled(f.key),true);
  await assert.rejects(()=>f.settings.update(f.key,{visibility:'public'},owner),(error:any)=>error.code==='EVALUATION_PRIVATE_REQUIRED');assert.equal(await f.head(),before);
  assert.deepEqual((await f.service.read(f.key,'main')).rows,f.initial.rows);
});

test('evaluation uses private drafts, one explicit commit, page-only maps and an isolated query namespace',async t=>{
  const f=await fixture(t);await f.policy.activate(f.key,owner);const drafts=new DatasetDraftService(f.service,path.join(f.directory,'drafts')),first=f.initial.rowIds[0]!,second=f.initial.rowIds[1]!;
  const originalRaw=(await f.provider.raw(f.key,f.initial.commitId,f.initial.path)).content;let workspaces=0;const create=f.provider.createWorkspace.bind(f.provider);f.provider.createWorkspace=async(...args)=>{workspaces++;return create(...args);};
  const saved=await drafts.save(f.key,owner,{ref:'main',expectedCommit:f.initial.commitId,draftRevision:0,operations:[{op:'evaluation',rowIds:[first,second],patch:{visibility:'shared',suites:['gold','regression'],familyId:'synthetic-family'}}]});
  assert.equal(workspaces,0);assert.equal(await f.head(),f.initial.commitId);
  const page=await drafts.page(f.key,owner,'main',{pageSize:1,filters:[{column:'evaluation.suites',operator:'eq',value:'gold'}],sort:{column:'evaluation.family_id',direction:'asc'}});assert.equal(page.matchedRows,2);assert.equal(Object.keys(page.evaluation!.rows).length,1);assert.deepEqual(Object.keys(page.baseEvaluationRows!),page.rowIds);assert.equal(page.baseEvaluationRows![page.rowIds[0]!]!.visibility,null,'the page includes fixed base grouping, not the draft projection');
  const source=await drafts.page(f.key,owner,'main',{filters:[{column:'data.evaluation.visibility',operator:'eq',value:'source-only'}]});assert.equal(source.matchedRows,3);
  const diff=await drafts.diff(f.key,owner,'main');assert.equal(diff!.changes[0]!.op,'evaluation');assert.deepEqual(diff!.changes[0]!.fields,['evaluation.visibility','evaluation.suites','evaluation.family_id']);
  await drafts.commit(f.key,owner,{ref:'main',expectedCommit:f.initial.commitId,draftRevision:saved.draft!.draftRevision,expectedDraftId:saved.draft!.id,message:'One evaluation metadata commit'});
  assert.equal(workspaces,1);const current=await f.service.read(f.key,'main');assert.deepEqual(current.contentHashes,f.initial.contentHashes);assert.deepEqual(current.labelRecords,f.initial.labelRecords);assert.deepEqual(current.rows,f.initial.rows);assert.deepEqual((await f.provider.raw(f.key,current.commitId,f.initial.path)).content,originalRaw);assert.equal(current.rowActivity?.[first]?.kind,'evaluation');
  const old=await f.service.read(f.key,f.initial.commitId);assert.equal(old.evaluation?.enabled,true);assert.equal(old.evaluation?.rows[first]?.visibility,null);
});

test('one family cannot straddle shared and holdout; whole-family batch changes are atomic',async t=>{
  const f=await fixture(t);await f.policy.activate(f.key,owner);const [one,two]=f.initial.rowIds;await f.save([one!,two!],{visibility:'shared',familyId:'family-one'});const before=await f.head();
  await assert.rejects(()=>f.save([one!],{visibility:'holdout'}),(error:any)=>error.code==='EVALUATION_FAMILY_SPLIT');assert.equal(await f.head(),before);
  const changed=await f.save([one!,two!],{visibility:'holdout',suites:[]});assert.equal(changed.evaluation?.rows[one!]!.visibility,'holdout');assert.equal(changed.evaluation?.rows[two!]!.visibility,'holdout');
});

test('published membership prevents re-hiding exposed IDs, families and equal attachment hashes, including old refs',async t=>{
  const f=await fixture(t);await f.policy.activate(f.key,owner);const [one,two]=f.initial.rowIds;
  const hidden=await f.save([one!],{visibility:'holdout'});await f.save([one!],{visibility:'shared',familyId:'published-family'});
  f.expose({rowIds:[one!],familyIds:['published-family'],attachmentHashes:[createHash('sha256').update(f.attachment).digest('hex')]});
  await assert.rejects(()=>f.save([one!],{visibility:'holdout'}),(error:any)=>error.code==='EVALUATION_ALREADY_EXPOSED');
  await assert.rejects(()=>f.save([two!],{visibility:'holdout',familyId:'published-family'}),(error:any)=>['EVALUATION_FAMILY_SPLIT','EVALUATION_ALREADY_EXPOSED'].includes(error.code));
  await assert.rejects(()=>f.service.assertEvaluationSafety(f.key,hidden),(error:any)=>error.code==='EVALUATION_ALREADY_EXPOSED');
  f.expose({rowIds:[],familyIds:[],attachmentHashes:[createHash('sha256').update(f.attachment).digest('hex')]});
  await assert.rejects(()=>f.save([one!],{visibility:'holdout',familyId:null}),(error:any)=>error.code==='EVALUATION_ALREADY_EXPOSED');
});

test('final native commit rechecks manager authority and does not commit staged grouping after revocation',async t=>{
  const f=await fixture(t);await f.policy.activate(f.key,owner);const original=f.provider.commitWorkspace.bind(f.provider);f.provider.commitWorkspace=async(...args)=>{f.revoke();return original(...args);};
  await assert.rejects(()=>f.save([f.initial.rowIds[0]!],{visibility:'shared'}),(error:any)=>error.status===403);assert.equal(await f.head(),f.initial.commitId);
});

test('activation and visibility updates share a serialization lock and cannot leave an enabled public project',async t=>{
  const f=await fixture(t);const results=await Promise.allSettled([f.policy.activate(f.key,owner),f.settings.update(f.key,{visibility:'public'},owner)]);assert.equal(results[0]!.status,'fulfilled');assert.equal(results[1]!.status,'rejected');assert.equal((await f.settings.read(f.key)).policy.visibility,'private');assert.equal(await f.policy.isEnabled(f.key),true);
});

test('designated trusted annotators/reviewers retain read access but cannot change grouping or generic sidecars',async t=>{
  const f=await fixture(t),token='synthetic-evaluation-owner-token',config=loadConfig({DEMO_MODE:'true',DEMO_DATA_FILE:path.join(f.directory,'demo.json'),BFF_TOKEN:token}),app=await createApp(config,f.provider);t.after(()=>app.close());
  const base='/api/repos/local/synthetic-evaluation',call=(method:any,url:string,payload?:unknown,credential=token)=>app.inject({method,url,headers:{authorization:'Bearer '+credential},...(payload===undefined?{}:{payload})});
  const invalid=await call('POST',base+'/dataset/evaluation/policy',{confirmPrivateMaster:false});assert.equal(invalid.statusCode,400);
  const enabled=await call('POST',base+'/dataset/evaluation/policy',{confirmPrivateMaster:true});assert.equal(enabled.statusCode,200,enabled.body);assert.equal(enabled.json().enabled,true);assert.equal(typeof enabled.json().operationId,'string');
  for(const role of ['annotator','reviewer']){
    const granted=await call('POST','/api/access-management/grants',{scope:'project',repository:f.key,name:'Synthetic trusted '+role,role,capabilities:['read',role==='annotator'?'annotation.assign':'annotation.review','release.hidden']});assert.equal(granted.statusCode,201,granted.body);const credential=granted.json().token;
    assert.equal((await call('GET',base+'/dataset/evaluation/policy',undefined,credential)).statusCode,200);
    const current=await f.head(),operation={op:'evaluation',rowIds:[f.initial.rowIds[0]],patch:{visibility:'shared'}};
    const saved=await call('POST',base+'/dataset/save',{ref:'main',expectedCommit:current,message:'Denied grouping',operations:[operation]},credential);assert.equal(saved.statusCode,403,saved.body);
    const draft=await call('PUT',base+'/dataset/draft',{ref:'main',expectedCommit:current,draftRevision:0,operations:[operation]},credential);assert.equal(draft.statusCode,403,draft.body);
    assert.equal((await call('POST',base+'/dataset/evaluation/policy',{confirmPrivateMaster:true},credential)).statusCode,403);
    const page=await call('POST',base+'/dataset/query',{ref:'main'},credential);assert.equal(page.statusCode,200,page.body);assert.equal(page.json().capabilities.editEvaluation,false);
  }
  const workspace=await f.provider.createWorkspace(f.key,'Synthetic generic edit','main');
  const blocked=await call('PUT',base+'/workspaces/'+workspace.id+'/files',{path:'.oxenweb/dataset/evaluation.json',content:'{}'});assert.equal(blocked.statusCode,403,blocked.body);
  const publicChange=await call('PATCH',base,{visibility:'public',expectedCommit:await f.head()});assert.equal(publicChange.statusCode,409,publicChange.body);
});

test('lost activation result reconciles only its durable operation anchor and missing policy evidence fails closed',async t=>{
  const f=await fixture(t),journal=new OperationJournal(path.join(f.directory,'journal.json'));await journal.init();const id=randomUUID();
  await assert.rejects(()=>journal.run({id,actorId:owner.id,actorName:owner.name,kind:'dataset.evaluation_policy',key:f.key,ref:'main',payload:{confirmPrivateMaster:true}},async context=>operationContext.run({id,writeAttempted:false,checkpoint:context.checkpoint,defer:context.defer,complete:async()=>{},uncertain:async()=>{}},async()=>{await f.policy.activate(f.key,owner);throw new ApiError(502,'SYNTHETIC_RESULT_LOST','Synthetic response interruption');})),(error:any)=>error.code==='SYNTHETIC_RESULT_LOST');
  assert.equal(journal.get(id).state,'reconciliation-required');const result=await reconcileOperation(journal.get(id),owner,{provider:f.provider,evaluationPolicy:key=>f.policy.policy(key)} as any);assert.equal(result.state,'succeeded');assert.equal(result.reasonCode,'EVALUATION_POLICY_VERIFIED');
  const unrelated={...journal.get(id),id:randomUUID()};assert.equal((await reconcileOperation(unrelated,owner,{provider:f.provider,evaluationPolicy:key=>f.policy.policy(key)} as any)).state,'reconciliation-required');
  const missing=new EvaluationPolicyService(path.join(f.directory,'missing-policy.json'),f.settings,async()=>{});await missing.init();assert.throws(()=>missing.reconcileRequired([f.key]),(error:any)=>error.code==='EVALUATION_POLICY_RECOVERY_REQUIRED');
});

test('new draft rows can receive grouping atomically while unknown IDs cannot be classified',async t=>{
  const f=await fixture(t);await f.policy.activate(f.key,owner);const id='new:'+randomUUID(),drafts=new DatasetDraftService(f.service,path.join(f.directory,'drafts'));
  const state=await drafts.save(f.key,owner,{ref:'main',expectedCommit:f.initial.commitId,draftRevision:0,operations:[{op:'evaluation',rowIds:[id],patch:{visibility:'shared',suites:['regression']}},{op:'append',rowId:id,record:{id:'brand-new-synthetic',text:'New batch'}}]});
  const preview=await drafts.page(f.key,owner,'main',{filters:[{column:'evaluation.suites',operator:'eq',value:'regression'}]});assert.deepEqual(preview.rowIds,[id]);assert.equal(preview.evaluation?.rows[id]?.visibility,'shared');assert.equal(await f.head(),f.initial.commitId);
  const saved=await drafts.commit(f.key,owner,{ref:'main',expectedCommit:f.initial.commitId,draftRevision:state.draft!.draftRevision,expectedDraftId:state.draft!.id,message:'New synthetic row and grouping'});assert.ok(saved.rowIds.includes(id));assert.equal((await f.service.read(f.key,'main')).evaluation?.rows[id]?.visibility,'shared');
  await assert.rejects(()=>f.save(['missing-synthetic-id'],{visibility:'shared'}),(error:any)=>error.code==='DATASET_SAMPLE_NOT_FOUND');
});

test('an exposure published after staging is rechecked inside the native commit boundary',async t=>{
  const f=await fixture(t);await f.policy.activate(f.key,owner);const id=f.initial.rowIds[0]!,original=f.provider.commitWorkspace.bind(f.provider);f.provider.commitWorkspace=async(...args)=>{f.expose({rowIds:[id],familyIds:[]});return original(...args);};
  await assert.rejects(()=>f.save([id],{visibility:'holdout'}),(error:any)=>error.code==='EVALUATION_ALREADY_EXPOSED');assert.equal(await f.head(),f.initial.commitId);
});

test('uncertain policy persistence never falls back to ordinary release mode in the running instance',async t=>{
  const f=await fixture(t),filename=path.join(f.directory,'blocked-policy.json'),policy=new EvaluationPolicyService(filename,f.settings,async()=>{});await policy.init();await mkdir(filename);
  await assert.rejects(()=>policy.activate(f.key,owner));await assert.rejects(()=>policy.isEnabled(f.key),(error:any)=>error.code==='EVALUATION_POLICY_UNCERTAIN');await assert.rejects(()=>policy.activate(f.key,owner),(error:any)=>error.code==='EVALUATION_POLICY_UNCERTAIN');
});

test('repeated or reverted grouping input produces no empty native commit or new operation clock',async t=>{
  const f=await fixture(t);await f.policy.activate(f.key,owner);const id=f.initial.rowIds[0]!,saved=await f.save([id],{visibility:'shared',suites:['gold']}),drafts=new DatasetDraftService(f.service,path.join(f.directory,'drafts'));let created=0;const original=f.provider.createWorkspace.bind(f.provider);f.provider.createWorkspace=async(...args)=>{created++;return original(...args);};
  const state=await drafts.save(f.key,owner,{ref:'main',expectedCommit:saved.commitId,draftRevision:0,operations:[{op:'evaluation',rowIds:[id],patch:{visibility:'holdout'}},{op:'evaluation',rowIds:[id],patch:{visibility:'shared',suites:['gold']}}]});assert.deepEqual((await drafts.diff(f.key,owner,'main'))?.changes,[]);
  const committed=await drafts.commit(f.key,owner,{ref:'main',expectedCommit:saved.commitId,draftRevision:state.draft!.draftRevision,expectedDraftId:state.draft!.id,message:'No-op grouping input'});assert.equal(created,0);assert.equal(committed.commitId,saved.commitId);assert.deepEqual((await f.service.read(f.key,'main')).rowActivity,saved.rowActivity);assert.deepEqual(await drafts.read(f.key,owner,'main'),{});
});

test('imported stable identifiers never inherit object prototype values as evaluation metadata',()=>{
  const row={visibility:'shared' as const,suites:[],familyId:null},document=evaluationDocumentSchema.parse({version:1,rows:Object.fromEntries([['__proto__',row],['constructor',row]])}),view=evaluationView(document,['__proto__','constructor','toString'],true);
  assert.equal(view.rows.__proto__?.visibility,'shared');assert.equal(view.rows.constructor?.visibility,'shared');assert.equal(view.rows.toString?.visibility,null);assert.equal(view.counts?.shared,2);assert.equal(view.counts?.unclassified,1);
});
