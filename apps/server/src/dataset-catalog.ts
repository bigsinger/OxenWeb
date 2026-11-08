import type { BranchItem, CommitItem, ProjectSchemaState, RepoSummary, RequestIdentity } from '../../../packages/shared/src/index.js';
import type { CatalogTemplateVersion, DatasetCatalogField, DatasetCatalogSummary, RepoCatalogFields, RepositoryActivity, RepositoryLocalActivity } from '../../../packages/shared/src/catalog-types.js';
import type { Provider, RepoKey } from './provider.js';
import { ApiError } from './errors.js';
import { concurrentMap } from './dataset-storage.js';
import { getBindingColumns, getBindingSnapshot } from './governance.js';
import { readDatasetLabelSummary } from './dataset-label-summary.js';
import { recordUsesActiveLayer } from './dataset-layer-compat.js';
import { PROJECT_LABEL_REF, readMainProjectKeywords } from './project-labels.js';

export interface DatasetCatalogOptions {
  provider: Provider;
  readBinding: (key: RepoKey, commitId: string) => Promise<ProjectSchemaState>;
  authorize: (key: RepoKey, identity: RequestIdentity) => Promise<void>;
  readActivity?: (key: RepoKey, identity: RequestIdentity) => Promise<RepositoryLocalActivity>;
}
export type CatalogRepoSummary = RepoSummary & RepoCatalogFields;
const repoKey = (summary: RepoSummary): RepoKey => ({ namespace: summary.namespace, repo: summary.name });
const validTime = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;
const role = (id: string, semanticKey?: string): DatasetCatalogField['role'] => {
  const stable = semanticKey ?? ({ dataset_subject: 'dataset.subject', purpose: 'dataset.purpose', source: 'dataset.source' } as Record<string, string>)[id];
  return ({ 'dataset.subject': 'subject', 'dataset.purpose': 'purpose', 'dataset.source': 'source' } as Record<string, DatasetCatalogField['role']>)[stable ?? ''];
};

