import test from 'node:test';
import assert from 'node:assert/strict';
import { assignableDatasetRows, cellKind, cellEditorText, datasetColumnLayout, datasetPageRows, duplicateDatasetRecord, parseCellEditor, stageDatasetRecord, stageDatasetRemoval } from '../../web/src/dataset-cell-editing.js';
import type { DatasetOperation } from '../../../packages/shared/src/dataset.js';

test('inline cell edits preserve strings, multiline text and each JSON value shape', () => {
  const values = ['A synthetic "quoted" string\nwith a second line', 0, -2.5, false, true, null, [{ a: 1 }, 'x'], { nested: ['x', false] }];
  for (const value of values) assert.deepEqual(parseCellEditor(cellEditorText(value), cellKind(value)), value);
  assert.equal(parseCellEditor('123', 'string'), '123');
  assert.equal(parseCellEditor('false', 'string'), 'false');
  assert.equal(parseCellEditor('1e3', 'number'), 1000);
  assert.equal(cellKind(undefined), 'string');
});

test('invalid JSON or an accidental type conversion cannot silently replace a cell', () => {
  for (const [text, kind] of [['true', 'number'], ['"12"', 'number'], ['{}', 'array'], ['[]', 'object'], ['false', 'null'], ['Infinity', 'number'], ['', 'number'], ['{bad}', 'object']] as const) assert.throws(() => parseCellEditor(text, kind));
});

test('multiple cell and full-record edits coalesce without discarding the original compare-and-swap hash', () => {
  const initial: DatasetOperation[] = [{ op: 'assign', scope: 'row', rowId: 'one', values: { quality: 'synthetic' } }];
  const first = stageDatasetRecord(initial, 'one', { id: 'one', text: 'edited', score: 1 }, 'original-base-hash');
  const second = stageDatasetRecord(first, 'one', { id: 'one', text: 'edited again', score: 2 }, 'overlay-hash-must-not-replace-base');
  const updates = second.filter(op => op.op === 'update');
  assert.equal(updates.length, 1); assert.equal(updates[0]!.expectedContentHash, 'original-base-hash');
  assert.deepEqual(updates[0]!.record, { id: 'one', text: 'edited again', score: 2 });
  assert.deepEqual(initial, [{ op: 'assign', scope: 'row', rowId: 'one', values: { quality: 'synthetic' } }]);
  assert.equal(second.filter(op => op.op === 'assign').length, 1);
});

test('editing an unsaved copied row remains one append operation with the same logical identity', () => {
  const operations: DatasetOperation[] = [{ op: 'append', rowId: 'new:synthetic', record: { id: 'copy', text: 'first' } }, { op: 'assign', rowId: 'other', scope: 'row', values: { quality: 'ok' } }];
  const staged = stageDatasetRecord(operations, 'new:synthetic', { id: 'copy', text: 'second' });
  assert.equal(staged.length, 2); assert.equal(staged.filter(op => op.op === 'update').length, 0);
  assert.deepEqual(staged[0], { op: 'append', rowId: 'new:synthetic', record: { id: 'copy', text: 'second' } });
  assert.equal((operations[0] as Extract<DatasetOperation, { op: 'append' }>).record.text, 'first');
});

test('copying generates new logical and business identities, preserves truth and references attachments without copying execution state', () => {
  const original = { ID: 123, uid: 'uid-old', custom_key: 'key-old', text: 'Synthetic text', truth: { expected: 'unchanged source truth' }, package_path: 'packages/inert.zip', __bundle_provenance: { source: 'original bundle row' } };
  const uuid = '12345678-1234-4234-8234-123456789abc';
  const copy = duplicateDatasetRecord(original, 'custom_key', uuid);
  assert.equal(copy.rowId, 'new:' + uuid);
  assert.equal(typeof copy.record.ID, 'number'); assert.ok(Number.isSafeInteger(copy.record.ID)); assert.notEqual(copy.record.ID, original.ID);
  assert.notEqual(copy.record.uid, original.uid); assert.notEqual(copy.record.custom_key, original.custom_key);
  assert.deepEqual(copy.record.truth, original.truth); assert.notEqual(copy.record.truth, original.truth);
  assert.equal(copy.record.package_path, original.package_path); assert.equal(Object.hasOwn(copy.record, '__bundle_provenance'), false);
  assert.ok(Object.hasOwn(original, '__bundle_provenance'));
  assert.throws(() => duplicateDatasetRecord(original, 'custom_key', '../not-a-uuid'));
});

