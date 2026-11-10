import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {requestIdentity} from './auth.js';
import {safeSegment} from './safety.js';
import {RepositoryHistoryService,restorePreviewSchema,restoreCommitSchema} from './repository-history.js';
const key=(request:FastifyRequest)=>z.object({namespace:z.string().transform(safeSegment),repo:z.string().transform(safeSegment)}).parse(request.params);
export function registerRepositoryHistoryRoutes(app:FastifyInstance,service:RepositoryHistoryService){
 const base='/api/repos/:namespace/:repo/history/restore';
 app.post(base+'/preview',request=>service.preview(key(request),requestIdentity(request),restorePreviewSchema.parse(request.body)));
 app.post(base,request=>service.restore(key(request),requestIdentity(request),restoreCommitSchema.parse(request.body)));
}
