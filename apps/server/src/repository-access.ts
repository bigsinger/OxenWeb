import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { DatasetCapability, RepoSummary, RepositoryAccessState, RepositoryPermissions, RepositoryRole, RepositorySettingsState, RepositoryTokenGrant, RequestIdentity } from '../../../packages/shared/src/index.js';
import type { RepoKey } from './provider.js';
import type { AuthController, TokenIdentityResolver } from './auth.js';
import { requestIdentity } from './auth.js';
import { ApiError } from './errors.js';
import { safeSegment } from './safety.js';
import { RepositorySettingsService, repositoryPatchSchema, repositoryPolicyPath, SETTINGS_WORKSPACE_PREFIX } from './repository-settings.js';
import { durableWriteJson } from './durable-store.js';
import type {AccessTokenSummary,InstanceAccessRole,AccessManagementCapabilities} from '../../../packages/shared/src/access-management.js';
import type {GlobalAuditService} from './global-audit.js';
import { capabilityNames, capabilitySchema, repositoryRoleSchema, roleCapabilities } from './capabilities.js';

interface Credential { id:string;name:string;hash:string;createdAt:string;revokedAt?:string;actorId?:string;issuedBy?:string;issuedByName?:string;expiresAt?:string;lastUsedAt?:string;scope?:RepoKey;globalRole?:InstanceAccessRole }
const credentialFileSchema=z.object({version:z.literal(1),credentials:z.array(z.object({id:z.string().uuid(),name:z.string().max(120),hash:z.string().regex(/^[a-f0-9]{64}$/),createdAt:z.string(),revokedAt:z.string().optional(),actorId:z.string().uuid().optional(),issuedBy:z.string().max(160).optional(),issuedByName:z.string().max(120).optional(),expiresAt:z.string().datetime().optional(),lastUsedAt:z.string().datetime().optional(),scope:z.object({namespace:z.string(),repo:z.string()}).optional(),globalRole:z.enum(['administrator','auditor']).optional()}).strict())}).strict();
const actorId=(credential:Credential)=>credential.actorId??credential.id;
const credentialUsable=(credential:Credential|undefined):credential is Credential=>!!credential&&!credential.revokedAt&&(!credential.expiresAt||Date.parse(credential.expiresAt)>Date.now());
const digest = (token: string) => createHash('sha256').update(token).digest('hex');

