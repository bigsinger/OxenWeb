import type {LabelColumn} from '../../../packages/shared/src/index';
import type {DatasetOperation} from '../../../packages/shared/src/dataset';
import type {DatasetFieldMetadata} from '../../../packages/shared/src/field-metadata';
import {sourceFieldIsReadOnly} from '../../../packages/shared/src/source-record';
import {fieldOptionKey} from '../../../packages/shared/src/field-option-colors';
import {datasetRecordConfigurationError,parseEditableCell,type DatasetEditableCellDraft} from './dataset-configured-editing';
import {datasetFieldOptionMatches} from '../../../packages/shared/src/dataset-field-validation';
import {sameDatasetValue} from './dataset-change-state';
import {stageDatasetRecord} from './dataset-cell-editing';

export type DatasetBulkAction='replace'|'add'|'remove'|'clear'|'null'|'missing';
export interface DatasetBulkEditRequest {
  target:{scope:'source'|'label';id:string}; action:DatasetBulkAction; draft:DatasetEditableCellDraft;
}
export interface DatasetBulkRow {
  id:string; record?:Record<string,unknown>; labels?:Record<string,string|string[]|null>;
  canEdit:boolean; canAssign:boolean; expectedContentHash?:string;
}
export interface DatasetBulkContext {
  selectedIds:string[]; rows:DatasetBulkRow[]; fields:Record<string,DatasetFieldMetadata>;
  sourceFieldIds:string[]; labelColumns:LabelColumn[]; identityField:string;
}
export interface DatasetBulkPlan {
  selectedIds:string[]; eligibleIds:string[]; excluded:Array<{id:string;reason:string}>;
  changes:Array<{id:string;before:unknown;after:unknown}>; unchangedIds:string[]; missingIds:string[];
  operations:DatasetOperation[]; target:DatasetBulkEditRequest['target']; action:DatasetBulkAction;
}
export function emptyDatasetBulkEditRequest():DatasetBulkEditRequest{return {target:{scope:'source',id:''},action:'replace',draft:{kind:'string',text:'',presence:'value'}};}
export function isDatasetBulkEditRequest(value:unknown):value is DatasetBulkEditRequest {
  if(!value||typeof value!=='object')return false;
  const request=value as DatasetBulkEditRequest;
  return !!request.target&&['source','label'].includes(request.target.scope)&&typeof request.target.id==='string'&&request.target.id.length<=500&&['replace','add','remove','clear','null','missing'].includes(request.action)&&!!request.draft&&['string','number','boolean','null','array','object'].includes(request.draft.kind)&&typeof request.draft.text==='string'&&['value','null','missing'].includes(request.draft.presence);
}
export function bulkLabelDefinition(column:LabelColumn):DatasetFieldMetadata {
  return {type:column.type==='multi'?'array':'string',nullable:true,required:false,...(column.type==='single'?{enum:column.options?.map(option=>option.value)??[]} : column.type==='multi'?{items:{type:'string',enum:column.options?.map(option=>option.value)??[]}}:{}),optionLabels:Object.fromEntries((column.options??[]).map(option=>[fieldOptionKey(option.value),option.displayName??option.value]))};
}
const primitive=(value:unknown):value is string|number|boolean=>typeof value==='string'||typeof value==='number'&&Number.isFinite(value)||typeof value==='boolean';
function members(value:unknown):Array<string|number|boolean>{
  if(value===undefined||value===null)return [];
  if(!Array.isArray(value)||value.some(item=>!primitive(item)))throw new Error('增减选项只适用于由文本、数字或布尔值组成的多选列表。');
  return value;
}
function unique(values:Array<string|number|boolean>){return values.filter((value,index)=>values.findIndex(other=>datasetFieldOptionMatches(other,value))===index);}
function modify(old:unknown,request:DatasetBulkEditRequest,definition:DatasetFieldMetadata):{present:boolean;value?:unknown}{
  if(request.action==='missing')return parseEditableCell({...request.draft,presence:'missing'},definition);
  if(request.action==='null')return parseEditableCell({...request.draft,presence:'null'},definition);
  if(request.action==='clear'){
    if(definition.type!=='array')throw new Error('清空列表只适用于多选或数组字段；单选可选择设为 null 或移除值。');
    return parseEditableCell({kind:'array',text:'[]',presence:'value'},definition);
  }
  const entered=parseEditableCell({...request.draft,presence:'value'},definition);
  if(request.action==='replace')return entered;
  if(definition.type!=='array')throw new Error('只有多选或数组字段支持批量增加、移除选项。');
  const selection=members(entered.value);if(!selection.length)throw new Error('请至少选择一个需要增加或移除的选项。');
  // Removing a choice is not permission to invent an empty value in an unset record.
  if(request.action==='remove'&&(old===undefined||old===null))return old===null?{present:true,value:null}:{present:false};
  const previous=members(old),value=request.action==='add'?unique([...previous,...selection]):previous.filter(item=>!selection.some(candidate=>datasetFieldOptionMatches(item,candidate)));
  return parseEditableCell({kind:'array',text:JSON.stringify(value),presence:'value'},definition);
}
/** Exact stable selection only. A missing row blocks the whole preview rather than narrowing it silently. */
export function planDatasetBulkEdit(context:DatasetBulkContext,request:DatasetBulkEditRequest):DatasetBulkPlan {
  if(!isDatasetBulkEditRequest(request)||!request.target.id)throw new Error('请先选择需要批量修改的字段。');
  const selectedIds=[...context.selectedIds];if(!selectedIds.length||selectedIds.length>500)throw new Error('请选中 1–500 条样本后批量编辑。');
  if(new Set(selectedIds).size!==selectedIds.length||new Set(context.rows.map(row=>row.id)).size!==context.rows.length)throw new Error('样本身份重复，未生成任何修改；请重新读取所选样本。');
  const rows=new Map(context.rows.map(row=>[row.id,row])),missingIds=selectedIds.filter(id=>!rows.has(id)||!rows.get(id)!.record);
  if(missingIds.length)throw new Error(`有 ${missingIds.length} 条已选样本尚未读取，未生成任何修改。请重新读取所选样本。`);
  const field=request.target.id,label=request.target.scope==='label'?context.labelColumns.find(column=>column.id===field&&(!column.scopes||column.scopes.includes('row'))):undefined;
  if(request.target.scope==='source'&&!context.sourceFieldIds.includes(field)||request.target.scope==='label'&&!label)throw new Error('当前数据集没有此可编辑字段，请重新选择。');
  if(request.target.scope==='source'&&selectedIds.some(id=>sourceFieldIsReadOnly(field,context.identityField,rows.get(id)!.record!)))throw new Error('身份、来源证据及既有源真值字段不能批量修改。');
  const configured=context.fields[field]??{},definition=label?bulkLabelDefinition(label):configured.type?configured:{...configured,...(request.draft.kind==='null'?{}:{type:request.draft.kind})};
  const plan:DatasetBulkPlan={selectedIds,eligibleIds:[],excluded:[],changes:[],unchangedIds:[],missingIds:[],operations:[],target:{...request.target},action:request.action};
  for(const id of selectedIds){
    const row=rows.get(id)!;
    if(request.target.scope==='source'?!row.canEdit:!row.canAssign){plan.excluded.push({id,reason:request.target.scope==='source'?'当前样本无内容编辑权限':'当前样本无人工标注权限'});continue;}
    plan.eligibleIds.push(id);
    if(label){
      if(request.action==='null'||request.action==='missing')throw new Error('人工标签请使用“清空我的取值”。');
      const before=row.labels?.[field]??null,after=request.action==='clear'||request.action==='remove'&&before===null?null:modify(before,request,definition).value;
      if(after!==null&&typeof after!=='string'&&(!Array.isArray(after)||after.some(value=>typeof value!=='string')))throw new Error('人工标签仅支持文本或文本选项列表。');
      const beforeValues=Array.isArray(before)?before:[before],afterValues=Array.isArray(after)?after:[after];
      if(afterValues.some(value=>label.options?.some(option=>option.value===value&&option.deprecated)&&!beforeValues.includes(value as string)))throw new Error('不能为新的样本使用已弃用的人工标签选项。');
      if(sameDatasetValue(before,after)||request.action==='clear'&&(before===null||before===''||Array.isArray(before)&&!before.length)){plan.unchangedIds.push(id);continue;}
      plan.changes.push({id,before,after});plan.operations.push({op:'assign',scope:'row',rowId:id,values:{[field]:after as string|string[]|null}});
    }else{
      const before=Object.hasOwn(row.record!,field)?{present:true,value:row.record![field]}:{present:false};
      const after=modify(row.record![field],request,definition),record={...row.record};if(after.present)record[field]=after.value;else delete record[field];
      const issue=datasetRecordConfigurationError(record,context.fields);if(issue)throw new Error(`样本 ${id}：${issue}，未生成任何修改。`);
      if(sameDatasetValue(before,after)){plan.unchangedIds.push(id);continue;}
      plan.changes.push({id,before,after});plan.operations.push({op:'update',rowId:id,record,...(row.expectedContentHash?{expectedContentHash:row.expectedContentHash}:{})});
    }
  }
  return plan;
}
/** Preserve unrelated pending content/opinions and fragment annotations when adding a confirmed batch. */
export function stageDatasetBulkPlan(operations:DatasetOperation[],plan:DatasetBulkPlan):DatasetOperation[]{
  let result=[...operations];
  for(const operation of plan.operations){
    if(operation.op==='update'){result=stageDatasetRecord(result,operation.rowId,operation.record,operation.expectedContentHash);continue;}
    if(operation.op==='assign'&&operation.scope==='row'&&operation.rowId){
      const previous=result.find(item=>item.op==='assign'&&item.scope==='row'&&item.rowId===operation.rowId);
      result=result.filter(item=>!(item.op==='assign'&&item.scope==='row'&&item.rowId===operation.rowId));
      result.push({...operation,values:{...(previous?.op==='assign'?previous.values:{}),...operation.values},...(previous?.op==='assign'&&previous.spans?{spans:previous.spans}:{}),...(previous?.op==='assign'&&previous.steps?{steps:previous.steps}:{})});
    }
  }
  return result;
}
/** The existing private-draft API accepts at most 500 operations, including other pending rows. */
export function datasetBulkDraftLimitIssue(operations:DatasetOperation[],plan:DatasetBulkPlan):string|undefined {
  const count=stageDatasetBulkPlan(operations,plan).length;
  return count>500?`合并本次修改后草稿共有 ${count} 项操作，超过当前 500 项上限。请减少本批选择，或先提交已有草稿；本次输入仍保留。`:undefined;
}
