# R20：完整数据集发布与自动变更说明

日期：2026-11-10，Asia/Shanghai。本轮按用户最新要求替代 R19 方案；R19 文档仅作历史记录。实现属于本地 TypeScript BFF，不修改 Oxen 内核、固定 OpenAPI、真实数据或现有样本 CRUD。

## 发布内容

新发布只读取一个固定 commit 的完整 canonical 数据集，生成一个完整 ZIP 和一个独立 `manifest.json`。没有项目视图、全局发布模板、发布分组、四包输出或格式配置，也不使用 split、quality、purpose(s)、visibility 等字段决定成员。即使某行源字段写着 hidden，仍属于完整数据集；预览与发布界面明确提示这一点。权限仍由项目和发布授权决定。

|产物|内容与边界|
|---|---|
|`<project>-<version>.zip`|全部源行的 `samples.jsonl`，稳定 sample_id、字段投影后的 data、独立人工标签和实际复核状态；`dataset.json`、`schema.json`、`labels.json`、原项目 README、最终 RELEASE_NOTES、checksums 和被保留字段引用的附件|
|`manifest.json`|固定提交、版本、整库范围、样本与附件数量、纳入/排除字段、冻结基线、包 SHA256 和警示信息|
|不会自动入包|独立历史 holdout 存储、权限/令牌/运行控制文件、来源原始归档、未引用附件、操作人/最后操作时间映射、原始反馈及其他 provenance 文件|

源字段“是否导出”继续生效，关联附件从投影后字段引用选择；拒绝附件指回源整表、README、控制目录或来源归档。Skill ZIP 作为不可信字节读取、校验和复制，不解包执行。完整包仍能经现有标准 ZIP 导入器导入；外部人工证据不变成本地审核员记录。

源项目 README 和数据集级标签在整库包中保留。发布说明采用 `notes.trim() || generatedNotes`，人工修改稿是唯一最终版本；不会把原自动说明和修改稿重复拼接。`generatedNotes` 独立保存在发布元数据，作为自动生成时的基线证据。API 创建时未填写说明会自动填入生成文本。

## 自动说明与比较基线

|规则|实际实现|
|---|---|
|基线|同项目中发布时间最近、仍为 published、非 prerelease 的 `dataset-v1` 正式发布；发布时间并列时按创建时间和 ID 稳定排序|
|首版|没有可比完整版本时明确“首次完整数据集发布”，记录当前样本数、附件数和固定提交|
|R19 迁移|旧分层包的源 commit 可能包含更多行，不能拿它的整库源数据冒充旧交付内容；旧 1.1 不作为整库比较基线，存在历史时明确说明|
|样本变化|按稳定 sample_id 对两个固定版本的投影后内容比较，统计新增、删除、修改及人工标注变化|
|附件和结构|按被引用附件路径和实际 SHA256 比较新增/删除/修改；另比较字段/标签定义与 README|
|仓库文件|读取两个固定 commit 的真实 Provider diff，统计 added/modified/removed，不把文件新增伪称修改；样本 overlay 首次编辑可能表现为新增控制文件，而语义样本仍是修改|
|提交摘要|本地读取提交 subject，不包含 diff 正文或源样本摘录；最多遍历 1,000 个提交，展示 50 项、每项 240 字，未覆盖完整链时明确标记 complete=false|
|冻结|在创建或显式保存草稿时冻结基线、结构化统计和自动说明；后来出现其他发布不会悄改已有候选的说明，也不阻断其按既定基线发布|

全部统计和文本均为本机确定性计算，不调用模型，不发送真实样本给外部服务。无法读取正式基线的固定数据时返回 `RELEASE_BASELINE_UNAVAILABLE`，不生成假的零变化说明。

## API 与状态

主路径仍是 `/api/v1/datasets/:datasetId/releases`，原 `/api/repos/:namespace/:repo/releases` 是同一新引擎别名。`datasetId` 为编码后的 namespace/repo。

