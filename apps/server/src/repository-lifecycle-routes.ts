import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {requestIdentity} from './auth.js';
import {safeSegment} from './safety.js';
import {RepositoryLifecycleService,repositoryRemoveSchema,repositoryRestoreSchema} from './repository-lifecycle.js';
export function registerRepositoryLifecycleRoutes(app:FastifyInstance,service:RepositoryLifecycleService){
 const base='/api/repos/:namespace/:repo/lifecycle',key=(request:FastifyRequest)=>z.object({namespace:z.string().transform(safeSegment),repo:z.string().transform(safeSegment)}).parse(request.params);
 app.get('/api/repository-recycle-bin',request=>service.removed(requestIdentity(request)));
 app.get(base,request=>service.read(key(request),requestIdentity(request)));
 app.post(base+'/remove',request=>service.remove(key(request),requestIdentity(request),repositoryRemoveSchema.parse(request.body)));
 app.post(base+'/restore',request=>service.restore(key(request),requestIdentity(request),repositoryRestoreSchema.parse(request.body)));
}
