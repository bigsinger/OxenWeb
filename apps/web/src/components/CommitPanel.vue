<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft, ChevronRight, Copy, FileDiff, GitCommitHorizontal, LoaderCircle, RefreshCw, Search, X } from 'lucide-vue-next';
import type { Capabilities, CommitDetail, CommitItem,RepositoryVersionRestoreResult } from '@oxen/shared';
import { queryString, request } from '../api';
import { useAppStore } from '../stores/app';
import TabularDiff from './TabularDiff.vue';
import TextDiff from './TextDiff.vue';
import RepositoryVersionRestorePanel from './RepositoryRestorePanel.vue';

const FilePreviewComponent = defineAsyncComponent(() => import('./FilePreview.vue'));
const snapshotFile = ref<{path:string;ref:string}>();
const props = defineProps<{ base: string; branch: string; capabilities?: Capabilities;canRestore?:boolean }>();
const emit=defineEmits<{changed:[]}>(),restoreOpen=ref(false);
const store = useAppStore();
const route=useRoute(),router=useRouter();
const fileFilter=ref(String(route.query.path??''));
const commits = ref<CommitItem[]>([]);
const selected = ref<CommitDetail | null>(null);
const selectedId = ref('');
const expandedFiles=ref<Record<string,boolean>>({});
const fileExpanded=(path:string,index:number)=>expandedFiles.value[path]??index<3;
const patchKind=(line:string)=>line.startsWith('@@')?'hunk':line.startsWith('+')&&!line.startsWith('+++')?'added':line.startsWith('-')&&!line.startsWith('---')?'removed':'';
const loading = ref(false);
const detailLoading = ref(false);
const error = ref('');
const detailError = ref('');
const page = ref(1);
const pageSize = 20;
let listVersion = 0;
let detailVersion = 0;
let listLoaded = false;
const count = computed(() => commits.value.length);
const filteredFiles=computed(()=>selected.value?.files.filter(file=>file.path.toLowerCase().includes(fileFilter.value.toLowerCase()))??[]);
const date = (value: string) => value ? new Date(value).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }) : '时间未知';
const lines = (text?: string) => text === undefined ? [] : text.split('\n');
const statusText = (status: string) => (({ added: '新增', modified: '修改', removed: '删除' } as Record<string, string>)[status] ?? status);

async function load() {
  const version = ++listVersion;
  ++detailVersion;
  loading.value = true; listLoaded = false; error.value = ''; snapshotFile.value=undefined; selected.value = null; selectedId.value = ''; detailError.value = ''; detailLoading.value = false;
  try {
    const value = await request<CommitItem[]>(props.base + '/commits' + queryString({ ref: props.branch, page: page.value, pageSize }));
    if (version === listVersion) { commits.value = value; listLoaded = true; }
  } catch (cause) { if (version === listVersion) { error.value = (cause as Error).message; listLoaded = false; } }
  finally { if (version === listVersion) loading.value = false; }
}
async function loadDetail(commitId: string) {
  ++listVersion; loading.value = false; error.value = '';
  const version = ++detailVersion;
  snapshotFile.value=undefined; expandedFiles.value={}; selectedId.value = commitId; selected.value = null; detailLoading.value = true; detailError.value = '';
  try {
    const value = await request<CommitDetail>(props.base + '/commits/' + encodeURIComponent(commitId));
    if (version === detailVersion) selected.value = value;
  } catch (cause) { if (version === detailVersion) detailError.value = (cause as Error).message; }
  finally { if (version === detailVersion) detailLoading.value = false; }
}
function clearDetail() { snapshotFile.value=undefined; ++detailVersion; selectedId.value = ''; selected.value = null; detailError.value = ''; detailLoading.value = false; }
async function restored(result:RepositoryVersionRestoreResult){
  restoreOpen.value=false;
  // The selected detail is immutable, but its branch list now has a new HEAD.
  // Invalidate without calling load(), which would close the new commit detail.
  ++listVersion;listLoaded=false;commits.value=[];page.value=1;
  emit('changed');await router.replace({query:{...route.query,branch:props.branch,commit:result.commitId}});
}
function open(commit: Pick<CommitItem,'id'>) { void router.push({ query: { ...route.query, branch: props.branch, commit: commit.id } }); }
function back() { void router.replace({ query: { ...route.query, commit: undefined } }); }
async function copy(id: string) {
  try { await navigator.clipboard.writeText(id); store.notify('已复制完整提交 ID'); }
  catch { store.notify('无法访问剪贴板，请从提交详情中选取 ID'); }
}
function changePage(next: number) { if (next < 1 || loading.value) return; page.value = next; void load(); }
watch(() => [props.base, props.branch, route.query.commit] as const, ([base,branch,queryCommit],previous) => {
  const contextChanged=!previous || base!==previous[0] || branch!==previous[1];
  if(contextChanged){++listVersion;clearDetail();page.value=1;commits.value=[];listLoaded=false;error.value='';loading.value=false;}
  const commitId=typeof queryCommit==='string'?queryCommit:'';
  if(commitId)void loadDetail(commitId);
  else {clearDetail();if(contextChanged||!listLoaded)void load();}
}, { immediate: true });
watch(()=>route.query.path,value=>{fileFilter.value=String(value??'');});
onBeforeUnmount(()=>{++listVersion;++detailVersion;});
</script>

