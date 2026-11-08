<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { Check, GitBranch, GitMerge, GitPullRequest, LoaderCircle, Plus, RefreshCw, Search, X } from 'lucide-vue-next';
import type { BranchItem, Capabilities, JobItem, RepoSummary } from '@oxen/shared';
import { post, request } from '../api';
import { useAppStore } from '../stores/app';
const props = defineProps<{ base: string; branch: string; capabilities?: Capabilities }>();
const emit = defineEmits<{ changed: []; 'branch-change': [branch: string] }>();
const app = useAppStore();
const branches = ref<BranchItem[]>([]), loading = ref(false), busy = ref(false), error = ref('');
const search=ref('');
const visibleBranches=computed(()=>branches.value.filter(item=>item.name.toLowerCase().includes(search.value.toLowerCase())));
const createOpen = ref(false), mergeOpen = ref(false), name = ref(''), from = ref(''), source = ref(''), target = ref(''), formError = ref('');
const job = ref<JobItem | null>(null), jobError = ref('');
const writable = computed(() => props.capabilities?.write !== false);
const supportsMerge = computed(() => writable.value && (app.status?.mode === 'demo' || props.capabilities?.cli !== false));
let loadVersion = 0;
let jobVersion = 0;
let jobTimer: ReturnType<typeof setTimeout> | undefined;
let mounted = true;
async function load() {
  const version = ++loadVersion; loading.value = true; error.value = '';
  try { const [data, repository] = await Promise.all([request<BranchItem[]>(props.base + '/branches'), request<RepoSummary>(props.base)]); if (version === loadVersion) branches.value = data.map(item => ({ ...item, isDefault: item.name === repository.defaultBranch })); }
  catch (cause) { if (version === loadVersion) error.value = (cause as Error).message; }
  finally { if (version === loadVersion) loading.value = false; }
}
function openCreate() { name.value = ''; from.value = props.branch; formError.value = ''; createOpen.value = true; }
function openMerge(branch: string) { source.value = branch; target.value = props.branch; formError.value = ''; mergeOpen.value = true; }
async function create() {
  if (!name.value.trim()) { formError.value = '请输入新分支名称。'; return; }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(name.value) || name.value.includes('..') || name.value.endsWith('/')) { formError.value = '分支名称请使用字母、数字、点、下划线、短横线或斜杠，不能包含连续的点。'; return; }
  if (branches.value.some(item => item.name === name.value)) { formError.value = '该分支已存在。'; return; }
  busy.value = true; formError.value = '';
  try { await post(props.base + '/branches', { name: name.value.trim(), from: from.value }); createOpen.value = false; app.notify('分支已创建'); await load(); emit('changed'); }
  catch (cause) { formError.value = (cause as Error).message; }
  finally { busy.value = false; }
}
async function merge() {
  if (!source.value || !target.value || source.value === target.value) { formError.value = '请选择两个不同的分支。'; return; }
  busy.value = true; formError.value = '';
  try {
    const result = await post<BranchItem | JobItem>(props.base + '/merge', { source: source.value, target: target.value });
    if ('status' in result && result.status === 'failed') throw new Error(result.error || result.output || '合并失败');
    mergeOpen.value = false;
    if ('status' in result) { ++jobVersion; jobError.value = ''; await track(result, jobVersion); }
    else { app.notify('分支合并完成'); await load(); emit('changed'); }
  } catch (cause) { formError.value = (cause as Error).message; }
  finally { busy.value = false; }
}
async function track(value: JobItem, current: number) {
  if (!mounted || current !== jobVersion) return;
  clearTimeout(jobTimer); job.value = value;
  if (value.status === 'succeeded') { app.notify('分支合并完成'); await load(); emit('changed'); return; }
  if (value.status === 'failed') return;
  jobTimer = setTimeout(async () => {
    try { await track(await request<JobItem>('/jobs/' + encodeURIComponent(value.id)), current); }
    catch (cause) { if (current === jobVersion) jobError.value = (cause as Error).message; }
  }, 1000);
}
watch(() => props.base, () => { ++jobVersion; clearTimeout(jobTimer); job.value = null; jobError.value = ''; void load(); }, { immediate: true });
onBeforeUnmount(() => { mounted = false; ++loadVersion; ++jobVersion; clearTimeout(jobTimer); });
</script>
<template>
  <section aria-label="分支管理">
    <header class="section-heading"><div><h2>分支</h2><p class="muted">并行管理数据版本，审阅后将变更合并到目标分支。</p></div><button class="btn btn-primary" :disabled="!writable" @click="openCreate"><Plus :size="16" /> 新建分支</button></header>
    <p v-if="!writable" class="capability-note">{{ capabilities?.reasons.write || '当前服务未启用写入能力。' }}</p>
    <div v-if="error" class="error-state" role="alert">{{ error }}<button class="btn btn-ghost" @click="load">重试</button></div>
    <div v-else-if="loading" class="empty" role="status"><LoaderCircle :size="22" class="spinning" /> 正在读取分支…</div>
    <div v-else-if="!branches.length" class="empty"><GitBranch :size="28" /><h3>没有可用分支</h3><p>仓库完成首次提交后会显示默认分支。</p></div>
    <div v-else class="panel branch-list">
      <header class="list-caption"><span><strong>{{ branches.length }}</strong> 个可用分支</span><label class="search-field"><Search :size="15"/><input v-model="search" aria-label="搜索分支" placeholder="搜索分支名称…"/></label><button class="icon-button" aria-label="刷新分支" @click="load"><RefreshCw :size="16" /></button></header>
      <div class="table-scroll"><table class="data-table branch-table"><thead><tr><th>分支</th><th>最新提交</th><th>状态</th><th class="actions-heading">操作</th></tr></thead><tbody><tr v-for="item in visibleBranches" :key="item.name"><td><button class="branch-link" @click="emit('branch-change',item.name)"><GitBranch :size="17"/><strong>{{item.name}}</strong></button></td><td><code :title="item.commitId">{{ item.commitId ? item.commitId.slice(0, 12) : '暂无提交' }}</code></td><td><span v-if="item.isDefault" class="badge">默认分支</span><span v-if="item.name===branch" class="current"><Check :size="13"/>当前</span><span v-if="!item.isDefault&&item.name!==branch" class="muted">—</span></td><td><div class="branch-actions"><button v-if="item.name!==branch" class="btn btn-ghost" @click="emit('branch-change',item.name)">切换</button><RouterLink v-if="item.name!==branch&&writable" class="btn" :to="{path:base+'/merges',query:{branch,id:'new',source:item.name,target:branch}}"><GitPullRequest :size="15"/>发起合并请求</RouterLink><button v-if="item.name!==branch" class="icon-button" :aria-label="`直接合并${item.name}`" :disabled="!supportsMerge||job?.status==='running'||job?.status==='queued'" title="直接合并此分支" @click="openMerge(item.name)"><GitMerge :size="16"/></button></div></td></tr><tr v-if="!visibleBranches.length"><td colspan="4" class="no-branches">没有与“{{search}}”匹配的分支。</td></tr></tbody></table></div>
    </div>
    <article v-if="job" class="merge-job panel" role="status"><header><strong><GitMerge :size="16" /> 合并任务</strong><span class="badge">{{ ({ queued: '排队中', running: '执行中', succeeded: '合并完成', failed: '合并失败' })[job.status] }}</span></header><pre v-if="job.output">{{ job.output }}</pre><p v-if="job.error || jobError" class="form-error">{{ job.error || jobError }}</p></article>
    <div v-if="createOpen || mergeOpen" class="modal-scrim" @click.self="!busy && (createOpen = mergeOpen = false)">
      <section class="dialog" role="dialog" aria-modal="true" :aria-label="createOpen ? '创建分支' : '合并分支'" @keydown.esc="!busy && (createOpen = mergeOpen = false)">
        <header><h3>{{ createOpen ? '创建分支' : '合并分支' }}</h3><button class="icon-button" :disabled="busy" aria-label="关闭对话框" @click="createOpen = mergeOpen = false"><X :size="19" /></button></header>
        <form v-if="createOpen" @submit.prevent="create"><label class="form-label">新分支名称<input v-model="name" autofocus class="field" placeholder="例如 feature/reviewed-data" maxlength="120" required :disabled="busy" /></label><label class="form-label">基于分支<select v-model="from" class="field" :disabled="busy"><option v-for="item in branches" :key="item.name" :value="item.name">{{ item.name }}</option></select></label><p v-if="formError" class="form-error" role="alert">{{ formError }}</p><footer><button type="button" class="btn btn-ghost" :disabled="busy" @click="createOpen = false">取消</button><button class="btn btn-primary" :disabled="busy"><LoaderCircle v-if="busy" :size="15" class="spinning" /><Plus v-else :size="15" /> 创建分支</button></footer></form>
        <form v-else @submit.prevent="merge"><p class="muted">此操作会将源分支的变更合并到目标分支。出现冲突时，服务会返回冲突信息。</p><label class="form-label">源分支<select v-model="source" class="field" :disabled="busy"><option v-for="item in branches" :key="item.name" :value="item.name">{{ item.name }}</option></select></label><label class="form-label">目标分支<select v-model="target" class="field" :disabled="busy"><option v-for="item in branches" :key="item.name" :value="item.name">{{ item.name }}</option></select></label><div class="merge-preview"><GitMerge :size="18" /><code>{{ source }}</code><span>→</span><code>{{ target }}</code></div><p v-if="formError" class="form-error" role="alert">{{ formError }}</p><footer><button type="button" class="btn btn-ghost" :disabled="busy" @click="mergeOpen = false">取消</button><button class="btn btn-primary" :disabled="busy || source === target"><LoaderCircle v-if="busy" :size="15" class="spinning" /><GitMerge v-else :size="15" /> 确认合并</button></footer></form>
      </section>
    </div>
  </section>
