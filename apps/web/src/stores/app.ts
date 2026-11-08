import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { AppStatus } from '@oxen/shared';
import { request, post } from '../api';
export const useAppStore = defineStore('app', () => {
  const status = ref<AppStatus | null>(null);
  const statusError = ref('');
  const toast = ref('');
  const confirmation = ref<{message:string;title:string;confirmLabel:string;cancelLabel:string}>();
  let confirmationResolver: ((value:boolean)=>void)|undefined;
  let timer: ReturnType<typeof setTimeout>;
  const draftGuards = new Set<() => Promise<boolean>>();
  function registerDraftGuard(guard:()=>Promise<boolean>){draftGuards.add(guard);return()=>draftGuards.delete(guard);}
  async function checkDraftGuards(){for(const guard of draftGuards)if(!await guard())return false;return true;}
  const notify = (message:string) => { toast.value=message; clearTimeout(timer); timer=setTimeout(()=>toast.value='',5000); };
  async function refreshStatus() { try { status.value=await request<AppStatus>('/status'); statusError.value=''; } catch(e) { statusError.value=(e as Error).message; } }
  async function login(token:string) { await post('/session', {token}); await refreshStatus(); }
  function confirmAction(message:string,options:{title?:string;confirmLabel?:string;cancelLabel?:string}={}) {
    if(confirmationResolver)return Promise.resolve(false);
    confirmation.value={message,title:options.title??'确认操作',confirmLabel:options.confirmLabel??'继续',cancelLabel:options.cancelLabel??'取消'};
    return new Promise<boolean>(resolve=>{confirmationResolver=resolve;});
  }
  function answerConfirmation(value:boolean){const resolve=confirmationResolver;confirmationResolver=undefined;confirmation.value=undefined;resolve?.(value);}
  return {status,statusError,toast,confirmation,notify,refreshStatus,login,confirmAction,answerConfirmation,registerDraftGuard,checkDraftGuards};
});
