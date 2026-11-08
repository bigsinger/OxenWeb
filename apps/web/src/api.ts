import type { ApiErrorBody } from '@oxen/shared';
export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number, public details?: unknown) { super(message); }
}
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, { credentials: 'same-origin', ...options,
    headers: { 'X-Oxen-Request': 'web', ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  if (!response.ok) {
    const data = await response.json().catch(() => null) as ApiErrorBody | null;
    throw new ApiError(data?.error?.code ?? 'REQUEST_FAILED', data?.error?.message ?? `请求失败 (${response.status})`, response.status, data?.error?.details);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export const post = <T>(path: string, body: unknown = {}) => request<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const patch = <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
export const remove = <T>(path: string) => request<T>(path, { method: 'DELETE' });
export const repoBase = (namespace: string, repo: string) => `/repos/${encodeURIComponent(namespace)}/${encodeURIComponent(repo)}`;
export const queryString = (values: Record<string, string | number | undefined>) => '?' + new URLSearchParams(Object.entries(values).filter(([,v])=>v !== undefined).map(([k,v])=>[k,String(v)])).toString();
