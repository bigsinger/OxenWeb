<script setup lang="ts">
import {computed,ref,watch} from 'vue';
import type {LabelColumn} from '@oxen/shared';
import type {DatasetOperation} from '../../../../packages/shared/src/dataset';
import type {DatasetFieldMetadata} from '../../../../packages/shared/src/field-metadata';
import {resolveDatasetFieldMetadata} from '../../../../packages/shared/src/field-metadata';
import {sourceFieldIsReadOnly} from '../../../../packages/shared/src/source-record';
import {createEditableCell,type DatasetEditableCellDraft} from '../dataset-configured-editing';
import {bulkLabelDefinition,datasetBulkDraftLimitIssue,emptyDatasetBulkEditRequest,planDatasetBulkEdit,type DatasetBulkAction,type DatasetBulkEditRequest,type DatasetBulkPlan,type DatasetBulkRow} from '../dataset-bulk-editing';
import DatasetCellControl from './DatasetCellControl.vue';

const props=defineProps<{modelValue?:DatasetBulkEditRequest;selectedIds:string[];rows:DatasetBulkRow[];fields:Record<string,DatasetFieldMetadata>;sourceColumns:Array<{name:string;dtype:string}>;labelColumns:LabelColumn[];identityField:string;pendingOperations?:DatasetOperation[];disabled?:boolean}>();
const emit=defineEmits<{'update:modelValue':[request:DatasetBulkEditRequest];apply:[plan:DatasetBulkPlan];cancel:[]}>();
const acknowledged=ref(false),request=computed(()=>props.modelValue??emptyDatasetBulkEditRequest());
const fieldLabel=(id:string)=>{const alias=resolveDatasetFieldMetadata(id,props.fields).displayName;return alias?`${id} · ${alias}`:id;};
const sourceChoices=computed(()=>props.sourceColumns.filter(column=>!sourceFieldIsReadOnly(column.name,props.identityField,{})&&!props.rows.some(row=>row.record&&sourceFieldIsReadOnly(column.name,props.identityField,row.record))));
const labels=computed(()=>props.labelColumns.filter(column=>!column.scopes||column.scopes.includes('row')));
const selectedLabel=computed(()=>request.value.target.scope==='label'?labels.value.find(column=>column.id===request.value.target.id):undefined);
const definition=computed<DatasetFieldMetadata>(()=>{
  if(selectedLabel.value)return bulkLabelDefinition(selectedLabel.value);
  const field=request.value.target.id,configured=props.fields[field];if(configured?.type||configured?.enum)return configured;
  const row=props.rows.find(row=>row.record&&row.record[field]!==undefined&&row.record[field]!==null)?.record;
  const kind=row?createEditableCell(row,field,configured).kind:undefined;
  return {...configured,...(kind&&kind!=='null'?{type:kind}:{})};
});
const multi=computed(()=>definition.value.type==='array'||!!definition.value.items?.enum);
const actionChoices=computed<Array<{id:DatasetBulkAction;name:string}>>(()=>{
  const result:Array<{id:DatasetBulkAction;name:string}>=[{id:'replace',name:multi.value?'替换全部选项':'统一设置取值'}];
  if(multi.value)result.push({id:'add',name:'增加所选选项'},{id:'remove',name:'移除所选选项'});
  if(request.value.target.scope==='label')result.push({id:'clear',name:'清空我的取值'});
  else{if(multi.value)result.push({id:'clear',name:'清空列表（[]）'});if(definition.value.nullable!==false)result.push({id:'null',name:'清空为 null'});if(definition.value.required!==true)result.push({id:'missing',name:'移除值（未提供）'});}
  return result;
});
const preview=computed<{plan?:DatasetBulkPlan;error?:string}>(()=>{try{const plan=planDatasetBulkEdit({selectedIds:props.selectedIds,rows:props.rows,fields:props.fields,sourceFieldIds:props.sourceColumns.map(column=>column.name),labelColumns:props.labelColumns,identityField:props.identityField},request.value),error=datasetBulkDraftLimitIssue(props.pendingOperations??[],plan);return error?{error}:{plan};}catch(cause){return {error:(cause as Error).message};}});
const showValue=computed(()=>['replace','add','remove'].includes(request.value.action));
const targetName=computed(()=>request.value.target.scope==='label'?selectedLabel.value?.name??request.value.target.id:fieldLabel(request.value.target.id));
function patch(value:Partial<DatasetBulkEditRequest>){emit('update:modelValue',{...request.value,...value});}
function chooseTarget(event:Event){const value=(event.target as HTMLSelectElement).value,target={scope:value.startsWith('l:')?'label':'source',id:value.slice(2)} as DatasetBulkEditRequest['target'];const column=target.scope==='label'?labels.value.find(column=>column.id===target.id):undefined;
  const field=column?bulkLabelDefinition(column):props.fields[target.id];const first=props.rows.find(row=>row.record&&Object.hasOwn(row.record,target.id))?.record??{};
  const draft=createEditableCell({},target.id,field??(first[target.id]===undefined?{}:{type:createEditableCell(first,target.id).kind==='null'?undefined:createEditableCell(first,target.id).kind as DatasetFieldMetadata['type']}));
  patch({target,action:'replace',draft:{...draft,presence:'value'}});
}
function draftChanged(draft:DatasetEditableCellDraft){patch({draft:{...draft,presence:'value'}});}
function apply(){if(!props.disabled&&acknowledged.value&&preview.value.plan?.changes.length)emit('apply',preview.value.plan);}
function valueText(value:unknown){const text=typeof value==='string'?value:JSON.stringify(value);return text&&text.length>220?text.slice(0,220)+'…':text??'未提供';}
watch(()=>[props.modelValue,props.selectedIds,props.rows,props.fields,props.labelColumns,props.pendingOperations],()=>{acknowledged.value=false;});
</script>
<template>
<section class="dataset-bulk-editor" aria-label="批量编辑所选样本">
  <p class="bulk-scope"><strong>本次已选 {{selectedIds.length}} 条样本</strong><span>只修改下列稳定身份，不扩展到未选中的查询结果。</span></p>
  <fieldset class="bulk-controls" :disabled="disabled"><label>编辑字段<select :value="request.target.id?(request.target.scope==='label'?'l:':'s:')+request.target.id:''" aria-label="批量编辑字段" @change="chooseTarget"><option value="" disabled>选择样本字段或人工标签</option><optgroup label="样本字段"><option v-for="column in sourceChoices" :key="column.name" :value="'s:'+column.name">{{fieldLabel(column.name)}}</option></optgroup><optgroup label="人工标签 · 我的取值"><option v-for="column in labels" :key="column.id" :value="'l:'+column.id">{{column.id}} · {{column.name}}</option></optgroup></select></label>
    <label v-if="request.target.id">修改方式<select :value="request.action" aria-label="批量修改方式" @change="patch({action:($event.target as HTMLSelectElement).value as DatasetBulkAction})"><option v-for="action in actionChoices" :key="action.id" :value="action.id">{{action.name}}</option></select></label>
    <div v-if="request.target.id&&showValue" class="bulk-value"><strong>{{['add','remove'].includes(request.action)?'选择需要'+(request.action==='add'?'增加':'移除')+'的选项':'新的取值'}}</strong><DatasetCellControl :model-value="request.draft" :definition="definition" :field="targetName" :allow-type-selection="request.target.scope==='source'" hide-presence @update:model-value="draftChanged" @commit="()=>{}" @cancel="emit('cancel')"/></div>
  </fieldset>
  <p v-if="request.target.scope==='source'&&['split','quality','purposes','visibility'].includes(request.target.id)" class="bulk-help">四维取值会作为样本内容修改；提交后原复核可能失效。gold 仍需最终独立复核，visibility 不替代私有项目及发布权限。</p>
  <p v-if="preview.error" class="bulk-issue" role="status">{{preview.error}}</p>
  <template v-if="preview.plan"><section class="bulk-preview" aria-label="批量修改预览"><h3>修改预览</h3><p>已选 {{preview.plan.selectedIds.length}} · 可编辑 {{preview.plan.eligibleIds.length}} · <strong>将修改 {{preview.plan.changes.length}}</strong> · 未改变 {{preview.plan.unchangedIds.length}} · 无权限跳过 {{preview.plan.excluded.length}}</p><div v-if="preview.plan.changes.length" class="bulk-preview-scroll"><table><thead><tr><th>稳定样本 ID</th><th>修改前</th><th>修改后</th></tr></thead><tbody><tr v-for="change in preview.plan.changes.slice(0,10)" :key="change.id"><td><code>{{change.id}}</code></td><td>{{valueText(change.before)}}</td><td>{{valueText(change.after)}}</td></tr></tbody></table></div><p v-if="preview.plan.changes.length>10">表中展示前10条；本次完整身份范围见下方。</p></section><details><summary>核对全部所选稳定身份（{{selectedIds.length}}）</summary><pre>{{selectedIds.join('\n')}}</pre></details><details v-if="preview.plan.excluded.length"><summary>无权限跳过的样本（{{preview.plan.excluded.length}}）</summary><ul><li v-for="row in preview.plan.excluded" :key="row.id"><code>{{row.id}}</code> · {{row.reason}}</li></ul></details><label v-if="preview.plan.changes.length" class="bulk-ack"><input v-model="acknowledged" type="checkbox" :disabled="disabled"/>我已核对字段、修改方式、范围及跳过项，将 {{preview.plan.changes.length}} 条修改加入草稿。</label></template>
  <footer><button class="btn" :disabled="disabled" @click="emit('cancel')">取消</button><button class="btn btn-primary" :disabled="disabled||!acknowledged||!preview.plan?.changes.length" @click="apply">加入 {{preview.plan?.changes.length??0}} 条草稿修改</button></footer><p class="bulk-help">不会直接提交分支。加入草稿后可继续修改，再统一保存私有草稿、核对差异并提交。</p>
