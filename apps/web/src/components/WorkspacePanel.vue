<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Check, CheckCircle2, ChevronRight, CloudUpload, FilePlus2, FileText, FolderGit2, GitBranch, GitCommitHorizontal, LoaderCircle, Plus, RefreshCw, Save, Trash2, Upload, X } from 'lucide-vue-next';
import type { Capabilities, FilePreview, JobItem, WorkspaceItem } from '@oxen/shared';
import { post, queryString, remove, request } from '../api';
import { useAppStore } from '../stores/app';
const props = defineProps<{ base: string; branch: string; capabilities?: Capabilities }>();
const emit = defineEmits<{ changed: [] }>();
const app = useAppStore();
const route=useRoute(),router=useRouter();
const requestedAction=computed(()=>['upload','new-file','edit-file'].includes(String(route.query.action??''))?String(route.query.action):'');
const requestedPath=computed(()=>String(route.query.path??'').replace(/\/$/,''));
const directoryPrefix=computed(()=>!requestedAction.value?'':requestedAction.value==='edit-file'?requestedPath.value.split('/').slice(0,-1).join('/'):requestedPath.value);
const intentPathValid=computed(()=>!requestedPath.value||validPath(requestedPath.value));
function dismissIntent(){void router.replace({query:{...route.query,action:undefined}});}
const workspaces = ref<WorkspaceItem[]>([]), selectedId = ref(''), loading = ref(false), busy = ref(false), error = ref(''), actionError = ref('');
const selected = computed(() => workspaces.value.find(item => item.id === selectedId.value));
const createOpen = ref(false), deleteOpen = ref(false), commitOpen = ref(false), editorOpen = ref(false), uploadOpen = ref(false);
const uploadPath = ref(''), pendingUpload = shallowRef<File | null>(null);
const name = ref(''), message = ref(''), path = ref(''), content = ref(''), formError = ref('');
const reading = ref(false);
const upload = ref<HTMLInputElement | null>(null), fileInput = ref<HTMLInputElement | null>(null);
const job = ref<JobItem | null>(null);
const writable = computed(() => props.capabilities?.workspaces !== false && props.capabilities?.write !== false);
const supportsPush = computed(() => writable.value && (app.status?.mode === 'demo' || props.capabilities?.cli !== false));
let loadVersion = 0;
let jobVersion = 0;
let readVersion = 0;
let jobTimer: ReturnType<typeof setTimeout> | undefined;
let mounted = true;
const statusText = (status: string) => (({ added: '新增', modified: '修改', removed: '删除' } as Record<string, string>)[status] ?? status);
const jobText = (status: string) => ({ queued: '排队中', running: '执行中', succeeded: '已完成', failed: '失败' }[status] ?? status);
const formatDate = (value?: string) => value ? new Date(value).toLocaleDateString('zh-CN') : '当前会话';

