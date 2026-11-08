import test from 'node:test';
import assert from 'node:assert/strict';
import { nextTick, reactive } from 'vue';
import { datasetSelectionAction, watchDatasetContext } from '../../web/src/dataset-navigation.js';

test('row links replace the query object without invalidating the loaded dataset or unsaved edits', async () => {
  const state = reactive({ base: '/api/repos/local/synthetic', branch: 'main', principal: 'collaborator:synthetic', query: { branch: 'main', sample: 'one' } as Record<string, unknown> });
  const rows = [{ id: 'one', text: 'Synthetic one' }, { id: 'two', text: 'Synthetic two' }], pending = [{ rowId: 'one', text: 'Unsaved synthetic edit' }];
  let fetches = 0, loaded: typeof rows | undefined;
  const stop = watchDatasetContext({ base: () => state.base, branch: () => state.branch, commit: () => state.query.commit, principal: () => state.principal }, () => { fetches++; loaded = rows; });
  try {
    for (const sample of ['two', 'one', 'two']) {
      state.query = { ...state.query, sample };
      await nextTick();
      assert.equal(fetches, 1, 'Selection must not trigger a dataset reset or request');
      assert.equal(loaded, rows, 'Already-rendered page identity remains stable');
      assert.equal(pending[0]!.text, 'Unsaved synthetic edit');
    }
    state.query = { ...state.query, task: 'synthetic-task', notice: 'unrelated' };
    await nextTick();
    assert.equal(fetches, 1);
  } finally { stop(); }
});

test('repository, branch, fixed commit and identity changes still reload one dataset context', async () => {
  const state = reactive({ base: '/api/repos/local/one', branch: 'main', principal: 'owner', query: {} as Record<string, unknown> });
  let resets = 0;
  const stop = watchDatasetContext({ base: () => state.base, branch: () => state.branch, commit: () => state.query.commit, principal: () => state.principal }, () => { resets++; });
  try {
    assert.equal(resets, 1);
    state.branch = 'annotation/a'; state.query = { branch: state.branch, sample: 'two' };
    await nextTick(); assert.equal(resets, 2);
    state.query = { ...state.query, commit: 'fixed-a' };
    await nextTick(); assert.equal(resets, 3);
    state.query = { ...state.query, sample: 'one' };
    await nextTick(); assert.equal(resets, 3);
    state.principal = 'viewer';
    await nextTick(); assert.equal(resets, 4);
    state.base = '/api/repos/local/two'; state.branch = 'main'; state.query = {};
    await nextTick(); assert.equal(resets, 5, 'Combined navigation is batched into one reset');
  } finally { stop(); }
});

test('loaded sample selection stays local and an external off-page deep link requests a locate', () => {
  assert.equal(datasetSelectionAction('two', 'one', ['one', 'two']), 'select');
  assert.equal(datasetSelectionAction('one', 'one', ['one', 'two']), 'none');
  assert.equal(datasetSelectionAction('sample-on-page-20', 'one', ['one', 'two']), 'locate');
  assert.equal(datasetSelectionAction(undefined, 'one', ['one', 'two']), 'none');
  assert.equal(datasetSelectionAction(['one', 'two'], 'one', ['one', 'two']), 'none');
});
