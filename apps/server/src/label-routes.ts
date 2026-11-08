import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { LabelDocument, LabelSnapshotExport } from '../../../packages/shared/src/index.js';
import { LabelService, assignmentInputSchema, labelColumnSchema } from './labels.js';
import type { Provider, RepoKey } from './provider.js';
import { safeRef, safeSegment } from './safety.js';
import { listLabelTemplates } from './label-templates.js';

const reference = z.string().min(1).max(160).transform(safeRef);
const write = z.object({ ref: reference, expectedCommit: reference, message: z.string().trim().min(1).max(4000).optional() });
const base = '/api/repos/:namespace/:repo/labels';
function key(request: FastifyRequest): RepoKey { const value = z.object({ namespace: z.string().transform(safeSegment), repo: z.string().transform(safeSegment) }).parse(request.params); return { namespace: value.namespace, repo: value.repo }; }

export function registerLabelRoutes(app: FastifyInstance, provider: Provider): LabelService {
  const labels = new LabelService(provider);
  app.get('/api/label-templates', () => listLabelTemplates());
  app.get(base, request => { const input = z.object({ ref: reference.default('main') }).parse(request.query); return labels.read(key(request), input.ref); });
  app.get(`${base}/export`, async (request, reply) => {
    const input = z.object({ ref: reference.default('main') }).strict().parse(request.query), repository = key(request);
    // read() resolves a branch once and reads both labels and legacy counts at that fixed commit.
    const state = await labels.read(repository, input.ref);
    const snapshot: LabelSnapshotExport = {
      format: 'oxen-web-label-snapshot', version: 1, ...repository, ref: input.ref, fixedCommitId: state.commitId,
      exportedAt: new Date().toISOString(), storagePath: state.storagePath,
      document: { version: 1, columns: state.columns, assignments: state.assignments, ...(state.templateApplications ? { templateApplications: state.templateApplications } : {}), ...(state.legacyMigration ? { legacyMigration: state.legacyMigration } : {}) },
      legacy: { unmigratedCount: state.legacyCount },
    };
    const commitPart = state.commitId.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 64) || 'snapshot';
    const filename = `oxen-labels-${repository.namespace.slice(0, 40)}-${repository.repo.slice(0, 60)}-${commitPart}.json`;
    return reply.type('application/json; charset=utf-8').header('Content-Disposition', `attachment; filename="${filename}"`).send(`${JSON.stringify(snapshot, null, 2)}\n`);
  });
  app.put(base, request => {
    const input = write.extend({ version: z.literal(1).optional(), columns: z.array(labelColumnSchema).max(100), assignments: z.array(assignmentInputSchema.extend({ id: z.string().optional() })).max(20_000) }).parse(request.body);
    const document: LabelDocument = { version: 1, columns: input.columns, assignments: input.assignments.map(assignment => ({ ...assignment, id: assignment.id ?? 'assigned-by-server' })) };
    return labels.save(key(request), input.ref, input.expectedCommit, document, input.message);
  });
  app.post(`${base}/columns`, request => { const input = write.extend({ column: labelColumnSchema }).parse(request.body); return labels.upsertColumn(key(request), input.ref, input.expectedCommit, input.column, input.message); });
  app.delete(`${base}/columns/:columnId`, request => { const input = write.parse(request.body), columnId = z.string().min(1).max(64).parse((request.params as { columnId: string }).columnId); return labels.deleteColumn(key(request), input.ref, input.expectedCommit, columnId, input.message); });
  app.post(`${base}/assignments`, request => {
    const input = write.extend({ scope: assignmentInputSchema.shape.scope, path: assignmentInputSchema.shape.path, rowId: assignmentInputSchema.shape.rowId, values: assignmentInputSchema.shape.values }).parse(request.body);
    return labels.assign(key(request), input.ref, input.expectedCommit, { scope: input.scope, ...(input.path !== undefined ? { path: input.path } : {}), ...(input.rowId !== undefined ? { rowId: input.rowId } : {}), values: input.values }, input.message);
  });
  app.post(`${base}/migrate`, request => { const input = write.parse(request.body); return labels.migrate(key(request), input.ref, input.expectedCommit, input.message); });
  app.post(`${base}/templates/apply`, request => {
    const input = z.object({ ref: reference, expectedCommit: reference, templateId: z.string().min(1).max(80), templateVersion: z.number().int().min(1), selectedKeys: z.array(z.string().min(1).max(96)).max(100).optional() }).strict().parse(request.body);
    return labels.applyTemplate(key(request), input.ref, input.expectedCommit, input.templateId, input.templateVersion, input.selectedKeys);
  });
  return labels;
}
