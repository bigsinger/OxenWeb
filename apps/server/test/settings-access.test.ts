import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { DemoProvider } from '../src/demo.js';
import { RepositorySettingsService } from '../src/repository-settings.js';
import type { RepositorySettingsState, RepositoryTokenGrant } from '../../../packages/shared/src/index.js';

const base = '/api/repos/oxen/visual-search';
const key = { namespace: 'oxen', repo: 'visual-search' };
const ownerToken = 'owner-token-for-repository-access-tests';
const bearer = (token = ownerToken) => ({ authorization: `Bearer ${token}` });
const web = { 'x-oxen-request': 'web' };
async function setup(t: { after: (callback: () => Promise<void>) => void }, localOwner = false) {
  const directory = path.resolve('.data/tests'); await mkdir(directory, { recursive: true });
  const temporary = await mkdtemp(path.join(directory, 'settings-access-'));
  const config = loadConfig({ DEMO_MODE: 'true', DEMO_DATA_FILE: path.join(temporary, 'state.json'), ...(!localOwner ? { BFF_TOKEN: ownerToken } : {}) });
  const provider = new DemoProvider(config.demoFile);
  const app = await createApp(config, provider);
  t.after(async () => { await app.close(); await rm(temporary, { recursive: true, force: true }); });
  return { app, provider, temporary, config, headers: localOwner ? web : bearer() };
}

test('settings create a versioned Oxen file, validate branch names, and survive restart', async t => {
  const { app, provider, config } = await setup(t);
  const initial = (await app.inject({ url: `${base}/settings`, headers: bearer() })).json<RepositorySettingsState>();
  assert.equal(initial.persisted, false);
  const created = await app.inject({ method: 'POST', url: `${base}/branches`, headers: bearer(), payload: { name: 'review', from: 'main' } });
  assert.equal(created.statusCode, 201);
  const saved = await app.inject({ method: 'PATCH', url: `${base}/settings`, headers: bearer(), payload: { description: 'Versioned repository settings', tags: ['reviewed'], defaultBranch: 'review', visibility: 'public', expectedCommit: initial.commitId } });
  assert.equal(saved.statusCode, 200, saved.body);
  const settings = saved.json<RepositorySettingsState>();
  assert.equal(settings.persisted, true); assert.equal(settings.configurationBranch, 'main'); assert.notEqual(settings.commitId, initial.commitId);
  const file = await provider.raw(key, settings.commitId, '.oxenweb/repository.json');
  const policy = JSON.parse(file.content.toString('utf8'));
  assert.equal(policy.description, 'Versioned repository settings'); assert.equal(policy.defaultBranch, 'review'); assert.equal(policy.visibility, 'public');
  assert.ok(!('expectedCommit' in policy));
  const history = await provider.commits(key, 'main'); assert.ok(history[0]!.message.includes('Update repository settings'));
  assert.equal((await app.inject({ url: base, headers: bearer() })).json().defaultBranch, 'review');
  const badBranch = await app.inject({ method: 'PATCH', url: `${base}/settings`, headers: bearer(), payload: { defaultBranch: 'missing-branch' } });
  assert.equal(badBranch.statusCode, 400);
  const stale = await app.inject({ method: 'PATCH', url: `${base}/settings`, headers: bearer(), payload: { description: 'stale overwrite', expectedCommit: initial.commitId } });
  assert.equal(stale.statusCode, 409);
  const restarted = await createApp(config); t.after(() => restarted.close());
  const readback = (await restarted.inject({ url: base, headers: bearer() })).json();
  assert.equal(readback.description, 'Versioned repository settings'); assert.deepEqual(readback.tags, ['reviewed']); assert.equal(readback.defaultBranch, 'review');
});

