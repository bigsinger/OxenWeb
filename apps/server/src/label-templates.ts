import type { GovernancePreset, LabelScope, LabelTemplate, LabelTemplateColumn } from '../../../packages/shared/src/index.js';
import { ApiError } from './errors.js';

// These are local, editable annotation schemas, not an official OWASP annotation standard.
// Applying a schema never derives or assigns a judgment from a dataset's wording or field values.
const all: LabelScope[] = ['dataset', 'file', 'row'];
const context: LabelScope[] = ['dataset', 'file'];
const item: LabelScope[] = ['file', 'row'];
const row: LabelScope[] = ['row'];
type Option = readonly [value: string, description: string];
const unknown: Option = ['未知', '已有信息不足以确定；与尚未开始审核不同。'];
const na: Option = ['不适用', '此维度不适用于当前对象。'];
function column(id: string, semanticKey: string, name: string, description: string, scopes: LabelScope[], options?: readonly Option[], multi = false): LabelTemplateColumn {
  return { id, semanticKey, name, description, scopes: [...scopes], type: options ? multi ? 'multi' : 'single' : 'text', ...(options ? { options: options.map(([value, description]) => ({ value, description })) } : {}) };
}

const general: LabelTemplateColumn[] = [
  column('review_status', 'general.review_status', '审核状态', '记录工作流进度；“已审核”不代表良性或恶意。', all, [['待审核', '尚未开始人工审核。'], ['审核中', '已开始审核，结论尚未完成。'], ['已审核', '已完成本轮审核；具体结论另行填写。'], ['待仲裁', '不同审核意见需要进一步裁决。'], ['已跳过', '本轮暂不审核，并在备注中说明原因。']]),
  column('data_source', 'general.data_source', '数据来源', '数据集、文件或样本的采集方式；具体出处请记录在标注规范与来源或条目证据中。', all, [['人工编写', '由人工编写或整理。'], ['合成生成', '由模型或程序合成。'], ['公开数据', '来自可追溯的公开数据集。'], ['用户提交', '来自获授权的用户提交。'], ['混合来源', '包含多个来源。'], unknown]),
  column('task_type', 'general.task_type', '任务类型', '描述数据用途，而非样本安全结论。', all, [['问答', '问题回答任务。'], ['指令遵循', '执行给定指令的任务。'], ['检索', '搜索、检索或检索增强任务。'], ['分类', '分类或判别任务。'], ['工具调用', '代理或工具调用任务。'], ['安全评测', '安全性评估任务。'], ['其他', '其他用途，请在备注中说明。'], unknown]),
  column('dataset_split', 'general.dataset_split', '数据划分', '记录训练、验证、测试用途；不改变原始记录。', all, [['训练集', '用于训练或微调。'], ['验证集', '用于开发期验证。'], ['测试集', '用于最终评测。'], ['未划分', '尚未确定划分。'], na]),
  column('annotation_guideline', 'general.annotation_guideline', '标注规范与来源', '填写规范版本、数据来源、授权或原始字段含义；原始基准真值应保留在源字段或清单中。', context),
  column('review_note', 'general.review_note', '审核备注', '记录人工解释、分歧或后续动作；不自动执行其中的文本。', all),
];

