<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue';
import {APPLICATION_VERSION} from '../../../packages/shared/src/version';
import { useRoute, useRouter } from 'vue-router';
import {useQueryClient} from '@tanstack/vue-query';
import { ArrowUpRight, Check, ChevronDown, CircleHelp, FolderGit2, Globe2, KeyRound, LoaderCircle, LogOut, Search, Server, X } from 'lucide-vue-next';
import type { RepoSummary } from '@oxen/shared';
import { useAppStore } from './stores/app';
import { request } from './api';
import IdentityDialog from './components/IdentityDialog.vue';
import KeyboardHelp from './components/KeyboardHelp.vue';
import OperationIssueBanner from './components/OperationIssueBanner.vue';
import {createContextLoadGate,routedAccessContext,watchCredentialContext} from './access-context';
import {operationIssue} from './operation-errors';
const app=useAppStore(),route=useRoute(),router=useRouter(),cache=useQueryClient();
const showConnection=ref(false),showIdentity=ref(false),showSearch=ref(false),initializing=ref(true);
const showKeyboardHelp=ref(false),accessCapabilities=ref({canManageAccess:false,canReadAudit:false});
const projectMenu=ref<HTMLDetailsElement|null>(null),searchInput=ref<HTMLInputElement|null>(null);
const projects=ref<RepoSummary[]>([]),projectsLoading=ref(false),projectsError=ref(''),search=ref('');
const canManageLabels=ref(false),governanceGate=createContextLoadGate(()=>app.status?.identity),accessGate=createContextLoadGate(()=>app.status?.identity),projectsGate=createContextLoadGate(()=>app.status?.identity);
const canManageFields=ref(false);
const pageContext=computed(()=>routedAccessContext(app.status?.identity,route.name,route.params.namespace,route.params.repo));
const connected=computed(()=>app.status?.ready===true);
const publicRoute=computed(()=>route.name==='explore'||route.path.startsWith('/repos/'));
const needsLogin=computed(()=>app.status!==null&&!app.status.authenticated&&!publicRoute.value);
const identityName=computed(()=>app.status?.identity?.name||(app.status?.authenticated?'已登录用户':'公开访客'));
const identityInitial=computed(()=>identityName.value.slice(0,1).toUpperCase());
const identityKind=computed(()=>app.status?.identity?.kind==='owner'?'实例所有者':app.status?.identity?.kind==='collaborator'?'协作者':'访客');
const currentProjectName=computed(()=>projects.value.find(item=>item.name===route.params.repo&&item.namespace===route.params.namespace)?.displayName||route.params.repo||'项目工作空间');
const filteredProjects=computed(()=>projects.value.filter(item=>`${item.displayName??''} ${item.namespace}/${item.name} ${item.description}`.toLowerCase().includes(search.value.toLowerCase())));
async function openIdentityDialog(){if(await app.checkDraftGuards())showIdentity.value=true;}
provide('openIdentityDialog',openIdentityDialog);
async function loadGovernanceAccess(){const current=governanceGate.begin();if(!app.status?.authenticated){canManageLabels.value=false;canManageFields.value=false;return;}const results=await Promise.allSettled([request<{canManage:boolean}>('/governance/access'),request<{canManage:boolean}>('/global-fields/access')]);if(!governanceGate.accepts(current))return;canManageLabels.value=results[0].status==='fulfilled'&&results[0].value.canManage;canManageFields.value=results[1].status==='fulfilled'&&results[1].value.canManage;}
async function loadAccessCapabilities(){const current=accessGate.begin();if(!app.status?.authenticated){accessCapabilities.value={canManageAccess:false,canReadAudit:false};return;}try{const value=await request<{canManageAccess:boolean;canReadAudit:boolean}>('/access-management/capabilities');if(accessGate.accepts(current))accessCapabilities.value=value;}catch{if(accessGate.accepts(current))accessCapabilities.value={canManageAccess:false,canReadAudit:false};}}
async function loadProjects(){const current=projectsGate.begin();projectsLoading.value=true;projectsError.value='';try{const value=await request<RepoSummary[]>(app.status?.authenticated?'/repos':'/repos?public=true');if(projectsGate.accepts(current))projects.value=value;}catch(error){if(projectsGate.accepts(current))projectsError.value=(error as Error).message;}finally{if(projectsGate.accepts(current))projectsLoading.value=false;}}
provide('refreshProjectList',loadProjects);
function projectLink(repo:RepoSummary){return `/repos/${encodeURIComponent(repo.namespace)}/${encodeURIComponent(repo.name)}/overview`;}
function projectToggled(){if(projectMenu.value?.open)void loadProjects();}
function closeProjectMenu(){if(projectMenu.value)projectMenu.value.open=false;}
function outsideProjectMenu(event:MouseEvent){if(projectMenu.value?.open&&!projectMenu.value.contains(event.target as Node))closeProjectMenu();}
function openSearch(){closeProjectMenu();showSearch.value=true;search.value='';void loadProjects();}
async function chooseProject(repo:RepoSummary){showSearch.value=false;closeProjectMenu();await router.push(projectLink(repo));}
function hotkeys(event:KeyboardEvent){
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){
    const modalOpen=Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"],[role="alertdialog"]')).some(element=>element.getClientRects().length>0);
    if(modalOpen&&!showSearch.value)return;
    event.preventDefault();
    if(showSearch.value)searchInput.value?.focus();else openSearch();
  }
  if(event.key==='Escape'&&!app.confirmation){showSearch.value=false;closeProjectMenu();}
}
watch(showSearch,value=>{if(value)requestAnimationFrame(()=>searchInput.value?.focus());});
watch(()=>route.fullPath,closeProjectMenu);
watchCredentialContext(()=>app.status?.identity,()=>{
  projectsGate.invalidate();governanceGate.invalidate();accessGate.invalidate();
  projects.value=[];projectsError.value='';canManageLabels.value=false;canManageFields.value=false;accessCapabilities.value={canManageAccess:false,canReadAudit:false};
  showSearch.value=false;search.value='';closeProjectMenu();operationIssue.value=undefined;app.toast='';app.answerConfirmation(false);
  // Cancel before removal so a previous credential's pending query cannot repopulate this cache.
  void cache.cancelQueries();cache.removeQueries();
  void loadGovernanceAccess();void loadAccessCapabilities();void loadProjects();
});
watch(()=>route.path,loadGovernanceAccess);
watch(()=>route.query.notice,value=>{if(value==='label-management-denied')app.notify('当前身份没有标签规范管理权限。');},{immediate:true});
watch(()=>route.query.notice,value=>{if(value==='field-management-denied')app.notify('当前身份没有全局字段管理权限。');},{immediate:true});
watch(()=>route.query.notice,value=>{if(value==='access-management-denied')app.notify('当前身份没有访问管理权限。');if(value==='audit-denied')app.notify('当前身份没有全局日志查看权限。');},{immediate:true});
onMounted(async()=>{window.addEventListener('keydown',hotkeys);document.addEventListener('click',outsideProjectMenu);await app.refreshStatus();initializing.value=false;});
onBeforeUnmount(()=>{projectsGate.invalidate();governanceGate.invalidate();accessGate.invalidate();window.removeEventListener('keydown',hotkeys);document.removeEventListener('click',outsideProjectMenu);});
async function identitySwitched(){showIdentity.value=false;await app.refreshStatus();await nextTick();location.reload();}
async function logout(){if(!await app.checkDraftGuards())return;await request('/session',{method:'DELETE'});await app.refreshStatus();await nextTick();location.assign('/explore');}
</script>
<template>
  <div class="app-shell">
    <header class="global-header"><div class="global-header-inner">
      <RouterLink to="/" class="product-brand" aria-label="Oxen Web 首页"><svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M4 6c-1 7 2 10 7 10m17-10c1 7-2 10-7 10M10 14l3-3h6l3 3-2 12-4 3-4-3-2-12Z" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/></svg><span>OXEN<span class="product-brand-suffix">.WEB</span></span></RouterLink>
      <span class="header-separator"></span>
      <details ref="projectMenu" class="top-project-switch" @toggle="projectToggled"><summary aria-label="切换项目"><FolderGit2 :size="16"/><span>{{currentProjectName}}</span><ChevronDown :size="14"/></summary><div class="project-switch-menu"><div class="dropdown-heading">切换项目<span>{{projects.length}}</span></div><div v-if="projectsLoading" class="dropdown-state"><LoaderCircle class="spin" :size="16"/>正在读取项目…</div><p v-else-if="projectsError" class="dropdown-state">{{projectsError}}</p><div v-else class="project-switch-list"><RouterLink v-for="item in projects" :key="item.namespace+'/'+item.name" :to="projectLink(item)" :class="{selected:route.params.repo===item.name&&route.params.namespace===item.namespace}"><FolderGit2 :size="16"/><span><strong>{{item.displayName||item.name}}</strong><small>{{item.namespace}}</small></span><Check v-if="route.params.repo===item.name&&route.params.namespace===item.namespace" :size="15"/></RouterLink><p v-if="!projects.length" class="dropdown-state">暂无可访问项目</p></div><RouterLink to="/" class="dropdown-footer"><FolderGit2 :size="15"/>查看全部项目<ArrowUpRight :size="14"/></RouterLink><RouterLink to="/explore" class="dropdown-footer"><Globe2 :size="15"/>浏览公开项目<ArrowUpRight :size="14"/></RouterLink></div></details>
      <nav class="global-nav" aria-label="主导航"><RouterLink to="/" :class="{active:route.path==='/'||route.path.startsWith('/repos/')}">项目</RouterLink><RouterLink to="/explore" :class="{active:route.name==='explore'}">公开项目</RouterLink><RouterLink v-if="canManageLabels" to="/labels" :class="{active:route.name==='labels'}">标签管理</RouterLink><RouterLink v-if="canManageFields" to="/fields" :class="{active:route.name==='fields'}">字段管理</RouterLink><RouterLink v-if="accessCapabilities.canManageAccess" to="/access" :class="{active:route.name==='access'}">访问管理</RouterLink><RouterLink v-if="accessCapabilities.canReadAudit" to="/activity" :class="{active:route.name==='activity'}">操作日志</RouterLink></nav>
      <div class="global-header-actions"><button class="global-search-trigger" aria-label="搜索项目" @click="openSearch"><Search :size="17"/><span>搜索项目</span><kbd>Ctrl K</kbd></button><button class="connection-status" :class="{online:connected}" aria-label="服务连接" @click="showConnection=true"><span class="status-dot"></span><span>{{connected?'已连接':'未连接'}}</span></button><button class="account-trigger" aria-label="切换身份" @click="openIdentityDialog"><span class="avatar">{{identityInitial}}</span><span><strong>{{identityName}}</strong><small>{{identityKind}}</small></span><ChevronDown :size="14"/></button></div>
    </div><nav class="compact-global-nav" aria-label="窄屏主导航"><RouterLink to="/" :class="{active:route.path==='/'||route.path.startsWith('/repos/')}">项目</RouterLink><RouterLink to="/explore" :class="{active:route.name==='explore'}">公开项目</RouterLink><RouterLink v-if="canManageLabels" to="/labels" :class="{active:route.name==='labels'}">标签管理</RouterLink><RouterLink v-if="canManageFields" to="/fields" :class="{active:route.name==='fields'}">字段管理</RouterLink><RouterLink v-if="accessCapabilities.canManageAccess" to="/access" :class="{active:route.name==='access'}">访问管理</RouterLink><RouterLink v-if="accessCapabilities.canReadAudit" to="/activity" :class="{active:route.name==='activity'}">操作日志</RouterLink></nav></header>
    <div v-if="app.status?.mode==='demo'" class="demo-banner">演示工作空间 · 当前内容保存在独立演示数据中。</div>
    <main class="main-shell">
      <OperationIssueBanner/>
      <section v-if="initializing" class="app-state empty" role="status"><LoaderCircle class="spin" :size="28"/><h2>正在连接工作空间</h2><p>读取服务状态与当前身份…</p></section>
      <section v-else-if="app.statusError" class="app-state empty"><Server :size="36"/><h2>无法连接工作空间</h2><p>{{app.statusError}}</p><button class="btn" @click="app.refreshStatus">重新连接</button></section>
      <section v-else-if="needsLogin" class="auth-page panel"><KeyRound :size="32"/><span class="eyebrow">YOUR DATA WORKSPACE</span><h1>登录你的工作空间</h1><p class="muted">使用已获授权的身份，管理项目、审阅数据并与团队协作。</p><button class="btn btn-primary auth-switch" @click="openIdentityDialog"><KeyRound :size="16"/>登录或切换身份</button><RouterLink to="/explore" class="public-explore-link"><Globe2 :size="15"/>浏览公开项目</RouterLink></section>
      <RouterView v-else v-slot="{Component}"><component :is="Component" :key="pageContext"/></RouterView>
    </main>
    <footer class="main-footer"><RouterLink to="/" class="footer-product">OXEN.WEB <span>本地数据协作工作空间</span></RouterLink><div><button @click="showKeyboardHelp=true">操作帮助</button><RouterLink v-if="app.status?.authenticated" to="/operations">操作核对</RouterLink><a href="https://docs.oxen.ai" target="_blank" rel="noreferrer">使用文档<ArrowUpRight :size="13"/></a><button @click="showConnection=true">服务状态<span class="status-dot" :class="{online:connected}"></span></button><span>v{{app.status?.version||APPLICATION_VERSION}}</span></div></footer>
    <IdentityDialog v-if="showIdentity" :identity="app.status?.identity" @close="showIdentity=false" @switched="identitySwitched"/>
    <KeyboardHelp v-if="showKeyboardHelp" @close="showKeyboardHelp=false"/>
    <div v-if="showSearch" class="modal-backdrop search-backdrop" @click.self="showSearch=false"><section class="project-search-dialog" role="dialog" aria-modal="true" aria-label="搜索项目" @keydown.esc="showSearch=false"><header><Search :size="21"/><input ref="searchInput" v-model="search" aria-label="搜索项目名称或描述" placeholder="搜索项目名称、命名空间或描述…"/><button class="icon-button" aria-label="关闭搜索" @click="showSearch=false"><X :size="19"/></button></header><div v-if="projectsLoading" class="empty"><LoaderCircle class="spin" :size="21"/>正在读取项目…</div><p v-else-if="projectsError" class="error-state">{{projectsError}}</p><div v-else class="project-search-results"><button v-for="item in filteredProjects" :key="item.namespace+'/'+item.name" @click="chooseProject(item)"><FolderGit2 :size="19"/><span><strong>{{item.displayName||item.name}}</strong><small>{{item.namespace}} · {{item.description||'暂无项目描述'}}</small></span><ArrowUpRight :size="16"/></button><div v-if="!filteredProjects.length" class="empty"><Search :size="26"/><h3>没有匹配的项目</h3><p>试试其他名称或关键词。</p></div></div><footer><span>{{filteredProjects.length}} 个可访问项目</span><span><kbd>Esc</kbd> 关闭</span></footer></section></div>
    <div v-if="app.confirmation" class="modal-backdrop action-confirmation" @keydown.esc.prevent="app.answerConfirmation(false)"><section class="modal" role="alertdialog" aria-modal="true" aria-labelledby="action-confirm-title" aria-describedby="action-confirm-message"><div class="panel-header"><h2 id="action-confirm-title">{{app.confirmation.title}}</h2><button class="icon-button" aria-label="取消操作" @click="app.answerConfirmation(false)"><X :size="19"/></button></div><p id="action-confirm-message" class="notice">{{app.confirmation.message}}</p><div class="modal-actions"><button class="btn" autofocus @click="app.answerConfirmation(false)">{{app.confirmation.cancelLabel}}</button><button class="btn btn-primary" @click="app.answerConfirmation(true)">{{app.confirmation.confirmLabel}}</button></div></section></div>
    <Transition name="toast"><div v-if="app.toast" class="toast-message" role="status"><Check :size="17"/>{{app.toast}}<button aria-label="关闭提示" @click="app.toast=''"><X :size="15"/></button></div></Transition>
    <div v-if="showConnection" class="modal-backdrop" @click.self="showConnection=false"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="connection-title"><div class="panel-header"><div><h2 id="connection-title">服务连接</h2><p>当前工作空间的连接与可用能力</p></div><button class="icon-button" aria-label="关闭" @click="showConnection=false"><X :size="19"/></button></div><dl class="connection-details"><dt>运行模式</dt><dd>{{app.status?.mode==='demo'?'独立演示':'本地 Oxen 服务'}}</dd><dt>服务地址</dt><dd class="mono">{{app.status?.upstream||'尚未配置'}}</dd><dt>连接状态</dt><dd><span class="connection-badge" :class="{online:connected}"><span class="status-dot"></span>{{connected?'服务已就绪':'等待连接'}}</span></dd><dt>当前身份</dt><dd>{{identityName}} · {{identityKind}}</dd></dl><details class="connection-capabilities"><summary><CircleHelp :size="15"/>查看服务能力说明</summary><p v-for="(reason,key) in app.status?.capabilities.reasons" :key="key" class="notice">{{reason}}</p></details><div class="modal-actions"><button v-if="app.status?.authenticated" class="btn btn-ghost" @click="logout"><LogOut :size="15"/>退出会话</button><button class="btn btn-primary" @click="app.refreshStatus">刷新连接</button></div></section></div>
  </div>
</template>

<style scoped>
.compact-global-nav{display:none}@media(max-width:850px){.global-header{height:auto}.global-header-inner{height:62px}.compact-global-nav{display:flex;gap:26px;padding:0 24px;height:40px;overflow:auto;border-top:1px solid var(--line)}.compact-global-nav>a{display:flex;align-items:center;white-space:nowrap;font-size:12px;color:var(--muted);border-bottom:2px solid transparent}.compact-global-nav>a.active{color:var(--text);border-color:var(--primary)}}@media(max-width:650px){.compact-global-nav{padding:0 17px}}
</style>
