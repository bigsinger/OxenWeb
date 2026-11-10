import type { DatasetSnapshot } from '../../../packages/shared/src/dataset.js';
import type { EvaluationRow } from '../../../packages/shared/src/evaluation.js';
import { GLOBAL_DATASET_FIELD_IDS } from '../../../packages/shared/src/global-fields.js';
import { ApiError } from './errors.js';

/** Local source-schema convention, never an assertion that Oxen provides row-level ACLs. */
export const DIMENSION_SELECTION_RULES = 'dataset-four-dimensions-v1';
export const LEGACY_SELECTION_RULES = 'evaluation-views-v1';
export const hasDatasetDimensions = (snapshot:DatasetSnapshot):boolean => GLOBAL_DATASET_FIELD_IDS.every(id=>Object.hasOwn(snapshot.descriptor.fields??{},id));
const validSplit = new Set(['train','dev','test']);
const validQuality = new Set(['normal','gold']);
const validVisibility = new Set(['internal','hidden','shared','public']);
export function completeDatasetDimensions(source:Record<string,unknown>):boolean{return typeof source.split==='string'&&validSplit.has(source.split)&&typeof source.quality==='string'&&validQuality.has(source.quality)&&typeof source.visibility==='string'&&validVisibility.has(source.visibility)&&Array.isArray(source.purposes);}

/** A fixed Release derives views from four independent dimensions, not the old suite names. */
export function dimensionDeliveryRows(snapshot:DatasetSnapshot):Record<string,EvaluationRow>{
  const fields=snapshot.descriptor.fields??{},purposeOptions=fields.purposes?.items?.enum;
  const exactOptions=(id:'split'|'quality'|'visibility',allowed:Set<string>)=>{const field=fields[id];return field?.type==='string'&&!!field.enum&&field.enum.length===allowed.size&&field.enum.every(value=>typeof value==='string'&&allowed.has(value));};
  if(!exactOptions('split',validSplit)||!exactOptions('quality',validQuality)||!exactOptions('visibility',validVisibility)||fields.purposes?.type!=='array'||fields.purposes.items?.type!=='string'||!purposeOptions?.length||purposeOptions.some(value=>typeof value!=='string')||new Set(purposeOptions).size!==purposeOptions.length)throw new ApiError(422,'RELEASE_DIMENSION_SCHEMA','四维字段规范不完整或类型、选项不符合发布规则；请同步全局字段规范后重新核对。');
  const result:Record<string,EvaluationRow>=Object.create(null),familySplits=new Map<string,Set<string>>();
  snapshot.rows.forEach((source,index)=>{
    const id=snapshot.rowIds[index]!,familyId=snapshot.evaluation?.rows[id]?.familyId??null;
    const split=source.split,quality=source.quality,visibility=source.visibility,purposes=source.purposes;
    for(const [field,value,allowed] of [['split',split,validSplit],['quality',quality,validQuality],['visibility',visibility,validVisibility]] as const){
      if(value!==undefined&&value!==null&&(typeof value!=='string'||!allowed.has(value)))throw new ApiError(422,'RELEASE_DIMENSION_VALUE','存在不受当前发布规则支持的四维字段值；请核对字段配置和样本。',{rowId:id,field});
    }
    if(purposes!==undefined&&purposes!==null&&(!Array.isArray(purposes)||purposes.some(value=>typeof value!=='string')||new Set(purposes).size!==purposes.length))throw new ApiError(422,'RELEASE_DIMENSION_VALUE','使用用途必须为不重复的字符串列表。',{rowId:id,field:'purposes'});
    if(Array.isArray(purposes)&&purposes.some(value=>!purposeOptions.includes(value)))throw new ApiError(422,'RELEASE_DIMENSION_VALUE','使用用途包含当前固定字段规范之外的选项。',{rowId:id,field:'purposes'});
    if(familyId&&typeof split==='string'){
      const splits=familySplits.get(familyId)??new Set<string>();splits.add(split);familySplits.set(familyId,splits);
    }
    const complete=completeDatasetDimensions(source);
    const shared=complete&&(visibility==='shared'||visibility==='public');
    const holdout=complete&&visibility==='hidden'&&split==='test';
    result[id]={familyId,visibility:shared?'shared':holdout?'holdout':null,suites:shared?[...(split==='test'&&quality==='gold'?['gold' as const]:[]),...(split==='dev'&&(purposes as string[]).includes('regression')?['regression' as const]:[])]:[]};
    // A hidden training/dev row is a valid stored declaration, but never an acceptance-set member.
  });
  if([...familySplits.values()].some(splits=>splits.size>1))throw new ApiError(409,'RELEASE_SPLIT_FAMILY_OVERLAP','同一已知同源组跨越 train、dev、test；请在当前划分版本内整组调整。');
  return result;
}
