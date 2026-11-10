import {performance} from 'node:perf_hooks';
import type {FastifyInstance} from 'fastify';
import {ApiError} from './errors.js';

/** Per-active-BFF resource limits. Authorization and operation journaling remain separate. */
export class CapacityBudget {
  private reads=0;
  private heavy=0;
  private waiting:Array<{resolve:()=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>=[];
  private samples:number[]=[];
  private rejected=0;
  constructor(readonly limits={reads:8,heavy:1,queuedHeavy:4,queueTimeoutMs:120_000}){}
  acquire(kind:'read'|'heavy'):()=>void {
    if(kind==='read'?this.reads>=this.limits.reads:this.heavy>=this.limits.heavy){this.rejected++;throw new ApiError(429,'CAPACITY_BUSY','当前工作已达并发预算，请稍后重试；本次输入未提交。');}
    if(kind==='read')this.reads++;else this.heavy++;
    let released=false;
    return ()=>{if(released)return;released=true;if(kind==='read')this.reads--;else{this.heavy--;this.wake();}};
  }
  private wake(){if(this.heavy>=this.limits.heavy)return;const entry=this.waiting.shift();if(entry){clearTimeout(entry.timer);this.heavy++;entry.resolve();}}
  async runHeavy<T>(work:()=>Promise<T>,wait=false):Promise<T>{
    let release:()=>void;
    if(this.heavy<this.limits.heavy)release=this.acquire('heavy');
    else if(!wait||this.waiting.length>=this.limits.queuedHeavy){this.rejected++;throw new ApiError(429,'HEAVY_WORK_BUSY','已有重型导入、比较或构建正在执行，队列已满；请保留输入后重试。');}
    else {
      await new Promise<void>((resolve,reject)=>{const entry={resolve,reject,timer:setTimeout(()=>{const index=this.waiting.indexOf(entry);if(index>=0)this.waiting.splice(index,1);this.rejected++;reject(new ApiError(429,'HEAVY_WORK_QUEUE_TIMEOUT','重型任务等待超时，未执行；请稍后核对并重试。'));},this.limits.queueTimeoutMs)};this.waiting.push(entry);});
      let done=false;release=()=>{if(!done){done=true;this.heavy--;this.wake();}};
    }
    try{return await work();}finally{release();}
  }
  observe(elapsed:number){if(Number.isFinite(elapsed)&&elapsed>=0){this.samples.push(elapsed);if(this.samples.length>2000)this.samples.shift();}}
  snapshot(){const sorted=[...this.samples].sort((a,b)=>a-b),percentile=(p:number)=>sorted.length?sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)]!:null;return {limits:this.limits,activeReads:this.reads,activeHeavy:this.heavy,queuedHeavy:this.waiting.length,rejected:this.rejected,recentRequests:sorted.length,p95Ms:percentile(.95),p99Ms:percentile(.99)};}
  close(){for(const item of this.waiting){clearTimeout(item.timer);item.reject(new ApiError(503,'SERVICE_DRAINING','服务停止接收新工作，请保留输入。'));}this.waiting=[];}
}

export function installCapacityBudget(app:FastifyInstance,budget:CapacityBudget){
  app.addHook('onRoute',route=>{
    const url=route.url,query=/\/dataset(?:\/draft)?(?:\/query)?$/.test(url)||url.endsWith('/dataset/overview');
    const methods=Array.isArray(route.method)?route.method:[route.method];
    const preparesPublication=(/\/(?:releases(?:\/:id)?|snapshots)$/.test(url)&&methods.some(method=>method==='POST'||method==='PATCH'))||(/\/releases\/:id\/publish$/.test(url)&&methods.includes('POST'));
    const heavy=preparesPublication||url.endsWith('/archive-diff')||/\/history\/restore(?:\/preview)?$/.test(url)||url.endsWith('/dataset/import/inspect')||url==='/api/import/zip'||/\/dataset\/import\/[^/]+\/commit$/.test(url)||url==='/api/import/zip/:id/commit'||/\/releases(?:\/:id)?\/preview$/.test(url);
    if(!query&&!heavy)return;
    const original=route.handler;
    route.handler=async function(request,reply){
      if(query&&!heavy&&!['GET','POST'].includes(request.method))return original.call(this,request,reply);
      let release:()=>void;
      try{release=budget.acquire(heavy?'heavy':'read');}catch(error){reply.header('Retry-After','2');throw error;}
      const started=performance.now();
      // A disconnected HTTP client does not cancel an awaited upstream operation.
      // Hold capacity until the actual handler settles, independently of the socket.
      try{return await original.call(this,request,reply);}finally{release();budget.observe(performance.now()-started);}
    };
  });
  app.addHook('onClose',async()=>budget.close());
}
