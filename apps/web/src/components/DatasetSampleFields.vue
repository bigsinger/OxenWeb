<script setup lang="ts">
import {computed,ref,watch} from 'vue';
import {Check,ChevronDown,ChevronUp,Copy,Info,Search,X} from 'lucide-vue-next';
import type {DatasetFieldMetadata} from '../../../../packages/shared/src/field-metadata';
import {datasetPropertyRows,filterDatasetProperties,type DatasetPropertyRow} from '../dataset-property-grid';

const props=defineProps<{record:Record<string,unknown>;fields?:Readonly<Record<string,DatasetFieldMetadata>>;sampleKey?:string}>();
const query=ref(''),alphabetical=ref(false),focusedId=ref(''),expanded=ref<Record<string,boolean>>(Object.create(null));
const copied=ref(''),copyError=ref('');
let copyGeneration=0;
const entries=computed(()=>datasetPropertyRows(props.record,props.fields));
const shown=computed(()=>filterDatasetProperties(entries.value,query.value,alphabetical.value));
const focused=computed(()=>shown.value.find(field=>field.id===focusedId.value)??shown.value[0]);
watch(()=>props.sampleKey??props.record,()=>{copyGeneration++;copied.value='';copyError.value='';});
watch(shown,rows=>{if(!rows.some(field=>field.id===focusedId.value))focusedId.value=rows[0]?.id??'';},{immediate:true});
function focus(field:DatasetPropertyRow){focusedId.value=field.id;copyError.value='';}
async function copy(field:DatasetPropertyRow){
  focus(field);const generation=++copyGeneration,record=props.record;
  try{await navigator.clipboard.writeText(typeof field.value==='string'?field.value:JSON.stringify(field.value,null,2)??'');if(generation===copyGeneration&&record===props.record)copied.value=field.id;}
  catch{if(generation===copyGeneration&&record===props.record)copyError.value='浏览器未允许复制。可以选中右侧的值后手动复制。';}
}
</script>

<template>
  <div class="dataset-source-fields">
    <div class="property-tools">
      <label class="property-search"><Search :size="15" aria-hidden="true"/><input v-model="query" type="search" placeholder="查找字段、显示名称或说明" aria-label="查找样本属性"/><button v-if="query" type="button" aria-label="清除属性搜索" @click="query=''"><X :size="14"/></button></label>
      <label class="property-order"><span class="property-sr-only">属性排列方式</span><select :value="alphabetical?'alphabetical':'project'" aria-label="属性排列方式" @change="alphabetical=($event.target as HTMLSelectElement).value==='alphabetical'"><option value="project">项目顺序</option><option value="alphabetical">A–Z</option></select></label>
    </div>
    <div class="property-columns" aria-hidden="true"><span>属性 <small>{{shown.length}} / {{entries.length}}</small></span><span>值</span></div>
    <div class="property-list" role="table" aria-label="样本字段属性与值">
      <div v-for="field in shown" :key="field.id" class="property-row" :class="{'property-row-focused':focused?.id===field.id,'property-row-missing':!field.present}" role="row" @focusin="focus(field)" @click="focus(field)">
        <div class="property-name" role="rowheader">
          <button type="button" class="property-name-button" :title="field.description??`${field.id} · ${field.type}`" :aria-label="`${field.id}${field.displayName?'（'+field.displayName+'）':''}，${field.type}，查看字段说明`" @click="focus(field)"><code>{{field.id}}</code><span v-if="field.displayName" class="property-alias">{{field.displayName}}</span><span class="property-type">{{field.type}}<Info v-if="field.description" :size="12" aria-hidden="true"/></span></button>
        </div>
        <div class="property-value" role="cell">
          <span v-if="field.optionLabel" class="property-option-label">{{field.optionLabel}}</span>
          <pre :class="{'property-value-shortened':field.long&&!expanded[field.id],'property-value-expanded':field.long&&expanded[field.id]}">{{field.text}}</pre>
          <div v-if="field.present" class="property-value-actions"><button v-if="field.long" type="button" :aria-expanded="!!expanded[field.id]" :aria-label="`${expanded[field.id]?'收起':'展开'} ${field.id} 完整值`" @click="expanded[field.id]=!expanded[field.id]"><ChevronUp v-if="expanded[field.id]" :size="13"/><ChevronDown v-else :size="13"/>{{expanded[field.id]?'收起':'展开完整值'}}</button><button type="button" :aria-label="`复制 ${field.id} 的值`" @click="copy(field)"><Check v-if="copied===field.id" :size="12"/><Copy v-else :size="12"/>{{copied===field.id?'已复制':'复制'}}</button></div>
        </div>
      </div>
      <div v-if="!shown.length" class="property-empty"><Search :size="22"/><strong>{{entries.length?'没有匹配的属性':'此样本没有字段'}}</strong><p v-if="entries.length">请尝试字段 ID、显示名称、类型或说明。</p><button v-if="query" type="button" @click="query=''">清除搜索</button></div>
    </div>
    <div class="property-description" role="region" aria-label="当前字段说明">
      <template v-if="focused"><div><Info :size="14" aria-hidden="true"/><strong>{{focused.displayName??focused.id}}</strong><code v-if="focused.displayName">{{focused.id}}</code><small>{{focused.declaredType&&focused.declaredType!==focused.type?`实际 ${focused.type} · 配置 ${focused.declaredType}`:focused.type}}</small></div><p>{{focused.description??'暂未配置字段说明。字段显示名称与说明可在项目设置的样本字段中维护。'}}</p><p v-if="!focused.present" class="property-presence-note">当前记录没有此字段，与 null 或空字符串不同。</p></template>
      <p v-else>选择字段可查看它的类型与说明。</p><p v-if="copyError" class="property-copy-error" role="alert">{{copyError}}</p>
    </div>
  </div>
