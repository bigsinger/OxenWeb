import test from 'node:test';
import assert from 'node:assert/strict';
import type { DatasetUiState } from '../../../packages/shared/src/dataset-ui-state.js';
import { createDatasetUiStateClient } from '../../web/src/dataset-ui-state-client.js';
import { ApiError, type request } from '../../web/src/api.js';

function fakeServer(initial?: DatasetUiState) {
  let stored = initial, puts = 0; const bodies: Array<Record<string, unknown>> = [];
  const send = (async (_path: string, init?: RequestInit) => {
    if (!init) return { state: stored };
    const body = JSON.parse(String(init.body)); bodies.push(body);
    if (body.revision !== (stored?.revision ?? 0) || body.expectedId !== stored?.id) throw new ApiError('UI_STATE_REVISION_CONFLICT', 'Synthetic CAS conflict', 409);
    if (init.method === 'DELETE') { stored = undefined; return {}; }
    puts++; await new Promise(resolve => setTimeout(resolve, 2));
    stored = { id: stored?.id ?? 'synthetic-id', ref: body.ref, kind: body.kind, revision: (stored?.revision ?? 0) + 1, baseCommit: body.baseCommit, payload: body.payload, updatedAt: 'now' };
    return { state: stored };
  }) as typeof request;
  return { send, bodies, get stored() { return stored; }, get puts() { return puts; }, replace(state: DatasetUiState) { stored = state; } };
}

test('new UI checkpoints preserve incomplete strings independently of source validity or HEAD', async () => {
  const server = fakeServer(), client = createDatasetUiStateClient({ base: '/repos/synthetic/test', ref: 'main', kind: 'workbench', request: server.send });
  const payload = { json: '{unfinished', cell: { text: 'not-a-number' }, drawer: 'append', fields: { required: '' } };
  const state = await client.save(payload, 'old-base');
  assert.deepEqual(state.payload, payload); assert.equal(state.baseCommit, 'old-base');
  assert.equal(server.bodies[0]!.revision, 0); assert.equal(Object.hasOwn(server.bodies[0]!, 'expectedId'), false);
});
test('queued saves capture input immediately and serialize against the latest acknowledged CAS token', async () => {
  const server = fakeServer(), client = createDatasetUiStateClient({ base: '/repos/synthetic/test', ref: 'main', kind: 'workbench', request: server.send });
  const mutable = { text: 'first' }, first = client.save(mutable); mutable.text = 'mutated';
  const second = client.save({ text: 'second' }); await Promise.all([first, second]);
  assert.deepEqual(server.bodies[0]!.payload, { text: 'first' }); assert.equal(server.bodies[1]!.revision, 1);
  assert.equal(server.bodies[1]!.expectedId, 'synthetic-id'); assert.deepEqual(client.state?.payload, { text: 'second' }); assert.equal(server.puts, 2);
});
test('a multi-page CAS conflict is surfaced without automatically reloading or overwriting the other page', async () => {
  const initial: DatasetUiState = { id: 'id', ref: 'main', kind: 'workbench', revision: 1, payload: { text: 'initial' }, updatedAt: '' }, server = fakeServer(initial), client = createDatasetUiStateClient({ base: '/repos/synthetic/test', ref: 'main', kind: 'workbench', request: server.send });
  await client.load(); server.replace({ ...initial, revision: 2, payload: { text: 'other page' } });
  await assert.rejects(client.save({ text: 'my raw input' }), /CAS conflict/);
  assert.equal(server.bodies.length, 1); assert.deepEqual(server.stored?.payload, { text: 'other page' }); assert.equal(client.state?.revision, 1);
});
test('deletion uses the last acknowledged identity and revision and clears only this client state', async () => {
  const server = fakeServer(), client = createDatasetUiStateClient({ base: '/repos/synthetic/test', ref: 'main', kind: 'workbench', request: server.send });
  await client.save({ text: 'raw' }); await client.remove();
  assert.equal(server.bodies[1]!.expectedId, 'synthetic-id'); assert.equal(server.bodies[1]!.revision, 1); assert.equal(client.state, undefined);
});
test('an identity or branch generation change rejects a stale response and prevents subsequent requests', async () => {
  let context = 'actor:main', finish: ((value: unknown) => void) | undefined, calls = 0;
  const send = (async () => { calls++; return new Promise(resolve => { finish = resolve; }); }) as typeof request;
  const client = createDatasetUiStateClient({ base: '/repos/synthetic/test', ref: 'main', kind: 'workbench', context: () => context, request: send });
  const pending = client.load(); context = 'different:branch'; finish?.({ state: { id: 'private', revision: 1, payload: { text: 'old actor' } } });
  await assert.rejects(pending, /上下文已变化/); assert.equal(client.state, undefined);
  await assert.rejects(client.save({ text: 'new actor' }), /上下文已变化/); assert.equal(calls, 1);
});

test('an explicit fresh client can recover its latest CAS token but a third writer is still rejected without retry', async () => {
  const initial: DatasetUiState = { id: 'id', ref: 'main', kind: 'workbench', revision: 1, payload: { text: 'initial' }, updatedAt: '' }, server = fakeServer(initial);
  const old = createDatasetUiStateClient({ base: '/repos/synthetic/test', ref: 'main', kind: 'workbench', request: server.send });
  await old.load(); server.replace({ ...initial, revision: 2, payload: { text: 'second page raw' } });
  await assert.rejects(old.save({ text: 'local raw' }), /CAS conflict/);
  const fresh = createDatasetUiStateClient({ base: '/repos/synthetic/test', ref: 'main', kind: 'workbench', request: server.send }), latest = await fresh.load();
  assert.equal(latest?.revision, 2);
  server.replace({ ...initial, revision: 3, payload: { text: 'third page raw' } });
  await assert.rejects(fresh.save({ active: 'local raw', retained: latest?.payload }), /CAS conflict/);
  assert.equal(server.stored?.revision, 3); assert.deepEqual(server.stored?.payload, { text: 'third page raw' });
  assert.equal(server.bodies.length, 2, 'Neither failed save automatically retries against someone else’s latest revision');
  const retry = createDatasetUiStateClient({ base: '/repos/synthetic/test', ref: 'main', kind: 'workbench', request: server.send });
  const newest = await retry.load(); await retry.save({ active: 'local raw', retained: [latest?.payload, newest?.payload] });
  assert.equal(server.bodies[2]?.revision, 3); assert.equal(server.stored?.revision, 4);
});
