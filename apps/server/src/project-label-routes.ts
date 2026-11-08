import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requestIdentity } from './auth.js';
import { safeSegment } from './safety.js';
import { ProjectLabelService, projectLabelSaveSchema, type ProjectLabelOptions } from './project-labels.js';

export function registerProjectLabelRoutes(app:FastifyInstance,options:ProjectLabelOptions){
  const service=new ProjectLabelService(options),base='/api/repos/:namespace/:repo/project-labels';
  const key=(request:FastifyRequest)=>z.object({namespace:z.string().transform(safeSegment),repo:z.string().transform(safeSegment)}).parse(request.params);
  app.get(base,request=>service.read(key(request),requestIdentity(request)));
  app.put(base,request=>service.save(key(request),requestIdentity(request),projectLabelSaveSchema.parse(request.body)));
  return service;
}
