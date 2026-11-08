import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import type { MergeRequestComparison, MergeRequestDetail, MergeRequestJob } from '../../../packages/shared/src/index.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

test('real Oxen merge-request comparison, comments and merge execute through full BFF hooks and survive restart', { skip: process.env.OXEN_MERGE_REQUEST_LIVE_TEST !== 'true', timeout: 180000 }, async t => {
  process.loadEnvFile(path.resolve('infra/oxen/local.env'));
  const root = path.resolve('.data/tests'); await mkdir(root, { recursive: true }); const directory = await mkdtemp(path.join(root, 'merge-request-live-'));
  const config = loadConfig({ ...process.env, DEMO_MODE: 'false', DEMO_DATA_FILE: path.join(directory, 'state.json') });
  const app = await createApp(config), headers = config.token ? { authorization: `Bearer ${config.token}` } : { 'x-oxen-request': 'web' };
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const repo = `merge-request-check-${Date.now()}`, prefix = `/api/repos/local/${repo}`, base = `${prefix}/merge-requests`;
  const created = await app.inject({ method: 'POST', url: '/api/repos', headers, payload: { namespace: 'local', name: repo, description: 'Synthetic merge-request acceptance fixture', visibility: 'private' } }); assert.equal(created.statusCode, 201, created.body);
  assert.equal((await app.inject({ method: 'POST', url: `${prefix}/branches`, headers, payload: { name: 'review', from: 'main' } })).statusCode, 201);
  const workspace = (await app.inject({ method: 'POST', url: `${prefix}/workspaces`, headers, payload: { name: 'Merge request fixture', branch: 'review' } })).json();
  const content = '# Synthetic merge-request acceptance\n\nThis repository contains no user benchmark data.\n';
  const write = await app.inject({ method: 'PUT', url: `${prefix}/workspaces/${workspace.id}/files`, headers, payload: { path: 'review.md', content } }); assert.equal(write.statusCode, 200, write.body);
  const committed = await app.inject({ method: 'POST', url: `${prefix}/workspaces/${workspace.id}/commit`, headers, payload: { message: 'Prepare synthetic merge-request change' } }); assert.equal(committed.statusCode, 200, committed.body);
  const comparedResponse = await app.inject({ url: `${base}/compare?source=review&target=main`, headers }); assert.equal(comparedResponse.statusCode, 200, comparedResponse.body);
  const compared = comparedResponse.json<MergeRequestComparison>(); assert.equal(compared.canCreate, true); assert.equal(compared.ahead, 1); assert.ok(compared.files.some(file => file.path === 'review.md'));
  const request = await app.inject({ method: 'POST', url: base, headers, payload: { title: 'Review synthetic data', description: 'Local collaboration metadata, genuine Oxen merge', source: 'review', target: 'main', expectedSourceCommitId: compared.sourceCommitId, expectedTargetCommitId: compared.targetCommitId } }); assert.equal(request.statusCode, 201, request.body);
  let item = request.json<MergeRequestDetail>();
  const commented = await app.inject({ method: 'POST', url: `${base}/${item.id}/comments`, headers, payload: { body: 'Reviewed the synthetic change.', expectedRevision: item.revision } }); assert.equal(commented.statusCode, 200, commented.body); item = commented.json();
  const merge = await app.inject({ method: 'POST', url: `${base}/${item.id}/merge`, headers, payload: { expectedRevision: item.revision, expectedSourceCommitId: item.sourceCommitId, expectedTargetCommitId: item.targetCommitId } }); assert.equal(merge.statusCode, 200, merge.body);
  const result = merge.json<MergeRequestJob>(); let status = result.job.status, error = '';
  for (let i = 0; i < 180 && ['queued', 'running'].includes(status); i++) {
    await new Promise(resolve => setTimeout(resolve, 250)); const response = await app.inject({ url: `/api/jobs/${result.job.id}`, headers }); assert.equal(response.statusCode, 200, response.body); const job = response.json(); status = job.status; error = job.error ?? '';
  }
  assert.equal(status, 'succeeded', error);
  item = (await app.inject({ url: `${base}/${item.id}`, headers })).json(); assert.equal(item.status, 'merged'); assert.ok(item.mergedCommitId); assert.notEqual(item.mergedCommitId, compared.targetCommitId);
  const raw = await app.inject({ url: `${prefix}/raw?ref=main&path=review.md`, headers }); assert.equal(raw.statusCode, 200); assert.equal(raw.body, content);
  const stored = await readFile(path.join(directory, 'merge-requests.json'), 'utf8'); assert.ok(stored.includes(item.mergedCommitId!));
  const restarted = await createApp(config); t.after(() => restarted.close()); const readback = await restarted.inject({ url: `${base}/${item.id}`, headers }); assert.equal(readback.statusCode, 200, readback.body); assert.equal(readback.json().status, 'merged'); assert.equal(readback.json().comments.length, 1);
  console.log(JSON.stringify({ repository: `local/${repo}`, request: item.number, sourceCommitId: item.sourceCommitId, targetCommitId: item.targetCommitId, mergedCommitId: item.mergedCommitId, verifiedTargetFile: 'review.md', storage: item.storage, restart: 'passed' }));
});
