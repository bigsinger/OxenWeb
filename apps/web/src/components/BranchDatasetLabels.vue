<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue';
import {onBeforeRouteLeave,onBeforeRouteUpdate} from 'vue-router';
import {useQueryClient} from '@tanstack/vue-query';
import {GitBranch,GitCommitHorizontal,LoaderCircle,MessageSquare,Save,Tag,X} from 'lucide-vue-next';
import type {LabelColumn} from '@oxen/shared';
import type {ProjectLabelState} from '../../../../packages/shared/src/project-label-types';
import {post,request} from '../api';
import {useAppStore} from '../stores/app';

const props=defineProps<{base:string;canConfigure?:boolean}>();
const emit=defineEmits<{close:[];changed:[commitId:string];configure:[];'create-main':[]}>();
const app=useAppStore(),cache=useQueryClient(),panel=ref<HTMLElement>(),loading=ref(true),busy=ref(false),error=ref(''),state=ref<ProjectLabelState>();
const values=ref<Record<string,string|string[]>>({}),baseline=ref<Record<string,string|string[]>>({});
const feedbackOpen=ref(false),feedback=ref(''),feedbackBusy=ref(false),feedbackError=ref('');
const navOpen=ref(false),navError=ref('');let navResolve:((value:boolean)=>void)|undefined,generation=0,disposed=false,previousFocus:HTMLElement|null=null;
const columns=computed(()=>state.value?.columns??[]),canEdit=computed(()=>state.value?.capabilities.edit===true&&!!state.value?.commitId&&columns.value.length>0);
const principal=computed(()=>`${app.status?.identity?.kind??'guest'}:${app.status?.identity?.id??''}`);
const fieldGroups=computed(()=>{
  const secondary=(column:LabelColumn)=>['dataset.language','dataset.industry'].includes(column.semanticKey??'dataset.'+column.id)&&!state.value?.template?.bindings.find(item=>item.dimensionId===column.id)?.required;
  return [{key:'primary',more:false,columns:columns.value.filter(column=>!secondary(column))},{key:'more',more:true,columns:columns.value.filter(secondary)}].filter(group=>group.columns.length);
});
const labelDirty=computed(()=>JSON.stringify(values.value)!==JSON.stringify(baseline.value)),dirty=computed(()=>labelDirty.value||!!feedback.value.trim());
const clone=<T,>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
function initialize(){const next:Record<string,string|string[]>={};for(const column of columns.value){const saved=state.value?.values[column.id];next[column.id]=column.type==='multi'?Array.isArray(saved)?[...saved]:[]:typeof saved==='string'?saved:'';}values.value=next;baseline.value=clone(next);}
async function load(){const current=++generation,base=props.base;loading.value=true;error.value='';state.value=undefined;values.value={};baseline.value={};try{const result=await request<ProjectLabelState>(base+'/project-labels');if(disposed||current!==generation)return;state.value=result;initialize();}catch(cause){if(current===generation)error.value=(cause as Error).message;}finally{if(current===generation)loading.value=false;}}
function multiValue(column:LabelColumn,value:string){const current=values.value[column.id],selected=Array.isArray(current)?current:[];values.value[column.id]=selected.includes(value)?selected.filter(item=>item!==value):[...selected,value];}
function checked(id:string,value:string){return Array.isArray(values.value[id])&&values.value[id].includes(value);}
function payloadValues(){return Object.fromEntries(columns.value.map(column=>{const value=values.value[column.id];return [column.id,value===''||Array.isArray(value)&&!value.length?null:value];}));}
async function save(closeAfter=true){if(busy.value||!canEdit.value||!labelDirty.value)return false;busy.value=true;error.value='';try{const result=await request<ProjectLabelState>(props.base+'/project-labels',{method:'PUT',body:JSON.stringify({expectedCommit:state.value!.commitId,values:payloadValues(),message:'更新项目标签'})});state.value=result;initialize();await cache.invalidateQueries({queryKey:['repos']});if(result.commitId)emit('changed',result.commitId);app.notify(feedback.value.trim()?'项目标签已保存，缺项反馈尚未发送。':'项目标签已保存。');if(closeAfter&&!feedback.value.trim())emit('close');return true;}catch(cause){error.value=(cause as Error).message;return false;}finally{busy.value=false;}}
async function sendFeedback(){if(!feedback.value.trim()||feedbackBusy.value)return;feedbackBusy.value=true;feedbackError.value='';try{await post(props.base+'/schema/feedback',{templateId:state.value?.template?.id,reason:feedback.value.trim()});feedback.value='';feedbackOpen.value=false;app.notify('已反馈给组织规范维护者。');}catch(cause){feedbackError.value=(cause as Error).message;}finally{feedbackBusy.value=false;}}
async function guard(){if(busy.value)return false;if(!dirty.value)return true;if(navResolve)return false;navOpen.value=true;navError.value='';await nextTick();panel.value?.querySelector<HTMLButtonElement>('.branch-draft-navigation button')?.focus();return new Promise<boolean>(resolve=>{navResolve=resolve;});}
function finishNavigation(value:boolean){navOpen.value=false;const resolve=navResolve;navResolve=undefined;resolve?.(value);}
async function navigateChoice(action:'save'|'discard'|'cancel'){if(action==='cancel'){finishNavigation(false);return;}if(action==='discard'){initialize();feedback.value='';finishNavigation(true);return;}if(feedback.value.trim()){navError.value='缺项反馈尚未发送。请先返回面板发送，或明确放弃面板输入。';return;}if(await save(false))finishNavigation(true);else navError.value=error.value||'标签修改仍保留，尚未切换。';}
async function close(){if(await guard())emit('close');}
async function refresh(){if(await guard())await load();}
async function configure(){if(await guard()){emit('close');emit('configure');}}
async function createMain(){if(await guard()){emit('close');emit('create-main');}}
function trap(event:KeyboardEvent){if(event.key!=='Tab')return;const root=navOpen.value?panel.value?.querySelector<HTMLElement>('.branch-draft-navigation'):panel.value;if(!root)return;const controls=[...root.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]')].filter(element=>element.getClientRects().length>0);const first=controls[0],last=controls.at(-1);if(!first)return;if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
function beforeUnload(event:BeforeUnloadEvent){if(dirty.value||busy.value){event.preventDefault();event.returnValue='';}}
const unregister=app.registerDraftGuard(guard);onBeforeRouteLeave(guard);onBeforeRouteUpdate(guard);
watch(()=>[props.base,principal.value],load,{immediate:true});
onMounted(async()=>{previousFocus=document.activeElement as HTMLElement;window.addEventListener('beforeunload',beforeUnload);await nextTick();panel.value?.querySelector<HTMLButtonElement>('button')?.focus();});
onBeforeUnmount(()=>{disposed=true;++generation;unregister();finishNavigation(false);window.removeEventListener('beforeunload',beforeUnload);previousFocus?.focus();});
</script>

<template>
<div class="modal-backdrop branch-label-backdrop" @click.self="close"><section ref="panel" class="branch-label-panel" role="dialog" aria-modal="true" aria-labelledby="project-label-title" @keydown="trap" @keydown.esc.stop.prevent="navOpen?finishNavigation(false):close()">
  <header class="branch-label-header"><div><span>PROJECT LABELS</span><h2 id="project-label-title"><Tag :size="20"/>{{state?.capabilities.edit?'编辑项目标签':'项目标签'}}</h2><p><GitBranch :size="13"/>main · 项目统一标签<code v-if="state?.commitId"><GitCommitHorizontal :size="12"/>{{state.commitId.slice(0,12)}}</code></p></div><button class="icon-button" :disabled="busy" aria-label="关闭项目标签" @click="close"><X :size="20"/></button></header>
  <div class="branch-label-content">
    <div v-if="loading" class="empty" role="status"><LoaderCircle class="spin" :size="24"/><p>正在读取项目标签…</p></div>
    <p v-if="error" class="error-state" role="alert">{{error}}<span v-if="dirty">当前输入仍保留。</span><button class="btn btn-ghost" :disabled="busy" @click="refresh">重新读取</button></p>
    <template v-if="state&&!loading">
      <p class="branch-label-explainer">项目标签统一保存在 main，各个工作分支共享展示。保存包含本面板的标签修改，样本编辑继续在数据编辑中独立处理。</p>
      <section v-if="state.template" class="project-label-template"><span>项目标签模板</span><strong>{{state.template.name}} <small>v{{state.template.version}}</small></strong><p>由组织规范维护者定义字段与选项。</p></section>
      <div v-if="state.state==='missing-main'" class="empty"><Tag :size="28"/><h3>项目尚无 main 分支</h3><p>负责人建立 main 后，即可配置并维护项目标签。</p><button v-if="canConfigure" class="btn" @click="createMain">前往分支管理</button></div>
      <div v-else-if="!columns.length" class="empty"><Tag :size="28"/><h3>项目尚未配置标签模板</h3><p>负责人在项目设置中为 main 采用项目标签模板后，即可选择标签。</p><button v-if="canConfigure" class="btn btn-primary" @click="configure">配置项目标签模板</button></div>
      <template v-else>
        <p v-if="!canEdit" class="notice">当前身份可查看项目标签。负责人、管理员或指定的标签赋值人员可以编辑。</p>
        <form class="branch-label-form" @submit.prevent="save()"><fieldset :disabled="!canEdit||busy"><component :is="group.more?'details':'section'" v-for="group in fieldGroups" :key="group.key" class="branch-label-group" :class="{'branch-label-more':group.more}"><summary v-if="group.more">更多信息 · 语言与行业</summary><div class="branch-label-field-grid"><div v-for="column in group.columns" :key="column.id" class="branch-label-field"><label :for="'project-label-'+column.id">{{column.name}}</label><p v-if="column.description">{{column.description}}</p><select v-if="column.type==='single'" :id="'project-label-'+column.id" v-model="values[column.id]"><option value="">尚未填写</option><option v-for="option in column.options??[]" :key="option.value" :value="option.value" :disabled="option.deprecated&&values[column.id]!==option.value">{{option.displayName??option.value}}{{option.deprecated?'（已弃用）':''}}</option></select><div v-else-if="column.type==='multi'" :id="'project-label-'+column.id" class="branch-label-options" role="group" :aria-label="column.name"><label v-for="option in column.options??[]" :key="option.value" :title="option.description"><input type="checkbox" :checked="checked(column.id,option.value)" :disabled="option.deprecated&&!checked(column.id,option.value)" @change="multiValue(column,option.value)"/><span>{{option.displayName??option.value}}<small v-if="option.deprecated">已弃用</small></span></label></div><textarea v-else :id="'project-label-'+column.id" v-model="values[column.id]" rows="3" maxlength="8000" placeholder="尚未填写"/></div></div></component></fieldset></form>
        <details class="branch-label-definition"><summary>查看字段与选项说明</summary><dl v-for="column in columns" :key="column.id"><dt>{{column.name}} <code>{{column.id}}</code></dt><dd>{{column.description||'未提供释义'}}<ul v-if="column.options?.length"><li v-for="option in column.options" :key="option.value"><strong>{{option.displayName??option.value}}</strong>：{{option.description||'未提供选项释义'}}</li></ul></dd></dl><button v-if="canConfigure" class="btn btn-ghost" @click="configure">在项目设置中更换模板</button></details>
      </template>
      <section class="branch-label-feedback"><button class="btn btn-ghost" :disabled="app.status?.identity?.kind==='guest'||busy" @click="feedbackOpen=!feedbackOpen"><MessageSquare :size="14"/>反馈缺少字段或选项</button><form v-if="feedbackOpen" @submit.prevent="sendFeedback"><label class="field">说明需要补充的定义<textarea v-model="feedback" rows="3" maxlength="2000" required :disabled="feedbackBusy"/></label><p v-if="feedbackError" class="error-state" role="alert">{{feedbackError}}</p><button class="btn" :disabled="feedbackBusy||!feedback.trim()">提交给规范维护者</button></form></section>
    </template>
  </div>
  <footer class="branch-label-footer"><span>{{labelDirty?'有尚未保存的标签修改':'项目标签在所有分支中一致展示'}}</span><button class="btn" :disabled="busy" @click="close">{{dirty?'取消':'关闭'}}</button><button v-if="canEdit" class="btn btn-primary" :disabled="busy||!labelDirty" @click="save()"><LoaderCircle v-if="busy" class="spin" :size="15"/><Save v-else :size="15"/>保存标签</button></footer>
  <div v-if="navOpen" class="branch-navigation-backdrop"><section class="branch-draft-navigation" role="alertdialog" aria-modal="true" aria-label="处理未保存的项目标签"><h3>处理未保存的标签</h3><p>当前面板的标签选择尚未保存。</p><p v-if="navError" class="error-state" role="alert">{{navError}}</p><div><button class="btn btn-primary" :disabled="busy||!labelDirty" @click="navigateChoice('save')">保存后继续</button><button class="btn" :disabled="busy" @click="navigateChoice('discard')">放弃修改</button><button class="btn btn-ghost" :disabled="busy" @click="navigateChoice('cancel')">返回编辑</button></div></section></div>
</section></div>
</template>

<style scoped src="./BranchDatasetLabels.css"/>
