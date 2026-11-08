import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import type { MergeRequestComparison, MergeRequestDetail, MergeRequestJob } from '../../../packages/shared/src/index.js';
import { installAuth } from '../src/auth.js';
import { JobQueue } from '../src/cli.js';
import { loadConfig } from '../src/config.js';
import { DemoProvider } from '../src/demo.js';
import { ApiError } from '../src/errors.js';
import { MergeRequestStore, registerMergeRequests } from '../src/merge-requests.js';
import { RepositoryAccessService, installRepositoryAccess, registerRepositoryControl } from '../src/repository-access.js';
import { RepositorySettingsService } from '../src/repository-settings.js';
import type { Provider } from '../src/provider.js';

const key = { namespace: 'oxen', repo: 'visual-search' }, base = '/api/repos/oxen/visual-search/merge-requests';
const ownerToken = 'owner-token-for-merge-request-tests', owner = { id: 'owner', name: 'Instance owner', kind: 'owner' as const, source: 'bearer' as const };
const bearer = (token = ownerToken) => ({ authorization: `Bearer ${token}` });
async function setup(t: { after: (callback: () => Promise<void>) => void }) {
  const root = path.resolve('.data/tests'); await mkdir(root, { recursive: true }); const directory = await mkdtemp(path.join(root, 'merge-requests-'));
  const config = loadConfig({ DEMO_MODE: 'true', DEMO_DATA_FILE: path.join(directory, 'demo.json'), BFF_TOKEN: ownerToken });
  const provider = new DemoProvider(config.demoFile); await provider.init();
  const settings = new RepositorySettingsService(provider, path.join(directory, 'policy-branches.json'));
  const access = new RepositoryAccessService(settings, path.join(directory, 'credentials.json'), false); await access.init();
  const app = Fastify(); const auth = installAuth(app, config); installRepositoryAccess(app, access, auth); registerRepositoryControl(app, { settings, access });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
    if (error instanceof ZodError) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: error.message } });
    return reply.code(500).send({ error: { message: error instanceof Error ? error.message : 'Error' } });
  });
  const jobs = new JobQueue(), filename = path.join(directory, 'merge-requests.json'), registrations = new Map<string, unknown>();
  const store = await registerMergeRequests(app, { provider, access, jobs, filename, onJob: (id, key) => { registrations.set(id, key); } });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const advance = async (branch: string, filename = 'data/review.txt', content = 'Review branch data') => {
    const workspace = await provider.createWorkspace(key, 'merge-request-test', branch); await provider.writeWorkspace(key, workspace.id, filename, Buffer.from(content)); return provider.commitWorkspace(key, workspace.id, 'Prepare merge request');
  };
  const create = async (source = 'review', headers = bearer()) => {
    const response = await app.inject({ method: 'POST', url: base, headers, payload: { title: 'Review data update', description: 'Independent local collaboration metadata', source, target: 'main' } });
    assert.equal(response.statusCode, 201, response.body); return response.json<MergeRequestDetail>();
  };
  return { app, provider, jobs, access, store, filename, registrations, advance, create };
}
async function finished(jobs: JobQueue, id: string) {
  for (let i = 0; i < 100; i++) { const job = jobs.get(id); if (['succeeded', 'failed'].includes(job.status)) return job; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw new Error('The merge job did not finish.');
}

test('empty, same-branch and no-ahead comparisons cannot create requests', async t => {
  const { app, provider } = await setup(t);
  assert.deepEqual((await app.inject({ url: base, headers: bearer() })).json(), []);
  const same = (await app.inject({ url: `${base}/compare?source=main&target=main`, headers: bearer() })).json<MergeRequestComparison>();
  assert.equal(same.canCreate, false); assert.match(same.reason!, /different branches/);
  await provider.createBranch(key, 'review', 'main');
  const response = await app.inject({ method: 'POST', url: base, headers: bearer(), payload: { title: 'No changes', source: 'review', target: 'main' } });
  assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'MERGE_REQUEST_NO_CHANGES');
});

