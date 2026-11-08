<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch, type ComputedRef } from 'vue';
import { Check, ChevronDown, Columns3, Download, Edit3, Layers3, LoaderCircle, Plus, RefreshCw, Save, Search, Tags, Trash2, X } from 'lucide-vue-next';
import type { BranchItem, LabelAssignment, LabelColumn, LabelScope, LabelState, LabelTemplate, RepositoryPermissions } from '@oxen/shared';
import { ApiError, post, queryString, request } from '../api';
import { useAppStore } from '../stores/app';

const props = defineProps<{ base: string; branch: string; scope: LabelScope; path?: string; rowId?: string; commitId?: string; readonly?: boolean }>();
const emit = defineEmits<{ changed: [state: LabelState]; loaded: [state: LabelState]; refresh: [] }>();
const app = useAppStore();
const repositoryPermissions = inject<ComputedRef<RepositoryPermissions>>('repositoryPermissions');
const repositoryBranches = inject<ComputedRef<BranchItem[]>>('repositoryBranches');
const state = ref<LabelState>(), values = ref<Record<string, string | string[]>>({});
const loading = ref(false), busy = ref(false), error = ref(''), conflict = ref(false);
const fieldSearch=ref('');
const applicableColumns=computed(()=>state.value?.columns.filter(column=>!column.scopes?.length||column.scopes.includes(props.scope))??[]);
const visibleColumns=computed(()=>applicableColumns.value.filter(column=>(column.name+' '+(column.description??'')).toLowerCase().includes(fieldSearch.value.toLowerCase())));
let generation = 0;
const typeName = (type: LabelColumn['type']) => ({ single: '单选', multi: '多选', text: '文本' })[type];
const scopeName = computed(() => ({ dataset: '整个数据集', file: '当前文件', row: '当前样本' })[props.scope]);
const assignment = computed(() => state.value?.assignments.find(item => item.scope === props.scope && (props.scope === 'dataset' || item.path === props.path) && (props.scope !== 'row' || item.rowId === props.rowId)));
const historicalRef = computed(() => /^[a-f0-9]{1,64}$/i.test(props.branch) && !repositoryBranches?.value.some(branch => branch.name === props.branch));
const editable = computed(() => !props.readonly && repositoryPermissions?.value.capabilities?.['annotation.assign'] === true && app.status?.capabilities.write !== false && props.branch.length > 0 && !historicalRef.value);
const canManageSchema = computed(() => !props.readonly && repositoryPermissions?.value.capabilities?.['schema.manage'] === true && !historicalRef.value);
const validScope = computed(() => props.scope === 'dataset' || !!props.path && (props.scope !== 'row' || !!props.rowId));
function nonEmptyValues() { return Object.fromEntries(Object.entries(values.value).filter(([, value]) => Array.isArray(value) ? value.length > 0 : value.trim().length > 0)); }
const dirty = computed(() => JSON.stringify(nonEmptyValues()) !== JSON.stringify(assignment.value?.values ?? {}));
const hasUnsavedChanges = computed(()=>dirty.value);
function discardUnsavedChanges(){fill();}
defineExpose({hasUnsavedChanges,busy,discardUnsavedChanges});
function fill() {
  const current = assignment.value?.values ?? {};
  values.value = Object.fromEntries((state.value?.columns ?? []).map(column => [column.id, current[column.id] ?? (column.type === 'multi' ? [] : '')]));
}
async function load(latest = false) {
  const current = ++generation; loading.value = true; error.value = ''; conflict.value = false;
  try {
    const result = await request<LabelState>(props.base + '/labels' + queryString({ ref: latest ? props.branch : props.commitId || props.branch }));
    if (current !== generation) return;
    state.value = result; fill(); emit('loaded', result);
  } catch (cause) { if (current === generation) error.value = (cause as Error).message; }
  finally { if (current === generation) loading.value = false; }
}
function handleError(cause: unknown) { error.value = (cause as Error).message; conflict.value = cause instanceof ApiError && (cause.code === 'LABEL_VERSION_CONFLICT' || cause.code === 'COMMIT_CONFLICT'); }
async function mutate(endpoint: string, body: Record<string, unknown>, method = 'POST') {
  const schemaOperation = /^\/labels\/(columns|templates|migrate)/.test(endpoint);
  if (!state.value || !(schemaOperation ? canManageSchema.value : editable.value) || busy.value) return false;
  const current = generation, context = { ref: props.branch, expectedCommit: state.value.commitId };
  const draft=endpoint.startsWith('/labels/columns')&&dirty.value?Object.fromEntries(Object.entries(values.value).map(([id,value])=>[id,Array.isArray(value)?[...value]:value])):undefined;
  const draftScope=JSON.stringify([props.scope,props.path,props.rowId]);
  busy.value = true; error.value = ''; conflict.value = false;
  try {
    const result = await request<LabelState>(props.base + endpoint, { method, body: JSON.stringify({ ...context, ...body }) });
    if (current !== generation) return false;
    state.value = result; fill();
    if(draft&&draftScope===JSON.stringify([props.scope,props.path,props.rowId]))for(const column of result.columns){const value=draft[column.id];if(value===undefined)continue;if(column.type==='multi'&&Array.isArray(value))values.value[column.id]=value.filter(item=>column.options?.some(option=>option.value===item));else if(column.type==='single'&&typeof value==='string')values.value[column.id]=column.options?.some(option=>option.value===value)?value:'';else if(column.type==='text'&&typeof value==='string')values.value[column.id]=value;}
    emit('changed', result); app.notify(`${result.commitId===context.expectedCommit?'配置已存在，保留当前版本':'标签已提交'} · ${result.commitId.slice(0, 8)}`); return true;
  } catch (cause) { if (current === generation) handleError(cause); return false; }
  finally { if (current === generation) busy.value = false; }
}
async function saveValues() {
  if (!validScope.value || !dirty.value) return;
  await mutate('/labels/assignments', { scope: props.scope, ...(props.scope !== 'dataset' ? { path: props.path } : {}), ...(props.scope === 'row' ? { rowId: props.rowId } : {}), values: nonEmptyValues(), message: `Label ${props.scope}: ${props.path || 'dataset'}` });
}
function toggle(column: LabelColumn, option: string) {
  const selected = Array.isArray(values.value[column.id]) ? values.value[column.id] as string[] : [];
  values.value[column.id] = selected.includes(option) ? selected.filter(value => value !== option) : [...selected, option];
}
async function migrate() { if(hasUnsavedChanges.value&&!(await app.confirmAction('当前标签修改尚未保存，迁移旧标注会重新读取赋值。确认继续吗？',{title:'迁移旧标注',confirmLabel:'放弃草稿并迁移'})))return;await mutate('/labels/migrate', { message: 'Migrate legacy annotations into versioned label columns' }); }
async function reloadLatest() { if(busy.value)return;if(hasUnsavedChanges.value&&!(await app.confirmAction('重新加载最新版本会放弃尚未保存的标签与列配置，继续吗？',{title:'重新加载标签',confirmLabel:'放弃草稿并加载'})))return;fill();emit('refresh');void load(true); }
watch(() => [props.base, props.branch, props.commitId], () => {
  if (state.value && state.value.commitId === props.commitId && state.value.ref === props.branch) return;
  state.value = undefined; values.value = {};  busy.value = false; void load();
}, { immediate: true });
watch(() => [props.scope, props.path, props.rowId], fill);
onBeforeUnmount(() => { ++generation; });
</script>

