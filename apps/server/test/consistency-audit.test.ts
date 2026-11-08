import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { LiveProvider } from '../src/live.js';
import { DemoProvider } from '../src/demo.js';
import { createApp } from '../src/app.js';
import { loadConfig, projectRoot } from '../src/config.js';
import { ApiError } from '../src/errors.js';
import type { MergeOptions } from '../src/provider.js';
import { parseLocalBranchHead } from '../src/managed-cli.js';

const key = { namespace: 'team', repo: 'data' }, base = '/api/repos/team/data';
const before = 'a'.repeat(32), after = 'b'.repeat(32);
const commit = (id: string) => ({ id, parent_ids: [], message: 'fixture', author: 'Test', email: 'test@localhost', timestamp: '2026-11-07T12:00:00Z' });
const entry = (filename: string, is_dir = false) => ({ filename, is_dir, size: 1, hash: 'h', extension: '', data_type: is_dir ? 'dir' : 'binary', mime_type: 'application/octet-stream' });
const json = (value: unknown, status = 200) => new Response(JSON.stringify({ status: 'success', status_message: 'resource_found', ...value as Record<string, unknown> }), { status, headers: { 'content-type': 'application/json' } });
const branches = () => json({ branches: [{ name: 'main', commit_id: before }, { name: 'source', commit_id: after }] });
const provider = () => new LiveProvider(loadConfig({ OXEN_SERVER_URL: 'http://oxen.test', OXEN_NAMESPACES: 'team', OXEN_CLI_BIN: 'MUST_NOT_EXECUTE' }));

test('CLI branch-head parsing accepts the real unpadded 30-character Oxen hash and rejects misleading output', () => {
  const short = '332c03b37d08ecb779cc6552599d57';
  assert.equal(parseLocalBranchHead(`commit ${short}\n\nAuthor: Oxen Web\n`), short);
  assert.equal(parseLocalBranchHead(`\u001b[31mcommit ${before}\u001b[0m\r\n`), before);
  assert.throws(() => parseLocalBranchHead(`warning\ncommit ${before}\n`), /did not identify/);
  assert.throws(() => parseLocalBranchHead(`commit ${'a'.repeat(33)}\n`), /did not identify/);
  assert.throws(() => parseLocalBranchHead('commit not-a-hash\n'), /did not identify/);
});

test('directory pagination reaches page 101 and pins all pages and preview URLs to one commit', async t => {
  let branchHead = before, requested = 0;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input), url = new URL(request.url), pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/branches')) return json({ branches: [{ name: 'main', commit_id: branchHead }] });
    if (pathname.includes('/dir/')) {
      assert.equal(pathname, `${base}/dir/${before}`);
      const page = Number(url.searchParams.get('page')); requested++; branchHead = after;
      return json({ entries: Array.from({ length: 250 }, (_, i) => entry(`file-${(page - 1) * 250 + i}.bin`)), page_number: page, page_size: 250, total_entries: 25250, total_pages: 101 });
    }
    if (pathname.includes('/file/')) return new Response('text preview');
    throw new Error(`Unexpected fixture request: ${pathname}`);
  });
  const live = provider(), files = await live.tree(key, 'main', '');
  assert.equal(files.length, 25250); assert.equal(requested, 101); assert.ok(files.some(file => file.name === 'file-25249.bin'));
  const preview = await live.file(key, 'main', 'note.txt', 1, 100);
  assert.equal(new URL(preview.url!, 'http://bff.test').searchParams.get('ref'), after);
});

test('diff retrieves page 11 including the policy file and freezes moving source/target refs', async t => {
  let requested = 0;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input), url = new URL(request.url), pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/branches')) return branches();
    assert.equal(pathname, `${base}/compare/entries/${before}..${after}`);
    const page = Number(url.searchParams.get('page')); requested++;
    return json({ page_number: page, page_size: 100, total_entries: 1100, total_pages: 11, compare: { entries: Array.from({ length: 100 }, (_, i) => ({ ...entry(page === 11 && i === 99 ? '.oxenweb/repository.json' : `data/${page}-${i}.bin`), status: 'modified' })), base_commit: commit(before), head_commit: commit(after), counts: { added: 0, removed: 0, modified: 1100 } } });
  });
  const files = await provider().diff(key, 'main', 'source');
  assert.equal(requested, 11); assert.equal(files.length, 1100); assert.ok(files.some(file => file.path === '.oxenweb/repository.json'));
});

