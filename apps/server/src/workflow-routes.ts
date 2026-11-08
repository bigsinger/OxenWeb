import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requestIdentity } from './auth.js';
import type { RepoKey } from './provider.js';
import { safeRef, safeSegment } from './safety.js';
import type { WorkflowService } from './workflow.js';

const reference = z.string().min(1).max(160).transform(safeRef);
const identityId = z.string().min(1).max(100);
const rowId = z.string().min(1).max(200);
const revision = z.number().int().positive();
const values = z.record(z.string().min(1).max(100), z.union([z.string().max(8000), z.array(z.string().min(1).max(120)).max(200)]));
export function registerWorkflowRoutes(app: FastifyInstance, workflows: WorkflowService) {
  const base = '/api/repos/:namespace/:repo';
  const key = (request: FastifyRequest): RepoKey => { const input = request.params as RepoKey; return { namespace: safeSegment(input.namespace), repo: safeSegment(input.repo) }; };
  const id = (request: FastifyRequest) => z.string().uuid().parse((request.params as { id: string }).id);
  app.get(`${base}/tasks`, request => workflows.list(key(request), requestIdentity(request)));
  app.post(`${base}/tasks`, async (request, reply) => {
    const input = z.object({ title: z.string().trim().min(1).max(180), ref: reference, expectedCommit: reference, assigneeIds: z.array(identityId).min(1).max(50), reviewerId: identityId, mode: z.enum(['review', 'independent']).default('review'), branchPrefix: reference.default('annotate/task'), rowIds: z.array(rowId).min(1).max(100000).optional(), note: z.string().trim().max(4000).optional() }).strict().parse(request.body);
    const result = await workflows.create(key(request), requestIdentity(request), input); reply.code(201); return result;
  });
  app.get(`${base}/tasks/:id`, request => workflows.get(key(request), requestIdentity(request), id(request)));
  app.get(`${base}/tasks/:id/evidence`, request => { const input = z.object({ rowId }).parse(request.query); return workflows.evidence(key(request), requestIdentity(request), id(request), input.rowId); });
  app.post(`${base}/tasks/:id/submit`, request => { const input = z.object({ expectedRevision: revision, expectedCommit: reference }).strict().parse(request.body); return workflows.submit(key(request), requestIdentity(request), id(request), input.expectedRevision, input.expectedCommit); });
  app.post(`${base}/tasks/:id/review`, request => {
    const input = z.object({ expectedRevision: revision, decisions: z.array(z.object({ rowId, verdict: z.enum(['approved', 'changes-requested']), comment: z.string().trim().max(4000).default(''), values: values.optional(), annotationActorId: identityId.optional() }).strict()).min(1).max(100000) }).strict().parse(request.body);
    return workflows.review(key(request), requestIdentity(request), id(request), input.expectedRevision, input.decisions);
  });
  app.post(`${base}/tasks/:id/cancel`, request => { const input = z.object({ expectedRevision: revision, reason: z.string().trim().min(1).max(4000) }).strict().parse(request.body); return workflows.cancel(key(request), requestIdentity(request), id(request), input.expectedRevision, input.reason); });
  app.patch(`${base}/tasks/:id/reviewer`, request => { const input = z.object({ expectedRevision: revision, reviewerId: identityId }).strict().parse(request.body); return workflows.changeReviewer(key(request), requestIdentity(request), id(request), input.expectedRevision, input.reviewerId); });
  app.get(`${base}/workflow/preflight`, async request => {
    await workflows.options.access.requireCapability(key(request), requestIdentity(request), 'release.manage');
    const input = z.object({ ref: reference.default('main') }).parse(request.query);
    return workflows.preflight(key(request), input.ref);
  });
  app.get(`${base}/workflow/progress`, async request => {
    const input = z.object({ ref: reference.default('main') }).parse(request.query), result = await workflows.preflight(key(request), input.ref), snapshot = await workflows.options.datasets.read(key(request), result.reviewSnapshot.commitId);
    return { commitId: result.reviewSnapshot.commitId, total: snapshot.rowIds.length, approved: snapshot.rowIds.filter(id => Object.hasOwn(result.acceptedValues, id)).length, issues: result.issues };
  });
}
