export type ReleaseStatus = 'draft' | 'queued' | 'building' | 'ready' | 'published' | 'failed' | 'withdrawn';
export interface ReleaseActor { id: string; name: string }
export interface ReleaseAsset { id: string; name: string; size: number; sha256: string; mime: string }
export interface ReleaseAudit { at: string; actor: ReleaseActor; action: string; detail?: string }
export interface DatasetRelease {
  id: string; namespace: string; repo: string; version: string; title: string; notes: string;
  sourceRef: string; commitId: string; prerelease: boolean; latest: boolean; status: ReleaseStatus;
  includeArchives?:boolean;
  kind: 'release' | 'snapshot'; revision: number; createdBy: ReleaseActor; createdAt: string; updatedAt: string;
  publishedAt?: string; builtAt?: string; rowCount?: number; attachmentCount?: number;
  assets: ReleaseAsset[]; issues: string[]; error?: string; audit: ReleaseAudit[];
  errata?:Array<{id:string;body:string;actor:ReleaseActor;createdAt:string}>;
  comparison?:{baseReleaseId:string;baseVersion:string;baseCommitId:string;samples:{added:number;removed:number;modified:number};labelsChanged:number;attachments:{added:number;removed:number;modified:number};schemaChanged:boolean;readmeChanged:boolean;scopeLabelsChanged?:boolean;fragmentsChanged?:boolean;error?:string};
}
export interface ReleaseShare { id: string; releaseId: string; createdBy: ReleaseActor; createdAt: string; expiresAt: string; revokedAt?: string }
export interface ReleaseList { items: DatasetRelease[]; capabilities: { manage: boolean; share: boolean; export: boolean } }
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