test('table layout reserves less space for identifiers and numeric flags than long source text', () => {
  const rows = [{ uid: 'synthetic-identifier-0123456789', count: 123, enabled: false, description: 'Synthetic description '.repeat(20), messages: [{ role: 'user', content: 'Synthetic' }] }];
  const layout = (name: string) => datasetColumnLayout({ name, dtype: 'unknown' }, rows, 'uid');
  assert.equal(layout('uid').kind, 'identity'); assert.equal(layout('count').kind, 'number'); assert.equal(layout('enabled').kind, 'boolean');
  assert.equal(layout('messages').kind, 'structured'); assert.ok(layout('description').width > layout('uid').width);
  assert.ok(layout('description').width > layout('count').width); assert.ok(layout('count').width > layout('enabled').width);
});

test('cancelling a saved draft append removes its overlaid page row instead of leaving an editable ghost', () => {
  const base = { id: 'one', text: 'Original synthetic record' }, copied = { id: 'copy', text: 'Saved copy' };
  const saved: DatasetOperation[] = [{ op: 'append', rowId: 'new:copy', record: copied }, { op: 'assign', scope: 'row', rowId: 'new:copy', values: { quality: 'synthetic' } }];
  assert.equal(datasetPageRows([base, copied], ['one', 'new:copy'], saved, saved).length, 2);
  const removed = stageDatasetRemoval(saved, 'new:copy', undefined);
  assert.deepEqual(removed.operations, [], 'A cancelled append must not become a delete against the baseline');
  assert.deepEqual(datasetPageRows([base, copied], ['one', 'new:copy'], removed.operations, saved), [{ id: 'one', data: base, isNew: false }]);
  assert.deepEqual(datasetPageRows([copied], ['new:copy'], removed.operations, saved), [], 'A page containing only the cancelled copy is empty');
});

test('confirmed deletion clears even invalid cell input and preserves unrelated edits and the deletion CAS', () => {
  const invalidCell = { rowId: 'one', field: 'score', text: '{invalid JSON' };
  const operations: DatasetOperation[] = [{ op: 'update', rowId: 'one', record: { id: 'one', score: 2 }, expectedContentHash: 'old-base' }, { op: 'assign', scope: 'row', rowId: 'one', values: { quality: 'changed' } }, { op: 'update', rowId: 'other', record: { id: 'other', text: 'keep' }, expectedContentHash: 'other-base' }];
  const removed = stageDatasetRemoval(operations, 'one', 'old-base', invalidCell);
  assert.equal(removed.editor, undefined, 'The deleted row must not leave a cell editor blocking the next save');
  assert.deepEqual(removed.operations, [operations[2], { op: 'delete', rowId: 'one', expectedContentHash: 'old-base' }]);
  const otherEditor = { rowId: 'other', field: 'text', text: 'unrelated input' };
  assert.equal(stageDatasetRemoval(operations, 'one', 'old-base', otherEditor).editor, otherEditor);
});

test('select-all and bulk annotation candidates exclude pending deletions while retaining valid rows from other pages', () => {
  const operations: DatasetOperation[] = [{ op: 'delete', rowId: 'one', expectedContentHash: 'old-base' }];
  assert.deepEqual(assignableDatasetRows(['one', 'two', 'outside-task', 'valid-on-other-page'], operations, id => id !== 'outside-task'), ['two', 'valid-on-other-page']);
  const after = [...operations, ...assignableDatasetRows(['one', 'two'], operations, () => true).map(rowId => ({ op: 'assign' as const, scope: 'row' as const, rowId, values: { quality: 'checked' } }))];
  assert.equal(after.filter(op => op.op === 'assign' && op.rowId === 'one').length, 0);
  assert.equal(after.filter(op => op.op === 'assign' && op.rowId === 'two').length, 1);
});
