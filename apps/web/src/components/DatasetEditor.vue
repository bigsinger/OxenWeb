<script setup lang="ts">
import { computed,inject,onBeforeUnmount,ref,watch,type ComputedRef } from 'vue';
import { onBeforeRouteLeave,onBeforeRouteUpdate,useRoute,useRouter } from 'vue-router';
import { ArrowLeft,ArrowRight,Columns3,FilePenLine,LoaderCircle,Plus,Save,Trash2,X } from 'lucide-vue-next';
import type { BranchItem,FilePreview,RepositoryPermissions } from '@oxen/shared';
import { post,queryString,request } from '../api';
import { useAppStore } from '../stores/app';
const props=defineProps<{base:string;branch:string}>(),route=useRoute(),router=useRouter(),app=useAppStore();
type Operation={op:'update'|'delete';rowId:string;record?:Record<string,unknown>}|{op:'append';record:Record<string,unknown>}|{op:'add-column';name:string;value:unknown}|{op:'rename-column';from:string;to:string}|{op:'remove-column';name:string};
const path=ref(String(route.query.path??'')),preview=ref<FilePreview>(),version=ref(''),page=ref(1),loading=ref(false),saving=ref(false),error=ref(''),operations=ref<Operation[]>([]),message=ref('Edit JSONL records and schema');
const draftPath=ref(path.value),dialogBaseline=ref('');
const dialog=ref<'row'|'column'|''>(''),editingId=ref(''),json=ref('{}'),dialogError=ref(''),columnAction=ref('add-column'),columnName=ref(''),newName=ref(''),defaultValue=ref('null');let generation=0;
const pages=computed(()=>Math.max(1,Math.ceil((preview.value?.totalRows??0)/25)));
const repositoryPermissions=inject<ComputedRef<RepositoryPermissions>>('repositoryPermissions');
const writable=computed(()=>repositoryPermissions?.value.write===true&&app.status?.capabilities.write!==false);
function dialogState(){return dialog.value==='row'?json.value:JSON.stringify([columnAction.value,columnName.value,newName.value,defaultValue.value]);}
const dialogDirty=computed(()=>!!dialog.value&&dialogState()!==dialogBaseline.value);
const dirty=computed(()=>operations.value.length>0||dialogDirty.value);
async function mayLeave(){if(saving.value){app.notify('数据正在提交，请等待结果后再切换。');return false;}return !dirty.value||await app.confirmAction('离开会放弃尚未提交的数据编辑，继续吗？',{title:'未保存的数据编辑',confirmLabel:'放弃编辑并继续',cancelLabel:'留在当前页面'});}
onBeforeRouteLeave(mayLeave);onBeforeRouteUpdate((to,from)=>to.fullPath===from.fullPath||mayLeave());
function beforeUnload(event:BeforeUnloadEvent){if(dirty.value||saving.value){event.preventDefault();event.returnValue='';}}
window.addEventListener('beforeunload',beforeUnload);
onBeforeUnmount(()=>{++generation;window.removeEventListener('beforeunload',beforeUnload);});
function clear(){++generation;preview.value=undefined;version.value='';operations.value=[];page.value=1;error.value='';dialog.value='';loading.value=false;saving.value=false;}
watch(()=>[props.base,props.branch,route.query.path],()=>{path.value=String(route.query.path??path.value);draftPath.value=path.value;clear();if(/\.(jsonl|ndjson)$/i.test(path.value))void load();},{flush:'sync',immediate:true});
async function selectPath(){const filename=draftPath.value.trim();if(filename!==path.value){if(!await mayLeave())return;clear();await router.replace({query:{...route.query,path:filename}});if(String(route.query.path??'')!==filename)return;if(/\.(jsonl|ndjson)$/i.test(filename))return;}void load(true);}
async function closeDialog(){if(dialogDirty.value&&!await app.confirmAction('放弃尚未加入待提交列表的编辑，继续吗？'))return;dialog.value='';}
function columnDialog(){dialog.value='column';dialogError.value='';dialogBaseline.value=dialogState();}
async function load(reset=false){
  if(reset&&operations.value.length&&!await app.confirmAction('重新加载会放弃尚未提交的编辑，继续吗？'))return;
  const current=++generation;loading.value=true;error.value='';
  const base=props.base,branch=props.branch,filename=path.value.trim();
  try{
    if(!/\.(jsonl|ndjson)$/i.test(filename))throw new Error('当前结构化编辑支持 JSONL/NDJSON。其他格式可在 workspace 上传修改后的文件。');
    if(reset||!version.value){const branches=await request<BranchItem[]>(base+'/branches');if(current!==generation)return;version.value=branches.find(item=>item.name===branch)?.commitId??branch;if(reset){page.value=1;operations.value=[];}}
    const data=await request<FilePreview>(base+'/file'+queryString({ref:version.value,path:filename,page:page.value,pageSize:25}));
    if(current===generation)preview.value=data;
  }catch(cause){if(current===generation)error.value=(cause as Error).message;}
  finally{if(current===generation)loading.value=false;}
}
function rowDialog(index?:number){
  dialogError.value='';editingId.value=index===undefined?'':preview.value?.rowIds?.[index]??'';
  const original=index===undefined?{}:preview.value?.rows?.[index]??{};
  const edited=operations.value.find(item=>item.op==='update'&&item.rowId===editingId.value);
  json.value=JSON.stringify(edited&&'record'in edited?edited.record:original,null,2);dialog.value='row';dialogBaseline.value=dialogState();
}
function saveDraft(){
  try{const record=JSON.parse(json.value) as unknown;if(record===null||typeof record!=='object'||Array.isArray(record))throw new Error('每条记录必须是 JSON 对象。');
    if(editingId.value){operations.value=operations.value.filter(item=>!('rowId'in item&&item.rowId===editingId.value));operations.value.push({op:'update',rowId:editingId.value,record:record as Record<string,unknown>});}else operations.value.push({op:'append',record:record as Record<string,unknown>});dialog.value='';
  }catch(cause){dialogError.value=(cause as Error).message;}
}
async function deleteRow(index:number){const rowId=preview.value?.rowIds?.[index];if(!rowId||!await app.confirmAction('将此记录标记为删除？提交后仍可从历史版本恢复。',{title:'删除数据记录',confirmLabel:'标记删除'}))return;operations.value=operations.value.filter(item=>!('rowId'in item&&item.rowId===rowId));operations.value.push({op:'delete',rowId});}
function saveColumn(){
  dialogError.value='';try{const name=columnName.value.trim();if(!name)throw new Error('请输入或选择列名。');
    if(columnAction.value==='add-column')operations.value.push({op:'add-column',name,value:JSON.parse(defaultValue.value)});
    else if(columnAction.value==='rename-column'){if(!newName.value.trim())throw new Error('请输入新的列名。');operations.value.push({op:'rename-column',from:name,to:newName.value.trim()});}
    else operations.value.push({op:'remove-column',name});dialog.value='';
  }catch(cause){dialogError.value=(cause as Error).message;}
}
async function commit(){
  if(saving.value||!operations.value.length||!writable.value)return;
  const current=generation,base=props.base,branch=props.branch,filename=path.value.trim();
  saving.value=true;error.value='';try{const result=await post<{commitId:string}>(base+'/table/edit',{ref:branch,expectedCommit:version.value,path:filename,operations:operations.value,message:message.value});app.notify(`${branch} 的数据与行标签已在同一提交中保存`);if(current!==generation)return;version.value=result.commitId;operations.value=[];saving.value=false;await load();}catch(cause){if(current===generation)error.value=(cause as Error).message;}finally{if(current===generation)saving.value=false;}
}
function display(value:unknown){return typeof value==='object'&&value!==null?JSON.stringify(value):String(value??'null');}
function pending(id?:string){return operations.value.find(item=>'rowId'in item&&item.rowId===id)?.op;}
</script>
<template><section class="panel editor-panel"><div class="panel-header"><div><h2>编辑 JSONL 数据</h2><p class="muted">编辑记录、增删行与调整数据列；关联行标签随记录迁移，同一个提交保存。</p></div><FilePenLine :size="23" class="muted"/></div>
  <form class="inline-form" @submit.prevent="selectPath"><label class="field">数据文件<input v-model="draftPath" :disabled="saving" required placeholder="data/prompt_injection_bench.jsonl"/></label><button class="btn" :disabled="loading||saving">加载版本</button></form>
  <p v-if="error" class="error-state">{{error}}</p><div v-if="loading" class="empty"><LoaderCircle class="spin" :size="24"/>正在加载数据…</div>
  <template v-else-if="preview"><div class="editor-toolbar"><span class="muted">{{preview.totalRows}} 条记录 · 版本 <code>{{version.slice(0,12)}}</code></span><div><button class="btn" :disabled="!writable||saving" @click="rowDialog()"><Plus :size="15"/>添加记录</button><button class="btn" :disabled="!writable||saving" @click="columnDialog"><Columns3 :size="15"/>调整数据列</button></div></div>
  <div class="table-scroll"><table class="data-table"><thead><tr><th>操作</th><th v-for="column in preview.columns" :key="column.name">{{column.name}}</th></tr></thead><tbody><tr v-for="(row,index) in preview.rows" :key="preview.rowIds?.[index]??index" :class="{'row-deleted':pending(preview.rowIds?.[index])==='delete'}"><td><div class="row-actions"><button class="btn btn-ghost" :disabled="!writable||saving" @click="rowDialog(index)">{{pending(preview.rowIds?.[index])==='update'?'已编辑':'编辑'}}</button><button class="icon-button" aria-label="删除数据记录" :disabled="!writable||saving" @click="deleteRow(index)"><Trash2 :size="14"/></button></div></td><td v-for="column in preview.columns" :key="column.name" :title="display(row[column.name])">{{display(row[column.name])}}</td></tr></tbody></table></div>
  <div class="table-pagination"><span>第 {{page}} / {{pages}} 页</span><div><button class="btn" :disabled="page<=1||loading" @click="page--;load()"><ArrowLeft :size="14"/>上一页</button><button class="btn" :disabled="page>=pages||loading" @click="page++;load()">下一页<ArrowRight :size="14"/></button></div></div>
  <form v-if="operations.length" class="editor-commit" @submit.prevent="commit"><strong>{{operations.length}} 项待提交编辑</strong><details><summary>查看编辑列表</summary><pre>{{JSON.stringify(operations,null,2)}}</pre></details><label class="field">提交说明<input v-model="message" required maxlength="4000"/></label><div><button type="button" class="btn" :disabled="saving" @click="operations=[]">撤销本地编辑</button><button class="btn btn-primary" :disabled="saving||!writable"><Save :size="16"/>{{saving?'正在提交…':'提交数据与标签'}}</button></div></form></template>
  <div v-else-if="!loading&&!error" class="empty"><FilePenLine :size="30"/><h3>加载一个 JSONL 文件开始编辑</h3><p>这里调整源数据，标签列请在“标注”中配置。</p></div>
