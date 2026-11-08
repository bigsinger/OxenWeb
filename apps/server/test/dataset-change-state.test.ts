import test from 'node:test';
import assert from 'node:assert/strict';
import type { DatasetDraftDiff, DatasetDraftSummary, DatasetLabelRecord, DatasetOperation, DatasetSpan } from '../../../packages/shared/src/dataset.js';
import { changedDatasetCells, committedDatasetChanges, datasetChangeValueText, datasetSourcePreview, pendingDatasetChanges, pruneDatasetNoops, sameDatasetValue, stageDatasetFineAnnotations } from '../../web/src/dataset-change-state.js';
import { datasetPageRows, stageDatasetRecord } from '../../web/src/dataset-cell-editing.js';

const summary: DatasetDraftSummary = { id: 'synthetic-draft', ref: 'main', baseCommit: 'base', draftRevision: 1, schemaHash: 'schema', schemaHashes: { dataset: 'dataset', sample: 'sample' }, createdAt: '', updatedAt: '', operationCount: 1 };
function own(values: DatasetLabelRecord['values'] = {}): DatasetLabelRecord { return { version: 1, scope: 'row', rowId: 'one', actor: { id: 'actor', name: 'Synthetic' }, values, spans: [], steps: [], sourceCommitId: 'base', updatedAt: '', fingerprint: 'synthetic', templateSnapshot: { columns: [] } }; }
function base() { return { rows: { one: { id: 'one', text: 'Original', score: 0 } }, knownRows: new Set(['one']), labels: {} as Record<string, DatasetLabelRecord> }; }

test('cell changes distinguish a missing key, null and an empty string while ignoring object key order', () => {
  const changes = changedDatasetCells({ nullish: null, removed: '' }, { nullish: '', added: null });
  assert.deepEqual(Object.keys(changes).sort(), ['added', 'nullish', 'removed']);
  assert.deepEqual(changes.removed, { before: { present: true, value: '' }, after: { present: false } });
  assert.deepEqual(changes.added, { before: { present: false }, after: { present: true, value: null } });
  assert.deepEqual(changedDatasetCells({ object: { a: 1, b: [false, '1'] } }, { object: { b: [false, '1'], a: 1 } }), {});
  assert.equal(sameDatasetValue(1, '1'), false);
});

test('returning a saved update to its fixed base removes the operation and restores the overlaid table value', () => {
  const baseline = base(), edited = { id: 'one', text: 'Original', score: 41 };
  const saved: DatasetOperation[] = [{ op: 'update', rowId: 'one', record: edited, expectedContentHash: 'base-hash' }];
  const reverted = pruneDatasetNoops(stageDatasetRecord(saved, 'one', { ...baseline.rows.one }), baseline);
  assert.deepEqual(reverted, []);
  assert.deepEqual(datasetPageRows([edited], ['one'], reverted, saved, baseline.rows), [{ id: 'one', data: baseline.rows.one, isNew: false }]);
  assert.equal(saved.length, 1, 'Persisted draft remains available for CAS removal rather than silently mutating it');
  assert.deepEqual(Object.keys(pendingDatasetChanges(reverted, baseline)), []);
});

test('private-draft persistence does not turn modified cells into committed cells or tint untouched source fields', () => {
  const baseline = base(), operations: DatasetOperation[] = [{ op: 'update', rowId: 'one', record: { ...baseline.rows.one, score: 42 } }];
  const beforeSave = pendingDatasetChanges(operations, baseline), afterSave = pendingDatasetChanges(structuredClone(operations), baseline);
  assert.deepEqual(beforeSave, afterSave);
  assert.deepEqual(Object.keys(afterSave.one!.cells), ['score']);
  assert.equal(afterSave.one!.commitId, undefined);
});

test('row and file annotation changes have independent states without changing source cells, and no-op opinions disappear', () => {
  const baseline = { ...base(), labels: { one: own({ quality: 'reviewed' }) }, files: { 'inert.zip': { ...own({ source: 'synthetic' }), scope: 'file' as const, path: 'inert.zip' } }, knownFiles: new Set(['inert.zip']), attachmentRows: () => ['one'] };
  const unchanged: DatasetOperation[] = [{ op: 'assign', scope: 'row', rowId: 'one', values: { quality: 'reviewed', optional: null } }, { op: 'assign', scope: 'file', path: 'inert.zip', values: { source: 'synthetic' } }];
  assert.deepEqual(pruneDatasetNoops(unchanged, baseline), []);
  const changed = pendingDatasetChanges([{ op: 'assign', scope: 'row', rowId: 'one', values: { quality: 'needs-work' } }, { op: 'assign', scope: 'file', path: 'inert.zip', values: { source: 'new' } }], baseline);
  assert.equal(changed.one!.kind, 'labels'); assert.deepEqual(changed.one!.cells, {}); assert.ok(changed.one!.labels);
  assert.equal(pruneDatasetNoops([{ op: 'assign', scope: 'row', rowId: 'off-page', values: {} }], baseline).length, 1, 'Unloaded base opinions are not guessed');
});

