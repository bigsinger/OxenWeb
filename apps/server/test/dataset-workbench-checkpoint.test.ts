import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptWorkbenchViewCheckpoint, parseWorkbenchCheckpoint, retainConflictingWorkbenchInput, workbenchCheckpointHasInput, workbenchCheckpointIssue, type WorkbenchCheckpoint, type WorkbenchCheckpointContext } from '../../web/src/dataset-workbench-checkpoint.js';

function checkpoint(): WorkbenchCheckpoint { return { version: 2, identity: 'local:actor', project: '/repos/synthetic/test', branch: 'main', baseCommit: 'base', schemaHash: 'rules', savedAt: 'now', selected: 'one', selectedRows: ['one'], operations: [], inspectorOpen: false, editing: true, json: '{unfinished', jsonBaseline: '{}', cellEdit: { rowId: 'one', field: 'score', kind: 'number', text: 'invalid', presence: 'value', originalKind: 'number', originalPresence: 'value', baseline: '1' }, cellError: 'invalid JSON', localError: '', drawer: 'append', attachment: '', appendRowId: 'new:synthetic', appendInfo: '', fine: { kind: 'span', pointer: '/text', start: 0, end: 1, values: {}, note: 'unfinished' }, bulkValues: {}, feedback: 'draft feedback', message: 'draft commit message', page: 2, search: 'synthetic', filters: [], prompt: '', engine: 'rules', allowExternal: false, visibleColumns: ['score'], filterColumn: '', filterOperator: 'eq', filterValue: '', showFilter: true, showColumns: true }; }
function context(): WorkbenchCheckpointContext { return { identity: 'local:actor', project: '/repos/synthetic/test', branch: 'main', baseCommit: 'base', schemaHash: 'rules', canEdit: true, canAssign: true, canAppend: true, historical: false }; }

test('incomplete cell, JSON, append panel and navigation preferences round-trip as raw input', () => {
  const original = checkpoint(), restored = parseWorkbenchCheckpoint(JSON.parse(JSON.stringify(original)));
  assert.deepEqual(restored, original); assert.equal(workbenchCheckpointIssue(restored!, context()), '');
  assert.equal(restored!.cellEdit!.text, 'invalid'); assert.equal(restored!.json, '{unfinished'); assert.equal(restored!.page, 2); assert.equal(restored!.message, 'draft commit message');
});
test('checkpoint restoration requires the same actor, project, branch, base and semantic rules', () => {
  for (const [field, value] of [['identity', 'other'], ['project', '/repos/other/test'], ['branch', 'other'], ['baseCommit', 'new-head'], ['schemaHash', 'new-rules']] as const) assert.ok(workbenchCheckpointIssue(checkpoint(), { ...context(), [field]: value }));
});
test('a newly committed, discarded or concurrently updated valid draft cannot be resurrected from UI input', () => {
  const saved = { ...checkpoint(), privateDraft: { id: 'draft', revision: 2 } };
  assert.match(workbenchCheckpointIssue(saved, context()), /不会覆盖或复活/);
  const draft = { id: 'draft', ref: 'main', baseCommit: 'base', draftRevision: 2, schemaHash: 'rules', schemaHashes: { dataset: '', sample: '' }, createdAt: '', updatedAt: '', operationCount: 1 };
  assert.equal(workbenchCheckpointIssue(saved, { ...context(), draft }), '');
  assert.match(workbenchCheckpointIssue(saved, { ...context(), draft: { ...draft, draftRevision: 3 } }), /不会覆盖或复活/);
  assert.match(workbenchCheckpointIssue(checkpoint(), { ...context(), draft }), /不会覆盖或复活/);
});
test('withdrawn permissions keep the raw input available but refuse its automatic application', () => {
  assert.ok(workbenchCheckpointIssue(checkpoint(), { ...context(), canEdit: false }));
  assert.ok(workbenchCheckpointIssue(checkpoint(), { ...context(), canAppend: false }));
  assert.ok(workbenchCheckpointIssue({ ...checkpoint(), operations: [{ op: 'assign', scope: 'row', rowId: 'one', values: { quality: 'synthetic' } }] }, { ...context(), canAssign: false }));
  assert.ok(workbenchCheckpointIssue(checkpoint(), { ...context(), historical: true }));
});
test('opaque malformed checkpoint envelopes are not treated as valid editor state', () => {
  assert.equal(parseWorkbenchCheckpoint({ version: 1 }), undefined);
  assert.equal(parseWorkbenchCheckpoint({ ...checkpoint(), operations: [{ op: 'execute' }] }), undefined);
  assert.equal(parseWorkbenchCheckpoint(null), undefined);
});

