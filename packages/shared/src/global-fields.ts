import type { DatasetFieldMetadata } from './field-metadata.js';
import { fieldOptionKey } from './field-option-colors.js';

/** Local Web/BFF schema catalog; this is not an Oxen native split or row ACL. */
export const GLOBAL_DATASET_FIELD_IDS = ['split', 'quality', 'purposes', 'visibility'] as const;
export type GlobalDatasetFieldId = string;
export interface GlobalFieldOption { id: string; displayName: string; description?: string; color: string }
export interface GlobalFieldDefinition {
  id: GlobalDatasetFieldId; displayName: string; description: string;
  type: 'single' | 'multi'; options: GlobalFieldOption[];
}
export interface GlobalFieldCatalog {
  version: 1; revision: number; fields: GlobalFieldDefinition[];
  updatedAt?: string; updatedBy?: string;
}
export interface GlobalFieldAccess { canManage: boolean; canEdit: boolean; owner: boolean; maintainers: Array<{id:string;name:string}> }
export interface GlobalFieldCatalogState extends GlobalFieldAccess { catalog: GlobalFieldCatalog }
export interface GlobalFieldCatalogSave { expectedRevision: number; fields: GlobalFieldDefinition[] }
export interface GlobalFieldProjectStatus {
  namespace: string; repo: string; ref: string; commitId: string; catalogRevision: number;
  needsAdoption: boolean; missing: string[]; changed: string[]; retired: string[]; canAdopt: boolean;
}
export interface GlobalFieldSynchronizationResult {
  catalogRevision: number; results: Array<{ namespace: string; repo: string; ref: string; status: 'updated' | 'current' | 'blocked'; commitId?: string; code?: string }>;
}
export const isGlobalDatasetField = (id: string): id is GlobalDatasetFieldId => (GLOBAL_DATASET_FIELD_IDS as readonly string[]).includes(id);
export function defaultGlobalFieldCatalog(): GlobalFieldCatalog {
  return { version: 1, revision: 1, fields: [
    { id: 'split', displayName: '数据划分', description: 'train 用于训练，dev 用于开发调优，test 用于独立测试。同一划分版本内互斥；按同源组分配，避免变体跨集泄漏。', type: 'single', options: [
      { id: 'train', displayName: '训练集', color: '#2563EB' }, { id: 'dev', displayName: '开发集', color: '#D97706' }, { id: 'test', displayName: '测试集', color: '#7C3AED' }] },
    { id: 'quality', displayName: '标注质量', description: '普通表示尚未达到金标审核标准；金标表示答案、判定依据和必要证据经过严格审核，不自动代表独立性或泛化能力。', type: 'single', options: [
      { id: 'normal', displayName: '普通', color: '#64748B' }, { id: 'gold', displayName: '金标', color: '#B45309' }] },
    { id: 'purposes', displayName: '使用用途', description: '独立于数据划分的多选用途；回归、冒烟等可同时存在。实际正式评测需要冻结成员和规则版本。', type: 'multi', options: [
      { id: 'training', displayName: '训练', color: '#2563EB' }, { id: 'regression', displayName: '回归', color: '#DC2626' }, { id: 'smoke', displayName: '冒烟', color: '#D97706' }, { id: 'evaluation', displayName: '常规评测', color: '#059669' }] },
    { id: 'visibility', displayName: '访问范围', description: '访问治理声明，不是权限授予。隐藏优先放在独立私有项目；指定分享须配置接收对象及发布包权限。仅改变字段不能限制 API、原文件或历史读取。', type: 'single', options: [
      { id: 'internal', displayName: '内部', color: '#64748B' }, { id: 'hidden', displayName: '隐藏', color: '#7C3AED' }, { id: 'shared', displayName: '指定分享', color: '#0284C7' }, { id: 'public', displayName: '公开', color: '#059669' }] },
  ] };
}
export function globalFieldMetadata(catalog: GlobalFieldCatalog): Record<string, DatasetFieldMetadata> {
  return Object.fromEntries(catalog.fields.map(field => [field.id, {
    displayName: field.displayName, description: field.description, nullable: true, required: false,
    globalField: { id: field.id, revision: catalog.revision },
    ...(field.type === 'multi' ? { type: 'array' as const, items: { type: 'string' as const, enum: field.options.map(option => option.id) } } : { type: 'string' as const, enum: field.options.map(option => option.id) }),
    optionLabels: Object.fromEntries(field.options.map(option => [fieldOptionKey(option.id), option.displayName])),
    optionColors: Object.fromEntries(field.options.map(option => [fieldOptionKey(option.id), option.color.toUpperCase()])), export: true, visible: true,
  }]));
}
/** Adopt current global rules without changing project display order/width/export/visibility. */
export function adoptGlobalFieldMetadata(fields: Record<string, DatasetFieldMetadata> = {}, catalog: GlobalFieldCatalog): Record<string, DatasetFieldMetadata> {
  const next = structuredClone(fields);
  for (const [id, rules] of Object.entries(globalFieldMetadata(catalog))) {
    const current = next[id];
    next[id] = { ...rules, ...(current?.width ? { width: current.width } : {}), ...(current?.order === undefined ? {} : { order: current.order }), ...(current?.export === undefined ? {} : { export: current.export }), ...(current?.visible === undefined ? {} : { visible: current.visible }) };
  }
  return next;
}
