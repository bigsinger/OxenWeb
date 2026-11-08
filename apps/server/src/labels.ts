import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import type { Annotation, LabelAssignment, LabelColumn, LabelDocument, LabelScope, LabelState } from '../../../packages/shared/src/index.js';
import type { Provider, RepoKey } from './provider.js';
import { ApiError } from './errors.js';
import { safeFilePath, safeRef } from './safety.js';
import { getLabelTemplate } from './label-templates.js';
import { readDatasetLabelAuthority } from './dataset-label-summary.js';
import { DATASET_FORMAT_PATH, canonicalJson, materializeLabelAssignments, optionalRaw, readLabelRecords } from './dataset-storage.js';

export const LABEL_PATH = '.oxenweb/labels.json';
const labelId = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/, '标签列 ID 须以小写字母开头，仅含小写字母、数字、下划线或短横线。');
const semanticKey = z.string().regex(/^[a-z][a-z0-9_.-]{0,95}$/);
const scopes = z.array(z.enum(['dataset', 'file', 'row'])).min(1).max(3).refine(values => new Set(values).size === values.length, '适用层级不能重复。');
export const labelColumnSchema = z.object({
  id: labelId, name: z.string().trim().min(1).max(80), type: z.enum(['single', 'multi', 'text']),
  options: z.array(z.object({ value: z.string().trim().min(1).max(120), color: z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).optional(), description: z.string().trim().max(1000).optional(), displayName:z.string().trim().min(1).max(120).optional(),optionId:z.string().min(1).max(120).optional(),deprecated:z.boolean().optional() }).strict()).max(200).optional(),
  semanticKey: semanticKey.optional(), description: z.string().trim().max(2000).optional(), scopes: scopes.optional(),
}).strict();
export const assignmentInputSchema = z.object({ scope: z.enum(['dataset', 'file', 'row']), path: z.string().max(1024).optional(), rowId: z.string().min(1).max(200).optional(), values: z.record(z.string(), z.union([z.string().max(8000), z.array(z.string().min(1).max(120)).max(200)])) }).strict();
const assignmentSchema = assignmentInputSchema.extend({ id: z.string().min(1).max(100) });
const templateApplicationSchema = z.object({ templateId: z.string().min(1).max(80), templateVersion: z.literal(1), appliedAt: z.string().datetime(), sourceCommitId: z.string().min(1).max(160), selectedKeys: z.array(semanticKey).min(1).max(100), columnIds: z.record(semanticKey, labelId) }).strict();
const documentSchema = z.object({ version: z.literal(1), columns: z.array(labelColumnSchema).max(100), assignments: z.array(assignmentSchema).max(20_000), legacyMigration: z.object({ unmatched: z.array(z.object({ id: z.string(), path: z.string(), rowId: z.string(), label: z.string(), note: z.string(), author: z.string(), updatedAt: z.string() })), migratedIds: z.array(z.string()).optional() }).optional(), templateApplications: z.array(templateApplicationSchema).max(200).optional() }).strict();
const empty = (): LabelDocument => ({ version: 1, columns: [], assignments: [] });
function scopeKey(assignment: Pick<LabelAssignment, 'scope' | 'path' | 'rowId'>): string { return JSON.stringify([assignment.scope, assignment.path ?? '', assignment.rowId ?? '']); }
export function assignmentId(assignment: Pick<LabelAssignment, 'scope' | 'path' | 'rowId'>) { return createHash('sha256').update(scopeKey(assignment)).digest('hex').slice(0, 24); }

