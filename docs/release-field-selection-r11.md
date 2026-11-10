# R11 Release 源字段选择

日期：2026-11-09。本项目的 Web/BFF 扩展，未修改 Oxen 0.67.0 内核、原生存储或固定 OpenAPI；不是 SaaS 快照新增观察。

## 使用方式

项目设置 → 样本字段 → 选择字段 → “是否导出（Release）”。默认勾选；保存后产生当前分支上的明确字段配置提交。将该提交合入主线后，创建固定到此提交的正式 Release，构建的 `samples.jsonl` 中 `data` 仅保留被勾选的源字段。标准 ZIP 与其独立 JSONL 资产使用同一份投影结果。

配置键为 `DatasetFieldMetadata.export?: boolean`，缺失等同 true。未自定义配置的新源字段也默认导出；这不是用于敏感数据安全发布的默认拒绝清单。字段选择不删除源值、不隐藏编辑列、不改人工标签定义，也不把字段名改成显示名称。

对象、数组按整个顶层字段选择，保留其内部结构。字段 ID 为真实顶层键：`literal.dot` 是含点号的字面键，不代表对象路径；片段和步骤仍使用 JSON Pointer。

表单输入中的显式 false 会进入原有私有检查点。撤销自动列宽、恢复字段顺序不会清除独立的导出选择；“还原本字段”恢复已提交定义，“移除自定义配置”会明确提示将导出恢复默认勾选。

## 版本与复核边界

- Release 使用候选固定提交的政策，不跟随当前 main 自动变化。修改当前字段配置不重写旧 Release、既有下载字节或旧工作快照；需创建固定于新提交的候选。
- 发布指纹独立包含字段导出政策，构建与发布重新读取固定提交；政策或其他证据不一致时拒绝发布并要求重新构建。
- 导出选项不改变源内容、源约束及人工判断，因而不计入标注模板/私有草稿语义指纹，不要求仅因字段裁剪重新标注复核。正式 Release 原有独立复核、主线、权限、候选 revision 和资产 SHA 保护保持。
- 工作快照用于已有导出权限人员的内部完整数据交换，继续保留全部字段，明确不代表已脱敏或通过复核。该选择不作用于文件原件读取、工作台内部导出或已有历史；更不是隐藏数据集的访问控制。

## 包内一致性与拒绝行为

被取消字段从 `samples.jsonl.data` 和可移植源字段配置中移除；标识字段取消时源 `id` 不会偷偷补回。稳定的系统 `sample_id` 仍保留，用来关联行、人工意见及审核证据；它可能与某些原始标识相同，因此字段投影不等于匿名化。

仅打包仍由导出附件字段实际引用的附件，并按保留的引用重建其行关联。被取消的顶层字段所对应的字符片段、步骤及根对象位置证据不导出；其他人工标签及审核证据沿用原有语义。系统最后修改时间/最后操作人仍不进入样本数据。

存在字段排除时，包不包含原始导入清单、导入证据、反馈原件或原始归档；它们可能携带完整旧记录。“附带原始归档”若开启则明确拒绝构建，不悄悄忽略用户勾选。若保留的附件字段指向已知整源/控制文件（源 JSONL 本身、入口描述/身份映射、`.oxenweb/`、`.oxen/`、`provenance/` 或 `source/archives/`），返回 `RELEASE_EXPORT_SOURCE_ATTACHMENT`，提示取消该附件字段或改为独立样本附件；不以附件名将完整源记录带回。

所有实际样本字段都取消时，返回 `RELEASE_FIELDS_EMPTY`，异步候选显示明确构建失败，不提供空对象数据集资产。归档冲突为 `RELEASE_EXPORT_ARCHIVES_CONFLICT`。默认全选、默认不附原归档不会产生这些失败。

README、发布说明、人工标签/备注和保留的附件均可能包含自由文本。此功能不扫描、语义脱敏或重写其内容，不展开或执行 Skill；如保留附件本身带有答案，需取消对应附件字段或在来源治理中另行处理。发布负责人仍应按交付范围核对这些内容。

## 实际验证

专项 `npx tsx --test apps/server/test/release-field-projection.test.ts apps/server/test/sample-field-config-ui.test.ts apps/server/test/sample-field-checkpoint.test.ts apps/server/test/field-order.test.ts apps/server/test/releases.test.ts apps/server/test/dataset-fields.test.ts`：52项通过、0失败、0跳过，15575ms，日志 `.data/r11-export-targeted-final.log`。

新增6项风险场景覆盖缺省/显式选择及语义指纹、检查点、撤销列宽/还原顺序、字符串/整个对象/点号字面键/id排除、ZIP和独立JSONL投影、实际附件与fine证据、来源原件旁路、源表自引用及控制归档引用、全字段关闭、归档冲突、固定历史字节和工作快照边界、候选政策重读失败。使用纯合成文本及惰性 ZIP，未读取、修改或执行真实 benchmark。全量构建与实际浏览器验收由本轮主任务统一记录，专项通过不替代实际界面结果。

随后补入实际 `DatasetService` + `ZipImportService` 回导校验：源`id`取消导出后，包能导入独立新项目，裁剪行、稳定系统身份和保留附件字节一致；该新增6项文件再次6/6通过，日志`.data/r11-export-projection-roundtrip.log`。`npm run typecheck`最终退出0，日志`.data/r11-export-typecheck-final.log`；改动的已跟踪文件`git diff --check`通过。

实现入口：`packages/shared/src/field-metadata.ts`、`apps/server/src/release-field-projection.ts`、`apps/server/src/releases.ts`、`apps/server/src/dataset-field-schema.ts`、`apps/web/src/sample-field-config.ts`、`apps/web/src/sample-field-checkpoint.ts`、`apps/web/src/sample-field-order.ts`、`apps/web/src/components/SampleFieldsPanel.vue`及`ReleasesPanel.vue`。
