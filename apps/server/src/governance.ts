import {durableWriteJson} from './durable-store.js';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { DimensionDraft, GovernanceAccess, GovernanceAudit, GovernanceDirectory, GovernanceFeedback, GovernanceOrganization, GovernanceTemplate, LabelColumn, LabelScope, ProjectSchemaBinding, ProjectSchemaBindingV1, ProjectSchemaBindingV2, ProjectSchemaState, ProjectTemplateLayer, PublishedDimension, PublishedTemplateSnapshot, RequestIdentity, SchemaLayer, TemplateDraft, TemplateTargetKind, GovernanceDomain } from '../../../packages/shared/src/index.js';
import type { Provider, RepoKey } from './provider.js';
import type { RepositoryAccessService } from './repository-access.js';
import { ApiError } from './errors.js';
import { safeRef, safeSegment } from './safety.js';
import { labelColumnSchema, validateLabelDocument, LABEL_PATH } from './labels.js';
import { getGovernancePreset } from './label-templates.js';
import { defaultGlobalFieldCatalog, type GlobalFieldAccess, type GlobalFieldCatalog, type GlobalFieldCatalogState, type GlobalFieldDefinition } from '../../../packages/shared/src/global-fields.js';
import { globalFieldCatalogSchema, validateGlobalFieldDefinitions } from './global-field-catalog.js';
import { operationContext } from './operation-context.js';

