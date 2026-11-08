import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {requestIdentity} from './auth.js';
import {ApiError} from './errors.js';
import {ZipImportService,type ZipImportOptions} from './zip-import.js';
const mapping=z.object({mode:z.enum(['tables','directories','archives','release']),paths:z.array(z.string().max(1024)).min(1).max(10_000),idField:z.string().min(1).max(120).optional(),attachmentFields:z.array(z.string().min(1).max(120)).max(30).optional()}).strict();
export function registerZipImportRoutes(app:FastifyInstance,options:ZipImportOptions){const service=new ZipImportService(options);
  app.post('/api/import/zip',async request=>{let content:Buffer|undefined,filename='';for await(const part of request.parts({limits:{fileSize:64*1024*1024,files:1,fields:0}})){if(part.type!=='file')continue;if(content)throw new ApiError(400,'ZIP_FILE_COUNT','一次请选择一个 ZIP。');content=await part.toBuffer();filename=part.filename;if(part.file.truncated)throw new ApiError(413,'ZIP_SIZE_LIMIT','ZIP 不能超过 64 MiB。');}if(!content)throw new ApiError(400,'ZIP_REQUIRED','请选择 ZIP。');return service.inspect(content,filename,requestIdentity(request));});
  app.post('/api/import/zip/:id/plan',request=>service.plan(z.object({id:z.string().uuid()}).parse(request.params).id,requestIdentity(request),mapping.parse(request.body)));
  app.delete('/api/import/zip/:id',async(request,reply)=>{service.discard(z.object({id:z.string().uuid()}).parse(request.params).id,requestIdentity(request));return reply.code(204).send();});
  app.post('/api/import/zip/:id/commit',request=>{const input=z.object({mapping,fingerprint:z.string().regex(/^[a-f0-9]{64}$/),namespace:z.string().min(1).max(120),repo:z.string().min(1).max(120),branch:z.string().min(1).max(160),expectedCommit:z.string().min(1).max(160).optional(),createRepository:z.boolean().default(false),path:z.string().max(1024).optional(),description:z.string().max(4000).optional()}).strict().parse(request.body);return service.commit(z.object({id:z.string().uuid()}).parse(request.params).id,requestIdentity(request),input);});return service;
}
