import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { RequestIdentity } from '../../../packages/shared/src/index.js';
import type { Config } from './config.js';
import { ApiError } from './errors.js';
import { z } from 'zod';

declare module 'fastify' { interface FastifyRequest { oxenIdentity?: RequestIdentity } }
export interface TokenIdentityResolver {
  resolve(token: string): Promise<RequestIdentity | undefined>;
  active(identity: RequestIdentity): Promise<boolean>;
}
export interface AuthController {
  (request: FastifyRequest): boolean;
  identity(request: FastifyRequest): RequestIdentity;
  setTokenResolver(resolver: TokenIdentityResolver): void;
  allowPublicRepositoryReads(): void;
}
const guest = (): RequestIdentity => ({ id: 'guest', name: 'Guest', kind: 'guest', source: 'anonymous' });
const owner = (source: RequestIdentity['source']): RequestIdentity => ({ id: 'owner', name: 'Instance owner', kind: 'owner', source });
function equal(a: string, b: string): boolean {
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
function loopback(ip: string) { return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip); }
export function requestIdentity(request: FastifyRequest): RequestIdentity { return request.oxenIdentity ?? guest(); }

/** Identifies the owner and independent collaborators. Authorization is enforced per repository. */
export function installAuth(app: FastifyInstance, config: Config): AuthController {
  const sessions = new Map<string, { identity: RequestIdentity; expiry: number }>();
  const cookieName = 'oxen_session';
  let resolver: TokenIdentityResolver | undefined;
  let publicReads = false;
  const cookie = (request: FastifyRequest) => request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  const resolveToken = async (token: string): Promise<RequestIdentity | undefined> => {
    if (config.token && equal(token, config.token)) return owner('bearer');
    return resolver?.resolve(token);
  };
  const identify = async (request: FastifyRequest): Promise<RequestIdentity> => {
    const authorization = request.headers.authorization;
    if (authorization !== undefined) {
      if (!authorization.startsWith('Bearer ')) return guest();
      return await resolveToken(authorization.slice(7)) ?? guest();
    }
    const id = cookie(request);
    if (id) {
      const session = sessions.get(id);
      if (!session || session.expiry <= Date.now() || (session.identity.kind === 'collaborator' && !await resolver?.active(session.identity))) {
        sessions.delete(id); return guest();
      }
      return { ...session.identity, source: 'session' };
    }
    // Credential-bearing requests never fall back to local owner compatibility.
    if (!config.token && loopback(request.ip)) return owner('local');
    return guest();
  };
  const authenticated = ((request: FastifyRequest) => requestIdentity(request).kind !== 'guest') as AuthController;
  authenticated.identity = requestIdentity;
  authenticated.setTokenResolver = value => { resolver = value; };
  authenticated.allowPublicRepositoryReads = () => { publicReads = true; };

  app.addHook('onRequest', async request => {
    if (!request.url.startsWith('/api/')) return;
    let hostname = '';
    try { hostname = new URL(`http://${request.headers.host ?? ''}`).hostname.toLowerCase().replace(/^\[|\]$/g, ''); }
    catch { /* reject malformed hosts */ }
    if (!config.allowedHosts.includes(hostname)) throw new ApiError(403, 'HOST_REJECTED', 'This hostname is not allowed. Configure BFF_ALLOWED_HOSTS for an intended public hostname.');
    request.oxenIdentity = await identify(request);
    const pathname = request.url.split('?')[0]!;
    if (['/api/health', '/api/status', '/api/session'].includes(pathname)) return;
    const isRead = ['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    const datasetReadPost = request.method === 'POST' && /^\/api\/repos\/[^/]+\/[^/]+\/dataset\/query$/.test(pathname);
    const publicRepositoryRead = publicReads && (isRead && (pathname === '/api/repos' || pathname.startsWith('/api/repos/') || pathname === '/api/capabilities') || datasetReadPost);
    if (!authenticated(request) && !publicRepositoryRead) throw new ApiError(401, 'AUTH_REQUIRED', 'Sign in with an instance owner or collaborator access token.');
    if (!isRead && requestIdentity(request).source !== 'bearer') {
      const origin = request.headers.origin;
      if (origin) {
        let originHost = '';
        try { originHost = new URL(origin).host; } catch { /* reject malformed origins */ }
        if (originHost !== request.headers.host) throw new ApiError(403, 'ORIGIN_REJECTED', 'Cross-origin writes are not allowed.');
      }
      if (request.headers['x-oxen-request'] !== 'web') throw new ApiError(403, 'CSRF_REJECTED', 'Missing request protection header.');
    }
  });

  app.get('/api/session', async request => ({ required: !!config.token, authenticated: authenticated(request), identity: requestIdentity(request), localOwnerEnabled: !config.token }));
  app.post('/api/session', async (request, reply) => {
    if (request.headers.origin) {
      let host = '';
      try { host = new URL(request.headers.origin).host; } catch { /* reject malformed origins */ }
      if (host !== request.headers.host) throw new ApiError(403, 'ORIGIN_REJECTED', 'Cross-origin sign-in is not allowed.');
    }
    const { token } = z.object({ token: z.string().max(4096) }).parse(request.body);
    const identity = token ? await resolveToken(token) : (!config.token && loopback(request.ip) ? owner('local') : undefined);
    if (!identity) throw new ApiError(401, 'INVALID_TOKEN', 'Incorrect or revoked access token.');
    const now = Date.now();
    for (const [id, session] of sessions) if (session.expiry < now) sessions.delete(id);
    if (sessions.size >= 1000) throw new ApiError(429, 'SESSION_LIMIT', 'Session capacity reached.');
    const id = randomBytes(32).toString('hex');
    sessions.set(id, { identity, expiry: now + 8 * 60 * 60 * 1000 });
    reply.header('Set-Cookie', `${cookieName}=${id}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=28800${config.secureCookies ? '; Secure' : ''}`);
    return { authenticated: true, identity: { ...identity, source: 'session' } };
  });
  app.delete('/api/session', async (request, reply) => {
    const id = cookie(request);
    if (id) sessions.delete(id);
    reply.header('Set-Cookie', `${cookieName}=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0${config.secureCookies ? '; Secure' : ''}`);
    return { authenticated: false, identity: guest() };
  });
  return authenticated;
}
