export interface RepositoryLifecycleState {
  namespace:string; name:string; displayName:string; status:'active'|'removed';
  revision:number; removalId?:string; removedAt?:string; removedBy?:string;
  expectedRevision:string; branchCount:number; workspaceCount:number;
  recovery:'bff-local';
}
export interface RepositoryRemoveInput { confirmation:string; expectedRevision:string }
export interface RepositoryRestoreInput { confirmation:string; removalId:string; revision:number }
export interface RepositoryReadmeState {ref:string;commitId:string;path:string;content:string;canEdit:boolean}
export interface RepositoryReadmeSaveInput {ref:string;expectedCommit:string;content:string;message:string}
export interface RepositoryReadmeHistory {ref:string;headCommitId:string;path:string;items:Array<{id:string;message:string;author:string;timestamp:string;parentId?:string}>;page:number;hasMore:boolean}
export interface RepositoryReadmeDiff {commitId:string;parentId?:string;path:string;before:string;after:string}
