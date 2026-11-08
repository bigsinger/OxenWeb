import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Provider } from './provider.js';
import { ApiError } from './errors.js';
import { safeFilePath, safeRef, safeSegment } from './safety.js';
import { inspectArchive } from './archive.js';

export function registerArchiveRoutes(app: FastifyInstance, provider: Provider) {
  app.get('/api/repos/:namespace/:repo/archive', async request => {
    const key = z.object({ namespace: z.string().transform(safeSegment), repo: z.string().transform(safeSegment) }).parse(request.params);
    const input = z.object({ ref: z.string().min(1).max(160).default('main').transform(safeRef), path: z.string().min(1).max(1024).transform(safeFilePath), entry: z.string().min(1).max(1024).optional() }).parse(request.query);
    if (!/\.zip$/i.test(input.path)) throw new ApiError(422, 'ARCHIVE_EXTENSION', '只支持 .zip 压缩包的只读查看。');
    const branches = await provider.branches(key);
    const commitId = branches.find(branch => branch.name === input.ref)?.commitId ?? (provider.resolveRef ? await provider.resolveRef(key,input.ref) : (await provider.commit(key, input.ref)).id);
    const raw = await provider.raw(key, commitId, input.path);
    return { ref: input.ref, commitId, path: input.path, ...await inspectArchive(raw.content, input.entry) };
  });
}
