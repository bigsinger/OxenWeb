import type { DatasetDraft, DatasetDraftRebaseInput, DatasetDraftSummary, DatasetOperation } from '../../../packages/shared/src/dataset';

interface DraftRecoveryContext {
  ref: string;
  snapshotCommit?: string;
  latestCommit?: string;
  draft?: DatasetDraft;
  summary?: DatasetDraftSummary;
  operations: DatasetOperation[];
}

export function datasetDraftBase(context: DraftRecoveryContext): string | undefined {
  return context.draft?.baseCommit ?? context.summary?.baseCommit ?? context.snapshotCommit;
}

/** A refreshed page can be current while its private disk draft still has an old base. */
export function datasetDraftNeedsSync(context: DraftRecoveryContext, hasUnstagedInput = false): boolean {
  const base = datasetDraftBase(context);
  return !!base && !!context.latestCommit && base !== context.latestCommit && (!!context.draft || !!context.summary || !!context.operations.length || hasUnstagedInput);
}

export function datasetDraftRebaseInput(context: DraftRecoveryContext): DatasetDraftRebaseInput {
  const expectedBaseCommit = datasetDraftBase(context), state = context.draft ?? context.summary;
  if (!expectedBaseCommit || !context.latestCommit) throw new Error('当前草稿基点或最新分支版本未知，请先核对版本。');
  // Only an inaccessible/stale summary has unknown operations. [] with a full draft is
  // intentional: the user may have cancelled its only append, which must not reappear.
  const operationsKnown = !!context.draft || !context.summary || context.operations.length > 0;
  return { ref: context.ref, expectedBaseCommit, expectedCommit: context.latestCommit, draftRevision: state?.draftRevision ?? 0,
    ...(state ? { expectedDraftId: state.id } : {}), ...(operationsKnown ? { operations: JSON.parse(JSON.stringify(context.operations)) as DatasetOperation[] } : {}) };
}
