import type { DiffFile, TableColumn, TabularDiffRow, TabularDiffView } from '../../../packages/shared/src/index.js';
import { ApiError } from './errors.js';
import { parseJsonl, rowDigest } from './jsonl.js';
import { tableFrom } from './preview.js';
import { safeFilePath, safeRef, safeSegment } from './safety.js';

const MAX_ROWS = 100_000;
const MAX_BYTES = 25 * 1024 * 1024;
type Row = Record<string, unknown>;
type Table = { columns: TableColumn[]; rows: Row[] };
export interface TabularDiffInput {
  namespace: string; repo: string; path: string; base: string; head: string; status: DiffFile['status'];
  upstream?: string; upstreamToken?: string;
  readRaw: (revision: string, filename: string) => Promise<Buffer>;
  /** Test injection, never derived from a browser request. */
  fetcher?: typeof fetch;
}
const record = (value: unknown): Row | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : undefined;
function integer(value: unknown): number | undefined { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined; }
function schemaColumns(value: unknown): TableColumn[] {
  const schema = record(value);
  if (!Array.isArray(schema?.fields)) return [];
  return schema.fields.map(item => {
    const field = record(item);
    if (typeof field?.name !== 'string') throw new ApiError(502, 'TABULAR_DIFF_SCHEMA', 'Oxen returned an invalid tabular diff schema.');
    return { name: field.name, dtype: typeof field.dtype === 'string' ? field.dtype : 'unknown' };
  });
}
function columnChanges(before: TableColumn[], after: TableColumn[]) {
  const previous = new Map(before.map(column => [column.name, column.dtype]));
  const current = new Map(after.map(column => [column.name, column.dtype]));
  const columns = [...after, ...before.filter(column => !current.has(column.name))];
  return {
    columns,
    addedColumns: after.filter(column => !previous.has(column.name)).map(column => column.name),
    removedColumns: before.filter(column => !current.has(column.name)).map(column => column.name),
    changedColumns: after.filter(column => previous.has(column.name) && previous.get(column.name) !== column.dtype).map(column => column.name),
  };
}
async function boundedJson(response: Response): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > MAX_BYTES) { await response.body?.cancel(); throw new ApiError(413, 'TABULAR_DIFF_LIMIT', 'The native tabular diff exceeds the 25 MB response limit.'); }
  const chunks: Uint8Array[] = []; let bytes = 0;
  const reader = response.body?.getReader();
  if (reader) for (;;) {
    const item = await reader.read(); if (item.done) break;
    bytes += item.value.byteLength;
    if (bytes > MAX_BYTES) { await reader.cancel(); throw new ApiError(413, 'TABULAR_DIFF_LIMIT', 'The native tabular diff exceeds the 25 MB response limit.'); }
    chunks.push(item.value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function nativeSide(tabular: Row, side: 'added' | 'removed') {
  const view = record(tabular[`${side}_rows_view`]) ?? record(tabular[`${side}_rows`]);
  if (!view) {
    if ((integer(record(tabular.summary)?.[`num_${side}_rows`]) ?? 0) > 0) throw new ApiError(502, 'TABULAR_DIFF_INCOMPLETE', 'Oxen reported changed rows but did not return their data.');
    return { rows: [] as Row[], total: 0, pages: 1 };
  }
  if (!Array.isArray(view.data) || !view.data.every(item => record(item))) throw new ApiError(502, 'TABULAR_DIFF_ROWS', 'Oxen returned unsupported tabular diff rows.');
  const pagination = record(view.pagination);
  const summary = record(tabular.summary);
  return {
    rows: view.data as Row[],
    total: integer(pagination?.total_entries) ?? integer(summary?.[`num_${side}_rows`]) ?? view.data.length,
    pages: integer(pagination?.total_pages) ?? 1,
  };
}

async function nativeDiff(input: TabularDiffInput): Promise<TabularDiffView> {
  const origin = input.upstream!.replace(/\/$/, '');
  // services/compare.rs registers this fixed-source path. The public annotation
  // orders the path segments differently, so do not call the uncorrected route.
  const endpoint = `${origin}/api/repos/${encodeURIComponent(input.namespace)}/${encodeURIComponent(input.repo)}/compare/file/${encodeURIComponent(input.base)}..${encodeURIComponent(input.head)}/${input.path.split('/').map(encodeURIComponent).join('/')}`;
  const added: Row[] = [], removed: Row[] = [];
  let before: TableColumn[] = [], after: TableColumn[] = [];
  let addedTotal = 0, removedTotal = 0, totalPages = 1;
  for (let page = 1; page <= totalPages; page++) {
    const url = new URL(endpoint); url.searchParams.set('page', String(page)); url.searchParams.set('page_size', '500');
    const response = await (input.fetcher ?? fetch)(url, { headers: input.upstreamToken ? { Authorization: `Bearer ${input.upstreamToken}` } : {}, redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) { await response.body?.cancel(); throw new ApiError(502, 'NATIVE_TABULAR_DIFF_FAILED', `Oxen native tabular diff returned HTTP ${response.status}.`); }
    const data = record(await boundedJson(response)), compare = record(data?.compare), diff = record(compare?.diff), tabular = record(diff?.tabular);
    if (data?.status !== 'success' || !tabular) throw new ApiError(502, 'NATIVE_TABULAR_DIFF_UNAVAILABLE', 'Oxen did not return a structured tabular diff for this file.');
    const additions = nativeSide(tabular, 'added'), removals = nativeSide(tabular, 'removed');
    if (page === 1) {
      before = schemaColumns(tabular.base_schema); after = schemaColumns(tabular.head_schema);
      addedTotal = additions.total; removedTotal = removals.total;
      totalPages = Math.max(additions.pages, removals.pages, 1);
      if (addedTotal + removedTotal > MAX_ROWS || totalPages > Math.ceil(MAX_ROWS / 500) + 1) throw new ApiError(413, 'TABULAR_DIFF_LIMIT', 'The structured diff exceeds 100000 changed rows; no partial diff was returned.');
    } else if (additions.total !== addedTotal || removals.total !== removedTotal) throw new ApiError(502, 'TABULAR_DIFF_CHANGED', 'The native diff pagination changed between requests.');
    if (page <= additions.pages) added.push(...additions.rows);
    if (page <= removals.pages) removed.push(...removals.rows);
  }
  if (added.length !== addedTotal || removed.length !== removedTotal) throw new ApiError(502, 'TABULAR_DIFF_INCOMPLETE', 'Oxen diff pages ended before all changed rows were received.');
  if (/\.(jsonl|ndjson)$/i.test(input.path)) {
    // Polars unions struct fields and can insert null keys absent from the
    // actual JSONL. Compare exact source records, including absent vs null;
    // never display those normalized cells as original before/after values.
    const sources = await Promise.all([
      input.status === 'added' ? undefined : input.readRaw(input.base, input.path),
      input.status === 'removed' ? undefined : input.readRaw(input.head, input.path),
    ]);
    const result = compareTables(sources[0] ? parseTable(sources[0], input.path) : { columns: [], rows: [] }, sources[1] ? parseTable(sources[1], input.path) : { columns: [], rows: [] });
    result.note = `Oxen 原生完整差异计数为新增 ${addedTotal} 行、删除 ${removedTotal} 行。为保留 JSONL 原始嵌套结构与缺键/null区别，以下前后值和差异来自两侧原文件全量保真比较。${result.note}`;
    return result;
  }
  // A key that is unique only in the changed subset is not sufficient: an
  // unchanged duplicate elsewhere could make a fabricated "modified" pair.
  // Keep the complete native rows if the full sources cannot prove identity.
  if (input.status === 'modified' && /\.(csv|tsv)$/i.test(input.path) && added.length && removed.length) {
    try {
      const source = await Promise.all([input.readRaw(input.base, input.path), input.readRaw(input.head, input.path)]);
      const previous = parseTable(source[0], input.path), current = parseTable(source[1], input.path);
      if (previous.rows.length + current.rows.length <= MAX_ROWS) {
        const keyColumn = businessKey([previous, current]);
        if (keyColumn) {
          // CSV source cells are lossless strings; Oxen may infer numeric ids.
          // Match only their exact string spelling ("01" never matches 1).
          const csv = /\.(csv|tsv)$/i.test(input.path);
          const identity = (row: Row) => csv ? String(row[keyColumn]) : JSON.stringify([typeof row[keyColumn], row[keyColumn]]);
          const safeRows = (changed: Row[], all: Row[]) => {
            const ids = changed.map(identity), present = new Set(all.map(identity));
            return changed.every(row => typeof row[keyColumn] === 'string' || typeof row[keyColumn] === 'number' && Number.isFinite(row[keyColumn])) && new Set(ids).size === ids.length && ids.every(id => present.has(id));
          };
          if (safeRows(removed, previous.rows) && safeRows(added, current.rows)) {
            const rows = keyedRows(removed, added, identity);
            return {
              engine: 'oxen', ...columnChanges(before, after), rows, keyColumn,
              sourceRows: { before: previous.rows.length, after: current.rows.length },
              counts: rowCounts(rows),
              note: `Oxen 原生完整差异；已核对两侧完整文件中唯一的 ${keyColumn}，按该字段对齐前后记录。上游原始新增 ${addedTotal} 行、删除 ${removedTotal} 行。`,
            };
          }
        }
      }
    } catch { /* Native data is already complete; unavailable key verification must not discard it. */ }
  }
  return {
    engine: 'oxen', ...columnChanges(before, after),
    counts: { added: added.length, removed: removed.length, modified: 0 },
    rows: [...removed.map((row, index): TabularDiffRow => ({ id: `native-removed-${index}`, status: 'removed', before: row })), ...added.map((row, index): TabularDiffRow => ({ id: `native-added-${index}`, status: 'added', after: row }))],
    note: 'Oxen 原生表格差异。未指定主键时，修改的记录由上游表示为一条删除和一条新增；显示的是完整收齐的差异行。',
  };
}

function parseTable(content: Buffer, filename: string): Table {
  const sourceLimit=/\.(jsonl|ndjson)$/i.test(filename)?64*1024*1024:MAX_BYTES;
  if (content.byteLength > sourceLimit) throw new ApiError(413, 'TABULAR_DIFF_LIMIT', `A compared file exceeds the ${sourceLimit/1024/1024} MiB structured diff limit.`);
  if (/\.(jsonl|ndjson)$/i.test(filename)) return parseJsonl(content);
  const table = tableFrom(new TextDecoder('utf-8', { fatal: true }).decode(content), filename);
  if (!table) throw new ApiError(501, 'TABULAR_DIFF_FORMAT', 'This format requires a working native Oxen tabular diff.');
  return table;
}
function businessKey(tables: Table[]): string | undefined {
  if (!tables.some(table => table.rows.length)) return undefined;
  return ['_oxen_id', 'id'].find(column => tables.every(table => {
    const values = table.rows.map(row => typeof row[column] === 'string' || typeof row[column] === 'number' && Number.isFinite(row[column]) ? JSON.stringify([typeof row[column], row[column]]) : undefined);
    return values.every(value => value !== undefined) && new Set(values).size === values.length;
  }));
}
function keyedRows(before: Row[], after: Row[], identity: (row: Row) => string): TabularDiffRow[] {
  const rows: TabularDiffRow[] = [], previous = new Map(before.map(row => [identity(row), row])), current = new Set<string>();
  for (const row of after) {
    const id = identity(row); current.add(id); const old = previous.get(id);
    if (!old) rows.push({ id: `added:${id}`, status: 'added', after: row });
    else if (rowDigest(old) !== rowDigest(row)) rows.push({ id: `modified:${id}`, status: 'modified', before: old, after: row });
  }
  for (const [id, row] of previous) if (!current.has(id)) rows.push({ id: `removed:${id}`, status: 'removed', before: row });
  return rows;
}
function rowCounts(rows: TabularDiffRow[]) {
  return { added: rows.filter(row => row.status === 'added').length, removed: rows.filter(row => row.status === 'removed').length, modified: rows.filter(row => row.status === 'modified').length };
}
export function compareTables(before: Table, after: Table): TabularDiffView {
  if (before.rows.length + after.rows.length > MAX_ROWS) throw new ApiError(413, 'TABULAR_DIFF_LIMIT', 'The local structured diff exceeds 100000 input rows; no sampled result was returned.');
  const keyColumn = businessKey([before, after]), rows: TabularDiffRow[] = [];
  if (keyColumn) {
    const identity = (row: Row) => JSON.stringify([typeof row[keyColumn], row[keyColumn]]);
    rows.push(...keyedRows(before.rows, after.rows, identity));
  } else {
    const previous = new Map<string, { rows: Row[]; used: number }>();
    for (const row of before.rows) { const hash = rowDigest(row), group = previous.get(hash) ?? { rows: [], used: 0 }; group.rows.push(row); previous.set(hash, group); }
    let index = 0;
    for (const row of after.rows) {
      const hash = rowDigest(row), group = previous.get(hash);
      if (group && group.used < group.rows.length) group.used++;
      else rows.push({ id: `added:${index++}`, status: 'added', after: row });
    }
    for (const group of previous.values()) for (const row of group.rows.slice(group.used)) rows.push({ id: `removed:${index++}`, status: 'removed', before: row });
  }
  return {
    engine: 'local-structured', ...columnChanges(before.columns, after.columns), rows, ...(keyColumn ? { keyColumn } : {}),
    sourceRows: { before: before.rows.length, after: after.rows.length },
    counts: rowCounts(rows),
    note: keyColumn ? `本机全量结构化比较；使用两侧都唯一的 ${keyColumn} 对齐记录，保留嵌套值和原始类型。` : '本机全量结构化比较；没有共同唯一主键，使用记录内容与重复次数比较，修改表现为删除和新增。',
  };
}

/** Native pagination; exact original JSONL values; full text-table comparison if native parsing fails. */
export async function buildTabularDiff(input: TabularDiffInput): Promise<TabularDiffView> {
  safeSegment(input.namespace); safeSegment(input.repo); safeFilePath(input.path); safeRef(input.base); safeRef(input.head);
  let reason = '';
  if (input.upstream) {
    try { return await nativeDiff(input); }
    catch (error) {
      if (error instanceof ApiError && error.status === 413) throw error;
      reason = error instanceof ApiError ? error.message : 'Oxen native diff was unavailable.';
    }
  }
  if (!/\.(csv|tsv|jsonl|ndjson)$/i.test(input.path)) throw new ApiError(502, 'TABULAR_DIFF_UNAVAILABLE', reason || 'This file requires a working native Oxen diff.');
  const [base, head] = await Promise.all([
    input.status === 'added' ? undefined : input.readRaw(input.base, input.path),
    input.status === 'removed' ? undefined : input.readRaw(input.head, input.path),
  ]);
  const result = compareTables(base ? parseTable(base, input.path) : { rows: [], columns: [] }, head ? parseTable(head, input.path) : { rows: [], columns: [] });
  if (reason) result.note = `${reason} 使用本机保真结构化比较。${result.note}`;
  return result;
}