async function load() {
  const version = ++loadVersion; loading.value = true; error.value = '';
  try {
    const data = await request<WorkspaceItem[]>(props.base + '/workspaces');
    if (version !== loadVersion) return;
    workspaces.value = data;
    if (!data.some(item => item.id === selectedId.value)) selectedId.value = requestedAction.value ? data.find(item=>item.branch===props.branch)?.id??'' : data[0]?.id ?? '';
  } catch (cause) { if (version === loadVersion) error.value = (cause as Error).message; }
  finally { if (version === loadVersion) loading.value = false; }
}
function openCreate() { name.value = ''; formError.value = ''; createOpen.value = true; }
function invalidateRead() { ++readVersion; reading.value = false; }
function openEditor(filePath = '') { invalidateRead(); path.value = filePath || (directoryPrefix.value&&intentPathValid.value?directoryPrefix.value+'/':''); content.value = ''; formError.value = ''; editorOpen.value = true; if (filePath) void readFile(); }
async function create() {
  if (!name.value.trim()) { formError.value = '请输入工作区名称。'; return; }
  busy.value = true; formError.value = '';
  try { const item = await post<WorkspaceItem>(props.base + '/workspaces', { name: name.value.trim(), branch: props.branch }); selectedId.value = item.id; createOpen.value = false; app.notify('工作区已创建'); await load(); }
  catch (cause) { formError.value = (cause as Error).message; }
  finally { busy.value = false; }
}
function validPath(value: string) { return value.length > 0 && !value.startsWith('/') && !value.includes('\\') && !value.split('/').some(part => part === '..' || !part) && !/^[a-zA-Z]:/.test(value) && !value.includes('\0'); }
async function readFile() {
  if (!selected.value) return;
  if (!validPath(path.value.trim())) { formError.value = '请先填写仓库内的相对文件路径。'; return; }
  const context = { base: props.base, workspaceId: selected.value.id, path: path.value.trim() };
  const version = ++readVersion;
  const isCurrent = () => mounted && version === readVersion && editorOpen.value && props.base === context.base && selectedId.value === context.workspaceId && path.value.trim() === context.path;
  reading.value = true; formError.value = '';
  try {
    const file = await request<FilePreview>(context.base + '/workspaces/' + encodeURIComponent(context.workspaceId) + '/file' + queryString({ path: context.path }));
    if (!isCurrent()) return;
    if (file.text === undefined) throw new Error('该文件不能作为文本读取。请在文件页预览，或上传修改后的文件。');
    if (file.truncated) throw new Error('文件内容较大，预览被截断。请在本地编辑完整文件后上传，避免丢失内容。');
    content.value = file.text;
  } catch (cause) { if (isCurrent()) formError.value = (cause as Error).message; }
  finally { if (version === readVersion) reading.value = false; }
}
async function saveFile() {
  if (!selected.value) return;
  if (!validPath(path.value.trim())) { formError.value = '请输入仓库内的相对文件路径，不能包含 .. 或反斜杠。'; return; }
  busy.value = true; formError.value = '';
  try {
    await request(props.base + '/workspaces/' + encodeURIComponent(selected.value.id) + '/files', { method: 'PUT', body: JSON.stringify({ path: path.value.trim(), content: content.value }) });
    editorOpen.value = false; app.notify('文件已保存到工作区，提交后会写入版本历史'); await load(); emit('changed');
  } catch (cause) { formError.value = (cause as Error).message; }
  finally { busy.value = false; }
}
async function loadText(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0]; if (!file) return;
  if (file.size > 2 * 1024 * 1024) { actionError.value = '文本编辑器最大支持 2 MB 文件。'; input.value = ''; return; }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.includes(0)) throw new Error('请选择 UTF-8 文本文件；二进制文件请使用上传按钮。');
    content.value = new TextDecoder('utf-8', { fatal: true }).decode(bytes); path.value = directoryPrefix.value&&intentPathValid.value?directoryPrefix.value+'/'+file.name:file.name; formError.value = ''; editorOpen.value = true;
  } catch (cause) { actionError.value = (cause as Error).message; }
  finally { input.value = ''; }
}
function uploadFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0]; if (!file || !selected.value) return;
  input.value = '';
  if (file.size > 10 * 1024 * 1024) { actionError.value = '文件不能超过 10 MB。'; return; }
  pendingUpload.value = file; uploadPath.value = directoryPrefix.value&&intentPathValid.value?directoryPrefix.value+'/'+file.name:file.name; formError.value = ''; uploadOpen.value = true;
}
async function stageUpload() {
  if (!pendingUpload.value || !selected.value || !writable.value) return;
  const destination = uploadPath.value.trim();
  if (!validPath(destination)) { formError.value = '请输入仓库内相对路径，例如 images/example.png，不能包含 .. 或反斜杠。'; return; }
  busy.value = true; formError.value = '';
  const workspaceId = selected.value.id, file = pendingUpload.value;
  try {
    const data = new FormData(); data.append('path', destination); data.append('file', file, file.name);
    await request(props.base + '/workspaces/' + encodeURIComponent(workspaceId) + '/upload', { method: 'POST', body: data });
    uploadOpen.value = false; pendingUpload.value = null; app.notify(`已上传 ${destination} 到工作区`); await load(); emit('changed');
  } catch (cause) { formError.value = (cause as Error).message; }
  finally { busy.value = false; }
}
async function commit() {
  if (!selected.value) return;
  if (!message.value.trim()) { formError.value = '请填写提交说明。'; return; }
  busy.value = true; formError.value = '';
  try {
    const result = await post<unknown>(props.base + '/workspaces/' + encodeURIComponent(selected.value.id) + '/commit', { message: message.value.trim() });
    commitOpen.value = false; message.value = '';
    if (result && typeof result === 'object' && 'status' in result && 'id' in result) { ++jobVersion; await track(result as JobItem, jobVersion); }
    else app.notify('提交已创建');
    await load(); emit('changed');
  } catch (cause) { formError.value = (cause as Error).message; }
  finally { busy.value = false; }
}
async function erase() {
  if (!selected.value) return;
  busy.value = true; formError.value = '';
  try { await remove(props.base + '/workspaces/' + encodeURIComponent(selected.value.id)); deleteOpen.value = false; app.notify('工作区已删除'); await load(); }
  catch (cause) { formError.value = (cause as Error).message; }
  finally { busy.value = false; }
}
async function push() {
  busy.value = true; actionError.value = '';
  try { const item = await post<JobItem>(props.base + '/push', { branch: selected.value?.branch ?? props.branch }); ++jobVersion; await track(item, jobVersion); }
  catch (cause) { actionError.value = (cause as Error).message; }
  finally { busy.value = false; }
}
async function track(value: JobItem, current: number) {
  if (!mounted || current !== jobVersion) return;
  clearTimeout(jobTimer); job.value = value;
  if (value.status === 'succeeded') { app.notify(`${value.operation} 已完成`); emit('changed'); return; }
  if (value.status === 'failed') return;
  jobTimer = setTimeout(async () => {
    try { await track(await request<JobItem>('/jobs/' + encodeURIComponent(value.id)), current); }
    catch (cause) { if (current === jobVersion) actionError.value = `读取任务状态失败：${(cause as Error).message}`; }
  }, 1000);
}
watch(() => props.base, () => { selectedId.value = ''; actionError.value = ''; job.value = null; ++jobVersion; clearTimeout(jobTimer); void load(); }, { immediate: true });
watch(() => [props.base, selectedId.value, path.value], invalidateRead, { flush: 'sync' });
watch(editorOpen, open => { if (!open) invalidateRead(); }, { flush: 'sync' });
onBeforeUnmount(() => { mounted = false; invalidateRead(); ++loadVersion; ++jobVersion; clearTimeout(jobTimer); });
</script>

