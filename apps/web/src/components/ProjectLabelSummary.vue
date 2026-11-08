<script setup lang="ts">
import {ArrowRight,Tag} from 'lucide-vue-next';
import type {ProjectLabelState} from '../../../../packages/shared/src/project-label-types';
import type {LabelColumn} from '@oxen/shared';
defineProps<{labels?:ProjectLabelState;error?:string}>();
const emit=defineEmits<{edit:[]}>();
function display(column:LabelColumn,value:string|string[]|undefined){const values=Array.isArray(value)?value:value?[value]:[];return values.map(item=>column.options?.find(option=>option.value===item)?.displayName??item).join('、');}
</script>
<template>
<section class="panel project-label-summary"><header><h3><Tag :size="15"/>项目标签</h3><small>所有分支共享</small></header>
  <p v-if="error" class="notice">标签暂不可用：{{error}}</p>
  <template v-else-if="labels">
    <div v-if="labels.keywords.length" class="project-keyword-chips"><span v-for="keyword in labels.keywords" :key="keyword" title="项目关键词">{{keyword}}</span></div>
    <p v-if="labels.state==='missing-main'">项目尚无 main 分支。</p><p v-else-if="labels.state==='unconfigured'">尚未配置项目标签模板。</p><p v-else-if="labels.state==='unassigned'">已配置模板，尚未选择结构化标签。</p>
    <dl v-for="field in labels.columns.filter(column=>display(column,labels?.values[column.id]))" :key="field.id"><dt :title="field.description">{{field.name}}</dt><dd>{{display(field,labels.values[field.id])}}</dd></dl>
    <div v-if="labels.template" class="project-template"><span>项目标签模板</span><strong>{{labels.template.name}} v{{labels.template.version}}</strong></div>
  </template>
  <p v-else>正在读取项目标签…</p>
  <button class="btn" @click="emit('edit')">{{labels?.capabilities.edit?'编辑标签':'查看标签'}}<ArrowRight :size="15"/></button>
</section>
</template>
<style scoped>
.project-label-summary{padding:20px}.project-label-summary>header{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}.project-label-summary h3{display:flex;align-items:center;gap:7px;margin:0;font-size:13px;font-weight:600}.project-label-summary small{font-size:10px;color:var(--muted)}.project-label-summary>p{font-size:12px;line-height:1.8;color:var(--muted);margin:13px 0}.project-label-summary dl{margin:13px 0;line-height:1.8;font-size:11px}.project-label-summary dt{color:var(--muted);margin-bottom:2px}.project-label-summary dd{margin:0;color:var(--text);overflow-wrap:anywhere;white-space:pre-wrap}.project-label-summary>.btn{width:100%;margin-top:16px;justify-content:space-between;font-size:12px}.project-keyword-chips{display:flex;flex-wrap:wrap;gap:5px;margin:13px 0}.project-keyword-chips>span{padding:2px 7px;font-size:10px;border:1px dashed var(--line);border-radius:4px;color:var(--muted)}.project-template{border-top:1px solid var(--line);padding-top:13px;margin-top:15px}.project-template>span{display:block;font-size:10px;color:var(--muted);margin-bottom:5px}.project-template>strong{display:block;font-size:11px;font-weight:500;overflow-wrap:anywhere}
</style>