test('fine annotations stage atomically even when the row label values are unchanged and reverting them is a no-op', () => {
  const baseline = { ...base(), labels: { one: own({ quality: 'reviewed' }) } };
  const span: DatasetSpan = { id: 'span', pointer: '/text', sourceHash: 'synthetic-hash', start: 0, end: 1, values: { category: 'synthetic' } };
  const added = stageDatasetFineAnnotations([], 'one', { quality: 'reviewed' }, [span], [], baseline);
  assert.equal(added.length, 1); assert.ok(pendingDatasetChanges(added, baseline).one?.labels);
  assert.deepEqual(added[0], { op: 'assign', scope: 'row', rowId: 'one', values: { quality: 'reviewed' }, spans: [span], steps: [] });
  assert.deepEqual(stageDatasetFineAnnotations(added, 'one', { quality: 'reviewed' }, [], [], baseline), []);
});

test('append and deletion have explicit row state and exact before/after presence information', () => {
  const baseline = base(), changes = pendingDatasetChanges([{ op: 'append', rowId: 'new:synthetic', record: { id: 'new', text: '' } }, { op: 'delete', rowId: 'one' }], baseline);
  assert.equal(changes['new:synthetic']!.kind, 'append'); assert.equal(changes.one!.kind, 'delete');
  assert.deepEqual(changes['new:synthetic']!.cells.text?.before, { present: false });
  assert.deepEqual(changes.one!.cells.score?.after, { present: false });
});

test('only the successful commit diff updates the session map, preserving earlier successful source changes', () => {
  const first: DatasetDraftDiff = { draft: summary, changes: [{ op: 'update', rowId: 'one', fields: ['score'], before: { id: 'one', text: 'Original', score: 0 }, after: { id: 'one', text: 'Original', score: 1 } }] };
  const previous = committedDatasetChanges({}, first, 'commit-one');
  const pending = pendingDatasetChanges([{ op: 'update', rowId: 'one', record: { id: 'one', text: 'Original', score: 2 } }], { ...base(), rows: { one: { id: 'one', text: 'Original', score: 1 } } });
  assert.equal(previous.one!.cells.score!.after.value, 1); assert.equal(pending.one!.cells.score!.after.value, 2);
  assert.equal(previous.one!.commitId, 'commit-one', 'A failed request has no success diff to merge');
  const second: DatasetDraftDiff = { draft: summary, changes: [{ op: 'update', rowId: 'one', fields: ['text'], before: { id: 'one', text: 'Original', score: 1 }, after: { id: 'one', text: 'Changed', score: 1 } }, { op: 'assign', scope: 'row', rowId: 'one', fields: [], before: {}, after: { quality: 'ok' } }] };
  const next = committedDatasetChanges(previous, second, 'commit-two');
  assert.deepEqual(Object.keys(next.one!.cells).sort(), ['score', 'text']); assert.ok(next.one!.labels);
  assert.deepEqual(Object.keys(previous.one!.cells), ['score'], 'No mutation of an earlier accepted session state');
});

test('before/after and source previews are bounded even for huge nested payloads', () => {
  const large = { trajectory: Array.from({ length: 10000 }, () => ({ content: 'Synthetic '.repeat(10000) })) };
  const preview = datasetSourcePreview(large, 600);
  assert.ok(preview.length < 650); assert.match(preview, /已省略/);
  assert.ok(datasetChangeValueText({ present: true, value: 'x'.repeat(1000000) }).length < 450);
  assert.equal(datasetChangeValueText({ present: false }), '（未提供）');
  assert.equal(datasetChangeValueText({ present: true, value: null }), 'null');
  assert.equal(datasetChangeValueText({ present: true, value: '' }), '""');
});

test('a later successful deletion supersedes an earlier successful append in the same session', () => {
  const record = { id: 'synthetic-copy', text: 'New sample' };
  const appended = committedDatasetChanges({}, { draft: summary, changes: [{ op: 'append', rowId: 'copy', fields: [], after: record }] }, 'first');
  const deleted = committedDatasetChanges(appended, { draft: summary, changes: [{ op: 'delete', rowId: 'copy', fields: [], before: record }] }, 'second');
  assert.equal(appended.copy!.kind, 'append'); assert.equal(deleted.copy!.kind, 'delete');
  assert.equal(deleted.copy!.commitId, 'second'); assert.deepEqual(deleted.copy!.cells.text!.after, { present: false });
});
