<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { CheckCircle2, FileJson2, GitBranch, LoaderCircle, RefreshCw, Upload, X } from 'lucide-vue-next';
import type { BranchItem, CommitItem, JsonlImportResult, JsonlValidationResult, RepoSummary, RepositoryPermissions, RepositorySettingsState, WorkspaceItem } from '@oxen/shared';
import { post, repoBase, request } from '../api';
import { useAppStore } from '../stores/app';
import ZipImportDialog from './ZipImportDialog.vue';
const props = defineProps<{ repos?: RepoSummary[]; initialNamespace?: string; initialRepo?: string; initialBranch?: string }>();
const emit = defineEmits<{ close: []; imported: [result: JsonlImportResult] }>();
const app=useAppStore();
const format=ref<'jsonl'|'zip'>('jsonl');
const canCreateRepository=computed(()=>app.status?.identity?.kind==='owner');
const targetPermissions=ref<RepositoryPermissions>({read:false,write:false,admin:false,role:null});
const repositories = ref<RepoSummary[]>(props.repos ?? []), selectedFile = shallowRef<File | null>(null), validation = ref<JsonlValidationResult>(), firstRecord = ref<Record<string, unknown>>();
const target = ref<'new' | 'existing' | 'workspace'>(props.initialRepo || !canCreateRepository.value ? 'existing' : 'new');
const namespace = ref(props.initialNamespace || props.repos?.[0]?.namespace || 'local'), newRepo = ref(''), selectedRepo = ref(props.initialRepo ? `${namespace.value}/${props.initialRepo}` : '');
const branch = ref(props.initialBranch || 'main'), destination = ref(''), description = ref(''), commitMessage = ref('');
const branches = ref<BranchItem[]>([]), workspaces = ref<WorkspaceItem[]>([]), workspaceId = ref(''), includeExisting = ref(false);
const validating = ref(false), loadingTarget = ref(false), importing = ref(false), error = ref(''), targetError = ref('');
let validationGeneration = 0, targetGeneration = 0;
const repository = computed(() => repositories.value.find(item => `${item.namespace}/${item.name}` === selectedRepo.value));
const workspace = computed(() => workspaces.value.find(item => item.id === workspaceId.value));
const expectedCommit = computed(() => branches.value.find(item => item.name === branch.value)?.commitId);
const ready = computed(() => !!selectedFile.value && !!validation.value && !validating.value && !loadingTarget.value && !importing.value && (target.value === 'new' ? canCreateRepository.value && !!namespace.value.trim() && !!newRepo.value.trim() : targetPermissions.value.write && !!repository.value && (target.value === 'existing' ? !!expectedCommit.value : !!workspace.value?.branch && (!workspace.value.changes.length || includeExisting.value))));
function nameFor(filename: string) { return filename.replace(/\.(jsonl|ndjson)$/i, '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+|[-.]+$/g, '').slice(0, 90) || 'imported-dataset'; }
async function choose(file: File | undefined) {
  if (!file || importing.value) return;
  const current = ++validationGeneration; selectedFile.value = file; validation.value = undefined; firstRecord.value = undefined; error.value = ''; validating.value = true;
  destination.value = 'data/' + file.name; if (!newRepo.value) newRepo.value = nameFor(file.name);
  if (!commitMessage.value) commitMessage.value = `Import ${file.name}`;
  try {
    if (!/\.(jsonl|ndjson)$/i.test(file.name)) throw new Error('请选择 .jsonl 或 .ndjson 文件。');
    if (file.size > 64 * 1024 * 1024) throw new Error('JSONL 导入最大支持 64 MiB；工作区文件上传最大 10 MiB。');
    const text = (await file.text()).replace(/^\uFEFF/, '');
    if (current !== validationGeneration) return;
    let rows = 0;
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      if (!line.trim()) continue;
      let record: unknown;
      try { record = JSON.parse(line); } catch (cause) { throw new Error(`第 ${index + 1} 行 JSON 无效：${(cause as Error).message}`); }
      if (record === null || typeof record !== 'object' || Array.isArray(record)) throw new Error(`第 ${index + 1} 行必须是 JSON 对象，不能是数组、字符串、数字或 null。`);
      if (rows === 0) firstRecord.value = record as Record<string, unknown>;
      rows++;
    }
    if (!rows) throw new Error('文件没有可导入的 JSON 对象行。');
    const data = new FormData(); data.append('file', file, file.name);
    const result = await request<JsonlValidationResult>('/import/jsonl/validate', { method: 'POST', body: data });
    if (current === validationGeneration) validation.value = result;
  } catch (cause) { if (current === validationGeneration) error.value = (cause as Error).message; }
  finally { if (current === validationGeneration) validating.value = false; }
}
function fileInput(event: Event) { const input = event.target as HTMLInputElement; void choose(input.files?.[0]); input.value = ''; }
function drop(event: DragEvent) { void choose(event.dataTransfer?.files[0]); }
async function loadTarget() {
  if (!repository.value) return;
  const current = ++targetGeneration, base = repoBase(repository.value.namespace, repository.value.name);
  loadingTarget.value = true; targetPermissions.value={read:false,write:false,admin:false,role:null};targetError.value = ''; branches.value = []; workspaces.value = []; workspaceId.value = ''; includeExisting.value = false;
  try {
    const [branchList, workspaceList, settings] = await Promise.all([request<BranchItem[]>(base + '/branches'), request<WorkspaceItem[]>(base + '/workspaces'), request<RepositorySettingsState>(base + '/settings')]);
    if (current !== targetGeneration) return;
    branches.value = branchList; workspaces.value = workspaceList; targetPermissions.value=settings.permissions??{read:false,write:false,admin:false,role:null};
    if (!branchList.some(item => item.name === branch.value)) branch.value = repository.value.defaultBranch || branchList[0]?.name || 'main';
    workspaceId.value = workspaceList.find(item => item.branch === branch.value)?.id ?? '';
  } catch (cause) { if (current === targetGeneration) targetError.value = (cause as Error).message; }
  finally { if (current === targetGeneration) loadingTarget.value = false; }
}
function validPath(value: string) { return /\.(jsonl|ndjson)$/i.test(value) && !value.startsWith('/') && !/[\\\x00-\x1f:]/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..' && !['.git', '.oxen'].includes(part.toLowerCase())); }
async function runImport() {
  if (!ready.value || !selectedFile.value || !validation.value) return;
  error.value = '';
  if (!validPath(destination.value.trim())) { error.value = '目标路径必须是仓库内 .jsonl/.ndjson 相对路径，不能访问内部目录或包含 ..。'; return; }
  importing.value = true;
  try {
    if (target.value === 'workspace') {
      const repo = repository.value, ws = workspace.value;
      if (!repo || !ws?.branch) throw new Error('请选择有明确分支的工作区。');
      const base = repoBase(repo.namespace, repo.name), data = new FormData();
      data.append('path', destination.value.trim()); data.append('file', selectedFile.value, selectedFile.value.name);
      await request(base + '/workspaces/' + encodeURIComponent(ws.id) + '/upload', { method: 'POST', body: data });
      const commit = await post<CommitItem>(base + '/workspaces/' + encodeURIComponent(ws.id) + '/commit', { message: commitMessage.value.trim() || `Import ${selectedFile.value.name}`, expectedCommit: branches.value.find(item => item.name === ws.branch)?.commitId });
      emit('imported', { namespace: repo.namespace, repo: repo.name, branch: ws.branch, path: destination.value.trim(), commitId: commit.id, rowCount: validation.value.rowCount, columns: validation.value.columns });
    } else {
      const data = new FormData();
      const chosenNamespace = target.value === 'new' ? namespace.value.trim() : repository.value!.namespace;
      const chosenRepo = target.value === 'new' ? newRepo.value.trim() : repository.value!.name;
      data.append('namespace', chosenNamespace); data.append('repo', chosenRepo); data.append('branch', branch.value.trim());
      data.append('path', destination.value.trim()); data.append('createRepository', String(target.value === 'new'));
      if (target.value === 'existing' && expectedCommit.value) data.append('expectedCommit', expectedCommit.value);
      if (description.value.trim()) data.append('description', description.value.trim());
      data.append('file', selectedFile.value, selectedFile.value.name);
      emit('imported', await request<JsonlImportResult>('/import/jsonl', { method: 'POST', body: data }));
    }
  } catch (cause) { error.value = (cause as Error).message; }
  finally { importing.value = false; }
}
watch(selectedRepo, () => { void loadTarget(); });
watch(workspaceId, () => { includeExisting.value = false; });
onMounted(async () => {
  try { if (!repositories.value.length) repositories.value = await request<RepoSummary[]>('/repos'); if (!selectedRepo.value) selectedRepo.value = repositories.value[0] ? `${repositories.value[0].namespace}/${repositories.value[0].name}` : ''; else void loadTarget(); }
  catch (cause) { targetError.value = (cause as Error).message; }
});
onBeforeUnmount(() => { ++validationGeneration; ++targetGeneration; });
</script>

<template>
  <ZipImportDialog v-if="format==='zip'" v-bind="props" @back="format='jsonl'" @close="emit('close')" @imported="emit('imported',$event)"/>
  <div v-else class="modal-backdrop import-backdrop" @click.self="!importing && emit('close')"><section class="import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title" @keydown.esc="!importing && emit('close')">
    <header class="import-heading"><div><FileJson2 :size="22" /><div><h2 id="import-title">导入 JSONL 数据集</h2><p>校验文件结构后，选择项目与分支，将数据保存为新版本。</p></div></div><button class="icon-button" :disabled="importing" aria-label="关闭导入" @click="emit('close')"><X :size="19" /></button></header>
    <div class="import-format-choice"><button class="btn btn-ghost" disabled>JSONL</button><button class="btn" :disabled="importing" @click="format='zip'">ZIP 数据包 / Skill</button></div>
    <form @submit.prevent="runImport"><fieldset :disabled="importing">
      <label class="import-drop" @dragover.prevent @drop.prevent="drop"><Upload :size="26" /><strong>{{ selectedFile?.name || '选择或拖入 JSONL 文件' }}</strong><span>{{ selectedFile ? `${(selectedFile.size / 1024).toFixed(1)} KB · 点击可更换文件` : '每行一个 JSON 对象，支持嵌套字段与长文本，JSONL 最大 64 MiB' }}</span><input type="file" accept=".jsonl,.ndjson,application/x-ndjson" aria-label="选择 JSONL 文件" @change="fileInput" /></label>
      <p v-if="validating" class="import-validating" role="status"><LoaderCircle :size="15" class="spin" /> 正在逐行校验，并核对服务端解析结果…</p>
      <div v-if="validation" class="import-validation"><p><CheckCircle2 :size="16" /><strong>{{ validation.rowCount.toLocaleString() }} 行校验通过</strong><span>{{ validation.columns.length }} 个字段</span></p><div class="import-column-tags"><span v-for="column in validation.columns" :key="column.name">{{ column.name }}<small>{{ column.dtype }}</small></span></div><details v-if="firstRecord"><summary>查看首行 JSON（只读）</summary><pre>{{ JSON.stringify(firstRecord, null, 2) }}</pre></details></div>
      <div class="import-target-tabs" role="group" aria-label="导入目标"><button type="button" :disabled="!canCreateRepository" :class="{ active: target === 'new' }" @click="target = 'new'">新建项目</button><button type="button" :class="{ active: target === 'existing' }" @click="target = 'existing'">已有项目</button><button type="button" :class="{ active: target === 'workspace' }" @click="target = 'workspace'">已有工作区</button></div>
      <div v-if="target === 'new'" class="import-grid"><label class="field">命名空间<input v-model="namespace" required pattern="[A-Za-z0-9][A-Za-z0-9_.-]*" maxlength="120" /></label><label class="field">新项目名称<input v-model="newRepo" required pattern="[A-Za-z0-9][A-Za-z0-9_.-]*" maxlength="120" placeholder="prompt-injection-bench" /></label></div>
      <label v-else class="field">目标项目<select v-model="selectedRepo" required><option value="" disabled>选择项目</option><option v-for="item in repositories" :key="`${item.namespace}/${item.name}`" :value="`${item.namespace}/${item.name}`">{{ item.namespace }} / {{ item.name }}</option></select></label>
      <p v-if="loadingTarget" class="import-validating"><LoaderCircle :size="14" class="spin" /> 正在读取分支与工作区…</p>
      <div v-if="targetError" class="import-error" role="alert">{{ targetError }}<button type="button" class="btn btn-ghost" @click="loadTarget"><RefreshCw :size="13" />重新读取</button></div>
      <p v-if="target!=='new' && repository && !loadingTarget && !targetPermissions.write" class="import-consent">当前身份对该仓库只有读取权限，无法导入或提交。请选择有编辑权限的仓库，或切换身份。</p><label v-if="target === 'workspace'" class="field">工作区<select v-model="workspaceId" required><option value="" disabled>选择工作区</option><option v-for="item in workspaces" :key="item.id" :value="item.id" :disabled="!item.branch">{{ item.name }} · {{ item.branch || '未知分支' }} · {{ item.changes.length }} 处变更</option></select></label>
      <div class="import-grid"><label class="field">{{ target === 'workspace' ? '工作区分支' : '目标分支' }}<input v-if="target === 'new'" v-model="branch" required maxlength="160" /><input v-else-if="target === 'workspace'" :value="workspace?.branch || '—'" readonly /><select v-else v-model="branch" required><option v-for="item in branches" :key="item.name" :value="item.name">{{ item.name }}</option></select></label><label class="field">项目内文件路径<input v-model="destination" required maxlength="1024" placeholder="data/prompt_injection_bench.jsonl" /></label></div>
      <p v-if="target === 'existing' && expectedCommit" class="import-version"><GitBranch :size="12" /> 以 <code>{{ expectedCommit.slice(0, 12) }}</code> 为预期版本，分支变化时将拒绝覆盖。</p>
      <label v-if="target === 'workspace' && workspace?.changes.length" class="import-consent"><input v-model="includeExisting" type="checkbox" /><span>此工作区有 {{ workspace.changes.length }} 处未提交变更。我确认将它们与导入文件一并提交。</span></label>
      <label v-if="target === 'workspace'" class="field">提交说明<input v-model="commitMessage" maxlength="2000" placeholder="Import JSONL dataset" /></label>
      <label v-if="target === 'new'" class="field">数据集描述（可选）<textarea v-model="description" rows="2" maxlength="2000" placeholder="说明样本来源和用途…" /></label>
      <p class="import-note">保留原始 JSON 字段和嵌套类型。导入后直接浏览样本，使用负责人采用的模板进行标注。已有托管数据集请使用数据编辑工作台的导入流程。</p>
    </fieldset><div v-if="error" class="import-error" role="alert">{{ error }}</div><footer><button type="button" class="btn btn-ghost" :disabled="importing" @click="emit('close')">取消</button><button class="btn btn-primary" :disabled="!ready"><LoaderCircle v-if="importing" :size="15" class="spin" /><Upload v-else :size="15" />{{ importing ? '正在导入并提交…' : '导入、提交并打开' }}</button></footer></form>
  </section></div>
</template>

<style scoped>
.import-format-choice{display:flex;gap:9px;padding:18px 28px 0}.import-format-choice .btn{font-size:12px;min-height:32px}
.import-backdrop{z-index:110}.import-dialog{width:100%;max-width:760px;max-height:calc(100vh - 48px);overflow:auto;border:1px solid var(--line);border-radius:10px;background:var(--surface);box-shadow:0 24px 90px #0008;color:var(--text)}.import-heading{position:sticky;top:0;z-index:2;display:flex;justify-content:space-between;align-items:flex-start;gap:15px;padding:24px 28px;border-bottom:1px solid var(--line);background:var(--surface)}.import-heading>div{display:flex;align-items:flex-start;gap:13px}.import-heading>div>svg{color:var(--accent,var(--primary));margin-top:3px}.import-heading h2{font-size:20px;letter-spacing:-.3px}.import-heading p{font-size:12px;color:var(--muted);margin-top:8px;line-height:1.7}.import-dialog form{padding:25px 28px 0}.import-dialog fieldset{padding:0;border:0;margin:0;min-width:0}.import-drop{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:11px;padding:27px 20px;border:1px dashed var(--line);border-radius:7px;background:var(--bg);color:var(--muted);cursor:pointer;text-align:center;transition:border-color .15s}.import-drop:hover,.import-drop:focus-within{border-color:var(--accent,var(--primary))}.import-drop>svg{color:var(--accent,var(--primary));margin-bottom:2px}.import-drop strong{font-size:14px;font-weight:550;color:var(--text);overflow-wrap:anywhere}.import-drop>span{font-size:12px;color:var(--muted);line-height:1.7}.import-drop input{font-size:11px;max-width:100%;margin-top:4px;color:var(--muted)}.import-drop input::file-selector-button{border:1px solid var(--line);border-radius:5px;background:var(--surface-raised);padding:7px 12px;color:var(--text);font-size:12px;margin-right:10px;cursor:pointer}.import-validating{display:flex;gap:8px;align-items:center;font-size:12px;color:var(--muted);margin:15px 0}.import-validation{margin-top:15px;border:1px solid color-mix(in srgb,var(--success) 30%,var(--line));background:color-mix(in srgb,var(--success) 5%,var(--surface));border-radius:7px;padding:15px 16px}.import-validation>p{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px;color:var(--success)}.import-validation>p>span{margin-left:auto;color:var(--muted);font-size:12px}.import-column-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px;max-height:100px;overflow:auto}.import-column-tags>span{font-size:11px;padding:4px 8px;background:var(--surface-raised);border:1px solid var(--line);border-radius:4px;color:var(--text)}.import-column-tags small{margin-left:7px;color:var(--muted);font-size:10px}.import-validation details{font-size:12px;color:var(--muted);margin-top:14px}.import-validation summary{cursor:pointer}.import-validation pre{font-size:11px;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere;max-height:260px;overflow:auto;margin:12px 0 0;padding:13px;background:var(--bg);border:1px solid var(--line);border-radius:5px;color:var(--text)}.import-target-tabs{display:flex;gap:4px;padding:4px;border:1px solid var(--line);background:var(--bg);border-radius:6px;margin:25px 0 22px}.import-target-tabs button{flex:1;font-size:12px;padding:9px;border:1px solid transparent;border-radius:4px;color:var(--muted)}.import-target-tabs button.active{background:var(--surface-raised);border-color:var(--line);color:var(--text)}.import-target-tabs button:hover:not(:disabled){color:var(--text)}.import-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.import-dialog .field{font-size:13px;margin-bottom:20px}.import-dialog .field input,.import-dialog .field textarea,.import-dialog .field select{font-size:13px}.import-version{font-size:11px;color:var(--muted);display:flex;gap:6px;align-items:center;margin:-3px 0 20px;flex-wrap:wrap}.import-version code{color:var(--text);background:var(--surface-raised);padding:2px 4px;border-radius:3px}.import-consent{display:flex;align-items:flex-start;gap:9px;padding:12px 14px;border:1px solid var(--line);border-radius:6px;background:var(--surface-raised);font-size:12px;color:var(--muted);line-height:1.8;margin-bottom:20px}.import-consent input{margin-top:5px;accent-color:var(--accent,var(--primary))}.import-note{font-size:11px;color:var(--muted);line-height:1.8;margin-top:4px;margin-bottom:4px}.import-error{font-size:12px;line-height:1.8;color:var(--danger);background:color-mix(in srgb,var(--danger) 7%,var(--surface));border:1px solid color-mix(in srgb,var(--danger) 30%,var(--line));border-radius:6px;padding:12px 14px;margin-top:16px;overflow-wrap:anywhere}.import-error .btn{font-size:11px;margin-left:9px}.import-dialog form>footer{position:sticky;bottom:0;display:flex;justify-content:flex-end;gap:10px;border-top:1px solid var(--line);margin:23px -28px 0;padding:18px 28px;background:var(--surface);z-index:2}.import-dialog form>footer .btn{font-size:13px;min-height:38px}@media(max-width:600px){.import-heading{padding:21px 20px}.import-heading h2{font-size:18px}.import-heading p{font-size:11px}.import-dialog form{padding:20px 20px 0}.import-grid{grid-template-columns:1fr;gap:0}.import-dialog{max-height:calc(100vh - 24px)}.import-drop{padding:23px 15px}.import-drop>span{font-size:11px}.import-dialog form>footer{margin-left:-20px;margin-right:-20px;padding:16px 20px}.import-target-tabs{margin-top:21px}.import-target-tabs button{padding:8px 5px;font-size:11px}}
</style>
