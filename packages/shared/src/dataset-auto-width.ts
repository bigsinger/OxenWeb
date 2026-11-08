/** Read-only local content sampling; response deliberately contains no sample values. */
export interface DatasetAutoWidthInput {
  ref: string; expectedCommit: string;
  fields: Array<{ id: string; displayName?: string }>;
}
export interface DatasetAutoWidthPlan {
  commitId: string; totalRows: number; sampledRows: number;
  method: 'random-p85';
  fields: Array<{ id: string; weight: number; sampledValues: number; displayUnits: number }>;
}