export const SCHEMA_BINDING_PATH = '.oxenweb/schema-binding.json';
const id = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
const optionId = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
export const dimensionDraftSchema = z.object({ id, displayName: z.string().trim().min(1).max(80), type: z.enum(['single', 'multi', 'text']), description: z.string().trim().max(2000), semanticKey: z.string().regex(/^[a-z][a-z0-9_.-]{0,95}$/).optional(), options: z.array(z.object({ id: optionId, displayName: z.string().trim().min(1).max(120), description: z.string().trim().max(1000).optional(), deprecated: z.boolean().optional(), legacyValue: z.string().min(1).max(120).optional() }).strict()).max(200) }).strict();
const scopes = z.array(z.enum(['dataset', 'file', 'row'])).min(1).max(3).refine(values => new Set(values).size === values.length);
export const domainSchema=z.object({id,name:z.string().trim().min(1).max(80),description:z.string().trim().max(2000)}).strict();
export const templateDraftSchema = z.object({ id, name: z.string().trim().min(1).max(120), domain: z.string().trim().min(1).max(80), targetKind:z.enum(['dataset','sample','legacy']).optional(), description: z.string().trim().max(2000), bindings: z.array(z.object({ dimensionId: id, dimensionVersion: z.number().int().positive(), scopes, required: z.boolean(), order: z.number().int().min(0).max(1000),defaultVisible:z.boolean().optional() }).strict()).min(1).max(100) }).strict();
const publishedDimensionSchema = dimensionDraftSchema.extend({ version: z.number().int().positive(), checksum: z.string().regex(/^[a-f0-9]{64}$/), publishedAt: z.string().datetime(), publishedBy: z.string() });
const publishedTemplateSchema = templateDraftSchema.extend({ organizationId: id, version: z.number().int().positive(), checksum: z.string().regex(/^[a-f0-9]{64}$/), publishedAt: z.string().datetime(), publishedBy: z.string(), dimensions: z.array(publishedDimensionSchema).max(100), columns: z.array(labelColumnSchema).max(100) });
const templateLayerSchema=z.object({organizationId:id,templateId:id,templateVersion:z.number().int().positive(),checksum:z.string().regex(/^[a-f0-9]{64}$/),snapshot:publishedTemplateSchema,boundAt:z.string(),boundBy:z.string()}).strict();
const v1BindingSchema=templateLayerSchema.extend({version:z.literal(1)}).strict();
const v2BindingSchema=z.object({version:z.literal(2),layers:z.object({dataset:templateLayerSchema.optional(),sample:templateLayerSchema.optional()}).strict().refine(value=>value.dataset||value.sample),legacy:v1BindingSchema.optional(),legacyColumns:z.array(labelColumnSchema).max(1000).optional(),checksum:z.string().regex(/^[a-f0-9]{64}$/),boundAt:z.string(),boundBy:z.string()}).strict();
const organizationSchema = z.object({ id, name: z.string().min(1).max(120), revision: z.number().int().positive(), domains:z.array(domainSchema).max(200).optional(), maintainers: z.array(z.object({ id: z.string(), name: z.string() })), dimensions: z.array(z.object({ id, revision: z.number().int().positive(), draft: dimensionDraftSchema, versions: z.array(publishedDimensionSchema), deprecated: z.boolean(), updatedAt: z.string(), updatedBy: z.string() })), templates: z.array(z.object({ id, revision: z.number().int().positive(), draft: templateDraftSchema, versions: z.array(publishedTemplateSchema), deprecated: z.boolean(), updatedAt: z.string(), updatedBy: z.string() })) });
const feedbackSchema = z.object({ id: z.string().uuid(), organizationId: id, project: z.object({ namespace: z.string(), repo: z.string() }), templateId: id.optional(), dimensionId: id.optional(), requestedOption: z.string().max(120).optional(), reason: z.string().min(1).max(2000), authorId: z.string(), authorName: z.string(), createdAt: z.string(), status: z.enum(['open', 'resolved', 'declined']), response: z.string().max(2000).optional(), respondedBy: z.string().optional() });
const stateSchema = z.object({ version: z.literal(1), organizations: z.array(organizationSchema).max(1000), feedback: z.array(feedbackSchema).max(10000), globalFields: globalFieldCatalogSchema.optional(), globalFieldHistory:z.array(globalFieldCatalogSchema).max(10000).optional(), globalFieldProjects:z.array(z.object({namespace:z.string().transform(safeSegment),repo:z.string().transform(safeSegment)}).strict()).max(100000).optional(), globalFieldMaintainers:z.array(z.object({id:z.string().uuid(),name:z.string().max(120)}).strict()).max(1000).optional(), audit: z.array(z.object({ id: z.string(), organizationId: z.string(), action: z.string(), objectId: z.string(), actorId: z.string(), actorName: z.string(), at: z.string(), revision: z.number() })).max(50000) }).strict();
type State = z.infer<typeof stateSchema>;
function canonical(value: unknown): unknown { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])); return value; }
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const at = () => new Date().toISOString();
function markGovernanceWrite(){const execution=operationContext.getStore();if(execution)execution.writeAttempted=true;}
export const defaultGovernanceDomains:GovernanceDomain[]=[{id:'general',name:'通用',description:'跨业务复用的数据集与样本质量规范。'},{id:'ai-safety',name:'AI 安全',description:'AI 安全数据集目录分类与样本专题分析。'}];
export const getTemplateTargetKind=(snapshot:Pick<TemplateDraft,'targetKind'>):TemplateTargetKind=>snapshot.targetKind??'legacy';
const scoped=(columns:LabelColumn[],scope:LabelScope)=>columns.filter(column=>!column.scopes||column.scopes.includes(scope));
/** Fixed historical V1 commits remain readable. Current V2 layers never inherit retired definitions. */
export function getBindingSnapshot(binding:ProjectSchemaBinding|undefined,scope:LabelScope):PublishedTemplateSnapshot|undefined{return binding?.version===1?binding.snapshot:binding?.layers[scope==='dataset'?'dataset':'sample']?.snapshot;}
export function getBindingColumns(binding:ProjectSchemaBinding|undefined,scope:LabelScope):LabelColumn[]{return structuredClone(scoped(getBindingSnapshot(binding,scope)?.columns??[],scope));}
function schemaState(commitId:string,binding?:ProjectSchemaBinding):ProjectSchemaState{return {commitId,...(binding?{binding}:{}),columnsByScope:{dataset:getBindingColumns(binding,'dataset'),file:getBindingColumns(binding,'file'),row:getBindingColumns(binding,'row')}};}
function verifyLayer(layer:ProjectTemplateLayer,kind?:SchemaLayer){const {checksum,publishedAt:_at,publishedBy:_by,...content}=layer.snapshot;if(checksum!==digest(content)||layer.checksum!==checksum||layer.templateId!==layer.snapshot.id||layer.templateVersion!==layer.snapshot.version||layer.organizationId!==layer.snapshot.organizationId||kind&&getTemplateTargetKind(layer.snapshot)!==kind)throw new ApiError(422,'SCHEMA_BINDING_INVALID','规范快照引用、用途或校验不一致。');}
const v2Digest=(binding:Pick<ProjectSchemaBindingV2,'layers'|'legacy'|'legacyColumns'>)=>digest({version:2,layers:binding.layers,legacy:binding.legacy,legacyColumns:binding.legacyColumns});
function conflict() { throw new ApiError(409, 'GOVERNANCE_REVISION_CONFLICT', '规范已被其他人更新，请重新加载后再保存。'); }
function validateDimension(draft: DimensionDraft, previous?: PublishedDimension) {
  if (draft.type !== 'text' && !draft.options.length || draft.type === 'text' && draft.options.length) throw new ApiError(422, 'GOVERNANCE_OPTIONS', '选项型维度必须有选项，文本型维度不能有选项。');
  if (new Set(draft.options.map(option => option.id)).size !== draft.options.length || new Set(draft.options.map(option => option.legacyValue ?? option.id)).size !== draft.options.length) throw new ApiError(422, 'GOVERNANCE_OPTION_DUPLICATE', '选项 ID 和兼容值必须唯一。');
  if (previous && (previous.type !== draft.type || previous.semanticKey !== draft.semanticKey)) throw new ApiError(409, 'GOVERNANCE_ID_IMMUTABLE', '已发布维度的类型及语义键不可改写，请创建新维度。');
  if (previous?.options.some(option => !draft.options.some(current => current.id === option.id && current.legacyValue === option.legacyValue))) throw new ApiError(409, 'GOVERNANCE_OPTION_IMMUTABLE', '已发布选项只能弃用，不能删除或改变其 ID／兼容值。');
}
export function validateGovernedAssignment(snapshot: PublishedTemplateSnapshot, scope: LabelScope, values: Record<string, string | string[]>, previous: Record<string, string | string[]> = {}) {
  for (const [columnId, value] of Object.entries(values)) {
    const binding = snapshot.bindings.find(item => item.dimensionId === columnId), dimension = snapshot.dimensions.find(item => item.id === columnId);
    if((!binding||!dimension||!binding.scopes.includes(scope))&&Object.hasOwn(previous,columnId)&&digest(previous[columnId])===digest(value))continue;
    if (!binding || !dimension || !binding.scopes.includes(scope)) throw new ApiError(422, 'GOVERNANCE_ASSIGNMENT_SCOPE', '此维度不属于当前已发布规范或适用层级。');
    const selected = Array.isArray(value) ? value : [value], old = previous[columnId], retained = Array.isArray(old) ? old : old === undefined ? [] : [old];
    if (dimension.options.some(option => option.deprecated && selected.includes(option.legacyValue ?? option.id) && !retained.includes(option.legacyValue ?? option.id))) throw new ApiError(409, 'GOVERNANCE_OPTION_DEPRECATED', '已弃用选项仅保留历史值，不能用于新的赋值。');
  }
}