|接口/字段|约定|
|---|---|
|POST `releases/preview`|`{sourceRef, prerelease?}`；只读返回计数、导出字段、基线、comparison、changes、generatedNotes、planDigest 和 warnings，不建立候选|
|新建/修改|version/title/notes/sourceRef/prerelease；修改还需 expectedRevision。拒绝旧 templateName/releaseOverrides/split/format/deliveryMode 参数|
|预览 CAS|expectedCommit、expectedBaselineReleaseId、expectedPlanDigest。首版明确传 null，防止预览后他人先发布导致基线变化；变化返回 409 并保留表单|
|新模型标记|`publishingVersion='dataset-v1'`、deliveryMode=dataset；记录 datasetPreview、generatedNotes、baselineReleaseId|
|构建与发布|沿用异步队列、耐久记录、操作日志、实时授权、主线验证、固定内容指纹、SHA256、权限撤销、显式重试及不可变发布|
|工作快照|同一整库导出引擎，仅 internal、创建者及获准 owner 可下载，要求 data.export；不能外链分享|
|分享|只针对已发布的新完整包或清单，检查当前签发人权限、过期、撤销、版本状态和字节摘要；默认不授予项目浏览权限|

预览 DTO `DatasetReleasePreview` 的 `comparison` 复用既有样本/附件/标注/结构统计；首版未设置。`changes.files` 包含 added/removed/modified/total，`changes.commits` 包含 items 和 complete。`baselineReleaseId` 总是字符串或 null。自动说明与作者最终说明分开保存。

## 历史与兼容边界

- 旧 1.1 记录标记 readOnly，保持原资产字节、SHA、audience 与分享权限校验，继续允许获准下载；不再查询模板、视图或物化旧包，不允许编辑、构建、发布、切换 latest 或追加新发布说明。已有分享仍按其原权限校验，并可撤销。
- 1.1 之前已退役的资产入口继续返回 410，记录只用于审计。
- 历史私有源和物理隐藏文件由只读证据保护器及同代备份保留，不能因为移除管理页面而开放，也不复制进新整库包。
- 新整库包不依赖历史 registry 或 holdout 的写入/管理服务。旧 `view-release-materialization`、多格式 writer、scoring helper 及专属测试已移除，Parquet writer/reader 依赖也已卸载。

## 实际验证

`npx tsc -p apps/server/tsconfig.json --noEmit` 通过，没有写入运行目录。

`.data/r20-release-final.log`：**25 项通过、0 失败**。包括新整库发布 10 项、保留的字段投影/附件防回流 6 项、通用 ZIP/导入/重启/磁盘故障回归 8 项和构建期间权限撤销 1 项。关键实际检查：

- hidden/internal 等源字段的所有行仍出现在完整包，字段排除、原 README、数据集级标签和惰性 Skill ZIP 保留正确；标准包实际回导。
- 第二版固定提交样本新增 1、删除 1、修改 1，文件变化和真实 commit subject 回读正确。
- 首版 null CAS、已冻结基线、排除 prerelease/withdrawn、旧 R19 源 8 行而旧包 5 行不冒充整库基线。
- 旧包原字节与内部权限、分享失效/撤销/完整性、内部创建者快照、移除参数拒绝。
- 人工修订说明实际下载后只有一份最终文本，自动文本仍单独保留在元数据。

随后对鉴权窗口做了窄补：预览返回前重验权限；构建获 heavy-work 准入后及就绪记录的串行写入段内重验权限。`.data/r20-release-auth-final.log` **12 项通过、0 失败**，其中新增排队期间撤权用例确认构建失败、没有新增源读取、没有就绪资产；其余为重跑整库发布和构建读期间撤权。

全量回归、原生服务、恢复和浏览器验收由主任务统一记录；本记录未把未完成的浏览器步骤写成通过。全程只操作隔离合成数据，未修改真实数据、运行 dist 或部署服务。
