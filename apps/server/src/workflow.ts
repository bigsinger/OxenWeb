import {durableWriteJson} from './durable-store.js';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AnnotationTask, AnnotationTaskView, TaskDecision, TaskParticipant, TaskReview, TaskSubmission, WorkflowPreflight, WorkflowSummary } from '../../../packages/shared/src/workflow-types.js';
import type { DatasetPage, DatasetRowCapabilities, DatasetSnapshot, DatasetWriteContext, DatasetWriteOperation } from '../../../packages/shared/src/dataset.js';
import type { RequestIdentity } from '../../../packages/shared/src/index.js';
import type { Provider, RepoKey } from './provider.js';
import type { DatasetService } from './dataset.js';
import type { RepositoryAccessService } from './repository-access.js';
import { ApiError } from './errors.js';
import { assignmentId, validateLabelDocument } from './labels.js';
import { safeRef } from './safety.js';
import { getBindingSnapshot } from './governance.js';
import type { ProjectSchemaBinding } from '../../../packages/shared/src/governance-types.js';
import { semanticDatasetFields } from '../../../packages/shared/src/field-metadata.js';

function canonical(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value as object).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
}
export const workflowHash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const actor = (identity: { id: string; name: string }) => ({ id: identity.id, name: identity.name });
const sameRepo = (task: AnnotationTask, key: RepoKey) => task.namespace === key.namespace && task.repo === key.repo;
const retained = (task: AnnotationTask) => !['cancelled', 'setup-failed', 'setting-up'].includes(task.status);
const active = (task: AnnotationTask) => retained(task) && task.status !== 'merged';
export const sampleTemplateHash = (snapshot: DatasetSnapshot) => {
  const binding = snapshot.binding as ProjectSchemaBinding | undefined;
  const semanticFields = semanticDatasetFields(snapshot.descriptor.fields);
  const fields = Object.keys(semanticFields).length ? { fields: semanticFields } : {};
  if (binding?.version === 2) {
    if (binding.layers.sample) return workflowHash({ version: 2, sample: binding.layers.sample.snapshot, ...fields });
    return workflowHash({ version: 2, sample: null, ...fields });
  }
  return workflowHash({ columns: snapshot.labels.columns, binding: binding ?? null, ...fields });
};
const templateHash = sampleTemplateHash;
const statusFor = (error: unknown) => error instanceof ApiError ? error.message : '服务暂时不可用，请重试。';

