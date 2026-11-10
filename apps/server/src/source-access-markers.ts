import {lstat,open} from 'node:fs/promises';
import {z} from 'zod';
import type {RepoKey} from './provider.js';
import {safeSegment} from './safety.js';
import {ApiError} from './errors.js';
import {durableWriteJson} from './durable-store.js';

const segment=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}$/),schema=z.object({version:z.literal(1),repositories:z.array(z.object({namespace:segment,repo:segment}).strict()).max(100000)}).strict();
type State=z.infer<typeof schema>;
const identity=(key:RepoKey)=>safeSegment(key.namespace)+'/'+safeSegment(key.repo);
const unavailable=(code:string)=>new ApiError(503,code,'项目源数据访问保护标记不可可靠读取，请恢复同代控制面备份后再启动。');

/** Generic monotonic source-access protection. No release, view, template or sample schema. */
export class SourceAccessMarkers {
  private state:State={version:1,repositories:[]};private ids=new Set<string>();private ready=false;private uncertain=false;private persisted=false;private chain:Promise<unknown>=Promise.resolve();
  constructor(readonly options:{filename:string;persist?:typeof durableWriteJson}){}
  async init(){
    this.ready=false;const info=await lstat(this.options.filename).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;});let next:State={version:1,repositories:[]};
    if(info){
      if(!info.isFile()||info.isSymbolicLink()||info.size>32*1024*1024)throw unavailable('SOURCE_ACCESS_MARKERS_INVALID');
      const handle=await open(this.options.filename,'r');try{const opened=await handle.stat();if(!opened.isFile()||opened.size>32*1024*1024)throw unavailable('SOURCE_ACCESS_MARKERS_INVALID');const bytes=Buffer.alloc(opened.size+1);let length=0;while(length<bytes.length){const part=await handle.read(bytes,length,bytes.length-length,null);if(!part.bytesRead)break;length+=part.bytesRead;}if(length!==opened.size)throw unavailable('SOURCE_ACCESS_MARKERS_CHANGED');try{next=schema.parse(JSON.parse(bytes.subarray(0,length).toString('utf8')));}catch{throw unavailable('SOURCE_ACCESS_MARKERS_INVALID');}}finally{await handle.close();}
    }
    const ids=new Set(next.repositories.map(identity));if(ids.size!==next.repositories.length)throw unavailable('SOURCE_ACCESS_MARKERS_INVALID');
    this.state=next;this.ids=ids;this.ready=true;this.uncertain=false;this.persisted=!!info;
  }
  private certain(){if(!this.ready||this.uncertain)throw unavailable('SOURCE_ACCESS_MARKERS_UNCERTAIN');}
  isRestricted(key:RepoKey){this.certain();const id=identity(key);return !this.persisted||this.ids.has(id);}
  /** Trusted maintenance code may retain protection; there is deliberately no remove/HTTP API. */
  retainRestrictions(keys:RepoKey[]){
    const retained=keys.map(key=>({namespace:safeSegment(key.namespace),repo:safeSegment(key.repo)}));
    const action=this.chain.then(async()=>{this.certain();const merged=new Map(this.state.repositories.map(key=>[identity(key),key]));for(const key of retained)merged.set(identity(key),key);if(merged.size===this.ids.size&&this.persisted)return;
      const next:State={version:1,repositories:[...merged].sort(([a],[b])=>a.localeCompare(b)).map(([,key])=>key)};if(next.repositories.length>100000||Buffer.byteLength(JSON.stringify(next))>32*1024*1024)throw new ApiError(507,'SOURCE_ACCESS_MARKERS_FULL','项目源数据保护标记达到容量，未移除任何既有保护。');
      try{await (this.options.persist??durableWriteJson)(this.options.filename,next);this.state=next;this.ids=new Set(merged.keys());this.persisted=true;}catch(error){this.uncertain=true;throw error;}
    });this.chain=action.then(()=>{},()=>{});return action;
  }
}
