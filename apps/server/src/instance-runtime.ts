import {createHash,randomUUID} from 'node:crypto';
import {mkdir,open,readFile,realpath,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ApiError} from './errors.js';
import type {Config} from './config.js';

interface LockRecord{version:1;pid:number;nonce:string;createdAt:string;authority:string;controlRoot:string}
const exists=(pid:number)=>{try{process.kill(pid,0);return true;}catch(error){return(error as NodeJS.ErrnoException).code==='EPERM';}};
export function runtimeAuthority(config:Pick<Config,'demo'|'demoFile'|'upstream'>){
  if(config.demo)return'demo:'+path.resolve(config.demoFile).toLocaleLowerCase();
  const url=new URL(config.upstream??'http://127.0.0.1:3002'),hostname=url.hostname.toLowerCase().replace(/^\[|\]$/g,'').replace(/\.$/,'');
  if(hostname==='localhost'||hostname==='::1'||/^127(?:\.\d{1,3}){3}$/.test(hostname))url.hostname='127.0.0.1';
  return'oxen:'+url.origin.toLocaleLowerCase();
}
/** Two guards: one canonical control directory and one upstream authority, independent of TCP port. */
export async function acquireInstanceLease(config:Pick<Config,'demo'|'demoFile'|'upstream'>){
  const parent=path.dirname(path.resolve(config.demoFile));await mkdir(parent,{recursive:true,mode:0o700});const controlRoot=await realpath(parent),authority=runtimeAuthority(config),nonce=randomUUID();
  const record:LockRecord={version:1,pid:process.pid,nonce,createdAt:new Date().toISOString(),authority,controlRoot};
  const locks=[path.join(controlRoot,'.oxen-web-instance.lock'),path.join(os.tmpdir(),'oxen-web-authority-'+createHash('sha256').update(authority).digest('hex')+'.lock')],held:string[]=[];
  async function acquire(filename:string){for(let attempt=0;attempt<3;attempt++)try{const handle=await open(filename,'wx',0o600);try{await handle.writeFile(JSON.stringify(record));await handle.sync();}finally{await handle.close();}held.push(filename);return;}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;let current:LockRecord,raw:string;try{raw=await readFile(filename,'utf8');current=JSON.parse(raw);if(current.version!==1||!Number.isInteger(current.pid)||current.pid<1)throw new Error('Invalid lease');}catch{throw new ApiError(503,'INSTANCE_LOCK_INVALID','实例锁不可读；请核对服务进程及存储，不会自动覆盖。');}if(exists(current.pid))throw new ApiError(409,'INSTANCE_ALREADY_RUNNING','同一存储或Oxen服务已有活动BFF。请先受控停止原实例。',{pid:current.pid});if(await readFile(filename,'utf8')===raw)await rm(filename);}throw new ApiError(409,'INSTANCE_LOCK_BUSY','启动锁发生竞争，请稍后重试。');}
  try{for(const filename of locks)await acquire(filename);}catch(error){for(const filename of held)await rm(filename,{force:true}).catch(()=>{});throw error;}
  let released=false;return{record,async release(){if(released)return;released=true;for(const filename of held){try{const current=JSON.parse(await readFile(filename,'utf8'));if(current.nonce===nonce&&current.pid===process.pid)await rm(filename);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}}};
}

export class InstanceRuntime{
  private draining=false;private writes=0;private waiting=new Set<()=>void>();private startedAt=new Date().toISOString();
  state(){return{mode:this.draining?'draining':'ready',acceptsWrites:!this.draining,activeWrites:this.writes,startedAt:this.startedAt,singleWriter:true};}
  beginWrite(){if(this.draining)throw new ApiError(503,'INSTANCE_DRAINING','服务正在维护，输入仍保留；维护结束后可继续。');this.writes++;let done=false;return()=>{if(done)return;done=true;this.writes--;if(!this.writes){for(const resolve of this.waiting)resolve();this.waiting.clear();}};}
  /** Only an already accepted writer may extend its lease for queued background work. */
  retainWrite(){if(this.draining&&!this.writes)throw new ApiError(503,'INSTANCE_DRAINING','服务已停止接受新写入。');this.writes++;let done=false;return()=>{if(done)return;done=true;this.writes--;if(!this.writes){for(const resolve of this.waiting)resolve();this.waiting.clear();}};}
  resume(){this.draining=false;return this.state();}
  async drain(timeoutMs=30_000){this.draining=true;if(this.writes)await new Promise<void>((resolve,reject)=>{const complete=()=>{clearTimeout(timer);resolve();};const timer=setTimeout(()=>{this.waiting.delete(complete);reject(new ApiError(503,'DRAIN_TIMEOUT','仍有在途写操作，需要先核对后再停服务。'));},timeoutMs);this.waiting.add(complete);});return this.state();}
}
