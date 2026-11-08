import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requestIdentity } from './auth.js';
import { ApiError } from './errors.js';
import { MergeResolutionService, type MergeResolutionOptions } from './merge-resolution.js';
import type { RepositoryAccessService } from './repository-access.js';
import { safeFilePath, safeRef, safeSegment } from './safety.js';

const reference=z.string().min(1).max(160).transform(safeRef);
export const resolutionRequestSchema=z.object({source:reference,target:reference,base:reference.optional(),expectedSourceCommitId:reference,expectedTargetCommitId:reference,fingerprint:z.string().regex(/^[a-f0-9]{64}$/),resolutions:z.array(z.object({path:z.string().transform(safeFilePath),choice:z.enum(['source','target','fields','manual']),fields:z.array(z.object({pointer:z.string().max(4000),choice:z.enum(['source','target'])}).strict()).max(500).optional(),content:z.string().max(1024*1024).optional()}).strict()).min(1).max(100)}).strict();
export function registerMergeResolutionRoutes(app:FastifyInstance,options:MergeResolutionOptions&{access:RepositoryAccessService}){
  const service=new MergeResolutionService({...options,beforeResolve:async(key,identity,preview)=>{await options.access.requireCapability(key,identity,'merge.execute');if((await options.access.settings.read(key)).policy.defaultBranch===preview.source)throw new ApiError(403,'RESOLUTION_SOURCE_PROTECTED','请在工作分支解决冲突后重新复核，不能通过此操作直接改写默认分支。');await options.beforeResolve?.(key,identity,preview);}});
  const base='/api/repos/:namespace/:repo/merge-resolution';const key=(value:unknown)=>z.object({namespace:z.string().transform(safeSegment),repo:z.string().transform(safeSegment)}).parse(value);
  app.get(base+'/compare',async request=>{const repository=key(request.params);await options.access.requireCapability(repository,requestIdentity(request),'read');const q=z.object({source:reference,target:reference,base:reference.optional()}).parse(request.query);const preview=await service.compare(repository,q.source,q.target,q.base);if((await options.access.settings.read(repository)).policy.defaultBranch===q.source){preview.canResolve=false;preview.warnings.push('默认分支不能作为裁决写入的源；请选择待复核的工作分支。');}return preview;});
  app.post(base,async request=>{const repository=key(request.params),identity=requestIdentity(request);await options.access.requireCapability(repository,identity,'merge.execute');const input=resolutionRequestSchema.parse(request.body);if((await options.access.settings.read(repository)).policy.defaultBranch===input.source)throw new ApiError(403,'RESOLUTION_SOURCE_PROTECTED','请在工作分支解决冲突后重新复核，不能通过此操作直接改写默认分支。');return service.resolve(repository,identity,input);});
  return service;
}
