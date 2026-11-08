import type { DatasetUiState, DatasetUiStateKind } from '../../../packages/shared/src/dataset-ui-state';
import { queryString, request } from './api';

export interface DatasetUiStateClientOptions {
  base: string; ref: string; kind: DatasetUiStateKind;
  /** Actor/context generation captured at construction; stale work must never update its successor. */
  context?: () => string;
  request?: typeof request;
}
export interface DatasetUiStateClient {
  readonly state: DatasetUiState | undefined;
  load(): Promise<DatasetUiState | undefined>;
  save(payload: unknown, baseCommit?: string): Promise<DatasetUiState>;
  remove(): Promise<void>;
}

/** One component context owns one client. Writes are serialized, never retried across a CAS conflict. */
export function createDatasetUiStateClient(options: DatasetUiStateClientOptions): DatasetUiStateClient {
  const send = options.request ?? request, context = options.context?.();
  let state: DatasetUiState | undefined, loaded = false, loading: Promise<DatasetUiState | undefined> | undefined, writes: Promise<unknown> = Promise.resolve();
  const check = () => { if (options.context && options.context() !== context) throw new Error('编辑上下文已变化，保留的输入尚未应用到其他身份或分支。'); };
  async function load() {
    check(); if (loaded) return state;
    if (!loading) loading = (async () => {
      const response = await send<{ state?: DatasetUiState }>(options.base + '/dataset/ui-state' + queryString({ ref: options.ref, kind: options.kind }));
      check(); state = response.state; loaded = true; return state;
    })().finally(() => { loading = undefined; });
    return loading;
  }
  function enqueue<T>(action: () => Promise<T>): Promise<T> {
    const next = writes.then(action); writes = next.catch(() => undefined); return next;
  }
  return {
    get state() { return state; }, load,
    save(payload, baseCommit) {
      // Capture before queueing so later keystrokes cannot mutate an in-flight request.
      const captured = JSON.parse(JSON.stringify(payload)) as DatasetUiState['payload'];
      return enqueue(async () => {
        check(); await load(); check();
        const response = await send<{ state: DatasetUiState }>(options.base + '/dataset/ui-state', { method: 'PUT', body: JSON.stringify({ ref: options.ref, kind: options.kind, revision: state?.revision ?? 0, ...(state ? { expectedId: state.id } : {}), ...(baseCommit ? { baseCommit } : {}), payload: captured }) });
        check(); state = response.state; return state;
      });
    },
    remove() { return enqueue(async () => { check(); await load(); if (!state) return; await send(options.base + '/dataset/ui-state', { method: 'DELETE', body: JSON.stringify({ ref: options.ref, kind: options.kind, revision: state.revision, expectedId: state.id }) }); check(); state = undefined; }); },
  };
}