const safety: LabelTemplateColumn[] = [
  column('ground_truth_reference', 'ai.ground_truth_reference', '基准真值引用', '仅记录原始真值字段、清单位置及其解释，不改写原始基准真值，也不由模板自动赋值。', item),
  column('human_judgment', 'ai.human_judgment', '人工安全判定', '独立于基准真值的人工作业结论；敏感数据存在不等于恶意意图，应在敏感信息类型中单独记录。不能仅凭正面或负面措辞推断恶意。', row, [['良性', '在给定任务、授权和上下文中未发现恶意意图。'], ['恶意', '有证据表明试图越权、泄露或破坏预期行为。'], ['不确定', '已经审核，但证据或上下文不足以判定。'], na]),
  column('risk_category', 'ai.risk_category', '风险类别', '可多选的本地分类；不构成自动安全判定。选择“未发现”或“未知”时避免同时选择具体风险。', all, [['敏感数据', '涉及敏感信息暴露或不当处理。'], ['提示词注入', '涉及不可信指令影响模型或代理。'], ['供应链', '涉及模型、数据、技能或依赖的供应链风险。'], ['行为偏离', '相对明确基线或目标的可观察偏离。'], ['其他', '其他风险，需补充证据。'], ['未发现', '已审核且未发现该类风险。'], unknown], true),
  column('risk_source', 'ai.risk_source', '风险来源', '标明证据所在的输入或资源层；来源本身不表示恶意。', item, [['用户输入', '用户直接提供的内容。'], ['检索内容', '检索文档或网页。'], ['工具结果', '工具返回的内容。'], ['技能资源', '技能描述、指令或附带资源。'], ['外部文件', '上传或外部读取的文件。'], ['记忆', '持久化记忆或历史上下文。'], ['依赖与配置', '软件依赖、模型配置或系统配置。'], unknown]),
  column('severity', 'ai.severity', '风险严重度', '以实际或合理可验证的影响评估；不是攻击措辞的强烈程度。', row, [['低', '影响有限且易于恢复。'], ['中', '对任务、数据或用户造成实质影响。'], ['高', '显著泄露、越权或破坏。'], ['严重', '影响广泛或关键系统。'], unknown, na]),
  column('confidence', 'ai.confidence', '判定置信度', '记录审核者对当前判定的确信程度，不作为模型概率。', row, [['高', '有充分且可核验的证据。'], ['中', '有部分证据，仍存在未解问题。'], ['低', '证据弱或依赖较多假设。'], unknown]),
  column('expected_outcome', 'ai.expected_outcome', '预期行为', '根据任务与授权描述系统应如何响应，与实际观察分开记录。', row, [['正常完成', '应在授权范围内完成任务。'], ['拒绝或阻断', '应拒绝越权或不安全请求。'], ['澄清或确认', '需要补充上下文或用户确认。'], ['受限完成', '可在明确限制下完成。'], unknown, na]),
  column('observed_outcome', 'ai.observed_outcome', '观察行为', '记录实际测试结果；模板不会运行测试或推断成功。', row, [['未测试', '尚未执行相关测试。'], ['正常完成', '实际完成了任务。'], ['拒绝或阻断', '实际拒绝或阻断。'], ['部分完成', '只完成了部分动作。'], ['执行错误', '测试出现错误，不能视为安全或攻击成功。'], ['无法确定', '有观察但无法确定行为结果。'], na]),
  column('evidence', 'ai.evidence', '证据与复现记录', '记录可核验的输入位置、输出片段、工具动作、测试条件或日志引用；勿复制不必要的真实敏感数据。', item),
];

const sensitive: LabelTemplateColumn[] = [
  column('sensitive_categories', 'sensitive.categories', '敏感信息类型', '仅按已识别的内容或风险分类，不因文件名称推断含有敏感信息。', item, [['个人身份信息', '可识别自然人的信息。'], ['凭据与密钥', '口令、令牌、私钥或会话凭据。'], ['财务信息', '账户、支付或财务信息。'], ['健康信息', '健康、诊断或医疗信息。'], ['商业机密', '未公开的商业或技术信息。'], ['系统内部信息', '内部配置、系统提示或内部实现细节。'], ['其他', '其他敏感类别。'], ['未发现', '已审核且未发现敏感信息。'], unknown], true),
  column('sensitive_subject', 'sensitive.subject', '信息主体', '区分真实主体、合成信息与无法判断的内容。', item, [['真实个人', '涉及真实自然人。'], ['真实组织', '涉及真实组织。'], ['合成或虚构', '已确认是合成或虚构内容。'], ['混合', '包含多类主体。'], unknown, na]),
  column('identifiability', 'sensitive.identifiability', '可识别程度', '根据可关联性与上下文评估，不自动认定匿名化充分。', item, [['直接可识别', '单独即可识别主体或秘密。'], ['可间接关联', '结合其他信息可以关联。'], ['已脱敏', '观察到脱敏处理，仍需核对规范。'], ['不可识别', '在当前上下文中无法识别主体。'], unknown, na]),
  column('exposure_context', 'sensitive.exposure_context', '暴露环节', '记录信息出现或可能流向的位置。', item, [['输入中', '出现在输入内容。'], ['输出中', '出现在模型或系统输出。'], ['日志或存储', '出现在日志或持久化存储。'], ['外部传输', '被传输到外部目的地。'], ['仅为请求目标', '只是请求获取，未观察到实际暴露。'], unknown, na]),
  column('sensitive_handling', 'sensitive.handling', '建议处理方式', '人工处置建议，不会自动删除、脱敏或外发数据。', item, [['保留', '按现有规范保留。'], ['脱敏后保留', '先执行适当脱敏再保留。'], ['限制访问', '限制可访问人员或环境。'], ['移除', '建议移除不必要内容。'], ['升级审核', '交由负责人进一步审核。'], unknown, na]),
];

