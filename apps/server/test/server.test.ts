import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { runCli, JobQueue } from '../src/cli.js';
import { managedRepo, safeFilePath } from '../src/safety.js';
import { parseDelimited } from '../src/preview.js';
import { ExtensionStore } from '../src/extensions.js';

const web = { 'x-oxen-request': 'web' };
const base = '/api/repos/oxen/visual-search';
async function temporary(t: { after: (fn: () => Promise<void>) => void }) {
  const root = path.resolve('.data/tests');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'oxen-web-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('demo workspace commit changes the actual snapshot and survives restart', async t => {
  const directory = await temporary(t);
  const config = loadConfig({ DEMO_MODE: 'true', DEMO_DATA_FILE: path.join(directory, 'state.json') });
  const app = await createApp(config);
  const workspace = (await app.inject({ method: 'POST', url: `${base}/workspaces`, headers: web, payload: { name: 'test-workspace', branch: 'main' } })).json();
  assert.ok(workspace.id);
  const staged = await app.inject({ method: 'PUT', url: `${base}/workspaces/${workspace.id}/files`, headers: web, payload: { path: 'notes/test.txt', content: 'A durable dataset note.\n' } });
  assert.equal(staged.statusCode, 200);
  assert.deepEqual(staged.json().changes, [{ path: 'notes/test.txt', status: 'added' }]);
  const preview = await app.inject(`${base}/workspaces/${workspace.id}/file?path=notes/test.txt`);
  assert.equal(preview.json().text, 'A durable dataset note.\n');
  const committed = await app.inject({ method: 'POST', url: `${base}/workspaces/${workspace.id}/commit`, headers: web, payload: { message: 'Add dataset note' } });
  assert.equal(committed.statusCode, 200);
  const detail = (await app.inject(`${base}/commits/${committed.json().id}`)).json();
  assert.equal(detail.files[0].path, 'notes/test.txt');
  assert.equal(detail.files[0].after, 'A durable dataset note.\n');
  await app.close();
  const restarted = await createApp(config);
  t.after(() => restarted.close());
  assert.equal((await restarted.inject(`${base}/file?ref=main&path=notes/test.txt`)).json().text, 'A durable dataset note.\n');
  assert.equal((await restarted.inject(`${base}/workspaces/${workspace.id}`)).json().changes.length, 0);
});

test('demo merge rejects conflicting edits and preserves target content', async t => {
  const directory = await temporary(t), app = await createApp(loadConfig({ DEMO_MODE: 'true', DEMO_DATA_FILE: path.join(directory, 'state.json') }));
  t.after(() => app.close());
  const request = (method: 'POST' | 'PUT', url: string, payload: unknown) => app.inject({ method, url, headers: web, payload: payload as Record<string, unknown> });
  assert.equal((await request('POST', `${base}/branches`, { name: 'feature', from: 'main' })).statusCode, 201);
  for (const branch of ['main', 'feature']) {
    const workspace = (await request('POST', `${base}/workspaces`, { name: branch, branch })).json();
    await request('PUT', `${base}/workspaces/${workspace.id}/files`, { path: 'README.md', content: `Changed on ${branch}` });
    await request('POST', `${base}/workspaces/${workspace.id}/commit`, { message: `Edit on ${branch}` });
  }
  const merged = await request('POST', `${base}/merge`, { source: 'feature', target: 'main' });
  assert.equal(merged.statusCode, 409);
  assert.equal(merged.json().error.code, 'MERGE_CONFLICT');
  assert.equal((await app.inject(`${base}/file?ref=main&path=README.md`)).json().text, 'Changed on main');
});

