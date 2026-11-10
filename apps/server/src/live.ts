import {durableWriteJson} from './durable-store.js';
import createClient from 'openapi-fetch';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { components, paths } from '../../../packages/contracts/src/oxen.js';
import type { Annotation, CommitDetail, CommitItem, DiffFile, FilePreview, RepoSummary, WorkspaceItem } from '../../../packages/shared/src/index.js';
import type { Config } from './config.js';
import { ApiError, unavailable } from './errors.js';
import type { CreateRepo, MergeOptions, NativeMergeResolutionInput, Provider, PushOptions, RepoKey, RepoPatch } from './provider.js';
import { makePreview, mimeFor } from './preview.js';
import { safeFilePath, safeRef } from './safety.js';
import { runCli } from './cli.js';
import { ExtensionStore } from './extensions.js';
import { naturalQuery } from './natural-query.js';
import { assertClean, cliOptions, localBranchHead, provisionClone } from './managed-cli.js';
import { pagedRowIds, validateDataFile } from './jsonl.js';
import { buildTabularDiff } from './tabular-diff.js';
import { executeNativeMergeResolution } from './merge-resolution-native.js';
import { rewriteOxenWildcardRequest } from './oxen-wildcard-paths.js';

type Commit = components['schemas']['Commit'];
type MetadataEntry = components['schemas']['EMetadataEntry'];
const repoParams = (key: RepoKey) => ({ namespace: key.namespace, repo_name: key.repo });
const adaptCommit = (commit: Commit): CommitItem => ({ id: commit.id, message: commit.message, author: commit.author, email: commit.email, timestamp: commit.timestamp, parentIds: commit.parent_ids });

