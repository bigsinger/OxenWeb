import { z } from 'zod';
import type { DatasetFieldMetadata } from '../../../packages/shared/src/field-metadata.js';
import type { DatasetFieldConflictSummary } from '../../../packages/shared/src/dataset-field-types.js';
import { datasetFieldTypeMatches, datasetRecordFieldIssues } from '../../../packages/shared/src/dataset-field-validation.js';
import { ApiError } from './errors.js';
import {fieldOptionKey} from '../../../packages/shared/src/field-option-colors.js';

const option=z.union([z.string().max(4000),z.number().finite(),z.boolean()]);
const options=z.array(option).min(1).max(200).refine(values=>new Set(values.map(value=>JSON.stringify([typeof value,value]))).size===values.length,'选项的原始类型和值必须唯一。');
const scalarType=z.enum(['string','number','integer','boolean']);
export const datasetFieldMetadataSchema=z.object({
  displayName:z.string().max(120).optional(),description:z.string().max(4000).optional(),
  type:z.enum(['string','number','integer','boolean','array','object']).optional(),nullable:z.boolean().optional(),required:z.boolean().optional(),
  enum:options.optional(),items:z.object({type:scalarType.optional(),enum:options.optional()}).strict().optional(),
  width:z.discriminatedUnion('mode',[z.object({mode:z.literal('fixed'),value:z.number().int().min(48).max(2400)}).strict(),z.object({mode:z.literal('weight'),value:z.number().positive().max(1000),min:z.number().int().min(48).max(500).optional(),max:z.number().int().min(48).max(500).optional()}).strict().refine(width=>width.min===undefined||width.max===undefined||width.min<=width.max,'列宽下限不能超过上限。')]).optional(),
  order:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  export:z.boolean().optional(),
  visible:z.boolean().optional(),
  globalField:z.object({id:z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),revision:z.number().int().positive()}).strict().optional(),
  optionColors:z.record(z.string().min(1).max(5000),z.string().regex(/^#[0-9a-f]{6}$/i)).refine(value=>Object.keys(value).length<=200,'最多为200个选项配置颜色。').optional(),
  optionLabels:z.record(z.string().min(1).max(5000),z.string().trim().min(1).max(120)).refine(value=>Object.keys(value).length<=200,'最多为200个选项配置显示名。').optional(),
}).strict().superRefine((field,context)=>{
  if(field.enum&&(field.type==='array'||field.type==='object'))context.addIssue({code:'custom',path:['enum'],message:'对象或列表不能使用单选选项；列表请配置元素选项。'});
  if(field.items&&field.type!=='array')context.addIssue({code:'custom',path:['items'],message:'元素约束只能用于列表 array。'});
  if(field.enum&&field.type&&field.enum.some(value=>!datasetFieldTypeMatches(value,field.type!)))context.addIssue({code:'custom',path:['enum'],message:'选项必须符合字段原始类型，系统不会转换数值、布尔和文字。'});
  if(field.items?.enum&&field.items.type&&field.items.enum.some(value=>!datasetFieldTypeMatches(value,field.items!.type!)))context.addIssue({code:'custom',path:['items','enum'],message:'列表选项必须符合元素类型。'});
  if(field.optionColors){const keys=new Set((field.enum??field.items?.enum??[]).map(fieldOptionKey));if(Object.keys(field.optionColors).some(key=>!keys.has(key)))context.addIssue({code:'custom',path:['optionColors'],message:'选项颜色只能对应当前单选或多选的原始类型和值。'});}
  if(field.optionLabels){const keys=new Set((field.enum??field.items?.enum??[]).map(fieldOptionKey));if(Object.keys(field.optionLabels).some(key=>!keys.has(key)))context.addIssue({code:'custom',path:['optionLabels'],message:'选项显示名只能对应当前单选或多选的原始类型和值。'});}
});
// Inspect original keys before Zod's record parser can omit __proto__.
export const datasetFieldsSchema=z.unknown().superRefine((value,context)=>{
  if(value&&typeof value==='object'&&!Array.isArray(value))for(const id of Object.keys(value))if(['__proto__','constructor','prototype'].includes(id.toLowerCase()))context.addIssue({code:'custom',path:[id],message:'字段ID不能使用对象保留名称。'});
}).pipe(z.record(z.string().min(1).max(500).refine(id=>!!id.trim(),'字段ID不能为空白。'),datasetFieldMetadataSchema))
  .refine(fields=>Object.keys(fields).length<=500,'最多配置500个样本字段。')
  .refine(fields=>Buffer.byteLength(JSON.stringify(fields))<=2*1024*1024,'字段配置不能超过2MiB。');

export function datasetFieldConflicts(rows:Record<string,unknown>[],rowIds:string[],fields:Readonly<Record<string,DatasetFieldMetadata>>):DatasetFieldConflictSummary{
  let conflictCount=0,affectedRows=0;const conflicts:DatasetFieldConflictSummary['conflicts']=[];
  rows.forEach((row,index)=>{const issues=datasetRecordFieldIssues(row,fields);if(issues.length)affectedRows++;conflictCount+=issues.length;for(const issue of issues)if(conflicts.length<100)conflicts.push({...issue,rowId:rowIds[index]!});});
  return {conflictCount,affectedRows,conflicts,truncated:conflictCount>conflicts.length};
}
export function assertDatasetFields(rows:Record<string,unknown>[],rowIds:string[],fields:Readonly<Record<string,DatasetFieldMetadata>>|undefined){
  if(!fields||!Object.keys(fields).length)return;
  const summary=datasetFieldConflicts(rows,rowIds,fields);
  if(summary.conflictCount)throw new ApiError(422,'DATASET_FIELD_CONFLICTS',`有 ${summary.affectedRows} 条样本与字段配置冲突，共 ${summary.conflictCount} 项；未转换或保存数据。`,summary);
}
