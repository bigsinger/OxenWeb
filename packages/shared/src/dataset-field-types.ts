import type { DatasetFieldMetadata } from './field-metadata.js';

export interface DatasetFieldSummary {
  id: string; inferredType: string; configured?: DatasetFieldMetadata;
  present: number; missing: number; nulls: number; observedTypes: Record<string, number>;
}
export interface DatasetFieldsState {
  ref: string; commitId: string; path: string; totalRows: number;
  configuration: Record<string, DatasetFieldMetadata>; fields: DatasetFieldSummary[];
  protectedFields: string[]; capabilities: { edit: boolean; delete?: boolean };
  globalFields?: { active: string[]; retired: string[] };
}
/** Local BFF extension: removes an editable source key from current records in one new commit. */
export interface DatasetFieldDeleteInput {
  ref: string; expectedCommit: string; fieldId: string; confirmFieldId: string; message?: string;
}
export interface DatasetFieldsSaveInput {
  ref: string; expectedCommit: string; fields: Record<string, DatasetFieldMetadata>; message?: string;
}
export interface DatasetFieldConflict {
  field: string; rowId: string;
  code: 'required' | 'null' | 'type' | 'enum' | 'item-type' | 'item-enum';
}
export interface DatasetFieldConflictSummary {
  conflictCount: number; affectedRows: number; conflicts: DatasetFieldConflict[]; truncated: boolean;
}
