<script setup lang="ts">
import { computed, defineAsyncComponent, inject, onBeforeUnmount, onMounted, ref, watch, type ComputedRef } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import { ArrowLeft, ArrowRight, CheckCircle2, ChevronRight, FileDiff, GitBranch, GitMerge, GitPullRequest, LoaderCircle, MessageSquare, Plus, RefreshCw, Search, X } from 'lucide-vue-next';
import type { BranchItem, DiffFile, JobItem, MergeRequestComparison, MergeRequestDetail, MergeRequestItem, MergeRequestJob, RepoSummary, RepositoryPermissions } from '@oxen/shared';
import { ApiError, post, queryString, request } from '../api';
import { useAppStore } from '../stores/app';
import TabularDiff from './TabularDiff.vue';
import TextDiff from './TextDiff.vue';

const FilePreview = defineAsyncComponent(() => import('./FilePreview.vue'));
const props = defineProps<{ base: string; branch: string }>();
const emit = defineEmits<{ changed: []; 'resolve-conflicts': [source: string, target: string] }>();
const route = useRoute(), router = useRouter(), app = useAppStore();
const permissions = inject<ComputedRef<RepositoryPermissions>>('repositoryPermissions');
const writable = computed(() => permissions?.value.write === true && app.status?.capabilities.write !== false);
const canExecuteMerge = computed(() => permissions?.value.capabilities?.['merge.execute'] === true);
const endpoint = computed(() => props.base + '/merge-requests');
const selectedId = computed(() => typeof route.query.id === 'string' ? route.query.id : '');
const mode = computed(() => selectedId.value === 'new' ? 'new' : selectedId.value ? 'detail' : 'list');
const items = ref<MergeRequestItem[]>([]), branches = ref<BranchItem[]>([]), defaultBranch = ref('main');
const listLoading = ref(false), detailLoading = ref(false), comparing = ref(false), mutating = ref(false);
const listError = ref(''), detailError = ref(''), compareError = ref(''), actionError = ref('');
const filter = ref('open'), search = ref('');
const detail = ref<MergeRequestDetail>(), detailComparison = ref<MergeRequestComparison>();
const newSource = ref(''), newTarget = ref(''), newTitle = ref(''), newDescription = ref(''), newComparison = ref<MergeRequestComparison>();
const comment = ref(''), job = ref<JobItem>(), jobError = ref(''), pendingJob = ref('');
const confirmation = ref<{ action: 'merge' | 'refresh'; request: MergeRequestDetail }>();
const snapshotFile = ref<{ path: string; ref: string }>();
let contextVersion = 0, listVersion = 0, detailVersion = 0, compareVersion = 0, pollVersion = 0;
let pollTimer: ReturnType<typeof setTimeout> | undefined;
const labels: Record<MergeRequestItem['status'], string> = { open: '待合并', closed: '已关闭', merging: '正在合并', merged: '已合并' };
const counts = computed(() => ({ open: items.value.filter(item => item.status === 'open' || item.status === 'merging').length, closed: items.value.filter(item => item.status === 'closed').length, merged: items.value.filter(item => item.status === 'merged').length, all: items.value.length }));
const visible = computed(() => items.value.filter(item => (filter.value === 'all' || filter.value === 'open' && (item.status === 'open' || item.status === 'merging') || item.status === filter.value) && `${item.title} ${item.description} ${item.source} ${item.target} ${item.author.name}`.toLowerCase().includes(search.value.toLowerCase())));
const shownComparison = computed(() => mode.value === 'new' ? newComparison.value : detailComparison.value);
const newSnapshotMatches = computed(() => newComparison.value?.source === newSource.value && newComparison.value.target === newTarget.value);
const canCreate = computed(() => writable.value && !mutating.value && !comparing.value && newSnapshotMatches.value && newComparison.value?.canCreate && !!newTitle.value.trim());
const jobRunning = computed(() => !!pendingJob.value || job.value?.status === 'queued' || job.value?.status === 'running');
const canRecover = computed(() => detail.value?.interrupted || detail.value?.status === 'merging' && !!detail.value.mergeError);
const canMerge = computed(() => canExecuteMerge.value && detail.value?.status === 'open' && !detail.value.mergeError && detailComparison.value?.canCreate === true && !detailComparison.value.stale && !mutating.value && !jobRunning.value);
const dirty = computed(() => mode.value === 'new' ? !!newTitle.value.trim() || !!newDescription.value.trim() : mode.value === 'detail' && !!comment.value.trim());
const date = (value: string) => value ? new Date(value).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }) : '时间未知';
const fileStatus = (value: string) => ({ added: '新增', modified: '修改', removed: '删除' } as Record<string, string>)[value] ?? value;
const short = (value?: string) => value?.slice(0, 12) || '—';

