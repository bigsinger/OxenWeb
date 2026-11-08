import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { ApiError } from './errors.js';

export function safeSegment(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}$/.test(value) || value === '.' || value === '..') {
    throw new ApiError(400, 'INVALID_NAME', 'Use letters, numbers, underscores, dots and dashes; start with a letter or number.');
  }
  return value;
}

export function safeFilePath(value: string): string {
  if (!value || /[\x00-\x1f:]/.test(value) || value.includes('\\') || value.startsWith('/')) {
    throw new ApiError(400, 'INVALID_PATH', 'A repository-relative file path is required.');
  }
  const parts = value.split('/');
  if (parts.some(p => p === '..' || p === '.' || p === '' || p.toLowerCase() === '.oxen' || p.toLowerCase() === '.git')) {
    throw new ApiError(400, 'INVALID_PATH', 'Paths cannot contain traversal or repository internals.');
  }
  return parts.join('/');
}

export function safeRef(value: string): string {
  if (!value || value.startsWith('-') || value.includes('..') || !/^[\w./-]{1,160}$/.test(value)) {
    throw new ApiError(400, 'INVALID_REF', 'Invalid branch or commit reference.');
  }
  return value;
}

export function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export async function managedRepo(root: string, namespace: string, repo: string): Promise<string> {
  const base = await realpath(root).catch(() => { throw new ApiError(503, 'CLI_ROOT_UNAVAILABLE', 'Configured CLI repository root is unavailable.'); });
  const target = await realpath(path.join(base, safeSegment(namespace), safeSegment(repo))).catch(() => {
    throw new ApiError(409, 'CLONE_REQUIRED', 'Provision this repository clone under the configured CLI repository root first.');
  });
  if (!inside(base, target) || target === base) throw new ApiError(400, 'INVALID_PATH', 'Repository resolves outside the configured root.');
  const metadata = await stat(path.join(target, '.oxen')).catch(() => null);
  if (!metadata?.isDirectory()) throw new ApiError(409, 'NOT_OXEN_REPOSITORY', 'Managed clone has no .oxen metadata.');
  const metadataPath = await realpath(path.join(target, '.oxen'));
  if (!inside(target, metadataPath)) throw new ApiError(400, 'INVALID_PATH', 'Repository metadata resolves outside the managed clone.');
  return target;
}
