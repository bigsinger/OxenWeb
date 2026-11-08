import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RequestIdentity } from '../../../packages/shared/src/index.js';
import { requestIdentity } from './auth.js';
import { ApiError } from './errors.js';
import { GovernanceService, SCHEMA_BINDING_PATH, dimensionDraftSchema, domainSchema, templateDraftSchema } from './governance.js';
import type { Provider, RepoKey } from './provider.js';
import type { RepositoryAccessService } from './repository-access.js';
import { repositoryPolicyPath } from './repository-settings.js';
import { safeRef, safeSegment } from './safety.js';
import { listGovernancePresets } from './label-templates.js';
import { LABEL_PATH, validateLabelDocument } from './labels.js';

const revision = z.number().int().min(0), name = z.string().trim().min(1).max(120);
const ref = z.string().min(1).max(160).transform(safeRef);
const params = z.object({ organizationId: z.string().transform(safeSegment), objectId: z.string().optional() });
const repo = (value: unknown): RepoKey => z.object({ namespace: z.string().transform(safeSegment), repo: z.string().transform(safeSegment) }).parse(value);

/** Additional content gate for generic HTTP tools. Trusted internal services use Provider directly. */
export class GovernanceWriteGuard {
  private managedPath?: (key: RepoKey, filename: string) => Promise<boolean>;
  private assignment?: (key: RepoKey, identity: RequestIdentity, body: Record<string, unknown>) => Promise<void>;
  constructor(readonly governance: GovernanceService) {}
  setManagedPathResolver(resolver: (key: RepoKey, filename: string) => Promise<boolean>) { this.managedPath = resolver; }
  setAssignmentAuthorizer(authorizer: (key: RepoKey, identity: RequestIdentity, body: Record<string, unknown>) => Promise<void>) { this.assignment = authorizer; }
  async assertFileWrite(key: RepoKey, identity: RequestIdentity, filename: string) {
    if (/^\.oxenweb(?:\/|$)/i.test(filename) || /^(data|source|packages)\//i.test(filename) || filename === 'bundle-manifest.json' || await this.managedPath?.(key, filename)) throw new ApiError(403, 'MANAGED_DATA_WORKFLOW_REQUIRED', '此文件属于受保护的规范或数据集，请通过数据编辑、规范绑定或管理流程修改。');
  }
  async assertMergeAllowed(key: RepoKey, identity: RequestIdentity, target: string, source: string) {
    const { access, provider } = this.governance; await access.requireCapability(key, identity, 'merge.execute');
    for (const file of await provider.diff(key, target, source)) {
      if (repositoryPolicyPath(file.path)) await access.requireCapability(key, identity, 'project.admin');
      if (file.path === SCHEMA_BINDING_PATH) { await access.requireCapability(key, identity, 'schema.bind'); const state = await this.governance.snapshot(key, source);if(!state.binding)throw new ApiError(403,'SCHEMA_BINDING_INVALID','合并包含无效规范绑定。');const layers=state.binding.version===1?[state.binding]:Object.values(state.binding.layers);for(const layer of layers){if(layer.organizationId!==key.namespace)throw new ApiError(403,'SCHEMA_BINDING_INVALID','合并规范未获此项目组织授权。');const published=this.governance.publishedSnapshot(layer.organizationId,layer.templateId,layer.templateVersion);if(published.checksum!==layer.checksum)throw new ApiError(403,'SCHEMA_BINDING_INVALID','合并规范不是已发布固定版本。');} }
      if (file.path === LABEL_PATH) {
        const read = async (reference: string) => { try { return validateLabelDocument(JSON.parse((await provider.raw(key, reference, LABEL_PATH)).content.toString('utf8'))); } catch (error) { if (error instanceof ApiError && error.status === 404) return { columns: [], templateApplications: [] }; throw error; } };
        const [before, after] = await Promise.all([read(target), read(source)]);
        if (JSON.stringify(before.columns) !== JSON.stringify(after.columns) || JSON.stringify(before.templateApplications) !== JSON.stringify(after.templateApplications)) await access.requireCapability(key, identity, 'schema.manage');
      }
    }
  }
  install(app: FastifyInstance) {
    const { access, provider } = this.governance;
    access.setFileWriteAuthorizer((key, identity, filename) => this.assertFileWrite(key, identity, filename));
    app.addHook('preValidation', async request => {
      if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
      const match = /^\/api\/repos\/([^/]+)\/([^/?]+)(.*)$/.exec(request.url.split('?')[0]!); if (!match) return;
      const key = repo({ namespace: decodeURIComponent(match[1]!), repo: decodeURIComponent(match[2]!) }), tail = match[3]!, identity = requestIdentity(request);
      const body = request.body && typeof request.body === 'object' ? request.body as Record<string, unknown> : {};
      if (tail === '/labels/assignments') { await access.requireCapability(key, identity, body.scope==='dataset'?'dataset.assign':'annotation.assign'); await this.assignment?.(key, identity, body); }
      else if (tail === '/labels' || /^\/labels\/(columns|templates|migrate)(\/|$)/.test(tail)) {
        await access.requireCapability(key, identity, 'schema.manage');
        if (tail === '/labels/migrate' || request.method === 'DELETE') await access.requireCapability(key, identity, 'annotation.assign');
        if (tail === '/labels' && request.method === 'PUT') {
          const candidate = validateLabelDocument({ version: 1, columns: body.columns, assignments: Array.isArray(body.assignments) ? body.assignments.map(item => ({ ...(item as object), id: (item as { id?: string }).id ?? 'server-assigned' })) : body.assignments });
          let previous = { assignments: [] as typeof candidate.assignments };
          try { previous = validateLabelDocument(JSON.parse((await provider.raw(key, z.string().transform(safeRef).parse(body.expectedCommit), LABEL_PATH)).content.toString('utf8'))); } catch (error) { if (!(error instanceof ApiError && error.status === 404)) throw error; }
          const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])) : value;
          const content = (assignments: typeof candidate.assignments) => JSON.stringify(canonical([...assignments].sort((a,b)=>a.id.localeCompare(b.id))));
          if (content(previous.assignments.filter(item=>item.scope==='dataset')) !== content(candidate.assignments.filter(item=>item.scope==='dataset'))) await access.requireCapability(key, identity, 'dataset.assign');
          if (content(previous.assignments.filter(item=>item.scope!=='dataset')) !== content(candidate.assignments.filter(item=>item.scope!=='dataset'))) await access.requireCapability(key, identity, 'annotation.assign');
        }
      }
      else if (tail === '/table/edit') { await access.requireCapability(key, identity, 'data.edit'); await this.assertFileWrite(key, identity, z.string().parse(body.path)); }
      else if (tail === '/branches') { const permissions = await access.permissions(key, identity); if (!['data.edit', 'annotation.assign', 'tasks.manage'].some(capability => permissions.capabilities?.[capability as 'data.edit'] === true)) throw new ApiError(403, 'CAPABILITY_REQUIRED', '创建任务分支需要正文编辑、标注或任务管理能力。'); }
      else if (/^\/workspaces(\/|$)/.test(tail)) {
        await access.requireCapability(key, identity, 'data.edit');
        if (typeof body.path === 'string') await this.assertFileWrite(key, identity, body.path);
        const workspaceId = /^\/workspaces\/([^/]+)/.exec(tail)?.[1];
        if (workspaceId) { const workspace = await provider.workspace(key, decodeURIComponent(workspaceId)); for (const change of workspace.changes) await this.assertFileWrite(key, identity, change.path); }
      }
      else if (tail === '/push' && identity.kind !== 'owner') throw new ApiError(403, 'MANAGED_PUSH_REQUIRED', '通用 CLI push 仅供实例管理员维护；协作者通过任务分支与合并流程提交。');
      else if (tail === '/merge') { const source = z.string().transform(safeRef).parse(body.source), target = z.string().transform(safeRef).parse(body.target); await this.assertMergeAllowed(key, identity, target, source); }
      else if (/^\/merge-requests\/[^/]+\/merge$/.test(tail)) await this.assertMergeAllowed(key, identity, z.string().transform(safeRef).parse(body.expectedTargetCommitId), z.string().transform(safeRef).parse(body.expectedSourceCommitId));
    });
  }
}

