import type { DatasetOperation } from '../../../packages/shared/src/dataset';
import type { TableColumn } from '../../../packages/shared/src/index';

/** Project staged own keys locally so a first append is readable before its draft is saved. */
export function pendingDatasetColumns(base: TableColumn[], operations: DatasetOperation[]): TableColumn[] {
  const existing = new Set(base.map(column => column.name)), types = new Map<string, Set<string>>();
  for (const operation of operations) {
    if (operation.op !== 'append' && operation.op !== 'update') continue;
    for (const [name, value] of Object.entries(operation.record)) {
      if (existing.has(name)) continue;
      const values = types.get(name) ?? new Set<string>();
      values.add(value === null ? 'null' : Array.isArray(value) ? 'list' : typeof value === 'number' ? Number.isInteger(value) ? 'i64' : 'f64' : typeof value === 'boolean' ? 'bool' : typeof value === 'string' ? 'str' : 'struct');
      types.set(name, values);
    }
  }
  return [...base, ...[...types].map(([name, values]) => {
    const nonNull = [...values].filter(value => value !== 'null');
    return { name, dtype: nonNull.length > 1 ? nonNull.every(value => value === 'i64' || value === 'f64') ? 'f64' : 'json' : nonNull[0] ?? 'null' };
  })];
}

/** Only genuinely new fields are exposed; a previously hidden field stays hidden. */
export function exposeNewDatasetColumns(visible: string[], known: ReadonlySet<string>, columns: TableColumn[]) {
  return { visible: [...new Set([...visible, ...columns.filter(column => !known.has(column.name)).map(column => column.name)])], known: new Set([...known, ...columns.map(column => column.name)]) };
}
