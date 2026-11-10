import { z } from 'zod';
import type { GlobalFieldDefinition } from '../../../packages/shared/src/global-fields.js';
import { ApiError } from './errors.js';

const reserved = new Set(['constructor','prototype','id','uid','label','labels','truth','ground_truth','expected','expected_label']);
const fieldId = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/).refine(value => !reserved.has(value), '身份、源真值及对象保留名称不能用作全局字段。');
const optionSchema = z.object({ id: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/), displayName: z.string().trim().min(1).max(120), description: z.string().trim().max(1000).optional(), color: z.string().regex(/^#[0-9a-f]{6}$/i) }).strict();
export const globalFieldDefinitionSchema = z.object({ id: fieldId, displayName: z.string().trim().min(1).max(120), description: z.string().trim().max(4000), type: z.enum(['single', 'multi']), options: z.array(optionSchema).min(1).max(200) }).strict();
const fieldsSchema = z.array(globalFieldDefinitionSchema).max(200).refine(fields => Buffer.byteLength(JSON.stringify(fields)) <= 2 * 1024 * 1024, '字段目录不能超过2MiB。');
export const globalFieldCatalogSchema = z.object({ version: z.literal(1), revision: z.number().int().positive(), fields: fieldsSchema, updatedAt: z.string().datetime().optional(), updatedBy: z.string().max(160).optional() }).strict();
export const globalFieldSaveSchema = z.object({ expectedRevision: z.number().int().positive(), fields: fieldsSchema }).strict();

/** Catalog revisions never rewrite pinned project definitions or existing raw values. */
export function validateGlobalFieldDefinitions(fields: GlobalFieldDefinition[]) {
  fieldsSchema.parse(fields);
  if (new Set(fields.map(field => field.id)).size !== fields.length) throw new ApiError(422, 'GLOBAL_FIELD_DUPLICATE', '全局字段 ID 不能重复。');
  for (const field of fields) if (new Set(field.options.map(option => option.id)).size !== field.options.length) throw new ApiError(422, 'GLOBAL_FIELD_OPTION_DUPLICATE', '同一字段的选项 ID 不能重复。');
}
