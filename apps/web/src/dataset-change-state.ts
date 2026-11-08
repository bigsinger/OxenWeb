import type { DatasetDraftDiff, DatasetLabelRecord, DatasetOperation, DatasetSpan, DatasetStep } from '../../../packages/shared/src/dataset';

export interface DatasetValueState { present: boolean; value?: unknown }
export interface DatasetCellChange { before: DatasetValueState; after: DatasetValueState }
export interface DatasetRowChange { kind: 'update' | 'append' | 'delete' | 'labels'; cells: Record<string, DatasetCellChange>; labels?: { before: unknown; after: unknown }; commitId?: string }
export type DatasetChanges = Record<string, DatasetRowChange>;
export function normalizedDatasetValue(value: unknown): unknown {
  return Array.isArray(value) ? value.map(normalizedDatasetValue) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, normalizedDatasetValue(item)])) : value;
}
export const sameDatasetValue = (a: unknown, b: unknown) => Object.is(a,b) || JSON.stringify(normalizedDatasetValue(a)) === JSON.stringify(normalizedDatasetValue(b));
export function datasetValueState(record: Record<string, unknown> | undefined, field: string): DatasetValueState {
  return record && Object.hasOwn(record, field) ? { present: true, value: record[field] } : { present: false };
}
export function changedDatasetCells(before?: Record<string, unknown>, after?: Record<string, unknown>): Record<string, DatasetCellChange> {
  return Object.fromEntries([...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].flatMap(field => {
    const a = datasetValueState(before, field), b = datasetValueState(after, field);
    return a.present !== b.present || !sameDatasetValue(a.value, b.value) ? [[field, { before: a, after: b }]] : [];
  }));
}
function annotation(record?: DatasetLabelRecord, operation?: Extract<DatasetOperation, { op: 'assign' }>) {
  const values = Object.fromEntries(Object.entries({ ...record?.values, ...operation?.values }).filter(([, value]) => value !== null && value !== undefined));
  return { values, spans: operation?.spans ?? record?.spans ?? [], steps: operation?.steps ?? record?.steps ?? [] };
}
interface DatasetChangeBase { rows: Record<string, Record<string, unknown>>; knownRows: ReadonlySet<string>; labels: Record<string, DatasetLabelRecord>; files?: Record<string, DatasetLabelRecord>; knownFiles?: ReadonlySet<string>; attachmentRows?: (path: string) => string[] }
/** Normalize semantic no-ops, retaining operations whose base has not been loaded. */
export function pruneDatasetNoops(operations: DatasetOperation[], base: DatasetChangeBase): DatasetOperation[] {
  const appended = new Set(operations.filter(op => op.op === 'append').map(op => op.rowId));
  return operations.filter(op => {
    if (op.op === 'update' && base.rows[op.rowId] && !appended.has(op.rowId)) return !sameDatasetValue(base.rows[op.rowId], op.record);
    if (op.op === 'assign' && op.scope === 'row' && op.rowId && (base.knownRows.has(op.rowId) || appended.has(op.rowId))) return !sameDatasetValue(annotation(base.labels[op.rowId]), annotation(base.labels[op.rowId], op));
    if (op.op === 'assign' && op.scope === 'file' && op.path && base.knownFiles?.has(op.path)) return !sameDatasetValue(annotation(base.files?.[op.path]), annotation(base.files?.[op.path], op));
    return true;
  });
}
/** Stage fine annotations atomically: unchanged row values must not prune new spans first. */
export function stageDatasetFineAnnotations(operations: DatasetOperation[], rowId: string, values: Record<string, string | string[] | null>, spans: DatasetSpan[], steps: DatasetStep[], base: DatasetChangeBase): DatasetOperation[] {
  const remaining = operations.filter(op => !(op.op === 'assign' && op.scope === 'row' && op.rowId === rowId));
  return pruneDatasetNoops([...remaining, { op: 'assign', scope: 'row', rowId, values, spans, steps }], base);
}
function addRowChange(result: DatasetChanges, id: string, change: DatasetRowChange) {
  const old = result[id];
  result[id] = { ...old, ...change, kind: change.kind === 'labels' && old ? old.kind : change.kind, cells: { ...old?.cells, ...change.cells }, labels: change.labels ?? old?.labels };
}
export function pendingDatasetChanges(operations: DatasetOperation[], base: DatasetChangeBase): DatasetChanges {
  const result: DatasetChanges = Object.create(null);
  for (const op of pruneDatasetNoops(operations, base)) {
    if (op.op === 'update') addRowChange(result, op.rowId, { kind: 'update', cells: base.rows[op.rowId] ? changedDatasetCells(base.rows[op.rowId], op.record) : {} });
    else if (op.op === 'append' && op.rowId) addRowChange(result, op.rowId, { kind: 'append', cells: changedDatasetCells(undefined, op.record) });
    else if (op.op === 'delete') addRowChange(result, op.rowId, { kind: 'delete', cells: changedDatasetCells(base.rows[op.rowId], undefined) });
    else if (op.op === 'assign' && op.scope === 'row' && op.rowId) addRowChange(result, op.rowId, { kind: 'labels', cells: {}, labels: { before: annotation(base.labels[op.rowId]), after: annotation(base.labels[op.rowId], op) } });
    else if (op.op === 'assign' && op.scope === 'file' && op.path) for (const id of base.attachmentRows?.(op.path) ?? []) addRowChange(result, id, { kind: 'labels', cells: {}, labels: { before: annotation(base.files?.[op.path]), after: annotation(base.files?.[op.path], op) } });
  }
  return result;
}
/** Called only after a successful commit, using its exact pre-commit diff. */
export function committedDatasetChanges(previous: DatasetChanges, diff: DatasetDraftDiff, commitId: string, attachmentRows: (path: string) => string[] = () => []): DatasetChanges {
  const result: DatasetChanges = Object.assign(Object.create(null),previous);
  for (const change of diff.changes) {
    if (['append', 'update', 'delete'].includes(change.op) && change.rowId) {
      const before = change.before as Record<string, unknown> | undefined, after = change.after as Record<string, unknown> | undefined, cells = changedDatasetCells(before, after);
      if (Object.keys(cells).length || change.op !== 'update') addRowChange(result, change.rowId, { kind: change.op as 'append' | 'update' | 'delete', cells, commitId });
    } else if (change.op === 'assign') {
      const ids = change.scope === 'row' && change.rowId ? [change.rowId] : change.scope === 'file' && change.path ? attachmentRows(change.path) : [];
      for (const id of ids) addRowChange(result, id, { kind: 'labels', cells: {}, labels: { before: change.before, after: change.after }, commitId });
    }
  }
  return result;
}
export function datasetSourcePreview(value:unknown,limit=600):string{
  let shortened=false,nodes=0;
  const sample=(item:unknown,depth:number):unknown=>{
    if(++nodes>40||depth>4){shortened=true;return '…';}
    if(typeof item==='string'){if(item.length>limit){shortened=true;return item.slice(0,limit);}return item;}
    if(Array.isArray(item)){if(item.length>8)shortened=true;return item.slice(0,8).map(entry=>sample(entry,depth+1));}
    if(item&&typeof item==='object'){const result:Record<string,unknown>=Object.create(null);let count=0;for(const key in item){if(!Object.hasOwn(item,key))continue;if(count++>=12){shortened=true;break;}result[key]=sample((item as Record<string,unknown>)[key],depth+1);}return result;}
    return item;
  };
  const selected=sample(value,0);let text=typeof value==='string'?String(selected):JSON.stringify(selected)??'';
  if(text.length>limit){shortened=true;text=text.slice(0,limit);}
  return text+(shortened?'…（已省略，详情可完整查看）':'');
}
export function datasetChangeValueText(state: DatasetValueState): string {
  return !state.present ? '（未提供）' : state.value === null ? 'null' : typeof state.value === 'string' ? JSON.stringify(datasetSourcePreview(state.value,400)) : datasetSourcePreview(state.value,400);
}
