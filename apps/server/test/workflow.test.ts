import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { DemoProvider } from '../src/demo.js';
import { loadConfig } from '../src/config.js';
import type { AnnotationTaskView } from '../../../packages/shared/src/workflow-types.js';
import type { DatasetPage } from '../../../packages/shared/src/dataset.js';

const ownerToken = 'synthetic-workflow-owner-token';
async function fixture(rows = 4) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'oxen-workflow-'));
  const config = loadConfig({ DEMO_MODE: 'true', DEMO_DATA_FILE: path.join(directory, 'demo.json'), BFF_TOKEN: ownerToken });
  const provider = new DemoProvider(config.demoFile); await provider.init();
  const key = { namespace: 'local', repo: 'synthetic-workflow' };
  await provider.createRepo({ namespace: key.namespace, name: key.repo, description: 'Synthetic workflow fixture' });
  const workspace = await provider.createWorkspace(key, 'Synthetic baseline', 'main');
  await provider.writeWorkspace(key, workspace.id, 'data/samples.jsonl', Buffer.from(Array.from({ length: rows }, (_, index) => JSON.stringify({ id: `sample-${index + 1}`, text: `synthetic ${index + 1}`, expected: 'source-truth' })).join('\n') + '\n'));
  await provider.writeWorkspace(key, workspace.id, 'bundle-manifest.json', Buffer.from(JSON.stringify({ canonical_data: 'data/samples.jsonl' })));
  await provider.writeWorkspace(key, workspace.id, '.oxenweb/labels.json', Buffer.from(JSON.stringify({ version: 1, columns: [{ id: 'risk', name: '风险', type: 'single', scopes: ['row'], options: [{ value: 'benign' }, { value: 'uncertain' }] }], assignments: [] })));
  await provider.commitWorkspace(key, workspace.id, 'Synthetic immutable baseline'); await provider.deleteWorkspace(key, workspace.id);
  const app = await createApp(config, provider), base = `/api/repos/${key.namespace}/${key.repo}`;
  const call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown, token = ownerToken) => app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload === undefined ? {} : { payload: payload as object }) });
  const grant = async (name: string, role: string) => {
    const response = await call('POST', `${base}/access`, { name, role }); assert.equal(response.statusCode, 201, response.body);
    return response.json() as { collaborator: { id: string }; token: string };
  };
  return { app, provider, key, base, call, grant, async close() { await app.close(); await rm(directory, { recursive: true, force: true }); } };
}

test('1000 stable samples are assigned as 334/333/333 from one pinned baseline', async () => {
  const f = await fixture(1000);
  try {
    const people = await Promise.all(['worker-a', 'worker-b', 'worker-c'].map(name => f.grant(name, 'annotator')));
    const baseline = (await f.provider.branches(f.key)).find(branch => branch.name === 'main')!.commitId;
    const response = await f.call('POST', `${f.base}/tasks`, { title: 'Synthetic balanced assignment', ref: 'main', expectedCommit: baseline, assigneeIds: people.map(person => person.collaborator.id), reviewerId: 'owner', mode: 'review', branchPrefix: 'annotate/balanced' });
    assert.equal(response.statusCode, 201, response.body);
    const tasks = response.json() as AnnotationTaskView[];
    assert.deepEqual(tasks.map(task => task.rowIds.length), [334, 333, 333]);
    assert.equal(new Set(tasks.flatMap(task => task.rowIds)).size, 1000);
    assert.ok(tasks.every(task => task.baselineCommitId === baseline && task.status === 'assigned'));
    const branches = await f.provider.branches(f.key);
    assert.ok(tasks.every(task => branches.find(branch => branch.name === task.participants[0]!.branch)?.commitId === baseline));
    const cards = await f.call('GET', '/api/repos');
    const card = cards.json().find((item: { name: string }) => item.name === f.key.repo);
    assert.equal(card.sampleCount, 1000); assert.equal(card.sampleCountCommitId, baseline);
  } finally { await f.close(); }
});

