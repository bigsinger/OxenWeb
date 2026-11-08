import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { loadConfig, projectRoot } from '../src/config.js';
import { DemoProvider } from '../src/demo.js';
import { listLabelTemplates } from '../src/label-templates.js';
import { validateLabelDocument } from '../src/labels.js';
import type { Provider } from '../src/provider.js';
import type { LabelSnapshotExport, LabelState, LabelTemplate } from '../../../packages/shared/src/index.js';

const headers = { 'x-oxen-request': 'web' }, base = '/api/repos/oxen/visual-search';
async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const root = path.join(projectRoot, '.data/tests'); await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'label-templates-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const config = loadConfig({ DEMO_MODE: 'true', DEMO_DATA_FILE: path.join(directory, 'state.json') });
  const provider = new DemoProvider(config.demoFile), app = await createApp(config, provider); t.after(() => app.close());
  const commit = provider.commitWorkspace.bind(provider); let writes = 0;
  provider.commitWorkspace = async (...args) => { writes++; return commit(...args); };
  const read = async (ref = 'main'): Promise<LabelState> => (await app.inject(`${base}/labels?ref=${ref}`)).json();
  const apply = (expectedCommit: string, templateId = 'prompt-injection', extra: Record<string, unknown> = {}) => app.inject({ method: 'POST', url: `${base}/labels/templates/apply`, headers, payload: { ref: 'main', expectedCommit, templateId, templateVersion: 1, ...extra } });
  return { app, config, provider, read, apply, writes: () => writes };
}

test('catalog is cumulative and validates all local schemas without assigning or rewriting benchmark truth', async t => {
  const { app } = await setup(t);
  const result = await app.inject('/api/label-templates'); assert.equal(result.statusCode, 200, result.body);
  const templates: LabelTemplate[] = result.json(); assert.equal(templates.length, 6);
  const safety = templates.find(template => template.id === 'ai-safety-core')!;
  const rowContextKeys = ['general.data_source', 'general.task_type', 'skill.provenance', 'skill.recommendation', 'drift.baseline_goal', 'drift.baseline_version'];
  for (const template of templates) {
    assert.equal(template.version, 1);
    assert.ok(template.columns.every(column => column.semanticKey && column.description && column.scopes.length));
    assert.ok(template.columns.every(column => column.type === 'text' || column.options?.every(option => option.description)));
    validateLabelDocument({ version: 1, columns: template.columns, assignments: [] });
    for (const column of template.columns.filter(column => rowContextKeys.includes(column.semanticKey))) assert.deepEqual(column.scopes, ['dataset', 'file', 'row']);
    if (template.category === 'domain') assert.ok(safety.columns.every(column => template.columns.some(candidate => candidate.semanticKey === column.semanticKey)));
  }
  assert.equal(safety.columns.find(column => column.semanticKey === 'ai.ground_truth_reference')?.type, 'text');
  assert.deepEqual(safety.columns.find(column => column.semanticKey === 'ai.human_judgment')?.options?.map(option => option.value), ['良性', '恶意', '不确定', '不适用']);
  const a = listLabelTemplates(); a[0]!.columns[0]!.name = 'changed'; assert.notEqual(listLabelTemplates()[0]?.columns[0]?.name, 'changed');
});

test('applying a cumulative template creates one CAS commit with provenance, preserved assignments and branch isolation', async t => {
  const { app, config, read, apply, writes } = await setup(t), original = await read();
  let response = await app.inject({ method: 'POST', url: `${base}/labels/columns`, headers, payload: { ref: 'main', expectedCommit: original.commitId, column: { id: 'custom', name: 'Existing custom label', type: 'text' } } });
  let state: LabelState = response.json();
  response = await app.inject({ method: 'POST', url: `${base}/labels/assignments`, headers, payload: { ref: 'main', expectedCommit: state.commitId, scope: 'dataset', values: { custom: 'preserve me' } } }); state = response.json();
  await app.inject({ method: 'POST', url: `${base}/branches`, headers, payload: { name: 'before-template', from: state.commitId } });
  const before = state, count = writes();
  response = await apply(before.commitId); assert.equal(response.statusCode, 200, response.body); state = response.json();
  assert.equal(writes() - count, 1); assert.equal(state.columns.length, 21);
  assert.deepEqual(state.assignments, before.assignments); assert.deepEqual(state.columns[0], before.columns[0]);
  assert.equal(state.templateApplications?.length, 1);
  const application = state.templateApplications![0]!;
  assert.equal(application.templateId, 'prompt-injection'); assert.equal(application.sourceCommitId, before.commitId);
  assert.equal(application.selectedKeys.length, 20); assert.equal(Object.keys(application.columnIds).length, 20);
  assert.equal((await read('before-template')).columns.length, 1); assert.equal((await read(before.commitId)).columns.length, 1);
  const detail = (await app.inject(`${base}/commits/${state.commitId}`)).json();
  assert.equal(detail.parentIds[0], before.commitId); assert.deepEqual(detail.files.map((file: { path: string }) => file.path), ['.oxenweb/labels.json']);
  const restarted = await createApp(config); t.after(() => restarted.close());
  assert.deepEqual((await restarted.inject(`${base}/labels?ref=main`)).json().templateApplications, state.templateApplications);
  const retry = await apply(state.commitId); assert.equal(retry.statusCode, 200, retry.body); assert.equal(retry.json().commitId, state.commitId); assert.equal(writes() - count, 1);
});