</template>

<style scoped>
.dataset-source-fields{display:flex;flex-direction:column;min-width:0;min-height:0;height:100%;color:var(--text);font-size:var(--workbench-table-font-size,14px)}
.property-tools{display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--surface);border-bottom:1px solid var(--line);flex-shrink:0}.property-search{display:flex;align-items:center;gap:7px;min-width:0;flex:1;padding:6px 8px;background:var(--bg);border:1px solid var(--line);border-radius:var(--radius);color:var(--muted)}.property-search input{min-width:0;width:100%;border:0;outline:0;background:transparent;color:var(--text);font-size:12px;line-height:1.6}.property-search input::-webkit-search-cancel-button{display:none}.property-search button{display:flex;padding:2px;color:var(--muted)}.property-order select{min-height:33px;max-width:115px;border:1px solid var(--line);border-radius:var(--radius);padding:4px 6px;background:var(--bg);color:var(--muted);font-size:12px}.property-sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
.property-columns,.property-row{display:grid;grid-template-columns:minmax(145px,29%) minmax(0,1fr)}.property-columns{flex-shrink:0;padding-right:16px;background:var(--surface-raised);border-bottom:1px solid var(--line);color:var(--muted);font-size:12px;font-weight:600}.property-columns>span{padding:7px 12px}.property-columns>span:first-child{border-right:1px solid var(--line)}.property-columns small{font-weight:400;margin-left:8px;color:var(--subtle)}.property-list{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;background:var(--bg)}.property-row{border-bottom:1px solid var(--line);min-height:49px}.property-name{min-width:0;background:var(--surface);border-right:1px solid var(--line);display:flex;align-self:stretch}.property-name-button{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:3px;width:100%;padding:9px 12px;text-align:left;min-width:0}.property-name code{font:12px/1.55 Consolas,monospace;overflow-wrap:anywhere;color:var(--text)}.property-alias{font-size:12px;line-height:1.5;color:var(--muted);overflow-wrap:anywhere}.property-type{display:flex;align-items:center;gap:5px;color:var(--subtle);font:11px/1.5 Consolas,monospace}.property-row-focused .property-name{background:color-mix(in srgb,var(--primary) 13%,var(--surface));box-shadow:inset 3px 0 var(--primary)}.property-name-button:focus-visible{outline:2px solid var(--accent);outline-offset:-3px}.property-value{min-width:0;padding:10px 12px 6px;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;align-self:stretch}.property-value pre{margin:0;width:100%;color:var(--text);font:var(--workbench-table-font-size,14px)/1.7 Consolas,'Microsoft YaHei UI',monospace;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;user-select:text}.property-value pre.property-value-shortened{display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden;max-height:10.2em}.property-value pre.property-value-expanded{max-height:55vh;overflow:auto}.property-row-missing .property-value pre{color:var(--subtle);font-size:12px}.property-option-label{font-size:12px;color:var(--accent);padding-bottom:3px}.property-value-actions{display:flex;justify-content:flex-end;gap:12px;width:100%;margin-top:4px;min-height:19px}.property-value-actions button{display:inline-flex;align-items:center;gap:4px;color:var(--muted);font-size:11px;padding:1px 0}.property-value-actions button:hover{color:var(--accent)}.property-empty{display:flex;flex-direction:column;align-items:center;gap:9px;padding:40px 16px;color:var(--muted);font-size:13px;text-align:center}.property-empty button{color:var(--accent);font-size:12px}
.property-description{flex-shrink:0;border-top:1px solid var(--line);padding:11px 14px;background:var(--surface-raised);min-height:87px;max-height:27%;overflow:auto}.property-description>div{display:flex;align-items:center;gap:7px;flex-wrap:wrap;min-width:0;font-size:12px}.property-description strong,.property-description code{overflow-wrap:anywhere}.property-description code,.property-description small{font-size:11px;color:var(--muted)}.property-description small{margin-left:auto}.property-description p{margin:5px 0 0;color:var(--muted);font-size:12px;line-height:1.65;overflow-wrap:anywhere}.property-description .property-presence-note{font-size:11px;color:var(--subtle)}.property-description .property-copy-error{color:var(--danger)}
@media(max-width:540px){.property-columns,.property-row{grid-template-columns:minmax(108px,32%) minmax(0,1fr)}.property-tools{padding:8px;gap:5px}.property-search{padding:5px}.property-search input{font-size:11px}.property-order select{max-width:91px;font-size:11px}.property-name-button,.property-value{padding-left:9px;padding-right:9px}.property-name code,.property-alias{font-size:11px}.property-value pre{font-size:13px}.property-description{padding:9px 10px}}
</style>
