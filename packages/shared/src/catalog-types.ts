export interface CatalogTemplateVersion {
  organizationId: string;
  id: string;
  name: string;
  version: number;
  checksum: string;
  domain: string;
  legacy: boolean;
}

export interface DatasetCatalogValue { id: string; value: string; label: string; deprecated?: boolean }
export interface DatasetCatalogField {
  /** Organization and stable dimension identity, never a translated display name. */
  key: string;
  organizationId: string;
  dimensionId: string;
  name: string;
  description: string;
  semanticKey?: string;
  legacy?: boolean;
  role?: 'subject' | 'purpose' | 'source';
  type: 'single' | 'multi' | 'text';
  options: DatasetCatalogValue[];
  values: DatasetCatalogValue[];
  conflicted: boolean;
}
export interface DatasetCatalogSummary {
  branch: string;
  commitId?: string;
  state: 'ready' | 'unassigned' | 'unconfigured' | 'conflicted' | 'unavailable';
  fields: DatasetCatalogField[];
  templates: { dataset?: CatalogTemplateVersion; sample?: CatalogTemplateVersion };
  warnings: string[];
  /** Free project keywords read only from the same fixed main commit, never from other branches. */
  keywords?: string[];
}

/** BFF activity is separate from committed Oxen version metadata. */
export interface RepositoryLocalActivity { createdAt?: string; localDraftAt?: string }
export interface RepositoryActivity extends RepositoryLocalActivity {
  modifiedAt?: string;
  source: 'commit' | 'local-draft' | 'created' | 'unknown';
  committedAt?: string;
  commitId?: string;
  branch?: string;
  state: 'ready' | 'partial' | 'unavailable';
}
export interface RepoCatalogFields {
  catalog?: DatasetCatalogSummary;
  activity?: RepositoryActivity;
  createdAt?: string;
}
export interface CatalogFilter { key: string; values: string[]; unset?: boolean }