test('workspace changes include policy files beyond the first thousand entries', async t => {
  const workspaceId = '11111111-1111-4111-8111-111111111111'; let requested = 0;
  const group = (entries: unknown[], page: number, total: number) => ({ entries, page_number: page, page_size: 1000, total_entries: total, total_pages: Math.ceil(total / 1000) });
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input), url = new URL(request.url), pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/branches')) return branches();
    if (pathname.endsWith(`/workspaces/${workspaceId}`)) return json({ workspace: { id: workspaceId, name: 'Test', commit: commit(before) } });
    if (pathname.endsWith('/changes')) {
      const page = Number(url.searchParams.get('page')); requested++;
      return json({ staged: { added_dirs: {}, added_files: group(page === 1 ? Array.from({ length: 1000 }, (_, i) => entry(`data/${i}.bin`)) : [entry('.oxenweb/repository.json')], page, 1001), modified_files: group([], page, 0), removed_files: group([], page, 0) } });
    }
    throw new Error(`Unexpected fixture request: ${pathname}`);
  });
  const workspace = await provider().workspace(key, workspaceId);
  assert.equal(requested, 2); assert.equal(workspace.changes.length, 1001); assert.ok(workspace.changes.some(change => change.path === '.oxenweb/repository.json'));
});

test('root commit details include a deeply nested directory and more than one thousand files', async t => {
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input), url = new URL(request.url), pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/branches')) return branches();
    if (pathname.endsWith(`/commits/${before}`)) return json({ commit: commit(before) });
    const prefix = `${base}/dir/${before}`;
    assert.ok(pathname.startsWith(prefix));
    const directory = pathname.slice(prefix.length).replace(/^\//, ''), depth = directory ? directory.split('/').length : 0;
    const page = Number(url.searchParams.get('page'));
    if (depth < 16) return json({ entries: [entry(`${directory ? directory + '/' : ''}d${depth}`, true)], page_number: page, page_size: 250, total_entries: 1, total_pages: 1 });
    const count = page === 5 ? 200 : 250;
    return json({ entries: Array.from({ length: count }, (_, i) => entry(`${directory}/file-${(page - 1) * 250 + i}.bin`)), page_number: page, page_size: 250, total_entries: 1200, total_pages: 5 });
  });
  const detail = await provider().commit(key, before);
  assert.equal(detail.files.length, 1200); assert.ok(detail.files.some(file => file.path.endsWith('/file-1199.bin')));
});

test('incomplete upstream pages fail instead of returning a misleading complete directory', async t => {
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input);
    return request.url.endsWith('/branches') ? branches() : json({ entries: [], page_number: 1, page_size: 250, total_entries: 500, total_pages: 2 });
  });
  await assert.rejects(() => provider().tree(key, 'main', ''), error => error instanceof ApiError && error.code === 'DIRECTORY_INCOMPLETE');
});

test('an external workspace never guesses main when multiple branches share its base commit', async t => {
  const workspaceId = '22222222-2222-4222-8222-222222222222';
  const emptyGroup = { entries: [], page_number: 1, page_size: 1000, total_entries: 0, total_pages: 0 };
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input), pathname = new URL(request.url).pathname;
    if (pathname.endsWith('/branches')) return json({ branches: [{ name: 'main', commit_id: before }, { name: 'feature', commit_id: before }] });
    if (pathname.endsWith('/changes')) return json({ staged: { added_dirs: {}, added_files: emptyGroup, modified_files: emptyGroup, removed_files: emptyGroup } });
    if (pathname.endsWith(`/workspaces/${workspaceId}`)) return json({ workspace: { id: workspaceId, name: 'CLI-created feature draft', commit: commit(before) } });
    throw new Error(`Unexpected fixture request: ${pathname}`);
  });
  const live = provider(), workspace = await live.workspace(key, workspaceId);
  assert.equal(workspace.branch, '');
  await assert.rejects(() => live.commitWorkspace(key, workspaceId, 'Must not guess a target'), error => error instanceof ApiError && error.code === 'WORKSPACE_BRANCH_UNKNOWN');
});

test('merge conflicts are rejected by the native preflight before any CLI or push can run', async t => {
  const requests: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input), pathname = decodeURIComponent(new URL(request.url).pathname); requests.push(pathname);
    if (pathname.endsWith('/branches')) return branches();
    assert.equal(pathname, `${base}/merge/main..source`);
    return json({ is_mergeable: false, conflicts: [{ path: 'data/labels.csv' }], commits: [] });
  });
  await assert.rejects(() => provider().merge(key, 'source', 'main'), error => error instanceof ApiError && error.code === 'MERGE_CONFLICT' && error.status === 409);
  assert.equal(requests.length, 3);
});

