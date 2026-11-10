/** Identity-isolated BFF recovery data, independent of valid sample drafts and Git versions. */
export type DatasetUiStateKind = 'workbench' | 'field-settings' | 'readme' | 'table-layout';
export type DatasetUiJsonValue = null | boolean | number | string | DatasetUiJsonValue[] | { [key: string]: DatasetUiJsonValue };
export interface DatasetUiState {
  id: string; ref: string; kind: DatasetUiStateKind; revision: number;
  baseCommit?: string; payload: DatasetUiJsonValue; updatedAt: string;
}
export interface DatasetUiStateResult { state?: DatasetUiState }
export interface DatasetUiStateSaveInput {
  ref: string; kind: DatasetUiStateKind; revision: number; expectedId?: string;
  baseCommit?: string; payload: DatasetUiJsonValue;
}
export interface DatasetUiStateDeleteInput { ref: string; kind: DatasetUiStateKind; revision: number; expectedId: string }
