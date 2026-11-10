<script setup lang="ts">
import { computed, inject,onBeforeUnmount,ref, watch } from 'vue';
import { onBeforeRouteLeave,onBeforeRouteUpdate,useRoute, useRouter } from 'vue-router';
import { CheckCircle2, Columns3, GitBranch, Globe2, LoaderCircle, LockKeyhole, Save, Settings2, UsersRound, Tags, Database } from 'lucide-vue-next';
import type { BranchItem, Capabilities, RepoSummary, RepositorySettingsState,ProjectLabelState } from '@oxen/shared';
import { patch, request } from '../api';
import { useAppStore } from '../stores/app';
import AccessPanel from './AccessPanel.vue';
import SchemaBindingPanel from './SchemaBindingPanel.vue';
import DatasetConfigurationPanel from './DatasetConfigurationPanel.vue';
import SampleFieldsPanel from './SampleFieldsPanel.vue';
import RepositoryDangerZone from './RepositoryDangerZone.vue';
import ProjectLabelSummary from './ProjectLabelSummary.vue';
import BranchDatasetLabels from './BranchDatasetLabels.vue';
import {useQueryClient} from '@tanstack/vue-query';
const props = defineProps<{ base: string; branch: string; capabilities?: Capabilities }>();
const emit = defineEmits<{ changed: [] }>();
const app = useAppStore();
const route=useRoute(),router=useRouter();
const cache=useQueryClient(),projectLabels=ref<ProjectLabelState>(),labelsOpen=ref(false);
const refreshProjectList=inject<()=>Promise<void>>('refreshProjectList',async()=>{});
const activeSection=computed(()=>route.query.section==='access'?'access':route.query.section==='schema'?'schema':route.query.section==='dataset'?'dataset':route.query.section==='fields'?'fields':'general');
function selectSection(section:'general'|'access'|'schema'|'dataset'|'fields'){void router.replace({query:{...route.query,section:section==='general'?undefined:section}});}
const repo = ref<RepoSummary | null>(null), state = ref<RepositorySettingsState | null>(null), branches = ref<BranchItem[]>([]);
const loading = ref(false), saving = ref(false), error = ref(''), formError = ref(''), saved = ref(false);
const displayName=ref(''),description = ref(''), defaultBranch = ref(''), visibility = ref<'public' | 'private'>('private');
const writable = computed(() => state.value?.permissions?.admin === true);
const formSignature=()=>JSON.stringify({displayName:displayName.value,description:description.value,defaultBranch:defaultBranch.value,visibility:visibility.value}),formBaseline=ref('');
const formDirty=computed(()=>!!state.value&&formSignature()!==formBaseline.value);
let version = 0;
async function load() {
  const current = ++version; loading.value = true; error.value = ''; saved.value = false;
  try {
    const [value, branchList, settings] = await Promise.all([request<RepoSummary>(props.base), request<BranchItem[]>(props.base + '/branches'), request<RepositorySettingsState>(props.base + '/settings')]);
    if (current !== version) return;
    repo.value = value; branches.value = branchList; state.value = settings;
    displayName.value=settings.policy.displayName||value.name;description.value = settings.policy.description; defaultBranch.value = settings.policy.defaultBranch; visibility.value = settings.policy.visibility;
    formBaseline.value=formSignature();
    void request<ProjectLabelState>(props.base+'/project-labels').then(labels=>{if(current===version)projectLabels.value=labels;}).catch(()=>{});
  } catch (cause) { if (current === version) error.value = (cause as Error).message; }
  finally { if (current === version) loading.value = false; }
}
async function accessChanged() {
  try { state.value = await request<RepositorySettingsState>(props.base + '/settings'); emit('changed'); }
  catch (cause) { error.value = (cause as Error).message; }
}
async function save() {
  if (!writable.value || !state.value) return;
  if(!displayName.value.trim()){formError.value='请填写项目显示名称。';return;}
  if (!defaultBranch.value) { formError.value = '请选择默认分支。'; return; }
  saving.value = true; formError.value = ''; saved.value = false;
  try {
    state.value = await patch<RepositorySettingsState>(props.base + '/settings', { displayName:displayName.value.trim(),description: description.value.trim(), defaultBranch: defaultBranch.value, visibility: visibility.value, expectedCommit: state.value.commitId });
    formBaseline.value=formSignature();saved.value = true;await cache.invalidateQueries({queryKey:['repos']});await refreshProjectList(); app.notify('设置已提交到 Oxen 版本历史'); emit('changed');
  } catch (cause) { formError.value = (cause as Error).message; }
  finally { saving.value = false; }
}
async function labelsChanged(){projectLabels.value=await request<ProjectLabelState>(props.base+'/project-labels');await accessChanged();}
function configureProjectLabels(){void router.replace({query:{...route.query,branch:'main',section:'schema'}});}
async function removed(){formBaseline.value=formSignature();await cache.invalidateQueries({queryKey:['repos']});app.notify('项目已移入本地回收站，Oxen版本保留，可由管理员恢复。');await router.push('/');}
async function mayLeave(){if(saving.value)return false;if(!formDirty.value)return true;const allowed=await app.confirmAction('项目名称、简介或常规设置尚未保存。是否放弃这些输入并离开？',{title:'常规设置尚未保存',confirmLabel:'放弃输入并离开'});if(allowed&&state.value){displayName.value=state.value.policy.displayName||repo.value?.name||'';description.value=state.value.policy.description;defaultBranch.value=state.value.policy.defaultBranch;visibility.value=state.value.policy.visibility;formBaseline.value=formSignature();}return allowed;}
function beforeUnload(event:BeforeUnloadEvent){if(formDirty.value||saving.value){event.preventDefault();event.returnValue='';}}
const unregister=app.registerDraftGuard(mayLeave);onBeforeRouteLeave(mayLeave);onBeforeRouteUpdate(mayLeave);window.addEventListener('beforeunload',beforeUnload);onBeforeUnmount(()=>{version++;unregister();window.removeEventListener('beforeunload',beforeUnload);});
watch(() => props.base, load, { immediate: true });
</script>
<template>
  <section aria-label="仓库设置">
    <header class="section-heading"><div><h2>仓库设置</h2><p class="muted">管理仓库信息、默认浏览分支与协作访问范围。</p></div><Settings2 :size="22" class="settings-icon" /></header>
    <div v-if="error" class="error-state" role="alert">{{ error }}<button class="btn btn-ghost" @click="load()">重试</button></div>
    <div v-else-if="loading" class="empty" role="status"><LoaderCircle :size="22" class="spinning" /> 正在读取仓库设置…</div>
    <div v-else-if="repo && state" class="settings-layout">
      <nav class="settings-navigation" aria-label="仓库设置板块"><span>项目设置</span><button :class="{active:activeSection==='general'}" :aria-current="activeSection==='general'?'page':undefined" @click="selectSection('general')"><Settings2 :size="16"/>常规设置</button><button :class="{active:activeSection==='access'}" :aria-current="activeSection==='access'?'page':undefined" @click="selectSection('access')"><UsersRound :size="16"/>用户与协作者</button><button :class="{active:activeSection==='schema'}" :aria-current="activeSection==='schema'?'page':undefined" @click="selectSection('schema')"><Tags :size="16"/>标签模板</button><button :class="{active:activeSection==='fields'}" :aria-current="activeSection==='fields'?'page':undefined" @click="selectSection('fields')"><Columns3 :size="16"/>样本字段</button><button :class="{active:activeSection==='dataset'}" :aria-current="activeSection==='dataset'?'page':undefined" @click="selectSection('dataset')"><Database :size="16"/>数据集配置</button></nav>
      <div class="settings-form">
      <p v-if="!writable&&!['schema','fields'].includes(activeSection)" class="capability-note">项目常规设置与访问权限由管理员维护；数据编辑与模板采用分别按对应能力授权。</p>
      <form v-show="activeSection==='general'" @submit.prevent="save">
        <article class="panel settings-card"><header><h3>常规设置</h3><p class="muted">更新项目在仓库列表和详情页显示的信息。</p></header><div class="settings-body">
          <label class="form-label">仓库标识<input class="field mono readonly" :value="`${repo.namespace} / ${repo.name}`" readonly /></label>
          <label class="form-label">项目显示名称<input v-model="displayName" class="field" maxlength="200" required :disabled="!writable||saving" @input="saved=false"/><small class="muted">用于项目卡片、顶部和搜索。稳定路径 {{repo.namespace}}/{{repo.name}} 保持不变。</small></label>
          <label class="form-label">描述<textarea v-model="description" class="field" rows="3" maxlength="2000" placeholder="介绍这份数据集的用途、来源与内容…" :disabled="!writable || saving" @input="saved = false" /><small class="muted">{{ description.length }} / 2000</small></label>
        </div></article>
        <article class="panel settings-card"><header><h3>版本与可见性</h3><p class="muted">设置默认浏览分支，以及哪些身份可以访问项目。</p></header><div class="settings-body">
          <label class="form-label"><span><GitBranch :size="15" /> 默认分支</span><select v-model="defaultBranch" class="field" :disabled="!writable || saving" @change="saved = false"><option v-for="item in branches" :key="item.name" :value="item.name">{{ item.name }}</option></select><small class="muted">配置保存在固定分支 {{ state.configurationBranch }}，切换默认分支不会移动访问策略。</small></label>
          <fieldset class="visibility-fields" :disabled="!writable || saving"><legend>仓库可见性</legend><label :class="{ selected: visibility === 'private' }"><input v-model="visibility" type="radio" value="private" @change="saved = false" /><LockKeyhole :size="18" /><span><strong>私有</strong><small>实例所有者与授权协作者可以访问</small></span></label><label :class="{ selected: visibility === 'public' }"><input v-model="visibility" type="radio" value="public" @change="saved = false" /><Globe2 :size="18" /><span><strong>公开只读</strong><small>访客可浏览；写入仍需协作权限</small></span></label></fieldset>
        </div></article>
        <details class="storage-note"><summary>版本与访问策略说明</summary><p>设置保存在 <code>{{ state.storagePath }}</code>，配置版本 <code>{{ state.commitId.slice(0, 8) }}</code>，每次保存生成一个提交。本地 Web 访问策略与云端账户权限独立；上游 Oxen 原生权限保持只读。</p></details>
        <p v-if="formError" class="error-state" role="alert">{{ formError }}</p>
        <footer class="settings-footer"><span v-if="saved" class="saved-message" role="status"><CheckCircle2 :size="16" /> 设置已提交</span><button class="btn btn-primary" :disabled="!writable || saving"><LoaderCircle v-if="saving" :size="16" class="spinning" /><Save v-else :size="16" /> 保存设置</button></footer>
      </form>
      <section v-if="activeSection==='general'" class="panel settings-card"><header><h3>项目标签</h3><p class="muted">采用领域中的数据集模板，并使用统一的项目标签。字段与选项由标签管理维护。</p></header><div class="settings-body"><ProjectLabelSummary :labels="projectLabels" @edit="labelsOpen=true"/><p><button class="btn" @click="labelsOpen=true">{{projectLabels?.capabilities.edit?'选择项目标签':'查看项目标签'}}</button> <button v-if="state.permissions?.capabilities?.['schema.bind']" class="btn btn-ghost" @click="configureProjectLabels">采用领域模板</button></p></div></section>
      <RepositoryDangerZone v-if="activeSection==='general'" :base="base" :enabled="writable" @removed="removed"/>
      <AccessPanel v-show="activeSection==='access'" :base="base" :enabled="writable" @changed="accessChanged" />
  <SchemaBindingPanel v-if="activeSection==='schema'" :base="base" :branch="branch" @bound="labelsChanged"/>
      <DatasetConfigurationPanel v-if="activeSection==='dataset'" :base="base" :branch="branch" @configured="emit('changed')"/>

      <SampleFieldsPanel v-if="activeSection==='fields'" :base="base" :branch="branch" @saved="emit('changed')" @configure-dataset="selectSection('dataset')"/>
      </div>
    </div>
  </section>
  <BranchDatasetLabels v-if="labelsOpen" :base="base" :can-configure="state?.permissions?.capabilities?.['schema.bind']===true" @close="labelsOpen=false" @changed="labelsChanged" @configure="configureProjectLabels"/>
