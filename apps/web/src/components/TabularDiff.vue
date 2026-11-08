<script setup lang="ts">
import { computed,ref,watch } from 'vue';
import type { TabularDiffRow,TabularDiffView } from '@oxen/shared';
import TextDiff from './TextDiff.vue';
const props=defineProps<{diff:TabularDiffView}>();
const filter=ref('all'),page=ref(1),pageSize=25;
const rows=computed(()=>props.diff.rows.filter(row=>filter.value==='all'||row.status===filter.value));
const pages=computed(()=>Math.max(1,Math.ceil(rows.value.length/pageSize)));
const visible=computed(()=>rows.value.slice((page.value-1)*pageSize,page.value*pageSize));
const status=(value:string)=>({added:'新增',removed:'删除',modified:'修改'} as Record<string,string>)[value]??value;
function value(row:Record<string,unknown>|undefined,column:string){if(!row||!Object.hasOwn(row,column))return '（未提供）';const cell=row[column];return typeof cell==='object'&&cell!==null?JSON.stringify(cell,null,2):cell===null?'null':String(cell);}
function changed(row:TabularDiffRow,column:string){return row.status==='modified'&&(Object.hasOwn(row.before??{},column)!==Object.hasOwn(row.after??{},column)||JSON.stringify(row.before?.[column])!==JSON.stringify(row.after?.[column]));}
watch(()=>[props.diff,filter.value],()=>{page.value=1;});
</script>
<template><section class="tabular-diff" aria-label="表格结构化差异">
  <div class="tabular-summary"><strong>表格差异</strong><span class="added">新增 {{diff.counts.added.toLocaleString()}} 行</span><span class="removed">删除 {{diff.counts.removed.toLocaleString()}} 行</span><span>修改 {{diff.counts.modified.toLocaleString()}} 行</span><span v-if="diff.sourceRows" class="muted">总行数 {{diff.sourceRows.before.toLocaleString()}} → {{diff.sourceRows.after.toLocaleString()}}</span></div>
  <div v-if="diff.addedColumns.length||diff.removedColumns.length||diff.changedColumns.length" class="schema-diff"><span v-if="diff.addedColumns.length" class="added">新增列：{{diff.addedColumns.join('、')}}</span><span v-if="diff.removedColumns.length" class="removed">删除列：{{diff.removedColumns.join('、')}}</span><span v-if="diff.changedColumns.length">类型变化：{{diff.changedColumns.join('、')}}</span></div>
  <div class="tabular-tools"><span class="muted">{{diff.keyColumn?`按 ${diff.keyColumn} 关联记录`:'逐行比较记录内容'}} · 仅显示变化行</span><label>显示<select v-model="filter" aria-label="筛选表格差异"><option value="all">全部变化</option><option value="added">新增行</option><option value="removed">删除行</option><option value="modified">修改行</option></select></label></div><details v-if="diff.note" class="tabular-note"><summary>比较方式与完整性</summary><p>{{diff.note}}</p></details>
  <div v-if="!rows.length" class="tabular-empty">{{filter==='all'?'没有记录内容变化。':'没有此类记录变化。'}}</div>
  <div v-else class="table-scroll"><table class="data-table"><thead><tr><th>变化</th><th v-for="column in diff.columns" :key="column.name">{{column.name}}<small>{{column.dtype}}</small></th></tr></thead><tbody><tr v-for="row in visible" :key="row.id" :class="`row-${row.status}`"><td><span class="badge">{{status(row.status)}}</span></td><td v-for="column in diff.columns" :key="column.name" :class="{'cell-changed':changed(row,column.name)}"><template v-if="changed(row,column.name)"><TextDiff :before="value(row.before,column.name)" :after="value(row.after,column.name)" compact/></template><pre v-else>{{value(row.status==='removed'?row.before:row.after,column.name)}}</pre></td></tr></tbody></table></div>
  <nav v-if="rows.length" class="tabular-pagination" aria-label="表格差异分页"><span class="muted">{{rows.length.toLocaleString()}} 条变化 · 第 {{page}} / {{pages}} 页</span><button class="btn btn-ghost" :disabled="page<=1" @click="page--">上一页</button><button class="btn btn-ghost" :disabled="page>=pages" @click="page++">下一页</button></nav>