test('BFF token authenticates sessions and blocks cross-origin or unprotected writes', async t => {
  const directory = await temporary(t), token = 'a-test-token-at-least-16-characters';
  const app = await createApp(loadConfig({ DEMO_MODE: 'true', DEMO_DATA_FILE: path.join(directory, 'state.json'), BFF_TOKEN: token }));
  t.after(() => app.close());
  const publicList=await app.inject('/api/repos');
  assert.equal(publicList.statusCode,200);assert.deepEqual(publicList.json(),[]);
  assert.equal((await app.inject(base)).statusCode,401);
  assert.equal((await app.inject('/api/status')).json().authenticated, false);
  assert.equal((await app.inject({ method: 'POST', url: `${base}/branches`, headers: { host: 'untrusted.example', origin: 'http://untrusted.example', ...web, authorization: `Bearer ${token}` }, payload: { name: 'rebound', from: 'main' } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/api/session', payload: { token: 'wrong' } })).statusCode, 401);
  const login = await app.inject({ method: 'POST', url: '/api/session', payload: { token } });
  const cookie = String(login.headers['set-cookie']).split(';')[0]!;
  assert.ok(String(login.headers['set-cookie']).includes('HttpOnly'));
  assert.equal((await app.inject({ url: '/api/repos', headers: { cookie } })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: `${base}/branches`, headers: { cookie }, payload: { name: 'safe', from: 'main' } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: `${base}/branches`, headers: { ...web, cookie, origin: 'https://evil.example' }, payload: { name: 'safe', from: 'main' } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: `${base}/branches`, headers: { authorization: `Bearer ${token}` }, payload: { name: 'safe', from: 'main' } })).statusCode, 201);
  await app.inject({ method: 'DELETE', url: '/api/session', headers: { cookie } });
  assert.deepEqual((await app.inject({url:'/api/repos',headers:{cookie}})).json(),[]);
  assert.equal((await app.inject({url:base,headers:{cookie}})).statusCode,401);
});

test('file paths cannot escape repository or expose Oxen internals', async t => {
  for (const filename of ['../secrets', '/etc/passwd', 'C:/Users/file', 'a\\..\\b', '.oxen/config.toml', 'a//b', 'a/./b', 'a/.git/config']) assert.throws(() => safeFilePath(filename));
  const directory = await temporary(t), app = await createApp(loadConfig({ DEMO_MODE: 'true', DEMO_DATA_FILE: path.join(directory, 'state.json') }));
  t.after(() => app.close());
  assert.equal((await app.inject(`${base}/file?ref=main&path=..%2Fsecrets`)).statusCode, 400);
  const root = path.join(directory, 'clones');
  await mkdir(path.join(root, 'user', 'repo'), { recursive: true });
  await assert.rejects(() => managedRepo(root, 'user', 'repo'), /no .oxen/);
  await mkdir(path.join(root, 'user', 'repo', '.oxen'));
  assert.equal(await managedRepo(root, 'user', 'repo'), await import('node:fs/promises').then(fs => fs.realpath(path.join(root, 'user', 'repo'))));
  await assert.rejects(() => managedRepo(root, '..', 'repo'), /letters/);
});

test('CLI runner never invokes a shell and enforces timeout/output limits', async t => {
  const directory = await temporary(t), options = { binary: process.execPath, timeoutMs: 2000, maxOutputBytes: 1024 };
  const output = await runCli(['-e', 'process.stdout.write(process.argv[1])', '$(echo exposed) & value'], directory, options);
  assert.equal(output, '$(echo exposed) & value');
  await assert.rejects(() => runCli(['-e', 'setInterval(()=>{}, 1000)'], directory, { ...options, timeoutMs: 30 }), /timed out/);
  await assert.rejects(() => runCli(['-e', 'process.stdout.write("x".repeat(10000))'], directory, options), /output exceeded/);
});

test('per-repository jobs serialize writes while independent repositories progress', async () => {
  const jobs = new JobQueue(), order: string[] = [];
  let finish!: () => void;
  const barrier = new Promise<void>(resolve => { finish = resolve; });
  const first = jobs.add('one', 'first', async () => { order.push('first-start'); await barrier; order.push('first-end'); return 'done'; });
  const second = jobs.add('one', 'second', async () => { order.push('second'); return 'done'; });
  const independent = jobs.add('two', 'independent', async () => { order.push('independent'); return 'done'; });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(jobs.get(first.id).status, 'running');
  assert.equal(jobs.get(second.id).status, 'queued');
  assert.equal(jobs.get(independent.id).status, 'succeeded');
  finish(); await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(order, ['first-start', 'independent', 'first-end', 'second']);
});

test('annotations and metadata persist with commit-scoped annotation identity', async t => {
  const directory = await temporary(t), filename = path.join(directory, 'extensions.json'), store = new ExtensionStore(filename), key = { namespace: 'team', repo: 'dataset' };
  await store.init();
  await store.updateMetadata(key, { description: 'Data provenance', tags: ['verified'] });
  const annotation = { path: 'data.csv', rowId: 'row-1', label: 'reviewed', note: '' };
  await store.annotate(key, 'commit-a', annotation);
  await store.annotate(key, 'commit-b', { ...annotation, label: 'rejected' });
  const next = new ExtensionStore(filename); await next.init();
  assert.equal(next.metadata(key).description, 'Data provenance');
  assert.equal(next.annotations(key, 'commit-a', 'data.csv')[0]?.label, 'reviewed');
  assert.equal(next.annotations(key, 'commit-b', 'data.csv')[0]?.label, 'rejected');
  assert.equal(next.annotations(key, 'commit-c').length, 0);
});

test('CSV quoted commas, escaped quotes and embedded newlines preserve table cells', () => {
  assert.deepEqual(parseDelimited('id,caption\r\n1,"A coast, with rocks"\r\n2,"A ""quiet""\nforest"\r\n'), [['id', 'caption'], ['1', 'A coast, with rocks'], ['2', 'A "quiet"\nforest']]);
});

test('live mode without configuration does not silently fall back to demo', async t => {
  const directory = await temporary(t), app = await createApp(loadConfig({ DEMO_DATA_FILE: path.join(directory, 'state.json') }));
  t.after(() => app.close());
  const status = (await app.inject('/api/status')).json();
  assert.equal(status.mode, 'live'); assert.equal(status.ready, false);
  const repos = await app.inject('/api/repos');
  assert.equal(repos.statusCode, 503); assert.equal(repos.json().error.code, 'NOT_CONFIGURED');
});
