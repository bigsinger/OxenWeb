import type { RepoCatalogFields } from './catalog-types.js';
export * from './catalog-types.js';
export * from './field-metadata.js';
export * from './field-order.js';
export * from './field-option-colors.js';
export * from './source-record.js';
export * from './repository-history.js';
export * from './project-label-types.js';

export interface RepoSummary extends RepoCatalogFields {
  /** Web display name; namespace/name remains the stable Oxen repository path. */
  displayName?: string;
  namespace: string; name: string; description: string; defaultBranch: string;
  updatedAt: string; size: number; fileCount: number; visibility: 'public' | 'private' | 'unknown';
  tags: string[];
  /** Logical rows at the configured default branch. Null means no dataset or unavailable, never a guessed zero. */
  sampleCount?: number | null; sampleCountState?: 'ready' | 'not-dataset' | 'unavailable'; sampleCountCommitId?: string;
}
export interface FileTreeNode {
  name: string; path: string; kind: 'directory' | 'file'; size: number;
  extension: string; updatedAt?: string; lastCommit?: string;
}
export interface CommitItem {
  id: string; message: string; author: string; email?: string; timestamp: string;
  parentIds: string[];
}
export interface DiffFile {
  path: string; status: 'added' | 'modified' | 'removed'; additions?: number; deletions?: number;
  before?: string; after?: string; diff?: string;
}
export interface CommitDetail extends CommitItem { files: DiffFile[] }
export interface BranchItem { name: string; commitId: string; isDefault: boolean }
export interface WorkspaceItem {
  id: string; name: string; branch: string; createdAt?: string;
  baseCommitId?: string;
  changes: Array<{path: string; status: 'added' | 'modified' | 'removed'}>;
}
export interface TableColumn { name: string; dtype: string }
export interface FilePreview {
  path: string; kind: 'text' | 'table' | 'image' | 'pdf' | 'audio' | 'video' | 'binary';
  mime: string; size: number; text?: string; url?: string;
  columns?: TableColumn[]; rows?: Record<string, unknown>[]; totalRows?: number;
  page?: number; pageSize?: number; truncated?: boolean;
  /** Stable IDs parallel to rows; user record fields are never overwritten. */
  rowIds?: string[];
}
export interface Annotation {
  id: string; path: string; rowId: string; label: string; note: string;
  author: string; updatedAt: string;
}
export interface QueryResult {
  columns: TableColumn[]; rows: Record<string, unknown>[]; totalRows: number;
  explanation: string; engine: 'oxen' | 'demo-filter' | 'local-rules' | 'codex-plan';
  scannedRows?: number; sourceRows?: number; plan?: unknown;
}
export interface JobItem {
  id: string; operation: string; status: 'queued' | 'running' | 'succeeded' | 'failed';
  output: string; error?: string; createdAt: string;
}
export interface Capabilities {
  read: boolean; write: boolean; cli: boolean; workspaces: boolean;
  annotations: boolean; naturalLanguageQuery: boolean; metadata: boolean;
  reasons: Record<string, string>;
}
export interface AppStatus {
  mode: 'demo' | 'live'; ready: boolean; upstream?: string; version: string;
  authenticated: boolean; capabilities: Capabilities;
}
export interface ApiErrorBody { error: { code: string; message: string; requestId?: string; details?: unknown } }
export interface RepoLocation { namespace: string; repo: string }

export type LabelScope = 'dataset' | 'file' | 'row';
export interface LabelOption { value: string; color?: string; description?: string; optionId?: string; displayName?: string; deprecated?: boolean }
export interface LabelColumn {
  id: string; name: string; type: 'single' | 'multi' | 'text'; options?: LabelOption[];
  /** Stable local schema identity; display names and option contents may be customized. */
  semanticKey?: string; description?: string; scopes?: LabelScope[];
}
export interface LabelTemplateColumn extends LabelColumn { semanticKey: string; description: string; scopes: LabelScope[] }
export interface LabelTemplate {
  id: string; version: 1; name: string; description: string; category: 'general' | 'ai-safety' | 'domain';
  columns: LabelTemplateColumn[]; references?: Array<{ title: string; url: string }>;
}
export interface LabelTemplateApplication {
  templateId: string; templateVersion: 1; appliedAt: string; sourceCommitId: string;
  selectedKeys: string[]; columnIds: Record<string, string>;
}
export interface LabelAssignment {
  id: string; scope: LabelScope; path?: string; rowId?: string;
  values: Record<string, string | string[]>;
}
export interface LabelDocument {
  version: 1; columns: LabelColumn[]; assignments: LabelAssignment[];
  legacyMigration?: { unmatched: Annotation[]; migratedIds?: string[] };
  templateApplications?: LabelTemplateApplication[];
}
export interface LabelState extends LabelDocument {
  ref: string; commitId: string; storagePath: string; legacyCount: number;
}
export interface LabelSnapshotExport {
  format: 'oxen-web-label-snapshot'; version: 1;
  namespace: string; repo: string; ref: string; fixedCommitId: string; exportedAt: string; storagePath: string;
  document: LabelDocument; legacy: { unmigratedCount: number };
}
export interface JsonlValidationResult { filename: string; rowCount: number; columns: TableColumn[] }
export interface JsonlImportResult {
  namespace: string; repo: string; branch: string; path: string; commitId: string;
  rowCount: number; columns: TableColumn[];
}