test('a queued merge cannot silently switch to moved branch heads', async t => {
  let count = 0;
  t.mock.method(globalThis, 'fetch', async () => { count++; return branches(); });
  await assert.rejects(() => provider().merge(key, 'source', 'main', { expectedSourceCommitId: before, expectedTargetCommitId: before }), error => error instanceof ApiError && error.code === 'MERGE_VERSION_CONFLICT');
  assert.equal(count, 1);
});

test('managed CLI push rejects collaborator bypass and private job output requires repository access', async t => {
  const root = path.join(projectRoot, '.data/tests'); await mkdir(root, { recursive: true }); const directory = await mkdtemp(path.join(root, 'queued-access-'));
  const owner = 'owner-token-for-queued-access-tests', config = loadConfig({ DEMO_MODE: 'false', DEMO_DATA_FILE: path.join(directory, 'state.json'), BFF_TOKEN: owner });
  const demo = new DemoProvider(config.demoFile), app = await createApp(config, demo); t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const repo = '/api/repos/oxen/visual-search', bearer = (token = owner) => ({ authorization: `Bearer ${token}` });
  const grant = await app.inject({ method: 'POST', url: `${repo}/access`, headers: bearer(), payload: { name: 'Queued editor', role: 'editor' } }); assert.equal(grant.statusCode, 201, grant.body); const editor = grant.json();
  let release!: () => void, started!: () => void, calls = 0; const barrier = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { started = resolve; });
  demo.push = async () => { calls++; started(); await barrier; return 'completed'; };
  const first = await app.inject({ method: 'POST', url: `${repo}/push`, headers: bearer(), payload: { branch: 'main' } }); assert.equal(first.statusCode, 200, first.body); await ready;
  const second = await app.inject({ method: 'POST', url: `${repo}/push`, headers: bearer(editor.token), payload: { branch: 'main' } }); assert.equal(second.statusCode, 403, second.body); assert.equal(second.json().error.code, 'MANAGED_PUSH_REQUIRED');
  const revoked = await app.inject({ method: 'DELETE', url: `${repo}/access/${editor.collaborator.id}`, headers: bearer() }); assert.equal(revoked.statusCode, 200, revoked.body); release();
  let job = first.json(); for (let i = 0; i < 100 && ['queued', 'running'].includes(job.status); i++) { await new Promise(resolve => setTimeout(resolve, 5)); job = (await app.inject({ url: `/api/jobs/${job.id}`, headers: bearer() })).json(); }
  assert.equal(job.status, 'succeeded'); assert.equal(calls, 1);
  const foreign = await app.inject({ method: 'POST', url: '/api/repos/oxen/document-corpus/access', headers: bearer(), payload: { name: 'Foreign viewer', role: 'viewer' } }); assert.equal(foreign.statusCode, 201, foreign.body);
  assert.equal((await app.inject({ url: `/api/jobs/${first.json().id}`, headers: bearer(foreign.json().token) })).statusCode, 403);
});

