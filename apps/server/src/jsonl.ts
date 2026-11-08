import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import type { TableColumn } from '../../../packages/shared/src/index.js';
import { ApiError } from './errors.js';

export interface ParsedJsonl { rows: Record<string, unknown>[]; columns: TableColumn[]; rowIds: string[] }

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
export function rowDigest(row: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(canonical(row))).digest('hex').slice(0, 32);
}
export function stableRowIds(rows: Record<string, unknown>[]): string[] {
  const businessKeys = rows.map(row => typeof row.id === 'string' || typeof row.id === 'number' ? JSON.stringify([typeof row.id, row.id]) : undefined);
  if (businessKeys.every((key): key is string => key !== undefined) && new Set(businessKeys).size === rows.length) {
    return businessKeys.map(key => `id:${createHash('sha256').update(key).digest('hex').slice(0, 32)}`);
  }
  const counts = new Map<string, number>();
  return rows.map(row => { const digest = rowDigest(row), occurrence = counts.get(digest) ?? 0; counts.set(digest, occurrence + 1); return `row:${digest}:${occurrence}`; });
}
export function pagedRowIds(rows: Record<string, unknown>[], offset: number): string[] {
  return rows.map((row, index) => typeof row._oxen_id === 'string' || typeof row._oxen_id === 'number' ? `oxen:${row._oxen_id}` : `row:${rowDigest(row)}:index-${offset + index}`);
}
function valueType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'list';
  if (typeof value === 'object') return 'struct';
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'number') return Number.isInteger(value) ? 'i64' : 'f64';
  return 'str';
}
export function inferColumns(rows: Record<string, unknown>[]): TableColumn[] {
  const types = new Map<string, Set<string>>();
  for (const row of rows) for (const [name, value] of Object.entries(row)) { const set = types.get(name) ?? new Set<string>(); set.add(valueType(value)); types.set(name, set); }
  return [...types].map(([name, values]) => { const nonNull = [...values].filter(value => value !== 'null'); return { name, dtype: nonNull.length > 1 ? nonNull.every(value => ['i64', 'f64'].includes(value)) ? 'f64' : 'json' : nonNull[0] ?? 'null' }; });
}

export function parseJsonl(content: Buffer | string): ParsedJsonl {
  let text: string;
  try { text = typeof content === 'string' ? content : new TextDecoder('utf-8', { fatal: true }).decode(content); }
  catch { throw new ApiError(422, 'JSONL_ENCODING', 'JSONL 文件必须使用有效的 UTF-8 编码。'); }
  if (text.startsWith('\uFEFF')) text = text.slice(1);
  const rows: Record<string, unknown>[] = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (!line.trim()) continue;
    let value: unknown;
    try { value = JSON.parse(line) as unknown; }
    catch (error) {
      const message = error instanceof Error ? error.message : '';
      const position = message.match(/position\s+(\d+)/i)?.[1];
      const column = position ? Number(position) + 1 : undefined;
      throw new ApiError(422, 'JSONL_INVALID', `JSONL 第 ${index + 1} 行${column ? `、第 ${column} 列` : ''}不是有效 JSON。`, { line: index + 1, ...(column ? { column } : {}) });
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(422, 'JSONL_ROW_TYPE', `JSONL 第 ${index + 1} 行必须是 JSON 对象。`, { line: index + 1 });
    rows.push(value as Record<string, unknown>);
  }
  if (!rows.length) throw new ApiError(422, 'JSONL_EMPTY', 'JSONL 文件没有可导入的数据行。', { line: 1 });
  return { rows, columns: inferColumns(rows), rowIds: stableRowIds(rows) };
}
export function validateDataFile(filename: string, content: Buffer): void {
  // An empty JSONL stream is a legitimate zero-sample dataset; upload/import parsing still requires rows.
  if (/\.(jsonl|ndjson)$/i.test(filename) && content.length) parseJsonl(content);
}
