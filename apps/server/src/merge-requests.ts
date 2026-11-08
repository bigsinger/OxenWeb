import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { MergeRequestActor, MergeRequestComparison, MergeRequestDetail, MergeRequestItem, RequestIdentity } from '../../../packages/shared/src/index.js';
import { requestIdentity } from './auth.js';
import { JobQueue } from './cli.js';
import { ApiError } from './errors.js';
import type { Provider, RepoKey } from './provider.js';
import type { RepositoryAccessService } from './repository-access.js';
import { repositoryPolicyPath } from './repository-settings.js';
import { safeRef, safeSegment } from './safety.js';

const branch = z.string().min(1).max(160).transform(safeRef);
const revision = z.number().int().positive();
const actorSchema = z.object({ id: z.string().min(1), name: z.string().min(1) });
const commentSchema = z.object({ id: z.string().uuid(), body: z.string().min(1).max(10000), author: actorSchema, createdAt: z.string() });
const storedSchema = z.object({
  id: z.string().uuid(), number: revision, namespace: z.string(), repo: z.string(), title: z.string().min(1).max(240), description: z.string().max(10000),
  source: branch, target: branch, sourceCommitId: branch, targetCommitId: branch, status: z.enum(['open', 'closed', 'merging', 'merged']), revision,
  author: actorSchema, createdAt: z.string(), updatedAt: z.string(), comments: z.array(commentSchema).max(1000), storage: z.literal('bff-local'),
  mergedCommitId: z.string().optional(), jobId: z.string().optional(), mergeError: z.string().optional(), interrupted: z.boolean().optional(), attemptId: z.string().uuid().optional(),
});
type Stored = z.infer<typeof storedSchema>;
const sameRepo = (item: Stored, key: RepoKey) => item.namespace === key.namespace && item.repo === key.repo;
const actor = (identity: RequestIdentity): MergeRequestActor => ({ id: identity.id, name: identity.name });
const detail = (item: Stored): MergeRequestDetail => { const { namespace: _namespace, repo: _repo, attemptId: _attempt, ...value } = item; return structuredClone(value); };
const summary = (item: Stored): MergeRequestItem => { const { comments: _comments, storage: _storage, ...value } = detail(item); return value; };

