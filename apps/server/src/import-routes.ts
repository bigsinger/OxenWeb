import type { FastifyInstance, FastifyRequest } from 'fastify';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { JsonlImportResult, JsonlValidationResult } from '../../../packages/shared/src/index.js';
import { ApiError } from './errors.js';
import { parseJsonl } from './jsonl.js';
import type { Provider, RepoKey } from './provider.js';
import { safeFilePath, safeRef, safeSegment } from './safety.js';
import { requestIdentity } from './auth.js';
import type { DatasetBeforeWrite } from '../../../packages/shared/src/dataset.js';

function legacyDestination(filename:string){
  const safe=safeFilePath(filename),normalized=safe.normalize('NFC').toLowerCase();
  if(/^(?:\.oxenweb|source|packages)(?:\/|$)/.test(normalized)||normalized==='bundle-manifest.json')throw new ApiError(403,'IMPORT_PROTECTED_PATH','旧 JSONL 导入不能写入托管规范、来源或附件目录，请使用数据编辑工作台的导入流程。');
  return safe;
}
async function exists(provider:Provider,key:RepoKey,reference:string,filename:string){try{await provider.raw(key,reference,filename);return true;}catch(error){if(error instanceof ApiError&&error.status===404)return false;if(error instanceof ApiError&&error.status===413)return true;throw error;}}
export async function assertLegacyJsonlImportTarget(provider:Provider,key:RepoKey,reference:string,filename:string){
  legacyDestination(filename);
  for(const marker of ['.oxenweb/dataset.json','.oxenweb/dataset/format.json','bundle-manifest.json'])if(await exists(provider,key,reference,marker))throw new ApiError(409,'IMPORT_DATASET_WORKBENCH_REQUIRED','此项目已配置数据集，请在数据编辑工作台导入或执行显式迁移。旧导入不会覆盖规范样本和标注。');
  if(await exists(provider,key,reference,filename))throw new ApiError(409,'IMPORT_FILE_EXISTS','旧 JSONL 导入只允许新增文件，不能覆盖已有文件。');
  const components=filename.split('/');let directory='';
  for(let index=0;index<components.length;index++){
    let entries;try{entries=await provider.tree(key,reference,directory);}catch(error){if(error instanceof ApiError&&error.status===404)break;throw error;}
    const part=components[index]!,entry=entries.find(item=>item.name.normalize('NFC').toLowerCase()===part.normalize('NFC').toLowerCase());
    if(!entry)break;
    if(entry.name!==part)throw new ApiError(409,'IMPORT_PATH_COLLISION','目标路径与已有路径存在大小写或 Unicode 冲突。');
    if(index===components.length-1||entry.kind!=='directory')throw new ApiError(409,'IMPORT_FILE_EXISTS','目标路径已有文件或目录，不能覆盖。');
    directory=entry.path;
  }
}

async function multipart(request: FastifyRequest) {
  let content: Buffer | undefined, filename = ''; const fields: Record<string, string> = {};
  for await (const part of request.parts({limits:{fileSize:64*1024*1024,files:1,fields:12}})) {
    if (part.type === 'file') { if (content) throw new ApiError(400, 'IMPORT_FILE_COUNT', '每次只能导入一个 JSONL 文件。'); filename = part.filename; content = await part.toBuffer(); if (part.file.truncated) throw new ApiError(413, 'UPLOAD_LIMIT', 'JSONL 文件不能超过 64 MiB。'); }
    else fields[part.fieldname] = String(part.value);
  }
  if (!content || !filename) throw new ApiError(400, 'FILE_REQUIRED', '请选择要导入的 JSONL 文件。');
  if (!/\.(jsonl|ndjson)$/i.test(filename)) throw new ApiError(422, 'JSONL_EXTENSION', '请选择 .jsonl 或 .ndjson 文件。');
  return { filename, content, fields, parsed: parseJsonl(content) };
}