test('semantic reuse preserves customized names/types/options, selection is atomic, and provenance survives normal writes', async t => {
  const { app, read, apply, writes } = await setup(t); let state = await read();
  let response = await apply(state.commitId, 'general', { selectedKeys: ['general.review_status'] }); assert.equal(response.statusCode, 200, response.body); state = response.json();
  const original = state.columns[0]!;
  response = await app.inject({ method: 'POST', url: `${base}/labels/columns`, headers, payload: { ref: 'main', expectedCommit: state.commitId, column: { id: original.id, name: 'Team review status', type: 'single', options: [{ value: 'team_pending' }, { value: 'team_done' }] } } }); assert.equal(response.statusCode, 200, response.body); state = response.json();
  assert.equal(state.columns[0]?.semanticKey, original.semanticKey); assert.equal(state.columns[0]?.description, original.description);
  const customized = state.columns[0], application = state.templateApplications![0];
  response = await apply(state.commitId, 'ai-safety-core'); assert.equal(response.statusCode, 200, response.body); state = response.json();
  assert.equal(state.columns.length, 15); assert.deepEqual(state.columns.find(column => column.semanticKey === original.semanticKey), customized); assert.deepEqual(state.templateApplications![0], application);
  response = await app.inject({ method: 'POST', url: `${base}/labels/assignments`, headers, payload: { ref: 'main', expectedCommit: state.commitId, scope: 'dataset', values: { review_status: 'team_done' } } }); assert.equal(response.statusCode, 200, response.body); state = response.json();
  assert.equal(state.templateApplications?.length, 2);
  const before = state, count = writes();
  response = await app.inject({ method: 'POST', url: `${base}/labels/columns`, headers, payload: { ref: 'main', expectedCommit: state.commitId, column: { id: 'custom_collision', name: '注入目标', type: 'text' } } }); assert.equal(response.statusCode, 200, response.body); state = response.json();
  response = await apply(state.commitId); assert.equal(response.statusCode, 409, response.body); assert.equal(response.json().error.code, 'LABEL_TEMPLATE_CONFLICT');
  assert.equal(writes() - count, 1); assert.equal((await read()).commitId, state.commitId); assert.equal((await read()).columns.length, before.columns.length + 1);
});

test('invalid selection/version, stale concurrent writes and historical refs cannot partially apply templates', async t => {
  const { read, apply, writes } = await setup(t), initial = await read();
  for (const [extra, expected] of [[{ selectedKeys: [] }, 422], [{ selectedKeys: ['general.review_status', 'general.review_status'] }, 422], [{ selectedKeys: ['missing.key'] }, 422], [{ templateVersion: 2 }, 409], [{ templateId: 'missing' }, 404], [{ ref: initial.commitId }, 400]] as const) {
    const response = await apply(initial.commitId, 'general', extra); assert.equal(response.statusCode, expected, response.body);
    assert.equal((await read()).commitId, initial.commitId); assert.equal(writes(), 0);
  }
  const concurrent = await Promise.all([apply(initial.commitId, 'general'), apply(initial.commitId, 'sensitive-data')]);
  assert.deepEqual(concurrent.map(response => response.statusCode).sort(), [200, 409]); assert.equal(writes(), 1);
  const stale = await apply(initial.commitId, 'behavior-drift'); assert.equal(stale.statusCode, 409, stale.body); assert.equal(writes(), 1);
});

