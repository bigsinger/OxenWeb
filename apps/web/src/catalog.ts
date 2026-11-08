import type { RepoSummary } from '@oxen/shared';
import type { CatalogFilter, DatasetCatalogField, DatasetCatalogValue } from '../../../packages/shared/src/catalog-types';

export type CatalogSort = 'updated' | 'created' | 'name' | 'size';
export interface CatalogFacet {
  key: string; label: string; organizationId: string; role: 'domain' | 'subject' | 'purpose' | 'source' | 'other';
  options: Array<DatasetCatalogValue & { count: number }>; unsetCount: number;
}
export const domainLabel = (id: string) => ({ general: '通用', 'ai-safety': 'AI 安全' } as Record<string, string>)[id] ?? id;
const stableName = (repo: RepoSummary) => `${repo.namespace}/${repo.displayName??repo.name}`;
const compareName = (a: RepoSummary, b: RepoSummary) => stableName(a) < stableName(b) ? -1 : stableName(a) > stableName(b) ? 1 : 0;
const time = (value?: string) => value !== undefined && Number.isFinite(Date.parse(value)) ? Date.parse(value) : undefined;
export function activityTime(repo: RepoSummary) { return repo.activity ? repo.activity.modifiedAt : repo.updatedAt; }
export function sortCatalogRepos(repos: RepoSummary[], sort: CatalogSort) {
  return [...repos].sort((a, b) => {
    if (sort === 'name') return compareName(a, b);
    if (sort === 'size') return b.size - a.size || compareName(a, b);
    const left = time(sort === 'created' ? a.activity?.createdAt ?? a.createdAt : activityTime(a));
    const right = time(sort === 'created' ? b.activity?.createdAt ?? b.createdAt : activityTime(b));
    return left === undefined ? right === undefined ? compareName(a, b) : 1 : right === undefined ? -1 : right - left || compareName(a, b);
  });
}
function matches(repo: RepoSummary, filter: CatalogFilter) {
  const template = repo.catalog?.templates.dataset;
  if (filter.key === JSON.stringify([template?.organizationId, '@domain'])) return !!template && filter.values.includes(template.domain);
  const field = repo.catalog?.fields.find(field => field.key === filter.key);
  if (!field || field.conflicted || repo.catalog?.state === 'unavailable') return false;
  return filter.values.some(id => field.values.some(value => value.id === id)) || !!filter.unset && !field.values.length;
}
export const projectKeywordId=(value:string)=>value.trim().toLocaleLowerCase();
export function matchesProjectKeywords(repo:RepoSummary,keywords:string[]){const actual=new Set((repo.catalog?.keywords??[]).map(projectKeywordId));return keywords.every(keyword=>actual.has(projectKeywordId(keyword)));}
export function toggleProjectKeyword(keywords:string[],value:string){const id=projectKeywordId(value);if(!id)return keywords;return keywords.some(item=>projectKeywordId(item)===id)?keywords.filter(item=>projectKeywordId(item)!==id):[...keywords,value.trim()];}
export function filterCatalogRepos(repos: RepoSummary[], filters: CatalogFilter[], state = 'all',keywords:string[]=[]) {
  return repos.filter(repo => (state === 'all' || repo.catalog?.state === state) && filters.every(filter => matches(repo, filter)) && matchesProjectKeywords(repo,keywords));
}
export function catalogKeyword(repo: RepoSummary) {
  return `${repo.displayName??''} ${repo.namespace}/${repo.name} ${repo.description} ${repo.tags.join(' ')} ${(repo.catalog?.keywords??[]).join(' ')} ${(repo.catalog?.fields ?? []).flatMap(field => field.values.map(value => value.label)).join(' ')}`.toLocaleLowerCase();
}
export function primaryCatalogTags(repo: RepoSummary) {
  const order = { subject: 0, purpose: 1, source: 2 };
  return (repo.catalog?.fields ?? []).filter(field => !field.conflicted && field.type !== 'text').sort((a, b) => (a.role ? order[a.role] : 3) - (b.role ? order[b.role] : 3) || a.key.localeCompare(b.key)).flatMap(field => field.values.map(value => ({ field, value })));
}
export function catalogStateLabel(repo: RepoSummary) {
  return ({ ready: '已填写项目标签', unassigned: '尚未填写', unconfigured: '未配置项目标签模板', conflicted: '标签有分歧', unavailable: '标签暂不可用' } as Record<string, string>)[repo.catalog?.state ?? 'unavailable'];
}
export function catalogFacets(repos: RepoSummary[], filters: CatalogFilter[], state = 'all'): CatalogFacet[] {
  const groups = new Map<string, Omit<CatalogFacet, 'unsetCount'> & { fields: DatasetCatalogField[] }>();
  for (const repo of [...repos].sort(compareName)) {
    const template = repo.catalog?.templates.dataset;
    if (template) {
      const key = JSON.stringify([template.organizationId, '@domain']);
      const group = groups.get(key) ?? { key, label: '领域', organizationId: template.organizationId, role: 'domain' as const, options: [], fields: [] };
      if (!group.options.some(option => option.id === template.domain)) group.options.push({ id: template.domain, value: template.domain, label: domainLabel(template.domain), count: 0 });
      groups.set(key, group);
    }
    for (const field of repo.catalog?.fields ?? []) if (field.type!=='text') {
      const group = groups.get(field.key) ?? { key: field.key, label: field.name + (field.legacy ? ' · 兼容' : ''), organizationId: field.organizationId, role: field.role??'other' as const, options: [], fields: [] };
      for (const value of field.options) if (!group.options.some(option => option.id === value.id)) group.options.push({ ...value, count: 0 });
      group.fields.push(field); groups.set(field.key, group);
    }
  }
  const order = { domain: 0, subject: 1, purpose: 2, source: 3, other:4 };
  return [...groups.values()].map(group => {
    const otherFilters = filters.filter(filter => filter.key !== group.key), candidates = filterCatalogRepos(repos, otherFilters, state);
    return { key: group.key, label: group.label, organizationId: group.organizationId, role: group.role,
      options: group.options.map(option => ({ ...option, count: filterCatalogRepos(candidates, [{ key: group.key, values: [option.id] }]).length })),
      unsetCount: group.role === 'domain' ? 0 : filterCatalogRepos(candidates, [{ key: group.key, values: [], unset: true }]).length };
  }).sort((a, b) => order[a.role] - order[b.role] || a.organizationId.localeCompare(b.organizationId) || a.key.localeCompare(b.key));
}
