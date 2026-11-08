import type { DatasetFieldMetadata, DatasetFieldOption } from '../../../packages/shared/src/field-metadata';
import { datasetFieldOptionMatches, datasetFieldValueIssue, datasetRecordFieldIssues } from '../../../packages/shared/src/dataset-field-validation';
import { cellEditorText, cellKind, parseCellEditor, type DatasetCellKind } from './dataset-cell-editing';
import type { DatasetValueState } from './dataset-change-state';

export interface DatasetEditableCellDraft { kind: DatasetCellKind; text: string; presence: 'value' | 'null' | 'missing' }
export type DatasetCellControlKind = 'text' | 'number' | 'checkbox' | 'select' | 'multicheck' | 'json';
export function configuredCellKind(definition: DatasetFieldMetadata | undefined, value: unknown): DatasetCellKind {
  return definition?.type === 'integer' ? 'number' : definition?.type ?? (value === null || value === undefined ? 'string' : cellKind(value));
}
export function createEditableCell(record: Record<string, unknown>, field: string, definition?: DatasetFieldMetadata): DatasetEditableCellDraft {
  const present = Object.hasOwn(record, field), value = record[field], kind = configuredCellKind(definition, value);
  const defaults = { string: '', number: '0', boolean: 'false', null: 'null', array: '[]', object: '{}' };
  return { kind, text: present && value !== null ? cellEditorText(value) : defaults[kind], presence: !present ? 'missing' : value === null ? 'null' : 'value' };
}
export function datasetCellControl(definition: DatasetFieldMetadata | undefined, draft: DatasetEditableCellDraft): DatasetCellControlKind {
  if (definition?.enum) return 'select';
  if ((definition?.type === 'array' || draft.kind === 'array') && definition?.items?.enum) return 'multicheck';
  const kind = configuredCellKind(definition, undefined);
  const effective = definition?.type ? kind : draft.kind;
  return effective === 'boolean' ? 'checkbox' : effective === 'number' ? 'number' : effective === 'string' ? 'text' : 'json';
}
const issues = { required: '此字段必须提供，不能移除。', null: '此字段不允许 null。', type: '字段值与配置的类型不一致。', enum: '请选择配置中的选项。', 'item-type': '列表项与配置的类型不一致。', 'item-enum': '列表包含未配置的选项。' };
export function parseEditableCell(draft: DatasetEditableCellDraft, definition?: DatasetFieldMetadata): DatasetValueState {
  const present = draft.presence !== 'missing';
  const value = !present ? undefined : draft.presence === 'null' ? null : parseCellEditor(draft.text, draft.kind);
  const issue = datasetFieldValueIssue(definition ?? {}, value, present);
  if (issue) throw new Error(issues[issue]);
  return present ? { present: true, value } : { present: false };
}
export function editableCellOptionIndex(draft: DatasetEditableCellDraft, choices: DatasetFieldOption[]): string {
  if (draft.presence !== 'value') return '-1';
  try { const value = parseCellEditor(draft.text, draft.kind); return String(choices.findIndex(option => datasetFieldOptionMatches(value, option))); } catch { return '-1'; }
}
export function editableCellSelectOption(draft: DatasetEditableCellDraft, option: DatasetFieldOption): DatasetEditableCellDraft {
  return { ...draft, presence: 'value', kind: cellKind(option), text: cellEditorText(option) };
}
export function editableCellToggleOption(draft: DatasetEditableCellDraft, option: DatasetFieldOption, selected: boolean): DatasetEditableCellDraft {
  let values: unknown[] = [];
  try { const value = JSON.parse(draft.text); if (Array.isArray(value)) values = value; } catch { /* an explicit choice starts a valid array */ }
  values = values.filter(value => !datasetFieldOptionMatches(value, option));
  if (selected) values.push(option);
  return { ...draft, presence: 'value', kind: 'array', text: JSON.stringify(values) };
}
export function datasetRecordConfigurationError(record: Record<string, unknown>, fields?: Record<string, DatasetFieldMetadata>): string | undefined {
  const issue = datasetRecordFieldIssues(record, fields ?? {})[0];
  return issue ? `“${issue.field}”：${issues[issue.code]}` : undefined;
}