export function validateLabelDocument(input: unknown): LabelDocument {
  const parsed = documentSchema.parse(input);
  const columns = new Map<string, LabelColumn>(), names = new Set<string>(), semanticKeys = new Set<string>();
  for (const column of parsed.columns) {
    if (columns.has(column.id) || names.has(column.name.toLocaleLowerCase()) || column.semanticKey && semanticKeys.has(column.semanticKey)) throw new ApiError(422, 'LABEL_DUPLICATE_COLUMN', '标签列的 ID、名称和语义键必须唯一。');
    columns.set(column.id, column); names.add(column.name.toLocaleLowerCase());
    if (column.semanticKey) semanticKeys.add(column.semanticKey);
    const options = column.options ?? [];
    if (column.type !== 'text' && !options.length) throw new ApiError(422, 'LABEL_OPTIONS_REQUIRED', `标签列 ${column.name} 至少需要一个选项。`);
    if (column.type === 'text' && options.length) throw new ApiError(422, 'LABEL_TEXT_OPTIONS', '文本标签列不能配置选项。');
    if (new Set(options.map(option => option.value)).size !== options.length) throw new ApiError(422, 'LABEL_DUPLICATE_OPTION', `标签列 ${column.name} 的选项值必须唯一。`);
  }
  const scopes = new Set<string>();
  for (const assignment of parsed.assignments) {
    if (assignment.scope === 'dataset' && (assignment.path !== undefined || assignment.rowId !== undefined)) throw new ApiError(422, 'LABEL_SCOPE_INVALID', '数据集标签不应包含文件路径或行 ID。');
    if (assignment.scope !== 'dataset' && !assignment.path) throw new ApiError(422, 'LABEL_PATH_REQUIRED', '文件和行标签必须指定文件路径。');
    if (assignment.path) safeFilePath(assignment.path);
    if (assignment.scope === 'file' && assignment.rowId !== undefined) throw new ApiError(422, 'LABEL_SCOPE_INVALID', '文件标签不应包含行 ID。');
    if (assignment.scope === 'row' && !assignment.rowId) throw new ApiError(422, 'LABEL_ROW_REQUIRED', '行标签必须指定稳定行 ID。');
    const key = scopeKey(assignment);
    if (scopes.has(key)) throw new ApiError(422, 'LABEL_DUPLICATE_ASSIGNMENT', '同一数据集、文件或行只能有一条标签赋值记录。');
    scopes.add(key); assignment.id = assignmentId(assignment);
    for (const [columnId, value] of Object.entries(assignment.values)) {
      const column = columns.get(columnId);
      if (!column) throw new ApiError(422, 'LABEL_UNKNOWN_COLUMN', `标签列 ${columnId} 不存在。`);
      if (column.scopes && !column.scopes.includes(assignment.scope)) throw new ApiError(422, 'LABEL_COLUMN_SCOPE', `${column.name} 不适用于${assignment.scope}层级。`);
      if (column.type === 'multi') {
        if (!Array.isArray(value)) throw new ApiError(422, 'LABEL_CARDINALITY', `${column.name} 需要字符串数组。`);
        if (new Set(value).size !== value.length) throw new ApiError(422, 'LABEL_DUPLICATE_VALUE', `${column.name} 的多选值不能重复。`);
        if (value.some(item => !column.options?.some(option => option.value === item))) throw new ApiError(422, 'LABEL_INVALID_OPTION', `${column.name} 含有未配置的选项。`);
      } else {
        if (typeof value !== 'string') throw new ApiError(422, 'LABEL_CARDINALITY', `${column.name} 只接受一个字符串值。`);
        if (column.type === 'single' && !column.options?.some(option => option.value === value)) throw new ApiError(422, 'LABEL_INVALID_OPTION', `${column.name} 含有未配置的选项。`);
      }
    }
  }
  for (const application of parsed.templateApplications ?? []) {
    if (new Set(application.selectedKeys).size !== application.selectedKeys.length || application.selectedKeys.some(key => !application.columnIds[key]) || Object.keys(application.columnIds).some(key => !application.selectedKeys.includes(key))) throw new ApiError(422, 'LABEL_TEMPLATE_PROVENANCE', '模板来源记录的语义键与列映射必须一致。');
  }
  return parsed;
}

