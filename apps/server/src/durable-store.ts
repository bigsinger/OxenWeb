import {randomUUID} from 'node:crypto';
import {mkdir,open,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {operationalLog} from './operational-log.js';

export interface DurableWriteOptions {
  /** Recheck authorization/CAS immediately before the atomic replacement. */
  beforeReplace?:()=>Promise<void>;
  /** Fault injection for isolated tests; never configured by an HTTP request. */
  fault?:(stage:'written'|'synced'|'replaced')=>void|Promise<void>;
}
/** Flush payload before atomic rename. Directory fsync is supported on POSIX, best effort on Windows. */
export async function durableWriteFile(filename:string,data:string|Uint8Array,options:DurableWriteOptions={}):Promise<void>{
  const directory=path.dirname(path.resolve(filename));await mkdir(directory,{recursive:true,mode:0o700});
  const temporary=path.join(directory,'.'+path.basename(filename)+'.'+randomUUID()+'.tmp');
  let handle:Awaited<ReturnType<typeof open>>|undefined;
  try{
    handle=await open(temporary,'wx',0o600);await handle.writeFile(data);await options.fault?.('written');await handle.sync();await options.fault?.('synced');await handle.close();handle=undefined;
    await options.beforeReplace?.();await rename(temporary,filename);await options.fault?.('replaced');
    let folder:Awaited<ReturnType<typeof open>>|undefined;
    try{folder=await open(directory,'r');await folder.sync();}
    catch(error){if(process.platform!=='win32'||!['EISDIR','EPERM','EACCES','EINVAL','EBADF'].includes((error as NodeJS.ErrnoException).code??''))throw error;}
    finally{await folder?.close();}
  }catch(error){operationalLog('storage.write_failed',{code:(error as NodeJS.ErrnoException).code??'WRITE_INTERRUPTED'});throw error;}finally{await handle?.close().catch(()=>{});await rm(temporary,{force:true}).catch(()=>{});}
}
export async function durableWriteJson(filename:string,value:unknown,options:DurableWriteOptions={}):Promise<void>{
  const serialized=JSON.stringify(value,null,2);if(serialized===undefined)throw new Error('Cannot persist undefined JSON');await durableWriteFile(filename,serialized+'\n',options);
}
