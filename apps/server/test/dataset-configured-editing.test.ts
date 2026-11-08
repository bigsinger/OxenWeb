import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditableCell, datasetCellControl, datasetRecordConfigurationError, editableCellOptionIndex, editableCellSelectOption, editableCellToggleOption, parseEditableCell } from '../../web/src/dataset-configured-editing.js';

test('configured fields select semantic controls even when the current row does not contain a value', () => {
  for (const [definition, expected] of [[{ type: 'string' }, 'text'], [{ type: 'integer' }, 'number'], [{ type: 'number' }, 'number'], [{ type: 'boolean' }, 'checkbox'], [{ type: 'array' }, 'json'], [{ type: 'object' }, 'json'], [{ type: 'array', items: { enum: ['one', 'two'] } }, 'multicheck'], [{ enum: [0, 1] }, 'select']] as const) {
    const draft = createEditableCell({}, 'synthetic', definition);
    assert.equal(draft.presence, 'missing'); assert.equal(datasetCellControl(definition, draft), expected);
    assert.deepEqual(parseEditableCell(draft, definition), { present: false }, 'Opening a missing field never invents a default value');
  }
});

test('checkbox and numeric edits keep native JSON booleans and numbers', () => {
  const flag = createEditableCell({ enabled: true }, 'enabled', { type: 'boolean' });
  assert.deepEqual(parseEditableCell({ ...flag, text: 'false' }, { type: 'boolean' }), { present: true, value: false });
  const score = createEditableCell({ score: 1 }, 'score', { type: 'integer' });
  assert.deepEqual(parseEditableCell({ ...score, text: '42' }, { type: 'integer' }), { present: true, value: 42 });
  assert.throws(() => parseEditableCell({ ...score, text: '2.5' }, { type: 'integer' }));
  assert.throws(() => parseEditableCell({ ...score, text: '' }, { type: 'number' }));
});

test('enum indexes preserve the difference between numeric, string and boolean option values', () => {
  const definition = { enum: [1, '1', false] }, initial = createEditableCell({ priority: '1' }, 'priority', definition);
  assert.equal(editableCellOptionIndex(initial, definition.enum), '1');
  const selected = editableCellSelectOption(initial, 1);
  assert.equal(editableCellOptionIndex(selected, definition.enum), '0');
  assert.deepEqual(parseEditableCell(selected, definition), { present: true, value: 1 });
  assert.deepEqual(parseEditableCell(editableCellSelectOption(initial, false), definition), { present: true, value: false });
  assert.throws(() => parseEditableCell({ ...initial, text: 'unknown' }, definition));
});

test('configured array checkboxes preserve typed members and remove only the exact selected option', () => {
  const definition = { type: 'array' as const, items: { enum: [1, '1', false] } }, initial = createEditableCell({ categories: [1, '1'] }, 'categories', definition);
  const unchecked = editableCellToggleOption(initial, 1, false), checked = editableCellToggleOption(unchecked, false, true);
  assert.deepEqual(parseEditableCell(checked, definition), { present: true, value: ['1', false] });
  assert.throws(() => parseEditableCell({ ...initial, text: '["unknown"]' }, definition));
  assert.throws(() => parseEditableCell({ ...initial, text: '[1,"1"]' }, { type: 'array', items: { type: 'integer' } }));
});

test('empty text, explicit null and omitted fields remain separate, respecting required and nullable independently', () => {
  const initial = createEditableCell({ note: '' }, 'note', { type: 'string' });
  assert.deepEqual(parseEditableCell(initial, { type: 'string', required: true, nullable: false }), { present: true, value: '' });
  assert.deepEqual(parseEditableCell({ ...initial, presence: 'null' }, { type: 'string', required: true }), { present: true, value: null });
  assert.deepEqual(parseEditableCell({ ...initial, presence: 'missing' }, { type: 'string', nullable: false }), { present: false });
  assert.throws(() => parseEditableCell({ ...initial, presence: 'null' }, { nullable: false }));
  assert.throws(() => parseEditableCell({ ...initial, presence: 'missing' }, { required: true }));
});

test('unconfigured fields retain their existing real type, including nested JSON and multiline text', () => {
  for (const value of [false, 0, [false, 1, '1'], { nested: ['text', false] }, 'line one\nline two', null]) {
    const draft = createEditableCell({ value }, 'value');
    assert.deepEqual(parseEditableCell(draft), { present: true, value });
  }
  assert.equal(datasetCellControl(undefined, createEditableCell({ value: false }, 'value')), 'checkbox');
  assert.equal(datasetCellControl(undefined, createEditableCell({ value: 0 }, 'value')), 'number');
});

test('full JSON validation uses the same configured rules as inline controls instead of silently converting values', () => {
  const fields = { enabled: { type: 'boolean' as const }, priority: { type: 'integer' as const, enum: [1, 2] }, categories: { type: 'array' as const, items: { type: 'string' as const, enum: ['a', 'b'] } }, note: { type: 'string' as const, required: true, nullable: false } };
  const valid = { enabled: false, priority: 1, categories: ['a'], note: '' };
  assert.equal(datasetRecordConfigurationError(valid, fields), undefined);
  for (const invalid of [{ ...valid, enabled: 'false' }, { ...valid, priority: '1' }, { ...valid, priority: 1.5 }, { ...valid, categories: ['c'] }, { ...valid, note: null }, { enabled: false, priority: 1, categories: [] }]) assert.ok(datasetRecordConfigurationError(invalid, fields));
});
