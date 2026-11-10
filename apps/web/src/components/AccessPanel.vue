<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { Check, Copy, KeyRound, LoaderCircle, Plus, ShieldCheck, Trash2, Users } from 'lucide-vue-next';
import type { DatasetCapability, RepositoryAccessState, RepositoryRole, RepositoryTokenGrant } from '@oxen/shared';
import { type ApiError, patch, post, removeAndVerify, request, verifyDeletion } from '../api';
import { credentialContext } from '../access-context';
import { useAppStore } from '../stores/app';
const props = defineProps<{ base: string; enabled?: boolean }>();
const emit = defineEmits<{ changed: [] }>();
const app = useAppStore();
const state = ref<RepositoryAccessState | null>(null), loading = ref(false), busy = ref(false), error = ref('');
const revokeErrors = ref<Record<string, ApiError>>({}), revocationNotice = ref(''), needsRefresh = ref(false);
const contextKey = computed(() => JSON.stringify([props.base, props.enabled, credentialContext(app.status?.identity)]));
const writesBlocked = computed(() => busy.value || loading.value || needsRefresh.value);
const name = ref(''), role = ref<RepositoryRole>('viewer'), oneTimeToken = ref(''), copied = ref(false);
const roles: { value: RepositoryRole; label: string }[] = [{ value: 'viewer', label: '只读 · Viewer' }, { value: 'annotator', label: '标注 · Annotator' }, { value: 'editor', label: '编辑与标注 · Editor' }, { value: 'reviewer', label: '复核 · Reviewer' }, { value: 'lead', label: '数据集负责人 · Lead' }, { value: 'admin', label: '项目管理 · Admin' }];
const capabilities: {id:DatasetCapability;label:string}[]=[{id:'data.edit',label:'编辑样本正文'},{id:'dataset.assign',label:'填写项目标签'},{id:'annotation.assign',label:'填写样本 / 文件标签'},{id:'annotation.review',label:'独立复核'},{id:'tasks.manage',label:'分配任务'},{id:'schema.bind',label:'绑定已发布规范'},{id:'merge.execute',label:'执行合并'},{id:'release.manage',label:'管理 Release'},{id:'release.share',label:'创建分享'},{id:'release.hidden',label:'受限主库及隐藏评测访问（谨慎授予）'},{id:'data.export',label:'导出数据'},{id:'project.admin',label:'项目权限管理'}];
const memberCapabilities=ref<Record<string,DatasetCapability[]>>({});
const roleDefaults:Record<RepositoryRole,DatasetCapability[]>={viewer:['read','data.export'],annotator:['read','annotation.assign','data.export'],editor:['read','data.edit','annotation.assign','data.export'],reviewer:['read','annotation.review','data.export'],lead:['read','dataset.assign','tasks.manage','schema.bind','merge.execute','release.manage','release.share','data.export'],admin:['read',...capabilities.map(item=>item.id)]};
let sequence = 0, contextVersion = 0, mounted = true;
function applyPolicy(value: RepositoryAccessState) { state.value = value; memberCapabilities.value = Object.fromEntries(value.collaborators.map(member => [member.id, [...(member.capabilities ?? roleDefaults[member.role])]])); needsRefresh.value = false; }
async function load() {
  if (props.enabled === false) return;
  const current = ++sequence, context = contextKey.value, isCurrent = () => mounted && current === sequence && context === contextKey.value; loading.value = true; error.value = '';
  try {
    const value = await request<RepositoryAccessState>(props.base + '/access'); if (!isCurrent()) return;
    applyPolicy(value);
    for (const [id, failure] of Object.entries(revokeErrors.value)) {
      const outcome = await verifyDeletion(failure, { readCurrent: async () => value, isRemoved: policy => !policy.collaborators.some(member => member.id === id), isCurrent });
      if (!isCurrent()) return;
      if (outcome.state === 'confirmed') { delete revokeErrors.value[id]; revocationNotice.value = '已从最新访问策略核对，该协作者的令牌已不存在。'; }
    }
  }
  catch (cause) { if (isCurrent()) { error.value = (cause as Error).message; needsRefresh.value = true; } }
  finally { if (isCurrent()) loading.value = false; }
}
async function grant() {
  if (writesBlocked.value || !state.value) return;
  const context = contextKey.value, generation = contextVersion, base = props.base, isCurrent = () => mounted && generation === contextVersion && context === contextKey.value;
  busy.value = true; error.value = ''; revocationNotice.value = ''; copied.value = false; oneTimeToken.value = '';
  try {
    const value = await post<RepositoryTokenGrant>(base + '/access', { name: name.value.trim(), role: role.value, expectedCommit: state.value.commitId });
    if (!isCurrent()) return;
    oneTimeToken.value = value.token; name.value = ''; await load(); emit('changed');
  } catch (cause) { if (isCurrent()) { error.value = (cause as Error).message; needsRefresh.value = true; } }
  finally { if (isCurrent()) busy.value = false; }
}
async function update(id: string, value: string) {
  if (writesBlocked.value || !state.value || revokeErrors.value[id]) return;
  const context = contextKey.value, generation = contextVersion, base = props.base, isCurrent = () => mounted && generation === contextVersion && context === contextKey.value;
  busy.value = true; error.value = ''; revocationNotice.value = '';
  try { await patch(base + '/access/' + encodeURIComponent(id), { role: value, expectedCommit: state.value.commitId }); if (isCurrent()) { await load(); emit('changed'); } }
  catch (cause) { if (isCurrent()) { error.value = (cause as Error).message; needsRefresh.value = true; } }
  finally { if (isCurrent()) busy.value = false; }
}
async function revoke(id: string, recheck = false) {
  const member = state.value?.collaborators.find(item => item.id === id), previous = revokeErrors.value[id];
  if (!member || busy.value || (!recheck && (writesBlocked.value || previous)) || (recheck && !previous)) return;
  const context = contextKey.value, generation = contextVersion, base = props.base, commitId = state.value?.commitId, isCurrent = () => mounted && generation === contextVersion && context === contextKey.value;
  if (!recheck && !await app.confirmAction(`撤销 ${member.name} 的项目访问令牌？该令牌及其登录会话将立即失效。`, { title: '撤销项目访问', confirmLabel: '确认撤销' })) return;
  if (!isCurrent() || busy.value || (!recheck && state.value?.commitId !== commitId)) return;
  busy.value = true; error.value = ''; revocationNotice.value = '';
  const verification = { readCurrent: () => request<RepositoryAccessState>(base + '/access'), isRemoved: (policy: RepositoryAccessState) => !policy.collaborators.some(item => item.id === id), isCurrent };
  try {
    const outcome = recheck && previous ? await verifyDeletion(previous, verification) : await removeAndVerify(base + '/access/' + encodeURIComponent(id) + '?expectedCommit=' + encodeURIComponent(commitId ?? ''), verification);
    if (!isCurrent()) return;
    if (outcome.state === 'unknown') { revokeErrors.value[id] = outcome.error; error.value = '撤销结果尚未确认，已暂停对此令牌重复撤销。请核对最新访问策略。' + (outcome.verificationError ? ` ${outcome.verificationError.message}` : ''); return; }
    delete revokeErrors.value[id]; revocationNotice.value = outcome.via === 'read' ? '已从最新访问策略核对，该协作者的令牌已不存在。' : '协作者访问令牌已撤销。';
    if (outcome.current) applyPolicy(outcome.current);
    else if (state.value) { state.value = { ...state.value, collaborators: state.value.collaborators.filter(item => item.id !== id) }; needsRefresh.value = true; await load(); }
    if (!isCurrent()) return;
    app.notify(revocationNotice.value); emit('changed');
  }
  catch (cause) { if (isCurrent()) { error.value = (cause as Error).message; needsRefresh.value = true; } }
  finally { if (isCurrent()) busy.value = false; }
}
async function saveCapabilities(id: string, memberRole: RepositoryRole) {
  if (writesBlocked.value || !state.value || revokeErrors.value[id]) return;
  const context = contextKey.value, generation = contextVersion, base = props.base, isCurrent = () => mounted && generation === contextVersion && context === contextKey.value;
  busy.value = true; error.value = ''; revocationNotice.value = '';
  try { await patch(base + '/access/' + encodeURIComponent(id), { role: memberRole, capabilities: memberCapabilities.value[id], expectedCommit: state.value.commitId }); if (isCurrent()) { await load(); emit('changed'); } }
  catch (cause) { if (isCurrent()) { error.value = (cause as Error).message; needsRefresh.value = true; } }
  finally { if (isCurrent()) busy.value = false; }
}
async function copy() { try { await navigator.clipboard.writeText(oneTimeToken.value); copied.value = true; } catch { error.value = '无法自动复制，请手动选中并复制令牌。'; } }
watch(contextKey, () => { ++contextVersion; ++sequence; busy.value = false; loading.value = false; state.value = null; error.value = ''; revokeErrors.value = {}; revocationNotice.value = ''; needsRefresh.value = false; oneTimeToken.value = ''; copied.value = false; void load(); }, { immediate: true, flush: 'sync' });
onBeforeUnmount(() => { mounted = false; ++sequence; oneTimeToken.value = ''; });
</script>
<template>
  <article class="panel access-card" aria-label="协作访问控制">
    <header><Users :size="19" /><div><h3>用户与协作者</h3><p class="muted">管理项目成员，以及每位成员的访问权限。</p></div><span v-if="state" class="badge">{{state.collaborators.length+1}} 位成员</span></header>
    <div class="access-body">
      <p v-if="enabled!==false" class="notice">在<RouterLink to="/access">全局访问管理</RouterLink>为已有人员发放项目令牌、设置到期时间；在<RouterLink to="/account/tokens">我的访问令牌</RouterLink>核对已发放的摘要、轮换和撤销。项目成员的角色与独立能力仍可在下方维护。</p><p v-if="enabled === false" class="muted">仅仓库管理员可以管理成员与令牌。</p>
      <template v-else>
        <details class="access-note"><summary>本地身份与权限说明</summary><p>协作者使用独立令牌登录，访问策略由此 Web 服务执行，不修改 Oxen 云端权限。<span v-if="state?.localOwnerEnabled">当前为本机所有者兼容模式；协作者应使用自己的令牌。</span></p></details>
        <p v-if="revocationNotice" class="notice" role="status">{{ revocationNotice }}</p>
        <p v-if="needsRefresh && state" class="notice" role="status">请重新加载最新访问策略后再做权限变更，避免使用旧版本覆盖。<button class="btn btn-ghost" type="button" :disabled="loading || busy" @click="load">重新加载</button></p>
        <p v-if="error" class="error-state" role="alert">{{ error }} <button class="btn btn-ghost" type="button" @click="load">重新加载</button></p>
        <p v-if="loading && !state" class="muted" role="status"><LoaderCircle class="spinning" :size="16" /> 正在加载访问策略…</p>
        <template v-if="state">
          <form class="grant-form" @submit.prevent="grant"><label>协作者名称<input v-model="name" class="field" placeholder="例如 数据审核员" maxlength="120" required :disabled="writesBlocked" /></label><label>权限<select v-model="role" class="field" :disabled="writesBlocked"><option v-for="option in roles" :key="option.value" :value="option.value">{{ option.label }}</option></select></label><button class="btn btn-primary" :disabled="writesBlocked || !name.trim()"><LoaderCircle v-if="busy" class="spinning" :size="15" /><Plus v-else :size="15" />创建令牌</button></form>
          <div class="owner-row"><ShieldCheck :size="17" /><strong>实例所有者</strong><span>始终拥有管理权限</span></div>
          <div v-if="!state.collaborators.length" class="access-empty">还没有协作者。创建令牌后，由你自行交给对应使用者。</div>
          <div v-for="member in state.collaborators" :key="member.id" class="member-row">
            <div class="member-name"><strong>{{ member.name }}</strong><small class="mono">{{ member.id }}</small></div>
            <select class="field" :value="member.role" :aria-label="`${member.name}的权限`" :disabled="writesBlocked || !!revokeErrors[member.id]" @change="update(member.id, ($event.target as HTMLSelectElement).value)"><option v-for="option in roles" :key="option.value" :value="option.value">{{ option.label }}</option></select>
            <button v-if="revokeErrors[member.id]" type="button" class="btn" :disabled="busy || loading" :aria-label="`核对${member.name}的撤销结果`" @click="revoke(member.id, true)">核对撤销结果</button><button v-else type="button" class="btn revoke" :disabled="writesBlocked" :aria-label="`撤销${member.name}的访问令牌`" @click="revoke(member.id)"><Trash2 :size="15" />撤销</button><p v-if="revokeErrors[member.id]" class="notice" role="status">撤销结果尚未确认，未自动重复撤销。核对操作只读取当前状态。</p>
            <details class="member-capabilities"><summary>独立能力</summary><fieldset :disabled="writesBlocked || !!revokeErrors[member.id]"><label v-for="capability in capabilities" :key="capability.id"><input v-model="memberCapabilities[member.id]" type="checkbox" :value="capability.id"/>{{capability.label}}</label><button class="btn" type="button" @click="saveCapabilities(member.id,member.role)">保存能力</button></fieldset></details>
          </div>

          <p class="role-help">标注、正文编辑、复核、任务和发布可独立授权。项目管理不授予组织规范维护权；规范维护者由实例管理员在首页“标签管理”指定。</p>
        </template>
        <div v-if="oneTimeToken" class="token-box" role="status"><strong><KeyRound :size="16" />访问令牌仅显示这一次</strong><p>请复制并妥善保存。关闭此提示后无法再次查看，服务只保存令牌哈希。撤销后，已登录会话也会立即失效。</p><textarea :value="oneTimeToken" class="field mono" readonly rows="3" aria-label="一次性访问令牌" /><div><button class="btn" type="button" @click="copy"><Check v-if="copied" :size="15" /><Copy v-else :size="15" />{{ copied ? '已复制' : '复制令牌' }}</button><button class="btn btn-ghost" type="button" @click="oneTimeToken = ''">我已保存，关闭</button></div></div>
      </template>
    </div>
  </article>