export class RepositoryAccessService implements TokenIdentityResolver {
  private credentials = new Map<string, Credential>();
  private credentialChain = Promise.resolve();
  private schemaAuthorizer?: (key: RepoKey, identity: RequestIdentity) => Promise<boolean>;
  private fileAuthorizer?: (key: RepoKey, identity: RequestIdentity, filename: string) => Promise<void>;
  private audit?:Pick<GlobalAuditService,'record'>;
  constructor(readonly settings: RepositorySettingsService, private filename: string, readonly localOwnerEnabled: boolean) {settings.setWriteAuthorizer(async(key,identity)=>{await this.require(key,identity,'admin');});}
  async init() {
    try { const data = credentialFileSchema.parse(JSON.parse(await readFile(this.filename, 'utf8'))); this.credentials = new Map(data.credentials.map(item => [item.id, item])); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await this.hydrateLegacyScopes();
  }
  private async hydrateLegacyScopes(){
    const missing=[...this.credentials.values()].filter(credential=>!credential.scope&&!credential.globalRole&&!credential.revokedAt);if(!missing.length)return;
    const memberships=new Map<string,RepoKey[]>();for(const repository of await this.settings.provider.repos()){const key={namespace:repository.namespace,repo:repository.name},state=await this.settings.read(key);for(const member of state.policy.collaborators){const scopes=memberships.get(member.id)??[];scopes.push(key);memberships.set(member.id,scopes);}}
    let changed=false;for(const credential of missing){const scopes=memberships.get(actorId(credential))??[];if(scopes.length===1){credential.scope=scopes[0];changed=true;}}if(changed)await this.persist();
  }
  setAuditRecorder(audit:Pick<GlobalAuditService,'record'>){this.audit=audit;}
  private persist(): Promise<void> {
    const next = this.credentialChain.then(async () => {
      await durableWriteJson(this.filename,{version:1,credentials:[...this.credentials.values()]});
    });
    this.credentialChain = next.catch(() => {}); return next;
  }
  async resolve(token: string): Promise<RequestIdentity | undefined> {
    const match = /^oxw_([a-f0-9-]{36})\.[a-f0-9]{64}$/.exec(token);
    if (!match) return undefined;
    const credential = this.credentials.get(match[1]!);
    if (!credentialUsable(credential)) return undefined;
    const wanted = Buffer.from(credential.hash, 'hex'), actual = Buffer.from(digest(token), 'hex');
    if (wanted.length !== actual.length || !timingSafeEqual(wanted, actual)) return undefined;
    return {id:actorId(credential!),name:credential!.name,kind:credential!.globalRole==='administrator'?'owner':'collaborator',source:'bearer',credentialId:credential!.id};
  }
  async active(identity:RequestIdentity):Promise<boolean>{
    if(identity.kind==='owner'&&identity.id==='owner'&&!identity.credentialId)return true;
    return !!this.identityCredential(identity);
  }
  private identityCredential(identity:RequestIdentity){const matching=(credential:Credential|undefined)=>credentialUsable(credential)&&actorId(credential)===identity.id&&(credential.globalRole==='administrator'?'owner':'collaborator')===identity.kind;const credential=identity.credentialId?this.credentials.get(identity.credentialId):[...this.credentials.values()].find(matching);return matching(credential)?credential:undefined;}
  isInstanceAdmin(identity:RequestIdentity){return identity.kind==='owner'&&(identity.id==='owner'&&!identity.credentialId||this.identityCredential(identity)?.globalRole==='administrator');}
  canReadAudit(identity:RequestIdentity){return this.isInstanceAdmin(identity)||this.identityCredential(identity)?.globalRole==='auditor';}
  private expiry(value?:string){const now=Date.now(),expires=value??new Date(now+90*86400000).toISOString();if(!Number.isFinite(Date.parse(expires))||Date.parse(expires)<=now||Date.parse(expires)>now+366*86400000)throw new ApiError(400,'TOKEN_EXPIRY_INVALID','令牌到期时间必须在未来366天内。');return expires;}
  async managementCapabilities(identity:RequestIdentity):Promise<AccessManagementCapabilities>{
    const instance=this.isInstanceAdmin(identity),repositories=identity.kind==='guest'?[]:await this.manageableRepositories(identity);
    return {canManageInstance:instance,canReadAudit:this.canReadAudit(identity),canManageAccess:instance||repositories.length>0,canViewOwnTokens:identity.kind!=='guest',localOwnerEnabled:this.localOwnerEnabled};
  }
  async manageableRepositories(identity:RequestIdentity){const repositories=await this.settings.provider.repos(),visible=[];for(const repository of repositories){const key={namespace:repository.namespace,repo:repository.name};if((await this.permissions(key,identity)).admin)visible.push({namespace:repository.namespace,name:repository.name,displayName:repository.displayName});}return visible;}
  private sameCredentialScope(identity:RequestIdentity,credential:Credential){const current=this.identityCredential(identity);if(!current)return false;if(current.globalRole==='administrator')return true;if(current.scope||credential.scope)return !!current.scope&&!!credential.scope&&current.scope.namespace===credential.scope.namespace&&current.scope.repo===credential.scope.repo;return current.globalRole==='auditor'&&credential.globalRole==='auditor';}
  private async mayManageCredential(identity:RequestIdentity,credential:Credential){
    if(this.isInstanceAdmin(identity))return true;
    if(!this.sameCredentialScope(identity,credential))return false;
    if(identity.id===actorId(credential))return await this.active(identity);
    if(credential.issuedBy!==identity.id||credential.globalRole||!credential.scope)return false;
    return (await this.permissions(credential.scope,identity)).admin;
  }
  async tokenSummaries(identity:RequestIdentity,all=false):Promise<AccessTokenSummary[]>{
    if(all&&!this.isInstanceAdmin(identity))throw new ApiError(403,'INSTANCE_ADMIN_REQUIRED','只有实例管理员可查看全部令牌。');
    const result:AccessTokenSummary[]=[],settingsCache=new Map<string,Promise<RepositorySettingsState>>();
    for(const credential of this.credentials.values()){
      if(!all&&(credential.issuedBy!==identity.id&&actorId(credential)!==identity.id||!this.isInstanceAdmin(identity)&&!this.sameCredentialScope(identity,credential)))continue;
      const manageable=await this.mayManageCredential(identity,credential);
      let membership:{role:RepositoryRole;capabilities?:DatasetCapability[]}|undefined;if(credential.scope){const key=credential.scope.namespace+'/'+credential.scope.repo;if(!settingsCache.has(key))settingsCache.set(key,this.settings.read(credential.scope));try{membership=(await settingsCache.get(key)!).policy.collaborators.find(person=>person.id===actorId(credential));}catch(error){if(!(error instanceof ApiError&&error.status===404))throw error;}}
      result.push({id:credential.id,actorId:actorId(credential),name:credential.name,createdAt:credential.createdAt,...(credential.expiresAt?{expiresAt:credential.expiresAt}:{}),...(credential.revokedAt?{revokedAt:credential.revokedAt}:{}),...(credential.issuedBy?{issuedBy:credential.issuedBy,issuedByName:credential.issuedByName}:{}),...(credential.lastUsedAt?{lastUsedAt:credential.lastUsedAt}:{}),...(credential.scope?{scope:credential.scope}:{}),...(membership?{projectRole:membership.role,customCapabilities:!!membership.capabilities}:{}),...(credential.globalRole?{globalRole:credential.globalRole}:{}),status:credential.revokedAt?'revoked':credentialUsable(credential)?'active':'expired',fingerprint:credential.id.slice(0,8),canRevoke:manageable&&!credential.revokedAt,canRotate:manageable&&credentialUsable(credential)});
    }
    return result.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id));
  }
  assignableInstanceIdentities(identity:RequestIdentity){
    if(!this.isInstanceAdmin(identity))return [];
    return [...new Map([...this.credentials.values()].filter(credential=>!!credential.globalRole).map(credential=>[actorId(credential),{id:actorId(credential),name:credential.name,globalRole:credential.globalRole!}])).values()];
  }
  async grantInstance(identity:RequestIdentity,input:{name?:string;existingActorId?:string;globalRole:InstanceAccessRole;expiresAt?:string}){
    if(!this.isInstanceAdmin(identity))throw new ApiError(403,'INSTANCE_ADMIN_REQUIRED','仅实例管理员可发放实例管理或审计权限。');
    const existing=input.existingActorId?this.assignableInstanceIdentities(identity).find(person=>person.id===input.existingActorId):undefined;
    if(input.existingActorId&&!existing)throw new ApiError(403,'INSTANCE_IDENTITY_UNKNOWN','只能为实例目录中已有的管理或审计人员重新发放实例令牌。');
    if(existing&&existing.globalRole!==input.globalRole)throw new ApiError(409,'INSTANCE_IDENTITY_ROLE_MISMATCH','已有实例人员必须保留原实例角色；不能通过重发令牌迁移其身份类型。');
    const id=randomUUID(),personId=existing?.id??id,name=existing?.name??input.name?.trim();
    if(!name||name.length>120)throw new ApiError(400,'IDENTITY_NAME_REQUIRED','请选择已有实例人员或填写新人员名称。');
    const token=`oxw_${id}.${randomBytes(32).toString('hex')}`,credential:Credential={id,...(personId!==id?{actorId:personId}:{}),name,hash:digest(token),createdAt:new Date().toISOString(),expiresAt:this.expiry(input.expiresAt),issuedBy:identity.id,issuedByName:identity.name,globalRole:existing?.globalRole??input.globalRole};
    this.credentials.set(id,credential);try{await this.persist();if(!this.isInstanceAdmin(identity))throw new ApiError(403,'INSTANCE_ADMIN_REQUIRED','发放者的实例权限已撤销。');}catch(error){credential.revokedAt=new Date().toISOString();await this.persist().catch(()=>{});throw error;}
    await this.audit?.record({action:'identity.granted',actor:identity,targetId:personId,details:{role:credential.globalRole!,credentialId:id}});
    return {token,credential:(await this.tokenSummaries(identity,true)).find(item=>item.id===id)!};
  }
  async revokeToken(identity:RequestIdentity,id:string){
    const credential=this.credentials.get(id);if(!credential)throw new ApiError(404,'ACCESS_TOKEN_NOT_FOUND','没有该访问令牌。');
    if(!await this.mayManageCredential(identity,credential))throw new ApiError(403,'TOKEN_MANAGE_REQUIRED','只能管理本人或仍有管理权限的已发放令牌。');
    if(!credential.revokedAt){credential.revokedAt=new Date().toISOString();await this.persist();await this.audit?.record({action:'token.revoked',actor:identity,...(credential.scope?{repository:credential.scope}:{}),targetId:id,details:{role:credential.globalRole??'project'}});}
    return {id,revokedAt:credential.revokedAt};
  }
  async rotateToken(identity:RequestIdentity,id:string,input:{expiresAt?:string}={}){
    const previous=this.credentials.get(id);if(!previous||!credentialUsable(previous))throw new ApiError(409,'TOKEN_NOT_ACTIVE','只能轮换仍有效的令牌。');
    if(!await this.mayManageCredential(identity,previous))throw new ApiError(403,'TOKEN_MANAGE_REQUIRED','没有该令牌的管理权限。');
    const nextId=randomUUID(),token=`oxw_${nextId}.${randomBytes(32).toString('hex')}`,createdAt=new Date().toISOString(),credential:Credential={...previous,id:nextId,actorId:actorId(previous),hash:digest(token),createdAt,expiresAt:this.expiry(input.expiresAt)};
    delete credential.revokedAt;delete credential.lastUsedAt;previous.revokedAt=createdAt;this.credentials.set(nextId,credential);
    try{await this.persist();}catch(error){this.credentials.delete(nextId);throw error;}
    await this.audit?.record({action:'token.rotated',actor:identity,...(credential.scope?{repository:credential.scope}:{}),targetId:nextId,details:{previousCredentialId:id,actorId:actorId(credential)}});
    const viewer=identity.credentialId===id?(await this.resolve(token))!:identity;return {token,credential:(await this.tokenSummaries(viewer,this.isInstanceAdmin(viewer))).find(item=>item.id===nextId)!};
  }
  setSchemaAuthorizer(authorizer: (key: RepoKey, identity: RequestIdentity) => Promise<boolean>) { this.schemaAuthorizer = authorizer; }
  setFileWriteAuthorizer(authorizer: (key: RepoKey, identity: RequestIdentity, filename: string) => Promise<void>) { this.fileAuthorizer = authorizer; }
  async assertFileWrite(key: RepoKey, identity: RequestIdentity, filename: string) { await this.requireCapability(key, identity, repositoryPolicyPath(filename) ? 'project.admin' : 'data.edit'); await this.fileAuthorizer?.(key, identity, filename); }
  identityDirectory(){return [...new Map([...this.credentials.values()].filter(credentialUsable).map(credential=>[actorId(credential),{id:actorId(credential),name:credential.name}])).values()];}
  async permissions(key: RepoKey, identity: RequestIdentity, state?: RepositorySettingsState): Promise<RepositoryPermissions> {
    if(identity.kind==='owner'&&identity.credentialId&&!await this.active(identity))return {read:false,write:false,admin:false,role:null,capabilities:{}};
    if (identity.kind === 'owner') return { read: true, write: true, admin: true, role: 'owner', capabilities: Object.fromEntries(capabilityNames.map(capability => [capability, true])) };
    const policy = (state ?? await this.settings.read(key)).policy;
    const credential=this.identityCredential(identity),withinScope=identity.credentialId?!!credential?.scope&&credential.scope.namespace===key.namespace&&credential.scope.repo===key.repo:[...this.credentials.values()].some(item=>credentialUsable(item)&&actorId(item)===identity.id&&item.scope?.namespace===key.namespace&&item.scope?.repo===key.repo);
    const member = identity.kind === 'collaborator' && await this.active(identity) && withinScope ? policy.collaborators.find(item => item.id === identity.id) : undefined;
    const role = member?.role ?? (policy.visibility === 'public' ? 'guest' : null);
    const granted = new Set<DatasetCapability>(role === null ? [] : member?.capabilities ?? roleCapabilities[role]);
    if (role !== null) granted.add('read');
    // Organization governance is independent from all repository role presets/overrides.
    granted.delete('schema.manage');
    if (role !== null && this.schemaAuthorizer && await this.schemaAuthorizer(key, identity)) granted.add('schema.manage');
    const capabilities = Object.fromEntries(capabilityNames.map(capability => [capability, granted.has(capability)]));
    return { read: granted.has('read'), write: [...granted].some(capability => !['read', 'data.export'].includes(capability)), admin: granted.has('project.admin'), role, capabilities };
  }
  async requireCapability(key: RepoKey, identity: RequestIdentity, capability: DatasetCapability): Promise<RepositoryPermissions> {
    const permissions = await this.permissions(key, identity);
    if (!permissions.read || permissions.capabilities?.[capability] !== true) throw new ApiError(identity.kind === 'guest' ? 401 : 403, 'CAPABILITY_REQUIRED', `This operation requires ${capability}.`);
    return permissions;
  }
  async require(key: RepoKey, identity: RequestIdentity, operation: 'read' | 'write' | 'admin'): Promise<RepositoryPermissions> {
    const permissions = await this.permissions(key, identity);
    if (!permissions[operation]) throw new ApiError(identity.kind === 'guest' ? 401 : 403, 'REPOSITORY_ACCESS_DENIED', `This identity cannot ${operation === 'admin' ? 'administer' : operation} this repository.`);
    return permissions;
  }
  async filterRepositories(identity: RequestIdentity, repositories: RepoSummary[]): Promise<RepoSummary[]> {
    const visible: RepoSummary[] = [];
    for (const repo of repositories) {
      const key = { namespace: repo.namespace, repo: repo.name }, state = await this.settings.read(key);
      if ((await this.permissions(key, identity, state)).read) visible.push({ ...repo, displayName:state.policy.displayName??repo.name,description: state.policy.description, tags: state.policy.tags, defaultBranch: state.policy.defaultBranch, visibility: state.policy.visibility });
    }
    return visible;
  }
  async state(key: RepoKey, identity: RequestIdentity): Promise<RepositoryAccessState> {
    const settings = await this.settings.read(key), permissions = await this.permissions(key, identity, settings);
    if (!permissions.admin) throw new ApiError(403, 'REPOSITORY_ADMIN_REQUIRED', 'Only a repository administrator can manage collaborators.');
    return { collaborators: settings.policy.collaborators, permissions, configurationBranch: settings.configurationBranch, commitId: settings.commitId, localOwnerEnabled: this.localOwnerEnabled, enforcement: 'bff' };
  }
  async assignableIdentities(identity:RequestIdentity){
    const known=[...new Map([...this.credentials.values()].map(credential=>[actorId(credential),{id:actorId(credential),name:credential.name}])).values()];
    if(this.isInstanceAdmin(identity))return known;
    const allowed=new Set<string>([identity.id]);for(const repository of await this.manageableRepositories(identity)){const state=await this.settings.read({namespace:repository.namespace,repo:repository.name});for(const member of state.policy.collaborators)allowed.add(member.id);}return known.filter(person=>allowed.has(person.id));
  }
  async grant(key:RepoKey,identity:RequestIdentity,input:{name?:string;existingActorId?:string;role:RepositoryRole;capabilities?:DatasetCapability[];expectedCommit?:string;expiresAt?:string}):Promise<RepositoryTokenGrant>{
    await this.require(key,identity,'admin');
    const state=await this.settings.read(key);if(input.expectedCommit&&state.commitId!==input.expectedCommit)throw new ApiError(409,'SETTINGS_CONFLICT','Repository settings changed. Reload before saving.');
    const existing=input.existingActorId?(await this.assignableIdentities(identity)).find(person=>person.id===input.existingActorId):undefined;
    if(input.existingActorId&&!existing)throw new ApiError(403,'IDENTITY_ASSIGNMENT_DENIED','只能为管理范围内已有的人员继续授权。');
    const id=randomUUID(),personId=existing?.id??id,name=existing?.name??input.name,createdAt=new Date().toISOString(),token=`oxw_${id}.${randomBytes(32).toString('hex')}`;
    if(!name?.trim()||name.length>120)throw new ApiError(400,'IDENTITY_NAME_REQUIRED','请填写人员显示名称或选择已有人员。');
    const prior=state.policy.collaborators.find(member=>member.id===personId),collaborator={id:personId,name,role:input.role,createdAt:prior?.createdAt??createdAt,...(input.capabilities?{capabilities:input.capabilities.filter(capability=>capability!=='schema.manage')}:{})};
    this.credentials.set(id,{id,...(personId!==id?{actorId:personId}:{}),name,hash:digest(token),createdAt,expiresAt:this.expiry(input.expiresAt),issuedBy:identity.id,issuedByName:identity.name,scope:{...key}});
    try{
      await this.persist();
      const latest=await this.settings.read(key);if(input.expectedCommit&&latest.commitId!==input.expectedCommit)throw new ApiError(409,'SETTINGS_CONFLICT','Repository settings changed. Reload before saving.');
      const unchanged=JSON.stringify(latest.policy.collaborators.find(member=>member.id===personId))===JSON.stringify(collaborator);
      let settings:RepositorySettingsState;
      if(unchanged){await this.require(key,identity,'admin');settings=latest;}
      else settings=await this.settings.mutate(key,identity,current=>({...current.policy,collaborators:[...current.policy.collaborators.filter(member=>member.id!==personId),collaborator]}),input.expectedCommit);
      await this.audit?.record({action:'access.granted',actor:identity,repository:key,targetId:personId,details:{role:input.role,commitId:settings.commitId,credentialId:id}});return {collaborator,token,settings};
    }catch(error){this.credentials.get(id)!.revokedAt=new Date().toISOString();await this.persist().catch(()=>{});throw error;}
  }
  async setRole(key: RepoKey, identity: RequestIdentity, id: string, role: RepositoryRole, expectedCommit?: string, capabilities?: DatasetCapability[]) {
    await this.require(key, identity, 'admin');
    const settings=await this.settings.mutate(key, identity, state => {
      if (!state.policy.collaborators.some(item => item.id === id)) throw new ApiError(404, 'COLLABORATOR_NOT_FOUND', 'Collaborator not found.');
      return { ...state.policy, collaborators: state.policy.collaborators.map(item => { if (item.id !== id) return item; const { capabilities: _previous, ...member } = item; return { ...member, role, ...(capabilities ? { capabilities: capabilities.filter(capability => capability !== 'schema.manage') } : {}) }; }) };
    }, expectedCommit);
    await this.audit?.record({action:'access.role_changed',actor:identity,repository:key,targetId:id,details:{role,commitId:settings.commitId}});return settings;
  }
  async revoke(key: RepoKey, identity: RequestIdentity, id: string, expectedCommit?: string) {
    await this.require(key, identity, 'admin');
    const settings = await this.settings.mutate(key, identity, state => {
      if (!state.policy.collaborators.some(item => item.id === id)) throw new ApiError(404, 'COLLABORATOR_NOT_FOUND', 'Collaborator not found.');
      return { ...state.policy, collaborators: state.policy.collaborators.filter(item => item.id !== id) };
    }, expectedCommit);
    let revoked=false;for(const credential of this.credentials.values())if(actorId(credential)===id&&credential.scope?.namespace===key.namespace&&credential.scope?.repo===key.repo){credential.revokedAt=new Date().toISOString();revoked=true;}if(revoked)await this.persist();
    await this.audit?.record({action:'access.revoked',actor:identity,repository:key,targetId:id,details:{commitId:settings.commitId}});return settings;
  }
}