<template>
  <section aria-label="工作区">
    <div class="workspace-explanation"><strong>工作区保存未提交的文件变更，分支保存已提交的版本。</strong><p>这里是本机 Oxen 服务提供的文件工作区。日常样本编辑和打标请使用“数据编辑”：可多次保存本机私有草稿，核对后一次提交；无需手动新建工作区。</p></div>
    <header class="section-heading"><div><h2>工作区</h2><p class="muted">暂存文件、检查变更，再一起提交。</p></div><button class="btn btn-primary" :disabled="!writable || busy" @click="openCreate"><Plus :size="16" /> 新建工作区</button></header>
    <p v-if="!writable" class="capability-note">{{ capabilities?.reasons.workspaces || capabilities?.reasons.write || '当前服务未启用工作区写入。' }}</p>
    <section v-if="requestedAction" class="workspace-intent panel"><div class="intent-icon"><Upload v-if="requestedAction==='upload'" :size="22"/><FileText v-else :size="22"/></div><div><strong>{{requestedAction==='upload'?'上传文件':requestedAction==='edit-file'?'编辑文件':'新建文本文件'}}</strong><p>目标分支 <code>{{branch}}</code> · {{requestedAction==='edit-file'?'文件':'目录'}} <code>{{requestedPath||'根目录'}}</code></p><span v-if="!intentPathValid" class="form-error">目标路径无效，请返回文件页重新选择。</span><span v-else-if="!selected||selected.branch!==branch">选择此分支的工作区，或新建工作区后继续。</span><span v-else>使用工作区 <strong>{{selected.name}}</strong> 暂存变更，检查后再提交。</span></div><button v-if="intentPathValid&&selected?.branch===branch&&requestedAction==='upload'" class="btn btn-primary" :disabled="!writable||busy" @click="upload?.click()"><Upload :size="15"/>选择上传文件</button><button v-else-if="intentPathValid&&selected?.branch===branch" class="btn btn-primary" :disabled="!writable||busy" @click="openEditor(requestedAction==='edit-file'?requestedPath:'')"><FilePlus2 :size="15"/>{{requestedAction==='edit-file'?'打开文件编辑器':'新建文本文件'}}</button><button v-else-if="intentPathValid" class="btn" :disabled="!writable||busy" @click="openCreate"><Plus :size="15"/>新建工作区</button><button class="icon-button" aria-label="关闭文件操作提示" @click="dismissIntent"><X :size="16"/></button></section>
    <div v-if="error" class="error-state" role="alert">{{ error }}<button class="btn btn-ghost" @click="load">重试</button></div>
    <div v-else-if="loading && !workspaces.length" class="empty" role="status"><LoaderCircle class="spinning" :size="22" /> 正在读取工作区…</div>
    <div v-else-if="!workspaces.length" class="workspace-empty panel"><div class="empty-art"><FolderGit2 :size="36" :stroke-width="1.3" /></div><h3>给数据变更留一块空间</h3><p class="muted">创建工作区后，可以添加文件、编辑内容并提交到分支。<br />尚未提交的修改会保存在工作区中。</p><button class="btn btn-primary" :disabled="!writable" @click="openCreate"><Plus :size="16" /> 创建第一个工作区</button></div>
    <div v-else class="workspace-layout">
      <aside class="workspace-list panel" aria-label="选择工作区"><div class="list-caption"><span>工作区 · {{ workspaces.length }}</span><button class="icon-button" :disabled="loading" aria-label="刷新工作区" @click="load"><RefreshCw :size="14" :class="{ spinning: loading }" /></button></div><button v-for="item in workspaces" :key="item.id" class="workspace-option" :class="{ active: selectedId === item.id }" @click="selectedId = item.id; actionError = ''"><FolderGit2 :size="17" /><span><strong>{{ item.name }}</strong><small>{{ item.branch }} · {{ item.changes.length }} 处变更</small></span><ChevronRight :size="14" /></button></aside>
      <div v-if="selected" class="workspace-detail">
        <article class="panel workspace-card"><header class="workspace-card-heading"><div><h3>{{ selected.name }}</h3><p class="muted"><GitBranch :size="13" /> {{ selected.branch }} <span>·</span> 创建于 {{ formatDate(selected.createdAt) }}</p></div><button class="icon-button delete-button" :disabled="busy || !writable" aria-label="删除工作区" @click="formError = ''; deleteOpen = true"><Trash2 :size="17" /></button></header><div class="workspace-toolbar"><button class="btn btn-ghost" :disabled="!writable || busy" @click="openEditor()"><FilePlus2 :size="15" /> 添加 / 编辑文本</button><button class="btn btn-ghost" :disabled="!writable || busy" @click="upload?.click()"><Upload :size="15" /> 上传文件</button><input ref="upload" type="file" class="visually-hidden" aria-label="上传工作区文件" @change="uploadFile" /><input ref="fileInput" type="file" class="visually-hidden" aria-label="导入文本文件" @change="loadText" /></div><div class="changes-heading"><strong>待提交变更</strong><span class="badge">{{ selected.changes.length }}</span></div><div v-if="!selected.changes.length" class="clean-state"><CheckCircle2 :size="24" /><div><strong>工作区很干净</strong><p class="muted">添加或编辑文件，开始这次数据更新。</p></div></div><div v-else class="change-list"><div v-for="change in selected.changes" :key="change.path" class="change-row"><FileText :size="15" /><button v-if="change.status !== 'removed'" type="button" class="change-file-button" :disabled="!writable || busy" @click="openEditor(change.path)"><code>{{ change.path }}</code></button><code v-else>{{ change.path }}</code><span class="change-status" :class="`status-${change.status}`">{{ statusText(change.status) }}</span></div></div><footer class="workspace-footer"><span class="muted">{{ selected.changes.length }} 个待提交文件</span><button class="btn btn-primary" :disabled="!writable || busy || !selected.changes.length" @click="formError = ''; message = ''; commitOpen = true"><GitCommitHorizontal :size="16" /> 提交变更</button></footer></article>
        <article class="push-card panel"><div><CloudUpload :size="23" /><span><strong>同步到远端</strong><p class="muted">{{ app.status?.mode === 'demo' ? '仅运行本地演示，不会连接真实远端。' : '将已提交的版本推送到远端仓库。' }}</p></span></div><button class="btn btn-ghost" :disabled="!supportsPush || busy || (job?.status === 'running' || job?.status === 'queued')" @click="push"><CloudUpload :size="15" /> {{ app.status?.mode === 'demo' ? '演示推送' : 'Push' }}</button></article>
        <p v-if="!supportsPush" class="muted small-note">{{ capabilities?.reasons.cli || '推送需要配置受管仓库和 Oxen CLI。' }}</p>
      </div>
      <div v-else class="workspace-unselected panel empty"><FolderGit2 :size="30"/><h3>选择工作区</h3><p>当前分支 {{branch}} 没有已选工作区。选择左侧工作区，或为此分支新建工作区。</p><button class="btn btn-primary" :disabled="!writable" @click="openCreate"><Plus :size="15"/>新建工作区</button></div>
    </div>
    <p v-if="actionError" class="error-state" role="alert">{{ actionError }}</p>
    <article v-if="job" class="job-card panel" :class="`job-${job.status}`" role="status"><header><span><LoaderCircle v-if="job.status === 'running' || job.status === 'queued'" class="spinning" :size="16" /><Check v-else-if="job.status === 'succeeded'" :size="16" /><X v-else :size="16" /><strong>{{ job.operation }}</strong></span><span class="badge">{{ jobText(job.status) }}</span></header><pre v-if="job.output">{{ job.output }}</pre><p v-if="job.error" class="form-error">{{ job.error }}</p></article>
    <div v-if="createOpen || deleteOpen || commitOpen || editorOpen || uploadOpen" class="modal-scrim" @click.self="!busy && (createOpen = deleteOpen = commitOpen = editorOpen = uploadOpen = false)">
      <section class="dialog" :class="{ 'editor-dialog': editorOpen }" role="dialog" aria-modal="true" :aria-label="createOpen ? '新建工作区' : deleteOpen ? '删除工作区' : commitOpen ? '提交变更' : uploadOpen ? '上传工作区文件' : '编辑工作区文本'" @keydown.esc="!busy && (createOpen = deleteOpen = commitOpen = editorOpen = uploadOpen = false)"><header><h3>{{ createOpen ? '新建工作区' : deleteOpen ? '删除工作区' : commitOpen ? '提交变更' : uploadOpen ? '上传文件' : '添加 / 编辑文本' }}</h3><button class="icon-button" :disabled="busy" aria-label="关闭对话框" @click="createOpen = deleteOpen = commitOpen = editorOpen = uploadOpen = false"><X :size="19" /></button></header>
        <form v-if="createOpen" @submit.prevent="create"><p class="muted">基于 <strong>{{ branch }}</strong> 分支创建一个独立的编辑空间。</p><label class="form-label">工作区名称<input v-model="name" class="field" placeholder="例如 图像标注修订" maxlength="120" required :disabled="busy" /></label><p v-if="formError" class="form-error" role="alert">{{ formError }}</p><footer><button type="button" class="btn btn-ghost" :disabled="busy" @click="createOpen = false">取消</button><button class="btn btn-primary" :disabled="busy"><LoaderCircle v-if="busy" class="spinning" :size="15" /> 创建工作区</button></footer></form>
        <form v-else-if="deleteOpen" @submit.prevent="erase"><p class="muted">确认删除工作区 <strong>{{ selected?.name }}</strong>？</p><p v-if="selected?.changes.length" class="delete-warning">此工作区有 {{ selected.changes.length }} 处尚未提交的变更，删除后这些变更将被丢弃。</p><p v-if="formError" class="form-error" role="alert">{{ formError }}</p><footer><button type="button" class="btn btn-ghost" :disabled="busy" @click="deleteOpen = false">保留工作区</button><button class="btn btn-danger" :disabled="busy"><LoaderCircle v-if="busy" class="spinning" :size="15" /> 确认删除</button></footer></form>
        <form v-else-if="commitOpen" @submit.prevent="commit"><p class="muted">将 {{ selected?.changes.length }} 个文件的变更提交到 <strong>{{ selected?.branch }}</strong>。</p><label class="form-label">提交说明<textarea v-model="message" class="field" rows="3" placeholder="描述这次数据更新…" maxlength="2000" required :disabled="busy" /></label><p v-if="formError" class="form-error" role="alert">{{ formError }}</p><footer><button type="button" class="btn btn-ghost" :disabled="busy" @click="commitOpen = false">取消</button><button class="btn btn-primary" :disabled="busy"><LoaderCircle v-if="busy" class="spinning" :size="15" /><GitCommitHorizontal v-else :size="16" /> 确认提交</button></footer></form>
        <form v-else-if="uploadOpen" @submit.prevent="stageUpload"><p class="muted">{{ pendingUpload?.name }} · {{ ((pendingUpload?.size || 0) / 1024).toFixed(1) }} KB</p><label class="form-label">仓库内目标路径<input v-model="uploadPath" class="field mono" required maxlength="1024" placeholder="images/example.png" :disabled="busy" /></label><p class="editor-notice">可以上传到嵌套目录。同名文件将替换工作区中的内容，提交前可检查变更。单文件最大 10 MB。</p><p v-if="formError" class="form-error" role="alert">{{ formError }}</p><footer><button type="button" class="btn btn-ghost" :disabled="busy" @click="uploadOpen = false">取消</button><button class="btn btn-primary" :disabled="busy || !writable"><LoaderCircle v-if="busy" class="spin" :size="15" /><Upload v-else :size="15" /> 上传到工作区</button></footer></form>
        <form v-else @submit.prevent="saveFile"><p class="editor-notice">内容会替换工作区中的同名文件。保存后仍需提交才能生成版本。</p><label class="form-label">文件路径<span class="file-path-input"><input v-model="path" class="field mono" placeholder="例如 annotations/review.json" maxlength="500" required :disabled="busy || reading" /><button type="button" class="btn btn-ghost" :disabled="busy || reading || !path.trim()" @click="readFile"><LoaderCircle v-if="reading" :size="14" class="spinning" />读取文件</button></span></label><label class="form-label">文件内容<textarea v-model="content" class="field code-editor" rows="13" spellcheck="false" placeholder="输入 UTF-8 文本内容…" :disabled="busy || reading" /></label><p v-if="formError" class="form-error" role="alert">{{ formError }}</p><footer class="editor-footer"><button type="button" class="btn btn-ghost import-button" :disabled="busy || reading" @click="fileInput?.click()"><Upload :size="15" /> 从文件导入</button><button type="button" class="btn btn-ghost" :disabled="busy" @click="editorOpen = false">取消</button><button class="btn btn-primary" :disabled="busy || reading"><LoaderCircle v-if="busy" class="spinning" :size="15" /><Save v-else :size="15" /> 保存到工作区</button></footer></form>
      </section>
    </div>
  </section>
