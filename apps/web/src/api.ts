import type { ApiErrorBody } from '@oxen/shared';
import {operationIssue,tracksOperation} from './operation-errors';
export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number, public details?: unknown,public operationId?:string,public requestId?:string) { super(message); }
}
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method=(options.method??'GET').toUpperCase(),headers=new Headers(options.headers);headers.set('X-Oxen-Request','web');
  if(options.body&&!(options.body instanceof FormData)&&!headers.has('Content-Type'))headers.set('Content-Type','application/json');
  const tracked=tracksOperation(path,method);if(tracked&&!headers.has('X-Operation-Id'))headers.set('X-Operation-Id',crypto.randomUUID());
  let response:Response;
  try{response=await fetch(`/api${path}`,{credentials:'same-origin',...options,headers});}
  catch(error){if((error as Error).name==='AbortError')throw error;if(tracked){const id=headers.get('X-Operation-Id')!;operationIssue.value={id,code:'NETWORK_RESULT_UNKNOWN',message:'网络连接中断，请核对操作结果后再继续。'};throw new ApiError('NETWORK_RESULT_UNKNOWN','网络中断，操作可能已执行；输入仍保留，请先核对结果。',0,undefined,id);}throw error;}
  if (!response.ok) {
    const data = await response.json().catch(() => null) as ApiErrorBody | null;
    const id=response.headers.get('X-Operation-Id')??undefined,code=data?.error?.code??'REQUEST_FAILED',message=data?.error?.message??`请求失败 (${response.status})`;
    if(id&&(response.status>=500||['OPERATION_ALREADY_SUCCEEDED','OPERATION_RECONCILIATION_REQUIRED'].includes(code)))operationIssue.value={id,code,message};
    throw new ApiError(code,message,response.status,data?.error?.details,id,data?.error?.requestId);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export const post = <T>(path: string, body: unknown = {}) => request<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const patch = <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
export const remove = <T>(path: string) => request<T>(path, { method: 'DELETE' });
export const repoBase = (namespace: string, repo: string) => `/repos/${encodeURIComponent(namespace)}/${encodeURIComponent(repo)}`;
export const queryString = (values: Record<string, string | number | undefined>) => '?' + new URLSearchParams(Object.entries(values).filter(([,v])=>v !== undefined).map(([k,v])=>[k,String(v)])).toString();