const keyFromRequest = (request: FastifyRequest): RepoKey | undefined => {
  const match = /^\/api\/repos\/([^/]+)\/([^/?]+)(?:\/|$)/.exec(request.url.split('?')[0]!);
  if (!match) return undefined;
  try { return { namespace: safeSegment(decodeURIComponent(match[1]!)), repo: safeSegment(decodeURIComponent(match[2]!)) }; }
  catch { throw new ApiError(400, 'INVALID_REPOSITORY', 'Invalid repository path.'); }
};
export async function assertRepositoryFileWrite(request: FastifyRequest, key: RepoKey, filename: string, access: RepositoryAccessService) {
  await access.assertFileWrite(key, requestIdentity(request), filename);
}

/** Install after installAuth, before route registration. Protects all repository routes. */
export function installRepositoryAccess(app: FastifyInstance, access: RepositoryAccessService, auth: AuthController) {
  auth.setTokenResolver(access); auth.allowPublicRepositoryReads();
  app.addHook('onRequest', async request => {
    const pathname = request.url.split('?')[0]!;
    if (pathname === '/api/repos' && !['GET', 'HEAD'].includes(request.method) && requestIdentity(request).kind !== 'owner') throw new ApiError(403, 'OWNER_REQUIRED', 'Only the instance owner can create repositories.');
    const key = keyFromRequest(request); if (!key) return;
    const tail = pathname.replace(/^\/api\/repos\/[^/]+\/[^/]+/, '');
    const administration = (/^\/(access|settings)(\/|$)/.test(tail) && !['GET', 'HEAD'].includes(request.method)) || (tail === '' && request.method === 'PATCH');
    const readPost = request.method === 'POST' && (tail === '/query' || tail === '/schema/feedback' || tail === '/dataset/draft/query' || tail === '/dataset/draft/discard' || /^\/datasets?\/(query|search|read)(\/|$)/.test(tail) || /^\/snapshots(\/|$)/.test(tail));
    // Opaque owner-isolated recovery files do not mutate repository content. Their
    // service checks creation capabilities; read-only users can retain existing input.
    const privateUiState=tail==='/dataset/ui-state'&&['GET','PUT','DELETE'].includes(request.method);
    const operation = administration || /^\/access(\/|$)/.test(tail) ? 'admin' : ['GET', 'HEAD', 'OPTIONS'].includes(request.method) || readPost || privateUiState ? 'read' : 'write';
    await access.require(key, requestIdentity(request), operation);
  });
  app.addHook('preValidation', async request => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
    if (request.method === 'POST' && request.url.split('?')[0]!.endsWith('/query')) return;
    const key = keyFromRequest(request); if (!key) return;
    const identity = requestIdentity(request), permissions = await access.permissions(key, identity);
    if (permissions.admin) return;
    const body = request.body as { path?: unknown; source?: unknown; target?: unknown } | undefined;
    if (typeof body?.path === 'string') await assertRepositoryFileWrite(request, key, body.path, access);
    const workspace = /\/workspaces\/([^/?]+)(?:\/|$)/.exec(request.url);
    if (workspace) {
      const state = await access.settings.provider.workspace(key, decodeURIComponent(workspace[1]!));
      if (state.name.startsWith(SETTINGS_WORKSPACE_PREFIX) || state.changes.some(change => repositoryPolicyPath(change.path))) throw new ApiError(403, 'POLICY_ADMIN_REQUIRED', 'Only administrators can change or commit the repository policy.');
    }
    if (request.url.split('?')[0]!.endsWith('/merge') && typeof body?.source === 'string' && typeof body?.target === 'string') {
      const changes = await access.settings.provider.diff(key, body.target, body.source);
      if (changes.some(change => repositoryPolicyPath(change.path))) throw new ApiError(403, 'POLICY_ADMIN_REQUIRED', 'This merge changes the repository policy and requires an administrator.');
    }
  });
  app.addHook('preSerialization', async (request, reply, payload) => {
    if (request.method === 'GET' && request.url.split('?')[0] === '/api/repos' && reply.statusCode < 400 && Array.isArray(payload)) {
      const repositories = await access.filterRepositories(requestIdentity(request), payload as RepoSummary[]);
      return repositories;
    }
    return payload;
  });
}

