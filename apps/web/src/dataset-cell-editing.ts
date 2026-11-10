import type { DatasetOperation } from '../../../packages/shared/src/dataset';
import type { TableColumn } from '../../../packages/shared/src/index';

export type DatasetCellKind = 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object';
export function cellKind(value: unknown): DatasetCellKind {
  if (value === undefined) return 'string';
  return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value as DatasetCellKind;
}
export function cellEditorText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? '';
}
export function parseCellEditor(text: string, kind: DatasetCellKind): unknown {
  if (kind === 'string') return text;
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('请输入有效的 JSON 值；文字字段不需要加引号。'); }
  if (cellKind(value) !== kind || kind === 'number' && !Number.isFinite(value)) throw new Error(`请保留字段的 ${kind} 类型。`);
  return value;
}

/** Coalesce edits against the original base, including edits to a not-yet-committed append. */
export function stageDatasetRecord(operations: DatasetOperation[], rowId: string, record: Record<string, unknown>, expectedContentHash?: string): DatasetOperation[] {
  const appended = operations.find(op => op.op === 'append' && op.rowId === rowId);
  const oldUpdate = operations.find(op => op.op === 'update' && op.rowId === rowId);
  const next = operations.filter(op => !(op.op === 'update' && op.rowId === rowId));
  if (appended?.op === 'append') return next.map(op => op === appended ? { ...op, record } : op);
  return [...next, { op: 'update', rowId, record, ...(oldUpdate?.op === 'update' && oldUpdate.expectedContentHash ? { expectedContentHash: oldUpdate.expectedContentHash } : expectedContentHash ? { expectedContentHash } : {}) }];
}

export interface DatasetPageRow { id: string; data: Record<string, unknown>; isNew: boolean }
/** A saved draft page is an overlay: cancelling an append removes its displayed row too. */
export function datasetPageRows(rows: Record<string, unknown>[], rowIds: string[], operations: DatasetOperation[], savedOperations: DatasetOperation[], baseRows: Record<string, Record<string, unknown>> = {}): DatasetPageRow[] {
  const pendingAppend = new Set(operations.filter(op => op.op === 'append').map(op => op.rowId));
  const savedAppend = new Set(savedOperations.filter(op => op.op === 'append').map(op => op.rowId));
  const existing = new Set(rowIds);
  const result = rows.flatMap((row, index) => {
    const id = rowIds[index]!;
    if (savedAppend.has(id) && !pendingAppend.has(id)) return [];
    const staged = operations.find(op => (op.op === 'update' || op.op === 'append') && op.rowId === id);
    return [{ id, data: staged && (staged.op === 'update' || staged.op === 'append') ? staged.record : Object.hasOwn(baseRows,id) ? baseRows[id]! : row, isNew: false }];
  });
  for (const op of operations) if (op.op === 'append' && op.rowId && !existing.has(op.rowId) && !savedAppend.has(op.rowId)) result.push({ id: op.rowId, data: op.record, isNew: true });
  return result;
}

export function stageDatasetRemoval<T extends { rowId: string }>(operations: DatasetOperation[], rowId: string, expectedContentHash: string | undefined, editor?: T): { operations: DatasetOperation[]; editor?: T } {
  const appended = operations.some(op => op.op === 'append' && op.rowId === rowId);
  const remaining = operations.flatMap<DatasetOperation>(op => {
    if (op.op === 'evaluation') { const rowIds = op.rowIds.filter(id => id !== rowId); return rowIds.length ? [{ ...op, rowIds }] : []; }
    return 'rowId' in op && op.rowId === rowId ? [] : [op];
  });
  return { operations: appended ? remaining : [...remaining, { op: 'delete', rowId, ...(expectedContentHash ? { expectedContentHash } : {}) }], ...(editor && editor.rowId !== rowId ? { editor } : {}) };
}

export function assignableDatasetRows(rowIds: readonly string[], operations: DatasetOperation[], mayAssign: (rowId: string) => boolean): string[] {
  const removed = new Set(operations.filter(op => op.op === 'delete').map(op => op.rowId));
  return rowIds.filter(id => !removed.has(id) && mayAssign(id));
}

export function duplicateDatasetRecord(record: Record<string, unknown>, identityField: string, uuid: string): { record: Record<string, unknown>; rowId: string; regeneratedFields: string[] } {
  if (!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(uuid)) throw new Error('无法生成有效的新样本身份。');
  const copy = JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
  delete copy.__bundle_provenance;
  const regeneratedFields: string[] = [];
  for (const field of Object.keys(copy).filter(field => ['id', 'uid'].includes(field.toLowerCase()) || field === identityField)) {
    copy[field] = typeof copy[field] === 'number' ? Number.parseInt(uuid.replaceAll('-', '').slice(0, 12), 16) : `sample-${uuid}`;
    regeneratedFields.push(field);
  }
  return { record: copy, rowId: `new:${uuid}`, regeneratedFields };
}

export interface DatasetColumnLayout { kind: 'identity' | 'number' | 'boolean' | 'text' | 'structured' | 'value'; width: number }
export function datasetColumnLayout(column: TableColumn, rows: Record<string, unknown>[], identityField: string): DatasetColumnLayout {
  if (column.name === identityField || /^(?:id|uid)$/i.test(column.name) || /_id$/i.test(column.name)) return { kind: 'identity', width: 142 };
  const values = rows.slice(0, 50).map(row => row[column.name]).filter(value => value !== null && value !== undefined);
  if (values.length && values.every(value => typeof value === 'number')) return { kind: 'number', width: values.some(value => String(value).length > 10) ? 122 : 94 };
  if (values.length && values.every(value => typeof value === 'boolean')) return { kind: 'boolean', width: 88 };
  if (values.some(value => typeof value === 'object')) return { kind: 'structured', width: 272 };
  if (/^(?:text|title|description|content|prompt|question|answer|input|output|instruction|context|user_query|original_goal)$/i.test(column.name) || values.some(value => typeof value === 'string' && value.length > 90)) return { kind: 'text', width: 344 };
  return { kind: 'value', width: 158 };
}
