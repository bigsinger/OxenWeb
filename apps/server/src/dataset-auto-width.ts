import { randomInt } from 'node:crypto';
import { z } from 'zod';
import type { DatasetAutoWidthInput, DatasetAutoWidthPlan } from '../../../packages/shared/src/dataset-auto-width.js';
import type { RequestIdentity } from '../../../packages/shared/src/index.js';
import type { DatasetService } from './dataset.js';
import type { RepoKey } from './provider.js';
import { safeRef } from './safety.js';
import { ApiError } from './errors.js';

export const datasetAutoWidthSchema = z.object({
  ref: z.string().min(1).max(160).transform(safeRef),
  expectedCommit: z.string().min(1).max(160).transform(safeRef),
  fields: z.array(z.object({id:z.string().min(1).max(500),displayName:z.string().max(120).optional()}).strict()).min(1).max(500),
}).strict().superRefine((value,ctx)=>{if(new Set(value.fields.map(field=>field.id)).size!==value.fields.length)ctx.addIssue({code:'custom',message:'字段 ID 不能重复。',path:['fields']});});

/** Uniform selection without replacement; injectable randomness makes the policy testable. */
export function randomSampleIndices(total:number,limit=200,draw:(max:number)=>number=randomInt):number[]{
  const count=Math.min(total,limit),swaps=new Map<number,number>(),result:number[]=[];
  for(let index=0;index<count;index++){
    const pick=index+draw(total-index),value=swaps.get(pick)??pick;
    swaps.set(pick,swaps.get(index)??index);result.push(value);
  }
  return result;
}

/** Bounded textual estimate, rather than serialization of arbitrarily large nested records. */
function preview(value:unknown):string{
  let budget=512,nodes=64;
  const take=(text:string)=>{const part=text.slice(0,Math.max(0,budget));budget-=part.length;return part;};
  function visit(item:unknown,depth:number):string{
    if(budget<=0||nodes--<=0)return '…';
    if(typeof item==='string')return take(item);
    if(item===null||typeof item!=='object')return take(String(item));
    if(depth>=6)return take('…');
    if(Array.isArray(item)){const parts:string[]=[];for(const child of item){if(budget<=0||nodes<=0)break;parts.push(visit(child,depth+1));}return '['+parts.join(', ')+']';}
    const parts:string[]=[];for(const [key,child] of Object.entries(item)){if(budget<=0||nodes<=0)break;parts.push(take(key)+': '+visit(child,depth+1));}return '{'+parts.join(', ')+'}';
  }
  return visit(value,0);
}
export function displayUnits(value:unknown):number{
  let width=0,longest=0;
  for(const char of preview(value)){
    if(char==='\n'||char==='\r'){longest=Math.max(longest,width);width=0;continue;}
    const point=char.codePointAt(0)!;
    if(/\p{Mark}/u.test(char)||point===0x200d||point===0xfe0f)continue;
    width+=char==='\t'?4:point>=0x1100&&(point<=0x115f||point>=0x2e80)?2:1;
    if(width>=112)return 112;
  }
  return Math.min(112,Math.max(longest,width));
}
export function estimateAutoWidths(rows:Record<string,unknown>[],fields:DatasetAutoWidthInput['fields'],indices:number[]):DatasetAutoWidthPlan['fields']{
  return fields.map(field=>{
    const lengths=indices.flatMap(index=>{const row=rows[index];return row&&Object.hasOwn(row,field.id)&&row[field.id]!==null?[displayUnits(row[field.id])]:[];}).sort((a,b)=>a-b);
    const p85=lengths.length?lengths[Math.max(0,Math.ceil(lengths.length*.85)-1)]!:0;
    const units=Math.min(112,Math.max(8,displayUnits(field.id+(field.displayName?' '+field.displayName:'')),p85));
    return {id:field.id,weight:Math.max(1,Math.round(units/10*2)/2),sampledValues:lengths.length,displayUnits:units};
  });
}
export class DatasetAutoWidthService {
  constructor(readonly datasets:DatasetService,readonly authorize:(key:RepoKey,identity:RequestIdentity)=>Promise<unknown>){}
  async plan(key:RepoKey,identity:RequestIdentity,input:DatasetAutoWidthInput):Promise<DatasetAutoWidthPlan>{
    const parsed=datasetAutoWidthSchema.parse(input);await this.authorize(key,identity);
    await this.datasets.assertDraftHead(key,parsed.ref,parsed.expectedCommit);
    const snapshot=await this.datasets.read(key,parsed.expectedCommit);
    const indices=randomSampleIndices(snapshot.rows.length);
    const fields=estimateAutoWidths(snapshot.rows,parsed.fields,indices);
    await this.authorize(key,identity);await this.datasets.assertDraftHead(key,parsed.ref,parsed.expectedCommit);
    if(snapshot.commitId!==parsed.expectedCommit)throw new ApiError(409,'DATASET_VERSION_CONFLICT','自动适配的样本版本已经变化，请重新读取。');
    return {commitId:snapshot.commitId,totalRows:snapshot.totalRows,sampledRows:indices.length,method:'random-p85',fields};
  }
}
