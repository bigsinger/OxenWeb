<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ChevronDown, ChevronRight, File, Folder, FolderOpen, LoaderCircle } from 'lucide-vue-next';
import type { FileTreeNode } from '@oxen/shared';
import { queryString, request } from '../api';
const props=withDefaults(defineProps<{base:string;branch:string;path?:string;selected?:string;depth?:number;tabularOnly?:boolean}>(),{path:'',selected:'',depth:0,tabularOnly:false});
const emit=defineEmits<{select:[node:FileTreeNode]}>();
const nodes=ref<FileTreeNode[]>([]),expanded=ref<Set<string>>(new Set()),loading=ref(false),error=ref('');
const visibleNodes=computed(()=>nodes.value.filter(node=>node.kind==='directory'||!props.tabularOnly||/\.(jsonl|ndjson|csv|tsv|parquet|arrow)$/i.test(node.path)));
onMounted(async()=>{loading.value=true;try{nodes.value=await request<FileTreeNode[]>(props.base+'/tree'+queryString({ref:props.branch,path:props.path}));}catch(e){error.value=(e as Error).message;}finally{loading.value=false;}});
function select(node:FileTreeNode){if(node.kind==='directory'){if(expanded.value.has(node.path))expanded.value.delete(node.path);else expanded.value.add(node.path);}emit('select',node);}
</script>
<template><div class="tree-level"><span v-if="loading" class="tree-loading"><LoaderCircle class="spin" :size="13"/>加载中</span><span v-if="error" class="tree-error">{{error}}</span><span v-if="!loading&&!error&&!visibleNodes.length" class="tree-loading">{{tabularOnly?'此目录中没有可查询的数据文件':'目录为空'}}</span><template v-for="node in visibleNodes" :key="node.path"><button class="tree-node" :class="{selected:selected===node.path}" :style="{paddingLeft:(12+depth*14)+'px'}" :title="node.path" :aria-expanded="node.kind==='directory'?expanded.has(node.path):undefined" @click="select(node)"><component :is="node.kind==='directory'?(expanded.has(node.path)?ChevronDown:ChevronRight):File" :size="13" :class="{muted:node.kind==='file'}"/><component v-if="node.kind==='directory'" :is="expanded.has(node.path)?FolderOpen:Folder" :size="15" class="folder-icon"/><span>{{node.name}}</span></button><FileTree v-if="node.kind==='directory' && expanded.has(node.path)" :base="base" :branch="branch" :path="node.path" :selected="selected" :depth="depth+1" :tabular-only="tabularOnly" @select="emit('select',$event)"/></template></div></template>
<style scoped>
.tree-level{min-width:0}.tree-node{display:flex;align-items:center;gap:7px;padding:9px 10px;width:100%;min-width:0;text-align:left;border-left:2px solid transparent;font-size:12px;color:var(--muted)}.tree-node>span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tree-node:hover{background:var(--surface-raised);color:var(--text)}.tree-node.selected{background:color-mix(in srgb,var(--primary) 14%,var(--surface));color:var(--text);border-left-color:var(--primary)}.tree-node.selected .folder-icon{color:var(--primary-hover)}.folder-icon{color:#a998d7}.tree-loading,.tree-error{display:flex;align-items:center;gap:7px;padding:12px;font-size:11px;color:var(--muted);overflow-wrap:anywhere}.tree-error{color:var(--danger)}
</style>