export class LiveProvider implements Provider {
  ready: boolean;
  capabilities;
  private api;
  private workspaceBranches = new Map<string, string>();
  private mappingsFile: string;
  private mapChain = Promise.resolve();
  private extensions: ExtensionStore;
  private cliChains = new Map<string, Promise<void>>();
  private health = { checkedAt: 0, ready: false };
  constructor(private config: Config) {
    this.ready = !!config.upstream && config.namespaces.length > 0;
    this.capabilities = { read: !!config.upstream, write: !!config.upstream, cli: !!config.upstream, workspaces: !!config.upstream, annotations: !!config.upstream, naturalLanguageQuery: !!config.upstream, metadata: !!config.upstream, reasons: { ...(!this.ready ? { setup: 'Configure OXEN_SERVER_URL and OXEN_NAMESPACES before using a live server.' } : {}), annotations: 'Oxen Web labels are committed as .oxenweb/labels.json in the repository. Dataset, file and row assignments inherit through ordinary commits and isolate by branch. Legacy sidecar annotations are read-only migration sources.', naturalLanguageQuery: 'Oxen Web extension: explainable local Chinese/English query rules over the selected table. This is not the SaaS AI engine; supported syntax is shown in results.', metadata: 'Oxen Web extension: description and tags persist in the BFF sidecar. Visibility and default-branch changes are unavailable because the public contract has no corresponding update API.', cli: 'Push and branch merge require Oxen CLI and a provisioned clone under OXEN_CLI_ROOT; commands fail explicitly when unavailable.' } };
    this.api = createClient<paths>({ baseUrl: config.upstream ?? 'http://127.0.0.1:3002', headers: config.upstreamToken ? { Authorization: `Bearer ${config.upstreamToken}` } : {}, fetch: async (request) => {
      try { return await fetch(request, { signal: AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]), redirect: 'error' }); }
      catch { throw new ApiError(502, 'UPSTREAM_UNAVAILABLE', 'The configured Oxen server did not respond. Check its URL and availability.'); }
    } });
    this.api.use({onRequest:({request,schemaPath,params,options})=>rewriteOxenWildcardRequest(request,schemaPath,params.path??{},options.baseUrl)});
    this.mappingsFile = path.join(path.dirname(config.demoFile), 'live-workspace-branches.json');
    this.extensions = new ExtensionStore(path.join(path.dirname(config.demoFile), 'live-extensions.json'));
  }
  async init() {
    await this.extensions.init();
    try { const data = JSON.parse(await readFile(this.mappingsFile, 'utf8')) as Record<string, string>; this.workspaceBranches = new Map(Object.entries(data)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  async checkReady(): Promise<boolean> {
    if (!this.config.upstream || !this.config.namespaces.length) return false;
    if (Date.now() - this.health.checkedAt < 5000) return this.health.ready;
    let ready = false;
    try {
      const result = await this.api.GET('/api/version', { signal: AbortSignal.timeout(3000) });
      ready = result.response.ok&&(result.data as {oxen_version?:unknown}|undefined)?.oxen_version==='0.67.0';
    } catch { /* report unavailable without hiding the configured live mode */ }
    this.health = { checkedAt: Date.now(), ready };
    this.ready = ready;
    return ready;
  }
  private serializeCli<T>(key: RepoKey, operation: () => Promise<T>): Promise<T> {
    const name = `${key.namespace}/${key.repo}`;
    const previous = this.cliChains.get(name) ?? Promise.resolve();
    const current = previous.then(operation);
    const settled = current.then(() => {}, () => {});
    this.cliChains.set(name, settled);
    void settled.then(() => { if (this.cliChains.get(name) === settled) this.cliChains.delete(name); });
    return current;
  }
  private ensure() { if (!this.config.upstream) throw new ApiError(503, 'NOT_CONFIGURED', 'Set OXEN_SERVER_URL to connect a real Oxen server, or explicitly enable DEMO_MODE=true.'); }
  private async pinReference(key: RepoKey, reference: string): Promise<string> {
    return (await this.branches(key)).find(branch => branch.name === reference)?.commitId ?? reference;
  }
  private unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
    if (!result.response.ok || result.error !== undefined || result.data === undefined) {
      const body = result.error as { status_message?: string; message?: string } | undefined;
      throw new ApiError(result.response.status >= 500 ? 502 : result.response.status, 'OXEN_REQUEST_FAILED', body?.status_message || body?.message || `Oxen responded with ${result.response.status}.`, { upstreamPath: result.response.url ? new URL(result.response.url).pathname : undefined });
    }
    const data = result.data as T & { status?: string; status_message?: string };
    if (data.status && !['success', 'warning'].includes(data.status)) throw new ApiError(409, 'OXEN_OPERATION_FAILED', data.status_message ?? 'Oxen operation failed.');
    return result.data;
  }
  private mappingKey(key: RepoKey, id: string) { return `${key.namespace}/${key.repo}/${id}`; }
  private async persistMapping(key: RepoKey, id: string, branch: string) {
    this.workspaceBranches.set(this.mappingKey(key, id), branch);
    const next = this.mapChain.then(async () => { await mkdir(path.dirname(this.mappingsFile), { recursive: true }); await durableWriteJson(this.mappingsFile,Object.fromEntries(this.workspaceBranches)); });
    this.mapChain = next.catch(() => {}); await next;
  }
  private summary(namespace: string, name: string): RepoSummary { return { namespace, name, ...this.extensions.metadata({ namespace, repo: name }), defaultBranch: 'main', updatedAt: '', size: 0, fileCount: 0, visibility: 'unknown' }; }
  async repos(namespace?: string) {
    this.ensure();
    const namespaces = namespace ? [namespace] : this.config.namespaces;
    if (!namespaces.length) throw new ApiError(503, 'NAMESPACE_REQUIRED', 'Configure OXEN_NAMESPACES; the public Oxen API lists repositories per namespace.');
    const groups = await Promise.all(namespaces.map(async namespace => {
      const data = this.unwrap(await this.api.GET('/api/repos/{namespace}', { params: { path: { namespace } } }));
      return data.repositories.map(repo => this.summary(repo.namespace, repo.name));
    }));
    const repositories = groups.flat();
    const enriched = new Array<RepoSummary>(repositories.length);
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(4, repositories.length) }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= repositories.length) return;
        const repo = repositories[index]!;
        enriched[index] = await this.repo({ namespace: repo.namespace, repo: repo.name });
      }
    }));
    return enriched;
  }
  async createRepo(input: CreateRepo) {
    this.ensure();
    this.unwrap(await this.api.POST('/api/repos', { body: { namespace: input.namespace, name: input.name, description: input.description, is_public: input.visibility === 'public', files: [{ path: 'README.md', contents: `# ${input.name}\n\n${input.description}\n`, user: { name: 'Oxen Web', email: 'oxen-web@localhost' } }] } }));
    await this.extensions.updateMetadata({ namespace: input.namespace, repo: input.name }, { description: input.description });
    return this.repo({ namespace: input.namespace, repo: input.name });
  }
  async repo(key: RepoKey) {
    this.ensure();
    const data = this.unwrap(await this.api.GET('/api/repos/{namespace}/{repo_name}', { params: { path: repoParams(key) } }));
    const summary = this.summary(data.repository.namespace, data.repository.name);
    summary.size = data.repository.size;
    summary.fileCount = data.repository.data_types.reduce((sum, item) => sum + item.count, 0);
    const branches = await this.branches(key);
    const defaultBranch = data.repository.default_resource?.branch?.name;
    if (defaultBranch) summary.defaultBranch = defaultBranch;
    if (!branches.some(branch => branch.name === 'main') && branches[0]) summary.defaultBranch = branches[0].name;
    if (branches.length) {
      try { const commits = await this.commits(key, summary.defaultBranch); summary.updatedAt = commits[0]?.timestamp ?? ''; }
      catch (error) { if (!(error instanceof ApiError) || error.status !== 404) throw error; }
    }
    return summary;
  }
  async updateRepo(key: RepoKey, patch: RepoPatch): Promise<RepoSummary> {
    await this.repo(key);
    if (patch.visibility !== undefined || patch.defaultBranch !== undefined) unavailable('Visibility and default-branch updates');
    await this.extensions.updateMetadata(key, { ...(patch.description !== undefined ? { description: patch.description } : {}), ...(patch.tags !== undefined ? { tags: patch.tags } : {}) });
    return this.repo(key);
  }
  private adaptEntry(entry: MetadataEntry, directory: string) {
    const filename = entry.filename;
    const filenameHasPath = filename.includes('/');
    return { name: path.posix.basename(filename), path: filenameHasPath ? filename : directory ? `${directory}/${filename}` : filename, kind: entry.is_dir ? 'directory' as const : 'file' as const, size: entry.size, extension: entry.extension, updatedAt: entry.latest_commit?.timestamp, lastCommit: entry.latest_commit?.message };
  }
  async tree(key: RepoKey, ref: string, directory: string) {
    this.ensure();
    ref = await this.pinReference(key, ref);
    const resource = directory ? `${ref}/${directory}` : ref;
    const entries: ReturnType<LiveProvider['adaptEntry']>[] = [];
    let page = 1, totalPages = 1;
    do {
      const data = this.unwrap(await this.api.GET('/api/repos/{namespace}/{repo_name}/dir/{resource}', { params: { path: { ...repoParams(key), resource }, query: { page, page_size: 250 } } }));
      entries.push(...data.entries.map(entry => this.adaptEntry(entry, directory)));
      if (entries.length > 100_000) throw new ApiError(413, 'DIRECTORY_LIMIT', 'Directory contains more than 100000 entries; narrow the directory instead of displaying a truncated listing.');
      if (!data.entries.length && page < data.total_pages) throw new ApiError(502, 'DIRECTORY_INCOMPLETE', 'Oxen directory pagination ended before all entries were received.');
      totalPages = data.total_pages;
      page++;
    } while (page <= totalPages);
    return entries.sort((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name));
  }
  async raw(key: RepoKey, ref: string, filename: string) {
    this.ensure(); safeFilePath(filename);
    const url = `${this.config.upstream}/api/repos/${encodeURIComponent(key.namespace)}/${encodeURIComponent(key.repo)}/file/${ref.split('/').map(encodeURIComponent).join('/')}/${filename.split('/').map(encodeURIComponent).join('/')}`;
    return this.rawResource(url,filename);
  }
  async rawWorkspaceFile(key:RepoKey,id:string,filename:string){
    this.ensure();safeFilePath(filename);const url=`${this.config.upstream}/api/repos/${encodeURIComponent(key.namespace)}/${encodeURIComponent(key.repo)}/workspaces/${encodeURIComponent(id)}/files/${filename.split('/').map(encodeURIComponent).join('/')}`;
    return this.rawResource(url,filename);
  }
  private async rawResource(url:string,filename:string){
    let response: Response;
    try { response = await fetch(url, { headers: this.config.upstreamToken ? { Authorization: `Bearer ${this.config.upstreamToken}` } : {}, signal: AbortSignal.timeout(60_000), redirect: 'error' }); }
    catch { throw new ApiError(502, 'UPSTREAM_UNAVAILABLE', 'The configured Oxen server did not respond.'); }
    if (!response.ok) throw new ApiError(response.status >= 500 ? 502 : response.status, 'FILE_FETCH_FAILED', `Oxen could not serve this file (${response.status}).`);
    const limit = (/\.(jsonl|ndjson)$/i.test(filename) ? 64 : 25) * 1024 * 1024;
    const limitMessage=`This file exceeds the ${limit / 1024 / 1024} MiB proxy limit. Use Oxen CLI to download it.`;
    if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new ApiError(413, 'PREVIEW_LIMIT', limitMessage); }
    const reader = response.body?.getReader(), chunks: Buffer[] = []; let size = 0;
    if (reader) {
      for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) { await reader.cancel(); throw new ApiError(413, 'PREVIEW_LIMIT', limitMessage); } chunks.push(Buffer.from(value)); }
    }
    return { content: Buffer.concat(chunks), mime: mimeFor(filename), filename: path.basename(filename) };
  }
  async file(key: RepoKey, ref: string, filename: string, page: number, pageSize: number): Promise<FilePreview> {
    this.ensure(); safeFilePath(filename);
    ref = await this.pinReference(key, ref);
    const url = `/api/repos/${encodeURIComponent(key.namespace)}/${encodeURIComponent(key.repo)}/raw?ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(filename)}`;
    if (/\.(csv|tsv|parquet|arrow)$/i.test(filename)) {
      const data = this.unwrap(await this.api.GET('/api/repos/{namespace}/{repo_name}/data_frames/{resource}', { params: { path: { ...repoParams(key), resource: `${ref}/${filename}` }, query: { page, page_size: pageSize } } }));
      const view = data.data_frame.view;
      const rows = Array.isArray(view.data) ? view.data as Record<string, unknown>[] : [];
      return { path: filename, kind: 'table', mime: mimeFor(filename), size: 0, url, columns: view.schema.fields.map(field => ({ name: field.name, dtype: field.dtype })), rows, rowIds: pagedRowIds(rows, (page - 1) * pageSize), totalRows: view.pagination.total_entries, page, pageSize };
    }
    const raw = await this.raw(key, ref, filename);
    return makePreview(filename, raw.content, url, page, pageSize);
  }
  async commits(key: RepoKey, ref: string, page = 1, pageSize = 100) {
    this.ensure();
    const data = this.unwrap(await this.api.GET('/api/repos/{namespace}/{repo_name}/commits/history/{resource}', { params: { path: { ...repoParams(key), resource: ref }, query: { page, page_size: pageSize } } }));
    return data.commits.map(adaptCommit);
  }
  async commit(key: RepoKey, id: string): Promise<CommitDetail> {
    this.ensure();
    const data = this.unwrap(await this.api.GET('/api/repos/{namespace}/{repo_name}/commits/{commit_id}', { params: { path: { ...repoParams(key), commit_id: id } } }));
    const item = adaptCommit(data.commit);
    const files = item.parentIds[0] ? await this.diff(key, item.parentIds[0], id) : (await this.allFiles(key, id, '')).map(file => ({ path: file.path, status: 'added' as const }));
    return { ...item, files };
  }
  private async allFiles(key: RepoKey, ref: string, directory: string): Promise<{ path: string }[]> {
    const pending = [directory], visited = new Set<string>(), result: { path: string }[] = [];
    while (pending.length) {
      const current = pending.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const entry of await this.tree(key, ref, current)) {
        if (entry.kind === 'directory') pending.push(entry.path); else result.push({ path: entry.path });
        if (result.length + visited.size + pending.length > 100_000) throw new ApiError(413, 'COMMIT_TREE_LIMIT', 'Commit tree exceeds 100000 entries; a partial file list was not returned.');
      }
    }
    return result;
  }
  async diff(key: RepoKey, base: string, head: string): Promise<DiffFile[]> {
    this.ensure();
    const branches = await this.branches(key);
    base = branches.find(branch => branch.name === base)?.commitId ?? base;
    head = branches.find(branch => branch.name === head)?.commitId ?? head;
    const files: DiffFile[] = [];
    let page = 1, totalPages = 1, scanned = 0;
    do {
      const data = this.unwrap(await this.api.GET('/api/repos/{namespace}/{repo_name}/compare/entries/{base_head}', { params: { path: { ...repoParams(key), base_head: `${base}..${head}` }, query: { page, page_size: 100 } } }));
      totalPages = data.total_pages;
      scanned += data.compare.entries.length;
      if (scanned > 100_000) throw new ApiError(413, 'DIFF_LIMIT', 'Diff exceeds 100000 entries; a partial change list was not returned.');
      if (!data.compare.entries.length && page < totalPages) throw new ApiError(502, 'DIFF_INCOMPLETE', 'Oxen diff pagination ended before all entries were received.');
      for (const entry of data.compare.entries) {
        if (entry.is_dir) continue;
        const status: DiffFile['status'] = /add/i.test(entry.status) ? 'added' : /remove|delete/i.test(entry.status) ? 'removed' : 'modified';
        const file: DiffFile = { path: entry.filename, status };
        if (entry.data_type === 'tabular' || /\.(csv|tsv|jsonl|ndjson|parquet|arrow)$/i.test(entry.filename)) {
          file.tabular = await buildTabularDiff({ namespace: key.namespace, repo: key.repo, path: entry.filename, base, head, status, upstream: this.config.upstream, upstreamToken: this.config.upstreamToken, readRaw: async (revision, filename) => (await this.raw(key, revision, filename)).content });
        }
        if (files.length < 20 && /^(text|tabular)$/.test(entry.data_type) && entry.size < 256 * 1024) {
          const [before, after] = await Promise.all([status === 'added' ? '' : this.raw(key, base, entry.filename).then(raw => raw.content.toString('utf8')), status === 'removed' ? '' : this.raw(key, head, entry.filename).then(raw => raw.content.toString('utf8'))]);
          file.before = before; file.after = after;
        }
        files.push(file);
      }
      page++;
    } while (page <= totalPages);
    return files;
  }
  async branches(key: RepoKey) {
    this.ensure();
    const data = this.unwrap(await this.api.GET('/api/repos/{namespace}/{repo_name}/branches', { params: { path: repoParams(key) } }));
    return data.branches.map(branch => ({ name: branch.name, commitId: branch.commit_id, isDefault: branch.name === 'main' }));
  }
  async createBranch(key: RepoKey, name: string, from: string) {
    this.ensure(); safeRef(name); safeRef(from);
    const data = this.unwrap(await this.api.POST('/api/repos/{namespace}/{repo_name}/branches', { params: { path: repoParams(key) }, body: { from_name: from, new_name: name } }));
    return { name: data.branch.name, commitId: data.branch.commit_id, isDefault: data.branch.name === 'main' };
  }
  async merge(key: RepoKey, source: string, target: string, expected: MergeOptions = {}) {
    return this.serializeCli(key, async () => {
      const branches = await this.branches(key);
      if (!branches.some(branch => branch.name === source) || !branches.some(branch => branch.name === target)) throw new ApiError(404, 'BRANCH_NOT_FOUND', 'Source and target must both be existing branches.');
      const sourceId = branches.find(branch => branch.name === source)!.commitId, targetId = branches.find(branch => branch.name === target)!.commitId;
      if ((expected.expectedSourceCommitId && expected.expectedSourceCommitId !== sourceId) || (expected.expectedTargetCommitId && expected.expectedTargetCommitId !== targetId)) throw new ApiError(409, 'MERGE_VERSION_CONFLICT', 'Source or target branch moved after the merge request. Reload and review the new revisions.');
      // This native endpoint accepts branch names in 0.67 even though the published description says revisions.
      const check = this.unwrap(await this.api.GET('/api/repos/{namespace}/{repo_name}/merge/{base_head}', { params: { path: { ...repoParams(key), base_head: `${target}..${source}` } } }));
      const checkedBranches = await this.branches(key);
      if (checkedBranches.find(branch => branch.name === source)?.commitId !== sourceId || checkedBranches.find(branch => branch.name === target)?.commitId !== targetId) throw new ApiError(409, 'MERGE_VERSION_CONFLICT', 'Source or target branch moved during merge preflight. No CLI or push was executed.');
      if (!check.is_mergeable || check.conflicts.length) throw new ApiError(409, 'MERGE_CONFLICT', `Resolve conflicting files before merging: ${check.conflicts.map(conflict => conflict.path).join(', ') || 'merge is not possible'}`, { paths: check.conflicts.map(conflict => conflict.path) });
      await expected.beforeWrite?.();
      let cwd: string;
      try { cwd = await provisionClone(this.config, key, target); }
      catch (error) { if (error instanceof ApiError && (error.code === 'CLI_UNAVAILABLE' || /Unsupported archive entry type/.test(error.message))) return this.mergeHttp(key, source, target, 'CLI clone provisioning is unavailable.', { ...expected, expectedSourceCommitId: sourceId, expectedTargetCommitId: targetId }); throw error; }
      await assertClean(this.config, cwd);
      const options = cliOptions(this.config);
      const outputs = [];
      // Fetch has no remote writes. A known 0.67 archive incompatibility is safe to route through the documented HTTP merge endpoint.
      try {
        // Plain fetch preserves existing local branch heads. --branch overwrites them in Oxen 0.67 and must not be used here.
        outputs.push(await runCli(['fetch'], cwd, options));
      } catch (error) {
        if (error instanceof ApiError && (error.code === 'CLI_UNAVAILABLE' || /Unsupported archive entry type/.test(error.message))) return this.mergeHttp(key, source, target, 'Oxen CLI fetch is unavailable or hit the upstream archive compatibility issue.', { ...expected, expectedSourceCommitId: sourceId, expectedTargetCommitId: targetId });
        throw error;
      }
      outputs.push(await runCli(['checkout', safeRef(source)], cwd, options));
      outputs.push(await runCli(['pull', 'origin', safeRef(source)], cwd, options));
      if (await localBranchHead(this.config, cwd, source) !== sourceId) throw new ApiError(409, 'CLONE_SOURCE_DIVERGED', 'Managed source branch contains unpublished local commits. Publish or resolve them explicitly before merging the remote branch.');
      outputs.push(await runCli(['checkout', safeRef(target)], cwd, options));
      outputs.push(await runCli(['pull', 'origin', safeRef(target)], cwd, options));
      if (await localBranchHead(this.config, cwd, target) !== targetId) throw new ApiError(409, 'CLONE_TARGET_DIVERGED', 'Managed target branch contains unpublished local commits. Resolve them explicitly before merging the remote branch.');
      const currentBranches = await this.branches(key);
      if (currentBranches.find(branch => branch.name === source)?.commitId !== sourceId || currentBranches.find(branch => branch.name === target)?.commitId !== targetId) throw new ApiError(409, 'MERGE_VERSION_CONFLICT', 'Source or target branch moved during merge preparation. No push was executed.');
      await expected.beforeWrite?.();
      outputs.push(await runCli(['merge', safeRef(source)], cwd, options));
      await assertClean(this.config, cwd);
      await expected.beforeWrite?.();
      outputs.push(await runCli(['push', 'origin', safeRef(target)], cwd, options));
      return outputs.join('\n');
    });
  }
  async inspectMerge(key: RepoKey, source: string, target: string) {
    safeRef(source);safeRef(target);const branches=await this.branches(key),from=branches.find(item=>item.name===source),to=branches.find(item=>item.name===target);
    if(!from||!to)throw new ApiError(404,'BRANCH_NOT_FOUND','源或目标分支不存在。');
    const data=this.unwrap(await this.api.GET('/api/repos/{namespace}/{repo_name}/merge/{base_head}',{params:{path:{...repoParams(key),base_head:`${target}..${source}`}}}));
    const after=await this.branches(key);if(after.find(item=>item.name===source)?.commitId!==from.commitId||after.find(item=>item.name===target)?.commitId!==to.commitId)throw new ApiError(409,'MERGE_RESOLUTION_STALE','比较时分支发生变化，请重新加载。');
    return {sourceCommitId:from.commitId,targetCommitId:to.commitId,isMergeable:data.is_mergeable,conflicts:data.conflicts.map(item=>item.path),native:true};
  }
  async resolveMerge(key:RepoKey,input:NativeMergeResolutionInput,options:MergeOptions={}) {
    return this.serializeCli(key,()=>executeNativeMergeResolution(this.config,key,input,options,{inspect:()=>this.inspectMerge(key,input.source,input.target),isAncestor:async(ancestor,descendant)=>{for(let page=1;page<=100;page++){const commits=await this.commits(key,descendant,page,100);if(commits.some(item=>item.id===ancestor))return true;if(commits.length<100)return false;}throw new ApiError(413,'MERGE_HISTORY_LIMIT','分支祖先校验超过支持上限。');}}));
  }
  private async mergeHttp(key: RepoKey, source: string, target: string, reason: string, expected: MergeOptions): Promise<string> {
    const branches = await this.branches(key);
    if (branches.find(branch => branch.name === source)?.commitId !== expected.expectedSourceCommitId || branches.find(branch => branch.name === target)?.commitId !== expected.expectedTargetCommitId) throw new ApiError(409, 'MERGE_VERSION_CONFLICT', 'Source or target branch moved before the HTTP merge fallback. No merge was executed.');
    await expected.beforeWrite?.();
    const data = this.unwrap(await this.api.POST('/api/repos/{namespace}/{repo_name}/merge/{base_head}', { params: { path: { ...repoParams(key), base_head: `${target}..${source}` } }, body: { name: 'Oxen Web', email: 'oxen-web@localhost' } }));
    return `Used the documented Oxen HTTP merge endpoint. ${reason}\n${JSON.stringify(data)}`;
  }
  private async adaptWorkspace(key: RepoKey, item: components['schemas']['WorkspaceResponse']): Promise<WorkspaceItem> {
    const changes: WorkspaceItem['changes'] = [];
    let page = 1, totalPages = 1;
    do {
      const data = this.unwrap(await this.api.GET('/api/repos/{namespace}/{repo_name}/workspaces/{workspace_id}/changes', { params: { path: { ...repoParams(key), workspace_id: item.id }, query: { page, page_size: 1000 } } }));
      totalPages = Math.max(data.staged.added_files.total_pages, data.staged.modified_files.total_pages, data.staged.removed_files.total_pages);
      for (const [field, status] of [['added_files', 'added'], ['modified_files', 'modified'], ['removed_files', 'removed']] as const) {
        const group = data.staged[field];
        if (!group.entries.length && page < group.total_pages) throw new ApiError(502, 'WORKSPACE_CHANGES_INCOMPLETE', 'Oxen workspace pagination ended before all staged changes were received.');
        changes.push(...group.entries.map(entry => ({ path: entry.filename, status })));
      }
      if (changes.length > 100_000) throw new ApiError(413, 'WORKSPACE_CHANGES_LIMIT', 'Workspace exceeds 100000 staged files; a partial change list was not returned.');
      page++;
    } while (page <= totalPages);
    let branch = this.workspaceBranches.get(this.mappingKey(key, item.id)) ?? '';
    if (!branch) { const candidates = (await this.branches(key)).filter(branch => branch.commitId === item.commit.id); branch = candidates.length === 1 ? candidates[0]!.name : ''; }
    return { id: item.id, name: item.name ?? item.id, branch, createdAt: item.created_at ?? undefined, baseCommitId: item.commit.id, changes };
  }
  async workspaces(key: RepoKey) {
    this.ensure(); const data = this.unwrap(await this.api.GET('/api/repos/{namespace}/{repo_name}/workspaces', { params: { path: repoParams(key) } }));
    return Promise.all(data.workspaces.map(item => this.adaptWorkspace(key, item)));
  }
  async createWorkspace(key: RepoKey, name: string, branch: string) {
    this.ensure();
    const data = this.unwrap(await this.api.PUT('/api/repos/{namespace}/{repo_name}/workspaces', { params: { path: repoParams(key) }, body: { workspace_id: randomUUID(), branch_name: branch, name } }));
    await this.persistMapping(key, data.workspace.id, branch);
    return this.adaptWorkspace(key, data.workspace);
  }
  async workspace(key: RepoKey, id: string) {
    this.ensure();
    const data = this.unwrap(await this.api.GET('/api/repos/{namespace}/{repo_name}/workspaces/{workspace_id}', { params: { path: { ...repoParams(key), workspace_id: id } } }));
    return this.adaptWorkspace(key, data.workspace);
  }
  async workspaceFile(key: RepoKey, id: string, filename: string) { await this.workspace(key, id); return this.file(key, id, filename, 1, 100); }
  async deleteWorkspace(key: RepoKey, id: string) {
    this.ensure(); this.unwrap(await this.api.DELETE('/api/repos/{namespace}/{repo_name}/workspaces/{workspace_id}', { params: { path: { ...repoParams(key), workspace_id: id } } }));
  }
  async writeWorkspace(key: RepoKey, id: string, filename: string, content: Buffer) {
    this.ensure(); safeFilePath(filename);
    validateDataFile(filename, content);
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(content)]), path.posix.basename(filename));
    const directory = path.posix.dirname(filename);
    this.unwrap(await this.api.POST('/api/repos/{namespace}/{repo_name}/workspaces/{workspace_id}/files/{path}', { params: { path: { ...repoParams(key), workspace_id: id, path: directory === '.' ? '' : directory } }, body: form as unknown as { file: string }, bodySerializer: body => body as unknown as FormData }));
    return this.workspace(key, id);
  }
  async removeWorkspaceFiles(key:RepoKey,id:string,filenames:string[]){
    this.ensure();const paths=filenames.map(safeFilePath);if(!paths.length)return;
    const response=await this.api.DELETE('/api/repos/{namespace}/{repo_name}/workspaces/{workspace_id}/files',{params:{path:{...repoParams(key),workspace_id:id}},body:paths});
    if(response.response.status!==200)throw new ApiError(409,'RESTORE_REMOVE_INCOMPLETE','原生暂存删除未完整成功，未提交恢复。');this.unwrap(response);
  }
  async commitWorkspace(key: RepoKey, id: string, message: string, expectedCommit?: string,beforeWrite?:()=>Promise<void>) {
    return this.serializeCli(key, async () => {
      this.ensure(); const workspace = await this.workspace(key, id);
      if (!workspace.branch) throw new ApiError(409, 'WORKSPACE_BRANCH_UNKNOWN', 'The branch for this existing workspace is unknown. Create a workspace through this BFF before committing.');
      await beforeWrite?.();
      if (expectedCommit && (await this.branches(key)).find(branch => branch.name === workspace.branch)?.commitId !== expectedCommit) throw new ApiError(409, 'LABEL_VERSION_CONFLICT', '分支已更新，请重新加载当前版本后再保存。');
      if (!workspace.changes.length) throw new ApiError(409, 'NO_CHANGES', 'Workspace has no staged changes.');
      if (expectedCommit) {
        // Versioned label/import writes require the exact commit returned by the server, rather than a later branch-head lookup.
        const result = this.unwrap(await this.api.POST('/api/repos/{namespace}/{repo_name}/workspaces/{workspace_id}/merge/{branch}', { params: { path: { ...repoParams(key), workspace_id: id, branch: workspace.branch } }, body: { message, author: 'Oxen Web', email: 'oxen-web@localhost' } }));
        return adaptCommit(result.commit);
      }
      let cwd: string | undefined;
      try { cwd = await provisionClone(this.config, key, workspace.branch); }
      catch (error) { if (!(error instanceof ApiError) || error.code !== 'CLI_UNAVAILABLE') throw error; }
      if (cwd) {
        await assertClean(this.config, cwd);
        await runCli(['workspace', 'commit', '--workspace-id', id, '--branch', workspace.branch, '-m', message], cwd, { binary: this.config.cliBin, timeoutMs: this.config.cliTimeoutMs, maxOutputBytes: 1024 * 1024 });
        const branches = await this.branches(key), branch = branches.find(branch => branch.name === workspace.branch);
        if (!branch) throw new ApiError(502, 'COMMIT_RESULT_UNAVAILABLE', 'CLI completed but the committed branch could not be read. Refresh before retrying.');
        const result = this.unwrap(await this.api.GET('/api/repos/{namespace}/{repo_name}/commits/{commit_id}', { params: { path: { ...repoParams(key), commit_id: branch.commitId } } }));
        return adaptCommit(result.commit);
      }
      const data = this.unwrap(await this.api.POST('/api/repos/{namespace}/{repo_name}/workspaces/{workspace_id}/merge/{branch}', { params: { path: { ...repoParams(key), workspace_id: id, branch: workspace.branch } }, body: { message, author: 'Oxen Web', email: 'oxen-web@localhost' } }));
      return adaptCommit(data.commit);
    });
  }
  async resolveRef(key: RepoKey, reference: string): Promise<string> {
    this.ensure(); safeRef(reference);
    const branch = (await this.branches(key)).find(branch => branch.name === reference);
    if (branch) return branch.commitId;
    const data = this.unwrap(await this.api.GET('/api/repos/{namespace}/{repo_name}/commits/{commit_id}', { params: { path: { ...repoParams(key), commit_id: reference } } }));
    return data.commit.id;
  }
  async annotations(key: RepoKey, filename?: string, reference = 'main'): Promise<Annotation[]> { return this.extensions.annotations(key, await this.resolveRef(key, reference), filename); }
  async legacyAnnotations(key: RepoKey, reference: string): Promise<Annotation[]> { return this.extensions.annotationsInHistory(key, (await this.commits(key, reference, 1, 1000)).map(commit => commit.id)); }
  async annotate(key: RepoKey, input: Omit<Annotation, 'id' | 'author' | 'updatedAt'>, reference = 'main'): Promise<Annotation> {
    const commitId = await this.resolveRef(key, reference);
    await this.file(key, commitId, input.path, 1, 1);
    return this.extensions.annotate(key, commitId, input);
  }
  async query(key: RepoKey, reference: string, filename: string, prompt: string) { const table = await this.file(key, reference, filename, 1, 500); return naturalQuery(table, prompt); }
  async push(key: RepoKey, branch: string, checks: PushOptions = {}) {
    return this.serializeCli(key, async () => {
      const cwd = await provisionClone(this.config, key, branch), options = cliOptions(this.config);
      await assertClean(this.config, cwd);
      const output = [await runCli(['fetch'], cwd, options), await runCli(['checkout', safeRef(branch)], cwd, options), await runCli(['pull', 'origin', safeRef(branch)], cwd, options)];
      await assertClean(this.config, cwd);
      await checks.beforeWrite?.();
      output.push(await runCli(['push', 'origin', safeRef(branch)], cwd, options));
      return output.join('\n');
    });
  }
}
