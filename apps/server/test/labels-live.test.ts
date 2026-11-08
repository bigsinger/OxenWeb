import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { loadConfig, projectRoot } from '../src/config.js';
import { parseJsonl } from '../src/jsonl.js';
import type { LabelColumn, LabelState } from '../../../packages/shared/src/index.js';

test('real 2000-row user JSONL import and versioned three-scope labels survive BFF restart and isolate branches', { skip: process.env.OXEN_LABEL_LIVE_TEST !== 'true', timeout: 180_000 }, async t => {
  assert.ok(process.env.OXEN_SAMPLE_FILE, 'Set OXEN_SAMPLE_FILE to the explicitly supplied JSONL path.');
  process.loadEnvFile(path.join(projectRoot, 'infra/oxen/local.env'));
  const content = await readFile(process.env.OXEN_SAMPLE_FILE!), original = parseJsonl(content);
  assert.equal(original.rows.length, 2000); assert.equal(original.columns.length, 14);
  const temporaryRoot = path.join(projectRoot, '.data/tests'); await mkdir(temporaryRoot, { recursive: true }); const directory = await mkdtemp(path.join(temporaryRoot, 'labels-live-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const config = loadConfig({ ...process.env, DEMO_MODE: 'false', DEMO_DATA_FILE: path.join(directory, 'state.json'), OXEN_CLI_ROOT: path.join(directory, 'clones') });
  const app = await createApp(config); t.after(() => app.close());
  const headers = { 'x-oxen-request': 'web', ...(config.token ? { authorization: `Bearer ${config.token}` } : {}) };
  const name = 'prompt-injection-bench', base = `/api/repos/local/${name}`, filename = 'data/prompt_injection_bench.jsonl';
  async function get(url: string) { const response = await app.inject({ url, headers }); assert.equal(response.statusCode, 200, response.body); return response.json(); }
  async function post(url: string, payload: unknown) { const response = await app.inject({ method: 'POST', url, headers, payload: payload as Record<string, unknown> }); assert.ok([200, 201].includes(response.statusCode), response.body); return response.json(); }
  const repos = await get('/api/repos?namespace=local');
  const exists = repos.some((repo: { name: string }) => repo.name === name);
  let importedCommit = '';
  const existingFile = exists ? await app.inject({ url: `${base}/file?ref=main&path=${encodeURIComponent(filename)}&page=1&pageSize=1`, headers }) : null;
  if (existingFile?.statusCode !== 200) {
    const expectedCommit = exists ? (await get(`${base}/branches`)).find((branch: { name: string }) => branch.name === 'main').commitId : '';
    const boundary = `oxen-user-jsonl-${Date.now()}`, fields = { namespace: 'local', repo: name, branch: 'main', path: filename, createRepository: exists ? 'false' : 'true', expectedCommit, description: '用户提供的 2000 行 prompt injection benchmark；内容仅作为数据展示。' };
    const prefix = Object.entries(fields).map(([field, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${field}"\r\n\r\n${value}\r\n`).join('') + `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="prompt_injection_bench.jsonl"\r\nContent-Type: application/x-ndjson\r\n\r\n`;
    const payload = Buffer.concat([Buffer.from(prefix), content, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const imported = await app.inject({ method: 'POST', url: '/api/import/jsonl', headers: { ...headers, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload }); assert.equal(imported.statusCode, 200, imported.body); assert.equal(imported.json().rowCount, 2000); importedCommit = imported.json().commitId;
  }
  const first = await get(`${base}/file?ref=main&path=${encodeURIComponent(filename)}&page=1&pageSize=100`), last = await get(`${base}/file?ref=main&path=${encodeURIComponent(filename)}&page=20&pageSize=100`);
  assert.equal(first.totalRows, 2000); assert.equal(last.rows.length, 100); assert.ok(JSON.stringify(last.rows[99]) === JSON.stringify(original.rows[1999]), 'The final JSONL record must retain all original values.');
  assert.ok(first.rows[0].meta && typeof first.rows[0].meta === 'object'); assert.equal(typeof first.rows[0].expected_detection, 'boolean');
  assert.equal(first.rowIds[0], original.rowIds[0]);
  const originalMain: LabelState = await get(`${base}/labels?ref=main`), branch = `label-validation-${Date.now()}`;
  await post(`${base}/branches`, { name: branch, from: 'main' });
  const columns: LabelColumn[] = [{ id: 'review_status', name: '复核状态', type: 'single', options: [{ value: '待复核', color: '#eab308' }, { value: '已复核', color: '#22c55e' }] }, { id: 'review_tags', name: '复核分类', type: 'multi', options: [{ value: 'benchmark', color: '#3b82f6' }, { value: '样本检查', color: '#8b5cf6' }] }, { id: 'review_note', name: '复核备注', type: 'text' }];
  const configured = await app.inject({ method: 'PUT', url: `${base}/labels`, headers, payload: { ref: branch, expectedCommit: originalMain.commitId, columns, assignments: [] } }); assert.equal(configured.statusCode, 200, configured.body); let state: LabelState = configured.json();
  for (const assignment of [{ scope: 'dataset', values: { review_status: '待复核', review_tags: ['benchmark'], review_note: '自动化验收：数据集级标签示例。' } }, { scope: 'file', path: filename, values: { review_tags: ['benchmark', '样本检查'], review_note: '自动化验收：文件级标签示例。' } }, { scope: 'row', path: filename, rowId: first.rowIds[0], values: { review_status: '待复核', review_note: '自动化验收：行级标签示例；不代表人工复核结论。' } }]) state = await post(`${base}/labels/assignments`, { ref: branch, expectedCommit: state.commitId, ...assignment });
  assert.equal(state.assignments.length, 3);
  const versioned = await get(`${base}/file?ref=${state.commitId}&path=.oxenweb%2Flabels.json`); assert.equal(JSON.parse(versioned.text).assignments.length, 3);
  const detail = await get(`${base}/commits/${state.commitId}`); assert.ok(detail.files.some((file: { path: string }) => file.path === '.oxenweb/labels.json'));
  const mainAfter: LabelState = await get(`${base}/labels?ref=main`); assert.ok(JSON.stringify(mainAfter.columns) === JSON.stringify(originalMain.columns)); assert.ok(JSON.stringify(mainAfter.assignments) === JSON.stringify(originalMain.assignments));
  const stale = await app.inject({ method: 'POST', url: `${base}/labels/assignments`, headers, payload: { ref: branch, expectedCommit: originalMain.commitId, scope: 'dataset', values: { review_note: 'must conflict' } } }); assert.equal(stale.statusCode, 409);
  const rowAfter = await get(`${base}/file?ref=${state.commitId}&path=${encodeURIComponent(filename)}&page=1&pageSize=100`); assert.equal(rowAfter.rowIds[0], first.rowIds[0]);
  const workspace = await post(`${base}/workspaces`, { name: `Inheritance ${Date.now()}`, branch });
  const edited = await app.inject({ method: 'PUT', url: `${base}/workspaces/${workspace.id}/files`, headers, payload: { path: 'audit/label-validation.txt', content: 'A later data commit retains versioned labels.\n' } }); assert.equal(edited.statusCode, 200, edited.body);
  const inheritedCommit = await post(`${base}/workspaces/${workspace.id}/commit`, { message: 'Verify label inheritance across later commits' });
  const inherited = await get(`${base}/labels?ref=${inheritedCommit.id}`); assert.equal(inherited.assignments.length, 3);
  const restarted = await createApp(config); t.after(() => restarted.close()); const afterRestart = await restarted.inject({ url: `${base}/labels?ref=${branch}`, headers }); assert.equal(afterRestart.statusCode, 200, afterRestart.body); assert.equal(afterRestart.json().assignments.length, 3);
  console.log(JSON.stringify({ repository: `local/${name}`, path: filename, rows: 2000, columns: 14, importedCommit, labelBranch: branch, labelCommit: state.commitId, inheritedCommit: inheritedCommit.id, scopes: ['dataset', 'file', 'row'], staleWriteRejected: true, branchIsolation: true, nestedValuesRetained: true, bffRestartRetained: true }));
});