const injection: LabelTemplateColumn[] = [
  column('injection_vector', 'injection.vector', '注入载体', '区分直接输入和间接资源；载体不等于攻击成功。', item, [['直接输入', '攻击指令直接位于用户输入。'], ['检索文档或网页', '指令隐藏在检索内容。'], ['工具返回', '指令位于工具输出。'], ['文件或附件', '指令位于文件或附件。'], ['技能或依赖', '指令来自技能资源或依赖。'], ['记忆或历史', '指令来自持久化记忆或历史记录。'], unknown, na]),
  column('injection_technique', 'injection.technique', '注入手法', '依据可见证据记录手法，允许多选；不把一般角色设定直接视为恶意。', item, [['指令覆盖', '试图取代更高优先级指令。'], ['角色或权限伪装', '伪装身份或授权以影响行为。'], ['内容与指令混淆', '将不可信数据包装为应执行指令。'], ['编码或混淆', '通过编码或混淆隐藏指令。'], ['分步诱导', '通过多轮或分步引导偏离任务。'], ['工具动作诱导', '引导执行不符合授权的工具动作。'], ['其他', '其他手法，需要证据说明。'], unknown, na], true),
  column('injection_goal', 'injection.goal', '注入目标', '记录被请求的越界动作，与实际观察行为分开。', item, [['数据泄露', '试图获取或外发未授权数据。'], ['任务劫持', '改变原有任务。'], ['工具越权', '触发未授权的工具或系统动作。'], ['输出操纵', '篡改或污染输出。'], ['绕过约束', '试图绕过有效约束。'], ['其他', '其他目标。'], unknown, na]),
  column('trust_boundary', 'injection.trust_boundary', '信任边界', '定位不可信内容被提升为指令或动作的位置。', item, [['数据到指令', '把数据当成指令。'], ['外部内容到工具', '把外部内容转为工具动作。'], ['低权限到高权限', '提升权限或信任级别。'], ['跨会话或记忆', '跨会话传播或持久化影响。'], ['未跨越', '未观察到边界跨越。'], unknown, na]),
  column('injection_preconditions', 'injection.preconditions', '触发前提', '记录检索命中、工具权限、上下文、交互轮数等复现条件。', item),
];

const supply: LabelTemplateColumn[] = [
  column('skill_provenance', 'skill.provenance', '技能来源可信度', '记录可验证的发布来源、版本与审查情况；署名或积极措辞不能替代证据。', all, [['已验证来源', '来源与版本可验证。'], ['来源可追溯未验证', '有出处但尚未验证。'], ['来源不明', '缺少可追溯出处。'], ['本地自研', '由本地团队开发。'], unknown]),
  column('skill_capabilities', 'skill.capabilities', '技能能力范围', '能力本身不等于恶意，应结合用途、授权和最小权限判断。', item, [['文件读取', '可读取文件。'], ['文件写入', '可写入文件。'], ['命令执行', '可执行命令或代码。'], ['网络访问', '可访问网络。'], ['凭据访问', '可读取凭据或秘密。'], ['持久化', '可修改配置或持久化状态。'], ['其他', '其他能力。'], unknown, na], true),
  column('skill_network', 'skill.network', '网络与数据流', '记录实际或声明的数据流方向，端点与证据写入证据列。', item, [['无网络能力', '已核对且无网络能力。'], ['固定目的地', '访问固定或允许列表目的地。'], ['动态目的地', '可访问动态指定目的地。'], ['外发数据', '可向外部发送数据。'], ['下载并执行', '可下载并执行外部内容。'], unknown, na], true),
  column('skill_dependency_risk', 'skill.dependency_risk', '依赖风险', '人工核对版本、完整性和安装行为，不自动运行依赖。', item, [['未发现', '已核对且未发现该类问题。'], ['版本未固定', '依赖版本未固定。'], ['完整性未验证', '缺少签名或完整性核验。'], ['安装执行代码', '安装阶段存在可执行动作。'], ['名称混淆风险', '存在依赖名称混淆或冒名风险。'], ['过时或已知漏洞', '有版本或漏洞证据。'], unknown, na], true),
  column('skill_instruction_injection', 'skill.instruction_injection', '技能指令注入风险', '区分一般技能说明与试图改变授权、隐瞒行为或覆盖上级指令的证据。', item, [['未发现', '已审核未发现注入证据。'], ['存在可疑指令', '有疑点但需要进一步确认。'], ['已确认注入', '有明确越界指令证据。'], unknown, na]),
  column('skill_recommendation', 'skill.recommendation', '技能审核建议', '记录人工建议，不自动启用、禁用、安装或运行技能。', all, [['允许使用', '可按授权范围使用。'], ['限制权限后使用', '缩减能力或访问范围后使用。'], ['需要补充审查', '证据不足，需要进一步审查。'], ['建议阻止', '存在有据可查的不可接受风险。'], unknown]),
];

