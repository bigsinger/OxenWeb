import {randomUUID} from 'node:crypto';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {DatasetCapability,RequestIdentity} from '../../../packages/shared/src/index.js';
import type {Provider,RepoKey} from './provider.js';
import {requestIdentity} from './auth.js';
import {ApiError} from './errors.js';
import {safeRef,safeSegment} from './safety.js';
import {OperationJournal,type OperationAnchors,type OperationRecord,type OperationResolution} from './operation-journal.js';
import {operationContext,type OperationExecutionContext} from './operation-context.js';
import type {RepositoryAccessService} from './repository-access.js';
import type {GlobalAuditService} from './global-audit.js';

interface Descriptor{kind:string;capability?:DatasetCapability;macro?:string;owner?:boolean}
/** These local field-deletion guards execute before any Provider mutation. Do not generalize to other 409/422 operations. */
function fieldDeletePrewriteRejection(kind:string,error:unknown):boolean{return kind==='dataset.fields.delete'&&error instanceof ApiError&&(error.status===422&&['DATASET_FIELD_DELETE_CONFIRM','DATASET_FIELD_DELETE_PROTECTED'].includes(error.code)||error.status===409&&error.code==='DATASET_VERSION_CONFLICT');}
function globalFieldPrewriteRejection(kind:string,error:unknown):boolean{
  if(!(error instanceof ApiError))return false;
  if(kind==='global-fields.maintainer')return error.status===409&&error.code==='GLOBAL_FIELDS_REVISION_CONFLICT'||error.status===404&&error.code==='IDENTITY_NOT_FOUND';
  if(kind!=='global-fields.change')return false;
  return error.status===409&&error.code==='GLOBAL_FIELDS_REVISION_CONFLICT'||error.status===422&&['GLOBAL_FIELD_DUPLICATE','GLOBAL_FIELD_OPTION_DUPLICATE'].includes(error.code)||error.status===413&&error.code==='GLOBAL_FIELD_HISTORY_CAPACITY'||error.status===403&&error.code==='GLOBAL_FIELD_ADMIN_REQUIRED';
}
/** Explicit local Release guards only. The caller must also prove no provider/control write was attempted. */
function releasePrewriteRejection(kind:string,error:unknown):boolean{
  if(!(error instanceof ApiError))return false;
  const common:Record<string,number>={CAPACITY_BUSY:429,RELEASE_LEGACY_RETIRED:410,RELEASE_PREVIEW_CHANGED:409,RELEASE_BASELINE_UNAVAILABLE:503,RELEASE_NOTES_FILE_LIMIT:413,RELEASE_DATA_LIMIT:413,RELEASE_ATTACHMENT_LIMIT:413,RELEASE_IDENTITIES:422,RELEASE_EXPORT_SOURCE_ATTACHMENT:422,RELEASE_ATTACHMENT_REFERENCE:422};
  const guards:Record<string,Record<string,number>>={
    'release.create':{...common,RELEASE_NOT_MAINLINE:409,RELEASE_VERSION_EXISTS:409},
    'release.update':{...common,RELEASE_VERSION_CONFLICT:409,RELEASE_IMMUTABLE:409,RELEASE_VERSION:422,RELEASE_VERSION_EXISTS:409},
    'release.build':{...common,RELEASE_VERSION_CONFLICT:409,RELEASE_BUILD_STATE:409,RELEASE_QUEUE_FULL:429},
    'snapshot.build':{...common,RELEASE_VERSION_CONFLICT:409,RELEASE_BUILD_STATE:409,RELEASE_QUEUE_FULL:429},
    'release.publish':{...common,RELEASE_BASELINE_CHANGED:409,RELEASE_VERSION_CONFLICT:409,RELEASE_PUBLISH_STATE:409,RELEASE_NOT_MAINLINE:409,RELEASE_SOURCE_CHANGED:409,RELEASE_IDENTITIES:422,RELEASE_CANDIDATE_CHANGED:409},
    'release.withdraw':{...common,RELEASE_VERSION_CONFLICT:409,RELEASE_WITHDRAW_STATE:409},
  };
  return guards[kind]?.[error.code]===error.status;
}
const object=(value:unknown):Record<string,any>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:{};
function descriptor(url:string,method:string):Descriptor|undefined {
  if(method==='POST'&&url==='/api/repos')return{kind:'project.create',macro:'project.created',owner:true};
  if(method==='POST'&&url==='/api/import/zip/:id/commit')return{kind:'dataset.import',macro:'dataset.imported'};
  if(!['POST','PUT','PATCH','DELETE'].includes(method))return;
  if(url.startsWith('/api/governance/'))return{kind:'governance.change',macro:'governance.updated'};
  if(url==='/api/global-fields')return{kind:'global-fields.change',macro:'fields.catalog_updated'};
  if(url==='/api/global-fields/synchronize')return{kind:'global-fields.synchronize',macro:'fields.projects_synchronized'};
  if(url==='/api/global-fields/maintainers')return{kind:'global-fields.maintainer',macro:'fields.maintainer_updated',owner:true};
  const tail=url.replace(/^\/api\/(?:repos\/:namespace\/:repo|v1\/datasets\/:datasetId)/,'');
  const rules:Array<[boolean,Descriptor]>=[
    [method==='PATCH'&&tail==='',{kind:'project.settings',capability:'project.admin',macro:'project.updated'}],
    [tail==='/lifecycle/remove',{kind:'project.remove',capability:'project.admin',macro:'project.removed'}],
    [tail==='/lifecycle/restore',{kind:'project.restore',capability:'project.admin',macro:'project.restored'}],
    [tail==='/history/restore',{kind:'version.restore',capability:'project.admin',macro:'project.version_restored'}],
    [method==='PUT'&&tail==='/readme',{kind:'readme.commit',capability:'data.edit',macro:'project.readme_updated'}],
    [method==='PUT'&&tail==='/dataset/fields',{kind:'dataset.fields',capability:'schema.bind',macro:'project.fields_updated'}],
    [method==='POST'&&tail==='/dataset/fields/delete',{kind:'dataset.fields.delete',capability:'schema.bind',macro:'project.field_deleted'}],
    [tail==='/dataset/initialize-empty',{kind:'dataset.initialize',capability:'data.edit',macro:'dataset.initialized'}],
    [tail==='/dataset/save'||tail==='/dataset/draft/commit',{kind:'dataset.commit'}],
    [/^\/dataset\/import\/:id\/commit$/.test(tail),{kind:'dataset.import',capability:'data.edit',macro:'dataset.imported'}],
    [method==='PUT'&&tail==='/project-labels',{kind:'project.labels',capability:'dataset.assign',macro:'project.labels_updated'}],
    [method==='POST'&&tail==='/dataset/evaluation/policy',{kind:'dataset.evaluation_policy',capability:'release.manage',macro:'dataset.evaluation_enabled'}],
    [tail==='/schema/layers'||tail==='/schema/bind',{kind:'project.templates',capability:'schema.bind',macro:'project.templates_adopted'}],
    [/^\/workspaces\/:id\/commit$/.test(tail),{kind:'workspace.commit',capability:'data.edit'}],
    [tail==='/push',{kind:'branch.push',capability:'data.edit'}],
    [tail==='/merge'||/^\/merge-requests\/:id\/merge$/.test(tail),{kind:'branch.merge',capability:'merge.execute',macro:'project.merged'}],
    [method==='POST'&&tail==='/branches',{kind:'branch.create',capability:'data.edit',macro:'project.branch_created'}],
    [method==='POST'&&tail==='/releases',{kind:'release.create',capability:'release.manage',macro:'release.created'}],
    [method==='PATCH'&&tail==='/releases/:id',{kind:'release.update',capability:'release.manage',macro:'release.updated'}],
    [/^\/(?:releases|snapshots)\/:id\/build$/.test(tail),{kind:'release.build',capability:tail.startsWith('/snapshots')?'data.export':'release.manage'}],
    [tail==='/releases/:id/publish',{kind:'release.publish',capability:'release.manage',macro:'release.published'}],
    [tail==='/releases/:id/withdraw',{kind:'release.withdraw',capability:'release.manage',macro:'release.withdrawn'}],
    [tail==='/snapshots',{kind:'snapshot.build',capability:'data.export'}],
  ];
  return rules.find(([matches])=>matches)?.[1];
}
function responseAnchors(value:unknown):OperationAnchors {
  const result=object(value),nested=object(result.request),job=object(result.job),anchors:OperationAnchors={};
  const commitId=result.commitId??result.mergedCommitId??nested.mergedCommitId??(Array.isArray(result.parentIds)?result.id:undefined);
  if(typeof commitId==='string')anchors.commitId=commitId;
  if(typeof result.jobId==='string'||typeof nested.jobId==='string'||typeof job.id==='string')anchors.jobId=result.jobId??nested.jobId??job.id;
  if(typeof result.operation==='string'&&typeof result.id==='string')anchors.jobId=result.id;
  if(['release','snapshot'].includes(result.kind)&&typeof result.id==='string'){anchors.releaseId=result.id;anchors.assetHashes=Array.isArray(result.assets)?result.assets.map((asset:any)=>asset.sha256).filter((hash:unknown)=>typeof hash==='string'):[];}
  return anchors;
}
export function journalProvider(source:Provider):Provider {
  const writes=new Set(['createRepo','updateRepo','createBranch','merge','resolveMerge','createWorkspace','deleteWorkspace','writeWorkspace','removeWorkspaceFiles','commitWorkspace','annotate','push']);
  return new Proxy(source,{get(target,property){const original=Reflect.get(target,property,target);if(typeof original!=='function')return original;if(!writes.has(String(property)))return original.bind(target);
    return async(...args:any[])=>{
      const execution=operationContext.getStore();if(!execution)return original.apply(target,args);
      const method=String(property),key=args[0] as RepoKey;
      if(method==='commitWorkspace'){await execution.checkpoint({workspaceId:args[1]});const marker='Oxen-Web-Operation: '+execution.id;if(!String(args[2]).includes(marker))args[2]=String(args[2])+'\n\n'+marker;}
      if(method==='merge'){
        const branches=await target.branches(key),source=branches.find(branch=>branch.name===args[1]),destination=branches.find(branch=>branch.name===args[2]);
        if(source&&destination)await execution.checkpoint({sourceCommitId:source.commitId,targetCommitId:destination.commitId});
      }
      execution.writeAttempted=true;
      const value=await original.apply(target,args);
      if(method==='commitWorkspace')await execution.checkpoint({commitId:value.id});
      if(method==='createWorkspace')await execution.checkpoint({workspaceId:value.id});
      if(method==='merge'||method==='resolveMerge'){const branch=method==='merge'?args[2]:args[1]?.target;const head=branch&&(target.resolveRef?await target.resolveRef(key,branch):(await target.branches(key)).find(item=>item.name===branch)?.commitId);if(head)await execution.checkpoint({targetHead:head});}
      return value;
    };
  }});
}

