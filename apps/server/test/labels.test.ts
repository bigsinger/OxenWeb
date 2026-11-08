import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { loadConfig, projectRoot } from '../src/config.js';
import { parseJsonl } from '../src/jsonl.js';
import { DemoProvider } from '../src/demo.js';
import { validateLabelDocument } from '../src/labels.js';
import type { LabelColumn, LabelState } from '../../../packages/shared/src/index.js';

const headers = { 'x-oxen-request': 'web' }, base = '/api/repos/oxen/visual-search';
const columns: LabelColumn[] = [
  { id: 'review', name: '审核', type: 'single', options: [{ value: 'pending', color: '#eab308' }, { value: 'accepted', color: '#22c55e' }] },
  { id: 'topics', name: '主题', type: 'multi', options: [{ value: 'coast' }, { value: 'forest' }] },
  { id: 'note', name: '备注', type: 'text' },
];
async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const root = path.join(projectRoot, '.data/tests'); await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'labels-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const config = loadConfig({ DEMO_MODE: 'true', DEMO_DATA_FILE: path.join(directory, 'state.json') });
  const provider = new DemoProvider(config.demoFile); const app = await createApp(config, provider); t.after(() => app.close());
  return { app, config, provider };
}

test('JSONL retains nested objects, booleans/null, blank lines and stable duplicate-row identities', () => {
  const parsed = parseJsonl('\uFEFF{"id":1,"meta":{"risk":["a"],"flag":true},"nullable":null}\n\n{"id":1,"meta":{"risk":["a"],"flag":true},"nullable":null}\n');
  assert.deepEqual(parsed.rows[0]?.meta, { risk: ['a'], flag: true });
  assert.equal(parsed.rows[0]?.nullable, null); assert.equal(parsed.rows.length, 2);
  assert.notEqual(parsed.rowIds[0], parsed.rowIds[1]);
  assert.deepEqual(parsed.rowIds, parseJsonl('{"nullable":null,"meta":{"flag":true,"risk":["a"]},"id":1}\n{"nullable":null,"meta":{"risk":["a"],"flag":true},"id":1}').rowIds);
  assert.equal(parseJsonl('{"id":"unique","value":"before"}').rowIds[0], parseJsonl('{"id":"unique","value":"after"}').rowIds[0]);
  assert.equal(parsed.columns.find(column => column.name === 'meta')?.dtype, 'struct');
  assert.throws(() => parseJsonl('{"ok":true}\n\n{"broken": }\n'), (error: unknown) => (error as { code: string; details: { line: number } }).code === 'JSONL_INVALID' && (error as { details: { line: number } }).details.line === 3);
  assert.throws(() => parseJsonl('{"ok":true}\n[1,2]'), /第 2 行必须是 JSON 对象/);
  assert.throws(() => parseJsonl(Buffer.from([0xff, 0xfe])), /UTF-8/);
});

test('versioned label schema and all three scopes persist in real repository snapshots, inherit across commits and isolate branches', async t => {
  const { app, config } = await setup(t);
  const original: LabelState = (await app.inject(`${base}/labels?ref=main`)).json();
  let response = await app.inject({ method: 'PUT', url: `${base}/labels`, headers, payload: { ref: 'main', expectedCommit: original.commitId, columns, assignments: [] } }); assert.equal(response.statusCode, 200, response.body);
  let state: LabelState = response.json(); assert.notEqual(state.commitId, original.commitId);
  await app.inject({ method: 'POST', url: `${base}/branches`, headers, payload: { name: 'labels-isolated', from: state.commitId } });
  const firstRows = (await app.inject(`${base}/file?ref=main&path=data%2Fannotations.csv&pageSize=10`)).json();
  for (const assignment of [
    { scope: 'dataset', values: { review: 'pending', note: 'Dataset note' } },
    { scope: 'file', path: 'data/annotations.csv', values: { topics: ['coast', 'forest'] } },
    { scope: 'row', path: 'data/annotations.csv', rowId: firstRows.rowIds[0], values: { review: 'accepted', topics: ['coast'], note: 'Row note' } },
  ]) {
    response = await app.inject({ method: 'POST', url: `${base}/labels/assignments`, headers, payload: { ref: 'main', expectedCommit: state.commitId, ...assignment } }); assert.equal(response.statusCode, 200, response.body); state = response.json();
  }
  assert.equal(state.assignments.length, 3);
  const file = await app.inject(`${base}/file?ref=${state.commitId}&path=.oxenweb%2Flabels.json`); assert.equal(file.statusCode, 200, file.body); assert.equal(JSON.parse(file.json().text).assignments.length, 3);
  const detail = (await app.inject(`${base}/commits/${state.commitId}`)).json(); assert.ok(detail.files.some((file: { path: string }) => file.path === '.oxenweb/labels.json'));
  assert.equal((await app.inject(`${base}/labels?ref=${original.commitId}`)).json().columns.length, 0);
  assert.equal((await app.inject(`${base}/labels?ref=labels-isolated`)).json().assignments.length, 0);
  const stale = await app.inject({ method: 'POST', url: `${base}/labels/assignments`, headers, payload: { ref: 'main', expectedCommit: original.commitId, scope: 'dataset', values: { note: 'stale' } } }); assert.equal(stale.statusCode, 409); assert.equal(stale.json().error.code, 'LABEL_VERSION_CONFLICT');
  const unrelated = (await app.inject({ method: 'POST', url: `${base}/workspaces`, headers, payload: { name: 'unrelated', branch: 'main' } })).json();
  await app.inject({ method: 'PUT', url: `${base}/workspaces/${unrelated.id}/files`, headers, payload: { path: 'unrelated.txt', content: 'This unrelated data commit must retain labels.' } });
  const unrelatedCommit = (await app.inject({ method: 'POST', url: `${base}/workspaces/${unrelated.id}/commit`, headers, payload: { message: 'Unrelated content' } })).json();
  assert.equal((await app.inject(`${base}/labels?ref=${unrelatedCommit.id}`)).json().assignments.length, 3);
  const restarted = await createApp(config); t.after(() => restarted.close());
  const afterRestart: LabelState = (await restarted.inject(`${base}/labels?ref=main`)).json(); assert.equal(afterRestart.assignments.length, 3);
  const afterRows = (await restarted.inject(`${base}/file?ref=main&path=data%2Fannotations.csv&pageSize=10`)).json(); assert.deepEqual(afterRows.rowIds, firstRows.rowIds);
});