export class LabelService {
  private chains = new Map<string, Promise<void>>();
  constructor(private provider: Provider) {}
  private legacy(key: RepoKey, reference: string) { return this.provider.legacyAnnotations ? this.provider.legacyAnnotations(key, reference) : this.provider.annotations(key, undefined, reference); }
  private lock<T>(key: RepoKey, work: () => Promise<T>): Promise<T> {
    const name = `${key.namespace}/${key.repo}`, current = (this.chains.get(name) ?? Promise.resolve()).then(work), settled = current.then(() => {}, () => {});
    this.chains.set(name, settled); void settled.then(() => { if (this.chains.get(name) === settled) this.chains.delete(name); }); return current;
  }
  async resolve(key: RepoKey, reference: string): Promise<string> {
    safeRef(reference);
    // Reference resolution must not expand a historical data import into its potentially large diff.
    if (this.provider.resolveRef) return this.provider.resolveRef(key, reference);
    const branch = (await this.provider.branches(key)).find(branch => branch.name === reference);
    return branch?.commitId ?? (await this.provider.commit(key, reference)).id;
  }
  private async branchHead(key: RepoKey, reference: string): Promise<string> {
    const branch = (await this.provider.branches(key)).find(branch => branch.name === reference);
    if (!branch) throw new ApiError(400, 'LABEL_BRANCH_REQUIRED', '保存标签必须选择一个可写分支，不能直接写入历史提交。');
    return branch.commitId;
  }
  private async expected(key: RepoKey, branch: string, expectedCommit: string) {
    const actual = await this.branchHead(key, branch);
    if (actual !== expectedCommit) throw new ApiError(409, 'LABEL_VERSION_CONFLICT', '分支已更新，请重新加载当前版本后再保存。', { expectedCommit, actualCommit: actual });
  }
  async readLegacy(key: RepoKey, reference: string): Promise<LabelState> {
    const commitId = await this.resolve(key, reference); let document = empty();
    try {
      const raw = await this.provider.raw(key, commitId, LABEL_PATH);
      try { document = validateLabelDocument(JSON.parse(raw.content.toString('utf8'))); }
      catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(422, 'LABEL_DOCUMENT_INVALID', '当前版本的 .oxenweb/labels.json 格式无效，请在 workspace 中修复。'); }
    } catch (error) { if (!(error instanceof ApiError) || error.status !== 404) throw error; }
    const legacy = await this.legacy(key, commitId);
    return { ...document, ref: reference, commitId, storagePath: LABEL_PATH, legacyCount: legacy.filter(annotation => !document.legacyMigration?.migratedIds?.includes(annotation.id)).length };
  }
  async read(key: RepoKey, reference: string): Promise<LabelState> {
    const state = await this.readLegacy(key, reference);
    const records = await readLabelRecords(this.provider, key, state.commitId);
    const authority=await readDatasetLabelAuthority(this.provider,key,state.commitId),active=authority?[...records.filter(record=>record.scope!=='dataset'),authority]:records;
    return active.length ? { ...state, assignments: materializeLabelAssignments(state, active).assignments } : state;
  }
  private async validateTargets(key: RepoKey, commitId: string, document: LabelDocument, previous: LabelDocument) {
    const files = new Map<string, Set<string> | null>();
    const retained = new Set(previous.assignments.map(scopeKey));
    for (const assignment of document.assignments) {
      if (assignment.scope === 'dataset') continue;
      // A later data commit may remove a file/row. Retain its historical labels without silently
      // deleting or rebinding them; require valid targets only for newly introduced assignments.
      if (retained.has(scopeKey(assignment))) continue;
      const filename = assignment.path!;
      if (!files.has(filename)) {
        const directory = path.posix.dirname(filename), entries = await this.provider.tree(key, commitId, directory === '.' ? '' : directory);
        if (!entries.some(entry => entry.kind === 'file' && entry.path === filename)) throw new ApiError(404, 'LABEL_FILE_NOT_FOUND', '标签目标文件在当前版本中不存在。', { path: filename });
        files.set(filename, null);
      }
      if (assignment.scope === 'row') {
        if (files.get(filename) === null) {
          const ids = new Set<string>(); let page = 1, total = 0;
          do {
            const preview = await this.provider.file(key, commitId, filename, page, 500);
            if (preview.kind !== 'table') throw new ApiError(422, 'LABEL_TABLE_REQUIRED', '行标签仅适用于表格或 JSONL 文件。');
            preview.rowIds?.forEach(id => ids.add(id)); total = preview.totalRows ?? 0;
            if (page * 500 >= total) break;
            page++;
            if (page > 200) throw new ApiError(413, 'LABEL_ROW_LIMIT', '当前标注验证最多支持每个文件 100000 行。');
          } while (true);
          files.set(filename, ids);
        }
        if (!files.get(filename)?.has(assignment.rowId!)) throw new ApiError(422, 'LABEL_ROW_NOT_FOUND', '选定行在当前文件版本中不存在，请重新加载该行。', { path: filename, rowId: assignment.rowId });
      }
    }
  }
  private async write(key: RepoKey, branch: string, expectedCommit: string, input: LabelDocument, message: string): Promise<LabelState> {
    await this.expected(key, branch, expectedCommit);
    const previous = await this.read(key, expectedCommit);
    const columns = input.columns.map(column => {
      const old = previous.columns.find(item => item.id === column.id);
      if (!old) return column;
      if (old.semanticKey && column.semanticKey && old.semanticKey !== column.semanticKey) throw new ApiError(409, 'LABEL_SEMANTIC_KEY_CONFLICT', '已绑定模板的标签列不能更换语义键；可新建自定义列。');
      return { ...(old.description !== undefined ? { description: old.description } : {}), ...(old.scopes ? { scopes: old.scopes } : {}), ...column, ...(old.semanticKey ? { semanticKey: old.semanticKey } : {}) };
    });
    let document = validateLabelDocument({ ...input, columns, ...(input.templateApplications ?? previous.templateApplications ? { templateApplications: input.templateApplications ?? previous.templateApplications } : {}) });
    if (await optionalRaw(this.provider, key, expectedCommit, DATASET_FORMAT_PATH)) {
      const sorted = (items: LabelAssignment[]) => [...items].sort((a,b) => a.id.localeCompare(b.id));
      if (canonicalJson(sorted(document.assignments)) !== canonicalJson(sorted(previous.assignments))) throw new ApiError(409, 'LABEL_DATASET_WORKBENCH_REQUIRED', '该项目已采用逐样本标注存储，请在“数据编辑”中修改赋值；旧接口不会清空或覆盖这些记录。');
      const baseline = await this.readLegacy(key, expectedCommit);
      document = { ...document, assignments: baseline.assignments };
    }
    await this.validateTargets(key, expectedCommit, document, previous);
    const workspace = await this.provider.createWorkspace(key, `Oxen Web labels ${randomUUID().slice(0, 8)}`, branch);
    let committed = false;
    try {
      if (workspace.baseCommitId && workspace.baseCommitId !== expectedCommit) throw new ApiError(409, 'LABEL_VERSION_CONFLICT', '新建 workspace 的基准版本与预期不一致，请重新加载后重试。');
      await this.expected(key, branch, expectedCommit);
      await this.provider.writeWorkspace(key, workspace.id, LABEL_PATH, Buffer.from(`${JSON.stringify(document, null, 2)}\n`));
      await this.expected(key, branch, expectedCommit);
      const commit = await this.provider.commitWorkspace(key, workspace.id, message, expectedCommit);
      committed = true;
      const state = await this.read(key, commit.id);
      return { ...state, ref: branch };
    } catch (error) {
      if (error instanceof ApiError && /CONFLICT/.test(error.code)) throw new ApiError(409, 'LABEL_VERSION_CONFLICT', '标签文件或分支已被其他写入更新，请重新加载后重试。');
      throw error;
    } finally {
      // This workspace is dedicated to the operation; on failure its staged file remains inspectable.
      if (committed) await this.provider.deleteWorkspace(key, workspace.id).catch(() => {});
    }
  }
  save(key: RepoKey, branch: string, expectedCommit: string, document: LabelDocument, message = 'Update label schema and assignments') { return this.lock(key, async () => { const previous = await this.read(key, expectedCommit); return this.write(key, branch, expectedCommit, { ...document, ...(document.legacyMigration ?? previous.legacyMigration ? { legacyMigration: document.legacyMigration ?? previous.legacyMigration } : {}) }, message); }); }
  applyTemplate(key: RepoKey, branch: string, expectedCommit: string, templateId: string, templateVersion: number, selectedKeys?: string[]): Promise<LabelState> {
    return this.lock(key, async () => {
      await this.expected(key, branch, expectedCommit);
      const template = getLabelTemplate(templateId, templateVersion);
      const requested = selectedKeys ?? template.columns.map(column => column.semanticKey);
      if (!requested.length || new Set(requested).size !== requested.length || requested.some(key => !template.columns.some(column => column.semanticKey === key))) throw new ApiError(422, 'LABEL_TEMPLATE_SELECTION', '请选择模板中存在且不重复的至少一个语义键。');
      const state = await this.read(key, expectedCommit), columns = [...state.columns], columnIds: Record<string, string> = {};
      const selected = template.columns.filter(column => requested.includes(column.semanticKey));
      for (const column of selected) {
        const existing = columns.find(item => item.semanticKey === column.semanticKey);
        if (existing) { columnIds[column.semanticKey] = existing.id; continue; }
        const collision = columns.find(item => item.id === column.id || item.name.toLocaleLowerCase() === column.name.toLocaleLowerCase());
        if (collision) throw new ApiError(409, 'LABEL_TEMPLATE_CONFLICT', `模板列“${column.name}”与现有列冲突；请先重命名现有自定义列或取消选择该列。`, { semanticKey: column.semanticKey, columnId: column.id, existingColumnId: collision.id });
        columns.push(column); columnIds[column.semanticKey] = column.id;
      }
      const applications = state.templateApplications ?? [];
      const selectedSemanticKeys = selected.map(column => column.semanticKey);
      if (columns.length === state.columns.length && selectedSemanticKeys.every(key => applications.some(application => application.templateId === template.id && application.templateVersion === template.version && application.selectedKeys.includes(key) && application.columnIds[key] === columnIds[key]))) return { ...state, ref: branch };
      return this.write(key, branch, expectedCommit, { version: 1, columns, assignments: state.assignments, ...(state.legacyMigration ? { legacyMigration: state.legacyMigration } : {}), templateApplications: [...applications, { templateId: template.id, templateVersion: template.version, appliedAt: new Date().toISOString(), sourceCommitId: expectedCommit, selectedKeys: selectedSemanticKeys, columnIds }] }, `Apply label template: ${template.name} v${template.version}`);
    });
  }
  upsertColumn(key: RepoKey, branch: string, expectedCommit: string, column: LabelColumn, message = 'Update label column') {
    return this.lock(key, async () => { await this.expected(key, branch, expectedCommit); const { columns, assignments, legacyMigration } = await this.read(key, expectedCommit); const existing = columns.findIndex(item => item.id === column.id); if (existing < 0) columns.push(column); else columns[existing] = column; return this.write(key, branch, expectedCommit, { version: 1, columns, assignments, ...(legacyMigration ? { legacyMigration } : {}) }, message); });
  }
  deleteColumn(key: RepoKey, branch: string, expectedCommit: string, columnId: string, message = 'Remove label column') {
    return this.lock(key, async () => { await this.expected(key, branch, expectedCommit); const state = await this.read(key, expectedCommit); if (!state.columns.some(column => column.id === columnId)) throw new ApiError(404, 'LABEL_COLUMN_NOT_FOUND', '标签列不存在。'); return this.write(key, branch, expectedCommit, { version: 1, columns: state.columns.filter(column => column.id !== columnId), assignments: state.assignments.map(assignment => ({ ...assignment, values: Object.fromEntries(Object.entries(assignment.values).filter(([id]) => id !== columnId)) })).filter(assignment => Object.keys(assignment.values).length), ...(state.legacyMigration ? { legacyMigration: state.legacyMigration } : {}) }, message); });
  }
  assign(key: RepoKey, branch: string, expectedCommit: string, input: Omit<LabelAssignment, 'id'>, message = 'Update dataset labels') {
    return this.lock(key, async () => { await this.expected(key, branch, expectedCommit); const state = await this.read(key, expectedCommit); const id = assignmentId(input), assignments = state.assignments.filter(item => item.id !== id); if (Object.keys(input.values).length) assignments.push({ ...input, id }); return this.write(key, branch, expectedCommit, { version: 1, columns: state.columns, assignments, ...(state.legacyMigration ? { legacyMigration: state.legacyMigration } : {}) }, message); });
  }
  migrate(key: RepoKey, branch: string, expectedCommit: string, message = 'Migrate legacy annotations into version control') {
    return this.lock(key, async () => {
      await this.expected(key, branch, expectedCommit);
      const state = await this.read(key, expectedCommit), legacy = (await this.legacy(key, expectedCommit)).filter(annotation => !state.legacyMigration?.migratedIds?.includes(annotation.id)), unmatched: Annotation[] = [];
      if (!legacy.length) throw new ApiError(409, 'LABEL_NO_LEGACY', '当前版本没有可迁移的旧标注。');
      const columns = [...state.columns];
      for (const column of [{ id: 'legacy_label', name: '旧标注标签', type: 'text' as const }, { id: 'legacy_note', name: '旧标注备注', type: 'text' as const }]) if (!columns.some(item => item.id === column.id)) columns.push(column);
      const assignments = [...state.assignments];
      for (const annotation of legacy) {
        let matched: string | undefined, page = 1;
        do {
          const preview = await this.provider.file(key, expectedCommit, annotation.path, page, 500).catch(() => null);
          if (!preview || preview.kind !== 'table') break;
          const matches = preview.rows?.map((row, i) => ({ row, id: preview.rowIds?.[i] })).filter(item => item.id === annotation.rowId || String(item.row._oxen_id ?? item.row.id ?? '') === annotation.rowId) ?? [];
          if (matches.length > 1) { matched = undefined; break; }
          if (matches.length === 1) { if (matched) { matched = undefined; break; } matched = matches[0]?.id; }
          if (page * 500 >= (preview.totalRows ?? 0) || page >= 200) break; page++;
        } while (true);
        if (!matched) { unmatched.push(annotation); continue; }
        const input: Omit<LabelAssignment, 'id'> = { scope: 'row', path: annotation.path, rowId: matched, values: { legacy_label: annotation.label, legacy_note: annotation.note } }, id = assignmentId(input), current = assignments.find(item => item.id === id);
        if (current) Object.assign(current.values, input.values); else assignments.push({ ...input, id });
      }
      return this.write(key, branch, expectedCommit, { version: 1, columns, assignments, legacyMigration: { unmatched: [...(state.legacyMigration?.unmatched ?? []), ...unmatched], migratedIds: [...new Set([...(state.legacyMigration?.migratedIds ?? []), ...legacy.map(annotation => annotation.id)])] } }, message);
    });
  }
}
