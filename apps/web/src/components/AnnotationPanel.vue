<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import { ArrowLeft, ArrowRight, Database, FileText, FolderOpen, GitBranch, FileArchive, LoaderCircle, RefreshCw, Tags } from 'lucide-vue-next';
import type { BranchItem, FilePreview, LabelScope, LabelState } from '@oxen/shared';
import { queryString, request } from '../api';
import { useAppStore } from '../stores/app';
import FilePreviewComponent from './FilePreview.vue';
import LabelManager from './LabelManager.vue';
import FileTree from './FileTree.vue';
const props = defineProps<{ base: string; branch: string }>();
const app = useAppStore(), route = useRoute(), router = useRouter();
interface LoadedContext { base: string; branch: string; path: string; ref: string }
const path = ref(typeof route.query.path === 'string' ? route.query.path : '');
const showFilePicker=ref(!path.value);
const table = ref<FilePreview>(), context = ref<LoadedContext>(), labels = ref<LabelState>();
const page = ref(Math.max(1, Number(route.query.page) || 1)), pageSize = 50, rowIndex = ref(0), loading = ref(false), error = ref(''), search = ref(''), associated = ref('');
const draftPage = ref(String(page.value));
const scope = ref<LabelScope>(['dataset','file','row'].includes(String(route.query.scope)) ? String(route.query.scope) as LabelScope : path.value ? 'row' : 'dataset');
interface LabelEditorHandle{hasUnsavedChanges:boolean;busy:boolean;discardUnsavedChanges:()=>void}
const labelEditor=ref<LabelEditorHandle|null>(null);
const filePathInput=ref(path.value);
let generation = 0;
const supported = computed(() => app.status?.capabilities.annotations === true);
const reviewFilter=ref('');
const reviewColumn=computed(()=>labels.value?.columns.find(column=>column.semanticKey==='general.review_status'));
function rowReview(index:number){const id=rowIdAt(index);const assignment=labels.value?.assignments.find(item=>item.scope==='row'&&item.path===path.value&&item.rowId===id);return String(assignment?.values[reviewColumn.value?.id??'']??'');}
const reviewedOnPage=computed(()=>table.value?.rows?.filter((_,index)=>rowReview(index)==='已审核').length??0);
watch(reviewColumn,column=>{if(reviewFilter.value&&reviewFilter.value!=='__unset'&&!column?.options?.some(option=>option.value===reviewFilter.value))reviewFilter.value='';});
const current = computed(() => table.value?.rows?.[rowIndex.value]);
const currentRowId = computed(() => rowIdAt(rowIndex.value));
const pageCount = computed(() => Math.max(1, Math.ceil((table.value?.totalRows ?? 0) / pageSize)));
const visibleRows = computed(() => (table.value?.rows ?? []).map((row,index) => ({row,index})).filter(({row,index}) => JSON.stringify(row).toLowerCase().includes(search.value.toLowerCase())&&(!reviewFilter.value||(reviewFilter.value==='__unset'?!hasLabels(index):rowReview(index)===reviewFilter.value))));
const media = computed(() => Object.values(current.value ?? {}).filter(value => typeof value === 'string' && !value.includes('..') && !value.startsWith('/') && !/^[a-z]+:/i.test(value) && /\.(zip|txt|md|json|jsonl|ndjson|pdf)$/i.test(value)) as string[]);
function rowIdAt(index: number): string | undefined { const row = table.value?.rows?.[index]; const id = table.value?.rowIds?.[index] ?? row?._oxen_row_id ?? row?._oxen_id; return id === undefined ? undefined : String(id); }
function hasLabels(index: number) { const rowId = rowIdAt(index); return !!rowId && labels.value?.assignments.some(item => item.scope === 'row' && item.path === path.value.trim() && item.rowId === rowId && Object.keys(item.values).length > 0); }
function rowTitle(row: Record<string,unknown>) { const value = row.text ?? row.prompt ?? row.original_goal ?? row.title ?? row.name ?? row.uid ?? row.id ?? '样本'; return (typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)).slice(0, 100); }
function pretty(value: unknown) { return typeof value === 'object' && value !== null ? JSON.stringify(value, null, 2) : value === null ? 'null' : String(value); }
function reset() { reviewFilter.value=''; ++generation; context.value = undefined; table.value = undefined; labels.value = undefined; rowIndex.value = 0; page.value = Math.max(1,Number(route.query.page)||1); scope.value = ['dataset','file','row'].includes(String(route.query.scope)) ? String(route.query.scope) as LabelScope : path.value?'row':'dataset'; search.value = ''; associated.value = ''; error.value = ''; loading.value = false; }
async function load(fresh = true, preserveRow = false) {
  if (!supported.value || !path.value.trim()) return;
  const requestContext: LoadedContext = !fresh && context.value ? { ...context.value } : { base: props.base, branch: props.branch, path: path.value.trim(), ref: props.branch };
  const previousRow = preserveRow ? currentRowId.value : typeof route.query.row === 'string' ? route.query.row : undefined;
  const currentGeneration = ++generation; if (!preserveRow || fresh || !table.value) loading.value = true; error.value = '';
  try {
    if (fresh) { const branches = await request<BranchItem[]>(requestContext.base + '/branches'); if (currentGeneration !== generation) return; requestContext.ref = branches.find(branch => branch.name === requestContext.branch)?.commitId || requestContext.branch; }
    const preview = await request<FilePreview>(requestContext.base + '/file' + queryString({ path: requestContext.path, ref: requestContext.ref, page: page.value, pageSize }));
    if (currentGeneration !== generation) return;
    if (preview.kind !== 'table') throw new Error('请选择 JSONL、CSV、TSV 或 Parquet 表格文件。');
    context.value = requestContext;
    const lastPage = Math.max(1, Math.ceil((preview.totalRows ?? 0) / pageSize));
    if (page.value > lastPage) { page.value = lastPage; void load(false); return; }
    table.value = preview; search.value = '';
    const previousIndex = previousRow ? preview.rowIds?.indexOf(previousRow) ?? -1 : -1;
    rowIndex.value = previousIndex >= 0 ? previousIndex : 0; associated.value = media.value[0] ?? '';
  } catch (cause) { if (currentGeneration === generation) error.value = (cause as Error).message; }
  finally { if (currentGeneration === generation) loading.value = false; }
}
async function allowLabelNavigation(){const editor=labelEditor.value;if(editor?.busy){app.notify('标签正在提交，请等待完成后再切换。');return false;}if(!editor?.hasUnsavedChanges)return true;if(!(await app.confirmAction('当前标签或列配置尚未保存，确认放弃并切换吗？',{title:'未保存的标签',confirmLabel:'放弃并切换'})))return false;editor.discardUnsavedChanges();return true;}
async function changeScope(next:LabelScope){if(next!==scope.value&&await allowLabelNavigation())scope.value=next;}
async function selectSample(index:number){if(index===rowIndex.value)return;if(scope.value==='row'&&!(await allowLabelNavigation()))return;rowIndex.value=index;}
async function openFile() { if(!(await allowLabelNavigation()))return;const next=filePathInput.value.trim();if(!next)return;showFilePicker.value=false;if(next===path.value){page.value=1;rowIndex.value=0;scope.value='row';await load(true);await router.replace({query:{branch:props.branch,path:next,page:'1',scope:'row',row:currentRowId.value}});}else await router.replace({query:{branch:props.branch,path:next,page:'1',scope:'row'}}); }
async function chooseFile(file:{path:string}){filePathInput.value=file.path;await openFile();}
async function goToPage(next: number) { if (loading.value || !Number.isFinite(next)) return;if(scope.value==='row'&&!(await allowLabelNavigation())){draftPage.value=String(page.value);return;} page.value = Math.max(1, Math.min(pageCount.value, Math.trunc(next))); rowIndex.value = 0; await load(false); }
async function moveSample(direction:number){const next=rowIndex.value+direction;if(next>=0&&next<(table.value?.rows?.length??0)){await selectSample(next);return;}const nextPage=page.value+direction;if(nextPage<1||nextPage>pageCount.value||!(await allowLabelNavigation()))return;await goToPage(nextPage);if(!error.value&&table.value?.rows?.length)rowIndex.value=direction>0?0:table.value.rows.length-1;}
function jumpPage() { const next=Number(draftPage.value); if(Number.isFinite(next))goToPage(next); }
watch(page,value=>{draftPage.value=String(value);});
function labelChanged(state: LabelState) { labels.value = state; if (context.value) context.value = { ...context.value, ref: state.commitId }; }
async function refreshSnapshot() { if(await allowLabelNavigation())void load(true, true); }
watch([()=>props.base,()=>props.branch,()=>route.query.path],()=>{path.value=typeof route.query.path==='string'?route.query.path:'';filePathInput.value=path.value;reset();if(path.value)void load(true);else showFilePicker.value=true;},{immediate:true,flush:'sync'});
watch([()=>route.query.scope,()=>route.query.page,()=>route.query.row],async([nextScope,nextPage,nextRow])=>{if(loading.value||!context.value||context.value.path!==path.value)return;const requestedPage=Math.max(1,Math.min(pageCount.value,Number(nextPage)||1));if(requestedPage!==page.value){page.value=requestedPage;await load(false);}if(typeof nextRow==='string'){const index=table.value?.rowIds?.indexOf(nextRow)??-1;if(index>=0)rowIndex.value=index;}if(['dataset','file','row'].includes(String(nextScope)))scope.value=String(nextScope) as LabelScope;});
watch(rowIndex, () => { associated.value = media.value[0] ?? ''; });
watch([scope,page,rowIndex,currentRowId],()=>{if(route.params.tab!=='annotations'||loading.value||!context.value||!table.value)return;void router.replace({query:{...route.query,branch:props.branch,path:path.value,scope:scope.value,page:String(page.value),row:currentRowId.value}});});

