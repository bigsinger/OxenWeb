export type AnnotationTaskMode = 'review' | 'independent';
export type AnnotationTaskStatus = 'setting-up' | 'assigned' | 'in-progress' | 'awaiting-review' | 'changes-requested' | 'approved' | 'merged' | 'cancelled' | 'setup-failed';
export interface TaskActor { id: string; name: string }
export interface TaskParticipant extends TaskActor { branch: string }
export interface TaskSubmission {
  actor: TaskActor; branch: string; commitId: string; submittedAt: string;
  fingerprints: Record<string, string>;
}
export interface TaskDecision {
  rowId: string; verdict: 'approved' | 'changes-requested'; comment: string;
  /** Explicitly adjudicated values. Omitted when both independent opinions agree. */
  values?: Record<string, string | string[]>;
  /** Explicit opinion whose span/step evidence is adopted; independent disagreements require this. */
  annotationActorId?: string;
}
export interface TaskReview {
  id: string; taskId: string; reviewer: TaskActor; reviewedAt: string; assignmentRevision: number;
  decisions: TaskDecision[]; submissions: TaskSubmission[];
  commitId: string; storagePath: string; proofHash: string;
  /** Audit only. Catalog metadata does not become the sample review semantic hash. */
  bindingAuditHashes?: Record<string, string>;
}
export interface AnnotationTask {
  id: string; title: string; namespace: string; repo: string; revision: number; assignmentRevision: number;
  mode: AnnotationTaskMode; status: AnnotationTaskStatus; createdBy: TaskActor; createdAt: string; updatedAt: string;
  baselineCommitId: string; sourceBranch: string; templateHash: string;
  rowIds: string[]; baseHashes: Record<string, string>; participants: TaskParticipant[]; reviewer: TaskActor;
  submissions: TaskSubmission[]; reviews: TaskReview[];
  note?: string; setupError?: string;
}
export interface AnnotationTaskView extends AnnotationTask {
  current: boolean; staleReason?: string;
  progress: { total: number; annotated: number; submitted: number; approved: number; rejected: number; merged: number };
  permissions: { submit: boolean; review: boolean; manage: boolean };
}
export interface WorkflowSummary {
  total: number; active: number; awaitingReview: number; approved: number; stale: number;
  tasks: AnnotationTaskView[]; storage: 'bff-control-plane-and-oxen-review-proofs';
}
export interface WorkflowPreflight {
  ok: boolean; issues: string[];
  acceptedValues: Record<string, Record<string, string | string[]>>;
  acceptedFineAnnotations: Record<string, { actorId: string; spans: import('./dataset.js').DatasetSpan[]; steps: import('./dataset.js').DatasetStep[] }>;
  reviewSnapshot: { version: 1; commitId: string; reviews: TaskReview[]; tasks: Array<Pick<AnnotationTask, 'id' | 'title' | 'mode' | 'assignmentRevision' | 'baselineCommitId' | 'participants' | 'reviewer' | 'rowIds'>> };
}