<template>
  <section class="label-manager" aria-label="版本化标签">
    <header class="label-heading"><div><Tags :size="17" /><strong>{{ scopeName }}标签</strong><span v-if="state" class="label-count">{{ applicableColumns.length }} 维度</span></div><RouterLink v-if="canManageSchema" to="/labels" class="btn btn-ghost label-config-toggle"><Columns3 :size="15"/>管理已发布规范</RouterLink></header>
    <p class="label-context"><span>{{ scope }}</span><code v-if="path && scope !== 'dataset'">{{ path }}</code><code v-if="rowId && scope === 'row'" :title="rowId">行 {{ rowId.slice(0, 18) }}</code><span v-if="state">版本 <code>{{ state.commitId.slice(0, 10) }}</code></span></p>
    <div v-if="state" class="label-export"><a :href="'/api'+base+'/labels/export'+queryString({ref:state.commitId})" class="btn btn-ghost" download><Download :size="14"/>导出标注快照</a><span>固定提交版本 · 未保存修改不包含在内</span></div>
    <details class="label-storage"><summary>标签与版本保存说明</summary><p>标签独立保存在仓库 <code>.oxenweb/labels.json</code>，每次保存生成真实提交；样本原字段保持原值。</p></details>
    <div v-if="loading" class="label-loading" role="status"><LoaderCircle :size="18" class="spin" /> 正在读取标签…</div>
    <div v-if="error" class="label-error" role="alert"><strong>{{ conflict ? '版本已变化，未覆盖其他人的修改' : '标签操作未完成' }}</strong><p>{{ error }}</p><button class="btn btn-ghost" :disabled="busy" @click="reloadLatest"><RefreshCw :size="14" /> 重新读取最新版本</button></div>
    <template v-if="state && !loading">
      <p v-if="state.templateApplications?.length" class="template-provenance">保留 {{state.templateApplications.length}} 次旧模板来源记录 · 后续规范在组织目录发布并显式绑定</p>
      <p v-if="!editable" class="label-note">当前身份只有读取权限，或正在查看历史提交。获得标签赋值权限并选择分支后，可编辑标签。</p>
