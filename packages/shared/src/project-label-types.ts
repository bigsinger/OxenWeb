import type { LabelColumn } from './index.js';
import type { PublishedTemplateSnapshot } from './governance-types.js';

export type ProjectLabelValues = Record<string, string | string[]>;
export interface ProjectLabelState {
  ref: 'main'; commitId?: string;
  state: 'ready' | 'unassigned' | 'unconfigured' | 'missing-main';
  template?: PublishedTemplateSnapshot; columns: LabelColumn[]; values: ProjectLabelValues;
  keywords: string[];
  capabilities: { edit: boolean }; updatedBy?: { id: string; name: string }; updatedAt?: string;
}
export interface ProjectLabelSaveInput {
  expectedCommit: string; values: Record<string, string | string[] | null>; message?: string;
}
