import type { LabelAssignment, LabelColumn, LabelScope, LabelState, LabelTemplateApplication, QueryResult, RequestIdentity, TableColumn } from './index.js';
import type { DatasetFieldMetadata } from './field-metadata.js';

export interface DatasetDescriptor {
  version: 1; id: string; name: string; canonicalPath: string; readmePath: string;
  identityField: string; attachmentFields: string[]; source: 'descriptor' | 'bundle-manifest' | 'single-table';
  importManifestPath?: string; identityMapPath?: string;
  /** Versioned Web field metadata and validation rules; no source keys or values are converted. */
  fields?: Record<string, DatasetFieldMetadata>;
}
export interface DatasetAttachment { path: string; name: string; rowIds: string[]; sha256?: string; bytes?: number; kind: 'zip' | 'file' }
export interface DatasetActor { id: string; name: string }
export interface DatasetSpan { id: string; pointer: string; sourceHash: string; start: number; end: number; values: Record<string, string | string[]>; note?: string }
export interface DatasetStep { id: string; pointer: string; sourceHash: string; values: Record<string, string | string[]>; note?: string }
export interface DatasetLabelRecord {
  version: 1; scope: LabelScope; path?: string; rowId?: string;
  actor: DatasetActor; values: Record<string, string | string[] | null>;
  spans: DatasetSpan[]; steps: DatasetStep[]; sourceCommitId: string; contentHash?: string;
  updatedAt: string; fingerprint: string;
  templateSnapshot: { columns: LabelColumn[]; templateApplications?: LabelTemplateApplication[]; binding?: unknown };
}
export interface DatasetLabelConflict { scope: LabelScope; path?: string; rowId?: string; columnId: string; actors: string[] }
export interface DatasetFeedback { id: string; rowId?: string; columnId?: string; message: string; actor: DatasetActor; createdAt: string; sourceCommitId: string }
export interface DatasetSnapshot {
  namespace: string; repo: string; ref: string; commitId: string; path: string;
  descriptor: DatasetDescriptor; rows: Record<string, unknown>[]; rowIds: string[];
  columns: TableColumn[]; totalRows: number; contentHashes: Record<string, string>;
  labels: LabelState; labelRecords: DatasetLabelRecord[]; labelConflicts: DatasetLabelConflict[];
  supersededLabelRecords?:Array<{path:string;record:DatasetLabelRecord;supersededBy:string}>;
  attachments: DatasetAttachment[]; feedback: DatasetFeedback[];
  readme: string; readmePath: string; binding?: unknown;
  orphanAssignments: LabelAssignment[]; warnings: string[];
  columnsByScope?: Partial<Record<LabelScope, LabelColumn[]>>;
}
export type DatasetOperation =
  | { op: 'update'; rowId: string; record: Record<string, unknown>; expectedContentHash?: string }
  | { op: 'append'; record: Record<string, unknown>; rowId?: string }
  | { op: 'delete'; rowId: string; expectedContentHash?: string }
  | { op: 'assign'; scope: LabelScope; rowId?: string; path?: string; values: Record<string, string | string[] | null>; spans?: DatasetSpan[]; steps?: DatasetStep[] }
  | { op: 'feedback'; rowId?: string; columnId?: string; message: string }
  | { op: 'readme'; content: string };
export interface DatasetSaveInput { ref: string; expectedCommit: string; message: string; operations: DatasetOperation[] }
export type DatasetWriteOperation = 'edit-content' | 'assign-labels' | 'edit-dataset-labels' | 'edit-file-labels' | 'annotate-fragment' | 'feedback' | 'edit-readme';
export interface DatasetWriteContext { scope?: LabelScope; path?: string; operations: DatasetOperation[] }
export type DatasetBeforeWrite = (key: {namespace:string;repo:string}, identity: RequestIdentity, branch: string, rowIds: string[], operation: DatasetWriteOperation, context: DatasetWriteContext) => Promise<void>;
export interface DatasetCapabilities { editContent: boolean; appendRows: boolean; assignLabels: boolean; editDatasetLabels: boolean; editFileLabels: boolean; editReadme: boolean; feedback: boolean }
export interface DatasetRowCapabilities { editContent: boolean; assignLabels: boolean; feedback: boolean }
export interface DatasetPage extends Omit<DatasetSnapshot, 'rows' | 'rowIds' | 'contentHashes' | 'labelRecords'> {
  rows: Record<string, unknown>[]; rowIds: string[]; contentHashes: Record<string, string>; labelRecords: DatasetLabelRecord[];
  matchedRows: number; page: number; pageSize: number; capabilities?: DatasetCapabilities;
  workflow?: Record<string,Record<string,unknown>>;
  rowCapabilities?: Record<string, DatasetRowCapabilities>;
  draft?: DatasetDraftSummary;
  baseContentHashes?: Record<string,string>;
  /** Fixed base values for the visible page only, never a full-table payload. */
  baseRows?: Record<string, Record<string, unknown>>;
  baseOwnLabelRecords?: Record<string, DatasetLabelRecord>;
  baseOwnFileLabelRecords?: Record<string, DatasetLabelRecord>;
  querySummary?: {engine:string;matchedRows:number;returnedRows:number;truncated:boolean;explanation:string};
  queryResult?: QueryResult;
}
export interface DatasetFilter { column: string; operator: 'eq' | 'contains' | 'unset' | 'gt' | 'lt'; value?: string }
export interface DatasetSort { column: string; direction: 'asc' | 'desc' }
export interface DatasetQueryInput { search?: string; filters?: DatasetFilter[]; sort?: DatasetSort; page?: number; pageSize?: number; sample?: string; prompt?: string; engine?: 'rules' | 'model'; allowExternalSchema?: boolean }

/** Private BFF data. Saving this document never creates an Oxen workspace or commit. */
export interface DatasetDraftSummary {
  id: string; ref: string; baseCommit: string; draftRevision: number;
  schemaHash: string; createdAt: string; updatedAt: string; operationCount: number;
  schemaHashes: { dataset: string; sample: string };
}
export interface DatasetDraft extends DatasetDraftSummary { operations: DatasetOperation[] }
export interface DatasetDraftState { draft?: DatasetDraft; issue?: { code: string; message: string }; summary?: DatasetDraftSummary }
export interface DatasetDraftSaveInput { ref: string; expectedCommit: string; draftRevision: number; expectedDraftId?: string; operations: DatasetOperation[] }
export interface DatasetDraftCommitInput { ref: string; expectedCommit: string; draftRevision: number; expectedDraftId: string; message: string }
export interface DatasetDraftRebaseInput {
  ref: string; expectedBaseCommit: string; expectedCommit: string;
  draftRevision: number; expectedDraftId?: string; operations?: DatasetOperation[];
}
export interface DatasetDraftChange {
  op: DatasetOperation['op']; scope?: LabelScope; rowId?: string; path?: string;
  fields: string[]; before?: unknown; after?: unknown;
}
export interface DatasetDraftDiff { draft: DatasetDraftSummary; changes: DatasetDraftChange[] }
