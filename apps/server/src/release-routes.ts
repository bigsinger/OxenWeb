import type {FastifyInstance,FastifyReply} from 'fastify';
import {z} from 'zod';
import {ReleaseService} from './releases.js';
import {requestIdentity} from './auth.js';
import {safeRef,safeSegment} from './safety.js';
import {ApiError} from './errors.js';

const key=(params:unknown)=>z.object({namespace:z.string().transform(safeSegment),repo:z.string().transform(safeSegment)}).parse(params);
const id=(params:unknown)=>z.object({id:z.string().uuid()}).parse(params).id;
const revision=z.object({expectedRevision:z.number().int().positive()}).strict();
const source=z.string().min(1).max(160).transform(safeRef);
function send(reply:FastifyReply,result:Awaited<ReturnType<ReleaseService['download']>>){return reply.type(result.asset.mime).header('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(result.asset.name)}`).header('Content-Security-Policy',"sandbox; default-src 'none'").header('Cache-Control','private, no-store').header('X-Content-Type-Options','nosniff').header('X-Artifact-SHA256',result.asset.sha256).send(result.content);}
export function registerReleaseRoutes(app:FastifyInstance,service:ReleaseService){
  app.addHook('onClose',async()=>service.close());
  let activeDownloads=0;const download=async(reply:FastifyReply,operation:()=>ReturnType<ReleaseService['download']>)=>{if(activeDownloads>=4)throw new ApiError(429,'DOWNLOAD_BUSY','同时下载数量已达上限，请稍后重试。');activeDownloads++;let released=false;const release=()=>{if(!released){released=true;activeDownloads--;}};reply.raw.once('finish',release);reply.raw.once('close',release);try{return send(reply,await operation());}catch(error){release();throw error;}};
  const base='/api/repos/:namespace/:repo';
  for(const kind of ['releases','snapshots'] as const){
    app.get(`${base}/${kind}`,request=>service.list(key(request.params),requestIdentity(request),kind==='releases'?'release':'snapshot'));
    app.get(`${base}/${kind}/:id`,request=>service.get(key(request.params),id(request.params),requestIdentity(request)));
    app.get(`${base}/${kind}/:id/assets/:assetId`,async(request,reply)=>{const assetId=z.object({assetId:z.string().uuid()}).parse(request.params).assetId;return download(reply,()=>service.download(key(request.params),id(request.params),assetId,requestIdentity(request)));});
  }
  app.post(`${base}/releases`,async(request,reply)=>{const input=z.object({version:z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/),title:z.string().trim().min(1).max(240),notes:z.string().max(30_000).default(''),sourceRef:source,prerelease:z.boolean().default(false),includeArchives:z.boolean().default(false)}).strict().parse(request.body);const value=await service.create(key(request.params),requestIdentity(request),input);reply.code(201);return value;});
  app.patch(`${base}/releases/:id`,request=>{const input=z.object({expectedRevision:z.number().int().positive(),version:z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/).optional(),title:z.string().trim().min(1).max(240).optional(),notes:z.string().max(30_000).optional(),sourceRef:source.optional(),prerelease:z.boolean().optional(),includeArchives:z.boolean().optional()}).strict().parse(request.body);return service.update(key(request.params),id(request.params),requestIdentity(request),input);});
  app.post(`${base}/releases/:id/build`,request=>service.build(key(request.params),id(request.params),requestIdentity(request),revision.parse(request.body).expectedRevision));
  app.post(`${base}/snapshots/:id/build`,request=>service.build(key(request.params),id(request.params),requestIdentity(request),revision.parse(request.body).expectedRevision));
  app.post(`${base}/releases/:id/publish`,request=>service.publish(key(request.params),id(request.params),requestIdentity(request),revision.parse(request.body).expectedRevision));
  app.post(`${base}/releases/:id/withdraw`,request=>service.withdraw(key(request.params),id(request.params),requestIdentity(request),revision.parse(request.body).expectedRevision));
  app.post(`${base}/releases/:id/errata`,request=>{const input=z.object({expectedRevision:z.number().int().positive(),body:z.string().trim().min(1).max(10000)}).strict().parse(request.body);return service.erratum(key(request.params),id(request.params),requestIdentity(request),input.expectedRevision,input.body);});
  app.post(`${base}/releases/:id/latest`,request=>service.latest(key(request.params),id(request.params),requestIdentity(request),revision.parse(request.body).expectedRevision));
  app.get(`${base}/releases/:id/shares`,request=>service.shares(key(request.params),id(request.params),requestIdentity(request)));
  app.post(`${base}/releases/:id/shares`,request=>service.share(key(request.params),id(request.params),requestIdentity(request),z.object({expiresAt:z.string().datetime()}).strict().parse(request.body).expiresAt));
  app.delete(`${base}/releases/:id/shares/:shareId`,async(request,reply)=>{const shareId=z.object({shareId:z.string().uuid()}).parse(request.params).shareId;await service.revoke(key(request.params),id(request.params),shareId,requestIdentity(request));return reply.code(204).send();});
  app.post(`${base}/snapshots`,async(request,reply)=>{const input=z.object({ref:source,includeArchives:z.boolean().default(false)}).strict().parse(request.body),identity=requestIdentity(request),repository=key(request.params);const item=await service.create(repository,identity,{sourceRef:input.ref,version:'snapshot-'+new Date().toISOString().replace(/[:.]/g,'-'),title:'未发布工作快照',notes:'未发布；保留当前已提交数据及标注，未经发布复核背书。',prerelease:false,includeArchives:input.includeArchives},'snapshot');const value=await service.build(repository,item.id,identity,item.revision);reply.code(202);return value;});
  app.get('/downloads/releases/:token',async(request,reply)=>{const token=z.object({token:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).parse(request.params).token;return download(reply,()=>service.sharedDownload(token));});
}
