import {durableWriteJson} from './durable-store.js';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { RepoKey } from './provider.js';

/** Creation is BFF control-plane metadata, never inferred from an old summary timestamp. */
export class RepositoryActivityStore {
  private created: Record<string, string> = {};
  private chain = Promise.resolve();
  constructor(private filename: string) {}
  async init() {
    try {
      const state = JSON.parse(await readFile(this.filename, 'utf8'));
      if (state.version !== 1 || !state.created || typeof state.created !== 'object' || Object.values(state.created).some(value => typeof value !== 'string' || !Number.isFinite(Date.parse(value)))) throw new Error('Invalid repository activity state.');
      this.created = state.created;
    } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; }
  }
  read(key: RepoKey) { return { createdAt: this.created[`${key.namespace}/${key.repo}`] }; }
  async recordCreated(key: RepoKey) {
    const current = this.chain.then(async () => {
      const id = `${key.namespace}/${key.repo}`;
      if (this.created[id]) return;
      const next = { ...this.created, [id]: new Date().toISOString() };
      await mkdir(path.dirname(this.filename), { recursive: true });
      await durableWriteJson(this.filename,{version:1,created:next});
      this.created = next;
    });
    this.chain = current.catch(() => {}); await current;
  }
}