test('three-way MR preview excludes target-only merged files and computes the base for an existing stored request', async t => {
  const { app, provider, jobs, advance, create } = await setup(t);
  const common = (await provider.branches(key)).find(branch => branch.name === 'main')!.commitId;
  await provider.createBranch(key, 'first-review', 'main'); await provider.createBranch(key, 'review', 'main');
  await advance('first-review', '.oxenweb/labels/first.json', '{"review":"first synthetic reviewer"}');
  await advance('review', '.oxenweb/labels/second.json', '{"review":"second synthetic reviewer"}');
  let item = await create(); // Persisted before the target moves; no stored merge-base field is required.
  await provider.merge(key, 'first-review', 'main');
  const currentTarget = (await provider.branches(key)).find(branch => branch.name === 'main')!.commitId;
  const response = await app.inject({ url: `${base}/compare?source=review&target=main`, headers: bearer() }); assert.equal(response.statusCode, 200, response.body);
  const compared = response.json<MergeRequestComparison>();
  assert.equal(compared.baseCommitId, common); assert.equal(compared.targetCommitId, currentTarget); assert.equal(compared.ahead, 1); assert.equal(compared.behind, 2);
  assert.deepEqual(compared.files.map(file => [file.path, file.status]), [['.oxenweb/labels/second.json', 'added']]);
  const stored = (await app.inject({ url: `${base}/${item.id}/compare`, headers: bearer() })).json<MergeRequestComparison>();
  assert.equal(stored.baseCommitId, common); assert.equal(stored.stale, true); assert.equal(stored.targetCommitId, item.targetCommitId);
  item = (await app.inject({ method: 'POST', url: `${base}/${item.id}/refresh`, headers: bearer(), payload: { expectedRevision: item.revision } })).json();
  const refreshed = (await app.inject({ url: `${base}/${item.id}/compare`, headers: bearer() })).json<MergeRequestComparison>(); assert.equal(refreshed.baseCommitId, common); assert.equal(refreshed.stale, false); assert.equal(refreshed.files.some(file => file.path.endsWith('first.json')), false);
  const merged = await app.inject({ method: 'POST', url: `${base}/${item.id}/merge`, headers: bearer(), payload: { expectedRevision: item.revision, expectedSourceCommitId: item.sourceCommitId, expectedTargetCommitId: item.targetCommitId } }); assert.equal(merged.statusCode, 200, merged.body);
  assert.equal((await finished(jobs, merged.json<MergeRequestJob>().job.id)).status, 'succeeded');
  assert.equal((await provider.raw(key, 'main', '.oxenweb/labels/first.json')).content.toString(), '{"review":"first synthetic reviewer"}');
  assert.equal((await provider.raw(key, 'main', '.oxenweb/labels/second.json')).content.toString(), '{"review":"second synthetic reviewer"}');
});

test('a real source deletion remains visible relative to the common base', async t => {
  const { app, provider, advance } = await setup(t);
  await provider.createBranch(key, 'review', 'main'); await advance('review', 'README.md', 'Synthetic source edit'); await advance('main', 'README.md', 'Synthetic target edit');
  const heads = await provider.branches(key), source = heads.find(branch => branch.name === 'review')!.commitId, target = heads.find(branch => branch.name === 'main')!.commitId;
  await provider.resolveMerge(key, { operationId: 'f344364b-32f1-4823-8d7d-012d43ce5f54', source: 'review', target: 'main', expectedSourceCommitId: source, expectedTargetCommitId: target, files: [{ path: 'README.md', content: null }], message: 'Synthetic explicit deletion resolution' });
  const response = await app.inject({ url: `${base}/compare?source=review&target=main`, headers: bearer() }); assert.equal(response.statusCode, 200, response.body);
  const compared = response.json<MergeRequestComparison>(); assert.equal(compared.baseCommitId, target);
  assert.equal(compared.files.find(file => file.path === 'README.md')?.status, 'removed');
  assert.equal(compared.files.find(file => file.path === 'README.md')?.before, 'Synthetic target edit');
});