export async function registerGovernanceRoutes(app: FastifyInstance, options: { provider: Provider; access: RepositoryAccessService; filename: string; organizations?: string[] }) {
  const governance = new GovernanceService(options.provider, options.access, options.filename); await governance.init(options.organizations);
  const writeGuard = new GovernanceWriteGuard(governance); writeGuard.install(app);
  const base = '/api/governance', orgBase = base + '/organizations/:organizationId';
  app.get(base + '/access', request => governance.accessState(requestIdentity(request)));
  app.get(base + '/identities', request => { if (requestIdentity(request).kind !== 'owner') throw new ApiError(403, 'OWNER_REQUIRED', '仅实例管理员可查看可授权身份。'); return options.access.identityDirectory(); });
  app.get(base + '/presets', async request => { if (!(await governance.accessState(requestIdentity(request))).canManage) throw new ApiError(403, 'SCHEMA_MAINTAINER_REQUIRED', '需要规范维护权限。'); return listGovernancePresets(); });
  app.post(base + '/organizations', request => { const body = z.object({ id: z.string().min(1).max(64), name }).strict().parse(request.body); return governance.createOrganization(requestIdentity(request), body.id, body.name); });
  app.get(orgBase, request => governance.directory(requestIdentity(request), params.parse(request.params).organizationId));
  app.post(orgBase+'/domains',request=>{const body=z.object({domain:domainSchema,expectedRevision:revision}).strict().parse(request.body);return governance.saveDomain(requestIdentity(request),params.parse(request.params).organizationId,body.domain,body.expectedRevision);});
  app.post(orgBase + '/maintainers', request => { const body = z.object({ identityId: z.string().uuid(), enabled: z.boolean(), expectedRevision: revision }).strict().parse(request.body); return governance.setMaintainer(requestIdentity(request), params.parse(request.params).organizationId, body.identityId, body.enabled, body.expectedRevision); });
  app.post(orgBase + '/dimensions', request => { const body = z.object({ draft: dimensionDraftSchema, expectedRevision: revision }).strict().parse(request.body); return governance.saveDimension(requestIdentity(request), params.parse(request.params).organizationId, body.draft, body.expectedRevision); });
  app.post(orgBase + '/dimensions/:objectId/publish', request => { const body = z.object({ expectedRevision: revision }).strict().parse(request.body), p = params.parse(request.params); return governance.publishDimension(requestIdentity(request), p.organizationId, p.objectId!, body.expectedRevision); });
  app.post(orgBase + '/templates', request => { const body = z.object({ draft: templateDraftSchema, expectedRevision: revision }).strict().parse(request.body); return governance.saveTemplate(requestIdentity(request), params.parse(request.params).organizationId, body.draft, body.expectedRevision); });
  app.post(orgBase + '/templates/from-preset', request => { const body = z.object({ presetId: z.string(), id: z.string().min(1).max(64), name }).strict().parse(request.body); return governance.fromPreset(requestIdentity(request), params.parse(request.params).organizationId, body.presetId, body.id, body.name); });
  app.post(orgBase+'/templates/:objectId/copy',request=>{const body=z.object({id:z.string().min(1).max(64),name,sourceVersion:z.number().int().positive()}).strict().parse(request.body),p=params.parse(request.params);return governance.copyTemplate(requestIdentity(request),p.organizationId,p.objectId!,body.sourceVersion,body.id,body.name);});
  app.post(orgBase + '/templates/:objectId/publish', request => { const body = z.object({ expectedRevision: revision }).strict().parse(request.body), p = params.parse(request.params); return governance.publishTemplate(requestIdentity(request), p.organizationId, p.objectId!, body.expectedRevision); });
  for (const kind of ['dimensions', 'templates'] as const) app.post(orgBase + '/' + kind + '/:objectId/deprecate', request => { const body = z.object({ expectedRevision: revision }).strict().parse(request.body), p = params.parse(request.params); return governance.deprecate(requestIdentity(request), p.organizationId, kind, p.objectId!, body.expectedRevision); });
  app.post(orgBase + '/feedback/:objectId/respond', request => { const body = z.object({ status: z.enum(['resolved', 'declined']), response: z.string().trim().min(1).max(2000) }).strict().parse(request.body), p = params.parse(request.params); return governance.respond(requestIdentity(request), p.organizationId, p.objectId!, body.status, body.response); });
  const projectBase = '/api/repos/:namespace/:repo/schema';
  app.get(projectBase, async request => { const key = repo(request.params); await options.access.requireCapability(key, requestIdentity(request), 'read'); const q = z.object({ ref: ref.default('main') }).parse(request.query); return governance.snapshot(key, q.ref); });
  app.get(projectBase + '/templates', request => governance.consumerTemplates(repo(request.params), requestIdentity(request)));
  app.get(projectBase + '/templates/:templateId/:version', async request => { const p = request.params as { templateId: string; version: string }; const key = repo(request.params); await options.access.requireCapability(key, requestIdentity(request), 'read'); return governance.publishedSnapshot(key.namespace, p.templateId, z.coerce.number().int().positive().parse(p.version)); });
  app.post(projectBase + '/binding', request => { const body = z.object({ ref, expectedCommit: ref, organizationId: z.string().transform(safeSegment), templateId: z.string(), templateVersion: z.number().int().positive(),layer:z.enum(['dataset','sample']).optional() }).strict().parse(request.body); return governance.bind(repo(request.params), requestIdentity(request), body); });
  const selection=z.object({organizationId:z.string().transform(safeSegment),templateId:z.string(),templateVersion:z.number().int().positive()}).strict();
  app.post(projectBase+'/layers',request=>{const body=z.object({ref,expectedCommit:ref,layers:z.object({dataset:selection.optional(),sample:selection.optional()}).strict().refine(value=>!!value.dataset||!!value.sample)}).strict().parse(request.body);return governance.bindLayers(repo(request.params),requestIdentity(request),body);});
  app.post(projectBase + '/feedback', request => { const body = z.object({ templateId: z.string().optional(), dimensionId: z.string().optional(), requestedOption: z.string().trim().min(1).max(120).optional(), reason: z.string().trim().min(1).max(2000) }).strict().parse(request.body); return governance.feedback(requestIdentity(request), repo(request.params), body); });
  return { governance, writeGuard };
}
