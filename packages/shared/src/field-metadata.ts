/** Local Web metadata for source fields. This never changes source keys or annotation definitions. */
export type DatasetFieldType = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
export type DatasetFieldOption = string | number | boolean;
export interface DatasetFieldMetadata {
  displayName?: string; description?: string; type?: DatasetFieldType;
  /** Defaults to true; required governs key presence separately. */
  nullable?: boolean; required?: boolean;
  enum?: DatasetFieldOption[];
  items?: { type?: 'string' | 'number' | 'integer' | 'boolean'; enum?: DatasetFieldOption[] };
  /** Historical metadata only; R17 uses the editor's personal pixel layout and has no weight/auto-fit controls. */
  width?: { mode: 'fixed'; value: number } | { mode: 'weight'; value: number; /** Auto-fit floor/cap in pixels; manual weights may omit both. */ min?: number; max?: number };
  /** Zero-based source-column display order; omitted fields keep their relative source order. */
  order?: number;
  /** Typed option-key -> #RRGGBB. Presentation only; keys come from fieldOptionKey. */
  optionColors?: Record<string,string>;
  /** Typed option-key -> human-readable choice name. Presentation only. */
  optionLabels?: Record<string,string>;
  /** Include this entire top-level source field in formal Release data. Defaults to true. */
  export?: boolean;
  /** Show this source column in the data-editor table. Defaults to true; no effect on export or access. */
  visible?: boolean;
  /** Pinned Web catalog origin. Retiring a catalog field never removes this project snapshot. */
  globalField?: { id: string; revision: number };
}
/** Display/delivery options never change source validation, private-draft or annotation-review fingerprints. */
export function semanticDatasetFields(fields: Readonly<Record<string, DatasetFieldMetadata>> = {}): Record<string, DatasetFieldMetadata> {
  return Object.fromEntries(Object.entries(fields).flatMap(([id, field]) => {
    const { width: _width, order: _order, optionColors: _colors, optionLabels: _optionLabels, export: _export, visible: _visible, globalField: _origin, ...rules } = field;
    return Object.keys(rules).length ? [[id, rules]] : [];
  }));
}
export interface ResolvedDatasetFieldMetadata { id: string; displayName?: string; description?: string }

/** Exact common names only. Domain-specific fields require an explicit dataset definition. */
const commonFields: Readonly<Record<string, DatasetFieldMetadata>> = Object.freeze({
  id: { displayName: '标识', description: '源记录的标识字段。是否唯一及其与系统条目身份的对应关系，以当前数据集说明为准。' },
  uid: { displayName: '唯一标识', description: '通常用于识别源记录。系统不会仅凭这个字段自动覆盖或合并样本。' },
  title: { displayName: '标题', description: '源记录的标题，便于快速了解条目主题；不是人工标注结论。' },
  name: { displayName: '名称', description: '源记录中对象的名称，具体命名规则以当前数据集说明为准。' },
  description: { displayName: '描述', description: '源记录提供的描述性内容，用于补充说明条目。' },
  text: { displayName: '文本', description: '源记录的文本正文。编辑会进入当前分支的本机草稿，正式提交后才产生版本。' },
  content: { displayName: '内容', description: '源记录的内容字段。对象和列表保留原有结构，不将其解释为执行指令。' },
  prompt: { displayName: '提示词', description: '源记录保存的提示词内容。展示该字段不会自动执行提示词或调用模型。' },
  messages: { displayName: '消息列表', description: '源记录的消息序列，通常包含角色和内容；实际结构以当前数据集定义为准。' },
  question: { displayName: '问题', description: '源记录中的问题文本，具体任务和上下文以数据集说明为准。' },
  answer: { displayName: '回答', description: '源记录中的回答内容；不表示该回答已经人工复核或正确。' },
  input: { displayName: '输入', description: '源记录的输入数据。它与人工标签独立保存。' },
  output: { displayName: '输出', description: '源记录的输出数据。它不自动成为本次人工标注的结论。' },
  instruction: { displayName: '指令', description: '源记录保存的指令文本。它作为样本数据展示，不在此处执行。' },
  context: { displayName: '上下文', description: '源记录提供的补充上下文，具体适用范围以数据集说明为准。' },
  source: { displayName: '来源', description: '源记录自身的来源字段，与数据集分类标签中的来源选项分别维护。' },
  language: { displayName: '语言', description: '源记录中的语言信息。未提供时不根据内容自动推定。' },
  url: { displayName: '链接', description: '源记录中的链接地址；展示不会自动访问该地址。' },
  label: { displayName: '源标签', description: '源文件自带的标签字段。其选项含义以数据集说明为准，与当前人工标注分开。' },
  labels: { displayName: '源标签', description: '源文件自带的标签信息。不会自动转为本次人工标注或审核结论。' },
  __bundle_provenance: { displayName: '来源证据', description: '导入时保留的来源包、原条目位置等追溯信息，不属于人工判定。' },
});

function text(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }

/** Explicit dataset metadata wins; an explicit empty string suppresses a common-name fallback. */
export function resolveDatasetFieldMetadata(id: string, fields?: Readonly<Record<string, DatasetFieldMetadata>>): ResolvedDatasetFieldMetadata {
  const normalized = id.toLowerCase();
  const fallback = Object.hasOwn(commonFields, normalized) ? commonFields[normalized] : undefined;
  const explicit = fields && Object.hasOwn(fields, id) ? fields[id] : undefined;
  const displayName = text(typeof explicit?.displayName === 'string' ? explicit.displayName : fallback?.displayName);
  const description = text(typeof explicit?.description === 'string' ? explicit.description : fallback?.description);
  return { id, ...(displayName && displayName.toLowerCase() !== normalized ? { displayName } : {}), ...(description ? { description } : {}) };
}

/** Show the actual selected value's shape, including null and arrays, without inventing a schema type. */
export function datasetValueType(value: unknown): string {
  return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
}