test('incomplete, unrelated, ambiguous or cyclic ancestry fails explicitly before any file diff', async t => {
  const { app, provider, advance } = await setup(t); await provider.createBranch(key, 'review', 'main'); await advance('review');
  const heads = await provider.branches(key), source = heads.find(branch => branch.name === 'review')!.commitId, target = heads.find(branch => branch.name === 'main')!.commitId;
  const node = (id: string, parentIds: string[]) => ({ id, parentIds, message: 'Synthetic DAG fixture', author: 'Synthetic', timestamp: '2026-11-08T00:00:00Z' });
  let histories = new Map<string, ReturnType<typeof node>[]>(), diffCalls = 0; provider.commits = async (_key, ref) => histories.get(ref) ?? []; provider.diff = async () => { diffCalls++; return []; };
  const cases = [
    { code: 'MERGE_ANCESTRY_INCOMPLETE', a: [node(source, ['missing'])], b: [node(target, [])] },
    { code: 'MERGE_BASE_NOT_FOUND', a: [node(source, [])], b: [node(target, [])] },
    { code: 'MERGE_BASE_AMBIGUOUS', a: [node(source, ['left-base', 'right-base']), node('right-base', ['root']), node('root', []), node('left-base', ['root'])], b: [node(target, ['right-base', 'left-base']), node('left-base', ['root']), node('right-base', ['root']), node('root', [])] },
    { code: 'MERGE_ANCESTRY_INVALID', a: [node(source, ['cycle']), node('cycle', [source])], b: [node(target, [])] },
  ];
  for (const fixture of cases) { histories = new Map([[source, fixture.a], [target, fixture.b]]); const response = await app.inject({ url: `${base}/compare?source=review&target=main`, headers: bearer() }); assert.equal(response.statusCode, 409, response.body); assert.equal(response.json().error.code, fixture.code); }
  assert.equal(diffCalls, 0);
});

test('merge-base selection follows DAG parents rather than history order or nearest date', async t => {
  const { app, provider, advance } = await setup(t); await provider.createBranch(key, 'review', 'main'); await advance('review');
  const heads = await provider.branches(key), source = heads.find(branch => branch.name === 'review')!.commitId, target = heads.find(branch => branch.name === 'main')!.commitId;
  const node = (id: string, parentIds: string[]) => ({ id, parentIds, message: 'Synthetic shuffled DAG', author: 'Synthetic', timestamp: '2026-11-08T00:00:00Z' });
  provider.commits = async (_key, ref) => ref === source ? [node('root', []), node(source, ['best-base', 'source-side']), node('source-side', ['root']), node('best-base', ['older-base']), node('older-base', ['root'])] : [node('older-base', ['root']), node(target, ['target-side', 'best-base']), node('root', []), node('target-side', ['older-base']), node('best-base', ['older-base'])];
  let actual: string[] = []; provider.diff = async (_key, before, after) => { actual = [before, after]; return []; };
  const response = await app.inject({ url: `${base}/compare?source=review&target=main`, headers: bearer() }); assert.equal(response.statusCode, 200, response.body); assert.equal(response.json<MergeRequestComparison>().baseCommitId, 'best-base'); assert.deepEqual(actual, ['best-base', source]);
});

test('comments and close/reopen use CAS; successful merge persists verified target commit and job scope', async t => {
  const { app, provider, jobs, filename, registrations, advance, create } = await setup(t);
  await provider.createBranch(key, 'review', 'main'); await advance('review');
  const compared = (await app.inject({ url: `${base}/compare?source=review&target=main`, headers: bearer() })).json<MergeRequestComparison>();
  assert.equal(compared.ahead, 1); assert.ok(compared.files.some(file => file.path === 'data/review.txt'));
  let item = await create(); assert.equal(item.storage, 'bff-local'); assert.equal(item.sourceCommitId, compared.sourceCommitId);
  const comments = await Promise.all(['First comment', 'Concurrent stale comment'].map(body => app.inject({ method: 'POST', url: `${base}/${item.id}/comments`, headers: bearer(), payload: { body, expectedRevision: item.revision } })));
  assert.deepEqual(comments.map(response => response.statusCode).sort(), [200, 409]);
  item = comments.find(response => response.statusCode === 200)!.json(); assert.equal(item.comments.length, 1);
  item = (await app.inject({ method: 'POST', url: `${base}/${item.id}/close`, headers: bearer(), payload: { expectedRevision: item.revision } })).json(); assert.equal(item.status, 'closed');
  item = (await app.inject({ method: 'POST', url: `${base}/${item.id}/reopen`, headers: bearer(), payload: { expectedRevision: item.revision } })).json(); assert.equal(item.status, 'open');
  const merge = await app.inject({ method: 'POST', url: `${base}/${item.id}/merge`, headers: bearer(), payload: { expectedRevision: item.revision, expectedSourceCommitId: item.sourceCommitId, expectedTargetCommitId: item.targetCommitId } });
  assert.equal(merge.statusCode, 200, merge.body); const result = merge.json<MergeRequestJob>();
  assert.deepEqual(registrations.get(result.job.id), key); assert.equal((await finished(jobs, result.job.id)).status, 'succeeded');
  item = (await app.inject({ url: `${base}/${item.id}`, headers: bearer() })).json(); assert.equal(item.status, 'merged'); assert.ok(item.mergedCommitId); assert.notEqual(item.mergedCommitId, item.targetCommitId);
  assert.equal((await provider.raw(key, 'main', 'data/review.txt')).content.toString(), 'Review branch data');
  const restart = new MergeRequestStore(filename); await restart.init(); assert.equal(restart.get(key, item.id).mergedCommitId, item.mergedCommitId);
  const stored = await readFile(filename, 'utf8'); assert.equal(stored.includes(ownerToken), false);
});

