import Fastify, { type FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { z, ZodError } from 'zod';
import type { AppStatus, RepoSummary } from '../../../packages/shared/src/index.js';
import { installAuth,requestIdentity } from './auth.js';
import { JobQueue } from './cli.js';
import type { Config } from './config.js';
import { DemoProvider } from './demo.js';
import { ApiError } from './errors.js';
import { LiveProvider } from './live.js';
import type { Provider, RepoKey } from './provider.js';
import { safeFilePath, safeRef, safeSegment } from './safety.js';
import { registerLabelRoutes } from './label-routes.js';
import { registerImportRoutes } from './import-routes.js';
import { registerArchiveRoutes } from './archive-routes.js';
import { queryDataset } from './query-service.js';
import { registerTableEditor } from './table-editor-routes.js';
import { registerMergeRequests } from './merge-requests.js';
import { RepositorySettingsService,repositoryPatchSchema,repositoryPolicyPath } from './repository-settings.js';
import { RepositoryAccessService,assertRepositoryFileWrite,installRepositoryAccess,registerRepositoryControl } from './repository-access.js';
import { registerGovernanceRoutes } from './governance-routes.js';
import { getBindingSnapshot } from './governance.js';
import type { ProjectSchemaBinding } from '../../../packages/shared/src/governance-types.js';
import { registerDatasetDraftRoutes } from './dataset-draft-routes.js';
import { DatasetCatalogService } from './dataset-catalog.js';
import { RepositoryActivityStore } from './repository-activity.js';
import { registerProjectLabelRoutes } from './project-label-routes.js';
import { registerDatasetRoutes } from './dataset-routes.js';
import { WorkflowService } from './workflow.js';
import { registerWorkflowRoutes } from './workflow-routes.js';
import { ReleaseService } from './releases.js';
import { registerReleaseRoutes } from './release-routes.js';
import { registerArchiveDiffRoutes } from './archive-diff.js';
import { registerZipImportRoutes } from './zip-import-routes.js';
import { assignmentId, validateLabelDocument } from './labels.js';
import { registerMergeResolutionRoutes } from './merge-resolution-routes.js';
import { registerDatasetConfigurationRoutes } from './dataset-configuration-routes.js';
import { registerDatasetFieldRoutes } from './dataset-field-routes.js';
import { registerDatasetUiStateRoutes } from './dataset-ui-state-routes.js';
import { RepositoryLifecycleService } from './repository-lifecycle.js';
import { registerRepositoryLifecycleRoutes } from './repository-lifecycle-routes.js';
import { registerRepositoryReadmeRoutes } from './repository-readme-routes.js';
import { DatasetAutoWidthService } from './dataset-auto-width.js';
import { registerDatasetAutoWidthRoutes } from './dataset-auto-width-routes.js';
import { registerDatasetImportRoutes } from './dataset-import-routes.js';
import { APPLICATION_VERSION } from '../../../packages/shared/src/version.js';

const name = z.string().min(1).max(120).transform(safeSegment);
const ref = z.string().min(1).max(160).transform(safeRef);
const filename = z.string().min(1).max(1024).transform(safeFilePath);
const workspaceId = z.string().uuid();
const query = z.object({ ref: ref.default('main'), path: z.string().max(1024).default(''), page: z.coerce.number().int().min(1).max(100_000).default(1), pageSize: z.coerce.number().int().min(1).max(500).default(100) });
const params = z.object({ namespace: name, repo: name });
const key = (request: FastifyRequest): RepoKey => { const value = params.parse(request.params); return { namespace: value.namespace, repo: value.repo }; };
const id = (request: FastifyRequest) => workspaceId.parse((request.params as { id: string }).id);
const base = '/api/repos/:namespace/:repo';

export async function createApp(config: Config, injectedProvider?: Provider) {
  const app = Fastify({ bodyLimit: 12 * 1024 * 1024, logger: false, requestTimeout: 120_000 });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: error.issues.map(issue => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; '), requestId: request.id } });
    if (error instanceof ApiError) return reply.code(error.status).send({ error: { code: error.code, message: error.message, requestId: request.id, ...(error.details !== undefined ? { details: error.details } : {}) } });
    const statusCode = typeof (error as { statusCode?: unknown }).statusCode === 'number' ? (error as { statusCode: number }).statusCode : 500;
    const message = statusCode < 500 && error instanceof Error ? error.message : 'An internal server error occurred.';
    if (statusCode >= 500) app.log.error({ err: error, requestId: request.id }, 'Request failed');
    return reply.code(statusCode).send({ error: { code: statusCode === 413 ? 'UPLOAD_LIMIT' : 'INTERNAL_ERROR', message, requestId: request.id } });
  });
  app.addHook('onSend', async (request, reply) => { reply.header('X-Content-Type-Options', 'nosniff'); if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store'); });
  const provider: Provider = injectedProvider ?? (config.demo ? new DemoProvider(config.demoFile) : new LiveProvider(config));
  if (provider instanceof DemoProvider || provider instanceof LiveProvider) await provider.init();
  const jobs = new JobQueue();
  const jobRepositories=new Map<string,RepoKey>();
  const settings=new RepositorySettingsService(provider,path.join(path.dirname(config.demoFile),'repository-policy-branches.json'));
  const access=new RepositoryAccessService(settings,path.join(path.dirname(config.demoFile),'access-credentials.json'),!config.token);
  await access.init();
  const authenticated = installAuth(app, config);
  installRepositoryAccess(app,access,authenticated);
  const lifecycle=new RepositoryLifecycleService({filename:path.join(path.dirname(config.demoFile),'repository-recycle-bin.json'),provider,access});await lifecycle.init();
  app.addHook('onRequest',async request=>{const match=/^\/api\/repos\/([^/]+)\/([^/?]+)(\/[^?]*)?/.exec(request.url);if(!match)return;const tail=match[3]??'';if(tail==='/lifecycle'||tail==='/lifecycle/remove'||tail==='/lifecycle/restore')return;lifecycle.assertAvailable({namespace:safeSegment(decodeURIComponent(match[1]!)),repo:safeSegment(decodeURIComponent(match[2]!))});});
  registerRepositoryLifecycleRoutes(app,lifecycle);
  registerRepositoryControl(app,{settings,access});
  const {governance,writeGuard}=await registerGovernanceRoutes(app,{provider,access,filename:path.join(path.dirname(config.demoFile),'governance.json'),organizations:[...new Set(['local','oxen',...config.namespaces])]});
  let workflows:WorkflowService;
  const datasets=registerDatasetRoutes(app,provider,{access,governance,beforeWrite:(...args)=>workflows.beforeWrite(...args),workflowFields:(repository,snapshot)=>workflows.workflowFields(repository,snapshot),rowCapabilities:(...args)=>workflows.rowCapabilities(...args),appendRows:(...args)=>workflows.appendRowsAllowed(...args)});
  registerDatasetAutoWidthRoutes(app,new DatasetAutoWidthService(datasets,async(repository,identity)=>{await access.requireCapability(repository,identity,'read');await access.requireCapability(repository,identity,'schema.bind');}));
  workflows=new WorkflowService({provider,datasets,access,filename:path.join(path.dirname(config.demoFile),'annotation-tasks.json')});
  await workflows.init();registerWorkflowRoutes(app,workflows);
  const drafts=registerDatasetDraftRoutes(app,datasets,{directory:path.join(path.dirname(config.demoFile),'dataset-drafts'),access,rowCapabilities:(...args)=>workflows.rowCapabilities(...args),appendRows:(...args)=>workflows.appendRowsAllowed(...args)});
  registerRepositoryReadmeRoutes(app,{provider,datasets,drafts,access});
  registerDatasetUiStateRoutes(app,{directory:path.join(path.dirname(config.demoFile),'dataset-ui-state'),access});
  registerDatasetFieldRoutes(app,{provider,access,datasets,beforeSave:async(repository,identity,branch,_snapshot,_fields,presentationOnly)=>{
    if(presentationOnly)return;
    const ownDraft=await drafts.read(repository,identity,branch);
    if(ownDraft.draft||ownDraft.summary)throw new ApiError(409,'DATASET_FIELDS_DRAFT_IN_USE','此分支仍有本人样本草稿。请先提交或导出并放弃草稿，再维护字段配置。');
    if(workflows.store.list(repository).some(task=>!['merged','cancelled','setup-failed'].includes(task.status)))throw new ApiError(409,'TASK_TEMPLATE_IN_USE','当前仍有活动标注任务。请先完成或撤销任务，再修改样本字段规则。');
  }});
  const activity=new RepositoryActivityStore(path.join(path.dirname(config.demoFile),'repository-activity.json'));await activity.init();
  const catalog=new DatasetCatalogService({provider,readBinding:(repository,commitId)=>governance.snapshot(repository,commitId),authorize:async(repository,identity)=>{await access.requireCapability(repository,identity,'read');},readActivity:async(repository,identity)=>({...activity.read(repository),localDraftAt:(await drafts.readActivity(repository,identity)).updatedAt})});
  registerProjectLabelRoutes(app,{provider,access,readBinding:(repository,commitId)=>governance.snapshot(repository,commitId)});
  registerDatasetConfigurationRoutes(app,{provider,access,datasets});
  app.addHook('preValidation',async request=>{
    if(['GET','HEAD','OPTIONS'].includes(request.method))return;
    const match=/^\/api\/repos\/([^/]+)\/([^/?]+)\/workspaces(?:\/([^/?]+))?(?:\/|$)/.exec(request.url.split('?')[0]!);
    if(!match)return;
    const repository={namespace:safeSegment(decodeURIComponent(match[1]!)),repo:safeSegment(decodeURIComponent(match[2]!))};
    if(!workflows.store.list(repository).length)return;
    const body=request.body&&typeof request.body==='object'?request.body as Record<string,unknown>:{};
    const branch=match[3]?(await provider.workspace(repository,workspaceId.parse(decodeURIComponent(match[3])))).branch:typeof body.branch==='string'?safeRef(body.branch):'';
    await workflows.beforeWrite(repository,requestIdentity(request),branch,[],'edit-content',{operations:[{op:'append',record:{}}]});
  });
  registerMergeResolutionRoutes(app,{provider,access,filename:path.join(path.dirname(config.demoFile),'merge-resolutions.json'),beforeResolve:async(repository,identity,preview)=>{await writeGuard.assertMergeAllowed(repository,identity,preview.sourceCommitId,preview.targetCommitId);}});
  governance.setBindingValidator(async(repository,commitId,next,layer,currentBinding)=>{
    let snapshot;try{snapshot=await datasets.read(repository,commitId);}catch(cause){if(cause instanceof ApiError&&cause.code==='DATASET_NOT_CONFIGURED')return;throw cause;}
    const binding=currentBinding??snapshot.binding as ProjectSchemaBinding|undefined;
    const scope=layer==='dataset'?'dataset':'row',current=getBindingSnapshot(binding,scope)?.checksum;
    if(layer!=='dataset'&&current!==next.checksum&&workflows.store.list(repository).some(task=>!['merged','cancelled','setup-failed'].includes(task.status)))throw new ApiError(409,'TASK_TEMPLATE_IN_USE','当前仍有活动标注任务。请先完成或撤销任务，再显式升级规范，已有记录将保留。');
    // Initial adoption does not reinterpret retired assignments as values of the selected layer.
    if(layer&&!(binding?.version===2&&binding.layers[layer]))return;
    const accepts=(target:string)=>layer==='dataset'?target==='dataset':layer==='sample'?target!=='dataset':true;
    validateLabelDocument({version:1,columns:next.columns,assignments:snapshot.labels.assignments.filter(item=>accepts(item.scope))});
    for(const record of snapshot.labelRecords){
      if(!accepts(record.scope))continue;
      if(record.scope==='row'&&!snapshot.rowIds.includes(record.rowId??''))continue;
      const values=Object.fromEntries(Object.entries(record.values).filter((entry):entry is [string,string|string[]]=>entry[1]!==null));
      const target={scope:record.scope,path:record.path,rowId:record.rowId};
      validateLabelDocument({version:1,columns:next.columns,assignments:[{...target,id:assignmentId(target),values}]});
      for(const fragment of [...record.spans,...record.steps])validateLabelDocument({version:1,columns:next.columns,assignments:[{...target,id:assignmentId(target),values:fragment.values}]});
    }
  });
  writeGuard.setManagedPathResolver(async(repository,filename)=>{try{return (await datasets.managedPaths(repository,(await settings.read(repository)).policy.defaultBranch)).has(filename);}catch(cause){if(cause instanceof ApiError&&(cause.status===404||cause.code==='DATASET_NOT_CONFIGURED'))return false;throw cause;}});
  writeGuard.setAssignmentAuthorizer(async(repository,identity,body)=>{
    if(!workflows.store.list(repository).length)return;
    const branch=ref.parse(body.ref),scope=z.enum(['dataset','file','row']).parse(body.scope),rowId=typeof body.rowId==='string'?body.rowId:undefined;
    let targets=rowId?[rowId]:[];
    if(scope==='file'&&typeof body.path==='string')targets=(await datasets.read(repository,branch)).attachments.find(item=>item.path===body.path)?.rowIds??[];
    await workflows.beforeWrite(repository,identity,branch,targets,scope==='row'?'assign-labels':scope==='file'?'edit-file-labels':'edit-dataset-labels',{scope,path:typeof body.path==='string'?body.path:undefined,operations:[]});
  });
  const releaseService=new ReleaseService({provider,readDataset:(repository,reference)=>datasets.read(repository,reference),rootDir:path.join(path.dirname(config.demoFile),'releases'),authorize:async(repository,identity,capability)=>{await access.requireCapability(repository,identity,capability);},preflight:(repository,snapshot)=>workflows.preflight(repository,snapshot.commitId),mainBranch:async repository=>(await settings.read(repository)).policy.defaultBranch});
  await releaseService.init();registerReleaseRoutes(app,releaseService);registerArchiveDiffRoutes(app,provider);
  const zipImports=registerZipImportRoutes(app,{provider,rootDir:path.join(path.dirname(config.demoFile),'zip-import'),onRepositoryCreated:repository=>activity.recordCreated(repository),authorize:async(repository,identity,creating)=>{if(creating&&identity.kind!=='owner')throw new ApiError(403,'OWNER_REQUIRED','仅实例管理员可创建项目。');if(!creating)await access.requireCapability(repository,identity,'data.edit');},importDataset:async(repository,identity,input)=>{if(input.labels?.columns.length)await access.requireCapability(repository,identity,'schema.manage');return datasets.initialize(repository,identity,input);}});
  registerDatasetImportRoutes(app,{provider,datasets,zipImports,access,drafts});
  const countCache=new Map<string,{sampleCount:number;sampleCountCommitId:string}>();
  const withSampleCount=async(summary:RepoSummary):Promise<RepoSummary>=>{
    try{
      const repository={namespace:summary.namespace,repo:summary.name};
      const commitId=summary.catalog?summary.catalog.commitId:provider.resolveRef?await provider.resolveRef(repository,summary.defaultBranch):(await provider.branches(repository)).find(item=>item.name===summary.defaultBranch)?.commitId;
      if(!commitId) return {...summary,sampleCount:null,sampleCountState:'not-dataset'};
      const cacheKey=`${summary.namespace}/${summary.name}@${commitId}`;
      let counts=countCache.get(cacheKey);
      if(!counts){const snapshot=await datasets.read(repository,commitId);counts={sampleCount:snapshot.totalRows,sampleCountCommitId:snapshot.commitId};if(countCache.size>=2000)countCache.delete(countCache.keys().next().value!);countCache.set(cacheKey,counts);}
      return {...summary,...counts,sampleCountState:'ready'};
    }catch(cause){return {...summary,sampleCount:null,sampleCountState:cause instanceof ApiError&&(cause.status===404||cause.code==='DATASET_NOT_CONFIGURED')?'not-dataset':'unavailable'};}
  };
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 12 } });

  const readiness = () => provider.checkReady ? provider.checkReady() : Promise.resolve(provider.ready);
  app.get('/api/health', async () => ({ ready: await readiness(), mode: config.demo ? 'demo' : 'live', version: APPLICATION_VERSION }));
  app.get('/api/status', async (request): Promise<AppStatus> => ({ mode: config.demo ? 'demo' : 'live', ready: await readiness(), upstream: config.upstream, version: APPLICATION_VERSION, authenticated: authenticated(request), identity:authenticated.identity(request), capabilities:{...provider.capabilities,reasons:{...provider.capabilities.reasons,annotations:'规范在组织标签管理维护；样本正文、三级标签与片段标注按条目版本化，任务复核后合并，固定版本发布。',metadata:'仓库设置与协作权限写入 Oxen 版本文件；访问控制在 BFF 执行，上游服务仅本机监听。',naturalLanguageQuery:'Codex 根据字段结构生成只读计划，数据本机完整扫描；也可明确选择规则查询，不自动降级。'}} }));
  app.get('/api/capabilities', async () => provider.capabilities);

  app.get('/api/repos', async request => {
    const { namespace } = z.object({ namespace: name.optional() }).parse(request.query),visible=lifecycle.filter(await access.filterRepositories(requestIdentity(request),await provider.repos(namespace))),enriched:RepoSummary[]=[];
    for(let start=0;start<visible.length;start+=3)enriched.push(...await Promise.all(visible.slice(start,start+3).map(async summary=>withSampleCount(await catalog.enrichSummary(summary,requestIdentity(request))))));
    const updated=(item:RepoSummary)=>{const time=Date.parse(item.activity?.modifiedAt??'');return Number.isFinite(time)?time:Number.NEGATIVE_INFINITY;};
    return enriched.sort((a,b)=>updated(a)===updated(b)?`${a.namespace}/${a.name}`.localeCompare(`${b.namespace}/${b.name}`):updated(a)>updated(b)?-1:1);
  });
  app.post('/api/repos', async (request, reply) => {
    const input = z.object({ namespace: name, name, description: z.string().max(4000).default(''), visibility: z.enum(['public', 'private']).optional() }).parse(request.body);
    const result = await provider.createRepo(input); await activity.recordCreated({namespace:input.namespace,repo:input.name});await settings.update({namespace:input.namespace,repo:input.name},{description:input.description,...(input.visibility?{visibility:input.visibility}:{})},requestIdentity(request));reply.code(201); return settings.applyToSummary(result);
  });
  app.get(base, async request => withSampleCount(await catalog.enrichSummary(await settings.applyToSummary(await provider.repo(key(request))),requestIdentity(request))));
  app.get(`${base}/catalog`,async request=>{const input=z.object({ref}).parse(request.query);return catalog.branchSummary(key(request),input.ref,requestIdentity(request));});
  app.patch(base, async request => {
    await access.require(key(request),requestIdentity(request),'admin');
    const patch = repositoryPatchSchema.parse(request.body);
    await settings.update(key(request),patch,requestIdentity(request));
    return settings.applyToSummary(await provider.repo(key(request)));
  });
  app.get(`${base}/tree`, async request => { const q = query.parse(request.query); return provider.tree(key(request), q.ref, q.path ? safeFilePath(q.path) : ''); });
  app.get(`${base}/file`, async request => { const q = query.parse(request.query); return provider.file(key(request), q.ref, safeFilePath(q.path), q.page, q.pageSize); });
  app.get(`${base}/raw`, async (request, reply) => {
    const q = query.parse(request.query), file = await provider.raw(key(request), q.ref, safeFilePath(q.path));
    reply.type(file.mime);
    reply.header('Content-Disposition', `${file.mime === 'application/octet-stream' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
    if (file.mime === 'image/svg+xml') reply.header('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
    return reply.send(file.content);
  });
  app.get(`${base}/commits`, async request => { const q = query.parse(request.query); return provider.commits(key(request), q.ref, q.page, q.pageSize); });
  app.get(`${base}/commits/:id`, async request => provider.commit(key(request), ref.parse((request.params as { id: string }).id)));
  app.get(`${base}/diff`, async request => { const q = z.object({ base: ref, head: ref }).parse(request.query); return provider.diff(key(request), q.base, q.head); });
  app.get(`${base}/branches`, async request => provider.branches(key(request)));
  app.post(`${base}/branches`, async (request, reply) => { const input = z.object({ name: ref, from: ref }).parse(request.body); const result = await provider.createBranch(key(request), input.name, input.from); reply.code(201); return result; });
  app.post(`${base}/merge`, async request => {
    const input = z.object({ source: ref, target: ref }).parse(request.body), repo = key(request);
    if (input.source === input.target) throw new ApiError(400, 'INVALID_MERGE', 'Source and target branches must differ.');
    const mergeGuard=async()=>{await writeGuard.assertMergeAllowed(repo,requestIdentity(request),input.target,input.source);await workflows.beforeMerge(repo,requestIdentity(request),input.source,input.target);};
    await mergeGuard();
    if (config.demo) {const result=await provider.merge(repo,input.source,input.target);await workflows.markMerged(repo,input.target);return result;}
    const actor=requestIdentity(request),branches=await provider.branches(repo),source=branches.find(branch=>branch.name===input.source),target=branches.find(branch=>branch.name===input.target);
    if(!source||!target)throw new ApiError(404,'BRANCH_NOT_FOUND','Source and target branches must exist.');
    const job=jobs.add(`${repo.namespace}/${repo.repo}`, 'merge', async () => {
      await access.require(repo,actor,'write');
      const changesPolicy=(await provider.diff(repo,target.commitId,source.commitId)).some(change=>repositoryPolicyPath(change.path));
      await access.require(repo,actor,changesPolicy?'admin':'write');
      const result=String(await provider.merge(repo,input.source,input.target,{expectedSourceCommitId:source.commitId,expectedTargetCommitId:target.commitId,beforeWrite:async()=>{await access.require(repo,actor,changesPolicy?'admin':'write');await mergeGuard();}}));
      await workflows.markMerged(repo,input.target).catch(error=>app.log.error({err:error},'Workflow reconciliation pending after successful merge'));return result;
    });jobRepositories.set(job.id,repo);return job;
  });
  app.get(`${base}/workspaces`, async request => provider.workspaces(key(request)));
  app.post(`${base}/workspaces`, async (request, reply) => { const input = z.object({ name: z.string().trim().min(1).max(120), branch: ref }).parse(request.body); const result = await provider.createWorkspace(key(request), input.name, input.branch); reply.code(201); return result; });
  app.get(`${base}/workspaces/:id`, async request => provider.workspace(key(request), id(request)));
  app.delete(`${base}/workspaces/:id`, async (request, reply) => { await provider.deleteWorkspace(key(request), id(request)); reply.code(204).send(); });
  app.get(`${base}/workspaces/:id/file`, async request => { const q = z.object({ path: filename }).parse(request.query); return provider.workspaceFile(key(request), id(request), q.path); });
  app.put(`${base}/workspaces/:id/files`, async request => { const input = z.object({ path: filename, content: z.string().max(10 * 1024 * 1024) }).parse(request.body); return provider.writeWorkspace(key(request), id(request), input.path, Buffer.from(input.content, 'utf8')); });
  app.post(`${base}/workspaces/:id/upload`, async request => {
    const repo = key(request), workspace = id(request);
    const upload = await request.file();
    if (!upload) throw new ApiError(400, 'FILE_REQUIRED', 'Choose a file to upload.');
    const content = await upload.toBuffer();
    if (upload.file.truncated) throw new ApiError(413, 'UPLOAD_LIMIT', 'Files must be no larger than 10 MB.');
    const inputPath = upload.fields.path;
    const requested = inputPath && !Array.isArray(inputPath) && 'value' in inputPath ? String(inputPath.value) : upload.filename;
    const filename=safeFilePath(requested);await assertRepositoryFileWrite(request,repo,filename,access);
    return provider.writeWorkspace(repo, workspace, filename, content);
  });
  app.post(`${base}/workspaces/:id/commit`, async request => { const input = z.object({ message: z.string().trim().min(1).max(4000), expectedCommit: ref.optional() }).parse(request.body); return provider.commitWorkspace(key(request), id(request), input.message, input.expectedCommit); });
  app.post(`${base}/push`, async request => {
    const input = z.object({ branch: ref }).parse(request.body), repo = key(request);
    if (!provider.push) throw new ApiError(501, 'CAPABILITY_UNAVAILABLE', 'CLI push is not enabled.');
    const actor=requestIdentity(request);
    const job=jobs.add(`${repo.namespace}/${repo.repo}`, 'push', async () => {await access.require(repo,actor,'write');return provider.push!(repo,input.branch,{beforeWrite:async()=>{await access.require(repo,actor,'write');}});});jobRepositories.set(job.id,repo);return job;
  });
  app.get('/api/jobs/:id', async request => {const id=z.string().uuid().parse((request.params as { id: string }).id),repo=jobRepositories.get(id);if(repo)await access.require(repo,requestIdentity(request),'read');return jobs.get(id);});
  app.get(`${base}/annotations`, async request => { const input = z.object({ path: filename.optional(), ref: ref.optional() }).parse(request.query); return provider.annotations(key(request), input.path, input.ref); });
  app.post(`${base}/annotations`, async request => {
    key(request);
    throw new ApiError(410, 'ANNOTATIONS_MOVED', '新标注请使用 /labels/assignments，提供 ref 和 expectedCommit 后纳入 Oxen 版本提交。旧标注保留读取，可通过 /labels/migrate 迁移。');
  });
  app.post(`${base}/query`, async request => {
    const input = z.object({ ref: ref.default('main'), path: filename, prompt: z.string().trim().min(1).max(4000), engine:z.enum(['model','rules']).default('model'),allowExternalSchema:z.boolean().default(false) }).parse(request.body);
    if(input.engine==='model'&&requestIdentity(request).kind==='guest')throw new ApiError(401,'QUERY_AUTH_REQUIRED','Sign in before using model queries.');
    return queryDataset(provider,key(request),input.ref,input.path,input.prompt,input.engine,input.allowExternalSchema);
  });

  registerLabelRoutes(app, provider);
  registerArchiveRoutes(app, provider);
  await registerMergeRequests(app,{provider,access,jobs,filename:path.join(path.dirname(config.demoFile),'merge-requests.json'),onJob:(jobId,repo)=>jobRepositories.set(jobId,repo),beforeMerge:async(repository,identity,source,target)=>{await writeGuard.assertMergeAllowed(repository,identity,target,source);await workflows.beforeMerge(repository,identity,source,target);},afterMerge:async(repository,_identity,_source,target)=>{await workflows.markMerged(repository,target).catch(error=>app.log.error({err:error},'Workflow reconciliation pending after successful merge'));}});
  registerTableEditor(app,provider);
  registerImportRoutes(app, provider,async(request,key,creating)=>{if(creating){if(requestIdentity(request).kind!=='owner')throw new ApiError(403,'OWNER_REQUIRED','仅实例所有者可创建仓库。');}else await access.requireCapability(key,requestIdentity(request),'data.edit');},{beforeWrite:(...args)=>workflows.beforeWrite(...args),onRepositoryCreated:repository=>activity.recordCreated(repository)});
  const staticRoot = path.join(config.projectRoot, 'apps/web/dist');
  if ((await stat(staticRoot).catch(() => null))?.isDirectory()) {
    await app.register(fastifyStatic, { root: staticRoot, prefix: '/', wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'API route not found.' } });
      return reply.sendFile('index.html');
    });
  }
  return app;
}
