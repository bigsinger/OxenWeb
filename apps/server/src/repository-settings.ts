import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { RepoSummary, RepositoryPolicy, RepositorySettingsState, RequestIdentity } from '../../../packages/shared/src/index.js';
import type { Provider, RepoKey, RepoPatch } from './provider.js';
import { ApiError } from './errors.js';
import { safeRef, safeSegment } from './safety.js';
import { capabilitySchema, repositoryRoleSchema } from './capabilities.js';

export const REPOSITORY_POLICY_PATH = '.oxenweb/repository.json';
export const SETTINGS_WORKSPACE_PREFIX = 'oxenweb-settings-';
export const collaboratorSchema = z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(120), role: repositoryRoleSchema, createdAt: z.string().datetime(), capabilities: z.array(capabilitySchema).max(12).optional() }).strict();
const policySchema = z.object({
  version: z.literal(1), displayName:z.string().trim().min(1).max(200).optional(),description: z.string().max(4000), tags: z.array(z.string().min(1).max(60)).max(20),
  defaultBranch: z.string().min(1).max(160).transform(safeRef), visibility: z.enum(['public', 'private']),
  collaborators: z.array(collaboratorSchema).max(1000), updatedAt: z.string(), updatedBy: z.string().max(160),
}).strict();
export const repositoryPatchSchema = z.object({
  displayName:z.string().trim().min(1).max(200).optional(),
  description: z.string().max(4000).optional(), tags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  defaultBranch: z.string().min(1).max(160).transform(safeRef).optional(), visibility: z.enum(['public', 'private']).optional(),
  expectedCommit: z.string().min(1).max(160).optional(),
}).strict();

const owner: RequestIdentity = { id: 'owner', name: 'Instance owner', kind: 'owner', source: 'local' };
export function repositoryPolicyPath(filename: string): boolean {
  return filename.replaceAll('\\', '/').toLowerCase().split('/').some(segment => segment === '.oxenweb') && filename.replaceAll('\\', '/').toLowerCase().endsWith('/repository.json');
}

/** Repository metadata and access policy are actual versioned Oxen content. No SaaS private API is called. */
export class RepositorySettingsService {
  private chains = new Map<string, Promise<void>>();
  private configurationBranches = new Map<string, string>();
  private pointerLoaded?: Promise<void>;
  private pointerChain = Promise.resolve();
  constructor(readonly provider: Provider, private pointerFile?: string) {}