function updateItem(value: MergeRequestItem) { const index = items.value.findIndex(item => item.id === value.id); if (index < 0) items.value.unshift(value); else items.value[index] = value; }
function message(cause: unknown) { return cause instanceof ApiError && cause.status === 409 ? `${cause.message} 请刷新详情或重新比较后重试，未覆盖其他人的版本。` : (cause as Error).message; }
async function navigate(id = '') { await router.replace({ query: { branch: props.branch, ...(id ? { id } : {}) } }); }
async function resolveConflicts(){const current=contextVersion,item=detail.value;if(!item||!canExecuteMerge.value||jobRunning.value||!(await allowNavigation())||current!==contextVersion)return;emit('resolve-conflicts',item.source,item.target);}
async function allowNavigation() {
  if (mutating.value) { app.notify('请求正在保存，请等待结果后再切换。'); return false; }
  if (!dirty.value) return true;
  if (!(await app.confirmAction('还有未保存的合并请求或评论，确认放弃并切换吗？',{title:'未保存的合并请求内容',confirmLabel:'放弃并切换'}))) return false;
  newTitle.value = ''; newDescription.value = ''; comment.value = ''; return true;
}
async function loadList() {
  const current = ++listVersion; listLoading.value = true; listError.value = '';
  try { const value = await request<MergeRequestItem[]>(endpoint.value); if (current === listVersion) items.value = value; }
  catch (cause) { if (current === listVersion) listError.value = message(cause); }
  finally { if (current === listVersion) listLoading.value = false; }
}
async function loadBranches(currentContext: number) {
  try {
    const [values, repository] = await Promise.all([request<BranchItem[]>(props.base + '/branches'), request<RepoSummary>(props.base)]);
    if (currentContext !== contextVersion) return;
    branches.value = values; defaultBranch.value = repository.defaultBranch;
    if (mode.value === 'new' && !newSource.value && !newTarget.value) {
      newTarget.value = values.find(item=>item.name===String(route.query.target??''))?.name ?? values.find(item => item.name === repository.defaultBranch)?.name ?? values[0]?.name ?? '';
      newSource.value = values.find(item=>item.name===String(route.query.source??''))?.name ?? (props.branch !== newTarget.value && values.some(item => item.name === props.branch) ? props.branch : values.find(item => item.name !== newTarget.value)?.name ?? '');
    }
  } catch (cause) { if (currentContext === contextVersion) compareError.value = message(cause); }
}
async function compareNew() {
  if (!newSource.value || !newTarget.value || newSource.value === newTarget.value || comparing.value) return;
  const current = ++compareVersion, context = contextVersion, source = newSource.value, target = newTarget.value;
  comparing.value = true; compareError.value = ''; newComparison.value = undefined;
  try {
    const value = await request<MergeRequestComparison>(endpoint.value + '/compare' + queryString({ source, target }));
    if (current === compareVersion && context === contextVersion) newComparison.value = value;
  } catch (cause) { if (current === compareVersion && context === contextVersion) compareError.value = message(cause); }
  finally { if (current === compareVersion && context === contextVersion) comparing.value = false; }
}
async function loadDetailComparison(value: MergeRequestDetail, currentContext: number) {
  const current = ++compareVersion; comparing.value = true; compareError.value = ''; detailComparison.value = undefined;
  try {
    const comparison = await request<MergeRequestComparison>(endpoint.value + '/' + encodeURIComponent(value.id) + '/compare');
    if(comparison.sourceCommitId!==value.sourceCommitId||comparison.targetCommitId!==value.targetCommitId)throw new Error('比较快照已被更新，请刷新请求详情后重新检查版本。');
    if (current === compareVersion && currentContext === contextVersion && detail.value?.id === value.id) detailComparison.value = comparison;
  } catch (cause) { if (current === compareVersion && currentContext === contextVersion) compareError.value = message(cause); }
  finally { if (current === compareVersion && currentContext === contextVersion) comparing.value = false; }
}
async function loadDetail(id: string, resume = true) {
  const current = ++detailVersion, context = contextVersion; detailLoading.value = true; detailError.value = '';
  try {
    const value = await request<MergeRequestDetail>(endpoint.value + '/' + encodeURIComponent(id));
    if (current !== detailVersion || context !== contextVersion) return;
    detail.value = value; updateItem(value);
    if((value.status!=='merging'||value.interrupted)&&jobRunning.value){stopPolling();job.value=undefined;if(value.status==='merged')jobError.value='';}
    void loadDetailComparison(value, context);
    if (resume && value.status === 'merging' && value.jobId && !value.interrupted && !value.mergeError && value.jobId !== (job.value?.id || pendingJob.value)) resumeJob(value.jobId, id);
    return value;
  } catch (cause) { if (current === detailVersion && context === contextVersion) detailError.value = message(cause); }
  finally { if (current === detailVersion && context === contextVersion) detailLoading.value = false; }
}
async function create() {
  if (!canCreate.value || !newComparison.value) return;
  const context = contextVersion, snapshot = { ...newComparison.value };
  const body = { title: newTitle.value.trim(), description: newDescription.value.trim(), source: snapshot.source, target: snapshot.target, expectedSourceCommitId: snapshot.sourceCommitId, expectedTargetCommitId: snapshot.targetCommitId };
  mutating.value = true; actionError.value = '';
  try {
    const value = await post<MergeRequestDetail>(endpoint.value, body);
    if (context !== contextVersion) return;
    updateItem(value); newTitle.value = ''; newDescription.value = ''; mutating.value = false;
    await navigate(value.id); app.notify('合并请求已创建');
  } catch (cause) { if (context === contextVersion) actionError.value = message(cause); }
  finally { if (context === contextVersion) mutating.value = false; }
}
async function mutateRequest(action: 'comments' | 'close' | 'reopen' | 'refresh', captured = detail.value) {
  if (!captured || !writable.value || mutating.value) return;
  if (action === 'comments' && !comment.value.trim()) return;
  const context = contextVersion, id = captured.id;
  const body = { expectedRevision: captured.revision, ...(action === 'comments' ? { body: comment.value.trim() } : {}) };
  mutating.value = true; actionError.value = '';
  try {
    const value = await post<MergeRequestDetail>(endpoint.value + '/' + encodeURIComponent(id) + '/' + action, body);
    if (context !== contextVersion || detail.value?.id !== id) return;
    ++detailVersion;detailLoading.value=false;detail.value = value; updateItem(value); confirmation.value = undefined;
    if (action === 'comments') comment.value = '';
    if (action === 'refresh' || action === 'reopen') { job.value = undefined; jobError.value = ''; void loadDetailComparison(value, context); }
    app.notify(action === 'comments' ? '评论已保存' : action === 'close' ? '合并请求已关闭' : action === 'reopen' ? '合并请求已重新打开' : '比较快照已更新');
  } catch (cause) { if (context === contextVersion) actionError.value = message(cause); }
  finally { if (context === contextVersion) mutating.value = false; }
}
function confirm(action: 'merge' | 'refresh') { if (detail.value && writable.value) confirmation.value = { action, request: { ...detail.value, comments: [...detail.value.comments] } }; }
async function executeConfirmation() {
  const captured = confirmation.value;
  if (!captured || !writable.value || mutating.value) return;
  if (captured.action === 'refresh') { await mutateRequest('refresh', captured.request); return; }
  const context = contextVersion, value = captured.request;
  mutating.value = true; actionError.value = '';
  try {
    const result = await post<MergeRequestJob>(endpoint.value + '/' + encodeURIComponent(value.id) + '/merge', { expectedRevision: value.revision, expectedSourceCommitId: value.sourceCommitId, expectedTargetCommitId: value.targetCommitId });
    if (context !== contextVersion || detail.value?.id !== value.id) return;
    ++detailVersion;detailLoading.value=false;detail.value = result.request; updateItem(result.request); confirmation.value = undefined;
    beginJob(result.job, value.id); app.notify('合并任务已提交');
  } catch (cause) { if (context === contextVersion) actionError.value = message(cause); }
  finally { if (context === contextVersion) mutating.value = false; }
}
function stopPolling() { ++pollVersion; clearTimeout(pollTimer); pendingJob.value = ''; }
function beginJob(value: JobItem, requestId: string) {
  stopPolling(); job.value = value; jobError.value = '';
  const version = pollVersion, context = contextVersion;
  if (value.status === 'succeeded' || value.status === 'failed') { void finishJob(requestId); return; }
  pollTimer = setTimeout(() => { void pollJob(value.id, requestId, version, context); }, 900);
}
function resumeJob(id: string, requestId: string) { stopPolling(); pendingJob.value = id; jobError.value = ''; void pollJob(id, requestId, pollVersion, contextVersion); }
async function pollJob(id: string, requestId: string, version: number, context: number) {
  try {
    const value = await request<JobItem>('/jobs/' + encodeURIComponent(id));
    if (version !== pollVersion || context !== contextVersion) return;
    pendingJob.value = ''; job.value = value;
    if (value.status === 'succeeded' || value.status === 'failed') { await finishJob(requestId); return; }
    pollTimer = setTimeout(() => { void pollJob(id, requestId, version, context); }, 900);
  } catch (cause) { if (version === pollVersion && context === contextVersion) { pendingJob.value = ''; jobError.value = `无法继续读取任务：${message(cause)} 请刷新请求详情确认实际状态。`; } }
}
async function finishJob(id: string) { const updated=await loadDetail(id, false); emit('changed'); if (job.value?.status === 'succeeded') app.notify(updated?.status==='merged'?'合并已完成，请求状态已更新':'合并任务已完成，请刷新确认请求状态'); }
function previewFile(file: DiffFile) { const comparison = shownComparison.value; if (comparison) snapshotFile.value = { path: file.path, ref: file.status === 'removed' ? comparison.baseCommitId : comparison.sourceCommitId }; }
watch(() => [newSource.value, newTarget.value], () => { ++compareVersion; newComparison.value = undefined; compareError.value = ''; comparing.value = false; });
watch(() => [props.base, selectedId.value], () => {
  ++contextVersion; ++detailVersion; ++compareVersion; stopPolling();
  detail.value = undefined; detailComparison.value = undefined; newComparison.value = undefined; snapshotFile.value = undefined; confirmation.value = undefined;
  newSource.value = ''; newTarget.value = ''; newTitle.value = ''; newDescription.value = ''; comment.value = ''; job.value = undefined;
  detailError.value = ''; actionError.value = ''; compareError.value = ''; jobError.value = ''; detailLoading.value = false; comparing.value = false; mutating.value = false;
  const context = contextVersion;
  void loadList(); void loadBranches(context);
  if (mode.value === 'detail') void loadDetail(selectedId.value);
}, { immediate: true });
onBeforeRouteLeave(allowNavigation);
onBeforeRouteUpdate((to, from) => to.params.namespace === from.params.namespace && to.params.repo === from.params.repo && to.params.tab === from.params.tab && to.query.id === from.query.id || allowNavigation());
function beforeUnload(event: BeforeUnloadEvent) { if (!dirty.value && !mutating.value) return; event.preventDefault(); event.returnValue = ''; }
onMounted(() => window.addEventListener('beforeunload', beforeUnload));
onBeforeUnmount(() => { ++contextVersion; ++listVersion; ++detailVersion; ++compareVersion; stopPolling(); window.removeEventListener('beforeunload', beforeUnload); });
</script>

