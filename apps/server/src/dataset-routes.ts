import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { DatasetBeforeWrite, DatasetCapabilities, DatasetWriteOperation, DatasetPage, DatasetRowCapabilities } from '../../../packages/shared/src/dataset.js';
import type { RequestIdentity } from '../../../packages/shared/src/index.js';
import type { Provider, RepoKey } from './provider.js';
import { DatasetService, datasetSaveSchema, type DatasetServiceOptions } from './dataset.js';
import { requestIdentity } from './auth.js';
import { safeRef, safeSegment } from './safety.js';
import { ApiError } from './errors.js';

export interface DatasetAccess {
  require(key:RepoKey,identity:RequestIdentity,operation:'read'|'write'|'admin'):Promise<unknown>;
  requireCapability?(key:RepoKey,identity:RequestIdentity,capability:any):Promise<unknown>;
}
export interface DatasetRouteOptions {
  appendRows?:(key:RepoKey,identity:RequestIdentity,branch:string)=>Promise<boolean>;
  rowCapabilities?:(key:RepoKey,identity:RequestIdentity,branch:string,page:DatasetPage)=>Promise<Record<string,DatasetRowCapabilities>>;
  access?:DatasetAccess; governance?:{snapshot:(key:RepoKey,ref:string)=>Promise<{binding?:unknown}>}; beforeWrite?:DatasetBeforeWrite; service?:DatasetService;workflowFields?:DatasetServiceOptions['workflowFields'];
}
const capability=(operation:DatasetWriteOperation)=>operation==='feedback'?'read':operation==='edit-dataset-labels'?'dataset.assign':operation==='edit-content'||operation==='edit-readme'?'data.edit':'annotation.assign';
const filter=z.object({column:z.string().min(1).max(250),operator:z.enum(['eq','contains','unset','gt','lt']),value:z.string().max(8000).optional()}).strict();
export const datasetQuerySchema=z.object({ref:z.string().transform(safeRef).default('main'),search:z.string().max(8000).optional(),filters:z.array(filter).max(30).optional(),sort:z.object({column:z.string().min(1).max(250),direction:z.enum(['asc','desc'])}).strict().optional(),page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(200).default(50),sample:z.string().max(200).optional(),prompt:z.string().max(8000).optional(),engine:z.enum(['rules','model']).default('rules'),allowExternalSchema:z.boolean().default(false)}).strict();
const key=(request:FastifyRequest)=>{const parsed=z.object({namespace:z.string().transform(safeSegment),repo:z.string().transform(safeSegment)}).parse(request.params);return {namespace:parsed.namespace,repo:parsed.repo};};
export function registerDatasetRoutes(app:FastifyInstance,provider:Provider,options:DatasetRouteOptions={}):DatasetService{
  const authorize=async(repository:RepoKey,identity:RequestIdentity,operation:DatasetWriteOperation)=>{
    if(options.access?.requireCapability)await options.access.requireCapability(repository,identity,capability(operation));
    else if(options.access)await options.access.require(repository,identity,operation==='feedback'?'read':'write');
  };
  const datasets=options.service??new DatasetService(provider,{authorize:options.access?authorize:undefined,governance:options.governance,beforeWrite:options.beforeWrite,workflowFields:options.workflowFields});
  const read=async(request:FastifyRequest)=>{const repository=key(request);await options.access?.require(repository,requestIdentity(request),'read');return repository;};
  const permissions=async(repository:RepoKey,identity:RequestIdentity,branch:string):Promise<DatasetCapabilities>=>{
    const may=async(operation:DatasetWriteOperation)=>{try{if(identity.kind==='guest')return false;if(options.access)await authorize(repository,identity,operation);else if(identity.kind!=='owner')return false;return true;}catch{return false;}};
    const [editContent,assignLabels,editDatasetLabels,editFileLabels,editReadme,feedback]=await Promise.all(['edit-content','assign-labels','edit-dataset-labels','edit-file-labels','edit-readme','feedback'].map(operation=>may(operation as DatasetWriteOperation)));
    return {editContent:!!editContent,appendRows:!!editContent&&(options.appendRows?await options.appendRows(repository,identity,branch):true),assignLabels:!!assignLabels,editDatasetLabels:!!editDatasetLabels,editFileLabels:!!editFileLabels,editReadme:!!editReadme,feedback:!!feedback};
  };
  const base='/api/repos/:namespace/:repo/dataset';
  app.get(base,async request=>{const repository=await read(request),input=datasetQuerySchema.omit({filters:true,prompt:true,allowExternalSchema:true,engine:true}).parse(request.query),page=await datasets.page(repository,input.ref,input);return {...page,capabilities:await permissions(repository,requestIdentity(request),input.ref),...(options.rowCapabilities?{rowCapabilities:await options.rowCapabilities(repository,requestIdentity(request),input.ref,page)}:{})};});
  app.post(`${base}/query`,async request=>{const repository=await read(request),input=datasetQuerySchema.parse(request.body);if(requestIdentity(request).kind==='guest'&&input.engine==='model'&&input.prompt)throw new ApiError(401,'AUTH_REQUIRED','模型查询需要登录；公开数据可使用本地查询。');const page=await datasets.page(repository,input.ref,input);return {...page,capabilities:await permissions(repository,requestIdentity(request),input.ref),...(options.rowCapabilities?{rowCapabilities:await options.rowCapabilities(repository,requestIdentity(request),input.ref,page)}:{})};});
  app.get(`${base}/overview`,async request=>{const repository=await read(request),input=z.object({ref:z.string().transform(safeRef).default('main')}).parse(request.query),snapshot=await datasets.read(repository,input.ref);return {commitId:snapshot.commitId,ref:input.ref,descriptor:snapshot.descriptor,readme:snapshot.readme,totalRows:snapshot.totalRows,columns:snapshot.columns,attachmentCount:snapshot.attachments.length,labelColumns:snapshot.labels.columns,labeledRows:new Set(snapshot.labels.assignments.filter(item=>item.scope==='row'&&Object.keys(item.values).length).map(item=>item.rowId)).size,labelConflictCount:snapshot.labelConflicts.length,warnings:snapshot.warnings,capabilities:await permissions(repository,requestIdentity(request),input.ref)};});
  app.post(`${base}/save`,async request=>{const repository=await read(request),input=datasetSaveSchema.parse(request.body),snapshot=await datasets.save(repository,requestIdentity(request),input);return {commitId:snapshot.commitId,path:snapshot.path,totalRows:snapshot.totalRows,rowIds:snapshot.rowIds,warnings:snapshot.warnings};});
  return datasets;
}