</template>
<style scoped>
.access-card{margin-top:22px;overflow:hidden}
.access-card>header{padding:22px 25px;display:flex;align-items:center;gap:12px;background:var(--surface-raised);border-bottom:1px solid var(--line)}
.access-card h3{font-size:15px;margin:0 0 7px}
.access-card header p{font-size:13px;margin:0}
.access-body{padding:20px 25px}
.access-note{font-size:13px;line-height:1.7;color:var(--text);display:flex;align-items:flex-start;gap:8px;margin:0 0 15px}
.access-note svg{flex-shrink:0;margin-top:2px}
.owner-row{display:flex;gap:10px;align-items:center;background:var(--surface-raised);padding:14px;border-radius:6px;margin-bottom:10px;font-size:13px}
.owner-row span{margin-left:auto;color:var(--muted)}
.member-row{display:flex;align-items:center;gap:12px;padding:15px 0;border-bottom:1px solid var(--line)}
.member-name{flex:1;min-width:0}
.member-name strong{font-size:13px}
.member-name small{display:block;margin-top:6px;font-size:13px;color:var(--muted);overflow-wrap:anywhere}
.field{display:block;width:100%;min-height:38px;padding:9px 11px;border:1px solid var(--line);border-radius:6px;background:var(--surface);font-size:13px;color:var(--text)}
.member-row select{width:145px}
.revoke{color:var(--text);font-size:13px}
.grant-form{display:flex;align-items:flex-end;gap:12px;margin-top:22px}
.grant-form label{flex:1;font-size:13px;display:flex;flex-direction:column;gap:8px}
.grant-form label:nth-child(2){max-width:170px}
.grant-form button{white-space:nowrap;min-height:38px}
.role-help,.access-empty{font-size:13px;color:var(--muted);line-height:1.7}
.access-empty{padding:20px 0}
.token-box{margin-top:20px;padding:18px;border:1px solid var(--line);border-radius:8px;background:var(--surface-raised)}
.token-box>strong{display:flex;align-items:center;gap:8px;font-size:13px}
.token-box p{font-size:13px;line-height:1.7;color:var(--text)}
.token-box textarea{resize:none;overflow-wrap:anywhere;font-size:13px}
.token-box>div{display:flex;gap:12px;margin-top:12px}
.spinning{animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}
}
@media(max-width:640px){.access-body{padding:18px}
.grant-form{flex-wrap:wrap}
.grant-form label:first-child{flex-basis:100%}
.grant-form label:nth-child(2){max-width:none}
.member-row{flex-wrap:wrap}
.member-name{flex-basis:100%}
.owner-row span{display:none}
}
.access-card{margin-top:0}
.access-card>header{background:var(--surface);padding:24px;gap:13px}
.access-card>header>svg{color:var(--muted)}
.access-card>header .badge{margin-left:auto;font-size:12px}
.access-card h3{font-size:18px;color:var(--text)}
.access-card header p{font-size:13px;color:var(--muted);line-height:1.8}
.access-body{padding:24px}
.access-note{display:block;font-size:12px;color:var(--muted);margin-bottom:22px}
.access-note summary{cursor:pointer;user-select:none}
.access-note p{margin-top:10px;line-height:1.85}
.owner-row{background:var(--surface);border-bottom:1px solid var(--line);border-radius:0;padding:19px 0;margin:0;font-size:14px}
.owner-row>svg{width:32px;height:32px;padding:7px;border-radius:50%;color:var(--primary);background:color-mix(in srgb,var(--primary) 12%,var(--surface))}
.owner-row span{font-size:12px;color:var(--muted);padding:5px 8px;background:var(--surface-raised);border:1px solid var(--line);border-radius:5px}
.member-row{padding:18px 0;gap:18px}
.member-name strong{font-size:14px;color:var(--text)}
.member-name small{font-size:11px;color:var(--muted)}
.member-row select{font-size:13px;width:180px;min-height:38px;background:var(--surface-raised)}
.grant-form{margin-top:0;margin-bottom:24px;padding:20px;background:var(--surface-raised);border:1px solid var(--line);border-radius:6px;gap:14px}
.grant-form label{font-size:13px}
.grant-form input,.grant-form select{background:var(--surface);font-size:14px;min-height:40px}
.grant-form button{min-height:40px}
.role-help{font-size:12px;color:var(--muted);line-height:1.9;margin-top:18px}
.access-empty{font-size:13px;padding:24px 0;color:var(--muted)}
.revoke{color:var(--danger);font-size:12px}
.token-box{margin-top:24px;background:color-mix(in srgb,var(--primary) 7%,var(--surface));border-color:color-mix(in srgb,var(--primary) 35%,var(--line));padding:20px}
.token-box>strong{font-size:15px;color:var(--text)}
.token-box p{font-size:13px;color:var(--muted);margin:12px 0}
.token-box textarea{font-size:12px;background:var(--bg);color:var(--text);line-height:1.8}
@media(max-width:640px){.access-body,.access-card>header{padding:20px}
.grant-form{padding:16px}
.access-card>header .badge{display:none}
.member-row select{flex:1}
.grant-form label{font-size:13px}
}
.grant-form .field,.member-row>.field{margin:0}
.field:focus{outline:2px solid color-mix(in srgb,var(--primary) 55%,transparent);outline-offset:1px;border-color:var(--primary)}
.member-row{flex-wrap:wrap}.member-capabilities{flex-basis:100%;font-size:13px;color:var(--muted)}.member-capabilities summary{cursor:pointer}.member-capabilities fieldset{display:flex;gap:13px;flex-wrap:wrap;padding:15px 0;border:0}.member-capabilities label{display:flex;gap:6px;align-items:center}.member-capabilities input{accent-color:var(--primary)}

</style>
