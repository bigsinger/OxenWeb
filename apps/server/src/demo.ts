import {durableWriteJson} from './durable-store.js';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Annotation, BranchItem, CommitDetail, CommitItem, DiffFile, FileTreeNode, RepoSummary, WorkspaceItem } from '../../../packages/shared/src/index.js';
import { ApiError } from './errors.js';
import { makePreview, mimeFor, tableFrom } from './preview.js';
import type { CreateRepo, MergeOptions, NativeMergeResolutionInput, Provider, RepoKey, RepoPatch } from './provider.js';
import { safeFilePath, safeRef, safeSegment } from './safety.js';
import { validateDataFile } from './jsonl.js';

interface StoredWorkspace extends WorkspaceItem { staged: Record<string, string>;removed?:string[] }
interface StoredCommit extends CommitDetail { snapshot: Record<string, string> }
interface StoredRepo { summary: RepoSummary; branches: BranchItem[]; commits: StoredCommit[]; workspaces: StoredWorkspace[]; annotations: Array<Annotation & { commitId?: string }> }
interface DemoState { version: 1; repos: StoredRepo[] }

const svg = (name: string, sky: string, water: string, mountain: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="${sky}"/><circle cx="920" cy="160" r="72" fill="#f5ead5"/><path d="M0 430L250 150 510 500 770 270 1200 550V800H0Z" fill="${mountain}"/><path d="M0 560Q300 430 570 600T1200 570V800H0Z" fill="${water}"/><path d="M0 660Q300 560 650 690T1200 660" stroke="#fff" opacity=".35" stroke-width="3" fill="none"/><text x="48" y="750" fill="#fff" font-family="sans-serif" font-size="28" opacity=".7">${name} · Oxen demo dataset</text></svg>`;

function pdf(): string {
  const parts = ['%PDF-1.4\n'];
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const text = 'BT /F1 24 Tf 60 700 Td (Visual Search Dataset Card) Tj 0 -48 Td /F1 12 Tf (Local demonstration data - no upstream connection.) Tj 0 -30 Td (Images: coast and forest illustrations. License: CC0.) Tj ET';
  objects.push(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(parts.join(''))); parts.push(`${i + 1} 0 obj\n${objects[i]}\nendobj\n`); }
  const start = Buffer.byteLength(parts.join(''));
  parts.push(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`);
  return Buffer.from(parts.join('')).toString('base64');
}

const encoded = (text: string) => Buffer.from(text).toString('base64');
function commit(message: string, snapshot: Record<string, string>, parentIds: string[], files: DiffFile[], day = 0): StoredCommit {
  const timestamp = new Date(Date.now() - day * 86_400_000).toISOString();
  const id = createHash('sha256').update(JSON.stringify({ message, snapshot, timestamp, uuid: randomUUID() })).digest('hex').slice(0, 32);
  return { id, message, author: 'Oxen Demo', email: 'demo@localhost', timestamp, parentIds, files, snapshot };
}