<template>
  <section class="commit-panel" aria-label="提交历史">
    <header class="section-heading">
      <div><h2>{{ selectedId ? '提交详情' : '提交历史' }}</h2><p class="muted">{{ selectedId ? '检查文件变更与版本差异。' : `${branch} 分支的版本记录` }}</p></div>
      <button v-if="selectedId" class="btn btn-ghost" @click="back"><ArrowLeft :size="15" /> 返回历史</button>
      <button v-else class="btn btn-ghost" :disabled="loading" @click="load"><RefreshCw :size="15" :class="{ spinning: loading }" /> 刷新</button>
    </header>
    <div v-if="error" role="alert" class="error-state">{{ error }}<button class="btn btn-ghost" @click="load">重试</button></div>
    <div v-else-if="loading" class="empty" role="status"><LoaderCircle class="spinning" :size="22" /> 正在读取提交记录…</div>
    <template v-else-if="selectedId">
      <div v-if="detailLoading" class="empty" role="status"><LoaderCircle class="spinning" :size="22" /> 正在读取变更…</div>
      <div v-else-if="detailError" role="alert" class="error-state">{{ detailError }}<button class="btn btn-ghost" @click="back">返回列表</button></div>
      <template v-else-if="selected">
        <article class="commit-summary panel">
          <button v-if="canRestore" class="btn btn-ghost" @click="restoreOpen=true">恢复到此版本（新增提交）</button>
          <div class="summary-title"><GitCommitHorizontal :size="23" /><h3>{{ selected.message }}</h3></div>
          <p class="muted">{{ selected.author || '未知作者' }} <span v-if="selected.email">&lt;{{ selected.email }}&gt;</span> · {{ date(selected.timestamp) }}</p>
          <div class="hash-line"><code>{{ selected.id }}</code><button class="icon-button" aria-label="复制提交 ID" @click="copy(selected.id)"><Copy :size="14" /></button></div>
          <p v-if="selected.parentIds.length" class="muted parent-line">父提交 <button v-for="parent in selected.parentIds" :key="parent" class="parent-commit" :title="parent" @click="open({id:parent})"><code>{{ parent.slice(0, 12) }}</code><ChevronRight :size="12"/></button></p>
        </article>
        <div class="diff-caption"><strong><FileDiff :size="16"/>{{ filteredFiles.length }}<span v-if="fileFilter"> / {{selected.files.length}}</span> 个变更文件</strong><label class="search-field"><Search :size="15"/><input v-model="fileFilter" aria-label="筛选提交中的文件" placeholder="筛选文件路径…"/><button v-if="fileFilter" class="icon-button" aria-label="清除文件筛选" @click="fileFilter='' "><X :size="13"/></button></label></div>
        <div class="commit-diff-layout" :class="{'single-file':filteredFiles.length<2}"><nav v-if="filteredFiles.length>1" class="commit-file-index" aria-label="变更文件目录"><a v-for="(file,index) in filteredFiles" :key="file.path" :href="`#change-${index}`" @click="expandedFiles[file.path]=true"><span class="file-change-dot" :class="file.status"></span><span>{{file.path}}</span></a></nav><div class="commit-diff-main">
        <div v-if="!filteredFiles.length" class="empty">{{fileFilter?'该提交没有匹配的文件变化。':'该提交没有可显示的文件差异。'}}</div>
        <article v-for="(file,index) in filteredFiles" :id="`change-${index}`" :key="file.path" class="diff-card panel">
          <header class="diff-header"><span class="badge" :class="`status-${file.status}`">{{ statusText(file.status) }}</span><code>{{ file.path }}</code><button v-if="file.status==='modified'&&selected.parentIds[0]" type="button" class="snapshot-file-button" @click="snapshotFile={path:file.path,ref:selected.parentIds[0]}">查看变更前</button><button v-if="file.status!=='removed' || selected.parentIds[0]" type="button" class="snapshot-file-button" @click="snapshotFile={path:file.path,ref:file.status==='removed'?selected.parentIds[0]!:selected.id}">查看{{file.status==='removed'?'删除前':'此版本'}}文件</button><button class="btn btn-ghost" :aria-expanded="fileExpanded(file.path,index)" @click="expandedFiles[file.path]=!fileExpanded(file.path,index)">{{fileExpanded(file.path,index)?'收起差异':'展开差异'}}</button><span v-if="file.before===undefined&&file.after===undefined" class="diff-stats"><span v-if="file.additions !== undefined" class="added">+{{ file.additions }}</span><span v-if="file.deletions !== undefined" class="removed">−{{ file.deletions }}</span></span></header>
          <template v-if="fileExpanded(file.path,index)"><TabularDiff v-if="file.tabular" :diff="file.tabular"/>
          <TextDiff v-else-if="file.before !== undefined || file.after !== undefined" :before="file.before" :after="file.after" :path="file.path"/>
          <pre v-else-if="file.diff" class="unified-diff"><span v-for="(line,index) in lines(file.diff)" :key="index" class="patch-line" :class="'raw-patch-'+patchKind(line)">{{line||' '}}</span></pre>
          <p v-else class="muted no-version">当前响应未包含可展开的文本差异；可通过“查看文件”检查对应版本内容。</p></template><p v-else class="muted no-version">差异已折叠，点击展开以查看变更。</p>
        </article>
        </div></div>
      </template>
    </template>
    <div v-else-if="!count" class="empty"><GitCommitHorizontal :size="28" /><h3>{{ page > 1 ? '已到达最后一页' : '还没有提交记录' }}</h3><p>{{ page > 1 ? '这个分支没有更多提交记录。' : '在工作区完成首次提交后，版本记录会显示在这里。' }}</p><button v-if="page > 1" class="btn btn-ghost" @click="changePage(page - 1)">返回上一页</button></div>
    <div v-else class="panel history-list">
      <div class="list-caption"><span>{{ count }} 条提交记录</span><span class="badge">{{ branch }}</span></div>
      <button v-for="commit in commits" :key="commit.id" class="commit-row" @click="open(commit)">
        <span class="timeline-icon"><GitCommitHorizontal :size="19" /></span>
        <span class="commit-copy"><strong>{{ commit.message }}</strong><span class="muted">{{ commit.author || '未知作者' }} · {{ date(commit.timestamp) }}</span></span>
        <code class="commit-hash">{{ commit.id.slice(0, 8) }}</code><ChevronRight :size="17" class="muted" />
      </button>
    </div>
    <nav v-if="!selectedId && !loading && !error && count && (page > 1 || count >= pageSize)" class="pagination" aria-label="提交历史分页"><button class="btn btn-ghost" :disabled="page <= 1" @click="changePage(page - 1)">上一页</button><span class="muted">第 {{ page }} 页</span><button class="btn btn-ghost" :disabled="count < pageSize" @click="changePage(page + 1)">下一页</button></nav>
    <div v-if="snapshotFile" class="commit-file-backdrop" @click.self="snapshotFile=undefined"><section class="commit-file-dialog" role="dialog" aria-modal="true" aria-label="提交版本文件预览" @keydown.esc="snapshotFile=undefined"><header><strong>提交文件预览 · {{snapshotFile.ref.slice(0,12)}}</strong><button class="icon-button" aria-label="关闭提交文件预览" @click="snapshotFile=undefined"><X :size="18"/></button></header><FilePreviewComponent :base="base" :branch="snapshotFile.ref" :path="snapshotFile.path" compact @close="snapshotFile=undefined"/></section></div>
    <RepositoryVersionRestorePanel v-if="restoreOpen&&selected" :base="base" :branch="branch" :target-commit="selected.id" @close="restoreOpen=false" @restored="restored"/>
  </section>
