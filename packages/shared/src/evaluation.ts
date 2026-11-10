/** Local BFF extension. Evaluation management is separate from source records and annotations. */
export type EvaluationVisibility = 'shared' | 'holdout' | null;
export type EvaluationSuite = 'gold' | 'regression';
export interface EvaluationRow { visibility: EvaluationVisibility; suites: EvaluationSuite[]; familyId: string | null }
export type EvaluationPatch = Partial<EvaluationRow>;
export interface DatasetEvaluation {
  /** Sticky project policy; historical refs without mappings remain unclassified. */
  enabled: boolean;
  rows: Record<string, EvaluationRow>;
  counts?: { shared: number; holdout: number; unclassified: number; gold: number; regression: number };
}
export interface EvaluationPolicy { enabled: boolean; enabledAt?: string; enabledBy?: { id: string; name: string }; operationId?: string }
export interface EvaluationExposure { rowIds: string[]; familyIds: string[]; attachmentHashes?: string[];contentHashes?:string[] }
export const EMPTY_EVALUATION_ROW: EvaluationRow = { visibility: null, suites: [], familyId: null };
