import type { Annotation, BranchItem, Capabilities, CommitDetail, CommitItem, DiffFile, FilePreview, FileTreeNode, MergeResolutionResult, QueryResult, RepoSummary, WorkspaceItem } from '../../../packages/shared/src/index.js';

export interface RepoKey { namespace: string; repo: string }
export interface FileContent { content: Buffer; mime: string; filename: string }
export interface CreateRepo { namespace: string; name: string; description: string; visibility?: 'public' | 'private' }
export interface RepoPatch { description?: string; defaultBranch?: string; visibility?: 'public' | 'private'; tags?: string[] }
export interface MergeOptions { expectedSourceCommitId?: string; expectedTargetCommitId?: string; beforeWrite?: () => Promise<void> }
export interface PushOptions { beforeWrite?: () => Promise<void> }
export interface NativeMergeInspection { sourceCommitId: string; targetCommitId: string; isMergeable: boolean; conflicts: string[]; native: boolean }
export interface NativeMergeResolutionInput { operationId: string; source: string; target: string; expectedSourceCommitId: string; expectedTargetCommitId: string; files: Array<{ path: string; content: Buffer | null }>; message: string }

export interface Provider {
  capabilities: Capabilities;
  ready: boolean;
  checkReady?(): Promise<boolean>;
  repos(namespace?: string): Promise<RepoSummary[]>;
  createRepo(input: CreateRepo): Promise<RepoSummary>;
  repo(key: RepoKey): Promise<RepoSummary>;
  updateRepo(key: RepoKey, patch: RepoPatch): Promise<RepoSummary>;
  tree(key: RepoKey, ref: string, path: string): Promise<FileTreeNode[]>;
  file(key: RepoKey, ref: string, path: string, page: number, pageSize: number): Promise<FilePreview>;
  raw(key: RepoKey, ref: string, path: string): Promise<FileContent>;
  commits(key: RepoKey, ref: string, page?: number, pageSize?: number): Promise<CommitItem[]>;
  commit(key: RepoKey, id: string): Promise<CommitDetail>;
  /** Resolve a branch/commit without materializing its file diffs. */
  resolveRef?(key: RepoKey, reference: string): Promise<string>;
  diff(key: RepoKey, base: string, head: string): Promise<DiffFile[]>;
  branches(key: RepoKey): Promise<BranchItem[]>;
  createBranch(key: RepoKey, name: string, from: string): Promise<BranchItem>;
  merge(key: RepoKey, source: string, target: string, options?: MergeOptions): Promise<unknown>;
  inspectMerge?(key: RepoKey, source: string, target: string): Promise<NativeMergeInspection>;
  resolveMerge?(key: RepoKey, input: NativeMergeResolutionInput, options?: MergeOptions): Promise<MergeResolutionResult>;
  workspaces(key: RepoKey): Promise<WorkspaceItem[]>;
  createWorkspace(key: RepoKey, name: string, branch: string): Promise<WorkspaceItem>;
  workspace(key: RepoKey, id: string): Promise<WorkspaceItem>;
  workspaceFile(key: RepoKey, id: string, path: string): Promise<FilePreview>;
  deleteWorkspace(key: RepoKey, id: string): Promise<void>;
  writeWorkspace(key: RepoKey, id: string, path: string, content: Buffer): Promise<WorkspaceItem>;
  /** Fixed OpenAPI staging removal; never rewrites existing commit history. */
  removeWorkspaceFiles?(key:RepoKey,id:string,paths:string[]):Promise<void>;
  rawWorkspaceFile?(key:RepoKey,id:string,path:string):Promise<FileContent>;
  /** Optional provider-local atomic staging; pinned HTTP providers keep per-file writes. */
  writeWorkspaceBatch?(key:RepoKey,id:string,files:ReadonlyArray<{path:string;content:Buffer}>):Promise<WorkspaceItem>;
  commitWorkspace(key: RepoKey, id: string, message: string, expectedCommit?: string,beforeWrite?:()=>Promise<void>): Promise<CommitItem>;
  annotations(key: RepoKey, path?: string, ref?: string): Promise<Annotation[]>;
  legacyAnnotations?(key: RepoKey, ref: string): Promise<Annotation[]>;
  annotate(key: RepoKey, input: Omit<Annotation, 'id' | 'author' | 'updatedAt'>, ref?: string): Promise<Annotation>;
  query(key: RepoKey, ref: string, path: string, query: string): Promise<QueryResult>;
  push?(key: RepoKey, branch: string, options?: PushOptions): Promise<string>;
}