test('full hooks enforce viewer/editor/admin roles and protect versioned policy from indirect edits', async t => {
  const { app, temporary } = await setup(t);
  const grant = async (role: 'viewer' | 'editor' | 'admin') => {
    const response = await app.inject({ method: 'POST', url: `${base}/access`, headers: bearer(), payload: { name: `Test ${role}`, role } });
    assert.equal(response.statusCode, 201, response.body); return response.json<RepositoryTokenGrant>();
  };
  const viewer = await grant('viewer'), editor = await grant('editor'), admin = await grant('admin');
  assert.equal((await app.inject({ url: base, headers: bearer(viewer.token) })).statusCode, 200);
  const queried = await app.inject({ method: 'POST', url: `${base}/query`, headers: bearer(viewer.token), payload: { ref: 'main', path: 'data/annotations.csv', prompt: 'count', engine: 'rules' } });
  assert.equal(queried.statusCode, 200, queried.body);
  assert.equal((await app.inject({ method: 'POST', url: `${base}/branches`, headers: bearer(viewer.token), payload: { name: 'forbidden', from: 'main' } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: `${base}/branches`, headers: bearer(editor.token), payload: { name: 'editor-work', from: 'main' } })).statusCode, 201);
  assert.equal((await app.inject({ method: 'PATCH', url: base, headers: bearer(editor.token), payload: { visibility: 'public' } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'PATCH', url: `${base}/settings`, headers: bearer(admin.token), payload: { description: 'Admin updated this' } })).statusCode, 200);
  assert.equal((await app.inject({ url: `${base}/access`, headers: bearer(viewer.token) })).statusCode, 403);
  const workspace = (await app.inject({ method: 'POST', url: `${base}/workspaces`, headers: bearer(editor.token), payload: { name: 'ordinary-editor-draft', branch: 'main' } })).json();
  const escalation = await app.inject({ method: 'PUT', url: `${base}/workspaces/${workspace.id}/files`, headers: bearer(editor.token), payload: { path: '.oxenweb/repository.json', content: '{"visibility":"public"}' } });
  assert.equal(escalation.statusCode, 403);
  const stored = await readFile(path.join(temporary, 'access-credentials.json'), 'utf8');
  for (const value of [viewer.token, editor.token, admin.token]) assert.equal(stored.includes(value), false);
  assert.match(stored, /"hash": "[a-f0-9]{64}"/);
  const access = (await app.inject({ url: `${base}/access`, headers: bearer() })).body;
  assert.equal(access.includes(viewer.token), false); assert.equal(access.includes('"hash"'), false);
});

test('revocation invalidates bearer and established sessions immediately and persists across restart', async t => {
  const { app, config } = await setup(t);
  const granted = (await app.inject({ method: 'POST', url: `${base}/access`, headers: bearer(), payload: { name: 'Temporary reviewer', role: 'viewer' } })).json<RepositoryTokenGrant>();
  const login = await app.inject({ method: 'POST', url: '/api/session', payload: { token: granted.token } });
  assert.equal(login.statusCode, 200); const cookie = String(login.headers['set-cookie']).split(';')[0]!;
  assert.equal((await app.inject({ url: base, headers: { cookie } })).statusCode, 200);
  const revoked = await app.inject({ method: 'DELETE', url: `${base}/access/${granted.collaborator.id}`, headers: bearer() });
  assert.equal(revoked.statusCode, 200, revoked.body);
  assert.equal((await app.inject({ url: base, headers: { cookie } })).statusCode, 401);
  assert.equal((await app.inject({ url: base, headers: bearer(granted.token) })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/session', payload: { token: granted.token } })).statusCode, 401);
  const restarted = await createApp(config); t.after(() => restarted.close());
  assert.equal((await restarted.inject({ method: 'POST', url: '/api/session', payload: { token: granted.token } })).statusCode, 401);
});

test('public guests get read access only, private lists are filtered, and role changes take effect', async t => {
  const { app } = await setup(t);
  assert.equal((await app.inject(base)).statusCode, 401);
  const opened = await app.inject({ method: 'PATCH', url: `${base}/settings`, headers: bearer(), payload: { visibility: 'public' } });
  assert.equal(opened.statusCode, 200, opened.body);
  assert.equal((await app.inject(base)).statusCode, 200);
  const repositories = (await app.inject('/api/repos')).json();
  assert.equal(repositories.length, 1); assert.equal(repositories[0].name, 'visual-search');
  assert.equal((await app.inject({ method: 'POST', url: `${base}/branches`, headers: web, payload: { name: 'guest-write', from: 'main' } })).statusCode, 401);
  const editor = (await app.inject({ method: 'POST', url: `${base}/access`, headers: bearer(), payload: { name: 'Role can change', role: 'editor' } })).json<RepositoryTokenGrant>();
  const demote = await app.inject({ method: 'PATCH', url: `${base}/access/${editor.collaborator.id}`, headers: bearer(), payload: { role: 'viewer' } }); assert.equal(demote.statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: `${base}/branches`, headers: bearer(editor.token), payload: { name: 'no-longer-editor', from: 'main' } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'PATCH', url: `${base}/settings`, headers: bearer(), payload: { visibility: 'private' } })).statusCode, 200);
  assert.equal((await app.inject(base)).statusCode, 401);
});

