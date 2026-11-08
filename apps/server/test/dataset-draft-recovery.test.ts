import test from 'node:test';
import assert from 'node:assert/strict';
import { reactive } from 'vue';
import type { DatasetDraft, DatasetDraftSummary, DatasetOperation } from '../../../packages/shared/src/dataset.js';
import { datasetDraftBase, datasetDraftNeedsSync, datasetDraftRebaseInput } from '../../web/src/dataset-draft-recovery.js';

const summary: DatasetDraftSummary = { id: 'synthetic-private-draft', ref: 'main', baseCommit: 'old-base', draftRevision: 3, schemaHash: 'synthetic-schema', schemaHashes: { dataset: 'catalog', sample: 'sample' }, createdAt: '2026-11-08T00:00:00Z', updatedAt: '2026-11-08T00:01:00Z', operationCount: 1 };
const original: DatasetOperation[] = [{ op: 'update', rowId: 'one', record: { id: 'one', score: 1 }, expectedContentHash: 'original-content-hash' }];
const draft: DatasetDraft = { ...summary, operations: original };

test('unsaved local edits can explicitly synchronize from the loaded base without creating a commit request', () => {
  const operations: DatasetOperation[] = [{ op: 'update', rowId: 'one', record: { id: 'one', score: 41 }, expectedContentHash: 'original-content-hash' }];
  const context = { ref: 'main', snapshotCommit: 'old-base', latestCommit: 'new-label-head', operations };
  assert.equal(datasetDraftNeedsSync(context), true);
  assert.deepEqual(datasetDraftRebaseInput(context), { ref: 'main', expectedBaseCommit: 'old-base', expectedCommit: 'new-label-head', draftRevision: 0, operations });
  assert.equal(Object.hasOwn(datasetDraftRebaseInput(context), 'message'), false, 'Rebase is not a commit payload');
});

test('a full saved draft uses its CAS identity and all current unsaved operations instead of its older operation list', () => {
  const operations = reactive<DatasetOperation[]>([{ op: 'update', rowId: 'one', record: { id: 'one', score: 43 }, expectedContentHash: 'original-content-hash' }, { op: 'append', rowId: 'new:two', record: { id: 'two' } }]);
  const payload = datasetDraftRebaseInput({ ref: 'main', snapshotCommit: 'old-base', latestCommit: 'new-label-head', draft, summary, operations });
  assert.equal(payload.expectedDraftId, summary.id); assert.equal(payload.draftRevision, 3);
  assert.deepEqual(payload.operations, operations); assert.notEqual(payload.operations, operations);
  if (operations[0]!.op === 'update') operations[0]!.record.score = 999;
  assert.equal((payload.operations![0] as Extract<DatasetOperation, { op: 'update' }>).record.score, 43, 'Payload is detached even when Vue wraps the input');
});

test('after refresh, a stale disk summary still offers sync and omits unknown operations instead of overwriting them with []', () => {
  const context = { ref: 'main', snapshotCommit: 'new-label-head', latestCommit: 'new-label-head', summary, operations: [] };
  assert.equal(datasetDraftBase(context), 'old-base');
  assert.equal(datasetDraftNeedsSync(context), true);
  const payload = datasetDraftRebaseInput(context);
  assert.equal(payload.expectedBaseCommit, 'old-base'); assert.equal(payload.expectedDraftId, summary.id);
  assert.equal(Object.hasOwn(payload, 'operations'), false, 'Server must recover its own saved operations');
});

test('known locally cancelled operations remain an explicit empty list and cannot resurrect a saved append', () => {
  const context = { ref: 'main', snapshotCommit: 'old-base', latestCommit: 'new-label-head', draft, summary, operations: [] };
  assert.equal(datasetDraftNeedsSync(context), true);
  assert.deepEqual(datasetDraftRebaseInput(context).operations, []);
});

test('a summary plus known unsaved operations sends those edits while retaining the saved draft CAS', () => {
  const payload = datasetDraftRebaseInput({ ref: 'main', snapshotCommit: 'new-label-head', latestCommit: 'new-label-head', summary, operations: original });
  assert.deepEqual(payload.operations, original); assert.equal(payload.expectedBaseCommit, summary.baseCommit);
});

test('the sync offer requires a different known head and local work; an untouched page never rebases itself', () => {
  const same = { ref: 'main', snapshotCommit: 'same', latestCommit: 'same', operations: original };
  assert.equal(datasetDraftNeedsSync(same), false);
  assert.equal(datasetDraftNeedsSync({ ...same, latestCommit: 'new-head', operations: [] }), false);
  assert.equal(datasetDraftNeedsSync({ ...same, latestCommit: 'new-head', operations: [] }, true), true);
  assert.equal(datasetDraftNeedsSync({ ...same, latestCommit: undefined }), false);
  assert.throws(() => datasetDraftRebaseInput({ ref: 'main', latestCommit: 'new-head', operations: original }));
});