  private async loadPointers() {
    if (!this.pointerLoaded) this.pointerLoaded = (async () => {
      if (!this.pointerFile) return;
      try {
        const state = z.object({ version: z.literal(1), branches: z.record(z.string(), z.string().transform(safeRef)) }).parse(JSON.parse(await readFile(this.pointerFile, 'utf8')));
        this.configurationBranches = new Map(Object.entries(state.branches));
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    })();
    await this.pointerLoaded;
  }
  private async persistPointers() {
    if (!this.pointerFile) return;
    const filename = this.pointerFile;
    const next = this.pointerChain.then(async () => {
      await mkdir(path.dirname(filename), { recursive: true });
      const temporary = `${filename}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify({ version: 1, branches: Object.fromEntries(this.configurationBranches) }, null, 2), { mode: 0o600 });
      await rename(temporary, filename);
    });
    this.pointerChain = next.catch(() => {}); await next;
  }

  private key(key: RepoKey) { safeSegment(key.namespace); safeSegment(key.repo); return `${key.namespace}/${key.repo}`; }
  private serialize<T>(key: RepoKey, action: () => Promise<T>): Promise<T> {
    const identity = this.key(key), previous = this.chains.get(identity) ?? Promise.resolve();
    const current = previous.then(action), settled = current.then(() => {}, () => {});
    this.chains.set(identity, settled);
    void settled.then(() => { if (this.chains.get(identity) === settled) this.chains.delete(identity); });
    return current;
  }
  async read(key: RepoKey): Promise<RepositorySettingsState> {
    await this.loadPointers();
    const identity = this.key(key);
    const [branches, summary] = await Promise.all([this.provider.branches(key), this.provider.repo(key)]);
    if (!branches.length) throw new ApiError(409, 'REPOSITORY_EMPTY', 'Initialize the repository before configuring settings.');
    let configurationBranch = this.configurationBranches.get(identity);
    if (configurationBranch && !branches.some(branch => branch.name === configurationBranch)) throw new ApiError(409, 'POLICY_BRANCH_MISSING', 'The fixed repository configuration branch was removed. Restore it before changing access policy.');
    if (!configurationBranch) {
      configurationBranch = branches.some(branch => branch.name === 'main') ? 'main' : branches.some(branch => branch.name === summary.defaultBranch) ? summary.defaultBranch : branches[0]!.name;
      this.configurationBranches.set(identity, configurationBranch);
      await this.persistPointers();
    }
    const head = branches.find(branch => branch.name === configurationBranch)!;
    let policy: RepositoryPolicy;
    let persisted = true;
    try {
      // Pin the read to the branch head so the policy and its revision agree.
      const file = await this.provider.raw(key, head.commitId, REPOSITORY_POLICY_PATH);
      if (file.content.byteLength > 1024 * 1024) throw new ApiError(502, 'INVALID_REPOSITORY_POLICY', 'Repository policy exceeds the supported size.');
      policy = policySchema.parse(JSON.parse(file.content.toString('utf8')));
      if (new Set(policy.collaborators.map(member => member.id)).size !== policy.collaborators.length) throw new Error('Duplicate collaborator IDs');
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        persisted = false;
        policy = { version: 1, description: summary.description, tags: summary.tags, defaultBranch: summary.defaultBranch, visibility: summary.visibility === 'public' ? 'public' : 'private', collaborators: [], updatedAt: '', updatedBy: 'bootstrap' };
      } else if (error instanceof ApiError) throw error;
      else throw new ApiError(502, 'INVALID_REPOSITORY_POLICY', 'The versioned repository policy is invalid. Access fails closed until the instance owner repairs it.');
    }
    if (!branches.some(branch => branch.name === policy.defaultBranch)) throw new ApiError(409, 'DEFAULT_BRANCH_MISSING', 'The configured default branch no longer exists. Restore the branch or repair the policy.');
    return { policy, configurationBranch, commitId: head.commitId, storagePath: REPOSITORY_POLICY_PATH, persisted };
  }
  async applyToSummary(summary: RepoSummary): Promise<RepoSummary> {
    const { policy } = await this.read({ namespace: summary.namespace, repo: summary.name });
    return { ...summary, displayName:policy.displayName??summary.name,description: policy.description, tags: policy.tags, defaultBranch: policy.defaultBranch, visibility: policy.visibility };
  }
  async update(key: RepoKey, patch: RepoPatch & { displayName?:string;expectedCommit?: string }, actor = owner): Promise<RepositorySettingsState> {
    const parsed = repositoryPatchSchema.parse(patch);
    return this.mutate(key, actor, state => ({ ...state.policy, ...parsed, tags: parsed.tags ? [...new Set(parsed.tags)] : state.policy.tags }), parsed.expectedCommit);
  }
  async mutate(key: RepoKey, actor: RequestIdentity, action: (state: RepositorySettingsState) => RepositoryPolicy, expectedCommit?: string): Promise<RepositorySettingsState> {
    return this.serialize(key, async () => {
      const state = await this.read(key);
      if (expectedCommit && state.commitId !== expectedCommit) throw new ApiError(409, 'SETTINGS_CONFLICT', 'Repository settings changed. Reload before saving.');
      const candidate = action(structuredClone(state));
      // expectedCommit is request concurrency metadata, never repository content.
      const { expectedCommit: _ignored, ...values } = candidate as RepositoryPolicy & { expectedCommit?: string };
      const policy = policySchema.parse({ ...values, version: 1, updatedAt: new Date().toISOString(), updatedBy: actor.id });
      const branches = await this.provider.branches(key);
      if (!branches.some(branch => branch.name === policy.defaultBranch)) throw new ApiError(400, 'DEFAULT_BRANCH_NOT_FOUND', 'Select an existing branch as the default.');
      const workspace = await this.provider.createWorkspace(key, `${SETTINGS_WORKSPACE_PREFIX}${randomUUID()}`, state.configurationBranch);
      let committed = false;
      try {
        if (workspace.baseCommitId && workspace.baseCommitId !== state.commitId) throw new ApiError(409, 'SETTINGS_CONFLICT', 'The configuration branch moved while creating the settings workspace. Reload and retry.');
        await this.provider.writeWorkspace(key, workspace.id, REPOSITORY_POLICY_PATH, Buffer.from(`${JSON.stringify(policy, null, 2)}\n`));
        await this.provider.commitWorkspace(key, workspace.id, `Update repository settings by ${actor.name}`, state.commitId);
        committed = true;
      } finally {
        // The temporary draft is private to this control operation; cleanup never rewrites branch state.
        await this.provider.deleteWorkspace(key, workspace.id).catch(() => {});
      }
      if (!committed) throw new ApiError(409, 'SETTINGS_CONFLICT', 'Repository settings could not be committed.');
      return this.read(key);
    });
  }
}
