import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requestIdentity } from './auth.js';
import { safeSegment } from './safety.js';
import { datasetAutoWidthSchema,DatasetAutoWidthService } from './dataset-auto-width.js';
export function registerDatasetAutoWidthRoutes(app:FastifyInstance,service:DatasetAutoWidthService){
  app.post('/api/repos/:namespace/:repo/dataset/fields/auto-width',async request=>{
    const key=z.object({namespace:z.string().transform(safeSegment),repo:z.string().transform(safeSegment)}).parse(request.params);
    return service.plan(key,requestIdentity(request),datasetAutoWidthSchema.parse(request.body));
  });
}