<div v-if="!state.columns.length" class="labels-empty"><Columns3 :size="25"/><strong>尚未绑定标签规范</strong><p>请由项目负责人选择已发布模板；规范定义在首页“标签管理”统一维护。</p><RouterLink v-if="canManageSchema" to="/labels" class="btn">进入标签管理</RouterLink></div>
      <form v-else-if="state.columns.length" class="label-values" @submit.prevent="saveValues">
        <label v-if="applicableColumns.length>6" class="search-field label-field-search"><Search :size="14"/><input v-model="fieldSearch" aria-label="搜索标签维度" placeholder="查找标签维度…"/></label>
        <p v-if="!applicableColumns.length" class="label-note">当前层级没有适用维度，请向组织规范维护者反馈。</p>
        <p v-if="!validScope" class="label-note">{{ scope === 'row' ? '加载表格并选择一个样本后，即可赋值。' : '请选择文件路径后赋值。' }}</p>
        <fieldset :disabled="busy || !editable || !validScope || conflict">
          <div v-for="column in visibleColumns" :key="column.id" class="field label-value-field"><label :for="column.type==='multi'?undefined:'label-value-'+column.id">{{ column.name }} <small>{{ typeName(column.type) }}</small></label><span v-if="column.description" class="label-field-description">{{column.description}}</span><select v-if="column.type === 'single'" :id="'label-value-'+column.id" v-model="values[column.id]"><option value="">未设置</option><option v-for="option in column.options" :key="option.value" :value="option.value">{{ option.value }}</option></select><textarea v-else-if="column.type === 'text'" :id="'label-value-'+column.id" v-model="values[column.id]" rows="2" maxlength="4000" placeholder="填写标签文本…" /><span v-else class="multi-options" role="group" :aria-label="column.name"><button v-for="option in column.options" :key="option.value" type="button" :class="{ selected: Array.isArray(values[column.id]) && values[column.id]?.includes(option.value) }" :aria-pressed="Array.isArray(values[column.id]) && values[column.id]?.includes(option.value)" @click="toggle(column, option.value)"><Check v-if="Array.isArray(values[column.id]) && values[column.id]?.includes(option.value)" :size="12" />{{ option.value }}</button></span></div>
        </fieldset><footer><span>{{ dirty ? '有未保存的标签修改' : '标签与当前版本一致' }}</span><button class="btn btn-primary" :disabled="busy || !editable || !validScope || !dirty || conflict"><LoaderCircle v-if="busy" class="spin" :size="14" /><Save v-else :size="14" /> 保存标签并提交</button></footer>
      </form>
      <section v-if="state.legacyCount > 0" class="legacy-labels"><strong>旧标注 {{ state.legacyCount }} 条</strong><p>可迁移为版本化的 legacy 标签列；无法确定样本对应关系的记录会保留供人工处理。</p><button class="btn btn-ghost" :disabled="busy || !canManageSchema || !editable" @click="migrate"><Download :size="14" /> 迁移旧标注并提交</button></section>
      <details v-if="state.legacyMigration?.unmatched.length" class="legacy-labels"><summary>{{ state.legacyMigration.unmatched.length }} 条旧标注待匹配</summary><pre>{{ JSON.stringify(state.legacyMigration.unmatched, null, 2) }}</pre></details>
    </template>
  </section>
</template>