test('scope constraints keep legacy columns compatible and prevent misplaced new template judgments', async t => {
  const { app, read, apply } = await setup(t); let state = await read();
  let response = await apply(state.commitId, 'ai-safety-core'); assert.equal(response.statusCode, 200, response.body); state = response.json();
  response = await app.inject({ method: 'POST', url: `${base}/labels/assignments`, headers, payload: { ref: 'main', expectedCommit: state.commitId, scope: 'dataset', values: { human_judgment: '恶意' } } }); assert.equal(response.statusCode, 422, response.body); assert.equal(response.json().error.code, 'LABEL_COLUMN_SCOPE');
  assert.equal((await read()).commitId, state.commitId);
  validateLabelDocument({ version: 1, columns: [{ id: 'legacy', name: 'Legacy', type: 'text' }], assignments: [{ id: 'x', scope: 'dataset', values: { legacy: 'all scopes remain valid' } }] });
  const source = (await app.inject(`${base}/file?ref=main&path=data%2Fannotations.csv&pageSize=1`)).json();
  response = await app.inject({ method: 'POST', url: `${base}/labels/assignments`, headers, payload: { ref: 'main', expectedCommit: state.commitId, scope: 'row', path: 'data/annotations.csv', rowId: source.rowIds[0], values: { human_judgment: '不确定', confidence: '未知' } } }); assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().assignments[0].values.human_judgment, '不确定');
});

test('template maintenance requires organization authority in addition to data rights and CSRF protection', async t => {
  const root = path.join(projectRoot, '.data/tests'); await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'label-template-access-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const ownerToken = 'label-template-test-owner', owner = { authorization: `Bearer ${ownerToken}` };
  const config = loadConfig({ DEMO_MODE: 'true', DEMO_DATA_FILE: path.join(directory, 'state.json'), BFF_TOKEN: ownerToken });
  const app = await createApp(config); t.after(() => app.close());
  const tokens: Record<string, string> = {};
  const identities: Record<string, string> = {};
  for (const role of ['viewer', 'editor'] as const) {
    const response = await app.inject({ method: 'POST', url: `${base}/access`, headers: owner, payload: { name: role, role } }); assert.equal(response.statusCode, 201, response.body); tokens[role] = response.json().token; identities[role] = response.json().collaborator.id;
  }
  const current: LabelState = (await app.inject({ url: `${base}/labels?ref=main`, headers: owner })).json();
  const payload = { ref: 'main', expectedCommit: current.commitId, templateId: 'general', templateVersion: 1 };
  const denied = await app.inject({ method: 'POST', url: `${base}/labels/templates/apply`, headers: { authorization: `Bearer ${tokens.viewer}` }, payload }); assert.equal(denied.statusCode, 403, denied.body);
  const readableExport = await app.inject({ url: `${base}/labels/export?ref=${current.commitId}`, headers: { authorization: `Bearer ${tokens.viewer}` } }); assert.equal(readableExport.statusCode, 200, readableExport.body); assert.equal(readableExport.json().fixedCommitId, current.commitId);
  const privateExport = await app.inject(`${base}/labels/export?ref=${current.commitId}`); assert.equal(privateExport.statusCode, 401, privateExport.body);
  const noIdentity = await app.inject({ method: 'POST', url: `${base}/labels/templates/apply`, headers, payload }); assert.equal(noIdentity.statusCode, 401, noIdentity.body);
  const login = await app.inject({ method: 'POST', url: '/api/session', payload: { token: tokens.editor } }); assert.equal(login.statusCode, 200, login.body);
  const cookie = String(login.headers['set-cookie']).split(';')[0]!;
  const noCsrf = await app.inject({ method: 'POST', url: `${base}/labels/templates/apply`, headers: { cookie }, payload }); assert.equal(noCsrf.statusCode, 403, noCsrf.body);
  const ordinaryEditor = await app.inject({ method: 'POST', url: `${base}/labels/templates/apply`, headers: { authorization: `Bearer ${tokens.editor}` }, payload }); assert.equal(ordinaryEditor.statusCode, 403, ordinaryEditor.body);
  const orgDirectory = (await app.inject({ url: '/api/governance/organizations/oxen', headers: owner })).json();
  const designated = await app.inject({ method: 'POST', url: '/api/governance/organizations/oxen/maintainers', headers: owner, payload: { identityId: identities.editor, enabled: true, expectedRevision: orgDirectory.organization.revision } }); assert.equal(designated.statusCode, 200, designated.body);
  const allowed = await app.inject({ method: 'POST', url: `${base}/labels/templates/apply`, headers: { authorization: `Bearer ${tokens.editor}` }, payload }); assert.equal(allowed.statusCode, 200, allowed.body); assert.equal(allowed.json().columns.length, 6);
});

