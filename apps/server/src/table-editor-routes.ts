import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Provider } from './provider.js';
import { safeFilePath,safeRef,safeSegment } from './safety.js';
import { TableEditorService,tableOperation } from './table-editor.js';
export function registerTableEditor(app:FastifyInstance,provider:Provider){
  const service=new TableEditorService(provider);
  app.post('/api/repos/:namespace/:repo/table/edit',async request=>{
    const key=z.object({namespace:z.string().transform(safeSegment),repo:z.string().transform(safeSegment)}).parse(request.params);
    const input=z.object({ref:z.string().transform(safeRef),expectedCommit:z.string().transform(safeRef),path:z.string().transform(safeFilePath),operations:z.array(tableOperation).min(1).max(500),message:z.string().trim().min(1).max(4000)}).strict().parse(request.body);
    return service.save(key,input.ref,input.expectedCommit,input.path,input.operations,input.message);
  });
}
