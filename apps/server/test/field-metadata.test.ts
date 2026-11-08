import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { datasetValueType, resolveDatasetFieldMetadata } from '../../../packages/shared/src/field-metadata.js';
import { DatasetService } from '../src/dataset.js';
import { DemoProvider } from '../src/demo.js';
import type { RequestIdentity } from '../../../packages/shared/src/index.js';

test('common source field names show ID, a useful display name and non-executing help', () => {
  assert.deepEqual(resolveDatasetFieldMetadata('title'), { id: 'title', displayName: '标题', description: '源记录的标题，便于快速了解条目主题；不是人工标注结论。' });
  assert.equal(resolveDatasetFieldMetadata('UID').displayName, '唯一标识');
  assert.equal(resolveDatasetFieldMetadata('Description').displayName, '描述');
  assert.match(resolveDatasetFieldMetadata('prompt').description!, /不会自动执行/);
  assert.match(resolveDatasetFieldMetadata('label').description!, /与当前人工标注分开/);
});

test('dataset definitions override the common dictionary without using annotation names or inferring unknown fields', () => {
  const fields = { title: { displayName: '工单主题', description: '此集合的工单标题。' }, field_42: { displayName: '组织自定义字段', description: '组织提供的含义。' } };
  assert.deepEqual(resolveDatasetFieldMetadata('title', fields), { id: 'title', displayName: '工单主题', description: '此集合的工单标题。' });
  assert.equal(resolveDatasetFieldMetadata('field_42', fields).displayName, '组织自定义字段');
  assert.deepEqual(resolveDatasetFieldMetadata('risk_code'), { id: 'risk_code' });
  assert.deepEqual(resolveDatasetFieldMetadata('Title', fields).displayName, '标题', 'Explicit source IDs match exactly, not by guessed normalization');
});

test('explicit empty definitions suppress fallbacks, duplicate names disappear and prototype names never acquire metadata', () => {
  assert.deepEqual(resolveDatasetFieldMetadata('title', { title: { displayName: '', description: '' } }), { id: 'title' });
  assert.equal(resolveDatasetFieldMetadata('title', { title: { displayName: 'TITLE' } }).displayName, undefined);
  assert.deepEqual(resolveDatasetFieldMetadata('constructor'), { id: 'constructor' });
  assert.deepEqual(resolveDatasetFieldMetadata('__proto__'), { id: '__proto__' });
  const inherited = Object.create({ private_key: { displayName: 'Inherited alias' } });
  assert.deepEqual(resolveDatasetFieldMetadata('private_key', inherited), { id: 'private_key' });
});

test('actual field type distinguishes null, arrays, nested objects and primitive values', () => {
  assert.deepEqual([null, [], {}, 'text', 2, false].map(datasetValueType), ['null', 'array', 'object', 'string', 'number', 'boolean']);
});

test('explicit field explanations survive dataset initialization and fixed-version reads without changing source keys or values', async t => {
  const root = path.resolve('.data/tests'); await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'field-metadata-'));
  t.after(async () => { const actual = await realpath(directory); assert.equal(path.dirname(actual), await realpath(root)); await rm(actual, { recursive: true }); });
  const provider = new DemoProvider(path.join(directory, 'demo.json')); await provider.init();
  const key = { namespace: 'local', repo: 'field-metadata-fixture' };
  await provider.createRepo({ namespace: key.namespace, name: key.repo, description: 'Synthetic metadata fixture' });
  const service = new DatasetService(provider), owner: RequestIdentity = { id: 'owner', name: 'Owner', kind: 'owner', source: 'local' };
  const expectedCommit = (await provider.branches(key)).find(item => item.name === 'main')!.commitId;
  const fields = { title: { displayName: '工单主题', description: '此集合的工单标题。' }, custom_code: { displayName: '内部编码', description: '' } };
  const rows = [{ id: 'synthetic-1', title: 'Synthetic title', custom_code: 'A', label: 'source-value' }];
  await assert.rejects(service.initialize(key, owner, { ref: 'main', expectedCommit, rows, descriptor: { fields: { title: { displayName: 'x'.repeat(121) } } } }));
  assert.equal((await provider.branches(key)).find(item => item.name === 'main')!.commitId, expectedCommit);
  assert.equal((await provider.workspaces(key)).length, 0, 'Invalid explanation must fail before allocating a workspace');
  const initialized = await service.initialize(key, owner, { ref: 'main', expectedCommit, rows, descriptor: { fields } });
  const reloaded = await new DatasetService(provider).read(key, initialized.commitId);
  assert.deepEqual(reloaded.descriptor.fields, fields);
  assert.deepEqual(reloaded.rows, rows);
  assert.equal((await provider.raw(key, reloaded.commitId, reloaded.path)).content.toString('utf8'), JSON.stringify(rows[0]) + '\n');
  assert.equal(reloaded.labels.assignments.length, 0, 'Field explanations do not create annotations');
});