function seed(): DemoState {
  const initial = { 'README.md': encoded('# Visual Search\n\nA versioned multimodal dataset for image retrieval and evaluation.\n\n## Contents\n\n- `data/annotations.csv`: image references, captions, labels, and quality scores\n- `data/validation.jsonl`: held-out evaluation records\n- `images/`: original CC0 vector illustrations\n- `reports/dataset-card.pdf`: dataset documentation\n\nThis repository is **local demonstration data**. Changes are persisted by the BFF in its demo data file; they are never sent to Oxen.\n'), 'images/coast.svg': encoded(svg('Pacific coast', '#b8d3d2', '#417b8a', '#557566')), 'images/forest.svg': encoded(svg('Alpine forest', '#d3dcca', '#6b8d7b', '#3b5f50')), 'reports/dataset-card.pdf': pdf() };
  const annotations = ['id,image,caption,label,split,quality', ...Array.from({ length: 48 }, (_, i) => `${i + 1},images/${i % 2 ? 'forest' : 'coast'}.svg,"${i % 2 ? 'A quiet alpine forest beside a lake' : 'Rocky coastline under a clear evening sky'}",${i % 2 ? 'forest' : 'coast'},${i % 5 ? 'train' : 'validation'},${(0.7 + (i % 29) / 100).toFixed(2)}`)].join('\n');
  const snapshot = { ...initial, 'data/annotations.csv': encoded(annotations), 'data/validation.jsonl': encoded(Array.from({ length: 12 }, (_, i) => JSON.stringify({ id: `val-${String(i + 1).padStart(3, '0')}`, image: `images/${i % 2 ? 'forest' : 'coast'}.svg`, caption: i % 2 ? 'Alpine woodland landscape' : 'Coastal landscape', score: 0.85 + i / 100 })).join('\n')) };
  const first = commit('Initialize visual search dataset', initial, [], Object.keys(initial).map(path => ({ path, status: 'added' })), 4);
  const second = commit('Add image captions and validation split', snapshot, [first.id], diffSnapshots(initial, snapshot), 1);
  const summary = (name: string, description: string, tags: string[], files: Record<string, string>, updatedAt: string): RepoSummary => ({ namespace: 'oxen', name, description, defaultBranch: 'main', updatedAt, size: Object.values(files).reduce((sum, value) => sum + Buffer.from(value, 'base64').length, 0), fileCount: Object.keys(files).length, visibility: 'private', tags });
  const make = (name: string, description: string, tags: string[], files: Record<string, string>): StoredRepo => {
    const first = commit('Initialize repository', files, [], Object.keys(files).map(path => ({ path, status: 'added' })), 3);
    return { summary: summary(name, description, tags, files, first.timestamp), branches: [{ name: 'main', commitId: first.id, isDefault: true }], commits: [first], workspaces: [], annotations: [] };
  };
  return { version: 1, repos: [{ summary: summary('visual-search', 'A multimodal image dataset for visual search, captioning, and retrieval evaluation.', ['multimodal', 'images', 'retrieval'], snapshot, second.timestamp), branches: [{ name: 'main', commitId: second.id, isDefault: true }, { name: 'experiments/captions', commitId: first.id, isDefault: false }], commits: [second, first], workspaces: [], annotations: [] }, make('document-corpus', 'Curated documents for retrieval augmented generation experiments.', ['text', 'documents', 'RAG'], { 'README.md': encoded('# Document corpus\n\nYour document collection starts here.\n'), 'documents/introduction.txt': encoded('A reproducible corpus needs versioned sources, clear provenance, and quality checks.\n') }), make('evaluation-suite', 'Reproducible benchmarks and model evaluation records.', ['evaluation', 'tabular'], { 'README.md': encoded('# Evaluation suite\n\nVersion model benchmarks alongside the datasets that produced them.\n'), 'results.csv': encoded('model,accuracy,latency_ms\nbaseline,0.84,123\ncandidate,0.91,117\n') })] };
}

export function diffSnapshots(before: Record<string, string>, after: Record<string, string>): DiffFile[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(path => before[path] !== after[path]).map(path => {
    const isText = mimeFor(path).startsWith('text/') || /\.(json|jsonl)$/i.test(path);
    const a = before[path], b = after[path];
    return { path, status: !a ? 'added' : !b ? 'removed' : 'modified', ...(isText ? { before: a ? Buffer.from(a, 'base64').toString('utf8') : '', after: b ? Buffer.from(b, 'base64').toString('utf8') : '', deletions: a ? Buffer.from(a, 'base64').toString('utf8').split('\n').length : 0, additions: b ? Buffer.from(b, 'base64').toString('utf8').split('\n').length : 0 } : {}) };
  });
}

export class DemoProvider implements Provider {
  ready = true;
  capabilities = { read: true, write: true, cli: false, workspaces: true, annotations: true, naturalLanguageQuery: false, metadata: true, reasons: { mode: 'Explicit local demo mode. Changes are saved locally and never pushed to Oxen.', cli: 'Demo push simulates local publication; Oxen CLI is not executed.', naturalLanguageQuery: 'The demo provides a literal text filter, not an AI or natural language engine.', annotations: 'Labels use .oxenweb/labels.json in versioned demo snapshots. Legacy sidecar records are read-only migration sources.' } };
  private state!: DemoState;
  private chain = Promise.resolve();
  constructor(private filename: string) {}

