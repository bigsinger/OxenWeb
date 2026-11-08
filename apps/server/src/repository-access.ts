import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { DatasetCapability, RepoSummary, RepositoryAccessState, RepositoryPermissions, RepositoryRole, RepositorySettingsState, RepositoryTokenGrant, RequestIdentity } from '../../../packages/shared/src/index.js';
import type { RepoKey } from './provider.js';
import type { AuthController, TokenIdentityResolver } from './auth.js';
import { requestIdentity } from './auth.js';
import { ApiError } from './errors.js';
import { safeSegment } from './safety.js';
import { RepositorySettingsService, repositoryPatchSchema, repositoryPolicyPath, SETTINGS_WORKSPACE_PREFIX } from './repository-settings.js';
import { capabilityNames, capabilitySchema, repositoryRoleSchema, roleCapabilities } from './capabilities.js';

interface Credential { id: string; name: string; hash: string; createdAt: string; revokedAt?: string }
const credentialFileSchema = z.object({ version: z.literal(1), credentials: z.array(z.object({ id: z.string().uuid(), name: z.string(), hash: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.string(), revokedAt: z.string().optional() })) });
const digest = (token: string) => createHash('sha256').update(token).digest('hex');

export class RepositoryAccessService implements TokenIdentityResolver {
  private credentials = new Map<string, Credential>();
  private credentialChain = Promise.resolve();
  private schemaAuthorizer?: (key: RepoKey, identity: RequestIdentity) => Promise<boolean>;
  private fileAuthorizer?: (key: RepoKey, identity: RequestIdentity, filename: string) => Promise<void>;
  constructor(readonly settings: RepositorySettingsService, private filename: string, readonly localOwnerEnabled: boolean) {}
  async init() {
    try { const data = credentialFileSchema.parse(JSON.parse(await readFile(this.filename, 'utf8'))); this.credentials = new Map(data.credentials.map(item => [item.id, item])); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  private persist(): Promise<void> {
    const next = this.credentialChain.then(async () => {
      await mkdir(path.dirname(this.filename), { recursive: true });
      const temp = `${this.filename}.${randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify({ version: 1, credentials: [...this.credentials.values()] }, null, 2), { mode: 0o600 });
      await rename(temp, this.filename);
    });
    this.credentialChain = next.catch(() => {}); return next;
  }
  async resolve(token: string): Promise<RequestIdentity | undefined> {
    const match = /^oxw_([a-f0-9-]{36})\.[a-f0-9]{64}$/.exec(token);
    if (!match) return undefined;
    const credential = this.credentials.get(match[1]!);
    if (!credential || credential.revokedAt) return undefined;
    const wanted = Buffer.from(credential.hash, 'hex'), actual = Buffer.from(digest(token), 'hex');
    if (wanted.length !== actual.length || !timingSafeEqual(wanted, actual)) return undefined;
    return { id: credential.id, name: credential.name, kind: 'collaborator', source: 'bearer' };
  }
  async active(identity: RequestIdentity): Promise<boolean> {
    return identity.kind === 'owner' || (identity.kind === 'collaborator' && !!this.credentials.get(identity.id) && !this.credentials.get(identity.id)!.revokedAt);
  }
  setSchemaAuthorizer(authorizer: (key: RepoKey, identity: RequestIdentity) => Promise<boolean>) { this.schemaAuthorizer = authorizer; }
  setFileWriteAuthorizer(authorizer: (key: RepoKey, identity: RequestIdentity, filename: string) => Promise<void>) { this.fileAuthorizer = authorizer; }
  async assertFileWrite(key: RepoKey, identity: RequestIdentity, filename: string) { await this.requireCapability(key, identity, repositoryPolicyPath(filename) ? 'project.admin' : 'data.edit'); await this.fileAuthorizer?.(key, identity, filename); }
  identityDirectory() { return [...this.credentials.values()].filter(identity => !identity.revokedAt).map(({ id, name }) => ({ id, name })); }
  async permissions(key: RepoKey, identity: RequestIdentity, state?: RepositorySettingsState): Promise<RepositoryPermissions> {
    if (identity.kind === 'owner') return { read: true, write: true, admin: true, role: 'owner', capabilities: Object.fromEntries(capabilityNames.map(capability => [capability, true])) };
    const policy = (state ?? await this.settings.read(key)).policy;
    const member = identity.kind === 'collaborator' && await this.active(identity) ? policy.collaborators.find(item => item.id === identity.id) : undefined;
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
  async grant(key: RepoKey, identity: RequestIdentity, input: { name: string; role: RepositoryRole; capabilities?: DatasetCapability[]; expectedCommit?: string }): Promise<RepositoryTokenGrant> {
    await this.require(key, identity, 'admin');
    const id = randomUUID(), createdAt = new Date().toISOString(), token = `oxw_${id}.${randomBytes(32).toString('hex')}`;
    const collaborator = { id, name: input.name, role: input.role, createdAt, ...(input.capabilities ? { capabilities: input.capabilities.filter(capability => capability !== 'schema.manage') } : {}) };
    this.credentials.set(id, { id, name: input.name, hash: digest(token), createdAt });
    try {
      await this.persist();
      const settings = await this.settings.mutate(key, identity, state => ({ ...state.policy, collaborators: [...state.policy.collaborators, collaborator] }), input.expectedCommit);
      return { collaborator, token, settings };
    } catch (error) {
      const credential = this.credentials.get(id)!; credential.revokedAt = new Date().toISOString();
      await this.persist().catch(() => {}); throw error;
    }
  }
  async setRole(key: RepoKey, identity: RequestIdentity, id: string, role: RepositoryRole, expectedCommit?: string, capabilities?: DatasetCapability[]) {
    await this.require(key, identity, 'admin');
    return this.settings.mutate(key, identity, state => {
      if (!state.policy.collaborators.some(item => item.id === id)) throw new ApiError(404, 'COLLABORATOR_NOT_FOUND', 'Collaborator not found.');
      return { ...state.policy, collaborators: state.policy.collaborators.map(item => { if (item.id !== id) return item; const { capabilities: _previous, ...member } = item; return { ...member, role, ...(capabilities ? { capabilities: capabilities.filter(capability => capability !== 'schema.manage') } : {}) }; }) };
    }, expectedCommit);
  }
  async revoke(key: RepoKey, identity: RequestIdentity, id: string, expectedCommit?: string) {
    await this.require(key, identity, 'admin');
    const settings = await this.settings.mutate(key, identity, state => {
      if (!state.policy.collaborators.some(item => item.id === id)) throw new ApiError(404, 'COLLABORATOR_NOT_FOUND', 'Collaborator not found.');
      return { ...state.policy, collaborators: state.policy.collaborators.filter(item => item.id !== id) };
    }, expectedCommit);
    const credential = this.credentials.get(id);
    if (credential) { credential.revokedAt = new Date().toISOString(); await this.persist(); }
    return settings;
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
    const input = z.object({ name: z.string().trim().min(1).max(120), role: repositoryRoleSchema, capabilities: z.array(capabilitySchema).max(capabilityNames.length).optional(), expectedCommit: z.string().min(1).max(160).optional() }).strict().parse(request.body);
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