test('independent identities annotate, review and merge disjoint records without rewriting the baseline', async () => {
  const f = await fixture();
  try {
    const people = [await f.grant('worker-a', 'annotator'), await f.grant('worker-b', 'annotator')], reviewer = await f.grant('reviewer', 'reviewer');
    const baseline = (await f.provider.branches(f.key)).find(branch => branch.name === 'main')!.commitId;
    const source = (await f.provider.raw(f.key, baseline, 'data/samples.jsonl')).content;
    const created = await f.call('POST', `${f.base}/tasks`, { title: 'Synthetic independent review', ref: 'main', expectedCommit: baseline, assigneeIds: people.map(person => person.collaborator.id), reviewerId: reviewer.collaborator.id, mode: 'review', branchPrefix: 'annotate/synthetic' });
    assert.equal(created.statusCode, 201, created.body);
    const tasks = created.json() as AnnotationTaskView[];
    const forbiddenSchema = await f.call('POST', `${f.base}/labels/columns`, { ref: tasks[0]!.participants[0]!.branch, expectedCommit: baseline, column: { id: 'unauthorized', name: 'Unauthorized', type: 'text' } }, people[0]!.token);
    assert.equal(forbiddenSchema.statusCode, 403);
    const outOfScope = await f.call('POST', `${f.base}/dataset/save`, { ref: tasks[0]!.participants[0]!.branch, expectedCommit: baseline, message: 'Forbidden synthetic record', operations: [{ op: 'assign', scope: 'row', rowId: tasks[1]!.rowIds[0], values: { risk: 'benign' } }] }, people[0]!.token);
    assert.equal(outOfScope.statusCode, 403, outOfScope.body);
    const blockedMerge = await f.call('POST', `${f.base}/merge`, { source: tasks[0]!.participants[0]!.branch, target: 'main' });
    assert.equal(blockedMerge.statusCode, 409, blockedMerge.body);
    for (let index = 0; index < tasks.length; index++) {
      const task = tasks[index]!, person = people[index]!, branch = task.participants[0]!.branch;
      const save = await f.call('POST', `${f.base}/dataset/save`, { ref: branch, expectedCommit: baseline, message: 'Synthetic label decisions', operations: task.rowIds.map(rowId => ({ op: 'assign', scope: 'row', rowId, values: { risk: 'benign' } })) }, person.token);
      assert.equal(save.statusCode, 200, save.body);
      const submit = await f.call('POST', `${f.base}/tasks/${task.id}/submit`, { expectedRevision: task.revision, expectedCommit: save.json().commitId }, person.token);
      assert.equal(submit.statusCode, 200, submit.body);
      const submitted = submit.json() as AnnotationTaskView;
      const ownReview = await f.call('POST', `${f.base}/tasks/${task.id}/review`, { expectedRevision: submitted.revision, decisions: task.rowIds.map(rowId => ({ rowId, verdict: 'approved', comment: '' })) }, person.token);
      assert.equal(ownReview.statusCode, 403);
      const review = await f.call('POST', `${f.base}/tasks/${task.id}/review`, { expectedRevision: submitted.revision, decisions: task.rowIds.map(rowId => ({ rowId, verdict: 'approved', comment: '' })) }, reviewer.token);
      assert.equal(review.statusCode, 200, review.body); assert.equal(review.json().progress.approved, task.rowIds.length);
      const merged = await f.call('POST', `${f.base}/merge`, { source: branch, target: 'main' });
      assert.equal(merged.statusCode, 200, merged.body);
    }
    const preflight = await f.call('GET', `${f.base}/workflow/preflight?ref=main`);
    assert.equal(preflight.statusCode, 200, preflight.body); assert.equal(preflight.json().ok, true, preflight.body);
    assert.equal(Object.keys(preflight.json().acceptedValues).length, 4);
    const final = await f.call('GET', `${f.base}/dataset?ref=main`);
    assert.equal(final.statusCode, 200, final.body);
    const page = final.json() as DatasetPage;
    assert.equal(page.totalRows, 4); assert.equal(page.labels.assignments.filter(item => item.scope === 'row').length, 4);
    assert.deepEqual((await f.provider.raw(f.key, 'main', 'data/samples.jsonl')).content, source);
    const branch = tasks[0]!.participants[0]!.branch, current = (await f.provider.branches(f.key)).find(item => item.name === branch)!.commitId;
    const revoked = await f.call('DELETE', `${f.base}/access/${reviewer.collaborator.id}`); assert.equal(revoked.statusCode, 200, revoked.body);
    const inaccessible = await f.call('POST', `${f.base}/tasks/${tasks[0]!.id}/review`, { expectedRevision: 999, decisions: [{ rowId: tasks[0]!.rowIds[0], verdict: 'approved', comment: '' }] }, reviewer.token);
    assert.equal(inaccessible.statusCode, 401);
    assert.equal((await f.provider.branches(f.key)).find(item => item.name === branch)!.commitId, current);
  } finally { await f.close(); }
});
