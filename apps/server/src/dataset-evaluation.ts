import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { DatasetEvaluation, EvaluationExposure, EvaluationPolicy, EvaluationRow } from '../../../packages/shared/src/evaluation.js';
import type { RequestIdentity } from '../../../packages/shared/src/index.js';
import type { Provider, RepoKey } from './provider.js';
import type { RepositorySettingsService } from './repository-settings.js';
import { ApiError } from './errors.js';
import { durableWriteJson } from './durable-store.js';
import { storedJson } from './dataset-storage.js';
import { safeSegment } from './safety.js';
import { operationContext } from './operation-context.js';

/** Versioned local extension, never a source JSONL column or a human annotation. */
export const DATASET_EVALUATION_PATH = '.oxenweb/dataset/evaluation.json';
export const evaluationRowSchema = z.object({ visibility:z.enum(['shared','holdout']).nullable(), suites:z.array(z.enum(['gold','regression'])).max(2), familyId:z.string().trim().min(1).max(200).nullable() }).strict().refine(row=>new Set(row.suites).size===row.suites.length,'用途不能重复。');
export const evaluationPatchSchema = z.object({ visibility:z.enum(['shared','holdout']).nullable().optional(), suites:z.array(z.enum(['gold','regression'])).max(2).optional(), familyId:z.string().trim().min(1).max(200).nullable().optional() }).strict().refine(patch=>Object.keys(patch).length>0,'请至少修改一个分组属性。').refine(patch=>!patch.suites||new Set(patch.suites).size===patch.suites.length,'用途不能重复。');
const actor=z.object({id:z.string().min(1).max(500),name:z.string().min(1).max(500)}).strict();
const activity=z.object({updatedAt:z.string().datetime(),actor}).strict();
/** Stable imported IDs are data, including names inherited by ordinary JS objects. */
function evaluationRecord<T>(schema:z.ZodType<T>){return z.custom<Record<string,unknown>>(value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null)).transform((value,context):Record<string,T>=>{const result:Record<string,T>=Object.create(null);for(const [id,entry]of Object.entries(value)){const parsed=schema.safeParse(entry);if(!id||id.length>200||!parsed.success)context.addIssue({code:'custom',message:'稳定身份或分组记录无效。'});else result[id]=parsed.data;}return result;});}
export const evaluationDocumentSchema=z.object({version:z.literal(1),rows:evaluationRecord(evaluationRowSchema),activity:evaluationRecord(activity).optional()}).strict();
export type EvaluationDocument=z.infer<typeof evaluationDocumentSchema>;
const policySchema=z.object({enabled:z.literal(true),enabledAt:z.string().datetime(),enabledBy:actor,operationId:z.string().max(256).optional()}).strict();
const policyFileSchema=z.object({version:z.literal(1),projects:z.record(z.string(),policySchema)}).strict();
const emptyRow=():EvaluationRow=>({visibility:null,suites:[],familyId:null});
export async function readEvaluationDocument(provider:Provider,key:RepoKey,ref:string):Promise<EvaluationDocument>{
  const value=await storedJson(provider,key,ref,DATASET_EVALUATION_PATH);if(value===undefined)return {version:1,rows:Object.create(null)};
  const result=evaluationDocumentSchema.safeParse(value);
  if(!result.success)throw new ApiError(422,'EVALUATION_METADATA_INVALID','发布分组元数据格式无效；未把未知条目当作可共享样本。');
  return result.data;
}
export function evaluationView(document:EvaluationDocument,ids:string[],enabled:boolean):DatasetEvaluation{
  const rows=Object.fromEntries(ids.map(id=>[id,Object.hasOwn(document.rows,id)?document.rows[id]!:emptyRow()]));
  const counts={shared:0,holdout:0,unclassified:0,gold:0,regression:0};
  for(const row of Object.values(rows)){counts[row.visibility??'unclassified']++;for(const suite of row.suites)counts[suite]++;}
  return {enabled,rows,counts};
}
/** Apply the whole batch first; family constraints must not depend on selection order. */
export function assertEvaluationFamilies(rows:Record<string,EvaluationRow>):void{
  const families=new Map<string,string>();
  for(const row of Object.values(rows)){if(!row.familyId||!row.visibility)continue;const previous=families.get(row.familyId);if(previous&&previous!==row.visibility)throw new ApiError(409,'EVALUATION_FAMILY_SPLIT','同一关联组不能同时包含共享与隐藏样本，请整组调整。');families.set(row.familyId,row.visibility);}
}
export function assertEvaluationExposure(rows:Record<string,EvaluationRow>,exposure:EvaluationExposure,attachments:Array<{rowIds:string[];sha256?:string}>=[]):void{
  const exposedIds=new Set(exposure.rowIds),families=new Set(exposure.familyIds),hashes=new Set(exposure.attachmentHashes??[]);
  const exposedAttachmentRows=new Set(attachments.filter(attachment=>!!attachment.sha256&&hashes.has(attachment.sha256)).flatMap(attachment=>attachment.rowIds));
  for(const [id,row]of Object.entries(rows))if(row.visibility==='holdout'&&(exposedIds.has(id)||!!row.familyId&&families.has(row.familyId)||exposedAttachmentRows.has(id)))throw new ApiError(409,'EVALUATION_ALREADY_EXPOSED','已发布共享的样本、关联组或相同附件不能重新声明为未曝光隐藏集。');
}
/** Sticky control-plane policy is deliberately outside repository history and included in control backups. */
export class EvaluationPolicyService {
  private projects:Record<string,z.infer<typeof policySchema>>={};private chain=Promise.resolve();private uncertain=false;
  constructor(readonly filename:string,private settings:RepositorySettingsService,private authorize:(key:RepoKey,identity:RequestIdentity)=>Promise<void>,private authorizeRelease?:(key:RepoKey,identity:RequestIdentity)=>Promise<void>){}
  private key(key:RepoKey){return safeSegment(key.namespace)+'/'+safeSegment(key.repo);}
  async init(){try{this.projects=policyFileSchema.parse(JSON.parse(await readFile(this.filename,'utf8'))).projects;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
  private assertCertain(){if(this.uncertain)throw new ApiError(503,'EVALUATION_POLICY_UNCERTAIN','受限主库策略写入结果待核对；请核对控制面文件并重启，当前不会退回普通发布模式。');}
  async policy(key:RepoKey):Promise<EvaluationPolicy>{this.assertCertain();return structuredClone(this.projects[this.key(key)]??{enabled:false});}
  async isEnabled(key:RepoKey){this.assertCertain();return !!this.projects[this.key(key)]?.enabled;}
  /** Never silently disable safety after an incomplete control-plane restore. */
  reconcileRequired(keys:RepoKey[]):void{for(const key of keys)if(!this.projects[this.key(key)]?.enabled)throw new ApiError(503,'EVALUATION_POLICY_RECOVERY_REQUIRED','存在分层发布记录但受限主库安全策略缺失；请恢复同批控制面备份后启动。');}
  async assertPrivate(key:RepoKey){if(await this.isEnabled(key)&&(await this.settings.read(key)).policy.visibility!=='private')throw new ApiError(409,'EVALUATION_PRIVATE_REQUIRED','受限评测主库必须保持私有；请先恢复项目权限。');}
  async assertVisibility(key:RepoKey,visibility:string){if(visibility!=='private'&&await this.isEnabled(key))throw new ApiError(409,'EVALUATION_PRIVATE_REQUIRED','已启用发布分组的受限主库不能改为公开项目。');}
  async activate(key:RepoKey,identity:RequestIdentity):Promise<EvaluationPolicy>{
    return this.activateWith(key,identity,this.authorize);
  }
  /** Internal Release creation only: tighten private-master access without modifying source data. */
  async activateForRelease(key:RepoKey,identity:RequestIdentity):Promise<EvaluationPolicy>{
    return this.activateWith(key,identity,this.authorizeRelease??this.authorize);
  }
  private async activateWith(key:RepoKey,identity:RequestIdentity,authorize:(key:RepoKey,identity:RequestIdentity)=>Promise<void>):Promise<EvaluationPolicy>{
    this.assertCertain();
    return this.settings.withPolicyLock(key,async()=>{
      await authorize(key,identity);if((await this.settings.read(key)).policy.visibility!=='private')throw new ApiError(409,'EVALUATION_PRIVATE_REQUIRED','仅可在私有受限主库启用发布分组。');
      const work=this.chain.then(async()=>{this.assertCertain();await authorize(key,identity);if(this.projects[this.key(key)])return this.policy(key);const execution=operationContext.getStore(),next={...this.projects,[this.key(key)]:{enabled:true as const,enabledAt:new Date().toISOString(),enabledBy:{id:identity.id,name:identity.name},...(execution?{operationId:execution.id}:{})}};if(execution)execution.writeAttempted=true;try{await durableWriteJson(this.filename,{version:1,projects:next});}catch(error){this.uncertain=true;throw error;}this.projects=next;return this.policy(key);});
      this.chain=work.then(()=>{},()=>{});return work;
    });
  }
}
