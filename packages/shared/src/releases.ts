export type ReleaseStatus = 'draft' | 'queued' | 'building' | 'ready' | 'published' | 'failed' | 'withdrawn';
export interface ReleaseActor { id: string; name: string }
export interface ReleaseAsset {id:string;name:string;size:number;sha256:string;mime:string;audience?:'shared'|'internal';shareable?:boolean;kind?:'data'|'manifest'}
export interface DatasetReleaseChanges {files:{added:number;removed:number;modified:number;total:number};commits:{items:Array<{id:string;message:string}>;complete:boolean}}
export interface DatasetReleasePreview {
  commitId:string;ok:boolean;issues:string[];rowCount:number;attachmentCount:number;includedFields:string[];excludedFields:string[];
  baselineReleaseId:string|null;baselineVersion?:string;baselineCommitId?:string;comparison?:DatasetRelease['comparison'];
  changes:DatasetReleaseChanges;generatedNotes:string;planDigest:string;warnings:string[];
}
export interface ReleaseAudit { at: string; actor: ReleaseActor; action: string; detail?: string }
export interface DatasetRelease {
  id: string; namespace: string; repo: string; version: string; title: string; notes: string;
  sourceRef: string; commitId: string; latest: boolean; status: ReleaseStatus;
  publishingVersion:'dataset-v1';cleanupPending?:boolean;
  datasetPreview?:DatasetReleasePreview;generatedNotes?:string;baselineReleaseId?:string|null;
  deliveryMode?:'dataset';
  kind: 'release' | 'snapshot'; revision: number; createdBy: ReleaseActor; createdAt: string; updatedAt: string;
  publishedAt?: string; builtAt?: string; rowCount?: number; attachmentCount?: number;
  assets: ReleaseAsset[]; issues: string[]; error?: string; audit: ReleaseAudit[];
  errata?:Array<{id:string;body:string;actor:ReleaseActor;createdAt:string}>;
  comparison?:{baseReleaseId:string;baseVersion:string;baseCommitId:string;samples:{added:number;removed:number;modified:number};labelsChanged:number;attachments:{added:number;removed:number;modified:number};schemaChanged:boolean;readmeChanged:boolean;scopeLabelsChanged?:boolean;fragmentsChanged?:boolean;error?:string};
}
export interface ReleaseShare { id: string; releaseId: string; assetId?: string; createdBy: ReleaseActor; createdAt: string; expiresAt: string; revokedAt?: string }
export interface ReleaseList { items: DatasetRelease[]; capabilities: { manage: boolean; share: boolean; export: boolean; hidden?: boolean } }
export interface ZipImportCandidate { id: string; mode: 'tables' | 'directories' | 'archives' | 'release'; paths: string[]; title: string; rowCount?: number; columns?: string[] }
export interface ZipImportInspection { id: string; filename: string; sha256: string; size: number; totalUncompressedSize: number; entryCount: number; expiresAt: string; candidates: ZipImportCandidate[]; warnings: string[] }
export interface ZipImportMapping { mode: ZipImportCandidate['mode']; paths: string[]; idField?: string; attachmentFields?:string[] }
export interface ZipImportPlan { mapping: ZipImportMapping; rowCount: number; columns: string[]; attachmentCount: number; warnings: string[]; fingerprint: string }
export interface ZipImportResult { namespace: string; repo: string; branch: string; path: string; commitId: string; rowCount: number; columns: Array<{name:string;dtype:string}> }
export interface ArchiveMemberDiff { path: string; status: 'added' | 'removed' | 'modified' | 'unchanged'; before?: { size: number; sha256: string; mode: number }; after?: { size: number; sha256: string; mode: number }; metadataChanged?: boolean; renameHint?: string }
export interface ArchiveComparison {
  baseCommitId: string; headCommitId: string; basePath: string; headPath: string;
  beforeSha256: string; afterSha256: string; identicalBytes: boolean; contentEqual: boolean; complete: true;
  counts: Record<ArchiveMemberDiff['status'], number>; entries: ArchiveMemberDiff[];
  selected?: { path: string; kind: 'text' | 'binary'; before?: string; after?: string; lines?: Array<{type:'same'|'added'|'removed';text:string}>; reason?: string };
}