test('public read access never authorizes the owner model; authenticated viewers retain local rule queries', async t => {
  const root = path.join(projectRoot, '.data/tests'); await mkdir(root, { recursive: true }); const directory = await mkdtemp(path.join(root, 'guest-model-'));
  const owner = 'owner-token-for-public-model-guard-tests', config = loadConfig({ DEMO_MODE: 'true', DEMO_DATA_FILE: path.join(directory, 'state.json'), BFF_TOKEN: owner }), app = await createApp(config);
  const previousBinary = process.env.OXEN_QUERY_CODEX_BIN;
  // A missing binary makes a regression safe: this test can never launch the real Codex/model.
  process.env.OXEN_QUERY_CODEX_BIN = path.join(directory, 'model-must-not-start.exe');
  t.after(async () => { if (previousBinary === undefined) delete process.env.OXEN_QUERY_CODEX_BIN; else process.env.OXEN_QUERY_CODEX_BIN = previousBinary; await app.close(); await rm(directory, { recursive: true, force: true }); });
  const repo = '/api/repos/oxen/visual-search', headers = { 'x-oxen-request': 'web' };
  const opened = await app.inject({ method: 'PATCH', url: `${repo}/settings`, headers: { authorization: `Bearer ${owner}` }, payload: { visibility: 'public' } }); assert.equal(opened.statusCode, 200, opened.body);
  const payload = { ref: 'main', path: 'data/annotations.csv', prompt: 'count' };
  assert.equal((await app.inject({ url: repo })).statusCode, 200);
  const viewer = await app.inject({ method: 'POST', url: `${repo}/access`, headers: { authorization: `Bearer ${owner}` }, payload: { name: 'Model guard viewer', role: 'viewer' } }); assert.equal(viewer.statusCode, 201, viewer.body);
  const local = await app.inject({ method: 'POST', url: `${repo}/query`, headers: { authorization: `Bearer ${viewer.json().token}` }, payload: { ...payload, engine: 'rules' } }); assert.equal(local.statusCode, 200, local.body);
  const model = await app.inject({ method: 'POST', url: `${repo}/query`, headers, payload: { ...payload, engine: 'model', allowExternalSchema: true } }); assert.equal(model.statusCode, 401, model.body); assert.ok(['AUTH_REQUIRED', 'QUERY_AUTH_REQUIRED'].includes(model.json().error.code));
  const ownerWithoutConsent = await app.inject({ method: 'POST', url: `${repo}/query`, headers: { authorization: `Bearer ${owner}` }, payload: { ...payload, engine: 'model' } }); assert.equal(ownerWithoutConsent.statusCode, 403); assert.equal(ownerWithoutConsent.json().error.code, 'QUERY_SCHEMA_CONSENT_REQUIRED');
});

test('a policy-changing direct merge rechecks admin after an actor is downgraded during provider preparation', async t => {
  const root = path.join(projectRoot, '.data/tests'); await mkdir(root, { recursive: true }); const directory = await mkdtemp(path.join(root, 'merge-downgrade-'));
  const owner = 'owner-token-for-merge-downgrade-tests', config = loadConfig({ DEMO_MODE: 'false', DEMO_DATA_FILE: path.join(directory, 'state.json'), BFF_TOKEN: owner });
  const demo = new DemoProvider(config.demoFile), app = await createApp(config, demo); t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const repo = '/api/repos/oxen/visual-search', repoKey = { namespace: 'oxen', repo: 'visual-search' }, bearer = (token = owner) => ({ authorization: `Bearer ${token}` });
  const granted = await app.inject({ method: 'POST', url: `${repo}/access`, headers: bearer(), payload: { name: 'Initially admin', role: 'admin' } }); assert.equal(granted.statusCode, 201, granted.body); const admin = granted.json();
  await demo.createBranch(repoKey, 'policy-source', 'main'); await demo.createBranch(repoKey, 'policy-target', 'main');
  const policy = JSON.parse((await demo.raw(repoKey, 'policy-source', '.oxenweb/repository.json')).content.toString('utf8')); policy.description = 'A reviewed policy change';
  const workspace = await demo.createWorkspace(repoKey, 'Policy source change', 'policy-source'); await demo.writeWorkspace(repoKey, workspace.id, '.oxenweb/repository.json', Buffer.from(JSON.stringify(policy))); await demo.commitWorkspace(repoKey, workspace.id, 'Prepare policy merge');
  const originalHead = (await demo.branches(repoKey)).find(branch => branch.name === 'policy-target')!.commitId;
  let entered!: () => void, release!: () => void, writes = 0; const ready = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const original = demo.merge.bind(demo);
  demo.merge = async (key, source, target, options?: MergeOptions) => { entered(); await gate; await options?.beforeWrite?.(); writes++; return original(key, source, target); };
  const response = await app.inject({ method: 'POST', url: `${repo}/merge`, headers: bearer(admin.token), payload: { source: 'policy-source', target: 'policy-target' } }); assert.equal(response.statusCode, 200, response.body); await ready;
  const downgraded = await app.inject({ method: 'PATCH', url: `${repo}/access/${admin.collaborator.id}`, headers: bearer(), payload: { role: 'editor' } }); assert.equal(downgraded.statusCode, 200, downgraded.body); release();
  let job = response.json(); for (let i = 0; i < 100 && ['queued', 'running'].includes(job.status); i++) { await new Promise(resolve => setTimeout(resolve, 5)); job = (await app.inject({ url: `/api/jobs/${job.id}`, headers: bearer() })).json(); }
  assert.equal(job.status, 'failed'); assert.equal(writes, 0); assert.equal((await demo.branches(repoKey)).find(branch => branch.name === 'policy-target')!.commitId, originalHead);
});