onBeforeRouteLeave(()=>allowLabelNavigation());
onBeforeRouteUpdate((to,from)=>{const changed=['namespace','repo','tab'].some(key=>to.params[key]!==from.params[key])||['branch','path','scope','page','row'].some(key=>to.query[key]!==from.query[key]);return changed?allowLabelNavigation():true;});
function beforeUnload(event:BeforeUnloadEvent){if(!labelEditor.value?.hasUnsavedChanges&&!labelEditor.value?.busy)return;event.preventDefault();event.returnValue='';}
onMounted(()=>window.addEventListener('beforeunload',beforeUnload));
onBeforeUnmount(() => { ++generation;window.removeEventListener('beforeunload',beforeUnload); });
</script>

<template>
  <section class="panel annotation-panel-v2">
    <header class="panel-header"><div><h2>数据标签</h2><p class="muted">定义自己的标签列，在数据集、文件和样本三个层级标注。</p></div><Tags :size="23" class="muted" /></header>
    <form class="inline-form" @submit.prevent="openFile"><button type="button" class="btn" @click="showFilePicker=!showFilePicker"><FolderOpen :size="15"/>选择数据文件</button><label class="field">数据文件<input v-model="filePathInput" required placeholder="data/samples.jsonl" /></label><button class="btn" :disabled="loading || !supported"><LoaderCircle v-if="loading" class="spin" :size="15" /><FileText v-else :size="15" /> 加载样本</button><button type="button" class="btn btn-ghost" :disabled="loading || !supported" @click="refreshSnapshot"><RefreshCw :size="14" /> 最新版本</button></form>
    <section v-if="showFilePicker" class="annotation-file-picker"><header><strong>选择要标注的数据</strong><button class="btn btn-ghost" @click="showFilePicker=false">收起目录</button></header><FileTree :base="base" :branch="branch" :selected="path" tabular-only @select="chooseFile"/></section>
    <p v-if="context" class="annotation-version"><GitBranch :size="13" /><strong>{{ context.branch }}</strong><code>{{ context.ref.slice(0, 12) }}</code><span>{{ context.path }}</span><span v-if="table">{{ table.totalRows?.toLocaleString() }} 条样本 · {{ table.columns?.length }} 个原始字段</span></p>
    <div v-if="!supported" class="notice">{{ app.status?.capabilities.reasons.annotations || '当前服务未启用标签功能。' }}</div>
    <div v-if="error" class="error-state" role="alert">{{ error }}</div>
    <div class="label-scope-tabs" role="group" aria-label="标签作用层级"><button :class="{ active: scope === 'dataset' }" @click="changeScope('dataset')"><Database :size="14" /> 数据集</button><button :class="{ active: scope === 'file' }" :disabled="!context" @click="changeScope('file')"><FileText :size="14" /> 文件</button><button :class="{ active: scope === 'row' }" :disabled="!currentRowId" @click="changeScope('row')"><Tags :size="14" /> 样本行</button><span>{{ scope === 'dataset' ? '标签赋给整个仓库' : scope === 'file' ? '标签赋给当前文件' : '标签只赋给当前选中的样本' }}</span></div>
    <div v-if="scope !== 'row'" class="scope-label-area"><LabelManager ref="labelEditor" :base="base" :branch="branch" :scope="scope" :path="context?.path" :commit-id="context?.ref" @changed="labelChanged" @loaded="labels = $event" @refresh="refreshSnapshot" /></div>
    <div v-if="loading" class="sample-loading" role="status"><LoaderCircle :size="23" class="spin" /> 正在读取第 {{ page }} 页样本…</div>
    <div v-else-if="table?.rows?.length" class="annotation-workbench" :class="{'row-mode':scope==='row'}">
      <aside class="sample-sidebar"><header><strong>样本 · {{ table.totalRows?.toLocaleString() }}</strong><span>第 {{ page }} / {{ pageCount }} 页</span></header><input v-model="search" class="sample-search" aria-label="搜索当前页样本" placeholder="搜索当前页…" /><select v-model="reviewFilter" class="sample-review-filter" aria-label="筛选当前页审核状态"><option value="">当前页 · 全部状态</option><option value="__unset">当前页 · 尚无条目标签</option><option v-for="option in reviewColumn?.options" :key="option.value" :value="option.value">{{option.value}}</option></select><p class="sample-review-progress">本页已审核 {{reviewedOnPage}} / {{table.rows.length}}</p><div class="sample-list"><button v-for="{row,index} in visibleRows" :key="rowIdAt(index) || index" :class="{ selected: rowIndex === index }" @click="selectSample(index)"><span class="sample-number">{{ (page - 1) * pageSize + index + 1 }}</span><span><strong>{{ row.id ?? row.sample_id ?? '样本 ' + ((page - 1) * pageSize + index + 1) }}</strong><small>{{ rowTitle(row) }}</small></span><span v-if="rowReview(index)" class="sample-review-badge">{{rowReview(index)}}</span><i v-else-if="hasLabels(index)" aria-label="有条目标签"></i></button><p v-if="!visibleRows.length" class="sample-no-match">当前页没有匹配样本。</p></div><footer class="sample-pagination"><div><button type="button" class="icon-button" aria-label="上一页样本" :disabled="loading || page <= 1" @click="goToPage(page - 1)"><ArrowLeft :size="15" /></button><span>第 {{ page }} / {{ pageCount }} 页</span><button type="button" class="icon-button" aria-label="下一页样本" :disabled="loading || page >= pageCount" @click="goToPage(page + 1)"><ArrowRight :size="15" /></button></div><form class="sample-jump-form" @submit.prevent="jumpPage"><label>跳至 <input v-model="draftPage" type="number" min="1" :max="pageCount" aria-label="样本页码" :disabled="loading" @keydown.enter.prevent="jumpPage" /> 页</label><button type="submit" class="sample-jump-button" :disabled="loading || !draftPage">跳转</button></form><span>每页 {{ pageSize }} 条 · 所有样本均可翻页访问</span></footer></aside>
      <section class="sample-body"><header class="sample-heading"><div><h3>样本 {{ (page - 1) * pageSize + rowIndex + 1 }}</h3><code :title="currentRowId">{{ currentRowId?.slice(0, 26) || '未提供稳定行标识' }}</code></div><div class="sample-next-actions"><button class="btn btn-ghost" :disabled="loading||(page===1&&rowIndex===0)" @click="moveSample(-1)">上一条</button><button class="btn btn-ghost" :disabled="loading||(page===pageCount&&rowIndex===(table.rows.length-1))" @click="moveSample(1)">下一条</button></div></header><p class="sample-content-note">浏览原始记录，在右侧赋值标签；修改源记录请进入“编辑数据”。</p><dl class="sample-fields"><template v-for="(value,key) in current" :key="key"><dt>{{ key }}<small>{{ value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value }}</small></dt><dd><details v-if="value !== null && typeof value === 'object'" class="nested-value"><summary>展开 {{ Array.isArray(value) ? value.length + ' 个数组项' : Object.keys(value).length + ' 个字段' }}</summary><pre>{{ pretty(value) }}</pre></details><pre v-else-if="typeof value === 'string' && (value.length > 180 || value.includes('\n'))" class="sample-long-text">{{ value }}</pre><span v-else :class="{ 'null-value': value === null }">{{ pretty(value) }}</span></dd></template></dl>
      <div v-if="media.length" class="sample-media-links"><button v-for="item in media" :key="item" class="btn btn-ghost" @click="associated = associated === item ? '' : item"><FileArchive :size="14" />{{ item }}</button></div><RouterLink v-if="associated" class="associated-file-link" :to="{path:`/repos/${encodeURIComponent(String(route.params.namespace))}/${encodeURIComponent(String(route.params.repo))}/files`,query:{branch:branch,file:associated,path:associated.split('/').slice(0,-1).join('/')}}">打开关联文件与文件级标签</RouterLink><FilePreviewComponent v-if="associated" :base="base" :branch="context?.ref || branch" :path="associated" compact @close="associated = ''" />
      </section><aside v-if="scope === 'row'" class="sample-label-area"><p v-if="!currentRowId" class="notice">该格式没有返回稳定行标识，已阻止按位置写入，避免给其他样本误赋标签。</p><LabelManager v-else ref="labelEditor" :base="base" :branch="branch" scope="row" :path="context?.path" :row-id="currentRowId" :commit-id="context?.ref" @changed="labelChanged" @loaded="labels = $event" @refresh="refreshSnapshot" /></aside>
    </div>
    <div v-else-if="!error && !loading && scope === 'row'" class="empty"><Tags :size="30" /><h3>{{ table ? '当前文件没有样本' : '加载文件，开始逐条标注' }}</h3><p>JSONL、嵌套 JSON 与长文本均可阅读；标签单独版本化保存。</p></div>
  </section>
