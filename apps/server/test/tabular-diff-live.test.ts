import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildTabularDiff } from '../src/tabular-diff.js';

test('real Oxen native CSV diff and existing 2000-row JSONL edit show complete structured differences', { skip: process.env.OXEN_TABULAR_DIFF_LIVE_TEST !== 'true', timeout: 90_000 }, async () => {
  process.loadEnvFile(path.resolve('infra/oxen/local.env'));
  const upstream = process.env.OXEN_SERVER_URL!;
  const raw = (repo: string) => async (revision: string, filename: string) => {
    const response = await fetch(`${upstream}/api/repos/local/${repo}/file/${encodeURIComponent(revision)}/${filename.split('/').map(encodeURIComponent).join('/')}`);
    assert.equal(response.status, 200); return Buffer.from(await response.arrayBuffer());
  };
  const csv = await buildTabularDiff({ namespace: 'local', repo: 'visual-search', path: 'data/labels.csv', base: '3a4f297681bfc8c85073895b2eea7df7', head: '2333994e01b76d45b2081aa8b87903de', status: 'modified', upstream, readRaw: raw('visual-search') });
  assert.equal(csv.engine, 'oxen'); assert.deepEqual(csv.counts, { added: 0, removed: 0, modified: 1 });
  assert.equal(csv.rows[0]?.after?.confidence, 0.94);
  assert.equal(csv.rows[0]?.before?.confidence, 0.91);
  const jsonl = await buildTabularDiff({ namespace: 'local', repo: 'prompt-injection-bench', path: 'data/prompt_injection_bench.jsonl', base: 'b3264dd7e12a4153bfcdbb91637dedb0', head: 'c9f41d8cad2e12c0b0d3c47495290408', status: 'modified', upstream, readRaw: raw('prompt-injection-bench') });
  assert.equal(jsonl.engine, 'local-structured');
  assert.deepEqual(jsonl.sourceRows, { before: 2000, after: 2001 });
  assert.equal(jsonl.keyColumn, 'id'); assert.deepEqual(jsonl.counts, { added: 1, removed: 0, modified: 2000 });
  const modified = jsonl.rows.find(row => row.status === 'modified')!;
  assert.ok(modified.before?.meta && typeof modified.before.meta === 'object');
  const source = (await raw('prompt-injection-bench')('b3264dd7e12a4153bfcdbb91637dedb0', 'data/prompt_injection_bench.jsonl')).toString('utf8').trim().split('\n').map(line => JSON.parse(line));
  const original = source.find(row => row.id === modified.before?.id); assert.deepEqual(modified.before, original);
  console.log(JSON.stringify({ nativeCsvEngine: csv.engine, nativeCsvCounts: csv.counts, jsonlEngine: jsonl.engine, jsonlCounts: jsonl.counts, jsonlSourceRows: jsonl.sourceRows, addedColumns: jsonl.addedColumns, completeStructuredDiff: true }));
});
