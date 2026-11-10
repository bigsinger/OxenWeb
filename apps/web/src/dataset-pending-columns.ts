import type { DatasetOperation } from '../../../packages/shared/src/dataset';
import type { TableColumn } from '../../../packages/shared/src/index';
import {type DatasetFieldMetadata} from '../../../packages/shared/src/field-metadata';

/** Project display policy bounds the table without erasing a person's saved column choices. */
export function datasetTableColumns<T extends {name:string}>(columns:T[],fields?:Readonly<Record<string,DatasetFieldMetadata>>,visible?:readonly string[]):T[]{
  const selected=visible===undefined?undefined:new Set(visible);
  return columns.filter(column=>fields?.[column.name]?.visible!==false&&(!selected||selected.has(column.name)));
}

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

/** Show the full source/configuration initially; retain later deliberate personal hides. */
export function refreshedDatasetColumnVisibility(input:{columns:TableColumn[];fields?:Record<string,DatasetFieldMetadata>;attachmentFields:string[];visible:string[];knownSource:ReadonlySet<string>;knownConfigured:ReadonlySet<string>}){
  const configured=Object.keys(input.fields??{}),initial=!input.knownSource.size&&!input.knownConfigured.size&&!input.visible.length;
  const visible=initial?[...input.columns.map(column=>column.name),...configured]:[...exposeNewDatasetColumns(input.visible.filter(field=>input.columns.some(column=>column.name===field)),input.knownSource,input.columns).visible,...configured.filter(field=>!input.knownConfigured.has(field))];
  return {visible:[...new Set(visible)],configured};
}

export function restoreDatasetColumnVisibility(visible:string[],seenConfigured:readonly string[]|undefined,fields:Record<string,DatasetFieldMetadata>|undefined,columns:TableColumn[],seenSource?:readonly string[]){const configured=Object.keys(fields??{}),seen=new Set(seenConfigured??[]),sourceSeen=new Set(seenSource??[]),available=new Set(columns.map(column=>column.name));return [...new Set([...visible.filter(id=>available.has(id)),...columns.filter(column=>!sourceSeen.has(column.name)).map(column=>column.name),...configured.filter(id=>available.has(id)&&!seen.has(id))])];}
