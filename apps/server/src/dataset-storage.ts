import { createHash } from 'node:crypto';
import type { DatasetLabelConflict, DatasetLabelRecord } from '../../../packages/shared/src/dataset.js';
import type { LabelAssignment, LabelDocument } from '../../../packages/shared/src/index.js';
import type { Provider, RepoKey } from './provider.js';
import { ApiError } from './errors.js';
import { safeFilePath } from './safety.js';

export const DATASET_ROOT = '.oxenweb/dataset';
export const DATASET_FORMAT_PATH = `${DATASET_ROOT}/format.json`;
export function canonicalJson(value: unknown): string {
  const sort = (item: unknown): unknown => Array.isArray(item) ? item.map(sort) : item !== null && typeof item === 'object' ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => [key, sort(value)])) : item;
  return JSON.stringify(sort(value));
}
export function datasetHash(value: unknown): string { return createHash('sha256').update(canonicalJson(value)).digest('hex'); }
export function targetKey(target: Pick<LabelAssignment, 'scope'|'path'|'rowId'>): string { return JSON.stringify([target.scope, target.path ?? '', target.rowId ?? '']); }
export function labelRecordPath(target: Pick<LabelAssignment, 'scope'|'path'|'rowId'>, actorId: string): string { return `${DATASET_ROOT}/labels/${target.scope}/${datasetHash({target:targetKey(target),actorId})}.json`; }
export function legacyLabelRecordPath(target: Pick<LabelAssignment, 'scope'|'path'|'rowId'>, actorId: string): string { return `${DATASET_ROOT}/labels/${target.scope}/${datasetHash(targetKey(target))}-${datasetHash(actorId)}.json`; }
export function rowRecordPath(rowId: string): string { return `${DATASET_ROOT}/rows/${datasetHash(rowId)}.json`; }
export function labelFingerprint(record:DatasetLabelRecord):string{return datasetHash({scope:record.scope,path:record.path,rowId:record.rowId,actor:record.actor.id,values:record.values,spans:record.spans,steps:record.steps,contentHash:record.contentHash,templateSnapshot:record.templateSnapshot});}
export async function optionalRaw(provider: Provider, key: RepoKey, ref: string, filename: string) {
  try { return await provider.raw(key, ref, safeFilePath(filename)); }
  catch (error) { if (error instanceof ApiError && error.status === 404) return undefined; throw error; }
}
export async function storedJson(provider: Provider, key: RepoKey, ref: string, filename: string): Promise<unknown | undefined> {
  const raw = await optionalRaw(provider, key, ref, filename);
  if (!raw) return undefined;
  if (raw.content.length > 8 * 1024 * 1024) throw new ApiError(413, 'DATASET_RECORD_LIMIT', '单个数据集版本记录超过 8 MiB。');
  try { return JSON.parse(raw.content.toString('utf8')); }
  catch { throw new ApiError(422, 'DATASET_STORAGE_INVALID', '数据集版本记录不是有效 JSON。', { path: filename }); }
}
export async function datasetFiles(provider: Provider, key: RepoKey, ref: string, directory: string, limit = 50_000): Promise<string[]> {
  const result: string[] = [];
  const walk = async (current: string, depth: number) => {
    if (depth > 5) throw new ApiError(422, 'DATASET_STORAGE_INVALID', '数据集记录目录层级异常。');
    let entries;
    try { entries = await provider.tree(key, ref, current); }
    catch (error) { if (error instanceof ApiError && error.status === 404) return; throw error; }
    for (const entry of entries) {
      const filename = safeFilePath(entry.path);
      if (!filename.startsWith(directory + '/')) throw new ApiError(422, 'DATASET_STORAGE_INVALID', '数据集记录目录返回了范围外的路径。');
      if (entry.kind === 'directory') await walk(filename, depth + 1);
      else if (filename.endsWith('.json')) result.push(filename);
      if (result.length > limit) throw new ApiError(413, 'DATASET_RECORD_LIMIT', '当前数据集版本记录数量超过支持上限。');
    }
  };
  await walk(directory, 0);
  return result.sort();
}
export async function concurrentMap<T, R>(items: T[], work: (item: T) => Promise<R>, concurrency = 8): Promise<R[]> {
  const result: R[] = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => { for (;;) { const index = next++; if (index >= items.length) break; result[index] = await work(items[index]!); } }));
  return result;
}
export async function readLabelRecordStore(provider:Provider,key:RepoKey,ref:string):Promise<{records:DatasetLabelRecord[];superseded:Array<{path:string;record:DatasetLabelRecord;supersededBy:string}>}>{
  if (!await optionalRaw(provider, key, ref, DATASET_FORMAT_PATH)) return {records:[],superseded:[]};
  const files = await datasetFiles(provider, key, ref, `${DATASET_ROOT}/labels`);
  const stored=await concurrentMap(files, async filename => {
    const record = await storedJson(provider, key, ref, filename) as DatasetLabelRecord;
    if (!record || record.version !== 1 || !['dataset','file','row'].includes(record.scope) || typeof record.actor?.id!=='string' || !record.actor.id || !record.values || typeof record.values !== 'object' || Array.isArray(record.values) || !Array.isArray(record.spans) || !Array.isArray(record.steps) || !record.templateSnapshot || ![labelRecordPath(record, record.actor.id),legacyLabelRecordPath(record,record.actor.id)].includes(filename) || record.fingerprint!==labelFingerprint(record)) throw new ApiError(422, 'DATASET_STORAGE_INVALID', '独立标注记录的结构、身份或内容指纹不匹配。', { path: filename });
    return {path:filename,record};
  });
  const active=new Map<string,typeof stored[number]>(),superseded:Array<{path:string;record:DatasetLabelRecord;supersededBy:string}>=[];
  for(const entry of stored){const key=targetKey(entry.record)+'\n'+entry.record.actor.id,previous=active.get(key);if(!previous){active.set(key,entry);continue;}const preferred=entry.path===labelRecordPath(entry.record,entry.record.actor.id)?entry:previous,older=preferred===entry?previous:entry;active.set(key,preferred);superseded.push({...older,supersededBy:preferred.path});}
  return {records:[...active.values()].map(item=>item.record),superseded};
}
export async function readLabelRecords(provider: Provider, key: RepoKey, ref: string): Promise<DatasetLabelRecord[]> {return (await readLabelRecordStore(provider,key,ref)).records;}
export function materializeLabelAssignments(document: LabelDocument, records: DatasetLabelRecord[]): {assignments:LabelAssignment[];conflicts:DatasetLabelConflict[]} {
  const assignments = new Map(document.assignments.map(item => [targetKey(item), structuredClone(item)]));
  const groups = new Map<string, DatasetLabelRecord[]>();
  for (const record of records) { const group = groups.get(targetKey(record)) ?? []; group.push(record); groups.set(targetKey(record), group); }
  const conflicts: DatasetLabelConflict[] = [];
  for (const [key, group] of groups) {
    const target = group[0]!, existing = assignments.get(key);
    const values = { ...existing?.values };
    const columns = new Set(group.flatMap(record => Object.keys(record.values)));
    for (const columnId of columns) {
      const opinions = group.filter(record => Object.hasOwn(record.values, columnId));
      const unique = new Set(opinions.map(record => canonicalJson(record.values[columnId])));
      if (unique.size > 1) {
        delete values[columnId];
        conflicts.push({ scope:target.scope, ...(target.path?{path:target.path}:{}), ...(target.rowId?{rowId:target.rowId}:{}), columnId, actors:opinions.map(record=>record.actor.id) });
      } else {
        const value = opinions[0]!.values[columnId];
        if (value === null) delete values[columnId]; else if (value !== undefined) values[columnId] = value;
      }
    }
    assignments.set(key, { id: createHash('sha256').update(key).digest('hex').slice(0,24), scope:target.scope, ...(target.path?{path:target.path}:{}), ...(target.rowId?{rowId:target.rowId}:{}), values });
  }
  return { assignments:[...assignments.values()], conflicts };
}