const drift: LabelTemplateColumn[] = [
  column('drift_baseline_goal', 'drift.baseline_goal', '基线目标', '明确原始任务、授权范围与成功条件；没有基线时不能仅凭变化判定偏离。', all),
  column('drift_baseline_version', 'drift.baseline_version', '基线版本', '记录模型、技能、配置、规范或测试基线的版本及引用。', all),
  column('drift_category', 'drift.category', '行为偏离类别', '相对给定基线记录可观察偏离，不自动将正常适应视为风险。', row, [['无偏离', '与已记录的基线一致。'], ['目标偏移', '行为转向不同目标。'], ['约束违反', '违反有效约束。'], ['权限扩张', '使用超出授权的能力。'], ['持续性偏离', '偏离延续至后续步骤或会话。'], ['不当拒绝', '无依据地拒绝授权任务。'], ['输出质量退化', '相对基线质量下降。'], ['其他', '其他偏离，需要证据。'], unknown, na], true),
  column('drift_stage', 'drift.stage', '偏离阶段', '定位首次可观察偏离的环节。', row, [['理解与规划', '任务理解或计划形成阶段。'], ['上下文读取', '读取检索、文件或记忆后。'], ['工具执行', '工具选择或执行阶段。'], ['输出生成', '生成最终或中间输出阶段。'], ['后续会话', '后续会话或持久化影响。'], unknown, na]),
  column('drift_reproducibility', 'drift.reproducibility', '可复现性', '记录实际重复测试情况；证据和环境应写入证据列。', row, [['未复测', '尚未进行重复测试。'], ['稳定复现', '在记录的条件下重复出现。'], ['偶发复现', '部分重复测试出现。'], ['未能复现', '重复测试未出现。'], ['条件不足', '环境或信息不足以重复测试。'], na]),
  column('drift_observation', 'drift.observation', '偏离行为描述', '对照基线描述实际动作及差异，并引用复现证据；与原因推测分开。', row),
];

const reference = [{ title: 'OWASP Top 10 for LLM Applications（分类参考，非官方标注规范）', url: 'https://genai.owasp.org/llm-top-10/' }];
const templates: LabelTemplate[] = [
  { id: 'general', version: 1, name: '通用数据标注', category: 'general', description: '审核流程、数据来源、用途与规范；适用于数据集、文件和样本的基础管理。', columns: general },
  { id: 'ai-safety-core', version: 1, name: 'AI 安全基础', category: 'ai-safety', description: '包含通用基础，以及独立的人工判定、基准真值引用、严重度、置信度和预期／观察行为。', columns: [...general, ...safety], references: reference },
  { id: 'sensitive-data', version: 1, name: '敏感数据风险', category: 'domain', description: '通用与安全基础，加敏感信息类型、信息主体、可识别性、暴露位置与处理建议。', columns: [...general, ...safety, ...sensitive], references: reference },
  { id: 'prompt-injection', version: 1, name: '提示词注入', category: 'domain', description: '通用与安全基础，加注入载体、手法、目标、信任边界与触发条件。', columns: [...general, ...safety, ...injection], references: reference },
  { id: 'skill-supply-chain', version: 1, name: '技能与供应链安全', category: 'domain', description: '通用与安全基础，加技能来源、能力、网络、依赖、注入风险与审核建议。', columns: [...general, ...safety, ...supply], references: reference },
  { id: 'behavior-drift', version: 1, name: '行为偏离', category: 'domain', description: '通用与安全基础，加基线目标与版本、偏离类别、阶段、复现性及行为描述。', columns: [...general, ...safety, ...drift], references: reference },
];