test('comparison remains pinned after source changes, merge rejects stale heads, refresh requires CAS', async t => {
  const { app, provider, advance, create } = await setup(t);
  await provider.createBranch(key, 'review', 'main'); await advance('review', 'first.txt', 'First'); const item = await create();
  await advance('review', 'later.txt', 'Later');
  const compared = (await app.inject({ url: `${base}/${item.id}/compare`, headers: bearer() })).json<MergeRequestComparison>();
  assert.equal(compared.stale, true); assert.equal(compared.sourceCommitId, item.sourceCommitId); assert.equal(compared.files.some(file => file.path === 'later.txt'), false);
  const merge = await app.inject({ method: 'POST', url: `${base}/${item.id}/merge`, headers: bearer(), payload: { expectedRevision: item.revision, expectedSourceCommitId: item.sourceCommitId, expectedTargetCommitId: item.targetCommitId } });
  assert.equal(merge.statusCode, 409); assert.equal(merge.json().error.code, 'MERGE_REQUEST_BRANCHES_CHANGED');
  const refreshed = (await app.inject({ method: 'POST', url: `${base}/${item.id}/refresh`, headers: bearer(), payload: { expectedRevision: item.revision } })).json<MergeRequestDetail>();
  assert.notEqual(refreshed.sourceCommitId, item.sourceCommitId);
  assert.equal((await app.inject({ method: 'POST', url: `${base}/${item.id}/close`, headers: bearer(), payload: { expectedRevision: item.revision } })).statusCode, 409);
  assert.equal((await app.inject({ url: `/api/repos/oxen/other/merge-requests/${item.id}`, headers: bearer() })).statusCode, 404);
});

test('full repository hooks enforce viewer read-only and editor cannot merge policy changes', async t => {
  const { app, provider, access, advance, create } = await setup(t);
  const viewer = await access.grant(key, owner, { name: 'Viewer', role: 'viewer' }), editor = await access.grant(key, owner, { name: 'Editor', role: 'editor' });
  await provider.createBranch(key, 'review', 'main'); await advance('review', '.oxenweb/repository.json', '{"visibility":"public"}');
  assert.equal((await app.inject({ url: base, headers: bearer(viewer.token) })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: base, headers: bearer(viewer.token), payload: { title: 'Forbidden', source: 'review', target: 'main' } })).statusCode, 403);
  const item = await create('review', bearer(editor.token));
  const denied = await app.inject({ method: 'POST', url: `${base}/${item.id}/merge`, headers: bearer(editor.token), payload: { expectedRevision: item.revision, expectedSourceCommitId: item.sourceCommitId, expectedTargetCommitId: item.targetCommitId } });
  assert.equal(denied.statusCode, 403); assert.equal((await app.inject({ url: `${base}/${item.id}`, headers: bearer() })).json().status, 'open');
});

