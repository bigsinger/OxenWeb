import test from 'node:test';
import assert from 'node:assert/strict';
import { datasetTableLayout } from '../../web/src/dataset-table-layout.js';

test('fixed columns keep exact pixels and the remaining viewport follows configured 1:5 weights', () => {
  const result = datasetTableLayout([{ id: 'id', autoWidth: 142, width: { mode: 'fixed', value: 100 } }, { id: 'title', autoWidth: 344, width: { mode: 'weight', value: 1 } }, { id: 'content', autoWidth: 344, width: { mode: 'weight', value: 5 } }], 1200);
  assert.equal(result.widths.id, 100); assert.equal(result.total, 1200);
  assert.ok(Math.abs(result.widths.content! / result.widths.title! - 5) < 0.000001);
  assert.equal(result.widths.title! + result.widths.content!, 1200 - 266 - 100);
});
test('small weighted columns respect the minimum and overflow remains inside the table when needed', () => {
  const columns = [{ id: 'tiny', autoWidth: 158, width: { mode: 'weight' as const, value: 1 } }, { id: 'large', autoWidth: 344, width: { mode: 'weight' as const, value: 1000 } }];
  const wide = datasetTableLayout(columns, 800);
  assert.equal(wide.widths.tiny, 48); assert.equal(wide.widths.large, 486); assert.equal(wide.total, 800);
  const narrow = datasetTableLayout(columns, 300);
  assert.equal(narrow.widths.tiny, 48); assert.equal(narrow.widths.large, 48); assert.equal(narrow.total, 362);
});
test('automatic columns fill unused width while explicit fixed columns never stretch', () => {
  const result = datasetTableLayout([{ id: 'id', autoWidth: 142, width: { mode: 'fixed', value: 100 } }, { id: 'text', autoWidth: 344 }], 1000);
  assert.equal(result.widths.id, 100); assert.equal(result.widths.text, 634); assert.equal(result.total, 1000);
  const fixed = datasetTableLayout([{ id: 'id', autoWidth: 142, width: { mode: 'fixed', value: 100 } }], 1000);
  assert.equal(fixed.total, 366); assert.equal(fixed.widths.id, 100);
});
test('container resize recomputes proportional widths without changing the field configuration', () => {
  const columns = [{ id: 'a', autoWidth: 158, width: { mode: 'weight' as const, value: 1 } }, { id: 'b', autoWidth: 344, width: { mode: 'weight' as const, value: 5 } }], original = structuredClone(columns);
  assert.equal(datasetTableLayout(columns, 1200).total, 1200); assert.equal(datasetTableLayout(columns, 700).total, 700);
  assert.deepEqual(columns, original);
  assert.deepEqual(datasetTableLayout(columns, 700), datasetTableLayout(columns, 700), 'An overlay opening does not change the measured base viewport');
});