  async init(): Promise<void> {
    try { this.state = JSON.parse(await readFile(this.filename, 'utf8')) as DemoState; if (this.state.version !== 1 || !Array.isArray(this.state.repos)) throw new Error('Unsupported demo data format'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; this.state = seed(); await this.save(); }
  }
  private async save(): Promise<void> {
    await mkdir(path.dirname(this.filename), { recursive: true });
    await durableWriteJson(this.filename,this.state);
  }
  private mutate<T>(operation: () => T|Promise<T>): Promise<T> {
    let result!: T;
    const next = this.chain.then(async () => { const backup = structuredClone(this.state); try { result = await operation(); await this.save(); } catch (error) { this.state = backup; throw error; } });
    this.chain = next.catch(() => {});
    return next.then(() => structuredClone(result));
  }
  private find(key: RepoKey): StoredRepo {
    const result = this.state.repos.find(item => item.summary.namespace === key.namespace && item.summary.name === key.repo);
    if (!result) throw new ApiError(404, 'REPO_NOT_FOUND', 'Repository not found.');
    return result;
  }
  private at(repo: StoredRepo, ref: string): StoredCommit {
    const id = repo.branches.find(branch => branch.name === ref)?.commitId ?? ref;
    const result = repo.commits.find(commit => commit.id === id);
    if (!result) throw new ApiError(404, 'REF_NOT_FOUND', 'Branch or commit not found.');
    return result;
  }
  private ws(repo: StoredRepo, id: string): StoredWorkspace {
    const result = repo.workspaces.find(workspace => workspace.id === id);
    if (!result) throw new ApiError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found.');
    return result;
  }
  private publicWorkspace(workspace: StoredWorkspace): WorkspaceItem { const { staged: _staged,removed:_removed, ...result } = workspace; return structuredClone(result); }
  async repos(namespace?: string) { return structuredClone(this.state.repos.filter(repo => !namespace || repo.summary.namespace === namespace).map(repo => repo.summary)); }
  async repo(key: RepoKey) { return structuredClone(this.find(key).summary); }
  async createRepo(input: CreateRepo) {
    return this.mutate(() => {
      safeSegment(input.namespace); safeSegment(input.name);
      if (this.state.repos.some(repo => repo.summary.namespace === input.namespace && repo.summary.name === input.name)) throw new ApiError(409, 'REPO_EXISTS', 'A repository with this name already exists.');
      const snapshot = { 'README.md': encoded(`# ${input.name}\n\n${input.description}\n`) };
      const initial = commit('Initialize repository', snapshot, [], [{ path: 'README.md', status: 'added' }]);
      const summary: RepoSummary = { namespace: input.namespace, name: input.name, description: input.description, visibility: input.visibility ?? 'private', defaultBranch: 'main', updatedAt: initial.timestamp, fileCount: 1, size: Buffer.from(snapshot['README.md'], 'base64').length, tags: [] };
      this.state.repos.push({ summary, commits: [initial], branches: [{ name: 'main', commitId: initial.id, isDefault: true }], workspaces: [], annotations: [] });
      return summary;
    });
  }
  async updateRepo(key: RepoKey, patch: RepoPatch) {
    return this.mutate(() => {
      const repo = this.find(key);
      if (patch.defaultBranch && !repo.branches.some(branch => branch.name === patch.defaultBranch)) throw new ApiError(400, 'BRANCH_NOT_FOUND', 'Default branch must already exist.');
      Object.assign(repo.summary, patch, { updatedAt: new Date().toISOString() });
      repo.branches.forEach(branch => { branch.isDefault = branch.name === repo.summary.defaultBranch; });
      return repo.summary;
    });
  }
  async tree(key: RepoKey, ref: string, directory: string): Promise<FileTreeNode[]> {
    const snapshot = this.at(this.find(key), ref).snapshot;
    const prefix = directory ? `${safeFilePath(directory)}/` : '';
    const nodes = new Map<string, FileTreeNode>();
    for (const [filename, value] of Object.entries(snapshot)) {
      if (!filename.startsWith(prefix)) continue;
      const rest = filename.slice(prefix.length), [name] = rest.split('/');
      if (!name) continue;
      if (rest.includes('/')) nodes.set(name, { name, path: `${prefix}${name}`, kind: 'directory', extension: '', size: 0 });
      else nodes.set(name, { name, path: filename, kind: 'file', size: Buffer.from(value, 'base64').length, extension: path.extname(name).slice(1) });
    }
    return [...nodes.values()].sort((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name));
  }
  async raw(key: RepoKey, ref: string, filename: string) {
    const snapshot = this.at(this.find(key), ref).snapshot;
    const value = snapshot[safeFilePath(filename)];
    if (value === undefined) throw new ApiError(404, 'FILE_NOT_FOUND', 'File not found on this reference.');
    return { content: Buffer.from(value, 'base64'), mime: mimeFor(filename), filename: path.basename(filename) };
  }
  async file(key: RepoKey, ref: string, filename: string, page: number, pageSize: number) {
    const raw = await this.raw(key, ref, filename);
    const url = `/api/repos/${encodeURIComponent(key.namespace)}/${encodeURIComponent(key.repo)}/raw?ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(filename)}`;
    return makePreview(filename, raw.content, url, page, pageSize);
  }
  async commits(key: RepoKey, ref: string, page = 1, pageSize = 100): Promise<CommitItem[]> {
    const repo = this.find(key), start = this.at(repo, ref), result: CommitItem[] = [], seen = new Set<string>();
    const queue = [start.id];
    while (queue.length) { const id = queue.shift()!; if (seen.has(id)) continue; seen.add(id); const item = repo.commits.find(commit => commit.id === id); if (!item) continue; const { files: _files, snapshot: _snapshot, ...summary } = item; result.push(summary); queue.push(...item.parentIds); }
    return structuredClone(result.slice((page - 1) * pageSize, page * pageSize));
  }
  async commit(key: RepoKey, id: string): Promise<CommitDetail> { const { snapshot: _snapshot, ...result } = this.at(this.find(key), id); return structuredClone(result); }
  async diff(key: RepoKey, base: string, head: string) { const repo = this.find(key); return diffSnapshots(this.at(repo, base).snapshot, this.at(repo, head).snapshot); }
  async branches(key: RepoKey) { return structuredClone(this.find(key).branches); }
  async createBranch(key: RepoKey, name: string, from: string) {
    return this.mutate(() => { safeRef(name); const repo = this.find(key); if (repo.branches.some(branch => branch.name === name)) throw new ApiError(409, 'BRANCH_EXISTS', 'A branch with this name already exists.'); const branch = { name, commitId: this.at(repo, from).id, isDefault: false }; repo.branches.push(branch); return branch; });
  }
  async merge(key: RepoKey, source: string, target: string) {
    return this.mutate(() => {
      if (source === target) throw new ApiError(400, 'INVALID_MERGE', 'Choose two different branches.');
      const repo = this.find(key), sourceBranch = repo.branches.find(branch => branch.name === source), targetBranch = repo.branches.find(branch => branch.name === target);
      if (!sourceBranch || !targetBranch) throw new ApiError(404, 'BRANCH_NOT_FOUND', 'Source or target branch not found.');
      const sourceCommit = this.at(repo, source), targetCommit = this.at(repo, target);
      const ancestors = (start: StoredCommit) => { const found = new Set<string>(), queue = [start.id]; while (queue.length) { const id = queue.shift()!; if (found.has(id)) continue; found.add(id); const item = repo.commits.find(commit => commit.id === id); if (item) queue.push(...item.parentIds); } return found; };
      const sourceAncestors = ancestors(sourceCommit), targetAncestors = ancestors(targetCommit);
      const base = repo.commits.find(commit => sourceAncestors.has(commit.id) && targetAncestors.has(commit.id));
      if (!base) throw new ApiError(409, 'UNRELATED_HISTORIES', 'Branches do not share a common ancestor.');
      const merged = { ...targetCommit.snapshot };
      const conflicts: string[] = [];
      for (const filename of new Set([...Object.keys(base.snapshot), ...Object.keys(sourceCommit.snapshot), ...Object.keys(targetCommit.snapshot)])) {
        const original = base.snapshot[filename], theirs = sourceCommit.snapshot[filename], ours = targetCommit.snapshot[filename];
        if (theirs === original) continue;
        if (ours !== original && ours !== theirs) { conflicts.push(filename); continue; }
        if (theirs === undefined) delete merged[filename]; else merged[filename] = theirs;
      }
      if (conflicts.length) throw new ApiError(409, 'MERGE_CONFLICT', `Resolve conflicting files before merging: ${conflicts.join(', ')}`, { paths: conflicts });
      const next = commit(`Merge ${source} into ${target}`, merged, [targetCommit.id, sourceCommit.id], diffSnapshots(targetCommit.snapshot, merged));
      repo.commits.unshift(next); targetBranch.commitId = next.id; this.updateSummary(repo, next);
      return { id: randomUUID(), operation: 'merge', status: 'succeeded' as const, output: `Demo merge created commit ${next.id.slice(0, 8)}.`, createdAt: new Date().toISOString() };
    });
  }
  async inspectMerge(key:RepoKey,source:string,target:string){
    const repo=this.find(key),from=repo.branches.find(item=>item.name===source),to=repo.branches.find(item=>item.name===target);if(!from||!to)throw new ApiError(404,'BRANCH_NOT_FOUND','源或目标分支不存在。');
    const a=new Set((await this.commits(key,from.commitId,1,10000)).map(item=>item.id)),b=new Set((await this.commits(key,to.commitId,1,10000)).map(item=>item.id)),base=repo.commits.find(item=>a.has(item.id)&&b.has(item.id));if(!base)throw new ApiError(409,'UNRELATED_HISTORIES','没有共同祖先。');
    const s=this.at(repo,from.commitId).snapshot,t=this.at(repo,to.commitId).snapshot;const conflicts=[...new Set([...Object.keys(base.snapshot),...Object.keys(s),...Object.keys(t)])].filter(filename=>s[filename]!==t[filename]&&s[filename]!==base.snapshot[filename]&&t[filename]!==base.snapshot[filename]);
    return {sourceCommitId:from.commitId,targetCommitId:to.commitId,isMergeable:conflicts.length===0,conflicts,native:false};
  }
  async resolveMerge(key:RepoKey,input:NativeMergeResolutionInput,options:MergeOptions={}){
    const inspected=await this.inspectMerge(key,input.source,input.target);await options.beforeWrite?.();
    return this.mutate(()=>{const repo=this.find(key),source=repo.branches.find(item=>item.name===input.source),target=repo.branches.find(item=>item.name===input.target);if(source?.commitId!==input.expectedSourceCommitId||target?.commitId!==input.expectedTargetCommitId)throw new ApiError(409,'MERGE_RESOLUTION_STALE','分支已变化。');if(JSON.stringify([...inspected.conflicts].sort())!==JSON.stringify(input.files.map(item=>item.path).sort()))throw new ApiError(409,'MERGE_RESOLUTION_INCOMPLETE','冲突计划不完整。');
      const a=new Set<string>(),b=new Set<string>();const visit=(id:string,output:Set<string>)=>{if(output.has(id))return;output.add(id);for(const parent of this.at(repo,id).parentIds)visit(parent,output);};visit(source.commitId,a);visit(target.commitId,b);const base=repo.commits.find(item=>a.has(item.id)&&b.has(item.id))!,from=this.at(repo,source.commitId),to=this.at(repo,target.commitId),snapshot={...from.snapshot};
      for(const filename of new Set([...Object.keys(base.snapshot),...Object.keys(to.snapshot)])){if(to.snapshot[filename]===base.snapshot[filename]||inspected.conflicts.includes(filename))continue;if(to.snapshot[filename]===undefined)delete snapshot[filename];else snapshot[filename]=to.snapshot[filename]!;}
      for(const file of input.files){safeFilePath(file.path);if(file.content===null)delete snapshot[file.path];else snapshot[file.path]=file.content.toString('base64');}
      const next=commit(input.message,snapshot,[source.commitId,target.commitId],diffSnapshots(from.snapshot,snapshot));repo.commits.unshift(next);source.commitId=next.id;this.updateSummary(repo,next);
      return {operationId:input.operationId,status:'resolved-on-source' as const,source:input.source,target:input.target,previousSourceCommitId:input.expectedSourceCommitId,sourceCommitId:next.id,targetCommitId:target.commitId,parentIds:next.parentIds,requiresReview:true as const,output:'演示提供方已更新源分支；请刷新 MR，并重新提交受影响条目复核。',native:false};
    });
  }
  async workspaces(key: RepoKey) { return this.find(key).workspaces.map(workspace => this.publicWorkspace(workspace)); }
  async createWorkspace(key: RepoKey, name: string, branch: string) { return this.mutate(() => { const repo = this.find(key); const baseCommit = this.at(repo, branch); if (!repo.branches.some(item => item.name === branch)) throw new ApiError(400, 'BRANCH_REQUIRED', 'A workspace must target a branch.'); const workspace: StoredWorkspace = { id: randomUUID(), name, branch, baseCommitId: baseCommit.id, createdAt: new Date().toISOString(), changes: [], staged: {} }; repo.workspaces.push(workspace); return this.publicWorkspace(workspace); }); }
  async workspace(key: RepoKey, id: string) { return this.publicWorkspace(this.ws(this.find(key), id)); }
  async workspaceFile(key: RepoKey, id: string, filename: string) {
    const repo = this.find(key), workspace = this.ws(repo, id);
    const value = workspace.staged[safeFilePath(filename)] ?? this.at(repo, workspace.branch).snapshot[filename];
    if (value === undefined) throw new ApiError(404, 'FILE_NOT_FOUND', 'File not found in workspace.');
    return makePreview(filename, Buffer.from(value, 'base64'), '', 1, 100);
  }
  async rawWorkspaceFile(key:RepoKey,id:string,filename:string){const repo=this.find(key),workspace=this.ws(repo,id),name=safeFilePath(filename),value=workspace.removed?.includes(name)?undefined:workspace.staged[name]??this.at(repo,workspace.baseCommitId??workspace.branch).snapshot[name];if(value===undefined)throw new ApiError(404,'FILE_NOT_FOUND','File not found in workspace.');return{content:Buffer.from(value,'base64'),mime:mimeFor(name),filename:path.posix.basename(name)};}
  async deleteWorkspace(key: RepoKey, id: string) { await this.mutate(() => { const repo = this.find(key); this.ws(repo, id); repo.workspaces = repo.workspaces.filter(workspace => workspace.id !== id); }); }
  async writeWorkspace(key: RepoKey, id: string, filename: string, content: Buffer) {
    validateDataFile(filename, content);
    return this.mutate(() => { safeFilePath(filename); const repo = this.find(key), workspace = this.ws(repo, id), snapshot = this.at(repo, workspace.branch).snapshot; workspace.staged[filename] = content.toString('base64'); workspace.changes = Object.keys(workspace.staged).filter(path => workspace.staged[path] !== snapshot[path]).map(path => ({ path, status: snapshot[path] === undefined ? 'added' : 'modified' })); return this.publicWorkspace(workspace); });
  }
  async writeWorkspaceBatch(key:RepoKey,id:string,files:ReadonlyArray<{path:string;content:Buffer}>){
    // Validate and snapshot all caller bytes before entering the single durable mutation.
    const staged=files.map(file=>{const filename=safeFilePath(file.path);validateDataFile(filename,file.content);return {filename,value:file.content.toString('base64')};});
    return this.mutate(()=>{const repo=this.find(key),workspace=this.ws(repo,id),snapshot=this.at(repo,workspace.branch).snapshot;for(const file of staged)workspace.staged[file.filename]=file.value;workspace.changes=Object.keys(workspace.staged).filter(filename=>workspace.staged[filename]!==snapshot[filename]).map(filename=>({path:filename,status:snapshot[filename]===undefined?'added':'modified'}));return this.publicWorkspace(workspace);});
  }
  private updateSummary(repo: StoredRepo, commit: StoredCommit) { if (repo.branches.find(branch => branch.name === repo.summary.defaultBranch)?.commitId === commit.id) { repo.summary.updatedAt = commit.timestamp; repo.summary.fileCount = Object.keys(commit.snapshot).length; repo.summary.size = Object.values(commit.snapshot).reduce((sum, value) => sum + Buffer.from(value, 'base64').length, 0); } }
  async removeWorkspaceFiles(key:RepoKey,id:string,filenames:string[]){return this.mutate(()=>{const repo=this.find(key),workspace=this.ws(repo,id),snapshot=this.at(repo,workspace.branch).snapshot;for(const name of filenames){const filename=safeFilePath(name);if(snapshot[filename]===undefined)throw new ApiError(404,'FILE_NOT_FOUND','删除暂存的文件不存在。');workspace.removed=[...new Set([...(workspace.removed??[]),filename])];delete workspace.staged[filename];}workspace.changes=[...workspace.changes.filter(change=>!filenames.includes(change.path)),...filenames.map(filename=>({path:filename,status:'removed' as const}))];});}
  async commitWorkspace(key: RepoKey, id: string, message: string, expectedCommit?: string,beforeWrite?:()=>Promise<void>): Promise<CommitItem> {
    return this.mutate(async () => {await beforeWrite?.(); const repo = this.find(key), workspace = this.ws(repo, id), branch = repo.branches.find(item => item.name === workspace.branch)!; if (expectedCommit && branch.commitId !== expectedCommit) throw new ApiError(409, 'LABEL_VERSION_CONFLICT', '分支已更新，请重新加载当前版本后再保存。'); if (!workspace.changes.length) throw new ApiError(409, 'NO_CHANGES', 'Workspace has no staged changes.'); const previous = this.at(repo, workspace.branch), snapshot = { ...previous.snapshot, ...workspace.staged };for(const filename of workspace.removed??[])delete snapshot[filename]; const next = commit(message, snapshot, [previous.id], diffSnapshots(previous.snapshot, snapshot)); repo.commits.unshift(next); branch.commitId = next.id; workspace.staged = {};workspace.removed=[]; workspace.changes = []; this.updateSummary(repo, next); const { files: _files, snapshot: _snapshot, ...result } = next; return result; });
  }
  async annotations(key: RepoKey, filename?: string, reference = 'main') { const repo = this.find(key), commitId = this.at(repo, reference).id; return structuredClone(repo.annotations.filter(annotation => annotation.commitId === commitId && (!filename || annotation.path === filename))); }
  async legacyAnnotations(key: RepoKey, reference: string): Promise<Annotation[]> {
    const history = await this.commits(key, reference, 1, 1000), rank = new Map(history.map((commit, index) => [commit.id, index]));
    const records = this.find(key).annotations.filter(annotation => annotation.commitId && rank.has(annotation.commitId)).sort((a, b) => rank.get(a.commitId!)! - rank.get(b.commitId!)!);
    const unique = new Map<string, Annotation>(); for (const item of records) { const id = JSON.stringify([item.path, item.rowId]); if (!unique.has(id)) unique.set(id, item); } return structuredClone([...unique.values()]);
  }
  async annotate(key: RepoKey, input: Omit<Annotation, 'id' | 'author' | 'updatedAt'>, reference = 'main') {
    return this.mutate(() => { const repo = this.find(key); safeFilePath(input.path); const commitId = this.at(repo, reference).id; const existing = repo.annotations.find(annotation => annotation.commitId === commitId && annotation.path === input.path && annotation.rowId === input.rowId); const annotation: Annotation & { commitId: string } = { ...input, commitId, id: existing?.id ?? randomUUID(), author: 'Local demo user', updatedAt: new Date().toISOString() }; if (existing) Object.assign(existing, annotation); else repo.annotations.push(annotation); return annotation; });
  }
  async query(key: RepoKey, ref: string, filename: string, query: string) {
    const raw = await this.raw(key, ref, filename), table = tableFrom(raw.content.toString('utf8'), filename);
    if (!table) throw new ApiError(400, 'TABLE_REQUIRED', 'The demo text filter requires a CSV, TSV, or JSONL file.');
    const text = query.trim().toLowerCase();
    const rows = table.rows.filter(row => Object.values(row).some(value => String(value).toLowerCase().includes(text)));
    return { columns: table.columns, rows: rows.slice(0, 200), totalRows: rows.length, explanation: `Demo literal text filter: values containing “${query}”. This is not natural language AI. Returning at most 200 rows.`, engine: 'demo-filter' as const };
  }
  async push(key: RepoKey, branch: string) { this.at(this.find(key), branch); return 'Demo mode: changes are persisted locally. No remote push or Oxen CLI operation was performed.'; }
}