test('label constraints reject invalid scope, options/cardinality and concurrent stale writes', async t => {
  const { app } = await setup(t);
  const initial = (await app.inject(`${base}/labels?ref=main`)).json();
  const saved = await app.inject({ method: 'PUT', url: `${base}/labels`, headers, payload: { ref: 'main', expectedCommit: initial.commitId, columns, assignments: [] } }); let state = saved.json();
  for (const values of [{ review: ['accepted'] }, { topics: 'coast' }, { review: 'not-a-configured-option' }, { topics: ['coast', 'coast'] }, { missing: 'column' }]) {
    const response = await app.inject({ method: 'POST', url: `${base}/labels/assignments`, headers, payload: { ref: 'main', expectedCommit: state.commitId, scope: 'dataset', values } }); assert.equal(response.statusCode, 422, response.body);
  }
  const requests = await Promise.all(['one', 'two'].map(note => app.inject({ method: 'POST', url: `${base}/labels/assignments`, headers, payload: { ref: 'main', expectedCommit: state.commitId, scope: 'dataset', values: { note } } })));
  assert.deepEqual(requests.map(response => response.statusCode).sort(), [200, 409]);
  state = (await app.inject(`${base}/labels?ref=main`)).json(); assert.equal(state.assignments.length, 1);
  const unknownRow = await app.inject({ method: 'POST', url: `${base}/labels/assignments`, headers, payload: { ref: 'main', expectedCommit: state.commitId, scope: 'row', path: 'data/annotations.csv', rowId: 'not-an-existing-row', values: { note: 'wrong target' } } }); assert.equal(unknownRow.statusCode, 422);
  assert.throws(() => validateLabelDocument({ version: 1, columns, assignments: [{ id: 'x', scope: 'dataset', path: 'README.md', values: {} }] }), /数据集标签不应包含/);
});

test('JSONL uploads validate before staging and return physical line numbers', async t => {
  const { app } = await setup(t);
  const workspace = (await app.inject({ method: 'POST', url: `${base}/workspaces`, headers, payload: { name: 'jsonl-validation', branch: 'main' } })).json();
  const rejected = await app.inject({ method: 'PUT', url: `${base}/workspaces/${workspace.id}/files`, headers, payload: { path: 'invalid.jsonl', content: '{"id":1}\n\n{"id":}\n' } });
  assert.equal(rejected.statusCode, 422); assert.equal(rejected.json().error.details.line, 3);
  assert.equal((await app.inject(`${base}/workspaces/${workspace.id}`)).json().changes.length, 0);
  const boundary = 'oxen-jsonl-validation';
  const content = Array.from({ length: 2000 }, (_, index) => JSON.stringify({ id: index, meta: { nested: [true, null, { value: index }] }, text: 'untrusted record content' })).join('\n');
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="records.jsonl"\r\nContent-Type: application/x-ndjson\r\n\r\n${content}\r\n--${boundary}--\r\n`;
  const checked = await app.inject({ method: 'POST', url: '/api/import/jsonl/validate', headers: { ...headers, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body });
  assert.equal(checked.statusCode, 200, checked.body); assert.equal(checked.json().rowCount, 2000);
  const fields = [['namespace', 'oxen'], ['repo', 'imported-jsonl'], ['createRepository', 'true'], ['path', 'data/records.jsonl']].map(([name, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`).join('');
  const imported = await app.inject({ method: 'POST', url: '/api/import/jsonl', headers: { ...headers, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: fields + body });
  assert.equal(imported.statusCode, 200, imported.body); assert.equal(imported.json().rowCount, 2000);
  const page = (await app.inject('/api/repos/oxen/imported-jsonl/file?ref=main&path=data%2Frecords.jsonl&page=4&pageSize=500')).json(); assert.equal(page.rows.length, 500); assert.equal(page.rows[499].id, 1999); assert.deepEqual(page.rows[499].meta, { nested: [true, null, { value: 1999 }] });
  assert.equal(page.totalRows, 2000); assert.equal(page.rowIds.length, 500);
});

