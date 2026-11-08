import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTabularDiff, compareTables, type TabularDiffInput } from '../src/tabular-diff.js';

const location = { namespace: 'local', repo: 'diff-check', path: 'data/records.jsonl', base: 'a'.repeat(32), head: 'b'.repeat(32), status: 'modified' as const };
const jsonl = (rows: unknown[]) => Buffer.from(rows.map(row => JSON.stringify(row)).join('\n') + '\n');

test('full 2000-row JSONL diff finds a last-page change and preserves nested types', async () => {
  const before = Array.from({ length: 2000 }, (_, id) => ({ id: `record-${id}`, label: id % 2, text: 'Structured fixture', meta: { tags: ['fixture'], enabled: true, origin: null } }));
  const after = structuredClone(before); after[1999]!.meta.tags.push('reviewed');
  const result = await buildTabularDiff({ ...location, upstream: 'http://127.0.0.1:3002', fetcher: (async () => new Response('native parser rejected nested type', { status: 500 })) as typeof fetch, readRaw: async revision => revision === location.base ? jsonl(before) : jsonl(after) });
  assert.equal(result.engine, 'local-structured'); assert.equal(result.keyColumn, 'id');
  assert.deepEqual(result.sourceRows, { before: 2000, after: 2000 });
  assert.deepEqual(result.counts, { added: 0, removed: 0, modified: 1 });
  assert.equal(result.rows[0]!.after!.id, 'record-1999');
  assert.deepEqual(result.rows[0]!.before!.meta, { tags: ['fixture'], enabled: true, origin: null });
  assert.deepEqual(result.rows[0]!.after!.meta, { tags: ['fixture', 'reviewed'], enabled: true, origin: null });
  assert.match(result.note!, /HTTP 500/);
});

test('native diff collects every page instead of showing only the first 500 changes', async () => {
  const calls: string[] = [];
  const fetcher = (async (input: URL | Request | string) => {
    const url = new URL(String(input)); calls.push(url.href); const page = Number(url.searchParams.get('page'));
    const data = Array.from({ length: page === 1 ? 500 : 1 }, (_, offset) => ({ id: (page - 1) * 500 + offset, score: 1 }));
    return Response.json({ status: 'success', compare: { diff: { tabular: { base_schema: { fields: [{ name: 'id', dtype: 'i64' }] }, head_schema: { fields: [{ name: 'id', dtype: 'i64' }, { name: 'score', dtype: 'f64' }] }, summary: { num_added_rows: 501, num_removed_rows: 0 }, added_rows_view: { data, pagination: { total_entries: 501, total_pages: 2 } }, removed_rows_view: null } } } });
  }) as typeof fetch;
  const result = await buildTabularDiff({ ...location, path: 'data/records.csv', upstream: 'http://127.0.0.1:3002', fetcher, readRaw: async () => { throw new Error('Native success must not read fallback data.'); } });
  assert.equal(result.engine, 'oxen'); assert.equal(calls.length, 2);
  assert.match(calls[0]!, /compare\/file\/a+\.\.b+\/data\/records.csv/);
  assert.equal(result.rows.length, 501); assert.equal(result.rows[500]!.after!.id, 500);
  assert.deepEqual(result.addedColumns, ['score']); assert.equal(result.counts.added, 501);
});

test('truncated native pages are rejected and compared from complete source files', async () => {
  const fetcher = (async () => Response.json({ status: 'success', compare: { diff: { tabular: { base_schema: { fields: [] }, head_schema: { fields: [] }, summary: { num_added_rows: 2, num_removed_rows: 0 }, added_rows_view: { data: [{ id: 1 }], pagination: { total_entries: 2, total_pages: 1 } } } } } })) as typeof fetch;
  const result = await buildTabularDiff({ ...location, upstream: 'http://127.0.0.1:3002', fetcher, readRaw: async revision => jsonl(revision === location.base ? [{ id: 1, value: false }] : [{ id: 1, value: true }]) });
  assert.equal(result.engine, 'local-structured'); assert.equal(result.counts.modified, 1); assert.match(result.note!, /before all changed rows/);
});