</template>
<style scoped>
input.field,textarea.field,select.field{display:block;min-height:39px;padding:10px 12px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--text);font-size:13px;line-height:1.5;font-weight:400;gap:0}
input.field:focus,textarea.field:focus,select.field:focus{outline:2px solid var(--line);outline-offset:1px;border-color:var(--line)}
input.field:disabled,textarea.field:disabled,select.field:disabled{background:var(--surface-raised);color:var(--muted);cursor:not-allowed}
input.field::placeholder,textarea.field::placeholder{color:var(--muted)}
.merge-job{margin-top:20px;padding:18px 21px}
.merge-job header{display:flex;align-items:center;justify-content:space-between;font-size:13px}
.merge-job strong{display:flex;align-items:center;gap:8px}
.merge-job pre{font-size:13px;background:var(--surface-raised);padding:13px;max-height:260px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}
.section-heading{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:24px}
.section-heading h2{font-size:23px;margin:0 0 7px}
.section-heading p{font-size:13px;margin:0}
.branch-list{overflow:hidden}
.list-caption{display:flex;justify-content:space-between;align-items:center;padding:13px 20px;border-bottom:1px solid var(--line);font-size:13px;color:var(--text)}
.branch-row{display:flex;align-items:center;gap:17px;padding:24px 20px;border-bottom:1px solid var(--line)}
.branch-row:last-child{border-bottom:0}
.branch-icon{color:var(--text)}
.branch-info{flex:1;min-width:0}
.branch-title{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.branch-title strong{font-size:14px;overflow-wrap:anywhere}
.branch-info>code{font-size:13px;color:var(--muted);display:block;margin-top:8px}
.branch-actions{display:flex;gap:7px}
.current{display:inline-flex;align-items:center;gap:4px;font-size:13px;color:var(--text)}
.empty{display:flex;flex-direction:column;align-items:center;gap:12px;padding:65px 24px}
.empty h3,.empty p{margin:0}
.icon-button{display:flex;border:0;background:transparent;padding:5px;color:var(--text);cursor:pointer}
.capability-note{font-size:13px;padding:14px;background:var(--surface-raised);border:1px solid var(--line);border-radius:7px;margin-bottom:18px}
.modal-scrim{position:fixed;inset:0;background:rgba(0,0,0,.72);backdrop-filter:blur(3px);display:grid;place-items:center;z-index:80;padding:20px}
.dialog{width:100%;max-width:480px;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:26px;box-shadow:0 20px 70px rgba(0,0,0,.35)}
.dialog>header{display:flex;align-items:center;justify-content:space-between;margin-bottom:22px}
.dialog h3{font-size:20px;margin:0}
.dialog form>p{font-size:13px;line-height:1.7}
.form-label{display:flex;flex-direction:column;gap:9px;margin:18px 0;font-size:13px;font-weight:550}
.form-label .field{width:100%;box-sizing:border-box}
.dialog footer{display:flex;justify-content:flex-end;gap:10px;margin-top:25px}
.form-error{color:var(--text);font-size:13px}
.merge-preview{display:flex;align-items:center;gap:10px;background:var(--surface-raised);border:1px solid var(--line);border-radius:6px;padding:14px;font-size:13px;overflow-wrap:anywhere}
.spinning{animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}
}
@media(max-width:640px){.section-heading{align-items:flex-start}
.branch-row{flex-wrap:wrap;padding:19px 15px;gap:12px}
.branch-actions{width:100%;padding-left:30px}
.dialog{padding:22px}
.section-heading p{max-width:210px}
}
.list-caption{gap:16px;padding:16px 20px;background:var(--surface)}
.list-caption .search-field{margin-left:auto;width:270px}
.list-caption>span{white-space:nowrap;color:var(--muted)}
.list-caption>span strong{color:var(--text);font-weight:600}
.branch-table th{height:45px;padding:12px 20px;background:var(--surface-raised);font-size:12px;color:var(--muted);font-weight:500}
.branch-table td{height:72px;padding:14px 20px;font-size:13px;border-color:var(--line);vertical-align:middle}
.branch-table td:first-child{width:35%;min-width:180px}
.branch-table td>code{font-size:12px;color:var(--muted);padding:5px 7px;border:1px solid var(--line);border-radius:5px;background:var(--surface-raised)}
.branch-link{display:flex;align-items:center;gap:10px;padding:0;text-align:left;color:var(--text)}
.branch-link:hover{color:var(--primary)}
.branch-link>svg{color:var(--muted)}
.branch-link strong{font-size:14px;font-weight:550;overflow-wrap:anywhere}
.branch-actions{justify-content:flex-end;align-items:center;min-height:36px}
.actions-heading{text-align:right}
.current{color:var(--success);margin-left:8px;font-size:12px}
.branch-table .no-branches{text-align:center;height:120px;color:var(--muted)}
.branch-table .badge{font-size:11px}
.dialog{background:var(--surface);padding:24px;border-radius:8px}
.dialog .field{font-size:14px;min-height:40px}
.merge-preview{background:var(--surface-raised);color:var(--text)}
.capability-note{background:color-mix(in srgb,var(--primary) 8%,var(--surface));border-color:var(--line)}
.form-error{color:var(--danger)}
@media(max-width:740px){.list-caption{flex-wrap:wrap}
.list-caption .search-field{order:3;width:100%}
.branch-table th,.branch-table td{padding:13px}
.branch-actions .btn{font-size:12px}
.branch-table td:first-child{min-width:155px}
}
.form-label .field{margin:0}
.branch-table .status-added{color:var(--success)}
input.field:focus,textarea.field:focus,select.field:focus{outline:2px solid color-mix(in srgb,var(--primary) 55%,transparent);border-color:var(--primary)}
.branch-link:hover{color:var(--text);text-decoration:underline;text-decoration-color:var(--primary);text-underline-offset:4px}

</style>