/** Local control plane. Catalog snapshots are immutable; no Oxen server/kernel changes. */
export class GovernanceService {
  private state: State = { version: 1, organizations: [], feedback: [], audit: [] };
  private chain = Promise.resolve();
  private bindingValidator?: (key: RepoKey, commitId: string, snapshot: PublishedTemplateSnapshot, layer?:SchemaLayer, currentBinding?:ProjectSchemaBinding) => Promise<void>;
  constructor(readonly provider: Provider, readonly access: RepositoryAccessService, private filename: string) {}
  setBindingValidator(validator: (key: RepoKey, commitId: string, snapshot: PublishedTemplateSnapshot, layer?:SchemaLayer, currentBinding?:ProjectSchemaBinding) => Promise<void>) { this.bindingValidator = validator; }
  async init(organizations: string[] = ['local', 'oxen']) {
    try { const content = await readFile(this.filename); if (content.length > 32 * 1024 * 1024) throw new Error('Governance catalog too large'); this.state = stateSchema.parse(JSON.parse(content.toString('utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new ApiError(503, 'GOVERNANCE_UNAVAILABLE', '规范控制面无法读取，已停止管理操作。'); this.state.organizations = [...new Set(organizations)].map(value => ({ id: id.parse(value), name: value, revision: 1, maintainers: [], dimensions: [], templates: [] })); }
    this.access.setSchemaAuthorizer((key, identity) => this.canManage(identity, key.namespace));
    if(this.state.globalFields)validateGlobalFieldDefinitions(this.state.globalFields.fields);
    for(const [index,snapshot] of (this.state.globalFieldHistory??[]).entries()){
      validateGlobalFieldDefinitions(snapshot.fields);
      if(index&&snapshot.revision<=(this.state.globalFieldHistory![index-1]!.revision))throw new ApiError(503,'GOVERNANCE_UNAVAILABLE','全局字段历史版本顺序无效。');
    }
    const last=this.state.globalFieldHistory?.at(-1);if(last&&digest(last)!==digest(this.globalFieldCatalog()))throw new ApiError(503,'GOVERNANCE_UNAVAILABLE','全局字段当前目录与历史快照不一致。');
  }
  private org(state: State, organizationId: string): GovernanceOrganization { const organization = state.organizations.find(item => item.id === organizationId); if (!organization) throw new ApiError(404, 'ORGANIZATION_NOT_FOUND', '组织不存在。'); return organization; }
  async canManage(identity: RequestIdentity, organizationId: string): Promise<boolean> { return await this.access.active(identity) && (identity.kind === 'owner' || !!this.state.organizations.find(item => item.id === organizationId)?.maintainers.some(item => item.id === identity.id)); }
  async requireSchemaMaintainer(identity: RequestIdentity, organizationId: string) { if (!await this.canManage(identity, organizationId)) throw new ApiError(403, 'SCHEMA_MAINTAINER_REQUIRED', '仅实例管理员或此组织指定的规范维护者可管理目录。'); }
  async accessState(identity: RequestIdentity): Promise<GovernanceAccess> { const owner = identity.kind === 'owner' && await this.access.active(identity); const organizations = []; for (const org of this.state.organizations) if (await this.canManage(identity, org.id)) organizations.push({ id: org.id, name: org.name, canManage: true }); return { owner, canManage: owner || organizations.length > 0, organizations }; }
  globalFieldCatalog(): GlobalFieldCatalog { return structuredClone(this.state.globalFields ?? defaultGlobalFieldCatalog()); }
  globalFieldHistory(): GlobalFieldCatalog[] { return structuredClone(this.state.globalFieldHistory??[this.globalFieldCatalog()]); }
  private appendGlobalFieldHistory(state:State,previous:GlobalFieldCatalog){
    const history=structuredClone(state.globalFieldHistory??[previous]);history.push(structuredClone(state.globalFields!));state.globalFieldHistory=history;
    if(Buffer.byteLength(JSON.stringify(state))>28*1024*1024)throw new ApiError(413,'GLOBAL_FIELD_HISTORY_CAPACITY','全局字段历史存储接近容量上限，请由管理员扩容后重试；历史未被裁剪。');
  }
  async requireGlobalFieldAdmin(identity:RequestIdentity){if(!(await this.globalFieldAccess(identity)).owner)throw new ApiError(403,'GLOBAL_FIELD_ADMIN_REQUIRED','仅有效的实例管理员可修改全局字段或同步全局项目规则。');}
  globalFieldsManaged(key:RepoKey):boolean { return (this.state.globalFieldProjects??[]).some(item=>item.namespace===key.namespace&&item.repo===key.repo); }
  /** Sticky access boundary: restoring a pre-adoption data commit must not revive old unrestricted releases. */
  async markGlobalFieldsManaged(key:RepoKey):Promise<void> {
    const repository={namespace:safeSegment(key.namespace),repo:safeSegment(key.repo)};
    const run=this.chain.then(async()=>{if(this.globalFieldsManaged(repository))return;const state=structuredClone(this.state);state.globalFieldProjects=[...(state.globalFieldProjects??[]),repository];stateSchema.parse(state);await mkdir(path.dirname(this.filename),{recursive:true});markGovernanceWrite();await durableWriteJson(this.filename,state);this.state=state;});this.chain=run.then(()=>{},()=>{});return run;
  }
  async globalFieldAccess(identity: RequestIdentity): Promise<GlobalFieldAccess> {
    const active=await this.access.active(identity),owner=active&&identity.kind==='owner',canManage=owner||active&&!!this.state.globalFieldMaintainers?.some(item=>item.id===identity.id);
    return {owner,canEdit:owner,canManage,maintainers:canManage?structuredClone(this.state.globalFieldMaintainers??[]):[]};
  }
  async globalFieldState(identity: RequestIdentity): Promise<GlobalFieldCatalogState> {
    if (identity.kind === 'guest' || !await this.access.active(identity)) throw new ApiError(401, 'AUTH_REQUIRED', '请登录后读取字段目录。');
    return { catalog: this.globalFieldCatalog(), ...await this.globalFieldAccess(identity) };
  }
  async saveGlobalFields(identity: RequestIdentity, fields: GlobalFieldDefinition[], expectedRevision: number): Promise<GlobalFieldCatalogState> {
    const run = this.chain.then(async () => {
      await this.requireGlobalFieldAdmin(identity);
      const previous = this.globalFieldCatalog();
      if (previous.revision !== expectedRevision) throw new ApiError(409, 'GLOBAL_FIELDS_REVISION_CONFLICT', '全局字段已被其他人更新，请重新加载后核对。');
      validateGlobalFieldDefinitions(fields);
      const state = structuredClone(this.state), timestamp = at();
      state.globalFields = globalFieldCatalogSchema.parse({ version: 1, revision: previous.revision + 1, fields, updatedAt: timestamp, updatedBy: identity.id });
      state.audit.push({ id: randomUUID(), organizationId: '__global__', action: 'global-fields.update', objectId: 'global-fields', actorId: identity.id, actorName: identity.name, at: timestamp, revision: state.globalFields.revision });
      this.appendGlobalFieldHistory(state,previous);
      stateSchema.parse(state); await mkdir(path.dirname(this.filename), { recursive: true });
      await this.requireGlobalFieldAdmin(identity);
      markGovernanceWrite();await durableWriteJson(this.filename, state); this.state = state;
      return { catalog: this.globalFieldCatalog(), ...await this.globalFieldAccess(identity) };
    }); this.chain = run.then(() => {}, () => {}); return run;
  }
  async setGlobalFieldMaintainer(identity: RequestIdentity, identityId: string, enabled: boolean, expectedRevision: number): Promise<GlobalFieldCatalogState> {
    const run=this.chain.then(async()=>{
      if(!(await this.globalFieldAccess(identity)).owner)throw new ApiError(403,'OWNER_REQUIRED','仅实例管理员可指定全局字段维护者。');
      const previous=this.globalFieldCatalog();if(previous.revision!==expectedRevision)throw new ApiError(409,'GLOBAL_FIELDS_REVISION_CONFLICT','全局字段目录已变化，请重新加载。');
      const member=this.access.identityDirectory().find(item=>item.id===identityId)??(!enabled?this.state.globalFieldMaintainers?.find(item=>item.id===identityId):undefined);if(!member)throw new ApiError(404,'IDENTITY_NOT_FOUND','请先创建独立有效的协作者身份。');
      const state=structuredClone(this.state),timestamp=at();state.globalFieldMaintainers=(state.globalFieldMaintainers??[]).filter(item=>item.id!==identityId);if(enabled)state.globalFieldMaintainers.push({id:member.id,name:member.name});
      state.globalFields={...previous,revision:previous.revision+1,updatedAt:timestamp,updatedBy:identity.id};state.audit.push({id:randomUUID(),organizationId:'__global__',action:'global-fields.maintainer',objectId:identityId,actorId:identity.id,actorName:identity.name,at:timestamp,revision:state.globalFields.revision});this.appendGlobalFieldHistory(state,previous);stateSchema.parse(state);await mkdir(path.dirname(this.filename),{recursive:true});await this.requireGlobalFieldAdmin(identity);markGovernanceWrite();await durableWriteJson(this.filename,state);this.state=state;
      return {catalog:this.globalFieldCatalog(),...await this.globalFieldAccess(identity)};
    });this.chain=run.then(()=>{},()=>{});return run;
  }
  async directory(identity: RequestIdentity, organizationId: string): Promise<GovernanceDirectory> {
    await this.requireSchemaMaintainer(identity, organizationId);
    const feedback = [];
    for (const item of this.state.feedback.filter(item => item.organizationId === organizationId)) { const visible = (await this.access.permissions(item.project, identity)).read; feedback.push({ ...item, project: visible ? item.project : { namespace: '', repo: '无数据访问权限的项目' } }); }
    const organization=structuredClone(this.org(this.state,organizationId));organization.domains=[...defaultGovernanceDomains,...(organization.domains??[]).filter(domain=>!defaultGovernanceDomains.some(item=>item.id===domain.id))];
    for(const template of organization.templates)if(!organization.domains.some(domain=>domain.id===template.draft.domain))organization.domains.push({id:template.draft.domain,name:template.draft.domain,description:'历史模板领域，保留原分类。'});
    return structuredClone({ organization, feedback, audit: this.state.audit.filter(item => item.organizationId === organizationId).slice(-200) });
  }
  private mutate<T>(identity: RequestIdentity, organizationId: string, action: string, objectId: string, change: (state: State) => T): Promise<T> {
    const result = this.chain.then(async () => {
      if (!await this.access.active(identity)) throw new ApiError(403, 'IDENTITY_REVOKED', '当前身份已失效。');
      if (!['organization.create', 'maintainer.change', 'feedback.create'].includes(action)) await this.requireSchemaMaintainer(identity, organizationId);
      const state = structuredClone(this.state), value = change(state), organization = this.org(state, organizationId); organization.revision++;
      state.audit.push({ id: randomUUID(), organizationId, action, objectId, actorId: identity.id, actorName: identity.name, at: at(), revision: organization.revision });
      stateSchema.parse(state); await mkdir(path.dirname(this.filename), { recursive: true }); markGovernanceWrite();await durableWriteJson(this.filename,state); this.state = state; return structuredClone(value);
    }); this.chain = result.then(() => {}, () => {}); return result;
  }
  async createOrganization(identity: RequestIdentity, organizationId: string, name: string) { if (identity.kind !== 'owner') throw new ApiError(403, 'OWNER_REQUIRED', '仅实例管理员可创建组织。'); id.parse(organizationId); return this.mutate(identity, organizationId, 'organization.create', organizationId, state => { if (state.organizations.some(item => item.id === organizationId)) conflict(); const organization = { id: organizationId, name, revision: 1, maintainers: [], dimensions: [], templates: [] }; state.organizations.push(organization); return organization; }); }
  async setMaintainer(identity: RequestIdentity, organizationId: string, identityId: string, enabled: boolean, expectedRevision: number) {
    if (identity.kind !== 'owner') throw new ApiError(403, 'OWNER_REQUIRED', '仅实例管理员可指定规范维护者。');
    const member = this.access.identityDirectory().find(item => item.id === identityId) ?? (!enabled ? this.org(this.state, organizationId).maintainers.find(item => item.id === identityId) : undefined); if (!member) throw new ApiError(404, 'IDENTITY_NOT_FOUND', '请先创建独立有效的协作者身份。');
    return this.mutate(identity, organizationId, 'maintainer.change', identityId, state => { const org = this.org(state, organizationId); if (org.revision !== expectedRevision) conflict(); org.maintainers = org.maintainers.filter(item => item.id !== identityId); if (enabled) org.maintainers.push(member); return org; });
  }
  async saveDimension(identity: RequestIdentity, organizationId: string, input: DimensionDraft, expectedRevision: number) {
    await this.requireSchemaMaintainer(identity, organizationId); const draft = dimensionDraftSchema.parse(input);
    return this.mutate(identity, organizationId, 'dimension.draft', draft.id, state => { const org = this.org(state, organizationId), existing = org.dimensions.find(item => item.id === draft.id); if ((existing?.revision ?? 0) !== expectedRevision) conflict(); validateDimension(draft, existing?.versions.at(-1)); if (org.dimensions.some(item => item.id !== draft.id && item.draft.semanticKey && item.draft.semanticKey === draft.semanticKey)) throw new ApiError(409, 'GOVERNANCE_SEMANTIC_KEY', '同一组织的语义键不能重复。'); const item = { id: draft.id, revision: (existing?.revision ?? 0) + 1, draft, versions: existing?.versions ?? [], deprecated: existing?.deprecated ?? false, updatedAt: at(), updatedBy: identity.id }; if (existing) Object.assign(existing, item); else org.dimensions.push(item); return item; });
  }
  async publishDimension(identity: RequestIdentity, organizationId: string, dimensionId: string, expectedRevision: number) {
    await this.requireSchemaMaintainer(identity, organizationId);
    return this.mutate(identity, organizationId, 'dimension.publish', dimensionId, state => { const item = this.org(state, organizationId).dimensions.find(item => item.id === dimensionId); if (!item) throw new ApiError(404, 'DIMENSION_NOT_FOUND', '维度不存在。'); if (item.revision !== expectedRevision) conflict(); validateDimension(item.draft, item.versions.at(-1)); if (item.deprecated) throw new ApiError(409, 'GOVERNANCE_DEPRECATED', '已弃用维度不能发布新版。'); if (item.versions.at(-1)?.checksum === digest(item.draft)) throw new ApiError(409, 'GOVERNANCE_NO_CHANGES', '草稿与当前发布版本一致。'); item.versions.push({ ...structuredClone(item.draft), version: item.versions.length + 1, checksum: digest(item.draft), publishedAt: at(), publishedBy: identity.id }); item.revision++; return item; });
  }
  async saveTemplate(identity: RequestIdentity, organizationId: string, input: TemplateDraft, expectedRevision: number) {
    await this.requireSchemaMaintainer(identity, organizationId); const draft = templateDraftSchema.parse(input);
    return this.mutate(identity, organizationId, 'template.draft', draft.id, state => { const org = this.org(state, organizationId), existing = org.templates.find(item => item.id === draft.id); if ((existing?.revision ?? 0) !== expectedRevision) conflict();if(existing?.deprecated)throw new ApiError(409,'GOVERNANCE_DEPRECATED','已弃用定义不能再编辑。');if(existing?.versions.length&&getTemplateTargetKind(existing.versions.at(-1)!)!==getTemplateTargetKind(draft))throw new ApiError(409,'GOVERNANCE_TARGET_IMMUTABLE','模板发布后不能更改用途层级，请另存新模板。');if(getTemplateTargetKind(draft)!=='legacy'&&![...defaultGovernanceDomains,...(org.domains??[])].some(domain=>domain.id===draft.domain))throw new ApiError(422,'GOVERNANCE_DOMAIN_REQUIRED','请先在本组织新增领域。');this.buildSnapshot(org, draft, 1, identity); const item = { id: draft.id, revision: (existing?.revision ?? 0) + 1, draft, versions: existing?.versions ?? [], deprecated: existing?.deprecated ?? false, updatedAt: at(), updatedBy: identity.id }; if (existing) Object.assign(existing, item); else org.templates.push(item); return item; });
  }
  private buildSnapshot(org: GovernanceOrganization, draft: TemplateDraft, version: number, identity: RequestIdentity): PublishedTemplateSnapshot {
    if (new Set(draft.bindings.map(binding => binding.dimensionId)).size !== draft.bindings.length) throw new ApiError(422, 'GOVERNANCE_DIMENSION_DUPLICATE', '模板维度不能重复。');
    const kind=getTemplateTargetKind(draft);if(kind==='dataset'&&draft.bindings.some(binding=>binding.scopes.some(scope=>scope!=='dataset'))||kind==='sample'&&draft.bindings.some(binding=>binding.scopes.includes('dataset')))throw new ApiError(422,'GOVERNANCE_TEMPLATE_SCOPE','数据集模板只允许 dataset；样本模板只允许 row/file。');
    const bindings = [...draft.bindings].sort((a, b) => a.order - b.order), dimensions = bindings.map(binding => { const dimension = org.dimensions.find(item => item.id === binding.dimensionId); const published = dimension?.versions.find(item => item.version === binding.dimensionVersion); if (!published || dimension?.deprecated) throw new ApiError(422, 'GOVERNANCE_PUBLISHED_DIMENSION', '模板只能绑定有效的已发布维度版本。'); return structuredClone(published); });
    const columns = dimensions.map((dimension, index) => ({ id: dimension.id, name: dimension.displayName, type: dimension.type, description: dimension.description, semanticKey: dimension.semanticKey ?? `${org.id}.${dimension.id}`, scopes: bindings[index]!.scopes, ...(dimension.type !== 'text' ? { options: dimension.options.map(option => ({ value: option.legacyValue ?? option.id, optionId: option.id, displayName: option.displayName, deprecated: option.deprecated ?? false, description: option.description ?? '' })) } : {}) }));
    validateLabelDocument({ version: 1, columns, assignments: [] }); const content = { ...structuredClone(draft), bindings, organizationId: org.id, version, dimensions, columns };
    return { ...content, checksum: digest(content), publishedAt: at(), publishedBy: identity.id };
  }
  async publishTemplate(identity: RequestIdentity, organizationId: string, templateId: string, expectedRevision: number) {
    await this.requireSchemaMaintainer(identity, organizationId);
    return this.mutate(identity, organizationId, 'template.publish', templateId, state => { const org = this.org(state, organizationId), item = org.templates.find(item => item.id === templateId); if (!item) throw new ApiError(404, 'TEMPLATE_NOT_FOUND', '模板不存在。'); if (item.revision !== expectedRevision) conflict(); if (item.deprecated) throw new ApiError(409, 'GOVERNANCE_DEPRECATED', '已弃用模板不能发布新版。'); const last = item.versions.at(-1); if(last&&getTemplateTargetKind(last)!==getTemplateTargetKind(item.draft))throw new ApiError(409,'GOVERNANCE_TARGET_IMMUTABLE','发布后不能切换模板用途。'); if (last && digest(item.draft) === digest({ id: last.id, name: last.name, domain: last.domain, description: last.description, bindings: last.bindings, ...(last.targetKind?{targetKind:last.targetKind}:{}) })) throw new ApiError(409, 'GOVERNANCE_NO_CHANGES', '草稿与当前发布版本一致。'); item.versions.push(this.buildSnapshot(org, item.draft, item.versions.length + 1, identity)); item.revision++; return item; });
  }
  async deprecate(identity: RequestIdentity, organizationId: string, kind: 'dimensions' | 'templates', objectId: string, expectedRevision: number) { await this.requireSchemaMaintainer(identity, organizationId); return this.mutate(identity, organizationId, `${kind}.deprecate`, objectId, state => { const item = this.org(state, organizationId)[kind].find(item => item.id === objectId); if (!item) throw new ApiError(404, 'GOVERNANCE_OBJECT_NOT_FOUND', '定义不存在。'); if (item.revision !== expectedRevision) conflict(); item.deprecated = true; item.revision++; return item; }); }
  async saveDomain(identity:RequestIdentity,organizationId:string,input:GovernanceDomain,expectedRevision:number){await this.requireSchemaMaintainer(identity,organizationId);const domain=domainSchema.parse(input);return this.mutate(identity,organizationId,'domain.save',domain.id,state=>{const organization=this.org(state,organizationId);if(organization.revision!==expectedRevision)conflict();if(defaultGovernanceDomains.some(item=>item.id===domain.id))throw new ApiError(409,'GOVERNANCE_DOMAIN_BUILTIN','预制领域保持稳定，请创建新的组织领域。');const domains=organization.domains??=[];const existing=domains.find(item=>item.id===domain.id);if(existing)Object.assign(existing,domain);else domains.push(domain);return domain;});}
  async copyTemplate(identity:RequestIdentity,organizationId:string,sourceId:string,sourceVersion:number,templateId:string,name:string){await this.requireSchemaMaintainer(identity,organizationId);id.parse(templateId);return this.mutate(identity,organizationId,'template.copy-published',templateId,state=>{const organization=this.org(state,organizationId);if(organization.templates.some(item=>item.id===templateId))conflict();const source=organization.templates.find(item=>item.id===sourceId)?.versions.find(version=>version.version===sourceVersion);if(!source)throw new ApiError(404,'PUBLISHED_TEMPLATE_NOT_FOUND','只可从明确的已发布版本另存。');const draft:TemplateDraft={id:templateId,name,domain:source.domain,description:source.description,bindings:structuredClone(source.bindings),targetKind:getTemplateTargetKind(source)};this.buildSnapshot(organization,draft,1,identity);const result:GovernanceTemplate={id:templateId,revision:1,draft,versions:[],deprecated:false,updatedAt:at(),updatedBy:identity.id};organization.templates.push(result);return result;});}
  async fromPreset(identity: RequestIdentity, organizationId: string, presetId: string, templateId: string, name: string) {
    await this.requireSchemaMaintainer(identity, organizationId); id.parse(templateId); const preset = getGovernancePreset(presetId, 1);
    return this.mutate(identity, organizationId, 'template.copy-preset', templateId, state => {
      const organization=this.org(state,organizationId);if(organization.templates.some(item=>item.id===templateId))conflict();
      const bindings=preset.columns.map((column,order)=>{
        let dimension=organization.dimensions.find(item=>item.draft.semanticKey===column.semanticKey);
        if(!dimension){
          if(organization.dimensions.some(item=>item.id===column.id))throw new ApiError(409,'GOVERNANCE_DIMENSION_COLLISION','预设维度 ID 与现有不同语义定义冲突，请先明确另存或映射。');
          const draft:DimensionDraft={id:column.id,displayName:column.name,type:column.type,description:column.description,semanticKey:column.semanticKey,options:(column.options??[]).map(option=>({id:option.displayName&&/^[a-z][a-z0-9_-]{0,63}$/.test(option.value)?option.value:'option_'+digest(option.value).slice(0,12),displayName:option.displayName??option.value,description:option.description,...(option.displayName?{}:{legacyValue:option.value})}))};
          const published:PublishedDimension={...draft,version:1,checksum:digest(draft),publishedAt:at(),publishedBy:identity.id};
          dimension={id:draft.id,draft,revision:1,versions:[published],deprecated:false,updatedAt:at(),updatedBy:identity.id};organization.dimensions.push(dimension);
        }
        if(!dimension.versions.length||dimension.deprecated)throw new ApiError(409,'GOVERNANCE_DIMENSION_UNPUBLISHED','现有同语义维度须先发布有效版本。');
        return {dimensionId:dimension.id,dimensionVersion:dimension.versions.at(-1)!.version,scopes:column.scopes,required:false,order,defaultVisible:preset.defaultVisibleKeys.includes(column.id)};
      });
      const result:GovernanceTemplate={id:templateId,revision:1,draft:{id:templateId,name,domain:preset.domain,targetKind:preset.targetKind,description:preset.description,bindings},versions:[],deprecated:false,updatedAt:at(),updatedBy:identity.id};organization.templates.push(result);return result;
    });
  }
  publishedSnapshot(organizationId: string, templateId: string, version: number): PublishedTemplateSnapshot { const snapshot = this.org(this.state, organizationId).templates.find(item => item.id === templateId)?.versions.find(item => item.version === version); if (!snapshot) throw new ApiError(404, 'PUBLISHED_TEMPLATE_NOT_FOUND', '已发布模板版本不存在。'); return structuredClone(snapshot); }
  async consumerTemplates(key:RepoKey,identity:RequestIdentity){await this.access.requireCapability(key,identity,'read');const organization=this.state.organizations.find(item=>item.id===key.namespace);return structuredClone(organization?.templates.filter(item=>!item.deprecated).flatMap(item=>item.versions.map(version=>({id:item.id,name:version.name,version:version.version,domain:version.domain,description:version.description,checksum:version.checksum,targetKind:getTemplateTargetKind(version)})))??[]);}
  async snapshot(key:RepoKey,reference:string):Promise<ProjectSchemaState>{
    safeRef(reference);const commitId=this.provider.resolveRef?await this.provider.resolveRef(key,reference):(await this.provider.branches(key)).find(item=>item.name===reference)?.commitId??(await this.provider.commit(key,reference)).id;
    try{const raw=await this.provider.raw(key,commitId,SCHEMA_BINDING_PATH);if(raw.content.length>8*1024*1024)throw new ApiError(413,'SCHEMA_BINDING_LIMIT','规范快照超过8MiB。');const binding=z.discriminatedUnion('version',[v1BindingSchema,v2BindingSchema]).parse(JSON.parse(raw.content.toString('utf8'))) as ProjectSchemaBinding;
      if(binding.version===1)verifyLayer(binding);else{for(const layer of ['dataset','sample'] as const)if(binding.layers[layer])verifyLayer(binding.layers[layer]!,layer);if(binding.legacy)verifyLayer(binding.legacy);if(binding.checksum!==v2Digest(binding))throw new ApiError(422,'SCHEMA_BINDING_INVALID','分层规范总校验不一致。');}return schemaState(commitId,binding);
    }catch(error){if(error instanceof ApiError&&error.status===404)return schemaState(commitId);throw error;}
  }
  private async checkBindingHead(key:RepoKey,identity:RequestIdentity,ref:string,expectedCommit:string){safeRef(ref);safeRef(expectedCommit);await this.access.requireCapability(key,identity,'schema.bind');if((await this.provider.branches(key)).find(branch=>branch.name===ref)?.commitId!==expectedCommit)throw new ApiError(409,'SCHEMA_BINDING_CONFLICT','分支已更新或不是可写分支，请重新加载后重试。');}
  private selection(key:RepoKey,input:{organizationId:string;templateId:string;templateVersion:number},layer?:SchemaLayer):PublishedTemplateSnapshot{
    if(input.organizationId!==key.namespace)throw new ApiError(403,'TEMPLATE_SCOPE_DENIED','项目仅可采用所属组织授权的已发布模板。');const template=this.org(this.state,input.organizationId).templates.find(item=>item.id===input.templateId);if(template?.deprecated)throw new ApiError(409,'GOVERNANCE_DEPRECATED','此模板已弃用，不能用于新的绑定。');const snapshot=this.publishedSnapshot(input.organizationId,input.templateId,input.templateVersion);if(layer&&getTemplateTargetKind(snapshot)!==layer)throw new ApiError(422,'SCHEMA_BINDING_TARGET','模板用途与所选数据集／样本层不一致。');return snapshot;
  }
  private async legacyLabels(key:RepoKey,commitId:string){try{return validateLabelDocument(JSON.parse((await this.provider.raw(key,commitId,LABEL_PATH)).content.toString('utf8')));}catch(error){if(error instanceof ApiError&&error.status===404)return {version:1 as const,columns:[] as LabelColumn[],assignments:[]};throw error;}}
  private async writeBinding(key:RepoKey,identity:RequestIdentity,input:{ref:string;expectedCommit:string},binding:ProjectSchemaBinding,message:string,check:()=>Promise<void>){const workspace=await this.provider.createWorkspace(key,'Oxen Web schema binding '+randomUUID(),input.ref);let committed=false;try{if(workspace.baseCommitId&&workspace.baseCommitId!==input.expectedCommit)throw new ApiError(409,'SCHEMA_BINDING_CONFLICT','工作区基准已变化。');await this.provider.writeWorkspace(key,workspace.id,SCHEMA_BINDING_PATH,Buffer.from(JSON.stringify(binding,null,2)+'\n'));await this.checkBindingHead(key,identity,input.ref,input.expectedCommit);await check();const result=await this.provider.commitWorkspace(key,workspace.id,message,input.expectedCommit);committed=true;return schemaState(result.id,binding);}finally{if(committed)await this.provider.deleteWorkspace(key,workspace.id).catch(()=>{});}}
  async bind(key:RepoKey,identity:RequestIdentity,input:{ref:string;expectedCommit:string;organizationId:string;templateId:string;templateVersion:number;layer?:SchemaLayer}):Promise<ProjectSchemaState>{
    await this.checkBindingHead(key,identity,input.ref,input.expectedCommit);const selected=this.selection(key,input,input.layer),kind=getTemplateTargetKind(selected);
    if(kind!=='legacy'){const layer=input.layer??kind;return this.bindLayers(key,identity,{ref:input.ref,expectedCommit:input.expectedCommit,layers:{[layer]:{organizationId:input.organizationId,templateId:input.templateId,templateVersion:input.templateVersion}}});}
    if(input.layer)throw new ApiError(422,'SCHEMA_BINDING_TARGET','旧混合规范只保留兼容采用，不能冒充新分层模板。');const previous=await this.snapshot(key,input.expectedCommit);if(previous.binding?.version===2)throw new ApiError(409,'SCHEMA_BINDING_LAYER_REQUIRED','当前分支已采用分层规范，旧接口不能覆盖两个层。');const labels=await this.legacyLabels(key,input.expectedCommit);
    if(labels.assignments.some(assignment=>Object.keys(assignment.values).some(columnId=>!selected.columns.some(column=>column.id===columnId))))throw new ApiError(409,'SCHEMA_MIGRATION_REQUIRED','现有标签包含新规范未覆盖的维度，需要显式迁移。');validateLabelDocument({...labels,columns:selected.columns});await this.bindingValidator?.(key,input.expectedCommit,selected,undefined,previous.binding);
    const binding:ProjectSchemaBindingV1={version:1,organizationId:input.organizationId,templateId:selected.id,templateVersion:selected.version,checksum:selected.checksum,snapshot:selected,boundAt:at(),boundBy:identity.id};
    return this.writeBinding(key,identity,input,binding,'Bind legacy published template '+selected.id+'@'+selected.version,async()=>{this.selection(key,input);await this.bindingValidator?.(key,input.expectedCommit,selected,undefined,previous.binding);});
  }
  async bindLayers(key:RepoKey,identity:RequestIdentity,input:import('../../../packages/shared/src/governance-types.js').BindSchemaLayersInput):Promise<ProjectSchemaState>{
    if(input.layers.dataset&&input.ref!=='main')throw new ApiError(409,'PROJECT_LABELS_MAIN_REQUIRED','项目标签模板统一在 main 维护；其他分支可单独采用样本模板。');
    await this.checkBindingHead(key,identity,input.ref,input.expectedCommit);const previous=await this.snapshot(key,input.expectedCommit),current=previous.binding,labels=await this.legacyLabels(key,input.expectedCommit);if(!input.layers.dataset&&!input.layers.sample)throw new ApiError(422,'SCHEMA_BINDING_EMPTY','请选择至少一个分层模板版本。');
    const layers:ProjectSchemaBindingV2['layers']=current?.version===2?structuredClone(current.layers):{};const chosen:Array<{layer:SchemaLayer;snapshot:PublishedTemplateSnapshot}>=[];let changed=!!(current?.version===2&&(current.legacy||current.legacyColumns?.length));
    for(const layer of ['dataset','sample'] as const){const selection=input.layers[layer];if(!selection)continue;const snapshot=this.selection(key,selection,layer);if(layers[layer]?.checksum!==snapshot.checksum)changed=true;const applicable=labels.assignments.filter(assignment=>layer==='dataset'?assignment.scope==='dataset':assignment.scope!=='dataset').map(assignment=>({...assignment,values:Object.fromEntries(Object.entries(assignment.values).filter(([columnId])=>snapshot.columns.some(column=>column.id===columnId)&&current?.version===2&&current.layers[layer]?.snapshot.columns.some(column=>column.id===columnId&&column.semanticKey===labels.columns.find(old=>old.id===columnId)?.semanticKey)))}));if(current?.version===2&&current.layers[layer])try{validateLabelDocument({version:1,columns:snapshot.columns,assignments:applicable});}catch{throw new ApiError(409,'SCHEMA_MIGRATION_REQUIRED','同名历史维度与新规范类型或选项不兼容，请先确认映射，不能静默解释旧值。');}
      if(layers[layer]?.checksum!==snapshot.checksum)await this.bindingValidator?.(key,input.expectedCommit,snapshot,layer,current);layers[layer]={organizationId:selection.organizationId,templateId:snapshot.id,templateVersion:snapshot.version,checksum:snapshot.checksum,snapshot,boundAt:at(),boundBy:identity.id};chosen.push({layer,snapshot});
    }
    if(!changed&&current?.version===2)throw new ApiError(409,'SCHEMA_BINDING_NO_CHANGES','所选层已采用这些固定版本。');
    const binding:ProjectSchemaBindingV2={version:2,layers,checksum:'',boundAt:at(),boundBy:identity.id};binding.checksum=v2Digest(binding);
    return this.writeBinding(key,identity,input,binding,'Bind dataset/sample published template layers by '+identity.name,async()=>{for(const item of chosen){this.selection(key,{organizationId:item.snapshot.organizationId,templateId:item.snapshot.id,templateVersion:item.snapshot.version},item.layer);if(current?.version!==2||current.layers[item.layer]?.checksum!==item.snapshot.checksum)await this.bindingValidator?.(key,input.expectedCommit,item.snapshot,item.layer,current);}});
  }
  async feedback(identity: RequestIdentity, key: RepoKey, input: { templateId?: string; dimensionId?: string; requestedOption?: string; reason: string }) { await this.access.requireCapability(key, identity, 'read'); return this.mutate(identity, key.namespace, 'feedback.create', 'feedback', state => { const feedback: GovernanceFeedback = { id: randomUUID(), organizationId: key.namespace, project: key, ...input, authorId: identity.id, authorName: identity.name, createdAt: at(), status: 'open' }; state.feedback.push(feedback); return feedback; }); }
  async respond(identity: RequestIdentity, organizationId: string, feedbackId: string, status: 'resolved' | 'declined', response: string) { await this.requireSchemaMaintainer(identity, organizationId); return this.mutate(identity, organizationId, 'feedback.respond', feedbackId, state => { const item = state.feedback.find(item => item.id === feedbackId && item.organizationId === organizationId); if (!item) throw new ApiError(404, 'FEEDBACK_NOT_FOUND', '反馈不存在。'); item.status = status; item.response = response; item.respondedBy = identity.id; return item; }); }
}
