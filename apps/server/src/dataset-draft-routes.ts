import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { DatasetCapabilities, DatasetWriteOperation } from '../../../packages/shared/src/dataset.js';
import type { RequestIdentity } from '../../../packages/shared/src/index.js';
import type { RepoKey } from './provider.js';
import { DatasetService } from './dataset.js';
import { DatasetDraftService, draftCommitSchema, draftDiscardSchema, draftRebaseSchema, draftRefSchema, draftSaveSchema } from './dataset-drafts.js';
import { datasetQuerySchema, type DatasetRouteOptions } from './dataset-routes.js';
import { requestIdentity } from './auth.js';
import { safeSegment } from './safety.js';
import { ApiError } from './errors.js';

export interface DatasetDraftRouteOptions extends Pick<DatasetRouteOptions,'access'|'rowCapabilities'|'appendRows'> { directory:string; service?:DatasetDraftService }
export function registerDatasetDraftRoutes(app:FastifyInstance,datasets:DatasetService,options:DatasetDraftRouteOptions):DatasetDraftService{
  const drafts=options.service??new DatasetDraftService(datasets,options.directory),base='/api/repos/:namespace/:repo/dataset/draft';
  const read=async(request:FastifyRequest)=>{const parsed=z.object({namespace:z.string().transform(safeSegment),repo:z.string().transform(safeSegment)}).parse(request.params),identity=requestIdentity(request);if(identity.kind==='guest')throw new ApiError(401,'AUTH_REQUIRED','本机草稿仅对已登录的当前身份可见。');await options.access?.require(parsed,identity,'read');return {repository:parsed,identity};};
  const permissions=async(repository:RepoKey,identity:RequestIdentity,branch:string):Promise<DatasetCapabilities>=>{
    const may=async(operation:DatasetWriteOperation)=>{try{if(options.access?.requireCapability)await options.access.requireCapability(repository,identity,operation==='feedback'?'read':operation==='edit-dataset-labels'?'dataset.assign':operation==='edit-content'||operation==='edit-readme'?'data.edit':'annotation.assign');else if(options.access)await options.access.require(repository,identity,operation==='feedback'?'read':'write');else if(identity.kind!=='owner')return false;return true;}catch{return false;}};
    const [editContent,assignLabels,editDatasetLabels,editFileLabels,editReadme,feedback]=await Promise.all(['edit-content','assign-labels','edit-dataset-labels','edit-file-labels','edit-readme','feedback'].map(operation=>may(operation as DatasetWriteOperation)));
    return {editContent:!!editContent,appendRows:!!editContent&&(options.appendRows?await options.appendRows(repository,identity,branch):true),assignLabels:!!assignLabels,editDatasetLabels:!!editDatasetLabels,editFileLabels:!!editFileLabels,editReadme:!!editReadme,feedback:!!feedback};
  };
  app.get(base,async request=>{const {repository,identity}=await read(request),input=draftRefSchema.parse(request.query);return drafts.read(repository,identity,input.ref);});
  app.get(base+'/export',async(request,reply)=>{const {repository,identity}=await read(request),input=draftRefSchema.parse(request.query);reply.header('Content-Type','application/json; charset=utf-8');reply.header('Cache-Control','no-store');return drafts.export(repository,identity,input.ref);});
  app.post(base+'/rebase',async request=>{const {repository,identity}=await read(request);return drafts.rebase(repository,identity,draftRebaseSchema.parse(request.body));});
  app.put(base,async request=>{const {repository,identity}=await read(request);return drafts.save(repository,identity,draftSaveSchema.parse(request.body));});
  app.post(base+'/query',async request=>{const {repository,identity}=await read(request),input=datasetQuerySchema.extend({draftRevision:z.number().int().nonnegative().optional(),expectedDraftId:z.string().uuid().optional()}).parse(request.body),page=await drafts.page(repository,identity,input.ref,input,input.draftRevision,input.expectedDraftId);return {...page,capabilities:await permissions(repository,identity,input.ref),...(options.rowCapabilities?{rowCapabilities:await options.rowCapabilities(repository,identity,input.ref,page)}:{})};});
  app.get(base+'/diff',async request=>{const {repository,identity}=await read(request),input=draftRefSchema.parse(request.query);return await drafts.diff(repository,identity,input.ref)??{changes:[]};});
  app.post(base+'/commit',async request=>{const {repository,identity}=await read(request);return drafts.commit(repository,identity,draftCommitSchema.parse(request.body));});
  app.post(base+'/discard',async request=>{const {repository,identity}=await read(request),input=draftDiscardSchema.parse(request.body);return drafts.discard(repository,identity,input.ref,input.draftRevision,input.expectedDraftId);});
  return drafts;
}
