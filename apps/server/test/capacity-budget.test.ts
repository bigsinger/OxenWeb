import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {CapacityBudget,installCapacityBudget} from '../src/capacity-budget.js';

test('full-dataset create, update, publish and snapshot preparation share the heavy budget until work settles',async()=>{
  for(const entry of [{method:'POST' as const,path:'/api/repos/:namespace/:repo/releases',url:'/api/repos/local/synthetic/releases'},{method:'PATCH' as const,path:'/api/v1/datasets/:datasetId/releases/:id',url:'/api/v1/datasets/local%2Fsynthetic/releases/synthetic-id'},{method:'POST' as const,path:'/api/repos/:namespace/:repo/snapshots',url:'/api/repos/local/synthetic/snapshots'},{method:'POST' as const,path:'/api/repos/:namespace/:repo/releases/:id/publish',url:'/api/repos/local/synthetic/releases/synthetic-id/publish'}]){
    const app=Fastify(),budget=new CapacityBudget({reads:2,heavy:1,queuedHeavy:0,queueTimeoutMs:1000});installCapacityBudget(app,budget);
    let started!:()=>void,finish!:()=>void,calls=0;const ready=new Promise<void>(resolve=>started=resolve),pending=new Promise<void>(resolve=>finish=resolve);
    app.route({method:entry.method,url:entry.path,handler:async()=>{calls++;assert.equal(budget.snapshot().activeHeavy,1);if(calls===1){started();await pending;}return {done:true};}});
    app.get('/api/health',async()=>({ready:true}));
    const first=app.inject({method:entry.method,url:entry.url,payload:{}}).then(value=>value);await ready;
    assert.equal((await app.inject({method:entry.method,url:entry.url,payload:{}})).statusCode,429);
    assert.equal((await app.inject('/api/health')).statusCode,200);assert.equal(calls,1);
    finish();assert.equal((await first).statusCode,200);assert.equal(budget.snapshot().activeHeavy,0);
    assert.equal((await app.inject({method:entry.method,url:entry.url,payload:{}})).statusCode,200);await app.close();
  }
});

test('capacity budgets reject excess reads and release idempotently without blocking lightweight work',async()=>{
  const budget=new CapacityBudget({reads:1,heavy:1,queuedHeavy:1,queueTimeoutMs:1000}),release=budget.acquire('read');
  assert.throws(()=>budget.acquire('read'),(error:any)=>error.code==='CAPACITY_BUSY');release();release();assert.equal(budget.snapshot().activeReads,0);
  await assert.rejects(()=>budget.runHeavy(async()=>{await budget.runHeavy(async()=>{});}),error=>(error as any).code==='HEAVY_WORK_BUSY');
  assert.equal(budget.snapshot().activeHeavy,0);
});
test('one heavy execution runs at a time and bounded waiting resumes even after task failure',async()=>{
  const budget=new CapacityBudget({reads:4,heavy:1,queuedHeavy:1,queueTimeoutMs:1000}),order:string[]=[];let finish!:()=>void;
  const first=budget.runHeavy(async()=>{order.push('first');await new Promise<void>(resolve=>finish=resolve);throw new Error('Synthetic failure');});
  const second=budget.runHeavy(async()=>{order.push('second');},true);await assert.rejects(()=>budget.runHeavy(async()=>{},true),(error:any)=>error.code==='HEAVY_WORK_BUSY');
  assert.deepEqual(order,['first']);finish();await assert.rejects(first,/Synthetic failure/);await second;assert.deepEqual(order,['first','second']);assert.equal(budget.snapshot().activeHeavy,0);assert.equal(budget.snapshot().queuedHeavy,0);
});
test('request budget remains held for the whole handler and releases after errors',async()=>{
  const app=Fastify(),budget=new CapacityBudget({reads:1,heavy:1,queuedHeavy:0,queueTimeoutMs:1000});installCapacityBudget(app,budget);
  let ready!:()=>void,finish!:()=>void;const started=new Promise<void>(resolve=>ready=resolve);
  app.post('/api/repos/:namespace/:repo/dataset/query',async()=>{ready();await new Promise<void>(resolve=>finish=resolve);throw new Error('Synthetic failure');});app.get('/api/health',async()=>({ready:true}));
  const first=app.inject({method:'POST',url:'/api/repos/test/test/dataset/query',payload:{}});await started;
  assert.equal((await app.inject('/api/health')).statusCode,200);assert.equal((await app.inject({method:'POST',url:'/api/repos/test/test/dataset/query',payload:{}})).statusCode,429);
  finish();assert.equal((await first).statusCode,500);assert.equal(budget.snapshot().activeReads,0);assert.equal(budget.snapshot().recentRequests,1);await app.close();
});

test('socket closure cannot free capacity while the underlying handler is still running',async()=>{
  const app=Fastify(),budget=new CapacityBudget({reads:1,heavy:1,queuedHeavy:0,queueTimeoutMs:1000});installCapacityBudget(app,budget);
  let ready!:()=>void,finish!:()=>void;const started=new Promise<void>(resolve=>ready=resolve);
  app.post('/api/repos/:namespace/:repo/dataset/query',async(_request,reply)=>{reply.raw.emit('close');ready();await new Promise<void>(resolve=>finish=resolve);return {completed:true};});
  const first=app.inject({method:'POST',url:'/api/repos/test/test/dataset/query',payload:{}}).then(response=>({response,error:undefined}),error=>({response:undefined,error}));await started;
  assert.equal(budget.snapshot().activeReads,1,'The socket can close before the upstream operation finishes');
  assert.equal((await app.inject({method:'POST',url:'/api/repos/test/test/dataset/query',payload:{}})).statusCode,429);
  finish();assert.equal((await first).error.code,'LIGHT_ECONNRESET');await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(budget.snapshot().activeReads,0);await app.close();
});
