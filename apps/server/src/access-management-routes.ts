import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {requestIdentity} from './auth.js';
import {ApiError} from './errors.js';
import type {RepositoryAccessService} from './repository-access.js';
import {capabilityNames,capabilitySchema,repositoryRoleSchema} from './capabilities.js';
import {safeSegment} from './safety.js';
import {auditQuerySchema,type GlobalAuditService} from './global-audit.js';

const expiry=z.string().datetime().optional(),id=z.string().uuid(),project=z.object({namespace:z.string().transform(safeSegment),repo:z.string().transform(safeSegment)}).strict();
const grantSchema=z.discriminatedUnion('scope',[
  z.object({scope:z.literal('project'),repository:project,name:z.string().trim().min(1).max(120).optional(),existingActorId:z.string().uuid().optional(),role:repositoryRoleSchema,capabilities:z.array(capabilitySchema).max(capabilityNames.length).optional(),expectedCommit:z.string().min(1).max(160).optional(),expiresAt:expiry}).strict().refine(value=>!!value.existingActorId||!!value.name,'请选择已有人员或填写新人员名称。'),
  z.object({scope:z.literal('instance'),name:z.string().trim().min(1).max(120).optional(),existingActorId:z.string().uuid().optional(),globalRole:z.enum(['administrator','auditor']),expiresAt:expiry}).strict().refine(value=>!!value.existingActorId||!!value.name,'请选择已有实例人员或填写新人员名称。'),
]);

/** Local BFF extensions. No raw-token listing, and no upstream ACL claims. */
export function registerAccessManagementRoutes(app:FastifyInstance,options:{access:RepositoryAccessService;audit:GlobalAuditService}){
  const {access,audit}=options;
  app.get('/api/access-management/capabilities',async request=>access.managementCapabilities(requestIdentity(request)));
  app.get('/api/access-management',async request=>{
    const identity=requestIdentity(request),capabilities=await access.managementCapabilities(identity);if(!capabilities.canManageAccess)throw new ApiError(403,'ACCESS_MANAGEMENT_REQUIRED','此页面仅向实例管理员或项目权限管理员开放。');
    return {capabilities,identity,repositories:await access.manageableRepositories(identity),identities:await access.assignableIdentities(identity),instanceIdentities:access.assignableInstanceIdentities(identity),tokens:await access.tokenSummaries(identity,capabilities.canManageInstance),roles:['viewer','annotator','editor','reviewer','lead','admin']};
  });
  app.get('/api/me/access-tokens',async request=>{
    const identity=requestIdentity(request);if(identity.kind==='guest')throw new ApiError(401,'AUTH_REQUIRED','请先登录。');
    return {identity,capabilities:await access.managementCapabilities(identity),tokens:await access.tokenSummaries(identity),repositories:[],identities:[],instanceIdentities:[],roles:[]};
  });
  app.post('/api/access-management/grants',async(request,reply)=>{
    const identity=requestIdentity(request),input=grantSchema.parse(request.body);
    const result=input.scope==='instance'?await access.grantInstance(identity,input):await access.grant(input.repository,identity,input);
    reply.code(201);return result;
  });
  app.post('/api/me/access-tokens/:id/revoke',async request=>access.revokeToken(requestIdentity(request),id.parse((request.params as {id:string}).id)));
  app.post('/api/me/access-tokens/:id/rotate',async request=>access.rotateToken(requestIdentity(request),id.parse((request.params as {id:string}).id),z.object({expiresAt:expiry}).strict().parse(request.body??{})));
  app.get('/api/audit-events',async request=>{if(!access.canReadAudit(requestIdentity(request)))throw new ApiError(403,'AUDIT_READ_REQUIRED','仅实例管理员和授权审计人员可以查看全局操作日志。');return audit.page(auditQuerySchema.parse(request.query));});
}