</template>

<style scoped>
.snapshot-file-button{font-size:13px;color:var(--muted);padding:4px 7px;border:1px solid var(--line);border-radius:4px;margin-left:5px;white-space:nowrap}
.snapshot-file-button:hover{background:var(--surface-raised)}
.commit-file-backdrop{position:fixed;inset:0;z-index:90;display:grid;place-items:center;background:rgba(0,0,0,.72);backdrop-filter:blur(3px);padding:24px}
.commit-file-dialog{width:100%;max-width:1120px;max-height:calc(100vh - 48px);overflow:auto;background:var(--surface);border:1px solid var(--line);border-radius:8px;box-shadow:0 24px 80px rgba(0,0,0,.35)}
.commit-file-dialog>header{display:flex;align-items:center;justify-content:space-between;padding:17px 20px;border-bottom:1px solid var(--line);font-size:13px;color:var(--muted)}
@media(max-width:640px){.commit-file-backdrop{padding:12px}
.commit-file-dialog{max-height:calc(100vh - 24px)}
.diff-header{flex-wrap:wrap}
}
.pagination{display:flex;align-items:center;justify-content:center;gap:18px;padding:20px 0;font-size:13px}
.section-heading{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:24px}
.section-heading h2{margin:0 0 7px;font-size:23px}
.section-heading p{margin:0;font-size:13px}
.history-list{overflow:hidden}
.list-caption{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid var(--border,var(--line));font-size:13px;color:var(--muted,var(--text))}
.commit-row{display:flex;align-items:center;text-align:left;gap:16px;width:100%;border:0;border-bottom:1px solid var(--border,var(--line));background:transparent;padding:22px 20px;cursor:pointer;color:inherit}
.commit-row:last-child{border-bottom:0}
.commit-row:hover{background:var(--surface-raised)}
.timeline-icon{display:flex;align-items:center;justify-content:center;width:35px;height:35px;flex-shrink:0;border:1px solid var(--line);background:var(--surface-raised);border-radius:50%;color:var(--text)}
.commit-copy{display:flex;flex:1;min-width:0;flex-direction:column;gap:7px}
.commit-copy strong{font-size:14px;font-weight:600;overflow-wrap:anywhere}
.commit-copy .muted{font-size:13px}
.commit-hash{font-size:13px;color:var(--text);background:var(--surface-raised);padding:5px 8px;border-radius:4px}
.commit-summary{padding:22px;margin-bottom:25px}
.summary-title{display:flex;gap:12px;align-items:center}
.summary-title h3{font-size:18px;margin:0;overflow-wrap:anywhere}
.commit-summary p{font-size:13px;margin:15px 0}
.hash-line{display:flex;align-items:center;gap:8px;overflow-wrap:anywhere;font-size:13px}
.hash-line code{word-break:break-all}
.icon-button{display:flex;border:0;background:transparent;padding:5px;cursor:pointer;color:var(--text)}
.parent-line code{margin-left:8px}
.diff-caption{display:flex;justify-content:space-between;gap:10px;font-size:13px;margin-bottom:14px}
.diff-card{overflow:hidden;margin-bottom:16px}
.diff-header{display:flex;align-items:center;gap:11px;padding:13px 17px;border-bottom:1px solid var(--line);font-size:13px}
.diff-header code{overflow-wrap:anywhere}
.diff-stats{margin-left:auto;display:flex;gap:10px}
.added{color:var(--text)}
.removed{color:var(--text)}
.split-diff{display:grid;grid-template-columns:1fr 1fr;min-width:0}
.diff-side{min-width:0}
.before{border-right:1px solid var(--line);background:var(--surface-raised)}
.after{background:var(--surface-raised)}
.diff-side-heading{font-size:13px;padding:9px 15px;color:var(--text);border-bottom:1px solid var(--line);background:var(--surface-raised)}
.diff-side pre{overflow:auto;margin:0;padding:10px 0;font-size:13px;line-height:1.8;max-height:520px}
.code-line{display:flex;min-width:max-content}
.line-number{display:inline-block;min-width:38px;padding:0 9px;text-align:right;user-select:none;color:var(--muted)}
.code-line>span:last-child{padding-right:16px}
.unified-diff{overflow:auto;padding:18px;font-size:13px}
.no-version{padding:18px;font-size:13px}
.empty{display:flex;flex-direction:column;align-items:center;gap:12px;padding:65px 24px}
.empty h3,.empty p{margin:0}
.spinning{animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}
}
@media(max-width:640px){.commit-row{padding:17px 13px;gap:10px}
.commit-hash{display:none}
.split-diff{grid-template-columns:1fr}
.before{border-right:0;border-bottom:1px solid var(--line)}
.diff-caption{flex-direction:column}
.section-heading{align-items:flex-start}
}
.commit-summary{padding:24px;background:var(--surface);margin-bottom:24px}
.summary-title{align-items:flex-start}
.summary-title>svg{margin-top:3px;color:var(--primary)}
.summary-title h3{font-size:21px;line-height:1.5;font-weight:600}
.commit-summary>p{font-size:13px;color:var(--muted)}
.hash-line{gap:10px;font-size:12px}
.hash-line>code{padding:7px 10px;background:var(--surface-raised);border:1px solid var(--line);border-radius:5px}
.parent-line{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.parent-commit{display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border:1px solid var(--line);border-radius:5px;background:var(--surface-raised);color:var(--muted)}
.parent-commit:hover{border-color:var(--primary);color:var(--text)}
.parent-line .parent-commit code{margin:0;font-size:12px}
.diff-caption{align-items:center;gap:18px;padding:4px 0 18px}
.diff-caption>strong{display:flex;align-items:center;gap:8px;font-size:14px;white-space:nowrap}
.diff-caption .search-field{width:310px;margin-left:auto}
.commit-diff-layout{display:grid;grid-template-columns:210px minmax(0,1fr);gap:22px;align-items:start}
.commit-diff-layout.single-file{grid-template-columns:minmax(0,1fr)}
.commit-diff-main{min-width:0}
.commit-file-index{position:sticky;top:20px;display:flex;flex-direction:column;border:1px solid var(--line);border-radius:6px;overflow:hidden;background:var(--surface)}
.commit-file-index a{display:flex;align-items:start;gap:9px;padding:12px;border-bottom:1px solid var(--line);font-size:12px;color:var(--muted);overflow-wrap:anywhere;line-height:1.6}
.commit-file-index a:last-child{border:0}
.commit-file-index a:hover{color:var(--text);background:var(--surface-raised)}
.file-change-dot{width:6px;height:6px;flex-shrink:0;margin-top:6px;border-radius:50%;background:var(--primary)}
.file-change-dot.added{background:var(--success)}
.file-change-dot.removed{background:var(--danger)}
.diff-card{scroll-margin-top:24px}
.diff-header{padding:13px 16px;background:var(--surface-raised);font-size:13px;gap:10px;min-height:56px}
.diff-header code{font-size:13px}
.snapshot-file-button{font-size:12px;min-height:32px;padding:6px 9px;border-color:var(--line);color:var(--muted);background:var(--surface)}
.snapshot-file-button:hover{color:var(--text);background:var(--surface-raised)}
.added{color:var(--success)}
.removed{color:var(--danger)}
.before{background:color-mix(in srgb,var(--danger) 5%,var(--surface))}
.after{background:color-mix(in srgb,var(--success) 5%,var(--surface))}
.diff-side-heading{padding:10px 14px;font-size:12px;background:var(--surface-raised);color:var(--muted)}
.diff-side pre{font-size:12px;line-height:1.9}
.line-number{color:var(--muted);opacity:.6;min-width:42px}
.commit-file-dialog{background:var(--surface);border-color:var(--line);box-shadow:0 30px 100px rgba(0,0,0,.45)}
.commit-file-dialog>header{font-size:14px;color:var(--text)}
.timeline-icon{color:var(--muted);background:var(--surface-raised);border-color:var(--line)}
.commit-row{padding:19px 20px}
.commit-copy strong{font-size:14px;color:var(--text);font-weight:550}
.commit-copy .muted{font-size:12px}
.commit-hash{font-size:12px;color:var(--muted);background:var(--surface-raised);border:1px solid var(--line)}
.commit-row:hover{background:var(--surface-raised)}
@media(max-width:1000px){.commit-diff-layout{grid-template-columns:minmax(0,1fr)}
.commit-file-index{display:none}
}
@media(max-width:640px){.diff-caption{flex-direction:column;align-items:stretch}
.diff-caption .search-field{width:100%;margin:0}
.summary-title h3{font-size:18px}
.commit-summary{padding:20px}
.diff-header code{flex:1}
.snapshot-file-button{margin-left:0}
}

.patch-line{display:block;min-height:20px}.raw-patch-added{color:var(--success);background:color-mix(in srgb,var(--success) 9%,transparent)}.raw-patch-removed{color:var(--danger);background:color-mix(in srgb,var(--danger) 9%,transparent)}.raw-patch-hunk{color:var(--muted);background:var(--primary-soft)}
</style>