test('local owner compatibility never elevates invalid credentials or a revoked collaborator session', async t => {
  const { app } = await setup(t, true);
  const status = (await app.inject('/api/status')).json(); assert.equal(status.identity.kind, 'owner'); assert.equal(status.identity.source, 'local');
  assert.equal((await app.inject({ url: base, headers: { authorization: 'Bearer invalid' } })).statusCode, 401);
  const granted = (await app.inject({ method: 'POST', url: `${base}/access`, headers: web, payload: { name: 'Local reviewer', role: 'viewer' } })).json<RepositoryTokenGrant>();
  const login = await app.inject({ method: 'POST', url: '/api/session', payload: { token: granted.token } }); const cookie = String(login.headers['set-cookie']).split(';')[0]!;
  assert.equal((await app.inject({ url: '/api/status', headers: { cookie } })).json().identity.kind, 'collaborator');
  assert.equal((await app.inject({ method: 'DELETE', url: `${base}/access/${granted.collaborator.id}`, headers: web })).statusCode, 200);
  assert.equal((await app.inject({ url: base, headers: { cookie } })).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/status', headers: { cookie } })).json().identity.kind, 'guest');
});

test('a persisted configuration branch fails closed after removal instead of adopting another branch on restart', async t => {
  const { app, provider, temporary } = await setup(t);
  const changed = await app.inject({ method: 'PATCH', url: `${base}/settings`, headers: bearer(), payload: { description: 'Pin the policy branch' } });
  assert.equal(changed.statusCode, 200, changed.body);
  const pointerFile = path.join(temporary, 'repository-policy-branches.json');
  const pointers = JSON.parse(await readFile(pointerFile, 'utf8')); assert.equal(pointers.branches['oxen/visual-search'], 'main');
  const original = provider.branches.bind(provider);
  provider.branches = async repo => (await original(repo)).filter(branch => branch.name !== 'main');
  const restartedSettings = new RepositorySettingsService(provider, pointerFile);
  await assert.rejects(() => restartedSettings.read(key), error => error instanceof Error && 'code' in error && error.code === 'POLICY_BRANCH_MISSING');
});

test('real Oxen stores settings/default branch/access policy as commits and enforces independent roles', { skip: process.env.OXEN_SETTINGS_LIVE_TEST !== 'true', timeout: 180_000 }, async t => {
  process.loadEnvFile(path.resolve('infra/oxen/local.env'));
  const directory = path.resolve('.data/tests'); await mkdir(directory, { recursive: true });
  const temporary = await mkdtemp(path.join(directory, 'settings-access-live-'));
  const config = loadConfig({ ...process.env, DEMO_MODE: 'false', DEMO_DATA_FILE: path.join(temporary, 'state.json'), OXEN_CLI_ROOT: path.join(temporary, 'clones'), BFF_TOKEN: ownerToken });
  const app = await createApp(config); t.after(async () => { await app.close(); await rm(temporary, { recursive: true, force: true }); });
  const name = `settings-access-check-${Date.now()}`, endpoint = `/api/repos/local/${name}`;
  const created = await app.inject({ method: 'POST', url: '/api/repos', headers: bearer(), payload: { namespace: 'local', name, description: 'Dedicated live repository for settings and access verification', visibility: 'private' } });
  assert.equal(created.statusCode, 201, created.body);
  const initial = (await app.inject({ url: `${endpoint}/settings`, headers: bearer() })).json<RepositorySettingsState>();
  assert.equal(initial.persisted, true);
  const branch = await app.inject({ method: 'POST', url: `${endpoint}/branches`, headers: bearer(), payload: { name: 'review', from: 'main' } }); assert.equal(branch.statusCode, 201, branch.body);
  const updated = await app.inject({ method: 'PATCH', url: `${endpoint}/settings`, headers: bearer(), payload: { description: 'Native Oxen versioned settings verified', tags: ['access-validation'], defaultBranch: 'review', visibility: 'private', expectedCommit: initial.commitId } });
  assert.equal(updated.statusCode, 200, updated.body); const state = updated.json<RepositorySettingsState>();
  assert.equal(state.configurationBranch, 'main'); assert.equal(state.policy.defaultBranch, 'review'); assert.notEqual(state.commitId, initial.commitId);
  const upstream = await fetch(`${config.upstream}/api/repos/local/${name}/file/${state.commitId}/.oxenweb/repository.json`);
  assert.equal(upstream.status, 200); const raw = await upstream.json() as { defaultBranch: string; description: string };
  assert.equal(raw.defaultBranch, 'review'); assert.equal(raw.description, 'Native Oxen versioned settings verified');
  assert.equal((await app.inject({ url: endpoint, headers: bearer() })).json().defaultBranch, 'review');
  assert.equal((await app.inject({ method: 'PATCH', url: `${endpoint}/settings`, headers: bearer(), payload: { description: 'stale', expectedCommit: initial.commitId } })).statusCode, 409);
  const grants = new Map<string, RepositoryTokenGrant>();
  for (const role of ['viewer', 'editor', 'admin'] as const) {
    const response = await app.inject({ method: 'POST', url: `${endpoint}/access`, headers: bearer(), payload: { name: `Live ${role}`, role } });
    assert.equal(response.statusCode, 201, response.body); grants.set(role, response.json<RepositoryTokenGrant>());
  }
  const viewer = grants.get('viewer')!, editor = grants.get('editor')!, admin = grants.get('admin')!;
  assert.equal((await app.inject({ url: endpoint, headers: bearer(viewer.token) })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: `${endpoint}/workspaces`, headers: bearer(viewer.token), payload: { name: 'forbidden-write', branch: 'review' } })).statusCode, 403);
  const draft = await app.inject({ method: 'POST', url: `${endpoint}/workspaces`, headers: bearer(editor.token), payload: { name: 'editor-access-check', branch: 'review' } });
  assert.equal(draft.statusCode, 201, draft.body); const workspace = draft.json();
  assert.equal((await app.inject({ method: 'PUT', url: `${endpoint}/workspaces/${workspace.id}/files`, headers: bearer(editor.token), payload: { path: '.oxenweb/repository.json', content: '{}' } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'PUT', url: `${endpoint}/workspaces/${workspace.id}/files`, headers: bearer(editor.token), payload: { path: 'editor-check.txt', content: 'An editor may stage normal files.' } })).statusCode, 200);
  assert.equal((await app.inject({ method: 'PATCH', url: `${endpoint}/settings`, headers: bearer(admin.token), payload: { tags: ['admin-role-verified'] } })).statusCode, 200);
  const login = await app.inject({ method: 'POST', url: '/api/session', payload: { token: viewer.token } }); assert.equal(login.statusCode, 200);
  const cookie = String(login.headers['set-cookie']).split(';')[0]!;
  assert.equal((await app.inject({ method: 'DELETE', url: `${endpoint}/access/${viewer.collaborator.id}`, headers: bearer() })).statusCode, 200);
  assert.equal((await app.inject({ url: endpoint, headers: { cookie } })).statusCode, 401);
  assert.equal((await app.inject({ url: endpoint, headers: bearer(viewer.token) })).statusCode, 401);
  const opened = await app.inject({ method: 'PATCH', url: `${endpoint}/settings`, headers: bearer(), payload: { visibility: 'public' } }); assert.equal(opened.statusCode, 200, opened.body);
  assert.equal((await app.inject(endpoint)).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: `${endpoint}/workspaces`, headers: web, payload: { name: 'guest-write', branch: 'review' } })).statusCode, 401);
  assert.equal((await app.inject({ method: 'PATCH', url: `${endpoint}/settings`, headers: bearer(), payload: { visibility: 'private' } })).statusCode, 200);
  const restarted = await createApp(config); t.after(() => restarted.close());
  const restored = await restarted.inject({ url: `${endpoint}/settings`, headers: bearer() }); assert.equal(restored.statusCode, 200, restored.body);
  assert.equal(restored.json().policy.defaultBranch, 'review'); assert.equal(restored.json().configurationBranch, 'main');
  assert.equal((await restarted.inject({ method: 'POST', url: '/api/session', payload: { token: viewer.token } })).statusCode, 401);
  const credentials = await readFile(path.join(temporary, 'access-credentials.json'), 'utf8');
  for (const grant of grants.values()) assert.equal(credentials.includes(grant.token), false);
  console.log(JSON.stringify({ repository: `local/${name}`, configurationBranch: 'main', defaultBranch: 'review', storagePath: '.oxenweb/repository.json', versionedMetadataReadFromUpstream: true, independentRolesVerified: true, revokedSessionRejected: true, publicGuestReadOnly: true, restartedPolicyRetained: true }));
});
