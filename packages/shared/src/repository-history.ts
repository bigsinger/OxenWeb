export interface RepositoryVersionRestoreInput { ref:string;expectedCommit:string;targetCommit:string }
export interface RepositoryVersionRestoreFile { path:string;status:'added'|'modified'|'removed';beforeSha256?:string;afterSha256?:string;bytes:number;generated?:boolean }
export interface RepositoryVersionRestorePreview extends RepositoryVersionRestoreInput { planHash:string;files:RepositoryVersionRestoreFile[];preservedPaths:string[];requiresReview:true;canRestore:boolean;warnings:string[] }
export interface RepositoryVersionRestoreCommitInput extends RepositoryVersionRestoreInput { planHash:string;confirmation:string;message:string }
export interface RepositoryVersionRestoreResult { commitId:string;previousCommitId:string;restoredFrom:string;ref:string;requiresReview:true }