test('native JSONL results use exact complete source files and require a globally unique key for pairing', async () => {
  const native = (before: unknown[], after: unknown[]) => (async () => Response.json({ status: 'success', compare: { diff: { tabular: {
    base_schema: { fields: [{ name: 'id', dtype: 'str' }, { name: 'label', dtype: 'str' }] }, head_schema: { fields: [{ name: 'id', dtype: 'str' }, { name: 'label', dtype: 'str' }] },
    summary: { num_added_rows: after.length, num_removed_rows: before.length },
    added_rows_view: { data: after, pagination: { total_entries: after.length, total_pages: 1 } }, removed_rows_view: { data: before, pagination: { total_entries: before.length, total_pages: 1 } },
  } } } })) as typeof fetch;
  const before = [{ id: 'one', label: 'old' }, { id: 'two', label: 'unchanged' }], after = [{ id: 'one', label: 'new' }, before[1]!];
  const fetcher = native([before[0]], [after[0]]);
  const result = await buildTabularDiff({ ...location, upstream: 'http://127.0.0.1:3002', fetcher, readRaw: async revision => jsonl(revision === location.base ? before : after) });
  assert.equal(result.engine, 'local-structured'); assert.equal(result.keyColumn, 'id'); assert.deepEqual(result.counts, { added: 0, removed: 0, modified: 1 });
  assert.deepEqual(result.sourceRows, { before: 2, after: 2 }); assert.equal(result.rows[0]?.before?.label, 'old'); assert.equal(result.rows[0]?.after?.label, 'new');
  const duplicate = await buildTabularDiff({ ...location, upstream: 'http://127.0.0.1:3002', fetcher, readRaw: async revision => jsonl([...(revision === location.base ? before : after), { id: 'one', label: 'unchanged duplicate' }]) });
  assert.equal(duplicate.keyColumn, undefined); assert.deepEqual(duplicate.counts, { added: 1, removed: 1, modified: 0 });
});

test('JSONL diff never presents native struct-union nulls as source changes and preserves absent versus null', async () => {
  const before = [{ id: 'one', meta: { kept: true } }, { id: 'two', meta: { kept: true } }];
  const after = [{ id: 'one', meta: { kept: true }, review_note: null }, { id: 'two', meta: { kept: true, actual_null: null } }];
  const fetcher = (async () => Response.json({ status: 'success', compare: { diff: { tabular: {
    base_schema: { fields: [] }, head_schema: { fields: [] }, summary: { num_added_rows: 1, num_removed_rows: 1 },
    added_rows_view: { data: [{ id: 'one', meta: { kept: true, invented_null: null }, review_note: null }], pagination: { total_entries: 1, total_pages: 1 } },
    removed_rows_view: { data: [{ id: 'one', meta: { kept: true, invented_null: null } }], pagination: { total_entries: 1, total_pages: 1 } },
  } } } })) as typeof fetch;
  const result = await buildTabularDiff({ ...location, upstream: 'http://127.0.0.1:3002', fetcher, readRaw: async revision => jsonl(revision === location.base ? before : after) });
  assert.equal(result.engine, 'local-structured'); assert.equal(result.counts.modified, 2);
  const first = result.rows.find(row => row.after?.id === 'one')!, second = result.rows.find(row => row.after?.id === 'two')!;
  assert.deepEqual(first.before?.meta, { kept: true }); assert.deepEqual(first.after?.meta, { kept: true }); assert.equal(Object.hasOwn(first.before!, 'review_note'), false); assert.equal(first.after?.review_note, null);
  assert.deepEqual(second.before?.meta, { kept: true }); assert.deepEqual(second.after?.meta, { kept: true, actual_null: null });
  assert.equal(JSON.stringify(result.rows).includes('invented_null'), false); assert.match(result.note!, /原文件全量保真/);
});