export interface OperationHttpServices {
  provider:Provider;access:RepositoryAccessService;journal:OperationJournal;audit:GlobalAuditService;
  resolveRef?:(request:FastifyRequest,fallback:string)=>Promise<string>;
  release?:(key:RepoKey,id:string,identity:RequestIdentity)=>Promise<any>;
  evaluationPolicy?:(key:RepoKey)=>Promise<{enabled:boolean;operationId?:string}>;
  afterMerged?:(key:RepoKey,ref:string,record:OperationRecord)=>Promise<void>;
  holdAsync?:()=>()=>void;
  sourceAccess?:{mayReadSource:(key:RepoKey,identity:RequestIdentity)=>Promise<boolean>;requireSource:(key:RepoKey,identity:RequestIdentity)=>Promise<void>};
}
export function installOperationHttp(app:FastifyInstance,services:OperationHttpServices){
  const active=new Set<string>();
  app.addHook('onRoute',route=>{
    const methods=(Array.isArray(route.method)?route.method:[route.method]).map(String),entry=methods.map(method=>({method,definition:descriptor(route.url,method)})).find(item=>item.definition);
    if(!entry?.definition)return;
    const definition=entry.definition,original=route.handler;
    route.handler=async function(request,reply){
      const identity=requestIdentity(request),body=object(request.body),params=object(request.params);
      if(identity.kind==='guest')throw new ApiError(401,'AUTH_REQUIRED','请先登录后提交操作。');
      let key:RepoKey|undefined;
      if(params.namespace&&params.repo)key={namespace:safeSegment(params.namespace),repo:safeSegment(params.repo)};
      else if(typeof params.datasetId==='string'){const parts=params.datasetId.split('/');if(parts.length!==2)throw new ApiError(400,'DATASET_VIEW_ID_INVALID','数据集ID应为namespace/repository。');key={namespace:safeSegment(parts[0]!),repo:safeSegment(parts[1]!)};}
      else if(body.namespace&&(body.repo||body.name))key={namespace:safeSegment(body.namespace),repo:safeSegment(body.repo??body.name)};
      if(definition.owner&&identity.kind!=='owner')throw new ApiError(403,'OWNER_REQUIRED','仅实例管理员可创建项目。');
      if(key&&!definition.owner){if(definition.kind==='dataset.commit')await services.access.require(key,identity,'write');else await services.access.requireCapability(key,identity,definition.capability??'read');}
      const header=request.headers['x-operation-id']??request.headers['idempotency-key'];if(Array.isArray(header))throw new ApiError(400,'OPERATION_ID_INVALID','请提供单个操作标识。');
      const operationId=header??randomUUID();reply.header('X-Operation-Id',operationId);
      let ref=typeof(body.ref??body.branch??body.target)==='string'?safeRef(body.ref??body.branch??body.target):'main';
      if(services.resolveRef)ref=await services.resolveRef(request,ref);
      const expectedHead=typeof body.expectedCommit==='string'?safeRef(body.expectedCommit):undefined;
      const payload={method:request.method,route:route.url,params,query:request.query,body:request.body};
      return services.journal.run({id:operationId,actorId:identity.id,actorName:identity.name,kind:definition.kind,...(key?{key}:{}),ref,...(expectedHead?{expectedHead}:{}),payload},async context=>{
        const execution:OperationExecutionContext={id:operationId,writeAttempted:false,checkpoint:context.checkpoint,defer:context.defer,complete:anchors=>services.journal.complete(operationId,anchors),uncertain:code=>services.journal.fail(operationId,code),holdAsync:services.holdAsync};
        active.add(operationId);
        try{return await operationContext.run(execution,async()=>{
          let value:unknown;
          if(definition.kind.startsWith('release.')&&typeof params.id==='string')await context.checkpoint({releaseId:params.id});
          try{value=await original.call(this,request,reply);}catch(error){if(!execution.writeAttempted&&((error as any)?.validation||(error instanceof ApiError&&[400,401,403].includes(error.status))||(error as Error).name==='ZodError'||fieldDeletePrewriteRejection(definition.kind,error)||globalFieldPrewriteRejection(definition.kind,error)||releasePrewriteRejection(definition.kind,error)))context.confirmNotWritten();throw error;}
          const anchors=responseAnchors(value),result=object(value);
          await context.checkpoint(anchors);
          if(['queued','running','building','merging'].includes(result.status)||object(result.job).id||object(result.request).status==='merging')context.defer();
          if(definition.macro)await services.audit.record({action:definition.macro,actor:identity,...(key?{repository:key}:{}),...(typeof(result.id??params.id)==='string'?{targetId:result.id??params.id}:{}),details:{operationId,branch:ref,...(anchors.commitId?{commitId:anchors.commitId}:{}),...(typeof result.totalRows==='number'?{sampleCount:result.totalRows}:{})}});
          return{value,anchors};
        });}finally{active.delete(operationId);}
      });
    };
  });
  const maySee=async(record:OperationRecord,identity:RequestIdentity)=>{if(identity.kind!=='owner'&&(record.actorId!==identity.id||!record.key))throw new ApiError(404,'OPERATION_NOT_FOUND','操作记录不存在。');if(record.key){await services.access.require(record.key,identity,'read');await services.sourceAccess?.requireSource(record.key,identity);}};
  app.get('/api/operations',async request=>{const identity=requestIdentity(request);if(identity.kind==='guest')throw new ApiError(401,'AUTH_REQUIRED','请先登录。');const query=object(request.query),state=typeof query.state==='string'?query.state:undefined;if(state&&!['prepared','running','succeeded','failed','reconciliation-required'].includes(state))throw new ApiError(400,'OPERATION_STATE_INVALID','操作状态无效。');const allowedKeys:RepoKey[]=[];if(identity.kind!=='owner')for(const key of services.journal.repositoryKeys(identity.id))if((await services.access.permissions(key,identity)).read&&(!services.sourceAccess||await services.sourceAccess.mayReadSource(key,identity)))allowedKeys.push(key);return services.journal.list({...(identity.kind==='owner'?{}:{actorId:identity.id,allowedKeys}),...(state?{state:state as any}:{}),page:Number(query.page)||1,pageSize:Number(query.pageSize)||30});});
  app.get('/api/operations/:id',async request=>{const record=services.journal.get(String(object(request.params).id));await maySee(record,requestIdentity(request));return record;});
  app.post('/api/operations/:id/reconcile',async request=>{
    const identity=requestIdentity(request),id=String(object(request.params).id),record=services.journal.get(id);await maySee(record,identity);
    if(identity.kind!=='owner')throw new ApiError(403,'OWNER_REQUIRED','仅实例管理员可确认故障对账结果。');
    if(active.has(id))throw new ApiError(409,'OPERATION_STILL_RUNNING','请求仍在执行，请等待完成后核对。');
    const result=await services.journal.reconcile(id,async item=>reconcileOperation(item,identity,services));
    await services.audit.record({action:'operation.reconciled',actor:identity,...(record.key?{repository:record.key}:{}),targetId:id,details:{state:result.state,reasonCode:result.reasonCode??'UNKNOWN'}});return result;
  });
}

