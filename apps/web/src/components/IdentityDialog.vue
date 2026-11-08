<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { KeyRound, LoaderCircle, LogOut, UserRound, X } from 'lucide-vue-next';
import type { RequestIdentity } from '@oxen/shared';
import { request } from '../api';
import { useAppStore } from '../stores/app';
const props = defineProps<{ identity?: RequestIdentity }>();
const emit = defineEmits<{ close: []; switched: [] }>();
const app = useAppStore();
const token = ref(''), passwordInput = ref<HTMLInputElement | null>(null), busy = ref(false), error = ref(''), localOwnerEnabled = ref(false);
const kind = computed(() => props.identity?.kind === 'owner' ? '实例所有者' : props.identity?.kind === 'collaborator' ? '协作者' : '公开访客');
function close() { if (!busy.value) { token.value = ''; emit('close'); } }
async function signIn(localOwner = false) {
  if (busy.value || !localOwner && !token.value.trim()) return;
  busy.value = true; error.value = '';
  try { await app.login(localOwner ? '' : token.value.trim()); token.value = ''; emit('switched'); }
  catch (cause) { error.value = (cause as Error).message; }
  finally { busy.value = false; }
}
async function signOut() {
  busy.value = true; error.value = '';
  try { await request('/session', { method: 'DELETE' }); token.value = ''; await app.refreshStatus(); emit('switched'); }
  catch (cause) { error.value = (cause as Error).message; }
  finally { busy.value = false; }
}
onMounted(async () => {
  await nextTick(); passwordInput.value?.focus();
  try { const state = await request<{ localOwnerEnabled: boolean }>('/session'); localOwnerEnabled.value = state.localOwnerEnabled; } catch { /* sign-in remains available if session details cannot be read */ }
});
onBeforeUnmount(() => { token.value = ''; });
</script>

<template>
  <div class="identity-backdrop" @click.self="close"><section class="identity-dialog" role="dialog" aria-modal="true" aria-labelledby="identity-title" @keydown.esc="close"><header><div><UserRound :size="21" /><h2 id="identity-title">切换访问身份</h2></div><button class="icon-button" :disabled="busy" aria-label="关闭身份对话框" @click="close"><X :size="19" /></button></header>
    <div class="identity-current"><span class="identity-avatar">{{ (identity?.name || '访客').slice(0, 1).toUpperCase() }}</span><div><strong>{{ identity?.name || '未登录访客' }}</strong><small>{{ kind }} · {{ identity?.source === 'local' ? '本机访问' : identity?.source === 'session' ? '浏览器会话' : identity?.source === 'bearer' ? '访问令牌' : '匿名访问' }}</small></div></div>
    <form @submit.prevent="signIn(false)"><p class="identity-description">使用所有者或管理员提供的访问令牌，进入已获授权的项目。</p><label class="field">访问令牌<input ref="passwordInput" v-model="token" type="password" autocomplete="off" spellcheck="false" placeholder="粘贴所有者或协作者令牌" maxlength="4096" required :disabled="busy" /></label><p v-if="error" class="identity-error" role="alert">{{ error }}</p><button class="btn btn-primary identity-submit" :disabled="busy || !token.trim()"><LoaderCircle v-if="busy" :size="15" class="spin" /><KeyRound v-else :size="15" /> 登录并切换身份</button></form>
    <div class="identity-other-actions"><button v-if="localOwnerEnabled && identity?.kind !== 'owner'" class="btn btn-ghost" :disabled="busy" @click="signIn(true)">使用本机所有者身份</button><button v-if="identity && identity.kind !== 'guest' && identity.source !== 'local'" class="btn btn-ghost" :disabled="busy" @click="signOut"><LogOut :size="14" />{{ localOwnerEnabled ? '退出当前会话' : '退出登录' }}</button><button class="btn btn-ghost" :disabled="busy" @click="close">取消</button></div><p v-if="localOwnerEnabled" class="identity-local-note">在本机访问时可使用本机所有者身份，退出当前会话后会恢复该身份。</p>
  </section></div>
</template>

<style scoped>
.identity-backdrop{position:fixed;inset:0;z-index:140;display:grid;place-items:center;background:#0009;backdrop-filter:blur(5px);padding:20px}.identity-dialog{width:100%;max-width:480px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--text);box-shadow:0 24px 80px #0008;max-height:calc(100vh - 40px);overflow:auto}.identity-dialog>header{padding:23px 26px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line)}.identity-dialog header>div{display:flex;align-items:center;gap:11px}.identity-dialog header>div>svg{color:var(--accent,var(--primary))}.identity-dialog h2{font-size:19px;font-weight:600;letter-spacing:-.3px}.identity-current{display:flex;align-items:center;gap:13px;margin:24px 26px 0;padding:15px;background:var(--surface-raised);border:1px solid var(--line);border-radius:6px}.identity-avatar{display:grid;place-items:center;width:39px;height:39px;flex-shrink:0;border-radius:50%;background:var(--bg);border:1px solid var(--line);color:var(--text);font-weight:600;font-size:14px}.identity-current strong{display:block;font-size:14px;color:var(--text);font-weight:550;overflow-wrap:anywhere}.identity-current small{display:block;font-size:11px;color:var(--muted);margin-top:6px}.identity-dialog form{padding:21px 26px 20px}.identity-description{font-size:13px;color:var(--muted);line-height:1.9;margin-bottom:22px}.identity-dialog .field{font-size:13px}.identity-dialog .field input{font-size:13px;min-height:41px}.identity-submit{width:100%;margin-top:5px;min-height:40px;font-size:13px}.identity-error{font-size:12px;color:var(--danger);border:1px solid color-mix(in srgb,var(--danger) 30%,var(--line));background:color-mix(in srgb,var(--danger) 6%,var(--surface));padding:12px 13px;border-radius:5px;margin-bottom:16px;overflow-wrap:anywhere;line-height:1.8}.identity-other-actions{display:flex;justify-content:flex-end;gap:7px;flex-wrap:wrap;padding:0 26px 22px}.identity-other-actions .btn{font-size:12px;padding:7px 11px;min-height:34px}.identity-local-note{font-size:11px;line-height:1.8;color:var(--muted);border-top:1px solid var(--line);padding:15px 26px;background:var(--bg)}@media(max-width:600px){.identity-dialog>header{padding:21px 20px}.identity-dialog form{padding:20px}.identity-current{margin:20px 20px 0}.identity-other-actions{padding:0 20px 20px}.identity-local-note{padding:14px 20px}}
</style>