<template>
  <section class="merge-requests" aria-label="合并请求">
    <header class="mr-heading"><div><h2>{{ mode === 'new' ? '新建合并请求' : mode === 'detail' ? '合并请求详情' : '合并请求' }}</h2><p>比较固定版本、讨论变更，再合并到目标分支。</p></div><div><button v-if="mode !== 'list'" class="btn btn-ghost" @click="navigate()"><ArrowLeft :size="14" /> 请求列表</button><button v-if="mode === 'list'" class="btn btn-primary" :disabled="!writable" @click="navigate('new')"><Plus :size="15" /> 新建合并请求</button></div></header>
    <p v-if="!writable" class="mr-readonly">当前身份可以查看合并请求和讨论。创建、评论、关闭与合并需要仓库写入权限。</p>
    <template v-if="mode === 'list'">
      <div class="mr-list-tools"><div role="group" aria-label="筛选合并请求状态"><button v-for="value in ['open','closed','merged','all']" :key="value" :class="{ active: filter === value }" @click="filter = value">{{ value === 'open' ? '待合并' : value === 'closed' ? '已关闭' : value === 'merged' ? '已合并' : '全部' }}<span>{{ counts[value as keyof typeof counts] }}</span></button></div><label class="search-field"><Search :size="14" /><input v-model="search" aria-label="搜索合并请求" placeholder="搜索标题、分支或发起人…" /></label><button class="icon-button" aria-label="刷新合并请求" :disabled="listLoading" @click="loadList"><RefreshCw :size="15" :class="{ spin: listLoading }" /></button></div>
      <div v-if="listError" class="error-state" role="alert">{{ listError }}<button class="btn btn-ghost" @click="loadList">重试</button></div>
      <div v-else-if="listLoading" class="empty" role="status"><LoaderCircle class="spin" :size="24" /><p>正在读取合并请求…</p></div>
      <div v-else-if="!visible.length" class="mr-empty panel"><GitPullRequest :size="35" :stroke-width="1.3" /><h3>{{ search ? '没有匹配的合并请求' : filter === 'open' ? '还没有待合并请求' : '此状态下没有合并请求' }}</h3><p>从一个分支发起比较，让数据变更经过讨论后合并。</p><button v-if="writable && !search" class="btn btn-primary" @click="navigate('new')"><Plus :size="15" /> 新建合并请求</button></div>
      <div v-else class="panel mr-list"><button v-for="item in visible" :key="item.id" class="mr-list-row" @click="navigate(item.id)"><GitPullRequest :size="20" :class="`mr-icon-${item.status}`" /><div><strong>{{ item.title }}</strong><p><span>#{{ item.number }}</span> {{ item.author.name }} · {{ date(item.updatedAt) }}</p><small><code>{{ item.source }}</code><ArrowRight :size="11" /><code>{{ item.target }}</code></small></div><span class="mr-status" :class="item.status">{{ labels[item.status] }}</span><ChevronRight :size="16" /></button></div>
    </template>
    <template v-else-if="mode === 'new'">
      <section class="panel mr-new-branches"><header><GitBranch :size="17" /><strong>选择源分支与目标分支</strong></header><div class="mr-branch-grid"><label class="field">源分支（包含待合并变更）<select v-model="newSource" :disabled="mutating"><option value="" disabled>选择源分支</option><option v-for="item in branches" :key="item.name" :value="item.name">{{ item.name }}</option></select></label><ArrowRight :size="19" /><label class="field">目标分支<select v-model="newTarget" :disabled="mutating"><option value="" disabled>选择目标分支</option><option v-for="item in branches" :key="item.name" :value="item.name">{{ item.name }}{{ item.name === defaultBranch ? ' · 默认' : '' }}</option></select></label></div><footer><span>{{ newSource && newSource === newTarget ? '源分支与目标分支必须不同。' : '比较后会固定两端提交，保存或合并时再次检查版本。' }}</span><button class="btn" :disabled="comparing || !newSource || !newTarget || newSource === newTarget || mutating" @click="compareNew"><LoaderCircle v-if="comparing" :size="14" class="spin" /><FileDiff v-else :size="14" /> 比较分支</button></footer></section>
    </template>
    <template v-else>
      <div v-if="detailError" class="error-state" role="alert">{{ detailError }}<button class="btn btn-ghost" @click="loadDetail(selectedId)">重试</button></div>
      <div v-if="detailLoading && !detail" class="empty" role="status"><LoaderCircle class="spin" :size="24" /><p>正在读取合并请求…</p></div>
      <section v-if="detail" class="panel mr-detail-summary"><div class="mr-detail-title"><span class="mr-status" :class="detail.status">{{ labels[detail.status] }}</span><span>#{{ detail.number }}</span><h3>{{ detail.title }}</h3><button class="icon-button" aria-label="刷新合并请求详情" :disabled="detailLoading || mutating" @click="loadDetail(detail.id)"><RefreshCw :size="15" :class="{ spin: detailLoading }" /></button></div><p class="mr-byline">{{ detail.author.name }} 创建于 {{ date(detail.createdAt) }} · 请求版本 r{{ detail.revision }}</p><div class="mr-pinned"><span><GitBranch :size="13" /><strong>{{ detail.source }}</strong><code>{{ short(detail.sourceCommitId) }}</code></span><ArrowRight :size="15" /><span><strong>{{ detail.target }}</strong><code>{{ short(detail.targetCommitId) }}</code></span></div><p class="mr-description">{{ detail.description || '没有填写描述。' }}</p><div v-if="detail.mergedCommitId" class="mr-merged-version"><CheckCircle2 :size="15" /> 合并结果提交 <code>{{ detail.mergedCommitId }}</code></div><p v-if="detail.mergeError" class="mr-action-error" role="alert">{{ detail.interrupted ? '上次合并任务因服务重启而中断，请先恢复请求，再核对实际分支内容。' : '合并任务需要处理：' }} {{ detail.mergeError }}</p><div class="mr-detail-actions"><button v-if="detail.status === 'open' && canExecuteMerge" class="btn" :disabled="mutating || jobRunning" @click="resolveConflicts"><FileDiff :size="15"/>解决冲突</button><button v-if="detail.status === 'open'" class="btn btn-ghost" :disabled="!writable || mutating || jobRunning" @click="mutateRequest('close')"><X :size="14" /> 关闭请求</button><button v-if="detail.status === 'closed' || canRecover" class="btn" :disabled="!writable || mutating" @click="mutateRequest('reopen')">{{ canRecover ? '恢复为待合并' : '重新打开' }}</button><button v-if="detail.status === 'open'" class="btn" :disabled="!writable || mutating || comparing || jobRunning" @click="confirm('refresh')"><RefreshCw :size="14" /> 更新比较快照</button><button v-if="detail.status === 'open'" class="btn btn-primary" :disabled="!canMerge" @click="confirm('merge')"><GitMerge :size="15" /> 确认并合并</button></div></section>
    </template>
    <div v-if="mode !== 'list' && compareError" class="error-state" role="alert">比较未完成：{{ compareError }}<button class="btn btn-ghost" :disabled="comparing" @click="mode === 'new' ? compareNew() : detail && loadDetailComparison(detail, contextVersion)">重试比较</button></div>
    <div v-if="mode !== 'list' && comparing" class="mr-compare-loading" role="status"><LoaderCircle class="spin" :size="18" /> 正在比较固定提交版本…</div>
    <section v-if="mode !== 'list' && shownComparison && !comparing" class="mr-comparison">
      <header class="mr-comparison-heading"><div><FileDiff :size="17" /><strong>{{ shownComparison.files.length }} 个变更文件</strong></div><span>源分支领先 {{ shownComparison.ahead }} 个提交 · 落后 {{ shownComparison.behind }} 个提交</span></header><p class="mr-compare-note">文件变更比较共同基线 <code>{{ short(shownComparison.baseCommitId) }}</code> → 源提交 <code>{{ short(shownComparison.sourceCommitId) }}</code>；目标头 <code>{{ short(shownComparison.targetCommitId) }}</code> 单独固定并用于合并前版本检查，目标独有变更不表示本次删除。</p><p v-if="shownComparison.stale && detail?.status === 'open'" class="mr-stale" role="alert">分支头已经变化。当前仍显示保存的固定版本，合并已禁用；请显式更新比较快照。<span>当前源 {{ short(shownComparison.currentSourceCommitId) }} · 当前目标 {{ short(shownComparison.currentTargetCommitId) }}</span></p><p v-else-if="shownComparison.stale" class="mr-compare-note">{{ detail?.status === 'merged' ? '此请求已完成合并。以下保留合并前已审阅的固定比较快照，目标分支推进不会改变这份历史记录。' : detail?.status === 'closed' ? '此请求已关闭。以下保留关闭前的固定比较快照，分支后续推进不会改变这份历史记录。' : '以下显示本次合并使用的固定比较快照，分支头可能随正在执行的合并变化，请等待任务结果。' }}</p><p v-if="!shownComparison.canCreate && shownComparison.reason" class="mr-compare-note">{{ shownComparison.reason }}</p><div v-if="!shownComparison.files.length" class="mr-no-changes panel">源提交相对共同基线没有文件内容变化。</div>
      <article v-for="file in shownComparison.files" :key="file.path" class="panel mr-diff-file"><header><span class="badge">{{ fileStatus(file.status) }}</span><code>{{ file.path }}</code><button class="btn btn-ghost" @click="previewFile(file)">查看{{ file.status === 'removed' ? '删除前' : '源版本' }}文件</button></header><TabularDiff v-if="file.tabular" :diff="file.tabular" /><TextDiff v-else-if="file.before !== undefined || file.after !== undefined" :before="file.before" :after="file.after" :path="file.path"/><pre v-else-if="file.diff" class="mr-patch">{{ file.diff }}</pre><p v-else class="mr-no-text">此响应未提供可展开文本，使用文件预览检查对应版本。</p></article>
    </section>
    <form v-if="mode === 'new'" class="panel mr-create-form" @submit.prevent="create"><label class="field">合并请求标题<input v-model="newTitle" required maxlength="200" placeholder="概述这次数据变更" :disabled="mutating" /></label><label class="field">描述<textarea v-model="newDescription" rows="5" maxlength="10000" placeholder="说明变更内容、验证方式和需要协作者关注的事项…" :disabled="mutating" /></label><p v-if="newComparison" class="mr-create-snapshot">提交快照：<code>{{ short(newComparison.sourceCommitId) }}</code> → <code>{{ short(newComparison.targetCommitId) }}</code></p><p v-else class="mr-create-snapshot">请先比较两个不同分支，再创建合并请求。</p><footer><button type="button" class="btn btn-ghost" :disabled="mutating" @click="navigate()">取消</button><button class="btn btn-primary" :disabled="!canCreate"><LoaderCircle v-if="mutating" :size="15" class="spin" /><GitPullRequest v-else :size="15" /> 创建合并请求</button></footer></form>
    <article v-if="mode === 'detail' && detail" class="panel mr-discussion"><header><MessageSquare :size="17" /><strong>讨论</strong><span>{{ detail.comments.length }}</span></header><div v-if="!detail.comments.length" class="mr-no-comments">还没有评论。可以记录对数据变更的检查结果。</div><article v-for="item in detail.comments" :key="item.id" class="mr-comment"><div><span class="mr-avatar">{{ item.author.name.slice(0,1).toUpperCase() }}</span><strong>{{ item.author.name }}</strong><time>{{ date(item.createdAt) }}</time></div><p>{{ item.body }}</p></article><form @submit.prevent="mutateRequest('comments')"><label class="field">添加评论<textarea v-model="comment" rows="3" maxlength="4000" placeholder="写下你的检查结果或问题…" :disabled="!writable || mutating || detail.status === 'merging'" /></label><footer><span>按请求版本 r{{ detail.revision }} 保存</span><button class="btn" :disabled="!writable || mutating || !comment.trim() || detail.status === 'merging'"><LoaderCircle v-if="mutating" :size="14" class="spin" /><MessageSquare v-else :size="14" /> 保存评论</button></footer></form></article>
    <p v-if="actionError" class="mr-action-error" role="alert">{{ actionError }}<button v-if="mode === 'detail' && detail" class="btn btn-ghost" :disabled="mutating" @click="loadDetail(detail.id)">刷新请求详情</button></p>
    <article v-if="mode === 'detail' && (job || pendingJob || jobError)" class="panel mr-job" role="status"><header><strong><LoaderCircle v-if="jobRunning" class="spin" :size="15" /><GitMerge v-else :size="15" />合并任务</strong><span>{{ pendingJob ? '正在读取任务' : job?.status === 'queued' ? '排队中' : job?.status === 'running' ? '执行中' : job?.status === 'succeeded' ? '已完成' : job?.status === 'failed' ? '失败' : '状态待确认' }}</span></header><pre v-if="job?.output">{{ job.output }}</pre><p v-if="job?.error || jobError">{{ job?.error || jobError }}</p></article>
    <details class="mr-storage-note"><summary>合并请求与讨论的保存方式</summary><p>合并请求和讨论由本 Web 服务本地保存；实际比较与合并针对 Oxen 仓库版本。此流程不调用 SaaS 私有管理接口。</p></details>
    <div v-if="confirmation" class="mr-backdrop" @click.self="!mutating && (confirmation = undefined)"><section class="mr-confirm" role="dialog" aria-modal="true" @keydown.esc="!mutating && (confirmation = undefined)" :aria-label="confirmation.action === 'merge' ? '确认执行合并' : '确认更新比较快照'"><header><h3>{{ confirmation.action === 'merge' ? '确认执行合并' : '更新比较快照' }}</h3><button class="icon-button" :disabled="mutating" aria-label="关闭确认对话框" @click="confirmation = undefined"><X :size="18" /></button></header><p><strong>#{{ confirmation.request.number }} {{ confirmation.request.title }}</strong></p><div class="mr-confirm-branches"><code>{{ confirmation.request.source }}</code><ArrowRight :size="15" /><code>{{ confirmation.request.target }}</code></div><p v-if="confirmation.action === 'merge'">将源分支合并到目标分支。提交前会再次核对请求版本及两端分支头；发生变化或冲突时不会显示成功。</p><p v-else>将固定比较版本更新为两个分支的最新提交，现有讨论会保留。请在更新后重新检查变更。</p><dl><dt>请求版本</dt><dd>r{{ confirmation.request.revision }}</dd><dt>已检查源版本</dt><dd><code>{{ confirmation.request.sourceCommitId }}</code></dd><dt>已检查目标版本</dt><dd><code>{{ confirmation.request.targetCommitId }}</code></dd></dl><p v-if="actionError" class="mr-action-error">{{ actionError }}</p><footer><button class="btn btn-ghost" :disabled="mutating" @click="confirmation = undefined">取消</button><button class="btn btn-primary" :disabled="mutating || !writable" @click="executeConfirmation"><LoaderCircle v-if="mutating" :size="15" class="spin" /><GitMerge v-else :size="15" />{{ confirmation.action === 'merge' ? '执行合并' : '更新快照' }}</button></footer></section></div>
    <div v-if="snapshotFile" class="mr-backdrop" @click.self="snapshotFile = undefined"><section class="mr-file-preview" role="dialog" aria-modal="true" @keydown.esc="snapshotFile = undefined" aria-label="固定版本文件预览"><header><strong>固定版本 {{ short(snapshotFile.ref) }}</strong><button class="icon-button" aria-label="关闭固定版本文件预览" @click="snapshotFile = undefined"><X :size="18" /></button></header><FilePreview :base="base" :branch="snapshotFile.ref" :path="snapshotFile.path" compact @close="snapshotFile = undefined" /></section></div>
  </section>