export type RepositoryRole = 'viewer' | 'annotator' | 'editor' | 'reviewer' | 'lead' | 'admin';
export interface RequestIdentity {
  id: string; name: string; kind: 'owner' | 'collaborator' | 'guest';
  source: 'local' | 'bearer' | 'session' | 'anonymous';
  /** Authentication credential, separate from stable actor identity; never contains the token. */
  credentialId?: string;
}
export interface RepositoryCollaborator { id: string; name: string; role: RepositoryRole; createdAt: string; capabilities?: import('./governance-types.js').DatasetCapability[] }
export interface RepositoryPolicy {
  displayName?: string;
  version: 1; description: string; tags: string[]; defaultBranch: string;
  visibility: 'public' | 'private'; collaborators: RepositoryCollaborator[];
  updatedAt: string; updatedBy: string;
}
export interface RepositoryPermissions { read: boolean; write: boolean; admin: boolean; role: RepositoryRole | 'owner' | 'guest' | null; capabilities?: Partial<Record<import('./governance-types.js').DatasetCapability, boolean>> }
export interface RepositorySettingsState {
  policy: RepositoryPolicy; configurationBranch: string; commitId: string;
  storagePath: string; persisted: boolean; permissions?: RepositoryPermissions;
}
export interface RepositoryAccessState {
  collaborators: RepositoryCollaborator[]; permissions: RepositoryPermissions;
  configurationBranch: string; commitId: string; localOwnerEnabled: boolean;
  enforcement: 'bff';
}
export interface RepositoryTokenGrant { collaborator: RepositoryCollaborator; token: string; settings: RepositorySettingsState }
export interface AppStatus { identity?: RequestIdentity }

export interface TabularDiffRow {
  id: string; status: 'added' | 'removed' | 'modified';
  before?: Record<string, unknown>; after?: Record<string, unknown>;
}
export interface TabularDiffView {
  engine: 'oxen' | 'local-structured'; columns: TableColumn[];
  addedColumns: string[]; removedColumns: string[]; changedColumns: string[];
  counts: { added: number; removed: number; modified: number };
  rows: TabularDiffRow[]; keyColumn?: string;
  sourceRows?: { before: number; after: number }; note?: string;
}
export interface DiffFile { tabular?: TabularDiffView }

export interface MergeRequestActor { id: string; name: string }
export interface MergeRequestComment { id: string; body: string; author: MergeRequestActor; createdAt: string }
export interface MergeRequestItem {
  id: string; number: number; title: string; description: string;
  source: string; target: string; sourceCommitId: string; targetCommitId: string;
  status: 'open' | 'closed' | 'merging' | 'merged'; revision: number;
  author: MergeRequestActor; createdAt: string; updatedAt: string;
  mergedCommitId?: string; jobId?: string; mergeError?: string; interrupted?: boolean;
}
export interface MergeRequestDetail extends MergeRequestItem {
  comments: MergeRequestComment[]; storage: 'bff-local';
}
export interface MergeRequestComparison {
  source: string; target: string; sourceCommitId: string; targetCommitId: string;
  /** Unique common ancestor of the pinned heads; files compare this base to the source. */
  baseCommitId: string;
  ahead: number; behind: number; files: DiffFile[]; canCreate: boolean; reason?: string;
  stale?: boolean; currentSourceCommitId?: string; currentTargetCommitId?: string;
}
export interface MergeRequestJob { request: MergeRequestDetail; job: JobItem }
export * from './governance-types.js';
export * from './merge-resolution-types.js';
export * from './dataset-configuration.js';
export * from './dataset-field-types.js';
export * from './dataset-field-validation.js';
export * from './dataset-ui-state.js';
export * from './repository-management.js';
export * from './evaluation.js';
export * from './global-fields.js';
