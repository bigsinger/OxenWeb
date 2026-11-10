import type { ApiErrorBody } from '@oxen/shared';
import {operationIssue,tracksOperation} from './operation-errors';
export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number, public details?: unknown,public operationId?:string,public requestId?:string,public operationState?:string) { super(message); }
}
// A transport may retry an idempotent DELETE inside one fetch. Trust only this request's
// matching durable operation receipt; the same code on POST or without that receipt is unknown.
const confirmedDeleteResponses = new WeakSet<ApiError>();
export function isUnknownOperationError(error:unknown):error is ApiError{return error instanceof ApiError&&!confirmedDeleteResponses.has(error)&&error.operationState!=='failed'&&(error.status===0||error.status>=500||error.operationState==='reconciliation-required'||['NETWORK_RESULT_UNKNOWN','DELETE_RESULT_UNKNOWN','DELETE_RESPONSE_UNKNOWN','OPERATION_ALREADY_SUCCEEDED','OPERATION_RECONCILIATION_REQUIRED'].includes(error.code));}
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method=(options.method??'GET').toUpperCase(),headers=new Headers(options.headers);headers.set('X-Oxen-Request','web');
  if(options.body&&!(options.body instanceof FormData)&&!headers.has('Content-Type'))headers.set('Content-Type','application/json');
  const tracked=tracksOperation(path,method);if(tracked&&!headers.has('X-Operation-Id'))headers.set('X-Operation-Id',crypto.randomUUID());
  const abortedBeforeSend=options.signal?.aborted;let response:Response;
  try{response=await fetch(`/api${path}`,{credentials:'same-origin',...options,headers});}
  catch(error){if((error as Error).name==='AbortError'&&(method!=='DELETE'||abortedBeforeSend))throw error;if(tracked){const id=headers.get('X-Operation-Id')!;operationIssue.value={id,code:'NETWORK_RESULT_UNKNOWN',message:'网络连接中断，请核对操作结果后再继续。'};throw new ApiError('NETWORK_RESULT_UNKNOWN','网络中断，操作可能已执行；输入仍保留，请先核对结果。',0,undefined,id);}if(method==='DELETE'&&path.split('?')[0]!=='/session')throw new ApiError('DELETE_RESULT_UNKNOWN','删除结果尚未确认，操作可能已执行；请先刷新当前状态核对，不要直接再次删除。',0);throw error;}
  if (!response.ok) {
    const data = await response.json().catch(() => null) as ApiErrorBody | null;
    const id=response.headers.get('X-Operation-Id')??undefined,code=data?.error?.code??'REQUEST_FAILED',message=data?.error?.message??`请求失败 (${response.status})`,state=response.headers.get('X-Operation-State')??undefined;
    const failure=new ApiError(code,message,response.status,data?.error?.details,id,data?.error?.requestId,state);
    if(method==='DELETE'&&tracked&&id&&id===headers.get('X-Operation-Id')&&code==='OPERATION_ALREADY_SUCCEEDED'&&state==='succeeded'){confirmedDeleteResponses.add(failure);failure.message='服务端操作记录已确认删除或撤销完成，请刷新最新状态。';}
    else if(isUnknownOperationError(failure)){if(method==='DELETE')failure.message=code==='OPERATION_ALREADY_SUCCEEDED'?'收到操作已完成的提示，但缺少匹配的已确认状态；请读取当前状态核对。':'删除结果尚未确认，请先读取当前状态核对；未自动再次删除。'+message;if(id)operationIssue.value={id,code,message:failure.message};}
    throw failure;
  }
  if (response.status === 204) return undefined as T;
  try{return await response.json() as T;}catch(error){if(method!=='DELETE')throw error;const id=response.headers.get('X-Operation-Id')??undefined,failure=new ApiError('DELETE_RESPONSE_UNKNOWN','删除响应无法读取，请先核对当前状态；未自动再次删除。',response.status,undefined,id,undefined,response.headers.get('X-Operation-State')??undefined);if(id)operationIssue.value={id,code:failure.code,message:failure.message};throw failure;}
}
export const post = <T>(path: string, body: unknown = {}) => request<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const patch = <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
export const remove = <T>(path: string) => request<T>(path, { method: 'DELETE' });
export interface DeleteVerification<T>{readCurrent:()=>Promise<T>;isRemoved:(current:T)=>boolean;isCurrent?:()=>boolean}
export type DeleteOutcome<T>={state:'confirmed';via:'response'|'read';current?:T;operationId?:string}|{state:'unknown';error:ApiError;current?:T;verificationError?:Error;operationId?:string};
/** Recheck only. It never replays a DELETE, including when the latest read still shows the target. */
export async function verifyDeletion<T>(error:ApiError,options:DeleteVerification<T>):Promise<DeleteOutcome<T>>{
  const stale=()=>options.isCurrent?.()===false,unknown=(verificationError?:Error,current?:T):DeleteOutcome<T>=>({state:'unknown',error,operationId:error.operationId,...(current===undefined?{}:{current}),...(verificationError?{verificationError}:{})});
  const contextChanged=()=>{if(error.operationId&&operationIssue.value?.id===error.operationId)operationIssue.value=undefined;return unknown(new Error('身份或项目上下文已变化，未将旧操作的核对结果写入当前页面。'));};
  if(stale())return contextChanged();
  try{const current=await options.readCurrent();if(stale())return contextChanged();if(options.isRemoved(current)){if(error.operationId&&operationIssue.value?.id===error.operationId)operationIssue.value=undefined;return {state:'confirmed',via:'read',current,operationId:error.operationId};}return unknown(undefined,current);}catch(cause){if(stale())return contextChanged();return unknown(cause instanceof Error?cause:new Error('无法读取当前状态，删除结果仍未知。'));}
}
/** One destructive attempt, followed only by an authorized state read if its result is unknown. */
export async function removeAndVerify<T>(path:string,options:DeleteVerification<T>):Promise<DeleteOutcome<T>>{
  try{await remove(path);return {state:'confirmed',via:'response'};}catch(cause){if(cause instanceof ApiError&&confirmedDeleteResponses.has(cause)){if(options.isCurrent?.()===false)return verifyDeletion(cause,options);if(cause.operationId&&operationIssue.value?.id===cause.operationId)operationIssue.value=undefined;return {state:'confirmed',via:'response',operationId:cause.operationId};}if(!isUnknownOperationError(cause))throw cause;return verifyDeletion(cause,options);}
}
export const repoBase = (namespace: string, repo: string) => `/repos/${encodeURIComponent(namespace)}/${encodeURIComponent(repo)}`;
export const queryString = (values: Record<string, string | number | undefined>) => '?' + new URLSearchParams(Object.entries(values).filter(([,v])=>v !== undefined).map(([k,v])=>[k,String(v)])).toString();
