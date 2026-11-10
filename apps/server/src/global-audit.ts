import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {z} from 'zod';
import type {RequestIdentity} from '../../../packages/shared/src/index.js';
import type {MacroAuditEvent,MacroAuditPage} from '../../../packages/shared/src/access-management.js';
import type {RepoKey} from './provider.js';
import {durableWriteJson} from './durable-store.js';
import {ApiError} from './errors.js';
import {safeSegment} from './safety.js';

const atom=z.union([z.string().max(500),z.number().finite(),z.boolean(),z.null()]);
const eventSchema=z.object({id:z.string().uuid(),at:z.string().datetime(),action:z.string().regex(/^[a-z][a-z0-9_.-]{2,79}$/),actor:z.object({id:z.string().min(1).max(160),name:z.string().min(1).max(120),kind:z.enum(['owner','collaborator','guest'])}).strict(),repository:z.object({namespace:z.string().transform(safeSegment),repo:z.string().transform(safeSegment)}).strict().optional(),targetId:z.string().max(180).optional(),details:z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,59}$/),atom).optional()}).strict();
const fileSchema=z.object({version:z.literal(1),events:z.array(eventSchema).max(100000)}).strict();
export const auditQuerySchema=z.object({page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(30),action:z.string().max(80).optional(),actor:z.string().max(160).optional(),project:z.string().max(250).optional(),from:z.string().datetime().optional(),to:z.string().datetime().optional()}).strict().refine(value=>!value.from||!value.to||value.from<=value.to,'开始时间不能晚于结束时间。');
export type AuditQuery=z.infer<typeof auditQuerySchema>;

/** BFF control-plane audit: macro actions only, no sample bodies or authentication material. */
export class GlobalAuditService {
  private events:MacroAuditEvent[]=[];private chain=Promise.resolve();readonly retentionDays=90;
  constructor(readonly filename:string){}
  async init(){try{this.events=fileSchema.parse(JSON.parse(await readFile(this.filename,'utf8'))).events;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
  private retained(){const since=Date.now()-this.retentionDays*86400000;return this.events.filter(event=>Date.parse(event.at)>=since);}
  async record(input:{action:string;actor:RequestIdentity;repository?:RepoKey;targetId?:string;details?:Record<string,string|number|boolean|null>}){
    for(const key of Object.keys(input.details??{}))if(/token|password|secret|cookie|authorization|prompt|body|content|query/i.test(key))throw new ApiError(500,'AUDIT_DETAIL_REJECTED','审计详情不能包含认证材料、样本正文或原始查询。');
    const event=eventSchema.parse({id:randomUUID(),at:new Date().toISOString(),action:input.action,actor:{id:input.actor.id,name:input.actor.name,kind:input.actor.kind},...(input.repository?{repository:input.repository}:{}),...(input.targetId?{targetId:input.targetId}:{}),...(input.details?{details:input.details}:{})});
    const work=this.chain.then(async()=>{const next=[...this.retained(),event];if(next.length>100000)throw new ApiError(507,'AUDIT_CAPACITY_REACHED','90天内宏观日志达到容量，请先安全归档，不会静默丢弃。');await durableWriteJson(this.filename,{version:1,events:next});this.events=next;return event;});
    this.chain=work.then(()=>{},()=>{});return work;
  }
  page(input:AuditQuery):MacroAuditPage{
    let events=this.retained();const actions=[...new Set(events.map(event=>event.action))].sort();
    if(input.action)events=events.filter(event=>event.action===input.action);
    if(input.actor){const actor=input.actor.toLocaleLowerCase();events=events.filter(event=>event.actor.id===input.actor||event.actor.name.toLocaleLowerCase().includes(actor));}
    if(input.project){const project=input.project.toLocaleLowerCase();events=events.filter(event=>event.repository&&`${event.repository.namespace}/${event.repository.repo}`.toLocaleLowerCase().includes(project));}
    if(input.from)events=events.filter(event=>event.at>=input.from!);if(input.to)events=events.filter(event=>event.at<=input.to!);
    const ordered=events.map((event,index)=>({event,index})).sort((a,b)=>b.event.at.localeCompare(a.event.at)||b.index-a.index).map(item=>item.event);
    return {items:ordered.slice((input.page-1)*input.pageSize,input.page*input.pageSize),total:ordered.length,page:input.page,pageSize:input.pageSize,actions,retentionDays:this.retentionDays};
  }
}
