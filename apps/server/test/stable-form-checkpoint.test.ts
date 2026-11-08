import test from 'node:test';
import assert from 'node:assert/strict';
import { persistStableForm } from '../../web/src/stable-form-checkpoint.js';

test('navigation waits for a second checkpoint when new form input arrives during the first save', async () => {
  let form = '{unfinished', release: (() => void) | undefined;
  const written: string[] = [];
  const leaving = persistStableForm({ generation: () => 1, signature: () => form, persist: async () => {
    const captured = form;
    if (!written.length) await new Promise<void>(resolve => { release = resolve; });
    written.push(captured); return true;
  } });
  form = '{unfinished, "last_input":'; release?.();
  assert.equal(await leaving, true);
  assert.deepEqual(written, ['{unfinished', '{unfinished, "last_input":']);
});

test('deferred recovery leaves safely without requiring its intentionally different saved baseline to converge', async () => {
  let saves = 0;
  assert.equal(await persistStableForm({ generation: () => 1, signature: () => 'current read-only comparison form', persist: async () => { saves++; return true; } }), true);
  assert.equal(saves, 1, 'pendingRecovery/recoveryInvalid skip persistence while the raw form is unchanged');
});

test('a failed write or a changed component generation blocks navigation without replaying another context', async () => {
  assert.equal(await persistStableForm({ generation: () => 1, signature: () => 'raw', persist: async () => false }), false);
  let generation = 1, saves = 0;
  const allowed = await persistStableForm({ generation: () => generation, signature: () => 'raw', persist: async () => { saves++; return true; }, settle: async () => { generation++; } });
  assert.equal(allowed, false); assert.equal(saves, 1);
});