/** One instance owns this file. All read/modify/write transitions are serialized and atomically renamed. */
export class MergeRequestStore {
  private records: Stored[] = [];
  private chain: Promise<void> = Promise.resolve();
  constructor(private filename: string) {}
  async init() {
    try {
      const data = z.object({ version: z.literal(1), requests: z.array(storedSchema).max(10000) }).parse(JSON.parse(await readFile(this.filename, 'utf8')));
      this.records = data.requests;
      if (this.records.some(item => item.status === 'merging' && !item.interrupted)) await this.transaction(items => {
        for (const item of items) if (item.status === 'merging') {
          item.interrupted = true; item.mergeError = 'The BFF restarted during this merge. Inspect the target branch, then explicitly reopen and refresh the comparison before trying again.';
          item.revision++; item.updatedAt = new Date().toISOString();
        }
      });
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  private async transaction<T>(operation: (items: Stored[]) => T | Promise<T>): Promise<T> {
    const next = this.chain.then(async () => {
      const records = structuredClone(this.records), result = await operation(records);
      await mkdir(path.dirname(this.filename), { recursive: true });
      const temp = `${this.filename}.${randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify({ version: 1, requests: records }, null, 2), { mode: 0o600 });
      await rename(temp, this.filename); this.records = records;
      return structuredClone(result);
    });
    this.chain = next.then(() => {}, () => {}); return next;
  }
  list(key: RepoKey): MergeRequestItem[] { return this.records.filter(item => sameRepo(item, key)).sort((a, b) => b.number - a.number).map(summary); }
  get(key: RepoKey, id: string): Stored {
    const item = this.records.find(item => item.id === id && sameRepo(item, key));
    if (!item) throw new ApiError(404, 'MERGE_REQUEST_NOT_FOUND', 'Merge request not found.');
    return structuredClone(item);
  }
  create(key: RepoKey, input: { title: string; description: string; source: string; target: string; sourceCommitId: string; targetCommitId: string }, identity: RequestIdentity): Promise<Stored> {
    return this.transaction(items => {
      if (items.length >= 10000) throw new ApiError(413, 'MERGE_REQUEST_LIMIT', 'The instance merge-request storage limit has been reached.');
      const now = new Date().toISOString();
      const item: Stored = { ...key, ...input, id: randomUUID(), number: Math.max(0, ...items.filter(item => sameRepo(item, key)).map(item => item.number)) + 1, status: 'open', revision: 1, author: actor(identity), createdAt: now, updatedAt: now, comments: [], storage: 'bff-local' };
      items.push(item); return item;
    });
  }
  mutate(key: RepoKey, id: string, expected: number | undefined, change: (item: Stored) => void): Promise<Stored> {
    return this.transaction(items => {
      const item = items.find(item => item.id === id && sameRepo(item, key));
      if (!item) throw new ApiError(404, 'MERGE_REQUEST_NOT_FOUND', 'Merge request not found.');
      if (expected !== undefined && item.revision !== expected) throw new ApiError(409, 'MERGE_REQUEST_STALE', 'This merge request changed. Reload it before saving.', { revision: item.revision });
      change(item); item.revision++; item.updatedAt = new Date().toISOString(); return item;
    });
  }
}

async function allHistory(provider: Provider, key: RepoKey, head: string) {
  const graph = new Map<string, string[]>();
  for (let page = 1; page <= 21; page++) {
    const entries = await provider.commits(key, head, page, 500);
    for (const entry of entries) {
      if (!entry.id || !Array.isArray(entry.parentIds) || entry.parentIds.some(parent => typeof parent !== 'string' || !parent) || new Set(entry.parentIds).size !== entry.parentIds.length) throw new ApiError(409, 'MERGE_ANCESTRY_INVALID', 'Commit ancestry contains an invalid node; no partial comparison was used.');
      const parents = [...entry.parentIds].sort(), previous = graph.get(entry.id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(parents)) throw new ApiError(409, 'MERGE_ANCESTRY_INVALID', 'A commit returned conflicting parent links; comparison was stopped.');
      graph.set(entry.id, parents);
    }
    if (graph.size > 10000) throw new ApiError(413, 'MERGE_COMPARISON_LIMIT', 'This comparison exceeds 10000 commits; no partial ancestry result was used.');
    if (entries.length < 500) {
      const reachable = new Set<string>(), pending = [head];
      while (pending.length) {
        const id = pending.pop()!; if (reachable.has(id)) continue;
        const parents = graph.get(id);
        if (!parents) throw new ApiError(409, 'MERGE_ANCESTRY_INCOMPLETE', 'Pinned commit ancestry is missing a commit or parent; no partial comparison was used.', { commitId: id });
        reachable.add(id); pending.push(...parents);
      }
      if (reachable.size !== graph.size) throw new ApiError(409, 'MERGE_ANCESTRY_INVALID', 'The history includes commits outside the pinned head ancestry; comparison was stopped.');
      // Iterative topological validation also rejects cycles without recursion or a stack-depth limit.
      const children = new Map([...graph.keys()].map(id => [id, 0]));
      for (const parents of graph.values()) for (const parent of parents) children.set(parent, children.get(parent)! + 1);
      const ready = [...children].filter(([, count]) => count === 0).map(([id]) => id); let visited = 0;
      for (let index = 0; index < ready.length; index++) { visited++; for (const parent of graph.get(ready[index]!)!) { const remaining = children.get(parent)! - 1; children.set(parent, remaining); if (!remaining) ready.push(parent); } }
      if (visited !== graph.size) throw new ApiError(409, 'MERGE_ANCESTRY_INVALID', 'Commit parent links contain a cycle; comparison was stopped.');
      return graph;
    }
  }
  throw new ApiError(413, 'MERGE_COMPARISON_LIMIT', 'The complete commit ancestry could not be collected within the comparison limit.');
}
function uniqueMergeBase(source: Map<string, string[]>, target: Map<string, string[]>) {
  const common = new Set([...source.keys()].filter(id => target.has(id))), older = new Set<string>();
  for (const id of common) {
    const parents = source.get(id)!;
    if (JSON.stringify(parents) !== JSON.stringify(target.get(id))) throw new ApiError(409, 'MERGE_ANCESTRY_INVALID', 'The pinned histories disagree about shared commit parents.');
    // Common ancestry is closed under parent links. Every older common ancestor therefore has a common child.
    for (const parent of parents) older.add(parent);
  }
  const bases = [...common].filter(id => !older.has(id));
  if (!bases.length) throw new ApiError(409, 'MERGE_BASE_NOT_FOUND', 'The pinned branches have no common merge base; comparison was stopped.');
  if (bases.length !== 1) throw new ApiError(409, 'MERGE_BASE_AMBIGUOUS', 'The pinned branches have multiple valid merge bases; an automatic comparison would be ambiguous.', { baseCommitIds: bases });
  return bases[0]!;
}
async function branchHeads(provider: Provider, key: RepoKey, source: string, target: string) {
  const branches = await provider.branches(key), from = branches.find(item => item.name === source), to = branches.find(item => item.name === target);
  if (!from || !to) throw new ApiError(404, 'BRANCH_NOT_FOUND', 'Source and target branches must both exist.');
  return { sourceCommitId: from.commitId, targetCommitId: to.commitId };
}
export async function compareMergeRequestHeads(provider: Provider, key: RepoKey, source: string, target: string, heads: { sourceCommitId: string; targetCommitId: string }): Promise<MergeRequestComparison> {
  const pinned = { sourceCommitId: heads.sourceCommitId, targetCommitId: heads.targetCommitId };
  if (source === target) return { source, target, ...pinned, baseCommitId: heads.sourceCommitId, ahead: 0, behind: 0, files: [], canCreate: false, reason: 'Source and target must be different branches.' };
  const [sourceHistory, targetHistory] = await Promise.all([allHistory(provider, key, heads.sourceCommitId), allHistory(provider, key, heads.targetCommitId)]);
  const baseCommitId = uniqueMergeBase(sourceHistory, targetHistory), files = await provider.diff(key, baseCommitId, heads.sourceCommitId);
  const ahead = [...sourceHistory.keys()].filter(id => !targetHistory.has(id)).length, behind = [...targetHistory.keys()].filter(id => !sourceHistory.has(id)).length;
  return { source, target, ...pinned, baseCommitId, ahead, behind, files, canCreate: ahead > 0, ...(ahead ? {} : { reason: 'The source branch has no commits ahead of the target branch.' }) };
}
function requireOpen(item: Stored) { if (item.status !== 'open') throw new ApiError(409, 'MERGE_REQUEST_STATE', 'Only an open merge request can perform this operation.'); }
function requireHeads(actual: { sourceCommitId: string; targetCommitId: string }, expected: { sourceCommitId: string; targetCommitId: string }) {
  if (actual.sourceCommitId !== expected.sourceCommitId || actual.targetCommitId !== expected.targetCommitId) throw new ApiError(409, 'MERGE_REQUEST_BRANCHES_CHANGED', 'A branch changed. Refresh the comparison and review the pinned changes before merging.', actual);
}

export interface MergeRequestOptions {
  provider: Provider; access: RepositoryAccessService; jobs: JobQueue; filename: string;
  onJob?: (jobId: string, key: RepoKey) => void;
  beforeMerge?: (key: RepoKey, identity: RequestIdentity, source: string, target: string) => Promise<void>;
  afterMerge?: (key: RepoKey, identity: RequestIdentity, source: string, target: string) => Promise<void>;
}
/** Independent local collaboration routes. No private SaaS endpoints are used. */
export async function registerMergeRequests(app: FastifyInstance, options: MergeRequestOptions) {
  const { provider, access, jobs } = options, store = new MergeRequestStore(options.filename); await store.init();
  const base = '/api/repos/:namespace/:repo/merge-requests';
  const key = (request: FastifyRequest): RepoKey => { const value = request.params as RepoKey; return { namespace: safeSegment(value.namespace), repo: safeSegment(value.repo) }; };
  const id = (request: FastifyRequest) => z.string().uuid().parse((request.params as { id: string }).id);
  const expected = (request: FastifyRequest) => z.object({ expectedRevision: revision }).strict().parse(request.body).expectedRevision;
  const writable = async (request: FastifyRequest) => { const identity = requestIdentity(request); await access.require(key(request), identity, 'write'); return identity; };
  app.get(base, async request => store.list(key(request)));
  app.get(`${base}/compare`, async request => {
    const input = z.object({ source: branch, target: branch }).parse(request.query), repo = key(request);
    return compareMergeRequestHeads(provider, repo, input.source, input.target, await branchHeads(provider, repo, input.source, input.target));
  });
  app.post(base, async (request, reply) => {
    const identity = await writable(request), repo = key(request);
    const input = z.object({ title: z.string().trim().min(1).max(240), description: z.string().max(10000).default(''), source: branch, target: branch, expectedSourceCommitId: branch.optional(), expectedTargetCommitId: branch.optional() }).strict().parse(request.body);
    const heads = await branchHeads(provider, repo, input.source, input.target);
    if (input.expectedSourceCommitId && input.expectedSourceCommitId !== heads.sourceCommitId || input.expectedTargetCommitId && input.expectedTargetCommitId !== heads.targetCommitId) throw new ApiError(409, 'MERGE_REQUEST_BRANCHES_CHANGED', 'The compared branches changed. Compare them again before creating the request.');
    const compared = await compareMergeRequestHeads(provider, repo, input.source, input.target, heads);
    if (!compared.canCreate) throw new ApiError(409, 'MERGE_REQUEST_NO_CHANGES', compared.reason!);
    const result = await store.create(repo, { title: input.title, description: input.description, source: input.source, target: input.target, ...heads }, identity); reply.code(201); return detail(result);
  });
  app.get(`${base}/:id`, async request => detail(store.get(key(request), id(request))));
  app.get(`${base}/:id/compare`, async request => {
    const repo = key(request), item = store.get(repo, id(request)), branches = await provider.branches(repo);
    const currentSourceCommitId = branches.find(branch => branch.name === item.source)?.commitId, currentTargetCommitId = branches.find(branch => branch.name === item.target)?.commitId;
    return { ...await compareMergeRequestHeads(provider, repo, item.source, item.target, item), currentSourceCommitId, currentTargetCommitId, stale: currentSourceCommitId !== item.sourceCommitId || currentTargetCommitId !== item.targetCommitId };
  });
  app.post(`${base}/:id/comments`, async request => {
    const identity = await writable(request), input = z.object({ body: z.string().trim().min(1).max(10000), expectedRevision: revision }).strict().parse(request.body);
    return detail(await store.mutate(key(request), id(request), input.expectedRevision, item => {
      if (item.status === 'merging') throw new ApiError(409, 'MERGE_REQUEST_STATE', 'Wait for the merge to finish before commenting.');
      if (item.comments.length >= 1000) throw new ApiError(413, 'MERGE_REQUEST_COMMENT_LIMIT', 'This request has reached the 1000-comment limit.');
      item.comments.push({ id: randomUUID(), body: input.body, author: actor(identity), createdAt: new Date().toISOString() });
    }));
  });
  for (const operation of ['close', 'reopen', 'refresh'] as const) app.post(`${base}/:id/${operation}`, async request => {
    await writable(request); const repo = key(request), requestId = id(request), wanted = expected(request), current = store.get(repo, requestId);
    const refreshed = operation === 'refresh' ? await branchHeads(provider, repo, current.source, current.target) : undefined;
    return detail(await store.mutate(repo, requestId, wanted, item => {
      if (operation === 'close') { requireOpen(item); item.status = 'closed'; }
      if (operation === 'reopen') {
        if (item.status !== 'closed' && !(item.status === 'merging' && item.interrupted)) throw new ApiError(409, 'MERGE_REQUEST_STATE', 'Only a closed or interrupted request can be reopened.');
        item.status = 'open'; delete item.interrupted; delete item.attemptId; delete item.jobId;
      }
      if (operation === 'refresh') { requireOpen(item); Object.assign(item, refreshed); delete item.mergeError; }
    }));
  });
  app.post(`${base}/:id/merge`, async request => {
    const identity = await writable(request), repo = key(request), requestId = id(request);
    const input = z.object({ expectedRevision: revision, expectedSourceCommitId: branch, expectedTargetCommitId: branch }).strict().parse(request.body);
    const current = store.get(repo, requestId); requireOpen(current);
    if (current.mergeError) throw new ApiError(409, 'MERGE_REQUEST_REVIEW_REQUIRED', 'Review the previous merge failure and explicitly refresh the comparison before retrying.');
    requireHeads(current, { sourceCommitId: input.expectedSourceCommitId, targetCommitId: input.expectedTargetCommitId });
    requireHeads(await branchHeads(provider, repo, current.source, current.target), current);
    const compared = await compareMergeRequestHeads(provider, repo, current.source, current.target, current);
    if (!compared.canCreate) throw new ApiError(409, 'MERGE_REQUEST_NO_CHANGES', compared.reason!);
    const changesPolicy = compared.files.some(file => repositoryPolicyPath(file.path));
    if (changesPolicy) await access.require(repo, identity, 'admin');
    await options.beforeMerge?.(repo, identity, current.source, current.target);
    const attemptId = randomUUID();
    await store.mutate(repo, requestId, input.expectedRevision, item => { requireOpen(item); item.status = 'merging'; item.attemptId = attemptId; delete item.mergeError; delete item.interrupted; });
    let jobCreated = false;
    try {
      const job = jobs.add(`${repo.namespace}/${repo.repo}`, 'merge request', async () => {
        const guard = async () => {
          await access.require(repo, identity, changesPolicy ? 'admin' : 'write');
          await options.beforeMerge?.(repo, identity, current.source, current.target);
          const item = store.get(repo, requestId);
          if (item.status !== 'merging' || item.attemptId !== attemptId || item.interrupted) throw new ApiError(409, 'MERGE_REQUEST_STATE', 'The merge attempt is no longer active.');
        };
        let invoked = false, executed = false;
        try {
          await guard(); requireHeads(await branchHeads(provider, repo, current.source, current.target), current);
          invoked = true;
          const output = await provider.merge(repo, current.source, current.target, { expectedSourceCommitId: current.sourceCommitId, expectedTargetCommitId: current.targetCommitId, beforeWrite: guard }); executed = true;
          const heads = await branchHeads(provider, repo, current.source, current.target);
          if (heads.targetCommitId === current.targetCommitId) throw new ApiError(502, 'MERGE_RESULT_UNCONFIRMED', 'The merge returned without a changed target commit. Inspect the target before retrying.');
          if (!(await allHistory(provider, repo, heads.targetCommitId)).has(current.sourceCommitId)) throw new ApiError(502, 'MERGE_RESULT_UNCONFIRMED', 'The updated target does not include the reviewed source commit. Inspect the target before retrying.');
          await store.mutate(repo, requestId, undefined, item => { if (item.attemptId !== attemptId) throw new ApiError(409, 'MERGE_REQUEST_STATE', 'The merge attempt changed.'); item.status = 'merged'; item.mergedCommitId = heads.targetCommitId; delete item.attemptId; delete item.interrupted; });
          await options.afterMerge?.(repo, identity, current.source, current.target);
          return typeof output === 'string' ? output : JSON.stringify(output) ?? 'Merged';
        } catch (error) {
          // A timeout may be thrown after the remote write. Only source-verified
          // preflight rejections can safely return to an ordinary open state.
          const prewriteRejection = error instanceof ApiError && ['MERGE_CONFLICT', 'MERGE_VERSION_CONFLICT', 'CLONE_SOURCE_DIVERGED', 'CLONE_TARGET_DIVERGED'].includes(error.code);
          const uncertain = executed || invoked && !prewriteRejection;
          await store.mutate(repo, requestId, undefined, item => { if (item.attemptId !== attemptId) return; item.status = uncertain ? 'merging' : 'open'; item.interrupted = uncertain; item.mergeError = `${uncertain ? 'Merge outcome requires inspection before retrying. ' : ''}${error instanceof Error ? error.message : 'Merge failed.'}`; if (!uncertain) delete item.attemptId; });
          throw error;
        }
      });
      jobCreated = true;
      options.onJob?.(job.id, repo);
      const item = await store.mutate(repo, requestId, undefined, item => { item.jobId = job.id; });
      return { request: detail(item), job };
    } catch (error) {
      await store.mutate(repo, requestId, undefined, item => { if (item.status === 'merging' && item.attemptId === attemptId) { item.status = jobCreated ? 'merging' : 'open'; item.interrupted = jobCreated; if (!jobCreated) delete item.attemptId; item.mergeError = error instanceof Error ? error.message : 'Could not queue merge.'; } });
      throw error;
    }
  });
  return store;
}
