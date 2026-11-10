import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { ApiError } from './errors.js';
import {operationContext} from './operation-context.js';

export type Job = { id: string; operation: string; status: 'queued' | 'running' | 'succeeded' | 'failed'; createdAt: string; completedAt?: string; output: string; error?: string };
export interface CliOptions { binary: string; timeoutMs: number; maxOutputBytes: number }

export function runCli(args: string[], cwd: string, options: CliOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(options.binary, args, { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1', CLICOLOR: '0' } });
    let output = '';
    let bytes = 0;
    let failure: ApiError | undefined;
    const timer = setTimeout(() => { failure = new ApiError(504, 'CLI_TIMEOUT', 'Oxen CLI operation timed out.'); proc.kill(); }, options.timeoutMs);
    const append = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > options.maxOutputBytes) {
        failure = new ApiError(502, 'CLI_OUTPUT_LIMIT', 'Oxen CLI output exceeded its configured limit.');
        proc.kill();
      } else output += chunk.toString('utf8');
    };
    proc.stdout.on('data', append);
    proc.stderr.on('data', append);
    proc.once('error', (error) => { clearTimeout(timer); reject(new ApiError(503, 'CLI_UNAVAILABLE', error.message.includes('ENOENT') ? 'Oxen CLI is not installed or OXEN_CLI_BIN is invalid.' : 'Oxen CLI could not start.')); });
    proc.once('close', (code) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0) reject(new ApiError(409, 'CLI_FAILED', output.trim() || `Oxen CLI exited with code ${code}.`));
      else resolve(output.trim());
    });
  });
}

export class JobQueue {
  private jobs = new Map<string, Job>();
  private chains = new Map<string, Promise<void>>();
  constructor(private maximum = 500,private options:{runTask?:(task:()=>Promise<string>)=>Promise<string>;hold?:()=>()=>void}={}) {}

  add(key: string, operation: string, task: () => Promise<string>): Job {
    while (this.jobs.size >= this.maximum) {
      const completed = [...this.jobs].find(([, job]) => job.status === 'succeeded' || job.status === 'failed');
      if (!completed) throw new ApiError(429, 'JOB_LIMIT', 'Too many pending CLI operations.');
      this.jobs.delete(completed[0]);
    }
    const job: Job = { id: randomUUID(), operation, status: 'queued', createdAt: new Date().toISOString(), output: '' };
    const execution=operationContext.getStore(),release=this.options.hold?.();
    execution?.defer();
    this.jobs.set(job.id, job);
    const chain = (this.chains.get(key) ?? Promise.resolve()).then(async () => {
      job.status = 'running';
      try { job.output = await (this.options.runTask?this.options.runTask(task):task()); job.status = 'succeeded'; await execution?.complete({jobId:job.id}); }
      catch (error) { job.status = 'failed'; job.error = error instanceof Error ? error.message : 'CLI operation failed.'; await execution?.uncertain(error instanceof ApiError?error.code:'ASYNC_RESULT_UNKNOWN').catch(()=>{}); }
      finally{job.completedAt = new Date().toISOString();release?.();}
    });
    this.chains.set(key, chain);
    void chain.finally(() => { if (this.chains.get(key) === chain) this.chains.delete(key); });
    return { ...job };
  }

  get(id: string): Job {
    const job = this.jobs.get(id);
    if (!job) throw new ApiError(404, 'JOB_NOT_FOUND', 'Operation not found or expired.');
    return { ...job };
  }
}