<style scoped>
.label-manager{min-width:0;color:var(--text)}
.label-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.label-heading>div{display:flex;gap:8px;align-items:center;font-size:14px}
.label-count{font-size:13px;background:var(--surface-raised);padding:3px 6px;border-radius:4px;color:var(--muted)}
.label-config-toggle{font-size:13px;padding:5px 8px;min-height:32px}
.label-context{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin:10px 0 7px;font-size:13px;color:var(--muted)}
.label-context>span:first-child{background:var(--surface-raised);padding:2px 6px;border-radius:3px;color:var(--text)}
.label-context code{overflow-wrap:anywhere}
.label-storage{font-size:13px;color:var(--muted);line-height:1.7}
.label-loading{display:flex;align-items:center;gap:10px;padding:28px 0;font-size:13px;color:var(--muted)}
.label-error{padding:14px;margin:15px 0;border:1px solid var(--line);border-radius:6px;background:var(--surface-raised);color:var(--text);font-size:13px}
.label-error p{font-size:13px;margin:7px 0 10px;overflow-wrap:anywhere}
.label-note{font-size:13px;background:var(--surface-raised);border:1px solid var(--line);border-radius:5px;padding:10px 12px;margin:14px 0;color:var(--muted)}
.label-schema{margin:18px 0;padding:16px;background:var(--surface-raised);border:1px solid var(--line);border-radius:6px}
.schema-heading{display:flex;justify-content:space-between;align-items:center;font-size:13px}
.schema-hint{font-size:13px;color:var(--muted);line-height:1.7;margin:7px 0 14px}
.schema-column{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 0;border-top:1px solid var(--line)}
.schema-column>div:first-child{flex:1;min-width:0}
.schema-column strong{font-size:13px;margin-right:8px}
.schema-column span{font-size:13px;color:var(--muted)}
.schema-column small{display:block;overflow-wrap:anywhere;font-size:13px;color:var(--muted);margin-top:5px}
.column-delete{width:100%;padding:10px;background:var(--surface-raised);border:1px solid var(--line);border-radius:5px;font-size:13px}
.column-delete p{margin-bottom:9px}
.column-delete button{font-size:13px;padding:5px 9px;min-height:32px;margin-right:8px}
.schema-editor{padding:16px;margin-top:13px;background:white;border:1px solid var(--line);border-radius:5px}
.schema-editor>header{display:flex;justify-content:space-between;font-size:13px;margin-bottom:14px}
.schema-form-grid{display:grid;grid-template-columns:minmax(0,1fr) 120px;gap:14px}
.schema-editor .field{font-size:13px;margin-bottom:14px}
.schema-editor .btn{font-size:13px}
.labels-empty{display:flex;flex-direction:column;align-items:center;gap:12px;padding:27px 10px;color:var(--muted)}
.labels-empty strong{font-size:13px;color:var(--muted)}
.labels-empty p{font-size:13px}
.label-values{margin-top:18px}
.label-values fieldset{padding:0;margin:0;border:0;min-width:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:16px}
.label-values .field{margin:0;font-size:13px}
.label-value-field>span:first-child{display:flex;gap:8px;align-items:center}
.label-value-field small{font-size:13px;color:var(--muted);font-weight:400}
.multi-options{display:flex;gap:7px;flex-wrap:wrap}
.multi-options button{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--line);border-radius:5px;padding:7px 10px;background:var(--surface-raised);font-size:13px;color:var(--muted)}
.multi-options button.selected{background:var(--surface-raised);border-color:var(--line);color:var(--text)}
.label-values footer{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:18px;flex-wrap:wrap}
.label-values footer>span{font-size:13px;color:var(--muted)}
.label-values footer .btn{font-size:13px}
.legacy-labels{margin-top:18px;border-top:1px solid var(--line);padding-top:13px;font-size:13px;color:var(--muted)}
.legacy-labels p{font-size:13px;margin:7px 0}
.legacy-labels pre{overflow:auto;max-height:260px;font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere}
.form-error{font-size:13px;color:var(--text);margin:9px 0}
@media(max-width:640px){.schema-form-grid{grid-template-columns:1fr}
.label-values fieldset{grid-template-columns:1fr}
.label-heading>div{font-size:13px}
.label-schema{padding:13px}
}
.label-heading>div{font-size:15px;color:var(--text)}
.label-count{font-size:11px;border:1px solid var(--line);padding:3px 7px}
.label-context{font-size:11px;gap:8px;margin:12px 0}
.label-context code{font-size:11px;background:var(--surface-raised);padding:3px 5px;border-radius:4px;overflow-wrap:anywhere}
.label-context>span:first-child{color:var(--primary);text-transform:uppercase;font-size:10px;letter-spacing:.06em}
.label-storage{font-size:12px;color:var(--muted);margin:10px 0 18px;line-height:1.8}
.label-storage summary{cursor:pointer;user-select:none}
.label-storage p{margin-top:10px}
.label-schema{margin-top:20px;background:var(--surface-raised);border-color:var(--line);padding:16px}
.schema-heading strong{font-size:14px}
.schema-hint{font-size:12px;line-height:1.8;color:var(--muted)}
.schema-column{background:var(--surface);padding:13px;border-color:var(--line)}
.schema-column strong{font-size:13px;color:var(--text)}
.schema-column span,.schema-column small{font-size:12px;color:var(--muted)}
.schema-editor{background:var(--surface);padding:16px;border-color:var(--line)}
.schema-editor .field{font-size:13px}
.schema-editor input,.schema-editor textarea,.schema-editor select{font-size:13px;background:var(--bg);min-height:38px}
.schema-editor header strong{font-size:14px}
.label-values .field{font-size:14px;gap:9px}
.label-value-field small{font-size:11px;padding:2px 5px;border:1px solid var(--line);border-radius:4px;color:var(--muted)}
.label-values select,.label-values textarea{min-height:39px;background:var(--surface-raised);font-size:13px;color:var(--text)}
.multi-options button{min-height:34px;padding:6px 10px;background:var(--surface);font-size:12px}
.multi-options button.selected{color:var(--text);border-color:var(--primary);background:color-mix(in srgb,var(--primary) 13%,var(--surface))}
.label-values footer{margin-top:22px;padding-top:18px;border-top:1px solid var(--line)}
.label-values footer>span{font-size:12px}
.label-values footer .btn{min-height:36px}
.label-error{background:color-mix(in srgb,var(--danger) 7%,var(--surface));color:var(--danger);border-color:color-mix(in srgb,var(--danger) 35%,var(--line))}
.label-note{background:var(--surface-raised);border-color:var(--line);font-size:13px}
.labels-empty{padding:26px 15px;background:var(--surface-raised);border:1px dashed var(--line);border-radius:6px;margin-top:18px;color:var(--muted)}
.labels-empty strong{font-size:14px;color:var(--text)}
.labels-empty p{font-size:13px}
.form-error{color:var(--danger);font-size:12px}
.column-delete{color:var(--danger);border-color:color-mix(in srgb,var(--danger) 30%,var(--line));background:color-mix(in srgb,var(--danger) 6%,var(--surface))}
.label-context>span:first-child{color:color-mix(in srgb,var(--primary) 65%,var(--text));font-size:11px}

