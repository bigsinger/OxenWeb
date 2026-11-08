import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, mkdir, rm, stat } from 'node:fs/promises';
import { createApp } from '../src/app.js';
import { loadConfig, projectRoot } from '../src/config.js';
import { assertRemote } from '../src/managed-cli.js';

test('live Oxen 0.67 integration: previews, CLI workspace commit, merge/push, query and persistent extensions', { skip: process.env.OXEN_LIVE_TEST !== 'true', timeout: 180_000 }, async t => {
  process.loadEnvFile(path.join(projectRoot, 'infra/oxen/local.env'));
  const root = path.join(projectRoot, '.data/tests');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'live-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = loadConfig({ ...process.env, DEMO_MODE: 'false', DEMO_DATA_FILE: path.join(directory, 'state.json'), OXEN_CLI_ROOT: path.join(directory, 'clones') });
  const app = await createApp(config); t.after(() => app.close());
  const headers = { 'x-oxen-request': 'web', ...(config.token ? { authorization: `Bearer ${config.token}` } : {}) };
  const base = '/api/repos/local/visual-search';
  async function get(url: string) { const result = await app.inject({ url, headers }); assert.equal(result.statusCode, 200, `${url}: ${result.body}`); return result.json(); }
  async function post(url: string, payload: unknown) { const result = await app.inject({ method: 'POST', url, headers, payload: payload as Record<string, unknown> }); assert.ok(result.statusCode === 200 || result.statusCode === 201, `${url}: ${result.body}`); return result.json(); }
  async function waitJob(job: { id: string; status: string; error?: string; output?: string }) {
    for (let attempt = 0; attempt < 240 && ['queued', 'running'].includes(job.status); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 250));
      job = await get(`/api/jobs/${job.id}`);
    }
    assert.equal(job.status, 'succeeded', JSON.stringify(job)); return job;
  }
  assert.equal((await get('/api/status')).ready, true);
  const repositories = await get('/api/repos');
  const repository = repositories.find((item: { name: string }) => item.name === 'visual-search');
  assert.ok(repository.size > 0); assert.ok(repository.fileCount > 0); assert.ok(Date.parse(repository.updatedAt)); assert.equal(repository.visibility, 'private');
  const tree = await get(`${base}/tree?ref=main`); assert.ok(tree.some((item: { path: string }) => item.path === 'data'));
  assert.equal((await get(`${base}/file?ref=main&path=README.md`)).kind, 'text');
  const table = await get(`${base}/file?ref=main&path=data%2Flabels.csv`); assert.equal(table.kind, 'table'); assert.equal(table.totalRows, 3);
  assert.equal((await get(`${base}/file?ref=main&path=images%2Falpine.png`)).kind, 'image');
  assert.equal((await get(`${base}/file?ref=main&path=docs%2Fdataset-card.pdf`)).kind, 'pdf');
  const rawPdf = await app.inject({ url: `${base}/raw?ref=main&path=docs%2Fdataset-card.pdf`, headers }); assert.equal(rawPdf.rawPayload.subarray(0, 4).toString(), '%PDF');
  const history = await get(`${base}/commits?ref=main&page=1&pageSize=20`); assert.ok(history.length >= 2);
  const detail = await get(`${base}/commits/${history[0].id}`); assert.ok(detail.files.length > 0);
  const prefix = `bff-check-${Date.now()}`;
  const source = `${prefix}-source`, target = `${prefix}-target`;
  await post(`${base}/branches`, { name: source, from: 'main' });
  await post(`${base}/branches`, { name: target, from: 'main' });
  const workspace = await post(`${base}/workspaces`, { name: prefix, branch: source });
  const staged = await app.inject({ method: 'PUT', url: `${base}/workspaces/${workspace.id}/files`, headers, payload: { path: `notes/${prefix}.txt`, content: 'BFF integration note\n' } });
  assert.equal(staged.statusCode, 200, staged.body);
  assert.equal((await get(`${base}/workspaces/${workspace.id}/file?path=notes%2F${prefix}.txt`)).text, 'BFF integration note\n');
  const boundary = `oxen-test-${Date.now()}`;
  const uploadBody = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${prefix}.txt"\r\nContent-Type: text/plain\r\n\r\nMultipart upload checked\n\r\n--${boundary}--\r\n`;
  const upload = await app.inject({ method: 'POST', url: `${base}/workspaces/${workspace.id}/upload`, headers: { ...headers, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: uploadBody });
  assert.equal(upload.statusCode, 200, upload.body);
  const commit = await post(`${base}/workspaces/${workspace.id}/commit`, { message: `Integration ${prefix}` });
  assert.ok(commit.id); assert.equal((await get(`${base}/file?ref=${source}&path=notes%2F${prefix}.txt`)).text, 'BFF integration note\n');
  const merge = await waitJob(await post(`${base}/merge`, { source, target }));
  assert.equal((await get(`${base}/file?ref=${target}&path=notes%2F${prefix}.txt`)).text, 'BFF integration note\n');
  const push = await waitJob(await post(`${base}/push`, { branch: source }));
  const result = await post(`${base}/query`, { ref: 'main', path: 'data/labels.csv', prompt: 'confidence > 0.9', engine:'rules' }); assert.equal(result.engine, 'local-rules'); assert.ok(result.rows.length > 0);
  const branches = await get(`${base}/branches`), mainId = branches.find((branch: { name: string }) => branch.name === 'main').commitId;
  const legacyWrite = await app.inject({ method: 'POST', url: `${base}/annotations`, headers, payload: { ref: mainId, path: 'data/labels.csv', rowId: '1', label: 'reviewed', note: 'Legacy writes are now disabled.' } }); assert.equal(legacyWrite.statusCode, 410);
  const patched = await app.inject({ method: 'PATCH', url: base, headers, payload: { description: 'Live integration extension metadata', tags: ['integration'] } }); assert.equal(patched.statusCode, 200, patched.body);
  const versionedSettings = await get(`${base}/file?ref=main&path=.oxenweb%2Frepository.json`); assert.equal(JSON.parse(versionedSettings.text).description, 'Live integration extension metadata');
  const restarted = await createApp(config); t.after(() => restarted.close());
  const persisted = await restarted.inject({ url: base, headers }); assert.equal(persisted.json().description, 'Live integration extension metadata');
  const persistedAnnotation = await restarted.inject({ url: `${base}/annotations?ref=${mainId}&path=data%2Flabels.csv`, headers }); assert.equal(persistedAnnotation.statusCode, 200);
  await assert.rejects(() => assertRemote({ ...config, upstream: 'http://127.0.0.1:39099' }, { namespace: 'local', repo: 'visual-search' }, path.join(config.cliRoot, 'local', 'visual-search')), /origin does not match/);

  // A newly created repository has no pre-provisioned clone. Its first CLI commit must provision safely and work.
  const fresh = await createApp({ ...config, cliRoot: path.join(directory, 'fresh-clones') }); t.after(() => fresh.close());
  const freshName = `bff-provision-${Date.now()}`;
  const freshRepo = await fresh.inject({ method: 'POST', url: '/api/repos', headers, payload: { namespace: 'local', name: freshName, description: 'Automatic managed clone integration check' } });
  assert.equal(freshRepo.statusCode, 201, freshRepo.body);
  const freshBase = `/api/repos/local/${freshName}`;
  const freshWorkspace = await fresh.inject({ method: 'POST', url: `${freshBase}/workspaces`, headers, payload: { name: 'first-edit', branch: 'main' } });
  assert.equal(freshWorkspace.statusCode, 201, freshWorkspace.body);
  const freshId = freshWorkspace.json().id;
  const freshStage = await fresh.inject({ method: 'PUT', url: `${freshBase}/workspaces/${freshId}/files`, headers, payload: { path: 'first-edit.txt', content: 'Automatically provisioned clone\n' } }); assert.equal(freshStage.statusCode, 200, freshStage.body);
  const freshCommit = await fresh.inject({ method: 'POST', url: `${freshBase}/workspaces/${freshId}/commit`, headers, payload: { message: 'Verify new repository auto-provision' } }); assert.equal(freshCommit.statusCode, 200, freshCommit.body);
  assert.ok((await stat(path.join(directory, 'fresh-clones', 'local', freshName, '.oxen'))).isDirectory());
  const freshContent = await fresh.inject({ url: `${freshBase}/file?ref=main&path=first-edit.txt`, headers }); assert.equal(freshContent.json().text, 'Automatically provisioned clone\n');
  let freshJob = (await fresh.inject({ method: 'POST', url: `${freshBase}/push`, headers, payload: { branch: 'main' } })).json();
  for (let attempt = 0; attempt < 240 && ['queued', 'running'].includes(freshJob.status); attempt++) { await new Promise(resolve => setTimeout(resolve, 250)); freshJob = (await fresh.inject({ url: `/api/jobs/${freshJob.id}`, headers })).json(); }
  assert.equal(freshJob.status, 'succeeded', JSON.stringify(freshJob));
  console.log(JSON.stringify({ live: true, repository: 'local/visual-search', source, target, commitId: commit.id, merge: merge.output, push: push.output, previews: ['text', 'table', 'image', 'pdf'], localExtensionsPersisted: true }));
});