</section></template>
<style scoped>
.tabular-summary,.schema-diff,.tabular-tools,.tabular-pagination{display:flex;align-items:center;gap:15px;flex-wrap:wrap;padding:13px 17px;font-size:13px}
.tabular-summary{border-bottom:1px solid var(--line);background:var(--surface-raised)}
.tabular-summary strong{font-size:13px}
.added{color:var(--text)}
.removed{color:var(--text)}
.schema-diff{background:var(--surface-raised);border-bottom:1px solid var(--line);gap:9px 20px}
.tabular-note{margin:0;padding:12px 17px;font-size:13px;line-height:1.7;color:var(--muted);background:var(--surface-raised)}
.tabular-tools{justify-content:space-between}
.tabular-tools label{display:flex;align-items:center;gap:8px}
.tabular-tools select{padding:5px 8px;border:1px solid var(--line);border-radius:4px;background:var(--surface);font-size:13px}
.data-table th{white-space:nowrap}
.data-table th small{display:block;font-size:13px;font-weight:400;color:var(--muted);margin-top:5px}
.data-table td{vertical-align:top;min-width:100px;padding:0}
.data-table td:first-child{padding:12px 15px;min-width:65px}
.data-table pre{white-space:pre-wrap;overflow-wrap:anywhere;min-width:130px;max-width:440px;max-height:260px;overflow:auto;font-size:13px;line-height:1.8;margin:0;padding:12px 14px}
.row-added td{background:var(--surface-raised)}
.row-removed td{background:var(--surface-raised)}
.cell-before{background:var(--surface-raised);color:var(--text);border-bottom:1px solid var(--line)}
.cell-after{background:var(--surface-raised);color:var(--text)}
.cell-changed pre b{user-select:none}
.tabular-empty{padding:30px 17px;font-size:13px;color:var(--muted)}
.tabular-pagination{justify-content:flex-end;border-top:1px solid var(--line)}
.tabular-pagination>span{margin-right:auto}
.tabular-pagination .btn{font-size:13px;min-height:32px;padding:5px 9px}
.tabular-summary{gap:12px;padding:14px 16px;background:var(--surface-raised);font-size:13px}
.tabular-summary>strong{font-size:14px;margin-right:4px}
.tabular-summary>.added,.tabular-summary>.removed{padding:3px 7px;border-radius:4px}
.tabular-summary>.added{color:var(--success);background:color-mix(in srgb,var(--success) 9%,var(--surface))}
.tabular-summary>.removed{color:var(--danger);background:color-mix(in srgb,var(--danger) 9%,var(--surface))}
.schema-diff{font-size:12px;padding:11px 16px;background:var(--surface)}
.schema-diff .added{color:var(--success)}
.schema-diff .removed{color:var(--danger)}
.tabular-tools{padding:12px 16px;min-height:57px;border-bottom:1px solid var(--line);font-size:12px}
.tabular-tools select{min-height:34px;padding:6px 30px 6px 10px;color:var(--text);font-size:12px}
.tabular-note{padding:10px 16px;border-bottom:1px solid var(--line);font-size:12px;background:var(--surface);color:var(--muted)}
.tabular-note summary{cursor:pointer;user-select:none}
.tabular-note p{line-height:1.8;margin-top:10px;max-width:1000px}
.tabular-diff>.table-scroll{max-height:600px;overflow:auto;scrollbar-gutter:stable}
.data-table th{position:sticky;top:0;z-index:3;background:var(--surface-raised);font-size:12px;padding:12px 14px;min-width:140px;vertical-align:top}
.data-table th:first-child{left:0;z-index:4;min-width:76px}
.data-table th small{font-size:11px;margin-top:5px;color:var(--muted);font-weight:400}
.data-table td{min-width:140px;border-color:var(--line)}
.data-table td:first-child{position:sticky;left:0;z-index:2;min-width:76px;box-shadow:1px 0 var(--line);background:var(--surface);padding:14px}
.data-table pre{font-size:12px;line-height:1.85;padding:13px 14px;min-width:140px;max-height:300px;color:var(--text)}
.row-added td{background:color-mix(in srgb,var(--success) 7%,var(--surface))}
.row-removed td{background:color-mix(in srgb,var(--danger) 7%,var(--surface))}
.cell-before{background:color-mix(in srgb,var(--danger) 9%,var(--surface));color:var(--danger)!important}
.cell-after{background:color-mix(in srgb,var(--success) 9%,var(--surface));color:var(--success)!important}
.tabular-pagination{padding:12px 16px;font-size:12px;background:var(--surface)}

</style>