export function registerImportRoutes(app: FastifyInstance, provider: Provider, authorizeImport?: (request: FastifyRequest, key: RepoKey, creating: boolean) => Promise<void>,options:{beforeWrite?:DatasetBeforeWrite;onRepositoryCreated?:(key:RepoKey)=>Promise<void>}={}) {
  const chains = new Map<string, Promise<void>>();
  app.post('/api/import/jsonl/validate', {bodyLimit:66*1024*1024}, async (request): Promise<JsonlValidationResult> => { const input = await multipart(request); return { filename: input.filename, rowCount: input.parsed.rows.length, columns: input.parsed.columns }; });
  app.post('/api/import/jsonl', {bodyLimit:66*1024*1024}, async (request): Promise<JsonlImportResult> => {
    const upload = await multipart(request);
    const input = z.object({ namespace: z.string().min(1).max(120).transform(safeSegment), repo: z.string().min(1).max(120).transform(safeSegment), branch: z.string().default('main').transform(safeRef), path: z.string().min(1).max(1024).optional(), createRepository: z.enum(['true', 'false']).default('false'), expectedCommit: z.string().optional().transform(value => value ? safeRef(value) : undefined), description: z.string().max(4000).default('') }).parse(upload.fields);
    const filename = legacyDestination(input.path || path.basename(upload.filename));
    if (!/\.(jsonl|ndjson)$/i.test(filename)) throw new ApiError(422, 'JSONL_EXTENSION', '目标路径必须以 .jsonl 或 .ndjson 结尾。');
    const lockName = `${input.namespace}/${input.repo}`, previous = chains.get(lockName) ?? Promise.resolve();
    const current = previous.then(async () => {
      const key = { namespace: input.namespace, repo: input.repo };
      const authorize=async()=>{await authorizeImport?.(request,key,input.createRepository==='true');await options.beforeWrite?.(key,requestIdentity(request),input.branch,[],'edit-content',{operations:[{op:'append',record:{}}]});};
      await authorize();
      if (input.createRepository === 'true') {await provider.createRepo({ namespace: input.namespace, name: input.repo, description: input.description });await options.onRepositoryCreated?.(key);}
      else if (!input.expectedCommit) throw new ApiError(400, 'IMPORT_EXPECTED_COMMIT', '导入现有仓库时需要 expectedCommit，避免覆盖其他人的新版本。');
      let branch = (await provider.branches(key)).find(branch => branch.name === input.branch);
      if (!branch && input.createRepository === 'true') { const repo = await provider.repo(key); await assertLegacyJsonlImportTarget(provider,key,repo.defaultBranch,filename); await authorize(); branch = await provider.createBranch(key, input.branch, repo.defaultBranch); }
      if (!branch) throw new ApiError(404, 'BRANCH_NOT_FOUND', '导入目标分支不存在。');
      const expectedCommit = input.createRepository === 'true' ? branch.commitId : input.expectedCommit!;
      if (expectedCommit !== branch.commitId) throw new ApiError(409, 'IMPORT_VERSION_CONFLICT', '目标分支已更新，请刷新版本后重新导入。');
      await assertLegacyJsonlImportTarget(provider,key,expectedCommit,filename);
      await authorize();
      const workspace = await provider.createWorkspace(key, `Import ${upload.filename.slice(0, 90)} ${randomUUID().slice(0, 8)}`, input.branch);
      if (workspace.baseCommitId && workspace.baseCommitId !== expectedCommit) throw new ApiError(409, 'IMPORT_VERSION_CONFLICT', '导入 workspace 的基准已变化，请重新导入。');
      let committed = false;
      try {
        await provider.writeWorkspace(key, workspace.id, filename, upload.content);
        const latest = (await provider.branches(key)).find(branch => branch.name === input.branch);
        if (latest?.commitId !== expectedCommit) throw new ApiError(409, 'IMPORT_VERSION_CONFLICT', '目标分支已更新，请刷新版本后重新导入。');
        await assertLegacyJsonlImportTarget(provider,key,expectedCommit,filename);
        await authorize();
        const commit = await provider.commitWorkspace(key, workspace.id, `Import ${upload.filename} (${upload.parsed.rows.length} JSONL rows)`, expectedCommit);
        committed = true;
        return { namespace: input.namespace, repo: input.repo, branch: input.branch, path: filename, commitId: commit.id, rowCount: upload.parsed.rows.length, columns: upload.parsed.columns };
      } finally { if (committed) await provider.deleteWorkspace(key, workspace.id).catch(() => {}); }
    });
    const settled = current.then(() => {}, () => {}); chains.set(lockName, settled); void settled.then(() => { if (chains.get(lockName) === settled) chains.delete(lockName); });
    return current;
  });
}