</section>
<div v-if="dialog" class="modal-backdrop" @click.self="closeDialog"><section class="modal editor-modal" role="dialog" aria-modal="true" :aria-label="dialog==='row'?'编辑数据记录':'调整数据列'"><div class="panel-header"><h2>{{dialog==='row'?(editingId?'编辑数据记录':'添加记录'):'调整数据列'}}</h2><button class="icon-button" aria-label="关闭编辑对话框" @click="closeDialog"><X :size="19"/></button></div><form @submit.prevent="dialog==='row'?saveDraft():saveColumn()"><template v-if="dialog==='row'"><p class="muted">保留 JSON 原始类型；内容仅作为数据保存，不执行其中的指令。</p><label class="field">记录 JSON<textarea v-model="json" rows="15" spellcheck="false" class="mono"/></label></template><template v-else><label class="field">操作<select v-model="columnAction"><option value="add-column">增加数据列</option><option value="rename-column">重命名数据列</option><option value="remove-column">删除数据列</option></select></label><label class="field">{{columnAction==='add-column'?'列名':'原列名'}}<input v-if="columnAction==='add-column'" v-model="columnName" required maxlength="200"/><select v-else v-model="columnName"><option v-for="column in preview?.columns" :key="column.name" :value="column.name">{{column.name}}</option></select></label><label v-if="columnAction==='rename-column'" class="field">新列名<input v-model="newName" required/></label><label v-if="columnAction==='add-column'" class="field">默认值（JSON）<input v-model="defaultValue" placeholder="null、true、0 或 &quot;文本&quot;" required/></label></template><p v-if="dialogError" class="error-state">{{dialogError}}</p><div class="modal-actions"><button type="button" class="btn" @click="closeDialog">取消</button><button class="btn btn-primary">加入待提交编辑</button></div></form></section></div>
</template>
<style scoped>
.editor-panel{background:var(--surface);min-width:0}.editor-panel>.panel-header{padding:20px 22px;background:var(--surface-raised)}.editor-panel>.panel-header h2{font-size:16px}.editor-panel>.panel-header p{font-size:12px;line-height:1.8;max-width:720px}.editor-panel>.inline-form{padding:18px 22px;display:flex;align-items:end;gap:12px;border-bottom:1px solid var(--line)}.inline-form .field{flex:1;margin:0;font-size:12px}.inline-form .field input{font:12px Consolas,monospace;min-height:38px}.editor-toolbar{padding:15px 22px;display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:12px;border-bottom:1px solid var(--line)}.editor-toolbar code{padding:4px 7px;background:var(--surface-raised);border:1px solid var(--line);border-radius:4px;font-size:11px;margin-left:5px}.editor-toolbar>div,.row-actions{display:flex;gap:8px;align-items:center}.editor-toolbar .btn{min-height:34px;font-size:12px;padding:6px 10px}.editor-panel>.table-scroll{max-height:58vh;overflow:auto}.editor-panel .data-table{border-collapse:separate;border-spacing:0;width:max-content;min-width:100%;table-layout:auto}.editor-panel .data-table th{position:sticky;top:0;z-index:2;min-width:140px;max-width:320px;background:var(--surface-raised);border-bottom:1px solid var(--line);border-right:1px solid var(--line);padding:12px 14px;font-size:12px;color:var(--text);font-weight:550}.editor-panel .data-table td{min-width:140px;max-width:340px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:12px 14px;border-right:1px solid var(--line);border-bottom:1px solid var(--line);font-size:12px;color:var(--text)}.editor-panel .data-table th:first-child,.editor-panel .data-table td:first-child{position:sticky;left:0;min-width:112px;background:var(--surface-raised);z-index:1}.editor-panel .data-table th:first-child{z-index:4}.row-actions .btn{padding:4px 7px;min-height:28px;font-size:11px}.row-actions .icon-button{color:var(--muted)}.row-actions .icon-button:hover{color:var(--danger)}.row-deleted{opacity:.45;text-decoration:line-through}.table-pagination{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 22px;border-top:1px solid var(--line);font-size:12px;color:var(--muted)}.table-pagination>div{display:flex;gap:8px}.table-pagination .btn{min-height:32px;padding:5px 8px;font-size:12px}.editor-commit{border-top:1px solid var(--line);padding:20px 22px;background:var(--surface-raised)}.editor-commit>strong{font-size:13px;color:var(--primary-hover)}.editor-commit details{margin:13px 0;font-size:12px;color:var(--muted)}.editor-commit details summary{cursor:pointer}.editor-commit pre{overflow:auto;max-height:240px;background:var(--bg);border:1px solid var(--line);border-radius:5px;padding:14px;font:11px/1.8 Consolas,monospace;color:var(--text);margin-top:10px}.editor-commit .field{font-size:12px}.editor-commit .field input{max-width:800px}.editor-commit>div{display:flex;justify-content:end;gap:8px}.editor-modal{width:780px}.editor-modal .panel-header{background:var(--surface-raised);padding:18px 22px}.editor-modal .panel-header h2{font-size:16px}.editor-modal .muted{margin-bottom:17px;font-size:12px;line-height:1.8}.editor-modal textarea{font:12px/1.9 Consolas,monospace;background:var(--bg);tab-size:2;padding:15px;min-height:320px}.editor-modal .field{font-size:12px}.editor-panel .error-state{margin:16px 22px}.editor-panel>.empty{padding:65px 25px}.editor-panel>.empty h3{font-size:15px}.editor-panel>.empty p{font-size:12px}
@media(max-width:720px){.editor-toolbar{flex-wrap:wrap;padding:14px 16px}.editor-toolbar .btn{font-size:12px}.editor-panel>.panel-header{padding:17px}.editor-panel>.inline-form{padding:16px;flex-wrap:wrap}.inline-form .field{flex-basis:100%}.editor-commit{padding:17px}.table-pagination{padding:12px 16px}.editor-modal textarea{font-size:11px}.editor-panel .error-state{margin:15px}}
</style>
