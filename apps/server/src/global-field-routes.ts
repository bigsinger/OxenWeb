import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { adoptGlobalFieldMetadata, isGlobalDatasetField, globalFieldMetadata, type GlobalFieldProjectStatus, type GlobalFieldSynchronizationResult } from '../../../packages/shared/src/global-fields.js';
import type { DatasetFieldsState } from '../../../packages/shared/src/dataset-field-types.js';
import type { RequestIdentity } from '../../../packages/shared/src/index.js';
import type { RepoKey, Provider } from './provider.js';
import type { GovernanceService } from './governance.js';
import type { DatasetFieldsService } from './dataset-fields.js';
import type { RepositoryAccessService } from './repository-access.js';
import { requestIdentity } from './auth.js';
import { globalFieldSaveSchema } from './global-field-catalog.js';
import { canonicalJson } from './dataset-storage.js';
import { safeRef, safeSegment } from './safety.js';
import { ApiError } from './errors.js';

const targetSchema = z.object({ namespace: z.string().transform(safeSegment), repo: z.string().transform(safeSegment), ref: z.string().transform(safeRef), expectedCommit: z.string().transform(safeRef) }).strict();
/** Catalog updates and explicit branch adoption are separate, revision-checked operations. */
export function registerGlobalFieldRoutes(app: FastifyInstance, options: { governance: GovernanceService; fields: DatasetFieldsService; provider: Provider; access: RepositoryAccessService }) {
  const { governance, fields, provider, access } = options;
  const manager = async (identity: RequestIdentity) => { if (!(await governance.globalFieldAccess(identity)).canManage) throw new ApiError(403, 'SCHEMA_MAINTAINER_REQUIRED', '仅管理员或指定的全局字段维护者可查看字段管理。'); };
  const catalogRevision = (expected: number) => { const catalog = governance.globalFieldCatalog(); if (catalog.revision !== expected) throw new ApiError(409, 'GLOBAL_FIELDS_REVISION_CONFLICT', '全局字段目录已变化，请重新加载后同步。'); return catalog; };
  function status(key: RepoKey, state: DatasetFieldsState): GlobalFieldProjectStatus {
    const catalog = governance.globalFieldCatalog(), desired = globalFieldMetadata(catalog), missing: string[] = [], changed: string[] = [];
    for (const id of Object.keys(desired)) {
      const current = state.configuration[id]; if (!current) { missing.push(id); continue; }
      const { width: _width, order: _order, export: _export, visible: _visible, ...rules } = current;
      const { width: _dw, order: _do, export: _de, visible: _dv, ...wanted } = desired[id]!;
      if (canonicalJson(rules) !== canonicalJson(wanted)) changed.push(id);
    }
    const retired=Object.entries(state.configuration).filter(([id,rules])=>(rules.globalField||isGlobalDatasetField(id))&&!Object.hasOwn(desired,id)).map(([id])=>id);
    return { ...key, ref: state.ref, commitId: state.commitId, catalogRevision: catalog.revision, missing, changed, retired, needsAdoption: !!(missing.length || changed.length), canAdopt: state.capabilities.edit };
  }
  app.get('/api/global-fields', async request => { const identity = requestIdentity(request); await manager(identity); return governance.globalFieldState(identity); });
  app.get('/api/global-fields/access', request => governance.globalFieldAccess(requestIdentity(request)));
  app.get('/api/global-fields/history',async request=>{await manager(requestIdentity(request));return {versions:governance.globalFieldHistory().map(({fields,...entry})=>({...entry,fieldCount:fields.length}))};});
  app.get('/api/global-fields/history/:revision',async request=>{await manager(requestIdentity(request));const {revision}=z.object({revision:z.coerce.number().int().positive()}).parse(request.params),snapshot=governance.globalFieldHistory().find(item=>item.revision===revision);if(!snapshot)throw new ApiError(404,'GLOBAL_FIELD_REVISION_NOT_FOUND','该字段目录历史版本不存在。');return snapshot;});
  app.post('/api/global-fields/maintainers',request=>{const input=z.object({identityId:z.string().uuid(),enabled:z.boolean(),expectedRevision:z.number().int().positive()}).strict().parse(request.body);return governance.setGlobalFieldMaintainer(requestIdentity(request),input.identityId,input.enabled,input.expectedRevision);});
  app.get('/api/global-fields/catalog', request => governance.globalFieldState(requestIdentity(request)));
  app.put('/api/global-fields', async request => { const input = globalFieldSaveSchema.parse(request.body); return governance.saveGlobalFields(requestIdentity(request), input.fields, input.expectedRevision); });
  app.get('/api/global-fields/projects', async request => {
    const identity = requestIdentity(request); await manager(identity); const projects: GlobalFieldProjectStatus[] = [];
    for (const repository of await provider.repos()) {
      const key = { namespace: repository.namespace, repo: repository.name };
      try { await access.requireCapability(key, identity, 'read'); const branches = await provider.branches(key), branch = branches.find(item => item.name === 'main') ?? branches.find(item => item.name === repository.defaultBranch); if (!branch) continue; const state = await fields.read(key, identity, branch.name); projects.push(status(key, state)); }
      catch (error) { if (error instanceof ApiError && ([401, 403, 404].includes(error.status) || error.code === 'DATASET_NOT_CONFIGURED')) continue; throw error; }
    }
    return { catalogRevision: governance.globalFieldCatalog().revision, projects };
  });
  const base = '/api/repos/:namespace/:repo/dataset/fields/global';
  app.get(base, async request => { const key = z.object({ namespace: z.string().transform(safeSegment), repo: z.string().transform(safeSegment) }).parse(request.params), input = z.object({ ref: z.string().transform(safeRef).default('main') }).strict().parse(request.query); return status(key, await fields.read(key, requestIdentity(request), input.ref)); });
  app.post('/api/global-fields/synchronize', async request => {
    const identity = requestIdentity(request); await governance.requireGlobalFieldAdmin(identity);
    const input = z.object({ expectedRevision: z.number().int().positive(), targets: z.array(targetSchema).min(1).max(100) }).strict().parse(request.body), catalog = catalogRevision(input.expectedRevision), results: GlobalFieldSynchronizationResult['results'] = [];
    if (new Set(input.targets.map(target => `${target.namespace}/${target.repo}/${target.ref}`)).size !== input.targets.length) throw new ApiError(422, 'GLOBAL_FIELDS_DUPLICATE_TARGET', '同步目标不能重复。');
    for (const target of input.targets) {
      const key = { namespace: target.namespace, repo: target.repo };
      try {
        catalogRevision(input.expectedRevision); const before = await fields.read(key, identity, target.ref);
        if (before.commitId !== target.expectedCommit) throw new ApiError(409, 'DATASET_VERSION_CONFLICT', '目标分支已变化。');
        const changed = status(key, before); if (!changed.needsAdoption) { results.push({ ...key, ref: target.ref, status: 'current', commitId: before.commitId }); continue; }
        const saved = await fields.save(key, identity, { ref: target.ref, expectedCommit: target.expectedCommit, fields: adoptGlobalFieldMetadata(before.configuration, catalog), message: `同步全局样本字段规范 r${catalog.revision}` });
        results.push({ ...key, ref: target.ref, status: 'updated', commitId: saved.commitId });
      } catch (error) { if (!(error instanceof ApiError)) throw error; results.push({ ...key, ref: target.ref, status: 'blocked', code: error.code }); }
    }
    return { catalogRevision: catalog.revision, results } satisfies GlobalFieldSynchronizationResult;
  });
}