</template>

<style scoped>
.mr-heading{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:24px}
.mr-heading h2{font-size:23px;margin-bottom:8px}
.mr-heading p{font-size:13px;color:var(--muted)}
.mr-heading>div:last-child{display:flex;gap:8px}
.mr-readonly{padding:12px 15px;border:1px solid var(--line);border-radius:6px;background:var(--surface-raised);font-size:13px;color:var(--muted);margin-bottom:19px}
.mr-list-tools{display:flex;gap:13px;align-items:center;flex-wrap:wrap;margin-bottom:19px}
.mr-list-tools>div{display:flex;gap:5px}
.mr-list-tools>div button{display:flex;gap:7px;align-items:center;font-size:13px;color:var(--muted);padding:9px 10px;border:1px solid transparent;border-radius:5px}
.mr-list-tools button.active{background:var(--surface-raised);border-color:var(--line);color:var(--muted)}
.mr-list-tools button span{font-size:13px;color:var(--muted)}
.mr-list-tools .search-field{margin-left:auto;width:250px}
.mr-empty{display:flex;flex-direction:column;align-items:center;gap:15px;text-align:center;padding:65px 25px;color:var(--muted)}
.mr-empty h3{font-size:17px;color:var(--muted)}
.mr-empty p{font-size:13px}
.mr-empty .btn{margin-top:8px}
.mr-list{overflow:hidden}
.mr-list-row{display:flex;align-items:center;gap:16px;width:100%;text-align:left;padding:21px 20px;border-bottom:1px solid var(--line);color:var(--muted)}
.mr-list-row:last-child{border-bottom:0}
.mr-list-row:hover{background:var(--surface-raised)}
.mr-list-row>div{flex:1;min-width:0}
.mr-list-row strong{font-size:13px;display:block;color:var(--muted);overflow-wrap:anywhere}
.mr-list-row p{font-size:13px;margin-top:7px;color:var(--muted)}
.mr-list-row p span{margin-right:9px;color:var(--muted)}
.mr-list-row small{display:flex;align-items:center;gap:7px;font-size:13px;color:var(--muted);margin-top:8px;overflow-wrap:anywhere}
.mr-icon-open{color:var(--muted)}
.mr-icon-merged{color:var(--muted)}
.mr-icon-closed{color:var(--muted)}
.mr-status{display:inline-flex;align-items:center;justify-content:center;padding:5px 8px;background:var(--surface-raised);border:1px solid var(--line);border-radius:5px;font-size:13px;color:var(--muted);white-space:nowrap}
.mr-status.closed{background:var(--surface-raised);border-color:var(--line);color:var(--muted)}
.mr-status.merged{background:var(--surface-raised);border-color:var(--line);color:var(--muted)}
.mr-status.merging{background:var(--surface-raised);border-color:var(--line);color:var(--muted)}
.mr-new-branches{padding:21px 24px;margin-bottom:22px}
.mr-new-branches>header{display:flex;align-items:center;gap:9px;font-size:13px;color:var(--muted);margin-bottom:19px}
.mr-branch-grid{display:grid;grid-template-columns:minmax(0,1fr) 24px minmax(0,1fr);gap:17px;align-items:center}
.mr-branch-grid .field{font-size:13px;margin:0}
.mr-branch-grid>svg{color:var(--muted);margin-top:20px}
.mr-new-branches>footer{display:flex;align-items:center;justify-content:space-between;gap:15px;margin-top:20px}
.mr-new-branches footer>span{font-size:13px;color:var(--muted)}
.mr-detail-summary{padding:23px 25px;margin-bottom:22px}
.mr-detail-title{display:flex;align-items:center;gap:11px;flex-wrap:wrap}
.mr-detail-title>span:not(.mr-status){font-size:13px;color:var(--muted)}
.mr-detail-title h3{font-size:20px;color:var(--muted);flex:1;overflow-wrap:anywhere}
.mr-byline{font-size:13px;color:var(--muted);margin-top:12px}
.mr-pinned{display:flex;gap:15px;align-items:center;flex-wrap:wrap;margin-top:19px;padding:13px 15px;background:var(--surface-raised);border:1px solid var(--line);border-radius:5px;color:var(--muted)}
.mr-pinned>span{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:13px;overflow-wrap:anywhere}
.mr-pinned code{font-size:13px;color:var(--muted)}
.mr-description{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;color:var(--muted);line-height:1.9;padding:20px 0}
.mr-detail-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;border-top:1px solid var(--line);padding-top:17px}
.mr-detail-actions>.btn:first-child{margin-right:auto}
.mr-merged-version{display:flex;align-items:center;gap:9px;flex-wrap:wrap;font-size:13px;color:var(--muted);margin:0 0 17px}
.mr-merged-version code{overflow-wrap:anywhere;font-size:13px}
.mr-compare-loading{display:flex;align-items:center;gap:10px;padding:24px;font-size:13px;color:var(--muted)}
.mr-comparison{margin:22px 0}
.mr-comparison-heading{display:flex;align-items:center;justify-content:space-between;gap:15px;font-size:13px;color:var(--muted);margin-bottom:14px;flex-wrap:wrap}
.mr-comparison-heading>div{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:13px}
.mr-stale{border:1px solid var(--line);background:var(--surface-raised);padding:13px 15px;border-radius:5px;font-size:13px;line-height:1.8;color:var(--muted);margin-bottom:15px}
.mr-stale>span{display:block;font-size:13px;margin-top:6px}
.mr-compare-note{padding:12px 15px;background:var(--surface-raised);font-size:13px;color:var(--muted);border:1px solid var(--line);border-radius:5px;margin-bottom:15px}
.mr-diff-file{overflow:hidden;margin-bottom:15px}
.mr-diff-file>header{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--line);font-size:13px;color:var(--muted);flex-wrap:wrap}
.mr-diff-file>header code{flex:1;overflow-wrap:anywhere}
.mr-diff-file>header .btn{font-size:13px;padding:4px 8px;min-height:32px}
.mr-no-changes,.mr-no-text{padding:25px 18px;font-size:13px;color:var(--muted)}
.mr-text-diff{display:grid;grid-template-columns:1fr 1fr}
.mr-text-diff>section{min-width:0;background:var(--surface-raised)}
.mr-text-diff>section+section{border-left:1px solid var(--line);background:var(--surface-raised)}
.mr-text-diff strong{display:block;padding:9px 15px;font-size:13px;color:var(--muted);border-bottom:1px solid var(--line);font-weight:400}
.mr-text-diff pre,.mr-patch{font-size:13px;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere;padding:14px 16px;margin:0;max-height:420px;overflow:auto;color:var(--muted)}
.mr-create-form{padding:23px 25px;margin:22px 0}
.mr-create-form .field{font-size:13px;margin-bottom:18px}
.mr-create-snapshot{font-size:13px;color:var(--muted)}
.mr-create-form footer{display:flex;justify-content:flex-end;gap:9px;margin-top:20px;border-top:1px solid var(--line);padding-top:19px}
.mr-discussion{margin-top:23px;overflow:hidden}
.mr-discussion>header{display:flex;align-items:center;gap:9px;padding:18px 23px;border-bottom:1px solid var(--line);font-size:13px;color:var(--muted)}
.mr-discussion>header>span{font-size:13px;color:var(--muted)}
.mr-no-comments{font-size:13px;color:var(--muted);padding:28px 23px}
.mr-comment{padding:20px 23px;border-bottom:1px solid var(--line)}
.mr-comment>div{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.mr-avatar{display:grid;place-items:center;width:25px;height:25px;border-radius:50%;background:var(--surface-raised);font-size:13px;color:var(--muted)}
.mr-comment strong{font-size:13px;color:var(--muted)}
.mr-comment time{font-size:13px;color:var(--muted);margin-left:auto}
.mr-comment>p{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:1.9;margin:13px 0 0 34px;color:var(--muted)}
.mr-discussion form{padding:21px 23px}
.mr-discussion .field{font-size:13px}
.mr-discussion form footer{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:16px}
.mr-discussion footer>span{font-size:13px;color:var(--muted)}
.mr-action-error{padding:13px 15px;border:1px solid var(--line);border-radius:5px;background:var(--surface-raised);color:var(--muted);font-size:13px;line-height:1.8;overflow-wrap:anywhere;margin-top:16px}
.mr-action-error>.btn{font-size:13px;margin-left:9px}
.mr-job{padding:18px 22px;margin-top:19px}
.mr-job header{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:13px;color:var(--muted)}
.mr-job strong{display:flex;align-items:center;gap:8px;color:var(--muted)}
.mr-job pre{font-size:13px;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere;max-height:260px;overflow:auto;background:var(--surface-raised);border:1px solid var(--line);padding:13px;margin-top:15px}
.mr-job p{font-size:13px;color:var(--muted);margin-top:12px}
.mr-storage-note{font-size:13px;color:var(--muted);line-height:1.8;margin:24px 2px 0}
.mr-backdrop{position:fixed;inset:0;z-index:100;display:grid;place-items:center;padding:24px;background:rgba(0,0,0,.72);backdrop-filter:blur(3px)}
.mr-confirm{width:100%;max-width:530px;max-height:calc(100vh - 48px);overflow:auto;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:24px;box-shadow:0 24px 80px rgba(0,0,0,.35)}
.mr-confirm>header,.mr-file-preview>header{display:flex;align-items:center;justify-content:space-between;gap:15px;margin-bottom:20px}
.mr-confirm h3{font-size:18px;color:var(--muted)}
.mr-confirm>p{font-size:13px;line-height:1.9;color:var(--muted);overflow-wrap:anywhere}
.mr-confirm-branches{display:flex;align-items:center;justify-content:center;gap:16px;padding:16px;background:var(--surface-raised);border:1px solid var(--line);border-radius:5px;margin:18px 0;color:var(--muted);font-size:13px;overflow-wrap:anywhere}
.mr-confirm dl{display:grid;grid-template-columns:100px minmax(0,1fr);gap:10px;margin:20px 0 0;font-size:13px;color:var(--muted)}
.mr-confirm dd{margin:0;overflow-wrap:anywhere;color:var(--muted)}
.mr-confirm footer{display:flex;justify-content:flex-end;gap:9px;margin-top:23px}
.mr-file-preview{width:100%;max-width:1120px;max-height:calc(100vh - 48px);overflow:auto;background:var(--surface);border:1px solid var(--line);border-radius:8px;box-shadow:0 24px 80px rgba(0,0,0,.35)}
.mr-file-preview>header{padding:17px 20px;border-bottom:1px solid var(--line);margin-bottom:0;font-size:13px;color:var(--muted)}
@media(max-width:750px){.mr-heading{align-items:flex-start}
.mr-heading h2{font-size:20px}
.mr-heading p{font-size:13px;max-width:210px}
.mr-list-tools .search-field{width:100%;order:2}
.mr-list-row{padding:18px 14px;gap:10px}
.mr-list-row strong{font-size:13px}
.mr-list-row>.mr-status{font-size:13px;padding:4px}
.mr-list-row>svg:last-child{display:none}
.mr-branch-grid{grid-template-columns:1fr;gap:12px}
.mr-branch-grid>svg{display:none}
.mr-new-branches{padding:19px}
.mr-new-branches footer{align-items:flex-end}
.mr-text-diff{grid-template-columns:1fr}
.mr-text-diff>section+section{border-left:0;border-top:1px solid var(--line)}
.mr-detail-summary,.mr-create-form{padding:19px}
.mr-detail-title h3{font-size:17px;min-width:180px}
.mr-detail-actions .btn{font-size:13px;padding:7px 10px}
.mr-comment{padding:18px}
.mr-comment>p{margin-left:0}
.mr-discussion form{padding:18px}
.mr-backdrop{padding:12px}
.mr-confirm{padding:21px;max-height:calc(100vh - 24px)}
.mr-confirm dl{grid-template-columns:85px minmax(0,1fr)}
.mr-file-preview{max-height:calc(100vh - 24px)}
}
.mr-heading{margin-bottom:26px}
.mr-heading h2{font-size:24px;font-weight:600}
.mr-heading p{font-size:14px;color:var(--muted)}
.mr-list-tools{padding:0 0 18px;border-bottom:1px solid var(--line);gap:14px}
.mr-list-tools>div{gap:2px}
.mr-list-tools>div button{font-size:13px;padding:10px 13px;color:var(--muted)}
.mr-list-tools button.active{background:var(--surface-raised);border-color:var(--line);color:var(--text)}
.mr-list-tools button span{display:inline-grid;place-items:center;min-width:22px;padding:2px 6px;border:1px solid var(--line);border-radius:10px;font-size:11px;color:var(--muted)}
.mr-list-row{padding:20px 22px;gap:16px}
.mr-list-row strong{font-size:15px;color:var(--text);font-weight:550}
.mr-list-row p{font-size:12px;margin-top:8px;line-height:1.7}
.mr-list-row small{font-size:12px;color:var(--muted)}
.mr-icon-open{color:var(--success)}
.mr-icon-merged{color:var(--primary)}
.mr-icon-closed{color:var(--danger)}
.mr-status{font-size:12px;min-height:30px;padding:4px 10px;border-radius:5px;color:var(--success);background:color-mix(in srgb,var(--success) 10%,var(--surface));border-color:color-mix(in srgb,var(--success) 25%,var(--line))}
.mr-status.merged{color:var(--primary);background:color-mix(in srgb,var(--primary) 13%,var(--surface));border-color:color-mix(in srgb,var(--primary) 30%,var(--line))}
.mr-status.closed{color:var(--muted);background:var(--surface-raised);border-color:var(--line)}
.mr-status.merging{color:#e8b569;background:color-mix(in srgb,#e8b569 9%,var(--surface));border-color:var(--line)}
.mr-detail-summary{padding:24px}
.mr-detail-title h3{color:var(--text);font-size:23px;line-height:1.5;font-weight:600}
.mr-detail-title>span:not(.mr-status){font-size:15px;color:var(--muted)}
.mr-byline{font-size:13px;color:var(--muted)}
.mr-pinned{padding:14px 16px;background:var(--surface-raised);border-color:var(--line);gap:17px}
.mr-pinned>span{font-size:13px;color:var(--text)}
.mr-pinned code{font-size:12px;color:var(--muted);background:var(--surface);padding:4px 7px;border-radius:4px}
.mr-description{font-size:14px;line-height:1.85;color:var(--text);padding:22px 0}
.mr-merged-version{font-size:13px;color:var(--success)}
.mr-merged-version code{font-size:12px;color:var(--text)}
.mr-comparison-heading{font-size:13px;margin-bottom:15px}
.mr-comparison-heading>div{font-size:15px;color:var(--text)}
.mr-compare-note{font-size:13px;line-height:1.8;background:var(--surface-raised);color:var(--muted)}
.mr-stale{font-size:13px;background:color-mix(in srgb,#e8b569 7%,var(--surface));color:#e8b569;border-color:color-mix(in srgb,#e8b569 30%,var(--line))}
.mr-diff-file>header{padding:13px 16px;min-height:55px;font-size:13px;background:var(--surface-raised)}
.mr-diff-file>header .btn{min-height:32px;font-size:12px;background:var(--surface)}
.mr-text-diff>section{background:color-mix(in srgb,var(--danger) 4%,var(--surface))}
.mr-text-diff>section+section{background:color-mix(in srgb,var(--success) 4%,var(--surface))}
.mr-text-diff strong{font-size:12px;background:var(--surface-raised);color:var(--muted);padding:10px 14px}
.mr-text-diff pre,.mr-patch{font-size:12px;color:var(--text);line-height:1.9}
.mr-create-form{padding:24px}
.mr-create-form .field{font-size:14px}
.mr-create-form input,.mr-create-form textarea{font-size:14px}
.mr-create-snapshot{font-size:12px;color:var(--muted)}
.mr-discussion>header{font-size:15px;color:var(--text);padding:18px 24px;background:var(--surface-raised)}
.mr-discussion>header>span{font-size:12px;padding:2px 7px;border-radius:10px;border:1px solid var(--line)}
.mr-comment{padding:22px 24px}
.mr-avatar{width:30px;height:30px;font-size:12px;background:color-mix(in srgb,var(--primary) 15%,var(--surface));color:var(--text)}
.mr-comment strong{font-size:13px;color:var(--text)}
.mr-comment time{font-size:12px;color:var(--muted)}
.mr-comment>p{font-size:14px;line-height:1.8;color:var(--text);margin:13px 0 0 39px}
.mr-discussion form{padding:24px}
.mr-discussion .field{font-size:14px}
.mr-discussion footer>span{font-size:12px}
.mr-confirm,.mr-file-preview{background:var(--surface);border-color:var(--line);box-shadow:0 30px 100px rgba(0,0,0,.5)}
.mr-confirm h3{font-size:20px;color:var(--text)}
.mr-confirm>p{font-size:14px;color:var(--muted)}
.mr-confirm-branches{background:var(--surface-raised);font-size:13px;color:var(--text)}
.mr-confirm dl{font-size:13px}
.mr-confirm dd{font-size:12px;color:var(--text)}
.mr-action-error{font-size:13px;color:var(--danger);border-color:color-mix(in srgb,var(--danger) 30%,var(--line));background:color-mix(in srgb,var(--danger) 6%,var(--surface))}
.mr-storage-note{font-size:12px;margin-top:24px;color:var(--muted);border-top:1px solid var(--line);padding-top:16px}
.mr-storage-note summary{cursor:pointer;user-select:none}
.mr-storage-note p{margin-top:12px}
.mr-job header{font-size:13px;color:var(--text)}
.mr-job strong{color:var(--text)}
.mr-job pre{font-size:12px;background:var(--bg);line-height:1.8}
.mr-readonly{font-size:13px;background:var(--surface-raised)}
.mr-empty{padding:70px 28px}
.mr-empty>svg{color:var(--muted)}
.mr-empty h3{font-size:20px;color:var(--text)}
.mr-empty p{font-size:14px;color:var(--muted)}
@media(max-width:750px){.mr-heading h2{font-size:22px}
.mr-heading p{font-size:13px}
.mr-list-row strong{font-size:14px}
.mr-list-row>.mr-status{font-size:11px}
.mr-detail-title h3{font-size:20px}
.mr-comment>p{margin-left:0}
.mr-list-tools>div{width:100%;overflow:auto}
.mr-list-tools>div button{padding:9px 11px;white-space:nowrap}
}
.mr-job p{color:var(--danger)}
.mr-diff-file .status-added{color:var(--success)}
.mr-diff-file .status-removed{color:var(--danger)}
.mr-diff-file .status-modified{color:var(--primary)}
.mr-status.merged,.mr-icon-merged,.mr-diff-file .status-modified{color:color-mix(in srgb,var(--primary) 65%,var(--text))}

</style>
