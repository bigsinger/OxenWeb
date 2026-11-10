import type { LabelColumn, LabelScope, LabelTemplate, RepoLocation } from './index.js';

export type TemplateTargetKind = 'dataset' | 'sample' | 'legacy';
export type SchemaLayer = 'dataset' | 'sample';
export interface GovernanceDomain { id:string; name:string; description:string }
export interface GovernancePreset extends LabelTemplate {targetKind:TemplateTargetKind;domain:string;defaultVisibleKeys:string[]}

export type DatasetCapability = 'read' | 'data.edit' | 'dataset.assign' | 'annotation.assign' | 'annotation.review' | 'tasks.manage' | 'schema.bind' | 'schema.manage' | 'merge.execute' | 'release.manage' | 'release.share' | 'release.hidden' | 'data.export' | 'project.admin';
export interface GovernanceOption { id: string; displayName: string; description?: string; deprecated?: boolean; legacyValue?: string }
export interface DimensionDraft { id: string; displayName: string; type: 'single' | 'multi' | 'text'; description: string; semanticKey?: string; options: GovernanceOption[] }
export interface PublishedDimension extends DimensionDraft { version: number; checksum: string; publishedAt: string; publishedBy: string }
export interface GovernanceDimension { id: string; revision: number; draft: DimensionDraft; versions: PublishedDimension[]; deprecated: boolean; updatedAt: string; updatedBy: string }
export interface TemplateDimensionBinding { dimensionId: string; dimensionVersion: number; scopes: LabelScope[]; required: boolean; order: number; defaultVisible?: boolean }
/** Missing targetKind denotes an immutable pre-R3 mixed-scope snapshot. Never backfill it into published content. */
export interface TemplateDraft { id: string; name: string; domain: string; description: string; bindings: TemplateDimensionBinding[]; targetKind?: TemplateTargetKind }
export interface PublishedTemplateSnapshot extends TemplateDraft { organizationId: string; version: number; checksum: string; publishedAt: string; publishedBy: string; dimensions: PublishedDimension[]; columns: LabelColumn[] }
export interface GovernanceTemplate { id: string; revision: number; draft: TemplateDraft; versions: PublishedTemplateSnapshot[]; deprecated: boolean; updatedAt: string; updatedBy: string }
export interface GovernanceOrganization { id: string; name: string; revision: number; maintainers: Array<{ id: string; name: string }>; dimensions: GovernanceDimension[]; templates: GovernanceTemplate[]; domains?:GovernanceDomain[] }
export interface GovernanceAccess { owner: boolean; canManage: boolean; organizations: Array<{ id: string; name: string; canManage: boolean }> }
export interface GovernanceFeedback { id: string; organizationId: string; project: RepoLocation; templateId?: string; dimensionId?: string; requestedOption?: string; reason: string; authorId: string; authorName: string; createdAt: string; status: 'open' | 'resolved' | 'declined'; response?: string; respondedBy?: string }
export interface GovernanceAudit { id: string; organizationId: string; action: string; objectId: string; actorId: string; actorName: string; at: string; revision: number }
export interface GovernanceDirectory { organization: GovernanceOrganization; feedback: GovernanceFeedback[]; audit: GovernanceAudit[] }
export interface ProjectTemplateLayer { organizationId:string; templateId:string; templateVersion:number; checksum:string; snapshot:PublishedTemplateSnapshot; boundAt:string; boundBy:string }
export interface TemplateSelection {organizationId:string;templateId:string;templateVersion:number}
export interface BindSchemaLayersInput {ref:string;expectedCommit:string;layers:{dataset?:TemplateSelection;sample?:TemplateSelection}}
export interface ProjectSchemaBindingV1 extends ProjectTemplateLayer { version:1 }
export interface ProjectSchemaBindingV2 { version:2; layers:{dataset?:ProjectTemplateLayer;sample?:ProjectTemplateLayer}; legacy?:ProjectSchemaBindingV1; legacyColumns?:LabelColumn[]; checksum:string; boundAt:string; boundBy:string }
export type ProjectSchemaBinding = ProjectSchemaBindingV1 | ProjectSchemaBindingV2;
export interface ProjectSchemaState { commitId:string; binding?:ProjectSchemaBinding; columnsByScope:Record<LabelScope,LabelColumn[]> }