</template>
<style scoped>
input.field,textarea.field,select.field{display:block;min-height:39px;padding:10px 12px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--text);font-size:13px;line-height:1.5;font-weight:400;gap:0}
input.field:focus,textarea.field:focus,select.field:focus{outline:2px solid var(--line);outline-offset:1px;border-color:var(--line)}
input.field:disabled,textarea.field:disabled,select.field:disabled{background:var(--surface-raised);color:var(--muted);cursor:not-allowed}
input.field::placeholder,textarea.field::placeholder{color:var(--muted)}
.section-heading{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:24px}
.section-heading h2{font-size:23px;margin:0 0 7px}
.section-heading p{font-size:13px;margin:0}
.settings-icon{color:var(--text)}
.settings-form{max-width:810px}
.settings-card{overflow:hidden;margin-bottom:20px}
.settings-card>header{padding:22px 25px;border-bottom:1px solid var(--line);background:var(--surface-raised)}
.settings-card h3{font-size:15px;margin:0 0 7px}
.settings-card header p{font-size:13px;line-height:1.7;margin:0}
.settings-body{padding:6px 25px 13px}
.form-label{display:flex;flex-direction:column;gap:9px;margin:22px 0;font-size:13px;font-weight:550}
.form-label>span{display:flex;align-items:center;gap:7px}
.form-label small{font-size:13px;font-weight:400;line-height:1.5}
.form-label .field{width:100%;box-sizing:border-box;max-width:630px}
.form-label textarea{resize:vertical}
.readonly{background:var(--surface-raised);color:var(--muted)}
.visibility-fields{border:0;padding:0;margin:24px 0 13px;max-width:630px;display:flex;gap:13px;flex-wrap:wrap}
.visibility-fields legend{font-size:13px;font-weight:550;margin-bottom:12px;padding:0}
.visibility-fields label{display:flex;align-items:center;gap:11px;border:1px solid var(--line);padding:17px 19px;flex:1;min-width:200px;cursor:pointer;border-radius:7px;color:var(--text)}
.visibility-fields label.selected{border-color:var(--line);background:var(--surface-raised);color:var(--text)}
.visibility-fields input{accent-color:var(--primary)}
.visibility-fields strong{font-size:13px;display:block}
.visibility-fields small{font-size:13px;line-height:1.5;display:block;margin-top:6px}
.settings-footer{display:flex;justify-content:flex-end;align-items:center;gap:20px;margin-top:25px}
.saved-message{display:flex;align-items:center;gap:7px;font-size:13px;color:var(--text)}
.capability-note{font-size:13px;padding:14px;background:var(--surface-raised);border:1px solid var(--line);border-radius:7px;margin-bottom:18px}
.storage-note{font-size:13px;color:var(--muted);line-height:1.8;overflow-wrap:anywhere}
.empty{display:flex;flex-direction:column;align-items:center;gap:12px;padding:65px 24px}
.spinning{animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}
}
@media(max-width:640px){.settings-card>header{padding:20px 18px}
.settings-body{padding:2px 18px 10px}
.visibility-fields{display:block}
.visibility-fields label{margin-bottom:10px}
}
.settings-layout{display:grid;grid-template-columns:210px minmax(0,1fr);gap:32px;align-items:start}
.settings-navigation{display:flex;flex-direction:column;gap:5px;padding:6px 0;position:sticky;top:20px}
.settings-navigation>span{padding:0 12px 12px;color:var(--muted);font-size:12px;letter-spacing:.05em}
.settings-navigation button{display:flex;align-items:center;gap:10px;text-align:left;padding:12px;border:1px solid transparent;border-radius:6px;color:var(--muted);font-size:14px}
.settings-navigation button:hover{background:var(--surface-raised);color:var(--text)}
.settings-navigation button.active{color:var(--text);background:color-mix(in srgb,var(--primary) 13%,var(--surface));border-color:color-mix(in srgb,var(--primary) 35%,var(--line))}
.settings-form{max-width:900px;width:100%}
.settings-card>header{background:var(--surface);padding:24px}
.settings-card h3{font-size:17px}
.settings-body{padding:2px 24px 12px}
.form-label{font-size:14px}
.form-label small{font-size:12px}
.form-label .field{max-width:100%;font-size:14px;min-height:40px}
.visibility-fields{max-width:100%}
.visibility-fields label.selected{background:color-mix(in srgb,var(--primary) 10%,var(--surface));border-color:var(--primary);color:var(--text)}
.visibility-fields input{accent-color:var(--primary)}
.visibility-fields strong{font-size:14px}
.visibility-fields small{color:var(--muted);font-size:13px}
.settings-footer{padding:18px 0 24px;border-bottom:1px solid var(--line)}
.saved-message{color:var(--success)}
.storage-note{padding:14px 0;font-size:12px;color:var(--muted)}
.storage-note summary{cursor:pointer;user-select:none}
.storage-note p{margin-top:12px}
.storage-note code{color:var(--text)}
@media(max-width:850px){.settings-layout{grid-template-columns:1fr;gap:20px}
.settings-navigation{position:static;flex-direction:row;flex-wrap:wrap;border-bottom:1px solid var(--line);padding:0 0 12px}
.settings-navigation>span{display:none}
.settings-navigation button{font-size:13px}
.settings-card>header{padding:20px}
.settings-body{padding:2px 20px 10px}
}
.form-label .field{margin:0}
.visibility-fields label{background:var(--surface)}
.settings-card:focus-within{border-color:var(--line)}
input.field:focus,textarea.field:focus,select.field:focus{outline:2px solid color-mix(in srgb,var(--primary) 55%,transparent);border-color:var(--primary)}

</style>