</template>

<style scoped>
.sample-jump-form{display:flex;align-items:center;justify-content:center;gap:9px;margin-top:10px}
.sample-jump-button{font-size:13px;color:var(--muted);border:1px solid var(--line);border-radius:4px;padding:5px 9px;background:var(--surface-raised)}
.sample-jump-button:hover{background:var(--surface-raised)}
.annotation-panel-v2{overflow:clip}
.annotation-panel-v2>.panel-header{align-items:center}
.annotation-version{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:0 24px 19px;font-size:13px;color:var(--muted)}
.annotation-version code{background:var(--surface-raised);padding:3px 7px;border-radius:4px;color:var(--text)}
.annotation-version>span{overflow-wrap:anywhere}
.annotation-version>span:last-child{margin-left:auto;color:var(--muted)}
.label-scope-tabs{display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding:14px 24px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:var(--surface-raised)}
.label-scope-tabs button{display:flex;align-items:center;gap:7px;font-size:13px;padding:9px 13px;border:1px solid transparent;border-radius:5px;color:var(--muted)}
.label-scope-tabs button.active{border-color:var(--line);background:var(--surface-raised);color:var(--text)}
.label-scope-tabs>span{margin-left:auto;color:var(--muted);font-size:13px}
.scope-label-area{padding:23px 25px;border-bottom:1px solid var(--line)}
.sample-loading{display:flex;gap:11px;align-items:center;justify-content:center;padding:80px;color:var(--muted);font-size:13px}
.annotation-workbench{display:grid;grid-template-columns:240px minmax(0,1fr);min-height:480px}
.sample-sidebar{display:flex;flex-direction:column;background:var(--surface-raised);border-right:1px solid var(--line);min-width:0}
.sample-sidebar>header{display:flex;justify-content:space-between;gap:5px;padding:17px 15px;font-size:13px;color:var(--muted)}
.sample-sidebar header strong{font-size:13px;color:var(--text)}
.sample-search{display:block;width:calc(100% - 28px);margin:0 14px 13px;padding:8px 10px;border:1px solid var(--line);border-radius:5px;background:var(--surface);font-size:13px;color:var(--text);box-sizing:border-box}
.sample-list{overflow:auto;max-height:740px;flex:1}
.sample-list>button{display:flex;align-items:center;gap:9px;width:100%;text-align:left;padding:14px 13px;border-top:1px solid var(--line);font-size:13px;min-width:0}
.sample-list>button.selected{background:var(--surface-raised);box-shadow:inset 3px 0 rgba(0,0,0,.35);color:var(--text)}
.sample-number{color:var(--muted);font-family:Consolas,monospace;font-size:13px;min-width:24px;align-self:flex-start;margin-top:1px}
.sample-list>button>span:nth-child(2){flex:1;min-width:0}
.sample-list strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13px;font-weight:550}
.sample-list small{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:var(--muted);font-size:13px;line-height:1.6;margin-top:5px}
.sample-list i{display:block;width:5px;height:5px;border-radius:50%;background:var(--surface-raised);flex-shrink:0}
.sample-no-match{padding:22px;font-size:13px;color:var(--muted)}
.sample-pagination{padding:15px 10px;border-top:1px solid var(--line);color:var(--muted);font-size:13px}
.sample-pagination>div{display:flex;align-items:center;justify-content:center;gap:10px}
.sample-pagination label{display:flex;align-items:center;gap:6px}
.sample-pagination input{width:39px;text-align:center;padding:5px;border:1px solid var(--line);border-radius:4px;background:var(--surface);color:var(--muted);font-size:13px}
.sample-pagination>span{display:block;text-align:center;margin-top:9px;font-size:13px}
.sample-body{min-width:0;padding:24px}
.sample-heading{display:flex;align-items:center;justify-content:space-between;gap:15px;margin-bottom:12px}
.sample-heading>div{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.sample-heading h3{font-size:15px;color:var(--text)}
.sample-heading code{font-size:13px;color:var(--muted)}
.sample-heading>span{font-size:13px;color:var(--muted)}
.sample-content-note{font-size:13px;color:var(--muted);margin-bottom:24px;line-height:1.8}
.sample-fields{display:grid;grid-template-columns:115px minmax(0,1fr);gap:13px 18px;margin:0}
.sample-fields dt{font-size:13px;color:var(--muted);overflow-wrap:anywhere;padding-top:1px}
.sample-fields dt small{display:block;margin-top:5px;font-size:13px;color:var(--muted)}
.sample-fields dd{margin:0;min-width:0;font-size:13px;line-height:1.9;color:var(--text);overflow-wrap:anywhere;white-space:pre-wrap}
.sample-long-text{font-family:'Segoe UI','Microsoft YaHei UI',sans-serif;font-size:13px;line-height:1.9;white-space:pre-wrap;overflow-wrap:anywhere;max-height:460px;overflow:auto;margin:0;padding:14px 16px;background:var(--surface-raised);border:1px solid var(--line);border-radius:6px;tab-size:2}
.nested-value{white-space:normal}
.nested-value summary{cursor:pointer;color:var(--muted);font-size:13px}
.nested-value pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:440px;overflow:auto;font-family:Consolas,monospace;font-size:13px;padding:13px;background:var(--surface-raised);border:1px solid var(--line);border-radius:5px;line-height:1.7;margin:9px 0 0}
.null-value{font-style:italic;color:var(--muted)}
.sample-media-links{display:flex;flex-wrap:wrap;gap:7px;margin:20px 0}
.sample-label-area{margin-top:28px;border-top:1px solid var(--line);padding-top:22px}
@media(max-width:1000px){.annotation-workbench{grid-template-columns:200px minmax(0,1fr)}
.sample-fields{grid-template-columns:90px minmax(0,1fr);gap:12px}
.sample-body{padding:19px}
}
@media(max-width:700px){.annotation-workbench{grid-template-columns:1fr}
.sample-sidebar{border-right:0;border-bottom:1px solid var(--line)}
.sample-list{max-height:220px}
.sample-fields{grid-template-columns:1fr;gap:7px}
.sample-fields dd{margin-bottom:15px}
.sample-fields dt small{display:inline;margin-left:7px}
.sample-body{padding:18px}
.annotation-version{margin:0 17px 16px}
.annotation-version>span:last-child{margin-left:0}
.label-scope-tabs{padding:12px 14px}
.label-scope-tabs>span{width:100%;margin:5px 0 0}
.scope-label-area{padding:18px}
}
.annotation-panel-v2>.panel-header{background:var(--surface);padding:22px 24px}
.annotation-panel-v2>.panel-header h2{font-size:20px}
.annotation-panel-v2>.panel-header p{font-size:14px}
.annotation-version{font-size:12px;color:var(--muted);margin-bottom:18px}
.annotation-version code{font-size:12px;background:var(--surface-raised);border:1px solid var(--line);color:var(--text)}
.annotation-version>span:last-child{font-size:12px;color:var(--muted)}
.label-scope-tabs{padding:0 24px;gap:2px;background:var(--surface);min-height:55px}
.label-scope-tabs button{font-size:13px;min-height:55px;border-radius:0;border:0;border-bottom:2px solid transparent;padding:12px 15px;color:var(--muted)}
.label-scope-tabs button.active{color:var(--text);border-bottom-color:var(--primary);background:transparent}
.label-scope-tabs>span{font-size:12px;color:var(--muted)}
.annotation-workbench{grid-template-columns:230px minmax(0,1fr)}
.annotation-workbench.row-mode{grid-template-columns:210px minmax(260px,1fr) 310px;align-items:start}
.sample-sidebar{background:var(--surface);align-self:stretch}
.sample-sidebar>header{font-size:12px;min-height:58px;align-items:center}
.sample-sidebar>header strong{font-size:13px}
.sample-search{height:36px;font-size:12px;background:var(--bg)}
.sample-list>button{padding:15px 14px;gap:10px}
.sample-list>button:hover{background:var(--surface-raised)}
.sample-list>button.selected{background:color-mix(in srgb,var(--primary) 9%,var(--surface));box-shadow:inset 3px 0 var(--primary)}
.sample-list strong{font-size:13px;color:var(--text)}
.sample-list small{font-size:12px;line-height:1.7;color:var(--muted)}
.sample-list i{background:var(--success);width:6px;height:6px}
.sample-number{font-size:11px}
.sample-pagination{font-size:12px;padding:15px 12px;background:var(--surface)}
.sample-pagination input{font-size:12px;width:48px;min-height:32px;color:var(--text)}
.sample-pagination>span{font-size:11px;line-height:1.7}
.sample-jump-button{min-height:32px;font-size:12px;color:var(--text);background:var(--surface-raised)}
.sample-body{padding:22px;min-width:0}
.sample-heading h3{font-size:17px}
.sample-heading code{font-size:11px}
.sample-heading>span{font-size:11px;padding:4px 7px;background:var(--surface-raised);border:1px solid var(--line);border-radius:4px;white-space:nowrap}
.sample-content-note{font-size:12px;margin-bottom:23px}
.sample-fields{grid-template-columns:90px minmax(0,1fr);gap:18px 15px}
.sample-fields dt{font-size:13px;color:var(--text)}
.sample-fields dt small{font-size:11px;color:var(--muted)}
.sample-fields dd{font-size:14px;line-height:1.85}
.sample-long-text{font-family:inherit;font-size:14px;line-height:1.85;background:var(--bg)}
.nested-value summary{font-size:12px}
.nested-value pre{font-size:12px;background:var(--bg)}
.sample-label-area{margin:0;padding:20px;min-width:0;background:var(--surface);border-top:0;border-left:1px solid var(--line);position:sticky;top:88px;max-height:calc(100vh - 104px);overflow:auto}
.sample-label-area :deep(.label-values fieldset){grid-template-columns:minmax(0,1fr)}
.sample-label-area :deep(.schema-form-grid){grid-template-columns:minmax(0,1fr)}
.sample-label-area :deep(.label-heading){gap:14px}
.sample-label-area :deep(.label-config-toggle){padding:5px 0}
.sample-media-links{margin-top:24px}
.sample-body :deep(.image-preview){min-height:180px;padding:15px}
.sample-body :deep(.image-preview img){max-height:300px}
.scope-label-area{background:var(--surface);padding:24px}
@media(max-width:1100px){.annotation-workbench.row-mode{grid-template-columns:210px minmax(0,1fr)}
.sample-label-area{grid-column:1/-1;position:static;max-height:none;border-left:0;border-top:1px solid var(--line);padding:24px}
.sample-label-area :deep(.label-values fieldset){grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
}
@media(max-width:760px){.annotation-workbench,.annotation-workbench.row-mode{grid-template-columns:minmax(0,1fr)}
.sample-sidebar{border-right:0;border-bottom:1px solid var(--line)}
.sample-list{max-height:210px}
.sample-fields{grid-template-columns:85px minmax(0,1fr)}
.label-scope-tabs{padding:0 12px}
.label-scope-tabs>span{display:none}
.sample-heading{align-items:flex-start}
.sample-heading>div{gap:7px}
.sample-body{padding:18px}
.sample-label-area{padding:18px}
.sample-pagination>span{font-size:11px}
}

</style>

<style scoped>
.annotation-file-picker{margin:0 24px 20px;border:1px solid var(--line);border-radius:6px;max-height:300px;overflow:auto;background:var(--bg)}.annotation-file-picker>header{display:flex;justify-content:space-between;align-items:center;padding:12px 15px;border-bottom:1px solid var(--line);font-size:13px}.annotation-file-picker .btn{font-size:12px;min-height:30px}.annotation-panel-v2>.inline-form{flex-wrap:wrap}.annotation-panel-v2>.inline-form>.field{min-width:200px}
</style>

<style scoped>
.sample-review-filter{margin:0 14px 8px;width:calc(100% - 28px);font-size:12px;padding:8px;min-width:0;background:var(--surface);color:var(--text);border:1px solid var(--line);border-radius:4px}.sample-review-progress{margin:0 15px 12px;font-size:11px;color:var(--muted)}.sample-review-badge{font-size:10px!important;color:var(--accent);flex-shrink:0;padding:2px 5px;border:1px solid var(--line);border-radius:4px}.sample-next-actions{display:flex;gap:5px;flex-shrink:0}.sample-next-actions .btn{font-size:12px;min-height:30px;padding:5px 8px}.sample-list>button>span:nth-child(2){flex:1;min-width:0}
</style>

<style scoped>.associated-file-link{display:inline-flex;margin:8px 20px 14px;color:var(--accent);font-size:12px;text-decoration:underline;text-underline-offset:4px}</style>

<style scoped>
@media(min-width:1101px){.sample-sidebar{position:sticky;top:88px;align-self:start;max-height:calc(100vh - 104px);overflow:hidden}.sample-list{min-height:0;overflow:auto}}
</style>
