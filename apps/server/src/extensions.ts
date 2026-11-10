import {durableWriteJson} from './durable-store.js';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Annotation } from '../../../packages/shared/src/index.js';
import type { RepoKey } from './provider.js';

export interface ExtendedAnnotation extends Annotation { commitId: string }
interface ExtensionState {
  version: 1;
  metadata: Record<string, { description: string; tags: string[] }>;
  annotations: Record<string, ExtendedAnnotation[]>;
}

// These records belong to Oxen Web, not to the upstream server's access-control or SaaS task model.
export class ExtensionStore {
  private state: ExtensionState = { version: 1, metadata: {}, annotations: {} };
  private chain = Promise.resolve();
  constructor(private filename: string) {}
  async init() {
    try {
      this.state = JSON.parse(await readFile(this.filename, 'utf8')) as ExtensionState;
      if (this.state.version !== 1 || !this.state.metadata || !this.state.annotations) throw new Error('Invalid Oxen Web extension state.');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  private key(key: RepoKey) { return `${key.namespace}/${key.repo}`; }
  private mutate<T>(operation: () => T): Promise<T> {
    let result!: T;
    const next = this.chain.then(async () => {
      const previous = structuredClone(this.state);
      try {
        result = operation();
        await mkdir(path.dirname(this.filename), { recursive: true });
        await durableWriteJson(this.filename,this.state);
      } catch (error) { this.state = previous; throw error; }
    });
    this.chain = next.catch(() => {});
    return next.then(() => structuredClone(result));
  }
  metadata(key: RepoKey) { return structuredClone(this.state.metadata[this.key(key)] ?? { description: '', tags: [] }); }
  async updateMetadata(key: RepoKey, input: { description?: string; tags?: string[] }) {
    return this.mutate(() => { const current = this.metadata(key); const result = { ...current, ...input }; this.state.metadata[this.key(key)] = result; return result; });
  }
  annotations(key: RepoKey, commitId: string, filename?: string) { return structuredClone((this.state.annotations[this.key(key)] ?? []).filter(item => item.commitId === commitId && (!filename || item.path === filename))); }
  annotationsInHistory(key: RepoKey, commitIds: string[]): Annotation[] {
    const rank = new Map(commitIds.map((id, index) => [id, index]));
    const records = (this.state.annotations[this.key(key)] ?? []).filter(item => rank.has(item.commitId)).sort((a, b) => rank.get(a.commitId)! - rank.get(b.commitId)!);
    const unique = new Map<string, Annotation>();
    for (const item of records) { const id = JSON.stringify([item.path, item.rowId]); if (!unique.has(id)) unique.set(id, item); }
    return structuredClone([...unique.values()]);
  }
  async annotate(key: RepoKey, commitId: string, input: Omit<Annotation, 'id' | 'author' | 'updatedAt'>) {
    return this.mutate(() => {
      const annotations = this.state.annotations[this.key(key)] ??= [];
      const current = annotations.find(item => item.commitId === commitId && item.path === input.path && item.rowId === input.rowId);
      const annotation: ExtendedAnnotation = { ...input, commitId, id: current?.id ?? randomUUID(), author: 'Oxen Web user', updatedAt: new Date().toISOString() };
      if (current) Object.assign(current, annotation); else annotations.push(annotation);
      return annotation;
    });
  }
}
