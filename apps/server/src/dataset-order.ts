import type { DatasetSort } from '../../../packages/shared/src/dataset.js';
import { canonicalJson } from './dataset-storage.js';

/** Preserve source types and stable ties. Null/missing values stay last in either direction. */
export function orderedDatasetIds(ids: readonly string[], value: (id: string) => unknown, direction: DatasetSort['direction']): string[] {
  const rank = (item: unknown) => item === undefined ? 5 : item === null ? 4 : typeof item === 'number' ? 0 : typeof item === 'boolean' ? 1 : typeof item === 'string' ? 2 : 3;
  return ids.map((id, index) => ({ id, index, value: value(id) })).sort((a, b) => {
    const ar = rank(a.value), br = rank(b.value);
    if (ar >= 4 || br >= 4) return ar - br || a.index - b.index;
    let compared = ar - br;
    if (!compared && typeof a.value === 'number' && typeof b.value === 'number') compared = a.value - b.value;
    else if (!compared && typeof a.value === 'boolean' && typeof b.value === 'boolean') compared = Number(a.value) - Number(b.value);
    else if (!compared) { const av = typeof a.value === 'string' ? a.value : canonicalJson(a.value), bv = typeof b.value === 'string' ? b.value : canonicalJson(b.value); compared = av < bv ? -1 : av > bv ? 1 : 0; }
    return (direction === 'asc' ? compared : -compared) || a.index - b.index;
  }).map(item => item.id);
}