/** Independent BFF control-plane routes; never call private SaaS APIs. */
export function registerRepositoryControl(app: FastifyInstance, options: { settings: RepositorySettingsService; access: RepositoryAccessService }) {
  const { settings, access } = options;
  const key = (request: FastifyRequest) => keyFromRequest(request)!;
  const base = '/api/repos/:namespace/:repo';
  app.get(`${base}/settings`, async request => {
    const state = await settings.read(key(request));
    return { ...state, permissions: await access.permissions(key(request), requestIdentity(request), state) };
  });
  app.patch(`${base}/settings`, async request => {
    await access.require(key(request), requestIdentity(request), 'admin');
    const state = await settings.update(key(request), repositoryPatchSchema.parse(request.body), requestIdentity(request));
    return { ...state, permissions: await access.permissions(key(request), requestIdentity(request), state) };
  });
  app.get(`${base}/access`, async request => access.state(key(request), requestIdentity(request)));
  app.post(`${base}/access`, async (request, reply) => {
    const input = z.object({ name: z.string().trim().min(1).max(120), role: repositoryRoleSchema, capabilities: z.array(capabilitySchema).max(capabilityNames.length).optional(), expectedCommit: z.string().min(1).max(160).optional(),expiresAt:z.string().datetime().optional() }).strict().parse(request.body);
    const result = await access.grant(key(request), requestIdentity(request), input); reply.code(201); return result;
  });
  app.patch(`${base}/access/:id`, async request => {
    const input = z.object({ role: repositoryRoleSchema, capabilities: z.array(capabilitySchema).max(capabilityNames.length).optional(), expectedCommit: z.string().min(1).max(160).optional() }).strict().parse(request.body);
    return access.setRole(key(request), requestIdentity(request), z.string().uuid().parse((request.params as { id: string }).id), input.role, input.expectedCommit, input.capabilities);
  });
  app.delete(`${base}/access/:id`, async request => {
    const query = z.object({ expectedCommit: z.string().min(1).max(160).optional() }).parse(request.query);
    return access.revoke(key(request), requestIdentity(request), z.string().uuid().parse((request.params as { id: string }).id), query.expectedCommit);
  });
}
