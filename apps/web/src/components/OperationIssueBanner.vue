<script setup lang="ts">
import {operationIssue} from '../operation-errors';
import {X,ClipboardCheck} from 'lucide-vue-next';
</script>
<template><div v-if="operationIssue" class="operation-issue" role="alert"><ClipboardCheck :size="17"/><span>{{operationIssue.code==='OPERATION_ALREADY_SUCCEEDED'?'该操作已完成，请读取已记录的结果。':'操作结果需要核对，未自动再次提交。'}}<small>{{operationIssue.message}}</small></span><RouterLink :to="{path:'/operations',query:{operation:operationIssue.id}}" class="btn">核对操作结果</RouterLink><button class="icon-button" aria-label="关闭操作核对提示" @click="operationIssue=undefined"><X :size="16"/></button></div></template>
<style scoped>.operation-issue{display:flex;align-items:center;gap:12px;margin:12px var(--page-gutter);padding:12px 16px;border:1px solid var(--warning);border-radius:var(--radius);background:var(--surface);color:var(--warning);font-size:13px}.operation-issue>span{flex:1;min-width:0}.operation-issue small{display:block;color:var(--muted);line-height:1.8;overflow-wrap:anywhere}@media(max-width:600px){.operation-issue{flex-wrap:wrap}.operation-issue>span{flex-basis:80%}}</style>