</template>

<style scoped>
.workspace-explanation{padding:14px 16px;margin-bottom:20px;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);font-size:12px;color:var(--muted)}.workspace-explanation strong{font-weight:500;color:var(--text)}.workspace-explanation p{margin-top:6px;line-height:1.7}
input.field,textarea.field,select.field{display:block;min-height:39px;padding:10px 12px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--text);font-size:13px;line-height:1.5;font-weight:400;gap:0}
input.field:focus,textarea.field:focus,select.field:focus{outline:2px solid var(--line);outline-offset:1px;border-color:var(--line)}
input.field:disabled,textarea.field:disabled,select.field:disabled{background:var(--surface-raised);color:var(--muted);cursor:not-allowed}
input.field::placeholder,textarea.field::placeholder{color:var(--muted)}
.change-file-button{flex:1;min-width:0;text-align:left;background:none;border:0;padding:0;cursor:pointer;color:inherit;overflow-wrap:anywhere}
.change-file-button:hover{text-decoration:underline;color:var(--text)}
.file-path-input{display:flex;gap:8px}
.file-path-input input{flex:1;min-width:0}
.file-path-input button{flex-shrink:0}
.section-heading{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:24px}
.section-heading h2{font-size:23px;margin:0 0 7px}
.section-heading p{font-size:13px;margin:0}
.workspace-layout{display:grid;grid-template-columns:235px minmax(0,1fr);gap:20px}
.workspace-list{align-self:start;overflow:hidden}
.list-caption{display:flex;justify-content:space-between;align-items:center;padding:13px 16px;border-bottom:1px solid var(--line);color:var(--text);font-size:13px}
.workspace-option{display:flex;align-items:center;gap:10px;width:100%;padding:19px 15px;background:transparent;border:0;border-bottom:1px solid var(--line);cursor:pointer;color:inherit;text-align:left}
.workspace-option>span{flex:1;min-width:0}
.workspace-option strong{display:block;overflow-wrap:anywhere;font-size:13px}
.workspace-option small{display:block;font-size:13px;color:var(--muted);margin-top:6px;overflow-wrap:anywhere}
.workspace-option.active{background:var(--surface-raised);box-shadow:inset 3px 0 rgba(0,0,0,.35)}
.workspace-option:hover{background:var(--surface-raised)}
.workspace-detail{min-width:0}
.workspace-card{overflow:hidden}
.workspace-card-heading{display:flex;justify-content:space-between;gap:20px;padding:24px 22px 19px}
.workspace-card h3{font-size:18px;margin:0 0 9px;overflow-wrap:anywhere}
.workspace-card-heading p{font-size:13px;display:flex;align-items:center;gap:6px;margin:0}
.workspace-toolbar{display:flex;gap:8px;flex-wrap:wrap;padding:0 22px 22px}
.changes-heading{display:flex;gap:9px;align-items:center;padding:13px 22px;background:var(--surface-raised);border-top:1px solid var(--line);border-bottom:1px solid var(--line);font-size:13px}
.change-row{display:flex;align-items:center;gap:10px;padding:16px 22px;border-bottom:1px solid var(--line);font-size:13px}
.change-row code{flex:1;overflow-wrap:anywhere;min-width:0}
.change-status{font-size:13px;padding:3px 7px;border-radius:4px;background:var(--surface-raised);color:var(--text)}
.status-added{background:var(--surface-raised);color:var(--text)}
.status-removed{background:var(--surface-raised);color:var(--text)}
.clean-state{display:flex;align-items:center;gap:14px;padding:35px 22px;color:var(--text)}
.clean-state strong{font-size:13px}
.clean-state p{font-size:13px;margin:7px 0 0}
.workspace-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:17px 22px;background:var(--surface-raised);border-top:1px solid var(--line)}
.workspace-footer>span{font-size:13px}
.push-card{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-top:17px;padding:21px}
.push-card>div{display:flex;align-items:center;gap:13px;color:var(--text)}
.push-card strong{font-size:13px}
.push-card p{font-size:13px;margin:6px 0 0}
.small-note{font-size:13px;margin:10px 3px}
.workspace-empty{text-align:center;padding:55px 25px 60px}
.empty-art{display:grid;place-items:center;width:80px;height:80px;background:var(--surface-raised);border:1px solid var(--line);border-radius:8px;margin:0 auto 25px;color:var(--text)}
.workspace-empty h3{font-size:20px;margin:0 0 13px}
.workspace-empty p{font-size:13px;line-height:1.9;margin:0 0 25px}
.icon-button{display:flex;border:0;background:transparent;padding:5px;color:var(--text);cursor:pointer}
.delete-button:hover{color:var(--text)}
.empty{display:flex;flex-direction:column;align-items:center;gap:12px;padding:65px 24px}
.capability-note,.delete-warning{font-size:13px;padding:14px;background:var(--surface-raised);border:1px solid var(--line);border-radius:7px;margin-bottom:18px}
.job-card{margin-top:20px;padding:18px 21px}
.job-card header{display:flex;justify-content:space-between;align-items:center;font-size:13px}
.job-card header>span:first-child{display:flex;align-items:center;gap:9px}
.job-card pre{max-height:240px;overflow:auto;font-size:13px;background:var(--surface-raised);padding:13px;white-space:pre-wrap;overflow-wrap:anywhere;margin-bottom:0}
.job-failed{border-color:var(--line)}
.modal-scrim{position:fixed;inset:0;background:rgba(0,0,0,.72);backdrop-filter:blur(3px);display:grid;place-items:center;z-index:80;padding:20px;overflow:auto}
.dialog{width:100%;max-width:480px;max-height:calc(100vh - 40px);overflow:auto;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:26px;box-sizing:border-box;box-shadow:0 20px 70px rgba(0,0,0,.35)}
.editor-dialog{max-width:740px}
.dialog>header{display:flex;align-items:center;justify-content:space-between;margin-bottom:22px}
.dialog h3{font-size:20px;margin:0}
.dialog form>p{font-size:13px;line-height:1.7}
.form-label{display:flex;flex-direction:column;gap:9px;margin:18px 0;font-size:13px;font-weight:550}
.form-label .field{width:100%;box-sizing:border-box}
.dialog footer{display:flex;justify-content:flex-end;gap:10px;margin-top:25px}
.dialog footer.editor-footer{flex-wrap:wrap}
.import-button{margin-right:auto}
.form-error{color:var(--text);font-size:13px}
.editor-notice{background:var(--surface-raised);padding:11px 13px;border-radius:5px;color:var(--text)}
.code-editor{font-family:Consolas,'Cascadia Code',monospace;font-size:13px;line-height:1.7;resize:vertical;tab-size:2}
.visually-hidden{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.spinning{animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}
}
@media(max-width:850px){.workspace-layout{grid-template-columns:1fr}
.workspace-list{display:flex;overflow:auto}
.list-caption{display:none}
.workspace-option{min-width:190px;border-right:1px solid var(--line);border-bottom:0}
.workspace-option.active{box-shadow:inset 0 -3px rgba(0,0,0,.35)}
}
@media(max-width:640px){.section-heading{align-items:flex-start}
.section-heading p{max-width:180px}
.workspace-card-heading{padding:20px 16px}
.workspace-toolbar{padding:0 16px 20px}
.change-row,.changes-heading{padding-left:16px;padding-right:16px}
.workspace-footer{padding:15px 16px}
.push-card{padding:16px}
.push-card p{max-width:160px;line-height:1.5}
.dialog{padding:22px}
}
.workspace-intent{display:flex;align-items:center;gap:18px;padding:20px 22px;margin-bottom:24px;border-color:color-mix(in srgb,var(--primary) 40%,var(--line));background:color-mix(in srgb,var(--primary) 7%,var(--surface))}
.intent-icon{display:grid;place-items:center;width:42px;height:42px;flex-shrink:0;border:1px solid var(--line);border-radius:7px;background:var(--surface-raised);color:var(--primary)}
.workspace-intent>div:nth-child(2){flex:1;min-width:0}
.workspace-intent strong{font-size:14px}
.workspace-intent p{font-size:13px;color:var(--muted);margin:6px 0;overflow-wrap:anywhere}
.workspace-intent span{font-size:12px;color:var(--muted)}
.workspace-intent code{color:var(--text);font-size:12px}
.workspace-layout{grid-template-columns:260px minmax(0,1fr);gap:24px}
.workspace-list{background:var(--surface)}
.workspace-option{padding:17px 16px}
.workspace-option.active{box-shadow:inset 3px 0 var(--primary);background:color-mix(in srgb,var(--primary) 8%,var(--surface))}
.workspace-option.active>svg{color:var(--primary)}
.workspace-option strong{font-size:14px}
.workspace-option small{font-size:12px}
.workspace-card-heading{padding:22px 24px 18px}
.workspace-toolbar{padding:0 24px 20px}
.workspace-toolbar>.btn{background:var(--surface-raised);border-color:var(--line)}
.workspace-footer{padding:18px 24px}
.workspace-card-heading h3{font-size:20px}
.change-row{min-height:58px}
.change-row code{font-size:13px}
.change-status.status-added{background:color-mix(in srgb,var(--success) 12%,var(--surface));color:var(--success)}
.change-status.status-removed{background:color-mix(in srgb,var(--danger) 12%,var(--surface));color:var(--danger)}
.change-status.status-modified{background:color-mix(in srgb,var(--primary) 12%,var(--surface));color:var(--primary)}
.clean-state>svg{color:var(--success)}
.push-card{padding:20px 24px}
.push-card>div>svg{color:var(--muted)}
.push-card strong{font-size:14px}
.push-card p{font-size:13px}
.code-editor{font-size:13px;line-height:1.9;background:var(--bg)!important;min-height:300px}
.dialog .field{font-size:14px}
.dialog .form-error,.form-error{color:var(--danger)}
.dialog{border-radius:8px;background:var(--surface);box-shadow:0 30px 100px rgba(0,0,0,.45)}
.delete-warning{color:var(--danger);background:color-mix(in srgb,var(--danger) 8%,var(--surface));border-color:color-mix(in srgb,var(--danger) 35%,var(--line))}
@media(max-width:850px){.workspace-layout{grid-template-columns:1fr}
.workspace-intent{flex-wrap:wrap;padding:18px}
.workspace-intent>div:nth-child(2){flex-basis:calc(100% - 60px)}
.workspace-intent>.btn{margin-left:60px}
.workspace-intent>.icon-button{margin-left:auto}
.workspace-option.active{box-shadow:inset 0 -3px var(--primary)}
}
.form-label .field,.file-path-input>.field{margin:0}
.job-failed{border-color:var(--danger)}
.job-card p.form-error{color:var(--danger)}
.workspace-intent span.form-error{color:var(--danger)}
input.field:focus,textarea.field:focus,select.field:focus{outline:2px solid color-mix(in srgb,var(--primary) 55%,transparent);border-color:var(--primary)}

</style>