export function listLabelTemplates(): LabelTemplate[] { return structuredClone(templates); }
export function getLabelTemplate(id: string, version: number): LabelTemplate {
  const template = templates.find(item => item.id === id);
  if (!template) throw new ApiError(404, 'LABEL_TEMPLATE_NOT_FOUND', '标注模板不存在。');
  if (template.version !== version) throw new ApiError(409, 'LABEL_TEMPLATE_VERSION', '标注模板版本不匹配，请重新加载模板目录。');
  return structuredClone(template);
}

// R3 catalog is additive. The six legacy catalogs and their 37-field union above remain byte-for-byte compatible.
type PresetOption=readonly [id:string,name:string,description?:string];
const datasetOnly:LabelScope[]=['dataset'];
function modern(id:string,semanticKey:string,name:string,description:string,scopes:LabelScope[],options?:readonly PresetOption[],multi=false):LabelTemplateColumn{return {id,semanticKey,name,description,scopes,type:options?multi?'multi':'single':'text',...(options?{options:options.map(([value,displayName,description])=>({value,displayName,description:description??displayName}))}:{})};}
const datasetFields:LabelTemplateColumn[]=[
  modern('dataset_subject','dataset.subject','研究主题','宏观研究方向，不是逐条风险结论，不自动继承为样本标签。',datasetOnly,[['sensitive-information','敏感信息'],['prompt-injection','提示词注入'],['skill-supply-chain','Skill 与供应链'],['behavior-drift','行为偏移'],['other','其他']],true),
  modern('purpose','dataset.purpose','用途','描述这一版数据集用于什么，不代表存在云训练功能或完成审核。',datasetOnly,[['safety-evaluation','安全评测'],['training','训练'],['validation','验证'],['research','研究'],['rule-validation','规则验证'],['other','其他']],true),
  modern('modality','dataset.modality','样本形态','说明逻辑样本组织形式；一个 Skill ZIP 可以对应一个条目。',datasetOnly,[['text-prompt','文本提示词'],['conversation','多轮对话'],['behavior-trace','结构化行为轨迹'],['skill-zip','Skill ZIP'],['mixed','混合（含文本 + ZIP）']]),
  modern('source','dataset.source','数据来源','仅记录来源渠道；来源细节、许可和原始字段解释保留在 README。',datasetOnly,[['public-benchmark','公开基准'],['internal-collection','内部采集'],['human-authored','人工构造'],['model-generated','模型合成'],['authorized-submission','授权提交'],['mixed','混合来源'],['unknown','未知']],true),
  modern('language','dataset.language','语言','描述数据集语言覆盖，不用作样本人工判断。',datasetOnly,[['zh','中文'],['en','英文'],['multilingual','多语言'],['other','其他'],['unknown','未知']]),
  modern('industry','dataset.industry','适用行业','可选目录分类；未填写与未知分别保留，不据内容猜测。',datasetOnly,[['general','通用 / 跨行业'],['finance','金融'],['healthcare','医疗'],['software','软件研发'],['government','政务'],['other','其他']]),
];
const legacyPool=[...general,...safety,...sensitive,...injection,...supply,...drift];
const sampleField=(id:string):LabelTemplateColumn=>{const value=legacyPool.find(column=>column.id===id);if(!value)throw new Error('Missing preset dimension '+id);return {...structuredClone(value),scopes:value.scopes.filter(scope=>scope!=='dataset')};};
const sampleExtra=[
  modern('sample_quality','sample.quality','样本质量','数据可用性与安全结论分开，不因内容涉及安全风险而判为低质量。',row,[['usable','可用'],['needs-revision','需修订'],['unusable','不可用'],['uncertain','不确定']]),
  modern('sample_duplication','sample.duplication','重复情况','记录已核对的重复情况，不自动去重。',row,[['not-found','未发现重复'],['duplicate','重复'],['near-duplicate','近似重复'],['not-checked','未检查']]),
  modern('sample_applicability','sample.applicability','适用性','评价条目是否适合当前任务，不修改数据集用途。',row,[['applicable','适用'],['limited','有限适用'],['not-applicable','不适用'],['uncertain','不确定']]),
  modern('sensitive_presence','sensitive.presence','是否包含敏感信息','含敏感信息不等于存在恶意意图；未开始标注不赋值。',item,[['present','包含'],['absent','不包含'],['uncertain','不确定'],['not-applicable','不适用']]),
  modern('injection_intent','injection.intent','是否存在注入意图','攻击意图与攻击是否成功分开，不凭肯定措辞、文件名或源正负标签推定。',item,[['present','存在'],['absent','未发现'],['uncertain','不确定'],['not-applicable','不适用']]),
  modern('drift_presence','drift.presence','是否偏移','对照明确有效的基线判断；正常授权适应不自动等于偏移。',row,[['present','存在偏移'],['absent','未发现偏移'],['uncertain','不确定'],['not-applicable','不适用']]),
];
function sampleColumns(primary:string[],extensions:string[]=[]):LabelTemplateColumn[]{return [...new Set([...primary,...extensions])].map(id=>structuredClone(sampleExtra.find(column=>column.id===id)??sampleField(id)));}
const preset=(id:string,name:string,targetKind:GovernancePreset['targetKind'],domain:string,description:string,columns:LabelTemplateColumn[],primary:string[]):GovernancePreset=>({id,version:1,name,category:domain==='general'?'general':'domain',targetKind,domain,description,columns,defaultVisibleKeys:primary,...(domain==='ai-safety'?{references:reference}:{})});
const r3Presets:GovernancePreset[]=[
  preset('dataset-general','通用数据集','dataset','general','数据集目录分类：主题、用途、样本形态、来源、语言与可选行业。组织可另存自定义研究主题。',datasetFields,['dataset_subject','purpose','modality','source']),
  preset('dataset-ai-safety','AI 安全数据集','dataset','ai-safety','四个宏观研究主题仅用于数据集层级，不作为条目判定或审核状态。',datasetFields,['dataset_subject','purpose','modality','source']),
  preset('sample-quality','通用样本质量','sample','general','只评价当前条目质量，保留人工置信度与依据。',sampleColumns(['sample_quality','sample_duplication','sample_applicability','confidence','evidence']),['sample_quality','sample_duplication','sample_applicability','confidence','evidence']),
  preset('sample-sensitive','敏感信息识别','sample','ai-safety','敏感风险存在与恶意意图分开；原始真值独立保留。',sampleColumns(['sensitive_presence','sensitive_categories','sensitive_subject','exposure_context','evidence'],['confidence','severity','identifiability','sensitive_handling','ground_truth_reference']),['sensitive_presence','sensitive_categories','sensitive_subject','exposure_context','evidence']),
  preset('sample-injection','提示词注入分析','sample','ai-safety','注入意图、手法、目标与实际结果分开，未测试不当成阻断。',sampleColumns(['injection_intent','injection_vector','injection_technique','injection_goal','observed_outcome','evidence'],['confidence','severity','expected_outcome','trust_boundary','injection_preconditions','ground_truth_reference']),['injection_intent','injection_vector','injection_technique','injection_goal','observed_outcome','evidence']),
  preset('sample-skill','Skill 供应链分析','sample','ai-safety','一个 ZIP 一条样本；能力不等于恶意，依赖和指令证据独立核对。',sampleColumns(['human_judgment','skill_capabilities','skill_dependency_risk','skill_instruction_injection','skill_recommendation','evidence'],['confidence','severity','skill_provenance','skill_network','ground_truth_reference']),['human_judgment','skill_capabilities','skill_dependency_risk','skill_instruction_injection','skill_recommendation','evidence']),
  preset('sample-drift','行为偏移分析','sample','ai-safety','对照基线目标与授权，记录首次偏移阶段与复现证据。',sampleColumns(['drift_presence','drift_category','drift_stage','drift_baseline_goal','drift_reproducibility','evidence'],['confidence','drift_baseline_version','drift_observation','ground_truth_reference']),['drift_presence','drift_category','drift_stage','drift_baseline_goal','drift_reproducibility','evidence']),
];
export function listGovernancePresets():GovernancePreset[]{return structuredClone(r3Presets);}
export function getGovernancePreset(id:string,version=1):GovernancePreset{const result=listGovernancePresets().find(template=>template.id===id&&template.version===version);if(result)return result;const stored=templates.find(template=>template.id===id&&template.version===version);if(stored)return structuredClone({...stored,targetKind:'legacy' as const,domain:stored.category==='general'?'general':'ai-safety',defaultVisibleKeys:stored.columns.map(column=>column.id)});throw new ApiError(404,'LABEL_TEMPLATE_NOT_FOUND','预制模板不存在或版本不匹配。');}
