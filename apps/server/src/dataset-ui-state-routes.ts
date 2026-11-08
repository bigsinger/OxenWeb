import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DatasetUiStateService, uiStateDeleteSchema, uiStateQuerySchema, uiStateSaveSchema } from './dataset-ui-state.js';
import { requestIdentity } from './auth.js';
import { safeSegment } from './safety.js';

export function registerDatasetUiStateRoutes(app:FastifyInstance,options:ConstructorParameters<typeof DatasetUiStateService>[0]){
  const service=new DatasetUiStateService(options),base='/api/repos/:namespace/:repo/dataset/ui-state';
  const key=(request:FastifyRequest)=>z.object({namespace:z.string().transform(safeSegment),repo:z.string().transform(safeSegment)}).parse(request.params);
  app.get(base,request=>{const input=uiStateQuerySchema.parse(request.query);return service.read(key(request),requestIdentity(request),input.ref,input.kind);});
  app.put(base,{bodyLimit:25*1024*1024},request=>service.save(key(request),requestIdentity(request),uiStateSaveSchema.parse(request.body)));
  app.delete(base,request=>service.delete(key(request),requestIdentity(request),uiStateDeleteSchema.parse(request.body)));
  return service;
}