/** Read-only directory metadata. No canonical rows, sample judgments, or private drafts enter the label cache. */
export class DatasetCatalogService {
  private catalogs = new Map<string, Promise<DatasetCatalogSummary>>();
  private commits = new Map<string, Promise<CommitItem>>();
  constructor(private options: DatasetCatalogOptions) {}
  private cache<T>(map: Map<string, Promise<T>>, key: string, work: () => Promise<T>) {
    let value = map.get(key);
    if (!value) {
      if (map.size >= 2000) map.delete(map.keys().next().value!);
      value = work(); map.set(key, value);
      void value.catch(() => { if (map.get(key) === value) map.delete(key); });
    }
    return value;
  }
  private async commitHeader(key: RepoKey, id: string) {
    return this.cache(this.commits, `${key.namespace}/${key.repo}@${id}`, async () => {
      const first = (await this.options.provider.commits(key, id, 1, 1))[0];
      if (!first || first.id !== id) throw new ApiError(409, 'CATALOG_HEAD_MISMATCH', '项目活动没有返回固定分支头，未使用旧时间。');
      return first;
    });
  }
  private async labels(key: RepoKey, branch: string, commitId: string): Promise<DatasetCatalogSummary> {
    const cached = await this.cache(this.catalogs, `${key.namespace}/${key.repo}@${commitId}`, async () => {
      const state = await this.options.readBinding(key, commitId);
      if (state.commitId !== commitId) throw new ApiError(409, 'CATALOG_HEAD_MISMATCH', '目录规范读取没有固定到选定提交。');
      const keywords=await readMainProjectKeywords(this.options.provider,key,commitId);
      if (state.binding?.version !== 2) return { branch, commitId, state: 'unconfigured' as const, templates: {}, fields: [], warnings: [], keywords };
      const columns = getBindingColumns(state.binding, 'dataset');
      const dataset = columns.length ? getBindingSnapshot(state.binding, 'dataset') : undefined;
      const sample = getBindingColumns(state.binding, 'row').length || getBindingColumns(state.binding, 'file').length ? getBindingSnapshot(state.binding, 'row') : undefined;
      const version = (snapshot: NonNullable<typeof dataset>, scope: 'dataset' | 'row'): CatalogTemplateVersion => ({
        organizationId: snapshot.organizationId, id: snapshot.id, name: snapshot.name, version: snapshot.version,
        checksum: snapshot.checksum, domain: snapshot.domain,
        legacy: false,
      });
      const templates = { ...(dataset ? { dataset: version(dataset, 'dataset') } : {}), ...(sample ? { sample: version(sample, 'row') } : {}) };
      if (!dataset || !columns.length) return { branch, commitId, state: 'unconfigured' as const, templates, fields: [], warnings: [], keywords };
      const summary = await readDatasetLabelSummary(this.options.provider, key, commitId);
      const sameLayer = !!summary.record && recordUsesActiveLayer(summary.record, state.binding);
      const values = sameLayer ? summary.assignment?.values ?? {} : {}, conflicts = sameLayer ? summary.conflicts : [];
      const fields: DatasetCatalogField[] = columns.map(column => {
        const conflicted = conflicts.some(item => item.scope === 'dataset' && item.columnId === column.id);
        const options = (column.options ?? []).map(option => ({ id: option.optionId ?? option.value, value: option.value, label: option.displayName ?? option.value, ...(option.deprecated ? { deprecated: true } : {}) }));
        const raw = values[column.id], selected = conflicted || raw === undefined || raw === '' ? [] : Array.isArray(raw) ? raw : [raw];
        const actual = selected.map(value => {
          if (column.type === 'text') return { id: value, value, label: value };
          const option = options.find(item => item.value === value);
          if (!option) throw new ApiError(422, 'CATALOG_LABEL_INVALID', '当前提交的数据集标签含规范未定义选项，未伪装为已标注。');
          return option;
        });
        return { key: JSON.stringify([dataset.organizationId, column.id]), organizationId: dataset.organizationId, dimensionId: column.id,
          name: column.name, description: column.description ?? '', type: column.type, options, values: actual, conflicted,
          ...(column.semanticKey ? { semanticKey: column.semanticKey } : {}), ...(role(column.id, column.semanticKey) ? { role: role(column.id, column.semanticKey) } : {}) };
      });
      return { branch, commitId, templates, fields, warnings: [], keywords, state: conflicts.some(item => item.scope === 'dataset') ? 'conflicted' as const : fields.some(field => field.values.length) ? 'ready' as const : 'unassigned' as const };
    });
    return { ...structuredClone(cached), branch };
  }
  private async activity(key: RepoKey, branches: BranchItem[], identity: RequestIdentity): Promise<RepositoryActivity> {
    let partial = false, local: RepositoryLocalActivity = {};
    try { local = await this.options.readActivity?.(key, identity) ?? {}; } catch { partial = true; }
    const createdAt = validTime(local.createdAt), localDraftAt = validTime(local.localDraftAt);
    const unique = [...new Set(branches.map(branch => branch.commitId))];
    if (unique.length > 1000) return { ...(createdAt ? { createdAt } : {}), ...(localDraftAt ? { localDraftAt } : {}), source: 'unknown', state: 'unavailable' };
    const headers = await concurrentMap(unique, async id => { try { const commit = await this.commitHeader(key, id), timestamp = validTime(commit.timestamp); if (!timestamp) partial = true; return timestamp ? { id, timestamp } : undefined; } catch { partial = true; return undefined; } }, 4);
    const newest = headers.filter((item): item is NonNullable<typeof item> => !!item).sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp) || a.id.localeCompare(b.id))[0];
    const candidates = [
      ...(newest ? [{ at: newest.timestamp, source: 'commit' as const }] : []),
      ...(createdAt ? [{ at: createdAt, source: 'created' as const }] : []),
      ...(localDraftAt ? [{ at: localDraftAt, source: 'local-draft' as const }] : []),
    ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.source.localeCompare(b.source));
    return { ...(createdAt ? { createdAt } : {}), ...(localDraftAt ? { localDraftAt } : {}), ...(newest ? { committedAt: newest.timestamp, commitId: newest.id, branch: branches.filter(branch => branch.commitId === newest.id).map(branch => branch.name).sort()[0] } : {}),
      ...(candidates[0] ? { modifiedAt: candidates[0].at } : {}), source: candidates[0]?.source ?? 'unknown', state: partial ? 'partial' : newest || createdAt || localDraftAt ? 'ready' : 'unavailable' };
  }
  async branchSummary(key: RepoKey, _reference: string, identity: RequestIdentity): Promise<DatasetCatalogSummary> {
    await this.options.authorize(key, identity);
    const commitId = (await this.options.provider.branches(key)).find(branch => branch.name === PROJECT_LABEL_REF)?.commitId;
    if (!commitId) return { branch: PROJECT_LABEL_REF, state:'unconfigured', templates:{}, fields:[], warnings:['项目没有 main 分支，未改用其他分支读取项目标签。'] };
    return this.labels(key, PROJECT_LABEL_REF, commitId);
  }
  async enrichSummary(summary: RepoSummary, identity: RequestIdentity): Promise<CatalogRepoSummary> {
    const key = repoKey(summary); await this.options.authorize(key, identity);
    let branches: BranchItem[];
    try { branches = await this.options.provider.branches(key); }
    catch { return { ...summary, updatedAt: '', catalog: { branch: PROJECT_LABEL_REF, state: 'unavailable', fields: [], templates: {}, warnings: ['暂时无法固定 main 项目标签。'] }, activity: { source: 'unknown', state: 'unavailable' } }; }
    const head = branches.find(branch => branch.name === PROJECT_LABEL_REF)?.commitId;
    const [catalog, activity] = await Promise.all([
      head ? this.labels(key, PROJECT_LABEL_REF, head).catch((): DatasetCatalogSummary => ({ branch: PROJECT_LABEL_REF, commitId: head, state: 'unavailable', fields: [], templates: {}, warnings: ['main 的项目标签暂不可用。'] })) : Promise.resolve<DatasetCatalogSummary>({ branch: PROJECT_LABEL_REF, state: 'unconfigured', fields: [], templates: {}, warnings: ['项目没有 main 分支，未改用其他分支读取项目标签。'] }),
      this.activity(key, branches, identity),
    ]);
    return { ...summary, updatedAt: activity.modifiedAt ?? '', ...(activity.createdAt ? { createdAt: activity.createdAt } : {}), catalog, activity };
  }
}
