import path from 'node:path';
import type { FileTreeNode } from '../../../packages/shared/src/index.js';
import type { Provider, RepoKey } from './provider.js';
import { ApiError } from './errors.js';

/** In-memory read view. No upstream workspace or branch is created. */
export function datasetOverlayProvider(provider:Provider,writes:Map<string,Buffer>):Provider{
  const mutations=new Set(['createRepo','updateRepo','createBranch','merge','resolveMerge','createWorkspace','deleteWorkspace','writeWorkspace','removeWorkspaceFiles','commitWorkspace','annotate','push']);
  return new Proxy(provider,{get(target,property){
    if(mutations.has(String(property)))return async()=>{throw new ApiError(500,'DATASET_DRAFT_MUTATION','草稿预览禁止执行上游写入。');};
    if(property==='raw')return async(key:RepoKey,ref:string,filename:string)=>writes.has(filename)?{content:Buffer.from(writes.get(filename)!),mime:'application/json',filename:path.posix.basename(filename)}:target.raw(key,ref,filename);
    if(property==='tree')return async(key:RepoKey,ref:string,directory:string)=>{
      const entries=new Map<string,FileTreeNode>();
      try{for(const entry of await target.tree(key,ref,directory))entries.set(entry.path,entry);}catch(error){if(!(error instanceof ApiError&&error.status===404))throw error;}
      const prefix=directory?directory+'/':'';
      for(const [filename,content]of writes){if(!filename.startsWith(prefix))continue;const suffix=filename.slice(prefix.length),name=suffix.split('/')[0]!;if(!name)continue;const child=prefix+name,kind=suffix.includes('/')?'directory':'file';entries.set(child,{name,path:child,kind,size:kind==='file'?content.length:0,extension:kind==='file'?path.posix.extname(name):''});}
      return [...entries.values()];
    };
    const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
  }});
}
