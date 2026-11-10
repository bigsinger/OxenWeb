import type {DatasetSnapshot} from '../../../packages/shared/src/dataset.js';
import type {DatasetService} from './dataset.js';
import type {RepoKey} from './provider.js';
import {ApiError} from './errors.js';

/** Empty repositories can publish an empty dataset package without initializing Sample storage.
 * Existing ambiguous or corrupt datasets never become empty exports after an error.
 */
export async function readPublishingDataset(datasets:DatasetService,key:RepoKey,ref:string):Promise<DatasetSnapshot>{
  try{return await datasets.read(key,ref);}catch(cause){
    if(!(cause instanceof ApiError&&cause.code==='DATASET_NOT_CONFIGURED'))throw cause;
    const setup=await datasets.setupState(key,ref);if(!setup.canInitialize)throw cause;
    return {namespace:key.namespace,repo:key.repo,ref,commitId:setup.commitId,path:'data/samples.jsonl',
      descriptor:{version:1,id:key.repo,name:key.repo,canonicalPath:'data/samples.jsonl',readmePath:'README.md',identityField:'id',attachmentFields:[],source:'descriptor',fields:{}},
      rows:[],rowIds:[],columns:[],totalRows:0,contentHashes:{},labels:{version:1,ref,commitId:setup.commitId,storagePath:'.oxenweb/labels.json',legacyCount:0,columns:[],assignments:[]},labelRecords:[],labelConflicts:[],
      attachments:[],feedback:[],readme:'',readmePath:'README.md',orphanAssignments:[],warnings:['空项目：尚未初始化样本存储，本次生成零条目的数据集包，不会创建或修改样本。']};
  }
}
