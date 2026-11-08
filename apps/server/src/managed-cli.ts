import { lstat, mkdir, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Config } from './config.js';
import type { RepoKey } from './provider.js';
import { runCli } from './cli.js';
import { ApiError } from './errors.js';
import { inside, managedRepo, safeSegment } from './safety.js';
import { safeRef } from './safety.js';

export function cliOptions(config: Config) { return { binary: config.cliBin, timeoutMs: config.cliTimeoutMs, maxOutputBytes: 1024 * 1024 }; }
function normalizeRemote(input: string): string {
  const url = new URL(input);
  if (url.username || url.password || url.search || url.hash) throw new Error('Unexpected remote credentials or query.');
  return `${url.origin}${url.pathname.replace(/\/$/, '')}`;
}
export function expectedRemote(config: Config, key: RepoKey): string {
  if (!config.upstream) throw new ApiError(503, 'NOT_CONFIGURED', 'An Oxen server URL is required.');
  return `${config.upstream}/${encodeURIComponent(safeSegment(key.namespace))}/${encodeURIComponent(safeSegment(key.repo))}`;
}
export async function assertRemote(config: Config, key: RepoKey, cwd: string): Promise<void> {
  const output = await runCli(['remote', '-v'], cwd, cliOptions(config));
  const remote = output.split(/\r?\n/).map(line => line.trim().split(/\s+/)).find(parts => parts[0] === 'origin')?.[1];
  let matches = false;
  try { matches = !!remote && normalizeRemote(remote) === normalizeRemote(expectedRemote(config, key)); } catch { /* reject unparseable or credential-bearing remotes */ }
  if (!matches) throw new ApiError(409, 'REMOTE_MISMATCH', 'Managed clone origin does not match this Oxen server and repository. No write was executed.');
}
export async function assertClean(config: Config, cwd: string): Promise<void> {
  const output = await runCli(['status'], cwd, cliOptions(config));
  if (!/^nothing to commit, working tree clean\s*$/m.test(output)) throw new ApiError(409, 'CLONE_DIRTY', 'Managed clone has staged, modified, removed, or untracked files. Resolve those changes before a CLI operation.');
}
export async function localBranches(config: Config, cwd: string): Promise<Set<string>> {
  const output = await runCli(['branch'], cwd, cliOptions(config));
  return new Set(output.split(/\r?\n/).map(line => line.replace(/^\s*\*?\s*/, '').trim()).filter(name => /^[\w./-]+$/.test(name)));
}
export async function localBranchHead(config: Config, cwd: string, branch: string): Promise<string> {
  const output = await runCli(['log', '--revision', safeRef(branch), '-n', '1'], cwd, cliOptions(config));
  return parseLocalBranchHead(output);
}
export function parseLocalBranchHead(output: string): string {
  const first = output.replace(/\u001b\[[0-9;]*m/g, '').trimStart().split(/\r?\n/, 1)[0];
  // The pinned CLI emits full hexadecimal IDs without a fixed width; real API/CLI commits include 30-character IDs.
  const match = /^commit ([a-f0-9]{1,32})\s*$/.exec(first ?? '');
  if (!match) throw new ApiError(409, 'CLI_HEAD_UNKNOWN', 'The pinned Oxen CLI output did not identify the local branch head. No merge or push was executed.');
  return match[1]!;
}

// Called only while the provider's per-repository write lock is held.
export async function provisionClone(config: Config, key: RepoKey, branch: string): Promise<string> {
  const namespace = safeSegment(key.namespace), repo = safeSegment(key.repo);
  const existing = await lstat(path.join(config.cliRoot, namespace, repo)).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return null; });
  if (existing) {
    const cwd = await managedRepo(config.cliRoot, namespace, repo);
    await assertRemote(config, key, cwd);
    return cwd;
  }
  await mkdir(config.cliRoot, { recursive: true });
  const root = await realpath(config.cliRoot);
  const parentPath = path.join(root, namespace);
  await mkdir(parentPath, { recursive: true });
  const parent = await realpath(parentPath);
  if (!inside(root, parent) || parent === root) throw new ApiError(400, 'INVALID_PATH', 'Clone namespace resolves outside the managed root.');
  const temporary = path.join(parent, `.provision-${randomUUID()}`), destination = path.join(parent, repo);
  try {
    await runCli(['clone', expectedRemote(config, key), path.basename(temporary), '--branch', branch], parent, cliOptions(config));
    const actual = await realpath(temporary);
    if (!inside(root, actual) || actual !== temporary) throw new ApiError(400, 'INVALID_PATH', 'Provisioned clone resolved outside its expected location.');
    await assertRemote(config, key, actual);
    await rename(actual, destination);
    return managedRepo(config.cliRoot, namespace, repo);
  } catch (error) {
    // This exact UUID directory was created for this attempt; never remove a user-named clone.
    const resolved = await realpath(temporary).catch(() => null);
    if (resolved === temporary && inside(root, resolved)) await rm(resolved, { recursive: true, force: true });
    throw error;
  }
}