test('queued merge rechecks revoked actor before the provider can write', async t => {
  const { app, provider, access, jobs, advance, create } = await setup(t);
  const editor = await access.grant(key, owner, { name: 'Temporary editor', role: 'editor' });
  await provider.createBranch(key, 'review', 'main'); await advance('review'); const item = await create('review', bearer(editor.token));
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  jobs.add(`${key.namespace}/${key.repo}`, 'test queue gate', async () => { await gate; return 'Released'; });
  let calls = 0; const original = provider.merge.bind(provider); provider.merge = async (...args) => { calls++; return original(...args); };
  const response = await app.inject({ method: 'POST', url: `${base}/${item.id}/merge`, headers: bearer(editor.token), payload: { expectedRevision: item.revision, expectedSourceCommitId: item.sourceCommitId, expectedTargetCommitId: item.targetCommitId } });
  assert.equal(response.statusCode, 200, response.body);
  await access.revoke(key, owner, editor.collaborator.id); release();
  const job = await finished(jobs, response.json<MergeRequestJob>().job.id); assert.equal(job.status, 'failed'); assert.equal(calls, 0);
  const readback = (await app.inject({ url: `${base}/${item.id}`, headers: bearer() })).json<MergeRequestDetail>(); assert.equal(readback.status, 'open'); assert.match(readback.mergeError!, /cannot write/);
});

test('restart marks unfinished merge as interrupted without assuming success or silently retrying', async t => {
  const { provider, store, filename, advance, create } = await setup(t);
  await provider.createBranch(key, 'review', 'main'); await advance('review'); const item = await create();
  await store.mutate(key, item.id, item.revision, value => { value.status = 'merging'; value.attemptId = 'e0e7b35c-4b57-49dd-8d32-8fbd7e5b65b2'; });
  const restart = new MergeRequestStore(filename); await restart.init(); const interrupted = restart.get(key, item.id);
  assert.equal(interrupted.status, 'merging'); assert.equal(interrupted.interrupted, true); assert.match(interrupted.mergeError!, /restarted/); assert.equal(interrupted.revision, item.revision + 2);
});

test('a provider error after a successful remote write remains uncertain and requires explicit recovery', async t => {
  const { app, provider, jobs, advance, create } = await setup(t);
  await provider.createBranch(key, 'review', 'main'); await advance('review'); const item = await create();
  const original = provider.merge.bind(provider); provider.merge = async (...args) => { await original(...args); throw new ApiError(502, 'SIMULATED_RESPONSE_LOSS', 'The remote write completed but its response was lost.'); };
  const response = await app.inject({ method: 'POST', url: `${base}/${item.id}/merge`, headers: bearer(), payload: { expectedRevision: item.revision, expectedSourceCommitId: item.sourceCommitId, expectedTargetCommitId: item.targetCommitId } });
  assert.equal(response.statusCode, 200, response.body); const job = await finished(jobs, response.json<MergeRequestJob>().job.id); assert.equal(job.status, 'failed');
  let readback = (await app.inject({ url: `${base}/${item.id}`, headers: bearer() })).json<MergeRequestDetail>();
  assert.equal(readback.status, 'merging'); assert.equal(readback.interrupted, true); assert.match(readback.mergeError!, /requires inspection/);
  assert.equal((await provider.raw(key, 'main', 'data/review.txt')).content.toString(), 'Review branch data');
  const recovery = await app.inject({ method: 'POST', url: `${base}/${item.id}/reopen`, headers: bearer(), payload: { expectedRevision: readback.revision } }); assert.equal(recovery.statusCode, 200, recovery.body); readback = recovery.json();
  const withoutRefresh = await app.inject({ method: 'POST', url: `${base}/${item.id}/merge`, headers: bearer(), payload: { expectedRevision: readback.revision, expectedSourceCommitId: readback.sourceCommitId, expectedTargetCommitId: readback.targetCommitId } }); assert.equal(withoutRefresh.statusCode, 409); assert.equal(withoutRefresh.json().error.code, 'MERGE_REQUEST_REVIEW_REQUIRED');
  const refreshed = await app.inject({ method: 'POST', url: `${base}/${item.id}/refresh`, headers: bearer(), payload: { expectedRevision: readback.revision } }); assert.equal(refreshed.statusCode, 200, refreshed.body); readback = refreshed.json();
  const compared = (await app.inject({ url: `${base}/${item.id}/compare`, headers: bearer() })).json<MergeRequestComparison>(); assert.equal(compared.ahead, 0); assert.equal(compared.canCreate, false);
  const retry = await app.inject({ method: 'POST', url: `${base}/${item.id}/merge`, headers: bearer(), payload: { expectedRevision: readback.revision, expectedSourceCommitId: readback.sourceCommitId, expectedTargetCommitId: readback.targetCommitId } }); assert.equal(retry.statusCode, 409);
});