test('view-only checkpoints follow new head/rules without warnings or losing the current draft, while all real input remains guarded', () => {
  const empty: WorkbenchCheckpoint = { ...checkpoint(), operations: [], editing: false, cellEdit: undefined, json: '{}', jsonBaseline: '{}', drawer: '', feedback: '', fine: { kind: 'span', pointer: '', start: 0, end: 1, values: {}, note: '' }, bulkValues: {} };
  const current = { ...context(), baseCommit: 'new-head', schemaHash: 'new-rules' }, operations = [{ op: 'update' as const, rowId: 'one', record: { score: 90 } }];
  assert.equal(workbenchCheckpointHasInput(empty), false);
  const adapted = adaptWorkbenchViewCheckpoint(empty, current, operations);
  assert.equal(workbenchCheckpointIssue(adapted, current), ''); assert.deepEqual(adapted.operations, operations);
  assert.deepEqual(adapted.visibleColumns, empty.visibleColumns); assert.equal(adapted.message, empty.message);
  for (const input of [{ ...empty, operations }, { ...empty, editing: true, json: '{invalid' }, { ...empty, cellEdit: checkpoint().cellEdit }, { ...empty, drawer: 'append' }, { ...empty, fine: { ...empty.fine, note: 'unfinished' } }, { ...empty, bulkValues: { quality: 'pending' } }, { ...empty, feedback: 'unfinished' }]) {
    assert.equal(workbenchCheckpointHasInput(input), true);
    assert.equal(adaptWorkbenchViewCheckpoint(input, current, []), input);
    assert.match(workbenchCheckpointIssue(input, current), /基点已改变/);
  }
  assert.equal([empty, checkpoint()].filter(workbenchCheckpointHasInput).length, 1, 'Old empty retained checkpoints are removable without dropping real input');
});

test('explicit checkpoint conflict recovery keeps local raw input active and retains distinct remote work without archiving pure views', () => {
  const local = checkpoint(), view = { ...checkpoint(), operations: [], editing: false, cellEdit: undefined, drawer: '', feedback: '', fine: { ...checkpoint().fine, pointer: '', values: {}, note: '' }, bulkValues: {} };
  const previous = { ...checkpoint(), json: '{previous remote input', savedAt: 'earlier' };
  const latest = { ...checkpoint(), json: '{latest remote input', savedAt: 'later', retainedInputs: [previous, view] };
  const merged = retainConflictingWorkbenchInput(local, latest);
  assert.equal(merged.json, local.json); assert.deepEqual(merged.cellEdit, local.cellEdit);
  assert.equal(merged.retainedInputs?.length, 2); assert.equal(merged.retainedInputs?.[1]?.json, latest.json);
  assert.equal(merged.retainedInputs?.[0]?.json, previous.json); assert.equal(merged.retainedInputs?.some(item => item.retainedInputs), false);
  assert.deepEqual(retainConflictingWorkbenchInput(local, view).retainedInputs, []);
  assert.equal(retainConflictingWorkbenchInput(merged, latest).retainedInputs?.length, 2, 'Explicit retries must not grow duplicate copies');
  assert.equal(local.retainedInputs, undefined); assert.throws(() => retainConflictingWorkbenchInput(local, { ...latest, identity: 'other actor' }));
});
