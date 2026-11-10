import type { DatasetFilter, DatasetOperation, DatasetSort, DatasetDraftSummary } from '../../../packages/shared/src/dataset';
import type { EvaluationPatch } from '../../../packages/shared/src/evaluation';
import type { DatasetEditableCellDraft } from './dataset-configured-editing';
import type { DatasetCellKind } from './dataset-cell-editing';
import {isDatasetBulkEditRequest,type DatasetBulkEditRequest} from './dataset-bulk-editing';

export interface WorkbenchCellInput extends DatasetEditableCellDraft { rowId: string; field: string; originalKind: DatasetCellKind; originalPresence: DatasetEditableCellDraft['presence']; baseline: string }
export interface WorkbenchCheckpoint {
  version: 2; identity: string; project: string; branch: string; baseCommit: string; schemaHash: string; savedAt: string;
  privateDraft?: { id: string; revision: number };
  selected: string; selectedRows: string[]; operations: DatasetOperation[]; inspectorOpen: boolean;
  editing: boolean; json: string; jsonBaseline: string; cellEdit?: WorkbenchCellInput; cellError: string; localError: string;
  drawer: string; attachment: string; appendRowId: string; appendInfo: string;
  fine: { kind: 'span' | 'step'; pointer: string; start: number; end: number; values: Record<string, string | string[] | null>; note: string };
  bulkValues: Record<string, string | string[] | null>; evaluationBulk?: { patch: EvaluationPatch; rowIds: string[] }; feedback: string; message: string;
  sourceBulk?: {request?:DatasetBulkEditRequest;rowIds:string[]};
  page: number; search: string; filters: DatasetFilter[]; sort?: DatasetSort; prompt: string; engine: 'rules' | 'model'; allowExternal: boolean;
  activeQuery?: { prompt: string; engine: 'rules' | 'model'; allowExternalSchema: boolean };
  visibleColumns: string[]; configuredColumnsSeen?:string[]; sourceColumnsSeen?:string[]; filterColumn: string; filterOperator: DatasetFilter['operator']; filterValue: string; showFilter: boolean; showColumns: boolean;
  /** Incompatible raw input is retained for explicit comparison, never replayed automatically. */
  retainedInputs?: WorkbenchCheckpoint[];
}
export interface WorkbenchCheckpointContext {
  identity: string; project: string; branch: string; baseCommit: string; schemaHash: string;
  draft?: DatasetDraftSummary; canEdit: boolean; canAssign: boolean; canAppend: boolean; canManageEvaluation?: boolean; historical: boolean;
}
/** View preferences can follow a new head; unfinished work must retain strict replay guards. */
export function workbenchCheckpointHasInput(checkpoint: WorkbenchCheckpoint): boolean {
  return !!(checkpoint.operations.length || checkpoint.editing || checkpoint.cellEdit || checkpoint.drawer || checkpoint.feedback || checkpoint.fine.pointer || checkpoint.fine.note || Object.keys(checkpoint.fine.values).length || Object.keys(checkpoint.bulkValues).length || checkpoint.sourceBulk?.request?.target.id || checkpoint.sourceBulk?.request?.draft.text);
}
export function adaptWorkbenchViewCheckpoint(checkpoint: WorkbenchCheckpoint, context: WorkbenchCheckpointContext, currentOperations: DatasetOperation[]): WorkbenchCheckpoint {
  if (workbenchCheckpointHasInput(checkpoint) || checkpoint.identity !== context.identity || checkpoint.project !== context.project || checkpoint.branch !== context.branch) return checkpoint;
  return { ...checkpoint, baseCommit: context.baseCommit, schemaHash: context.schemaHash,
    privateDraft: context.draft ? { id: context.draft.id, revision: context.draft.draftRevision } : undefined,
    // A view-only checkpoint must never erase or replay an effective sample draft.
    operations: JSON.parse(JSON.stringify(currentOperations)), editing: false, json: '', jsonBaseline: '', cellEdit: undefined, cellError: '', localError: '', drawer: '', appendRowId: '', appendInfo: '',
    fine: { kind: checkpoint.fine.kind, pointer: '', start: 0, end: 1, values: {}, note: '' }, bulkValues: {}, evaluationBulk: undefined, sourceBulk:undefined, feedback: '',
  };
}
/** Explicit conflict recovery keeps local input active and preserves the other page as read-only evidence. */
export function retainConflictingWorkbenchInput(local: WorkbenchCheckpoint, latest: WorkbenchCheckpoint): WorkbenchCheckpoint {
  if (local.identity !== latest.identity || local.project !== latest.project || local.branch !== latest.branch) throw new Error('最新保存输入的身份、项目或分支不匹配，不能合并输入副本。');
  const fingerprint = (checkpoint: WorkbenchCheckpoint) => { const { savedAt: _time, retainedInputs: _retained, ...input } = checkpoint; return JSON.stringify(input); };
  const retained: WorkbenchCheckpoint[] = [], seen = new Set([fingerprint(local)]);
  for (const checkpoint of [...local.retainedInputs ?? [], ...latest.retainedInputs ?? [], latest]) {
    if (!workbenchCheckpointHasInput(checkpoint)) continue;
    const { retainedInputs: _nested, ...input } = checkpoint, key = fingerprint(input);
    if (seen.has(key)) continue;
    seen.add(key); retained.push(input);
  }
  return { ...local, retainedInputs: retained };
}
export function parseWorkbenchCheckpoint(payload: unknown): WorkbenchCheckpoint | undefined {
  if (!payload || typeof payload !== 'object') return;
  const value = payload as WorkbenchCheckpoint;
  if (value.version !== 2 || !['identity', 'project', 'branch', 'baseCommit', 'schemaHash', 'savedAt', 'json', 'jsonBaseline', 'feedback', 'message', 'search', 'prompt', 'drawer', 'selected'].every(key => typeof value[key as keyof WorkbenchCheckpoint] === 'string')) return;
  if (!Array.isArray(value.operations) || !Array.isArray(value.selectedRows) || !Array.isArray(value.visibleColumns) || !Array.isArray(value.filters) || !value.fine || !['span', 'step'].includes(value.fine.kind)) return;
  if(value.configuredColumnsSeen!==undefined&&(!Array.isArray(value.configuredColumnsSeen)||value.configuredColumnsSeen.some(id=>typeof id!=='string')))return;
  if(value.sourceColumnsSeen!==undefined&&(!Array.isArray(value.sourceColumnsSeen)||value.sourceColumnsSeen.some(id=>typeof id!=='string')))return;
  if(value.evaluationBulk!==undefined&&(!value.evaluationBulk||typeof value.evaluationBulk.patch!=='object'||!Array.isArray(value.evaluationBulk.rowIds)||value.evaluationBulk.rowIds.some(id=>typeof id!=='string')))return;
  if(value.sourceBulk!==undefined&&(!value.sourceBulk||!Array.isArray(value.sourceBulk.rowIds)||value.sourceBulk.rowIds.length>500||value.sourceBulk.rowIds.some(id=>typeof id!=='string')||value.sourceBulk.request!==undefined&&!isDatasetBulkEditRequest(value.sourceBulk.request)))return;
  if (value.operations.some(operation => !operation || typeof operation !== 'object' || !['update', 'append', 'delete', 'assign', 'feedback', 'readme', 'evaluation'].includes(operation.op))) return;
  return value;
}
/** A checkpoint stores input, never permission to replay operations onto a newer head/draft. */
export function workbenchCheckpointIssue(checkpoint: WorkbenchCheckpoint, context: WorkbenchCheckpointContext): string {
  if (checkpoint.identity !== context.identity || checkpoint.project !== context.project || checkpoint.branch !== context.branch) return '保存输入的身份、项目或分支不匹配，禁止套用。';
  if (checkpoint.baseCommit !== context.baseCommit) return '分支基点已改变，保存输入仅供对照和下载；不会自动覆盖新版本。';
  if (checkpoint.schemaHash !== context.schemaHash) return '字段或标签规范已改变，保存输入需人工对照当前规则。';
  if (checkpoint.privateDraft?.id !== context.draft?.id || checkpoint.privateDraft?.revision !== context.draft?.draftRevision) return '有效本机草稿已更新或提交，保存输入不会覆盖或复活旧操作。';
  if (context.historical && (checkpoint.operations.length || checkpoint.editing || checkpoint.cellEdit || checkpoint.drawer)) return '历史版本只读，保存输入仅供对照。';
  if ((checkpoint.operations.some(op => ['update', 'delete'].includes(op.op)) || checkpoint.editing || checkpoint.cellEdit) && !context.canEdit) return '当前权限不可应用正文输入；原始输入仍可下载。';
  if ((checkpoint.operations.some(op => op.op === 'append') || checkpoint.drawer === 'append') && !context.canAppend) return '当前权限不可添加样本；原始输入仍可下载。';
  if ((checkpoint.operations.some(op => op.op === 'assign') || ['fine', 'bulk', 'labels'].includes(checkpoint.drawer)) && !context.canAssign) return '当前权限不可应用标注输入；原始输入仍可下载。';
  if ((checkpoint.operations.some(op => op.op === 'evaluation') || checkpoint.drawer === 'evaluation') && !context.canManageEvaluation) return '当前权限不可应用发布分组输入；原始输入仍可保留对照。';
  if(checkpoint.sourceBulk?.request?.target.id&&checkpoint.sourceBulk.request.target.scope==='source'&&!context.canEdit)return '当前权限不可应用样本字段批量输入；原始输入仍可保留对照。';
  if(checkpoint.sourceBulk?.request?.target.id&&checkpoint.sourceBulk.request.target.scope==='label'&&!context.canAssign)return '当前权限不可应用人工标签批量输入；原始输入仍可保留对照。';
  if(checkpoint.drawer==='source-bulk'&&!context.canEdit&&!context.canAssign)return '当前权限不可应用批量编辑输入；原始输入仍可保留对照。';
  return '';
}
