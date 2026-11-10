import test from 'node:test';
import assert from 'node:assert/strict';
import { isProxy, reactive, ref } from 'vue';
import { defaultGlobalFieldCatalog } from '../../../packages/shared/src/global-fields.js';
import { cloneGlobalFieldDraft } from '../../web/src/global-field-draft.js';

test('restoring a Vue reactive global directory draft produces detached plain JSON fields', () => {
  const source = ref(reactive(defaultGlobalFieldCatalog().fields));
  assert.ok(isProxy(source.value));
  assert.ok(isProxy(source.value[0]!.options[0]!));
  const recovered = cloneGlobalFieldDraft(source.value);
  assert.deepEqual(recovered, JSON.parse(JSON.stringify(source.value)));
  assert.equal(isProxy(recovered), false);
  assert.equal(isProxy(recovered[0]!.options[0]!), false);
  recovered[0]!.options[0]!.displayName = 'Synthetic local edit';
  assert.notEqual(source.value[0]!.options[0]!.displayName, 'Synthetic local edit');
  assert.deepEqual(cloneGlobalFieldDraft(ref([]).value), []);
});