/** BFF-only task authority. A branch snapshot can never grant or restore task privileges. */
export class WorkflowStore {
  private tasks: AnnotationTask[] = [];
  private chain = Promise.resolve();
  constructor(readonly filename: string) {}
  async init() {
    try {
      const state = JSON.parse(await readFile(this.filename, 'utf8')) as { version: number; tasks: AnnotationTask[] };
      if (state.version !== 1 || !Array.isArray(state.tasks) || state.tasks.length > 20000 || state.tasks.some(task => !task.id || !Array.isArray(task.rowIds) || !Array.isArray(task.participants) || !Array.isArray(task.reviews))) throw new Error('Invalid workflow control-plane data.');
      this.tasks = state.tasks;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  list(key: RepoKey) { return structuredClone(this.tasks.filter(task => sameRepo(task, key))); }
  get(key: RepoKey, id: string) {
    const task = this.tasks.find(item => sameRepo(item, key) && item.id === id);
    if (!task) throw new ApiError(404, 'TASK_NOT_FOUND', '任务不存在。');
    return structuredClone(task);
  }
  private transaction<T>(work: (tasks: AnnotationTask[]) => T): Promise<T> {
    const next = this.chain.then(async () => {
      const tasks = structuredClone(this.tasks), result = work(tasks);
      await mkdir(path.dirname(this.filename), { recursive: true });
      await durableWriteJson(this.filename,{version:1,tasks}); this.tasks = tasks; return structuredClone(result);
    });
    this.chain = next.then(() => {}, () => {}); return next;
  }
  add(tasks: AnnotationTask[]) {
    return this.transaction(items => {
      if (items.length + tasks.length > 20000) throw new ApiError(413, 'TASK_LIMIT', '任务数量达到实例上限。');
      items.push(...tasks); return tasks;
    });
  }
  mutate(key: RepoKey, id: string, revision: number, update: (task: AnnotationTask) => void) {
    return this.transaction(items => {
      const task = items.find(item => sameRepo(item, key) && item.id === id);
      if (!task) throw new ApiError(404, 'TASK_NOT_FOUND', '任务不存在。');
      if (task.revision !== revision) throw new ApiError(409, 'TASK_REVISION_CONFLICT', '任务已变更，请刷新后再操作。', { revision: task.revision });
      update(task); task.revision++; task.updatedAt = new Date().toISOString(); return task;
    });
  }
}

export interface CreateTaskInput {
  title: string; ref: string; expectedCommit: string; assigneeIds: string[]; reviewerId: string;
  mode: 'review' | 'independent'; branchPrefix: string; rowIds?: string[]; note?: string;
}
export class WorkflowService {
  readonly store: WorkflowStore;
  private chains = new Map<string, Promise<void>>();
  private hashes = new Map<string, string>();
  private preflights = new Map<string, { expires: number; result: Promise<WorkflowPreflight> }>();
  constructor(readonly options: { provider: Provider; datasets: DatasetService; access: RepositoryAccessService; filename: string }) { this.store = new WorkflowStore(options.filename); }
  init() { return this.store.init(); }
  private async manager(key: RepoKey, identity: RequestIdentity) {
    try { await this.options.access.requireCapability(key, identity, 'tasks.manage'); return true; } catch { return false; }
  }
  private serial<T>(key: RepoKey, work: () => Promise<T>): Promise<T> {
    const name = `${key.namespace}/${key.repo}`, current = (this.chains.get(name) ?? Promise.resolve()).then(work), settled = current.then(() => {}, () => {});
    this.chains.set(name, settled); void settled.then(() => { if (this.chains.get(name) === settled) this.chains.delete(name); }); return current;
  }
  private async member(key: RepoKey, id: string) {
    if (id === 'owner') return { id: 'owner', name: '实例管理员', kind: 'owner', source: 'local' } as RequestIdentity;
    const policy = (await this.options.access.settings.read(key)).policy;
    const item = policy.collaborators.find(member => member.id === id);
    if (!item) throw new ApiError(422, 'TASK_MEMBER_INVALID', '任务成员必须是当前项目仍有权限的协作者。');
    return { id: item.id, name: item.name, kind: 'collaborator', source: 'bearer' } as RequestIdentity;
  }
  private async currentHead(key: RepoKey, branch: string, expected: string) {
    const current = (await this.options.provider.branches(key)).find(item => item.name === branch);
    if (!current || current.commitId !== expected) throw new ApiError(409, 'TASK_BRANCH_CHANGED', '任务分支已更新，请刷新内容和任务后再操作。');
  }
  private visible(task: AnnotationTask, identity: RequestIdentity, management: boolean) { return management || task.reviewer.id === identity.id || task.participants.some(item => item.id === identity.id); }
  private ownValues(snapshot: DatasetSnapshot, rowId: string, person: string) {
    const record = snapshot.labelRecords.find(record => record.scope === 'row' && record.rowId === rowId && record.actor.id === person);
    return { record, values: Object.fromEntries(Object.entries(record?.values ?? {}).filter((entry): entry is [string, string | string[]] => entry[1] !== null)) };
  }
  private async fingerprint(key: RepoKey, snapshot: DatasetSnapshot, rowId: string, person: string, baseline: string): Promise<string> {
    const index = snapshot.rowIds.indexOf(rowId);
    if (index < 0) return workflowHash({ rowId, deleted: true, baseline });
    const attachments = snapshot.attachments.filter(item => item.rowIds.includes(rowId));
    const attachmentHashes: Array<{ path: string; sha256: string }> = [];
    for (const attachment of attachments) {
      const cacheKey = `${key.namespace}/${key.repo}/${snapshot.commitId}/${attachment.path}`;
      // Imported package_sha256 is provenance, not proof that the current bytes are unchanged.
      let digest = this.hashes.get(cacheKey);
      if (!digest) {
        digest = createHash('sha256').update((await this.options.provider.raw(key, snapshot.commitId, attachment.path)).content).digest('hex');
        if (this.hashes.size > 5000) this.hashes.clear();
        this.hashes.set(cacheKey, digest);
      }
      attachmentHashes.push({ path: attachment.path, sha256: digest });
    }
    const { record } = this.ownValues(snapshot, rowId, person);
    const files = new Set([snapshot.path, ...attachments.map(item => item.path)]);
    const modern = (snapshot.binding as ProjectSchemaBinding | undefined)?.version === 2 && !!(snapshot.binding as import('../../../packages/shared/src/governance-types.js').ProjectSchemaBindingV2).layers.sample;
    const context = snapshot.labels.assignments.filter(item => !modern && item.scope === 'dataset' || item.scope === 'file' && files.has(item.path ?? ''));
    return workflowHash({ rowId, contentHash: snapshot.contentHashes[rowId], annotation: record ? { actor: record.actor.id, values: record.values, spans: record.spans, steps: record.steps, contentHash: record.contentHash, templateSnapshot: record.templateSnapshot } : null, schema: templateHash(snapshot), context, attachments: attachmentHashes });
  }
  private required(snapshot: DatasetSnapshot) {
    const modern = getBindingSnapshot(snapshot.binding as ProjectSchemaBinding | undefined, 'row');
    if (modern) return new Set(modern.bindings.filter(item => item.required && item.scopes.includes('row')).map(item => item.dimensionId));
    const binding = snapshot.binding as { columns?: Array<{ id: string; required?: boolean }>; bindings?: Array<{ columnId?: string; id?: string; required?: boolean }>; snapshot?: { bindings: Array<{ dimensionId: string; required: boolean; scopes: string[] }> } } | undefined;
    return new Set([...(binding?.columns ?? []).filter(item => item.required).map(item => item.id), ...(binding?.bindings ?? []).filter(item => item.required).map(item => item.columnId ?? item.id ?? ''), ...(binding?.snapshot?.bindings ?? []).filter(item => item.required && item.scopes.includes('row')).map(item => item.dimensionId)].filter(Boolean));
  }
  private checkAnnotated(snapshot: DatasetSnapshot, rowId: string, person: string) {
    if (!snapshot.rowIds.includes(rowId)) return; // Deletions receive an explicit review proof too.
    const { record, values } = this.ownValues(snapshot, rowId, person);
    if (!record || !Object.keys(values).length && !record.spans.length && !record.steps.length) throw new ApiError(422, 'TASK_ANNOTATION_INCOMPLETE', '任务中仍有未由执行者人工标注的条目。', { rowId });
    if (record.contentHash !== snapshot.contentHashes[rowId]) throw new ApiError(409, 'TASK_LABELS_OUTDATED', '样本内容已变化，请核对并重新保存该条目的标注。', { rowId });
    for (const id of this.required(snapshot)) if (!(id in values) || values[id] === '' || Array.isArray(values[id]) && !values[id].length) throw new ApiError(422, 'TASK_REQUIRED_LABEL', '任务尚未填写模板要求的必填维度。', { rowId, columnId: id });
  }
  async create(key: RepoKey, identity: RequestIdentity, input: CreateTaskInput) {
    return this.serial(key, async () => {
      await this.options.access.requireCapability(key, identity, 'tasks.manage');
      if (!input.assigneeIds.length || new Set(input.assigneeIds).size !== input.assigneeIds.length || input.assigneeIds.includes(input.reviewerId)) throw new ApiError(422, 'TASK_DISTINCT_IDENTITIES', '执行者须唯一，复核者必须是另一名人员。');
      if (input.mode === 'independent' && input.assigneeIds.length !== 2) throw new ApiError(422, 'TASK_TWO_ANNOTATORS', '独立双标模式须选择两名不同执行者。');
      const people = await Promise.all(input.assigneeIds.map(id => this.member(key, id))), reviewer = await this.member(key, input.reviewerId);
      for (const person of people) await this.options.access.requireCapability(key, person, 'annotation.assign');
      await this.options.access.requireCapability(key, reviewer, 'annotation.review');
      await this.currentHead(key, input.ref, input.expectedCommit);
      const snapshot = await this.options.datasets.read(key, input.expectedCommit), selected = input.rowIds ?? snapshot.rowIds;
      // Oxen 0.67 can cross-index newly-created nested directories on divergent branches.
      // Share an existing managed root before forking; never accept missing proof files.
      if(!(await this.options.provider.tree(key,snapshot.commitId,'')).some(item=>item.path==='.oxenweb'&&item.kind==='directory'))throw new ApiError(409,'TASK_DATASET_INITIALIZATION_REQUIRED','请先由负责人在项目设置完成一次性数据集配置，再分配标注任务。');
      if (!selected.length || new Set(selected).size !== selected.length || selected.some(id => !snapshot.rowIds.includes(id))) throw new ApiError(422, 'TASK_ROW_SELECTION', '任务需选择当前提交中唯一有效的稳定样本 ID。');
      if (input.mode === 'review' && people.length > selected.length) throw new ApiError(422, 'TASK_EMPTY_ALLOCATION', '执行人数不能多于所选样本数。');
      const previous = this.store.list(key).filter(active);
      if (previous.some(task => task.rowIds.some(id => selected.includes(id)))) throw new ApiError(409, 'TASK_ALLOCATION_OVERLAP', '所选条目已有活动任务，请先完成或撤销原任务；独立双标请在同一任务内配置。');
      const now = new Date().toISOString(), group = randomUUID().slice(0, 8), tasks: AnnotationTask[] = [];
      const width = Math.floor(selected.length / people.length), remainder = selected.length % people.length;
      const groups = input.mode === 'independent' ? [selected] : people.map((_, index) => { const start = index * width + Math.min(index, remainder); return selected.slice(start, start + width + (index < remainder ? 1 : 0)); });
      for (let index = 0; index < groups.length; index++) {
        const taskPeople = input.mode === 'independent' ? people : [people[index]!], rows = groups[index]!;
        const participants: TaskParticipant[] = taskPeople.map((person, participantIndex) => ({ ...actor(person), branch: safeRef(`${input.branchPrefix}-${group}-${index + 1}${taskPeople.length > 1 ? `-${participantIndex + 1}` : ''}`) }));
        tasks.push({ ...key, id: randomUUID(), title: groups.length > 1 ? `${input.title} · ${index + 1}/${groups.length}` : input.title, revision: 1, assignmentRevision: 1, status: 'setting-up', mode: input.mode, createdBy: actor(identity), createdAt: now, updatedAt: now, baselineCommitId: snapshot.commitId, sourceBranch: input.ref, templateHash: templateHash(snapshot), rowIds: rows, baseHashes: Object.fromEntries(rows.map(id => [id, snapshot.contentHashes[id]!])), participants, reviewer: actor(reviewer), submissions: [], reviews: [], ...(input.note ? { note: input.note } : {}) });
      }
      await this.store.add(tasks);
      for (const task of tasks) {
        try {
          for (const participant of task.participants) {
            await this.options.access.requireCapability(key, identity, 'tasks.manage');
            // Oxen 0.67's HTTP from_name resolves an existing branch, not an arbitrary commit ID.
            // Freeze by checking both ends rather than silently forking an advanced source branch.
            await this.currentHead(key, input.ref, snapshot.commitId);
            const created = await this.options.provider.createBranch(key, participant.branch, input.ref);
            if (created.commitId !== snapshot.commitId) throw new ApiError(409, 'TASK_BASELINE_MOVED', '创建任务分支期间源分支已前进；此分支未纳入有效任务，请负责人核对。');
            await this.currentHead(key, participant.branch, snapshot.commitId);
          }
          await this.store.mutate(key, task.id, task.revision, item => { item.status = 'assigned'; });
        } catch (error) {
          await this.store.mutate(key, task.id, task.revision, item => { item.status = 'setup-failed'; item.setupError = `${statusFor(error)} 已创建的分支保留，未自动删除或覆盖。`; });
        }
      }
      return Promise.all(tasks.map(task => this.get(key, identity, task.id)));
    });
  }
  async beforeWrite(key: RepoKey, identity: RequestIdentity, branch: string, rowIds: string[], operation: DatasetWriteOperation, context: DatasetWriteContext) {
    if (operation === 'edit-evaluation') {
      await this.options.access.requireCapability(key, identity, 'release.manage');
      await this.options.access.requireCapability(key, identity, 'data.edit');
      return;
    }
    if (operation === 'edit-dataset-labels') { await this.options.access.requireCapability(key, identity, 'dataset.assign'); if(branch!=='main')throw new ApiError(409,'PROJECT_LABELS_MAIN_REQUIRED','项目标签统一在 main 维护，请使用项目顶部的“编辑标签”。');return; }
    if (operation === 'feedback' || await this.manager(key, identity)) return;
    const history = this.store.list(key), tasks = history.filter(active);
    if (!history.length) return;
    const task = tasks.find(item => item.participants.some(person => person.id === identity.id && person.branch === branch));
    if (!task) throw new ApiError(403, 'TASK_BRANCH_REQUIRED', '请在分配给你的任务分支中工作。');
    if (['edit-readme', 'edit-dataset-labels'].includes(operation) || context.operations.some(item => item.op === 'append') || !rowIds.length) throw new ApiError(403, 'TASK_SCOPE_DENIED', '本任务仅授权分配的样本；数据集整体变更请交负责人处理。');
    if (rowIds.some(id => !task.rowIds.includes(id))) throw new ApiError(403, 'TASK_ROW_DENIED', '本次操作包含未分配给你的样本。');
  }
  async rowCapabilities(key: RepoKey, identity: RequestIdentity, branch: string, page: DatasetPage): Promise<Record<string, DatasetRowCapabilities>> {
    const can = async (capability: 'data.edit' | 'annotation.assign') => {
      try { await this.options.access.requireCapability(key, identity, capability); return true; } catch (cause) {
        if (cause instanceof ApiError && [401, 403].includes(cause.status)) return false;
        throw cause;
      }
    };
    const [editContent, assignLabels, manage, permissions] = await Promise.all([can('data.edit'), can('annotation.assign'), this.manager(key, identity), this.options.access.permissions(key, identity)]);
    const history = this.store.list(key), unrestricted = manage || history.length === 0;
    const allowed = new Set(history.filter(task => active(task) && task.participants.some(person => person.id === identity.id && person.branch === branch)).flatMap(task => task.rowIds));
    return Object.fromEntries(page.rowIds.map(rowId => [rowId, { editContent: editContent && (unrestricted || allowed.has(rowId)), assignLabels: assignLabels && (unrestricted || allowed.has(rowId)), feedback: identity.kind !== 'guest' && permissions.write }]));
  }
  async appendRowsAllowed(key:RepoKey,identity:RequestIdentity,branch:string){
    try{await this.options.access.requireCapability(key,identity,'data.edit');await this.beforeWrite(key,identity,branch,[],'edit-content',{operations:[{op:'append',record:{}}]});return true;}
    catch(cause){if(cause instanceof ApiError&&[401,403].includes(cause.status))return false;throw cause;}
  }
  async submit(key: RepoKey, identity: RequestIdentity, id: string, revision: number, expectedCommit: string) {
    return this.serial(key, async () => {
      await this.options.access.requireCapability(key, identity, 'annotation.assign');
      const task = this.store.get(key, id), participant = task.participants.find(person => person.id === identity.id);
      if (!participant || !active(task)) throw new ApiError(403, 'TASK_ASSIGNEE_REQUIRED', '仅当前任务执行者可提交此任务。');
      if (task.revision !== revision) throw new ApiError(409, 'TASK_REVISION_CONFLICT', '任务已更新。');
      await this.currentHead(key, participant.branch, expectedCommit);
      const snapshot = await this.options.datasets.read(key, expectedCommit);
      if (templateHash(snapshot) !== task.templateHash) throw new ApiError(409, 'TASK_TEMPLATE_CHANGED', '任务模板发生变化，请由负责人确认后重新分配任务。');
      const fingerprints: Record<string, string> = {};
      for (const rowId of task.rowIds) { this.checkAnnotated(snapshot, rowId, identity.id); fingerprints[rowId] = await this.fingerprint(key, snapshot, rowId, identity.id, task.baseHashes[rowId]!); }
      await this.options.access.requireCapability(key, identity, 'annotation.assign');
      await this.currentHead(key, participant.branch, expectedCommit);
      await this.store.mutate(key, id, revision, item => {
        item.submissions = [...item.submissions.filter(submission => submission.actor.id !== identity.id), { actor: actor(identity), branch: participant.branch, commitId: snapshot.commitId, submittedAt: new Date().toISOString(), fingerprints }];
        item.status = item.submissions.length === item.participants.length ? 'awaiting-review' : 'in-progress';
      });
      return this.get(key, identity, id);
    });
  }
  private async submittedSnapshots(key: RepoKey, task: AnnotationTask, requireAll = true) {
    const results = new Map<string, DatasetSnapshot>();
    for (const person of task.participants) {
      const submission = task.submissions.find(item => item.actor.id === person.id);
      if (!submission) { if (requireAll) throw new ApiError(409, 'TASK_SUBMISSION_MISSING', '所有执行者须先提交标注结果。'); else continue; }
      const snapshot = await this.options.datasets.read(key, person.branch);
      if (templateHash(snapshot) !== task.templateHash) throw new ApiError(409, 'TASK_TEMPLATE_CHANGED', '任务规范已改变，需要重新确认。');
      for (const rowId of task.rowIds) if (await this.fingerprint(key, snapshot, rowId, person.id, task.baseHashes[rowId]!) !== submission.fingerprints[rowId]) throw new ApiError(409, 'TASK_SUBMISSION_STALE', '提交后的内容、标签、附件或规范已变化，请执行者重新提交复核。', { rowId, actorId: person.id });
      results.set(person.id, snapshot);
    }
    return results;
  }
  private validateDecision(snapshot: DatasetSnapshot, rowId: string, values: Record<string, string | string[]>) {
    const assignment = { scope: 'row' as const, path: snapshot.path, rowId, values };
    validateLabelDocument({ version: 1, columns: snapshot.labels.columns, assignments: [{ ...assignment, id: assignmentId(assignment) }] });
    for (const column of this.required(snapshot)) if (!(column in values) || values[column] === '' || Array.isArray(values[column]) && !values[column].length) throw new ApiError(422, 'TASK_REQUIRED_LABEL', '裁决结果缺少必填维度。', { rowId, column });
  }
  async review(key: RepoKey, identity: RequestIdentity, id: string, revision: number, input: TaskDecision[]) {
    return this.serial(key, async () => {
      await this.options.access.requireCapability(key, identity, 'annotation.review');
      const task = this.store.get(key, id);
      if (!active(task) || task.reviewer.id !== identity.id || task.participants.some(person => person.id === identity.id)) throw new ApiError(403, 'TASK_INDEPENDENT_REVIEW_REQUIRED', '复核须由当前指定的另一名人员执行。');
      if (task.revision !== revision) throw new ApiError(409, 'TASK_REVISION_CONFLICT', '任务已更新。');
      if (!input.length || new Set(input.map(item => item.rowId)).size !== input.length || input.some(item => !task.rowIds.includes(item.rowId))) throw new ApiError(422, 'TASK_REVIEW_TARGET', '复核目标必须是任务中的唯一条目。');
      const snapshots = await this.submittedSnapshots(key, task), primary = snapshots.get(task.participants[0]!.id)!;
      const decisions = input.map(decision => {
        if (decision.verdict === 'changes-requested') {
          if (!decision.comment.trim()) throw new ApiError(422, 'TASK_REVIEW_REASON', '退回时请填写原因。');
          return decision;
        }
        const contents = task.participants.map(person => snapshots.get(person.id)!.contentHashes[decision.rowId] ?? 'deleted');
        if (new Set(contents).size > 1) throw new ApiError(409, 'TASK_CONTENT_DISAGREEMENT', '执行分支中的样本正文不一致。请先裁决内容并由执行者重新提交，再复核标签。', { rowId: decision.rowId });
        const opinions = task.participants.map(person => this.ownValues(snapshots.get(person.id)!, decision.rowId, person.id));
        const selectedPerson = decision.annotationActorId ? task.participants.find(person => person.id === decision.annotationActorId) : undefined;
        if (decision.annotationActorId && !selectedPerson) throw new ApiError(422, 'TASK_ADJUDICATION_ACTOR', '只能采纳本任务执行者的意见。');
        const fine = opinions.map(opinion => ({ spans: opinion.record?.spans.map(({ id: _id, ...span }) => ({ ...span, note: span.note ?? '' })).sort((a,b)=>canonical(a).localeCompare(canonical(b))) ?? [], steps: opinion.record?.steps.map(({ id: _id, ...step }) => ({ ...step, note: step.note ?? '' })).sort((a,b)=>canonical(a).localeCompare(canonical(b))) ?? [] }));
        if (task.mode === 'independent' && fine.some(value => canonical(value) !== canonical(fine[0])) && !selectedPerson) throw new ApiError(409, 'TASK_FINE_ADJUDICATION_REQUIRED', '两份片段或步骤标注存在分歧，请明确选择采纳哪位执行者的精细标注。', { rowId: decision.rowId });
        if (!decision.values && !selectedPerson && task.mode === 'independent' && opinions.some(opinion => canonical(opinion.values) !== canonical(opinions[0]!.values))) throw new ApiError(409, 'TASK_ADJUDICATION_REQUIRED', '两份标注存在分歧，请明确填写采纳的裁决值。', { rowId: decision.rowId });
        const adopted = selectedPerson ?? task.participants[0]!;
        const values = decision.values ?? opinions[task.participants.findIndex(person => person.id === adopted.id)]!.values;
        if (primary.rowIds.includes(decision.rowId)) this.validateDecision(primary, decision.rowId, values);
        return { ...decision, values, annotationActorId: adopted.id };
      });
      const reviewId = randomUUID(), storagePath = `.oxenweb/reviews/${task.id}-${reviewId}.json`, reviewedAt = new Date().toISOString();
      const selected = new Set(decisions.map(item => item.rowId));
      const submissions = task.submissions.map(submission => ({ ...submission, fingerprints: Object.fromEntries(Object.entries(submission.fingerprints).filter(([rowId]) => selected.has(rowId))) }));
      const bindingAuditHashes = Object.fromEntries([...snapshots].map(([person, snapshot]) => [person, workflowHash(snapshot.binding ?? null)]));
      const payload = { version: 1, id: reviewId, taskId: task.id, reviewer: actor(identity), reviewedAt, assignmentRevision: task.assignmentRevision, decisions, submissions, bindingAuditHashes }, proofHash = workflowHash(payload);
      const workspace = await this.options.provider.createWorkspace(key, `Oxen Web review ${reviewId.slice(0, 8)}`, task.participants[0]!.branch);
      let committed = false;
      try {
        if (workspace.baseCommitId && workspace.baseCommitId !== primary.commitId) throw new ApiError(409, 'TASK_BRANCH_CHANGED', '复核工作区版本已变化。');
        await this.options.provider.writeWorkspace(key, workspace.id, storagePath, Buffer.from(JSON.stringify({ ...payload, proofHash }, null, 2) + '\n'));
        await this.options.access.requireCapability(key, identity, 'annotation.review');
        const currentTask = this.store.get(key, id);
        if (currentTask.revision !== revision || currentTask.reviewer.id !== identity.id || !active(currentTask)) throw new ApiError(409, 'TASK_REVIEW_STALE', '任务授权在复核期间发生变化。');
        await this.submittedSnapshots(key, task);
        await this.currentHead(key, task.participants[0]!.branch, primary.commitId);
        const commit = await this.options.provider.commitWorkspace(key, workspace.id, `Review ${task.title}: ${decisions.length} samples`, primary.commitId); committed = true;
        const review: TaskReview = { ...payload, commitId: commit.id, storagePath, proofHash };
        await this.store.mutate(key, id, revision, item => { item.reviews.push(review); item.status = decisions.some(decision => decision.verdict === 'changes-requested') ? 'changes-requested' : 'approved'; });
      } finally { if (committed) await this.options.provider.deleteWorkspace(key, workspace.id).catch(() => {}); }
      return this.get(key, identity, id);
    });
  }
  async cancel(key: RepoKey, identity: RequestIdentity, id: string, revision: number, reason: string) {
    await this.options.access.requireCapability(key, identity, 'tasks.manage');
    await this.store.mutate(key, id, revision, item => { item.status = 'cancelled'; item.assignmentRevision++; item.note = reason; });
    return this.get(key, identity, id);
  }
  async changeReviewer(key: RepoKey, identity: RequestIdentity, id: string, revision: number, reviewerId: string) {
    await this.options.access.requireCapability(key, identity, 'tasks.manage');
    const task = this.store.get(key, id), reviewer = await this.member(key, reviewerId);
    if (task.participants.some(person => person.id === reviewerId)) throw new ApiError(422, 'TASK_DISTINCT_IDENTITIES', '复核者必须是另一名人员。');
    await this.options.access.requireCapability(key, reviewer, 'annotation.review');
    await this.store.mutate(key, id, revision, item => { item.reviewer = actor(reviewer); item.assignmentRevision++; item.status = item.submissions.length === item.participants.length ? 'awaiting-review' : 'assigned'; });
    return this.get(key, identity, id);
  }
  async get(key: RepoKey, identity: RequestIdentity, id: string): Promise<AnnotationTaskView> {
    const task = this.store.get(key, id), manage = await this.manager(key, identity);
    if (!this.visible(task, identity, manage)) throw new ApiError(403, 'TASK_ACCESS_DENIED', '仅任务成员、指定复核者或负责人可查看任务详情。');
    let current = true, staleReason: string | undefined, annotated = 0;
    try {
      for (const person of task.participants) {
        const snapshot = await this.options.datasets.read(key, person.branch);
        for (const rowId of task.rowIds) if (this.ownValues(snapshot, rowId, person.id).record || !snapshot.rowIds.includes(rowId)) annotated++;
      }
      await this.submittedSnapshots(key, task, false);
    } catch (error) { current = false; staleReason = statusFor(error); }
    const decisions = new Map<string, TaskDecision>();
    for (const review of task.reviews.filter(item => item.assignmentRevision === task.assignmentRevision)) for (const decision of review.decisions) decisions.set(decision.rowId, decision);
    const approved = current ? [...decisions.values()].filter(item => item.verdict === 'approved').length : 0, rejected = [...decisions.values()].filter(item => item.verdict === 'changes-requested').length;
    const status = !active(task) ? task.status : !current ? 'in-progress' : rejected ? 'changes-requested' : approved === task.rowIds.length ? 'approved' : task.submissions.length === task.participants.length ? 'awaiting-review' : annotated ? 'in-progress' : 'assigned';
    const can = async (capability: 'annotation.assign' | 'annotation.review') => { try { await this.options.access.requireCapability(key, identity, capability); return true; } catch { return false; } };
    return { ...task, status, current, ...(staleReason ? { staleReason } : {}), progress: { total: task.rowIds.length, annotated: Math.floor(annotated / task.participants.length), submitted: current && task.submissions.length === task.participants.length ? task.rowIds.length : 0, approved, rejected, merged: task.status === 'merged' ? task.rowIds.length : 0 }, permissions: { submit: active(task) && task.participants.some(person => person.id === identity.id) && await can('annotation.assign'), review: active(task) && task.reviewer.id === identity.id && !task.participants.some(person => person.id === identity.id) && await can('annotation.review'), manage } };
  }
  async list(key: RepoKey, identity: RequestIdentity): Promise<WorkflowSummary> {
    const manage = await this.manager(key, identity), tasks: AnnotationTaskView[] = [];
    for (const task of this.store.list(key).filter(item => this.visible(item, identity, manage)).reverse()) tasks.push(await this.get(key, identity, task.id));
    return { total: tasks.length, active: tasks.filter(task => active(task)).length, awaitingReview: tasks.filter(task => task.status === 'awaiting-review').length, approved: tasks.filter(task => task.status === 'approved').length, stale: tasks.filter(task => !task.current).length, tasks, storage: 'bff-control-plane-and-oxen-review-proofs' };
  }
  async evidence(key: RepoKey, identity: RequestIdentity, id: string, rowId: string) {
    const view = await this.get(key, identity, id);
    if (!view.rowIds.includes(rowId)) throw new ApiError(404, 'TASK_ROW_NOT_FOUND', '该样本不在当前任务内。');
    const people = identity.id === view.reviewer.id || view.permissions.manage ? view.participants : view.participants.filter(person => person.id === identity.id);
    const opinions = [];
    for (const person of people) {
      const snapshot = await this.options.datasets.read(key, person.branch), index = snapshot.rowIds.indexOf(rowId), own = this.ownValues(snapshot, rowId, person.id);
      opinions.push({ actor: actor(person), branch: person.branch, commitId: snapshot.commitId, data: index < 0 ? null : snapshot.rows[index], values: own.values, columns: snapshot.labels.columns, spans: own.record?.spans ?? [], steps: own.record?.steps ?? [], submitted: view.submissions.some(item => item.actor.id === person.id), contentHash: snapshot.contentHashes[rowId] ?? 'deleted' });
    }
    return { taskId: id, rowId, opinions, decisions: view.reviews.filter(item => item.assignmentRevision === view.assignmentRevision).flatMap(review => review.decisions.filter(decision => decision.rowId === rowId).map(decision => ({ ...decision, reviewer: review.reviewer, at: review.reviewedAt }))) };
  }
  private async ancestry(key: RepoKey, commitId: string) {
    const ids = new Set<string>();
    for (let page = 1; page <= 20; page++) {
      const entries = await this.options.provider.commits(key, commitId, page, 500); entries.forEach(item => ids.add(item.id));
      if (entries.length < 500) return ids;
    }
    throw new ApiError(413, 'TASK_HISTORY_LIMIT', '提交历史超过审核可完整验证的上限，没有使用部分结果。');
  }
  async preflight(key: RepoKey, reference: string, rowIds?: string[]): Promise<WorkflowPreflight> {
    const snapshot = await this.options.datasets.read(key, reference), tasks = this.store.list(key).filter(retained);
    const scope = rowIds === undefined ? undefined : new Set(rowIds);
    if (scope && (scope.size !== rowIds!.length || rowIds!.some(id => !snapshot.rowIds.includes(id)))) throw new ApiError(422, 'WORKFLOW_SCOPE_INVALID', '复核范围必须是固定提交内唯一有效的稳定样本 ID。');
    const cacheKey = `${key.namespace}/${key.repo}@${snapshot.commitId}:${tasks.map(task => `${task.id}:${task.revision}`).join(',')}:${scope ? workflowHash([...scope].sort()) : 'all'}`;
    let cached = this.preflights.get(cacheKey);
    if (!cached || cached.expires < Date.now()) {
      const result = this.inspectPreflight(key, snapshot, tasks, scope); cached = { expires: Date.now() + 15000, result };
      if (this.preflights.size > 20) this.preflights.clear(); this.preflights.set(cacheKey, cached);
      result.catch(() => this.preflights.delete(cacheKey));
    }
    return structuredClone(await cached.result);
  }
  private async inspectPreflight(key: RepoKey, snapshot: DatasetSnapshot, tasks: AnnotationTask[], scope?: Set<string>): Promise<WorkflowPreflight> {
    const ancestry = await this.ancestry(key, snapshot.commitId), owners = new Map<string, string>();
    for (const task of tasks) for (const rowId of task.rowIds) owners.set(rowId, task.id);
    const issues: string[] = [], acceptedValues: WorkflowPreflight['acceptedValues'] = Object.create(null), acceptedFineAnnotations: WorkflowPreflight['acceptedFineAnnotations'] = Object.create(null), reviews: TaskReview[] = [], accepted = new Set<string>();
    const proofCache = new Map<string, boolean>();
    for (const task of tasks) {
      const latest = new Map<string, { decision: TaskDecision; review: TaskReview }>();
      for (const review of task.reviews.filter(item => item.assignmentRevision === task.assignmentRevision)) for (const decision of review.decisions) latest.set(decision.rowId, { decision, review });
      for (const rowId of task.rowIds) {
        if (scope && !scope.has(rowId)) continue;
        if (owners.get(rowId) !== task.id) continue;
        const item = latest.get(rowId); if (!item || item.decision.verdict !== 'approved') continue;
        const { review, decision } = item;
        if (!ancestry.has(review.commitId) || review.submissions.some(submission => !ancestry.has(submission.commitId))) continue;
        if (!proofCache.has(review.id)) {
          try { const proof = JSON.parse((await this.options.provider.raw(key, snapshot.commitId, review.storagePath)).content.toString('utf8')) as Record<string, unknown>; const { proofHash, ...payload } = proof; proofCache.set(review.id, proofHash === review.proofHash && workflowHash(payload) === review.proofHash); }
          catch { proofCache.set(review.id, false); }
        }
        if (!proofCache.get(review.id)) continue;
        let valid = templateHash(snapshot) === task.templateHash;
        for (const person of task.participants) if (await this.fingerprint(key, snapshot, rowId, person.id, task.baseHashes[rowId]!) !== review.submissions.find(submission => submission.actor.id === person.id)?.fingerprints[rowId]) valid = false;
        if (!valid) continue;
        accepted.add(rowId); acceptedValues[rowId] = decision.values ?? {};
        const adoptedActor = decision.annotationActorId ?? task.participants[0]!.id, adopted = this.ownValues(snapshot, rowId, adoptedActor).record;
        acceptedFineAnnotations[rowId] = { actorId: adoptedActor, spans: adopted?.spans ?? [], steps: adopted?.steps ?? [] };
        if (!reviews.some(item => item.id === review.id)) reviews.push(review);
      }
    }
    const currentRows = scope ? snapshot.rowIds.filter(id => scope.has(id)) : snapshot.rowIds;
    const missing = currentRows.filter(rowId => !accepted.has(rowId));
    if (missing.length) issues.push(`${missing.length} 条当前样本尚无有效、已合并且与当前内容一致的独立复核。`);
    if (!currentRows.length) issues.push('数据集为空。');
    const orphaned = snapshot.orphanAssignments.filter(item => (!scope || item.scope !== 'row' || scope.has(item.rowId ?? '')) && (item.scope !== 'row' || !accepted.has(item.rowId ?? '') || snapshot.rowIds.includes(item.rowId ?? '')));
    if (orphaned.length) issues.push(`${orphaned.length} 条历史标签引用已失效，需要负责人明确处置。`);
    const unadjudicated = snapshot.labelConflicts.filter(conflict => (!scope || conflict.scope !== 'row' || scope.has(conflict.rowId ?? '')) && (conflict.scope !== 'row' || !accepted.has(conflict.rowId ?? '')));
    if (unadjudicated.length) issues.push(`${unadjudicated.length} 处标签分歧尚未得到有效裁决。`);
    // The original proof is verified above. A scoped export is an audit projection;
    // never embed other rows' decisions or submission fingerprints in its envelope.
    const scopedReviews = scope ? reviews.map(review => ({ ...review,
      decisions: review.decisions.filter(decision => accepted.has(decision.rowId)),
      submissions: review.submissions.map(submission => ({ ...submission, fingerprints: Object.fromEntries(Object.entries(submission.fingerprints).filter(([id]) => accepted.has(id))) })),
    })) : reviews;
    return { ok: !issues.length, issues, acceptedValues, acceptedFineAnnotations, reviewSnapshot: { version: 1, commitId: snapshot.commitId, reviews: scopedReviews, tasks: tasks.filter(task => task.rowIds.some(id => accepted.has(id))).map(({ id, title, mode, assignmentRevision, baselineCommitId, participants, reviewer, rowIds }) => ({ id, title, mode, assignmentRevision, baselineCommitId, participants, reviewer, rowIds: scope ? rowIds.filter(id => accepted.has(id)) : rowIds })) } };
  }
  async workflowFields(key: RepoKey, snapshot: DatasetSnapshot): Promise<Record<string, Record<string, unknown>>> {
    const result = await this.preflight(key, snapshot.commitId), fields: Record<string, Record<string, unknown>> = Object.create(null);
    const latest = new Map<string, AnnotationTask>();
    for (const task of this.store.list(key).filter(retained)) for (const rowId of task.rowIds) latest.set(rowId, task);
    for (const rowId of snapshot.rowIds) {
      const task = latest.get(rowId); let status = 'unassigned';
      if (Object.hasOwn(result.acceptedValues, rowId)) status = task?.status === 'merged' ? 'merged' : 'approved';
      else if (task) {
        status = 'assigned';
        if (task.participants.some(person => !!this.ownValues(snapshot, rowId, person.id).record)) status = 'in-progress';
        let submitted = task.submissions.length === task.participants.length;
        for (const person of task.participants) {
          const submission = task.submissions.find(item => item.actor.id === person.id);
          if (!submission || await this.fingerprint(key, snapshot, rowId, person.id, task.baseHashes[rowId]!) !== submission.fingerprints[rowId]) submitted = false;
        }
        if (submitted) status = 'awaiting-review';
        const decisions = task.reviews.filter(review => review.assignmentRevision === task.assignmentRevision).flatMap(review => review.decisions).filter(decision => decision.rowId === rowId);
        if (decisions.at(-1)?.verdict === 'changes-requested') status = 'changes-requested';
      }
      fields[rowId] = { status, task_id: task?.id ?? '', assignees: task?.participants.map(person => person.id) ?? [], reviewer: task?.reviewer.id ?? '' };
    }
    return fields;
  }
  async markMerged(key: RepoKey, reference: string) {
    if (!this.store.list(key).some(active)) return;
    const result = await this.preflight(key, reference);
    for (const task of this.store.list(key).filter(active)) if (task.rowIds.every(id => Object.hasOwn(result.acceptedValues, id))) await this.store.mutate(key, task.id, task.revision, item => { item.status = 'merged'; });
  }
  async beforeMerge(key: RepoKey, identity: RequestIdentity, source: string, target: string) {
    await this.options.access.requireCapability(key, identity, 'merge.execute');
    const tasks = this.store.list(key).filter(task => active(task) && task.participants.some(person => person.branch === source));
    for (const task of tasks) {
      const view = await this.get(key, identity, task.id);
      if (!view.current || view.progress.approved !== view.progress.total) throw new ApiError(409, 'TASK_REVIEW_REQUIRED', '源分支任务尚未完成有效独立复核，不能合并。');
      await this.submittedSnapshots(key, task);
    }
    if (source === target) throw new ApiError(400, 'INVALID_MERGE', '源分支和目标分支必须不同。');
  }
}