test('label export is an attachment of a fixed snapshot even when its branch advances during the read', async t => {
  const { app, provider, read, apply, writes } = await setup(t), initial = await read();
  let response = await apply(initial.commitId, 'general'); assert.equal(response.statusCode, 200, response.body);
  const state: LabelState = response.json(), count = writes();
  response = await app.inject(`${base}/labels/export?ref=${state.commitId}`); assert.equal(response.statusCode, 200, response.body);
  const snapshot: LabelSnapshotExport = response.json();
  assert.equal(snapshot.format, 'oxen-web-label-snapshot'); assert.equal(snapshot.version, 1);
  assert.equal(snapshot.namespace, 'oxen'); assert.equal(snapshot.repo, 'visual-search'); assert.equal(snapshot.ref, state.commitId); assert.equal(snapshot.fixedCommitId, state.commitId);
  assert.equal(snapshot.storagePath, '.oxenweb/labels.json'); assert.ok(Number.isFinite(Date.parse(snapshot.exportedAt)));
  assert.match(String(response.headers['content-disposition']), /^attachment; filename="[a-zA-Z0-9_.-]+\.json"$/); assert.match(String(response.headers['content-type']), /^application\/json/);
  assert.equal(response.headers['cache-control'], 'no-store'); assert.equal(writes(), count);
  assert.deepEqual(snapshot.document.columns, state.columns); assert.deepEqual(snapshot.document.assignments, state.assignments); assert.deepEqual(snapshot.document.templateApplications, state.templateApplications);
  assert.deepEqual(snapshot.legacy, { unmigratedCount: state.legacyCount });
  assert.equal('rows' in snapshot, false); assert.equal('evaluation' in snapshot, false);

  const key = { namespace: 'oxen', repo: 'visual-search' }, workspace = await provider.createWorkspace(key, 'advance-during-export', 'main');
  const next = { ...snapshot.document, columns: [...snapshot.document.columns, { id: 'later', name: 'Later column', type: 'text' }] };
  await provider.writeWorkspace(key, workspace.id, '.oxenweb/labels.json', Buffer.from(JSON.stringify(next)));
  const raw = provider.raw.bind(provider); let advanced = false;
  provider.raw = async (repository, ref, filename) => {
    if (!advanced && ref === state.commitId && filename === '.oxenweb/labels.json') { advanced = true; await provider.commitWorkspace(key, workspace.id, 'External branch advance', state.commitId); }
    return raw(repository, ref, filename);
  };
  response = await app.inject(`${base}/labels/export?ref=main`); assert.equal(response.statusCode, 200, response.body);
  assert.equal(advanced, true); assert.equal(response.json().ref, 'main'); assert.equal(response.json().fixedCommitId, state.commitId); assert.deepEqual(response.json().document, snapshot.document);
  assert.equal(writes(), count + 1); assert.notEqual((await read()).commitId, state.commitId);
  assert.equal((await read()).columns.length, state.columns.length + 1);
});

test('fixed-ref labels, template writes and export use metadata resolution without expanding unavailable large-history diffs', async t => {
  const { app, provider, read, apply } = await setup(t);
  const initial = await read(); let resolutions = 0, details = 0;
  (provider as Provider).resolveRef = async (key, reference) => { resolutions++; const [commit] = await provider.commits(key, reference, 1, 1); assert.ok(commit); return commit.id; };
  provider.commit = async () => { details++; throw new Error('Large historical import diff must not be expanded to resolve a ref.'); };
  let response = await app.inject(`${base}/labels?ref=${initial.commitId}`); assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().commitId, initial.commitId);
  response = await apply(initial.commitId, 'general'); assert.equal(response.statusCode, 200, response.body);
  const state: LabelState = response.json();
  response = await app.inject(`${base}/labels/export?ref=${state.commitId}`); assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().fixedCommitId, state.commitId); assert.deepEqual(response.json().document.columns, state.columns);
  assert.ok(resolutions >= 3); assert.equal(details, 0);
});