</section>
</template>
<style scoped>
.dataset-bulk-editor{min-width:0}.bulk-scope{display:grid;gap:7px;padding:12px 14px;margin:0 0 18px;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface-raised);font-size:14px}.bulk-scope span,.bulk-help{font-size:12px;line-height:1.8;color:var(--muted)}.bulk-controls{display:grid;gap:16px;margin:0;padding:0;border:0;min-width:0}.bulk-controls>label,.bulk-value{display:grid;gap:8px;font-size:14px}.bulk-controls select{width:100%;padding:9px 10px;background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:var(--radius);font:inherit}.bulk-value{padding:14px;border:1px solid var(--line);border-radius:var(--radius)}.bulk-value strong{font-size:13px;font-weight:500}.bulk-preview{margin-top:20px;min-width:0}.bulk-preview h3{font-size:14px}.bulk-preview p{font-size:13px;line-height:1.8;color:var(--muted)}.bulk-preview p strong{color:var(--text)}.bulk-preview-scroll{overflow:auto;border:1px solid var(--line);border-radius:var(--radius);max-height:290px}.bulk-preview table{width:100%;border-collapse:collapse;min-width:460px;table-layout:fixed}.bulk-preview th,.bulk-preview td{padding:10px 12px;text-align:left;vertical-align:middle;border-bottom:1px solid var(--line);font-size:13px;overflow-wrap:anywhere}.bulk-preview th{background:var(--surface-raised);font-weight:500;color:var(--muted)}.dataset-bulk-editor details{font-size:13px;color:var(--muted);margin:14px 0}.dataset-bulk-editor summary{cursor:pointer}.dataset-bulk-editor pre{max-height:180px;overflow:auto;white-space:pre-wrap;padding:10px;background:var(--bg);font-size:12px}.bulk-ack{display:flex;gap:9px;align-items:flex-start;font-size:13px;line-height:1.8;margin:19px 0}.bulk-ack input{margin-top:5px;accent-color:var(--primary)}.bulk-issue{font-size:13px;color:var(--muted);line-height:1.8;padding:10px 12px;background:var(--surface-raised);border-radius:var(--radius)}.dataset-bulk-editor footer{display:flex;justify-content:flex-end;gap:9px;margin-top:22px}.bulk-help{margin:12px 0}@media(max-width:600px){.bulk-preview table{min-width:430px}.bulk-controls select{font-size:14px}.dataset-bulk-editor footer{flex-wrap:wrap}.bulk-value{padding:11px}}
.bulk-value :deep(.dataset-cell-controls select),.bulk-value :deep(.dataset-cell-controls textarea),.bulk-value :deep(.dataset-cell-controls input[type=number]),.bulk-value :deep(.cell-multicheck>label),.bulk-value :deep(.cell-boolean){font-size:14px}
</style>