test('legacy sidecar annotations remain migratable after later commits and are committed into the label document', async t => {
  const { app, provider } = await setup(t), key = { namespace: 'oxen', repo: 'visual-search' };
  await provider.annotate(key, { path: 'data/annotations.csv', rowId: '1', label: 'old-label', note: 'historical sidecar note' }, 'main');
  const original = (await app.inject(`${base}/labels?ref=main`)).json(); assert.equal(original.legacyCount, 1);
  const configured = (await app.inject({ method: 'PUT', url: `${base}/labels`, headers, payload: { ref: 'main', expectedCommit: original.commitId, columns, assignments: [] } })).json();
  assert.equal(configured.legacyCount, 1);
  const migrated = await app.inject({ method: 'POST', url: `${base}/labels/migrate`, headers, payload: { ref: 'main', expectedCommit: configured.commitId } });
  assert.equal(migrated.statusCode, 200, migrated.body);
  assert.equal(migrated.json().assignments[0].values.legacy_label, 'old-label');
  assert.equal(migrated.json().legacyMigration.unmatched.length, 0);
  assert.equal(migrated.json().legacyCount, 0);
  const raw = await provider.raw(key, migrated.json().commitId, '.oxenweb/labels.json'); assert.equal(JSON.parse(raw.content.toString()).assignments[0].values.legacy_note, 'historical sidecar note');
});

test('unique business IDs retain row labels after edits; removed row labels remain recoverable without blocking other label saves', async t => {
  const { app, provider } = await setup(t);
  async function writeFile(content: string) {
    // Simulate imported historical snapshots directly. The HTTP workspace route now intentionally
    // rejects managed-baseline replacement; current user edits are covered by dataset.test.ts.
    const key = { namespace: 'oxen', repo: 'visual-search' }, workspace = await provider.createWorkspace(key, 'Historical fixture', 'main');
    await provider.writeWorkspace(key, workspace.id, 'data/ids.jsonl', Buffer.from(content));
    await provider.commitWorkspace(key, workspace.id, 'Historical source snapshot');
    await provider.deleteWorkspace(key, workspace.id);
  }
  await writeFile('{"id":"first","text":"before"}\n{"id":"second","text":"other"}\n');
  const originalRows = (await app.inject(`${base}/file?ref=main&path=data%2Fids.jsonl`)).json();
  let state = (await app.inject(`${base}/labels?ref=main`)).json();
  state = (await app.inject({ method: 'PUT', url: `${base}/labels`, headers, payload: { ref: 'main', expectedCommit: state.commitId, columns, assignments: [] } })).json();
  const assigned = await app.inject({ method: 'POST', url: `${base}/labels/assignments`, headers, payload: { ref: 'main', expectedCommit: state.commitId, scope: 'row', path: 'data/ids.jsonl', rowId: originalRows.rowIds[0], values: { note: 'Keep the annotation' } } }); assert.equal(assigned.statusCode, 200, assigned.body);
  await writeFile('{"id":"second","text":"other"}\n{"id":"first","text":"edited after annotation"}\n');
  const editedRows = (await app.inject(`${base}/file?ref=main&path=data%2Fids.jsonl`)).json(); assert.equal(editedRows.rowIds[1], originalRows.rowIds[0]);
  await writeFile('{"id":"second","text":"other"}\n');
  state = (await app.inject(`${base}/labels?ref=main`)).json();
  const updated = await app.inject({ method: 'POST', url: `${base}/labels/assignments`, headers, payload: { ref: 'main', expectedCommit: state.commitId, scope: 'dataset', values: { note: 'Other labels remain editable' } } }); assert.equal(updated.statusCode, 200, updated.body);
  assert.ok(updated.json().assignments.some((assignment: { rowId: string }) => assignment.rowId === originalRows.rowIds[0]));
});