test('an enqueue rejection restores an ordinary open request without invoking the provider', async t => {
  const { app, provider, jobs, filename, advance, create } = await setup(t);
  await provider.createBranch(key, 'review', 'main'); await advance('review'); const item = await create();
  let calls = 0; provider.merge = async () => { calls++; return 'Must not execute'; };
  jobs.add = () => { throw new ApiError(429, 'JOB_LIMIT', 'Too many pending operations.'); };
  const response = await app.inject({ method: 'POST', url: `${base}/${item.id}/merge`, headers: bearer(), payload: { expectedRevision: item.revision, expectedSourceCommitId: item.sourceCommitId, expectedTargetCommitId: item.targetCommitId } });
  assert.equal(response.statusCode, 429, response.body); assert.equal(calls, 0);
  const restart = new MergeRequestStore(filename); await restart.init(); const readback = restart.get(key, item.id);
  assert.equal(readback.status, 'open'); assert.equal(readback.attemptId, undefined); assert.equal(readback.jobId, undefined); assert.match(readback.mergeError!, /pending operations/);
});

test('policy merge rechecks administrator role after provider preparation and before writing', async t => {
  const { app, provider, access, jobs, advance } = await setup(t);
  const admin = await access.grant(key, owner, { name: 'Temporary administrator', role: 'admin' });
  await provider.createBranch(key, 'review', 'main'); await provider.createBranch(key, 'destination', 'main');
  const state = await access.settings.read(key); await advance('review', '.oxenweb/repository.json', JSON.stringify({ ...state.policy, description: 'Reviewed policy update' }));
  const created = await app.inject({ method: 'POST', url: base, headers: bearer(admin.token), payload: { title: 'Policy review', source: 'review', target: 'destination' } }); assert.equal(created.statusCode, 201, created.body); const item = created.json<MergeRequestDetail>();
  let release!: () => void, started!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }), preparing = new Promise<void>(resolve => { started = resolve; });
  const original = provider.merge.bind(provider); let writes = 0;
  (provider as Provider).merge = async (key, source, target, options) => { started(); await gate; await options?.beforeWrite?.(); writes++; return original(key, source, target); };
  const merge = await app.inject({ method: 'POST', url: `${base}/${item.id}/merge`, headers: bearer(admin.token), payload: { expectedRevision: item.revision, expectedSourceCommitId: item.sourceCommitId, expectedTargetCommitId: item.targetCommitId } }); assert.equal(merge.statusCode, 200, merge.body);
  await preparing; await access.setRole(key, owner, admin.collaborator.id, 'editor'); release();
  const job = await finished(jobs, merge.json<MergeRequestJob>().job.id); assert.equal(job.status, 'failed'); assert.match(job.error!, /administer/); assert.equal(writes, 0);
  assert.equal((await provider.branches(key)).find(branch => branch.name === 'destination')?.commitId, item.targetCommitId);
});

test('a changed target alone cannot mark merged unless it contains the reviewed source commit', async t => {
  const { app, provider, jobs, advance, create } = await setup(t);
  await provider.createBranch(key, 'review', 'main'); await advance('review'); const item = await create();
  provider.merge = async () => { await advance('main', 'unrelated.txt', 'Concurrent unrelated change'); return 'An unrelated target update is not a merge.'; };
  const response = await app.inject({ method: 'POST', url: `${base}/${item.id}/merge`, headers: bearer(), payload: { expectedRevision: item.revision, expectedSourceCommitId: item.sourceCommitId, expectedTargetCommitId: item.targetCommitId } }); assert.equal(response.statusCode, 200, response.body);
  assert.equal((await finished(jobs, response.json<MergeRequestJob>().job.id)).status, 'failed');
  const readback = (await app.inject({ url: `${base}/${item.id}`, headers: bearer() })).json<MergeRequestDetail>();
  assert.equal(readback.status, 'merging'); assert.equal(readback.interrupted, true); assert.equal(readback.mergedCommitId, undefined); assert.match(readback.mergeError!, /does not include/);
});