async function reachable(provider:Provider,key:RepoKey,head:string,wanted:string){if(head===wanted)return true;const seen=new Set<string>();for(let page=1;page<=20;page++){const items=await provider.commits(key,head,page,100);if(items.some(item=>item.id===wanted))return true;if(!items.length||items.every(item=>seen.has(item.id)))break;items.forEach(item=>seen.add(item.id));if(items.length<100)break;}return false;}
export async function reconcileOperation(record:OperationRecord,identity:RequestIdentity,services:OperationHttpServices):Promise<OperationResolution>{
  const unresolved=(reasonCode:string):OperationResolution=>({state:'reconciliation-required',reasonCode});
  if(!record.key)return unresolved('AUTHORITY_ANCHOR_REQUIRED');
  const {key,anchors}=record,provider=services.provider;
  // R16's create guard checked the required policy before entering ReleaseService.mutate.
  // Its exact local code plus an entirely empty anchor map proves rejection, not a lost result.
  // Do not broaden this to generic 409s, interrupted operations, other transitions or anchored writes.
  if(record.state==='reconciliation-required'&&record.kind==='release.create'&&record.reasonCode==='EVALUATION_POLICY_REQUIRED'&&Object.keys(anchors).length===0){
    const policy=await services.evaluationPolicy?.(key);
    if(policy?.operationId===record.id)return unresolved('RELEASE_CREATE_POLICY_WRITE_REQUIRES_INSPECTION');
    return{state:'failed',reasonCode:'RELEASE_CREATE_PREWRITE_REJECTION_VERIFIED'};
  }
  if(record.kind==='dataset.evaluation_policy'&&services.evaluationPolicy){const policy=await services.evaluationPolicy(key);if(policy.enabled&&policy.operationId===record.id)return {state:'succeeded',reasonCode:'EVALUATION_POLICY_VERIFIED'};return unresolved('EVALUATION_POLICY_ANCHOR_REQUIRED');}
  if(anchors.releaseId&&services.release){
    const release=await services.release(key,anchors.releaseId,identity);
    if(['queued','building'].includes(release.status))return unresolved('BUILD_STILL_PENDING');
    if(record.kind==='release.publish'&&release.status!=='published'||record.kind==='release.withdraw'&&release.status!=='withdrawn')return unresolved('RELEASE_TRANSITION_NOT_PROVEN');
    if(record.kind==='release.withdraw'&&release.status==='withdrawn')return{state:'succeeded',reasonCode:'RELEASE_WITHDRAWAL_VERIFIED',anchors:{releaseId:release.id}};
    if(['ready','published'].includes(release.status)&&Array.isArray(release.assets)&&release.assets.length&&['release.build','snapshot.build','release.publish'].includes(record.kind)){
      if(anchors.assetHashes?.length&&anchors.assetHashes.some(hash=>!release.assets.some((asset:any)=>asset.sha256===hash)))return unresolved('RELEASE_ASSET_MISMATCH');
      return{state:'succeeded',reasonCode:'RELEASE_RESULT_VERIFIED',anchors:{releaseId:release.id,commitId:release.commitId,assetHashes:release.assets.map((asset:any)=>asset.sha256)}};
    }
    return unresolved('RELEASE_RESULT_REQUIRES_INSPECTION');
  }
  if(record.kind==='branch.merge'&&anchors.sourceCommitId&&anchors.targetCommitId&&record.ref){
    const head=provider.resolveRef?await provider.resolveRef(key,record.ref):(await provider.branches(key)).find(item=>item.name===record.ref)?.commitId;
    if(head&&await reachable(provider,key,head,anchors.sourceCommitId)&&await reachable(provider,key,head,anchors.targetCommitId)){
      await services.afterMerged?.(key,record.ref,{...record,anchors:{...record.anchors,targetHead:head}});
      return{state:'succeeded',reasonCode:'MERGE_ANCESTRY_VERIFIED',anchors:{targetHead:head}};
    }
    return unresolved('MERGE_HEAD_REQUIRES_INSPECTION');
  }
  const marker='Oxen-Web-Operation: '+record.id;
  if(anchors.commitId){
    const commit=await provider.commit(key,anchors.commitId);
    if(commit.message.includes(marker)&&(!record.expectedHead||commit.parentIds.includes(record.expectedHead)))return{state:'succeeded',reasonCode:'COMMIT_ANCHOR_VERIFIED',anchors:{commitId:commit.id}};
    return unresolved('COMMIT_ANCHOR_MISMATCH');
  }
  let reachedExpectedHead=false;
  if(record.ref){
    const seen=new Set<string>();for(let page=1;page<=20;page++){
      const commits=await provider.commits(key,record.ref,page,100),matches=commits.filter(commit=>commit.message.includes(marker)&&(!record.expectedHead||commit.parentIds.includes(record.expectedHead)));
      if(matches.length===1)return{state:'succeeded',reasonCode:'COMMIT_MARKER_VERIFIED',anchors:{commitId:matches[0]!.id}};
      if(matches.length>1)return unresolved('MULTIPLE_COMMIT_ANCHORS');
      if(commits.some(commit=>commit.id===record.expectedHead))reachedExpectedHead=true;
      if(!commits.length||reachedExpectedHead||commits.every(commit=>seen.has(commit.id)))break;
      commits.forEach(commit=>seen.add(commit.id));if(commits.length<100)break;
    }
  }
  // R16 initially recorded these rejected local guards as unknown. A native Provider checkpoints
  // createWorkspace before any staging or later CAS guard; remote errors use OXEN_* codes.
  // Only reconcile this exact local operation after a complete anchored history scan and
  // an empty deletion-workspace scan. Any commit/workspace anchor retains the ordinary path.
  if(record.kind==='dataset.fields.delete'&&['DATASET_FIELD_DELETE_CONFIRM','DATASET_FIELD_DELETE_PROTECTED','DATASET_VERSION_CONFLICT'].includes(record.reasonCode??'')&&Object.keys(anchors).length===0&&record.ref&&record.expectedHead&&reachedExpectedHead){
    const workspaces=await provider.workspaces(key);
    if(workspaces.some(workspace=>workspace.name==='Delete sample field'||workspace.name.includes(record.id)||workspace.name.includes(marker)))return unresolved('FIELD_DELETE_WORKSPACE_REQUIRES_INSPECTION');
    return{state:'failed',reasonCode:'FIELD_DELETE_PREWRITE_REJECTION_VERIFIED'};
  }
  return unresolved('NO_PROVABLE_RESULT');
}