</style>

<style scoped>
.label-template-entry{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:17px 0;padding:14px;border:1px solid var(--line);border-radius:6px;background:var(--surface-raised)}.label-template-entry>div{display:flex;gap:10px;align-items:center}.label-template-entry svg{color:var(--accent);flex-shrink:0}.label-template-entry strong{display:block;font-size:13px}.label-template-entry small{display:block;margin-top:4px;font-size:11px;color:var(--muted)}.label-template-entry .btn{white-space:nowrap;font-size:12px;padding:6px 10px;min-height:33px}.template-provenance{font-size:11px;color:var(--muted);margin:-5px 0 14px;line-height:1.7}.label-field-description{font-size:11px!important;font-weight:400!important;color:var(--muted);line-height:1.7;display:block!important;margin:0 0 4px}.label-field-search{margin:8px 0 18px}.column-scopes{display:flex;gap:16px;border:1px solid var(--line);padding:11px 13px;margin-bottom:15px;font-size:12px}.column-scopes legend{padding:0 5px;color:var(--muted)}.column-scopes label{display:flex;align-items:center;gap:7px}.label-values fieldset{min-width:0}
</style>

<style scoped>
.label-export{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:10px 0}.label-export .btn{font-size:12px;min-height:30px;padding:4px 8px}.label-export>span{font-size:10px;color:var(--muted)}
</style>

<style scoped>.label-value-field>label{display:block;font-size:13px;font-weight:500;margin-bottom:4px}.label-value-field>label small{font-size:10px;font-weight:400;color:var(--muted);margin-left:6px}</style>

<style scoped>.label-field-search{min-width:0;width:100%}.label-field-search input{min-width:0}.label-value-field{min-width:0}.multi-options{min-width:0;flex-wrap:wrap}</style>
