import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import type {Provider,RepoKey} from './provider.js';
import type {RepositoryAccessService} from './repository-access.js';
import type {DatasetService} from './dataset.js';
import {requestIdentity} from './auth.js';
import {safeFilePath,safeRef,safeSegment} from './safety.js';
import {DatasetConfigurationService,datasetConfigurationSchema} from './dataset-configuration.js';
export function registerDatasetConfigurationRoutes(app:FastifyInstance,options:{provider:Provider;access:RepositoryAccessService;datasets:DatasetService}){const service=new DatasetConfigurationService(options),base='/api/repos/:namespace/:repo/dataset-configuration',key=(value:unknown):RepoKey=>z.object({namespace:z.string().transform(safeSegment),repo:z.string().transform(safeSegment)}).parse(value),ref=z.string().transform(safeRef);
  app.get(base,request=>{const q=z.object({ref:ref.default('main')}).strict().parse(request.query);return service.state(key(request.params),requestIdentity(request),q.ref);});
  app.get(base+'/table',request=>{const q=z.object({ref,path:z.string().transform(safeFilePath)}).strict().parse(request.query);return service.table(key(request.params),requestIdentity(request),q.ref,q.path);});
  app.post(base,async request=>{const repository=key(request.params),identity=requestIdentity(request);await options.access.requireCapability(repository,identity,'data.edit');await options.access.requireCapability(repository,identity,'tasks.manage');return service.configure(repository,identity,datasetConfigurationSchema.parse(request.body));});return service;}