test('native CSV numeric ids match exact source spelling without conflating leading zeros', async () => {
  const fetcher = (async () => Response.json({ status: 'success', compare: { diff: { tabular: {
    base_schema: { fields: [{ name: 'id', dtype: 'i64' }, { name: 'score', dtype: 'f64' }] }, head_schema: { fields: [{ name: 'id', dtype: 'i64' }, { name: 'score', dtype: 'f64' }] },
    summary: { num_added_rows: 1, num_removed_rows: 1 },
    added_rows_view: { data: [{ id: 2, score: 0.94 }], pagination: { total_entries: 1, total_pages: 1 } }, removed_rows_view: { data: [{ id: 2, score: 0.91 }], pagination: { total_entries: 1, total_pages: 1 } },
  } } } })) as typeof fetch;
  const run = (id: string) => buildTabularDiff({ ...location, path: 'data/records.csv', upstream: 'http://127.0.0.1:3002', fetcher, readRaw: async revision => Buffer.from(`id,score\n${id},${revision === location.base ? '0.91' : '0.94'}\n`) });
  const exact = await run('2'); assert.equal(exact.counts.modified, 1); assert.equal(exact.rows[0]?.after?.score, 0.94);
  const leading = await run('02'); assert.equal(leading.keyColumn, undefined); assert.equal(leading.counts.modified, 0); assert.equal(leading.counts.added, 1);
});

test('duplicate rows without a business key use multisets and column deltas preserve schema changes', () => {
  const before = { columns: [{ name: 'value', dtype: 'str' }, { name: 'old', dtype: 'i64' }], rows: [{ value: 'one' }, { value: 'one' }, { value: 'two' }] };
  const after = { columns: [{ name: 'value', dtype: 'json' }, { name: 'new', dtype: 'str' }], rows: [{ value: 'one' }, { value: 'three' }] };
  const result = compareTables(before, after);
  assert.equal(result.keyColumn, undefined); assert.deepEqual(result.counts, { added: 1, removed: 2, modified: 0 });
  assert.deepEqual(result.addedColumns, ['new']); assert.deepEqual(result.removedColumns, ['old']); assert.deepEqual(result.changedColumns, ['value']);
});

test('added or removed files do not request the absent revision', async () => {
  const added = await buildTabularDiff({ ...location, status: 'added', readRaw: async revision => { assert.equal(revision, location.head); return jsonl([{ id: 'one', value: null }]); } });
  assert.deepEqual(added.counts, { added: 1, removed: 0, modified: 0 });
  const removed = await buildTabularDiff({ ...location, status: 'removed', readRaw: async revision => { assert.equal(revision, location.base); return jsonl([{ id: 'one', value: null }]); } });
  assert.deepEqual(removed.counts, { added: 0, removed: 1, modified: 0 });
});

test('unsupported binary fallback and over-limit tables fail explicitly without a sampled diff', async () => {
  const input: TabularDiffInput = { ...location, path: 'data/records.parquet', readRaw: async () => { throw new Error('Binary content must not be interpreted as JSONL.'); } };
  await assert.rejects(() => buildTabularDiff(input), /requires a working native/);
  assert.throws(() => compareTables({ columns: [], rows: Array.from({ length: 50001 }, () => ({})) }, { columns: [], rows: Array.from({ length: 50000 }, () => ({})) }), /no sampled result/);
});

test('JSONL files above 25 MiB retain complete structured diff within the 64 MiB import bound',async()=>{
  const payload='x'.repeat(26*1024*1024);
  const before=Buffer.from(JSON.stringify({id:'large-record',text:payload,verdict:'pending'})+'\n');
  const after=Buffer.from(JSON.stringify({id:'large-record',text:payload,verdict:'reviewed'})+'\n');
  const result=await buildTabularDiff({...location,readRaw:async revision=>revision===location.base?before:after});
  assert.equal(result.counts.modified,1);assert.equal(result.rows[0]?.after?.verdict,'reviewed');
  assert.equal(result.rows[0]?.after?.text,payload);
  await assert.rejects(()=>buildTabularDiff({...location,readRaw:async()=>Buffer.alloc(64*1024*1024+1)}),/64 MiB/);
});
