<script setup lang="ts">
import { computed } from 'vue';
import type { DatasetFieldMetadata, DatasetFieldOption } from '../../../../packages/shared/src/field-metadata';
import { datasetFieldOptionMatches } from '../../../../packages/shared/src/dataset-field-validation';
import { datasetFieldOptionLabel } from '../../../../packages/shared/src/field-option-labels';
import { datasetCellControl, editableCellOptionIndex, editableCellSelectOption, editableCellToggleOption, type DatasetEditableCellDraft } from '../dataset-configured-editing';
const props = defineProps<{ modelValue: DatasetEditableCellDraft; definition?: DatasetFieldMetadata; field: string; allowTypeSelection?: boolean; hidePresence?:boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: DatasetEditableCellDraft]; commit: []; cancel: []; blur: [event: FocusEvent] }>();
const control = computed(() => datasetCellControl(props.definition, props.modelValue));
const choices = computed(() => props.definition?.enum ?? []), items = computed(() => props.definition?.items?.enum ?? []);
const disabled = computed(() => props.modelValue.presence !== 'value');
function patch(value: Partial<DatasetEditableCellDraft>) { emit('update:modelValue', { ...props.modelValue, ...value }); }
function choose(event: Event) { const option = choices.value[Number((event.target as HTMLSelectElement).value)]; if (option !== undefined) emit('update:modelValue', editableCellSelectOption(props.modelValue, option)); }
function has(option: DatasetFieldOption) { try { const values = JSON.parse(props.modelValue.text); return Array.isArray(values) && values.some(value => datasetFieldOptionMatches(value, option)); } catch { return false; } }
function toggle(option: DatasetFieldOption, event: Event) { emit('update:modelValue', editableCellToggleOption(props.modelValue, option, (event.target as HTMLInputElement).checked)); }
function keydown(event: KeyboardEvent) { if (event.isComposing) return; if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); emit('cancel'); } else if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.stopPropagation(); emit('commit'); } }
function kind(event: Event) { const value = (event.target as HTMLSelectElement).value as DatasetEditableCellDraft['kind']; const defaults = { string: '', number: '0', boolean: 'false', null: 'null', array: '[]', object: '{}' }; patch({ kind: value, text: defaults[value] }); }
function label(option: DatasetFieldOption, options: DatasetFieldOption[]) { const alias=datasetFieldOptionLabel(props.definition,option);if(alias&&alias!==String(option))return `${alias}（${String(option)}）`;return options.some(other => String(other) === String(option) && typeof other !== typeof option) ? `${String(option)}（${typeof option}）` : String(option); }
</script>
<template>
  <div class="dataset-cell-controls" @keydown="keydown" @focusout="emit('blur',$event)">
    <select v-if="!hidePresence" :value="modelValue.presence" :aria-label="field+' 的值状态'" class="cell-presence" @change="patch({presence:($event.target as HTMLSelectElement).value as DatasetEditableCellDraft['presence']})"><option value="value">填写值</option><option value="null" :disabled="definition?.nullable===false">设为 null</option><option value="missing" :disabled="definition?.required===true">移除字段（未提供）</option></select>
    <template v-if="!disabled">
      <select v-if="allowTypeSelection&&!definition?.type&&!definition?.enum" :aria-label="field+' 的编辑类型'" :value="modelValue.kind" @change="kind"><option value="string">string</option><option value="number">number</option><option value="boolean">boolean</option><option value="array">array</option><option value="object">object</option></select>
      <select v-if="control==='select'" data-cell-input :aria-label="'编辑 '+field" :value="editableCellOptionIndex(modelValue,choices)" @change="choose"><option value="-1" disabled>选择一个选项</option><option v-for="(option,index) in choices" :key="index" :value="String(index)">{{label(option,choices)}}</option></select>
      <fieldset v-else-if="control==='multicheck'" class="cell-multicheck" :aria-label="'编辑 '+field"><label v-for="(option,index) in items" :key="index"><input data-cell-input type="checkbox" :checked="has(option)" @change="toggle(option,$event)"/>{{label(option,items)}}</label></fieldset>
      <label v-else-if="control==='checkbox'" class="cell-boolean"><input data-cell-input type="checkbox" :aria-label="'编辑 '+field" :checked="modelValue.text==='true'" @change="patch({text:($event.target as HTMLInputElement).checked?'true':'false'})"/>{{modelValue.text==='true'?'true':'false'}}</label>
      <input v-else-if="control==='number'" data-cell-input type="number" :step="definition?.type==='integer'?'1':'any'" :aria-label="'编辑 '+field" :value="modelValue.text" @input="patch({text:($event.target as HTMLInputElement).value})"/>
      <textarea v-else data-cell-input :aria-label="'编辑 '+field" :rows="control==='json'?5:3" spellcheck="false" :value="modelValue.text" @input="patch({text:($event.target as HTMLTextAreaElement).value})"/>
    </template><p v-else class="cell-presence-note">{{modelValue.presence==='null'?'当前值将保存为 null。':'当前键将从记录移除；与空字符串和 null 不同。'}}</p>
  </div>
</template>
<style scoped>
.dataset-cell-controls{display:grid;gap:7px;min-width:0}.dataset-cell-controls select,.dataset-cell-controls input[type=number],.dataset-cell-controls textarea{width:100%;min-width:0;background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:3px;padding:6px;font:11px/1.6 inherit}.dataset-cell-controls .cell-presence{font-size:10px;padding:3px 5px;color:var(--muted)}.dataset-cell-controls textarea{resize:vertical;min-height:64px;font-family:Consolas,monospace}.cell-boolean,.cell-multicheck>label{display:flex;align-items:center;gap:7px;font-size:11px;color:var(--text);white-space:normal;overflow-wrap:anywhere}.cell-boolean input,.cell-multicheck input{accent-color:var(--primary);width:14px;height:14px;flex-shrink:0}.cell-multicheck{display:grid;gap:7px;border:0;padding:4px 0;max-height:190px;overflow:auto}.cell-presence-note{font-size:10px;line-height:1.7;color:var(--muted);white-space:normal;margin:0}
</style>
