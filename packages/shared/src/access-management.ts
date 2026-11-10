import type {RepoSummary,RepositoryRole,RequestIdentity} from './index.js';

export type InstanceAccessRole='administrator'|'auditor';
export interface AccessTokenSummary {
  id:string;actorId:string;name:string;createdAt:string;expiresAt?:string;revokedAt?:string;
  issuedBy?:string;issuedByName?:string;lastUsedAt?:string;
  scope?:{namespace:string;repo:string};globalRole?:InstanceAccessRole;
  projectRole?:RepositoryRole;customCapabilities?:boolean;
  status:'active'|'expired'|'revoked';fingerprint:string;canRevoke:boolean;canRotate:boolean;
}
export interface AccessManagementCapabilities {
  canManageInstance:boolean;canReadAudit:boolean;canManageAccess:boolean;canViewOwnTokens:boolean;localOwnerEnabled:boolean;
}
export interface AccessManagementState {
  capabilities:AccessManagementCapabilities;identity:RequestIdentity;
  repositories:Array<Pick<RepoSummary,'namespace'|'name'|'displayName'>>;
  identities:Array<{id:string;name:string}>;
  instanceIdentities?:Array<{id:string;name:string;globalRole:InstanceAccessRole}>;
  tokens:AccessTokenSummary[];roles:RepositoryRole[];
}
export interface MacroAuditEvent {
  id:string;at:string;action:string;actor:{id:string;name:string;kind:RequestIdentity['kind']};
  repository?:{namespace:string;repo:string};targetId?:string;
  details?:Record<string,string|number|boolean|null>;
}
export interface MacroAuditPage {items:MacroAuditEvent[];total:number;page:number;pageSize:number;actions:string[];retentionDays:number}
