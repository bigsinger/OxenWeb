import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requestIdentity } from './auth.js';
import { safeRef, safeSegment } from './safety.js';
import { DatasetFieldsService, datasetFieldsSaveSchema, type DatasetFieldsOptions } from './dataset-fields.js';

export function registerDatasetFieldRoutes(app:FastifyInstance,options:DatasetFieldsOptions){
  const service=new DatasetFieldsService(options),base='/api/repos/:namespace/:repo/dataset/fields';
  const key=(request:FastifyRequest)=>z.object({namespace:z.string().transform(safeSegment),repo:z.string().transform(safeSegment)}).parse(request.params);
  app.get(base,request=>{const input=z.object({ref:z.string().transform(safeRef).default('main')}).strict().parse(request.query);return service.read(key(request),requestIdentity(request),input.ref);});
  app.put(base,request=>service.save(key(request),requestIdentity(request),datasetFieldsSaveSchema.parse(request.body)));
  return service;
}
