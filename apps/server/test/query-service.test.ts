import test from 'node:test';
import assert from 'node:assert/strict';
import { queryDataset } from '../src/query-service.js';
import type { Provider } from '../src/provider.js';
test('Model queries require explicit metadata-sharing consent before reading private data',async()=>{
 await assert.rejects(queryDataset({} as Provider,{namespace:'a',repo:'b'},'main','a.jsonl','count','model'),/明确允许/);
});
test('Local query scans the full JSONL file beyond the first 500 rows without sending metadata externally',async()=>{
 const provider={branches:async()=>[{name:'main',commitId:'fixed-version',isDefault:true}],raw:async(_key:unknown,ref:string)=>{assert.equal(ref,'fixed-version');return {content:Buffer.from(Array.from({length:800},(_,id)=>JSON.stringify({id,label:id>=500?1:0,meta:{value:null}})).join('\n')),mime:'application/x-ndjson',filename:'a.jsonl'};}} as unknown as Provider;
 const result=await queryDataset(provider,{namespace:'a',repo:'b'},'main','a.jsonl','统计 label 等于 1','rules');
 assert.equal(result.scannedRows,800);assert.equal(result.sourceRows,800);assert.equal(result.rows[0]?.count,300);
});
