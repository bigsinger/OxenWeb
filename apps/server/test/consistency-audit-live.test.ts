import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { loadConfig, projectRoot } from '../src/config.js';

test('real native merge preflight rejects conflicting branch edits without publishing or provisioning a CLI clone', { skip: process.env.OXEN_AUDIT_LIVE_TEST !== 'true', timeout: 120_000 }, async t => {
  process.loadEnvFile(path.join(projectRoot, 'infra/oxen/local.env'));
  const root = path.join(projectRoot, '.data/tests'); await mkdir(root, { recursive: true }); const directory = await mkdtemp(path.join(root, 'consistency-live-'));
  const owner = 'owner-token-for-consistency-live-tests', config = loadConfig({ ...process.env, DEMO_DATA_FILE: path.join(directory, 'state.json'), OXEN_CLI_ROOT: path.join(directory, 'clones'), BFF_TOKEN: owner, DEMO_MODE: 'false' });
  const app = await createApp(config); t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const headers = { authorization: `Bearer ${owner}` }, name = `audit-conflict-${Date.now()}`, base = `/api/repos/local/${name}`;
  async function get(url: string) { const response = await app.inject({ url, headers }); assert.equal(response.statusCode, 200, response.body); return response.json(); }
  async function post(url: string, payload: unknown) { const response = await app.inject({ method: 'POST', url, headers, payload: payload as Record<string, unknown> }); assert.ok([200, 201].includes(response.statusCode), response.body); return response.json(); }
  await post('/api/repos', { namespace: 'local', name, description: 'Isolated local merge conflict acceptance fixture.' });
  async function edit(branch: string, text: string) {
    const head = (await get(`${base}/branches`)).find((item: { name: string }) => item.name === branch).commitId;
    const workspace = await post(`${base}/workspaces`, { name: `conflict-${branch}-${Date.now()}`, branch });
    const staged = await app.inject({ method: 'PUT', url: `${base}/workspaces/${workspace.id}/files`, headers, payload: { path: 'data/conflict.txt', content: text } }); assert.equal(staged.statusCode, 200, staged.body);
    return post(`${base}/workspaces/${workspace.id}/commit`, { expectedCommit: head, message: `Edit ${branch} conflict fixture` });
  }
  await edit('main', 'common ancestor\n');
  await post(`${base}/branches`, { name: 'source', from: 'main' }); await post(`${base}/branches`, { name: 'target', from: 'main' });
  const source = await edit('source', 'source version\n'), target = await edit('target', 'target version\n');
  let job = await post(`${base}/merge`, { source: 'source', target: 'target' });
  for (let i = 0; i < 200 && ['queued', 'running'].includes(job.status); i++) { await new Promise(resolve => setTimeout(resolve, 25)); job = await get(`/api/jobs/${job.id}`); }
  assert.equal(job.status, 'failed', JSON.stringify(job)); assert.match(job.error, /conflict\.txt/);
  const branches = await get(`${base}/branches`); assert.equal(branches.find((item: { name: string }) => item.name === 'target').commitId, target.id);
  const file = await get(`${base}/file?ref=target&path=data%2Fconflict.txt`); assert.equal(file.text, 'target version\n');
  assert.equal(await stat(path.join(config.cliRoot, 'local', name)).catch(() => null), null);
  console.log(JSON.stringify({ repository: `local/${name}`, sourceCommit: source.id, targetCommitUnchanged: target.id, jobStatus: job.status, nativeConflictPath: 'data/conflict.txt', targetContentUnchanged: true, noCliCloneProvisioned: true }));
});
