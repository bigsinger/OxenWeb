# R19：1.1 发布物化与独立隐藏存储

实施时间：2026-11-09～2026-11-10，Asia/Shanghai。依据用户提供的《数据集管理平台 1.1 增量改造方案》。所有新增端点和控制文件均为本地 TypeScript BFF 扩展；未修改 Oxen server、内核、固定 OpenAPI 或真实样本。

## 一条发布链路

沿用现有 Release 的草稿→异步构建→就绪→发布→撤回流程、版本 CAS、操作日志、耐久写入、产物完整性校验及分享撤销机制。成员选择已全部改为冻结的数据集视图实例，旧四维字段分组和固定四 ZIP 算法已移除。

|对象|实际行为|
|---|---|
|候选冻结|固定 Oxen commit、实际发布配置、视图定义及 revision、选中的物理目录成员与摘要；模板名称/快照仅作说明，不参与语义 planDigest 或成员指纹|
|保存前预览|只读计算成员与风险提示，不建立 Release，不创建空隐藏目录；保存携带 expectedCommit、expectedViewsRevision、expectedPlanDigest，变化返回 409，保留表单|
|临时覆盖|本次视图选择、JSONL/CSV/Parquet、data/hash_only、card/checksums 均冻结进候选，不写回模板或实例；物理视图不能覆盖为 data|
|构建/发布复核|重读固定 commit、字段投影、选定附件、已接受复核证据和物理成员；摘要或权限变化拒绝产生就绪/发布结果，不截断数据冒充成功|
|旧候选/发布|仅保留审计记录和磁盘历史；DTO 标记 legacy 并隐藏资产，旧 build/update/publish/download 返回 410，旧分享无法再取字节|
|曝光证据|历史已发布成员在撤回、旧策略退役后仍保留；仅 shared＋data 的新虚拟成员记作正文曝光，内部全量/内部视图/纯摘要不冒充正文曝光|

默认发布得到 **3 个虚拟视图 ZIP、1 个物理隐藏摘要文件、1 个发布清单**。各虚拟视图允许重叠，样本总数采用去重统计，不相加包内数量。

|默认视图|成员来源|实际产物|
|---|---|---|
|golden|`quality='golden' AND status='active'`|`<repo>-<version>-golden.zip`|
|regression|`purpose LIKE '%regression%' AND status='active'`|`<repo>-<version>-regression.zip`|
|public|`visibility <> 'hidden' AND status='active'`|`<repo>-<version>-public.zip`|
|holdout|独立物理目录，冻结成员|`HIDDEN_MANIFEST.sha256`，只有 SHA256 和不含原文件名的随机 ID|
|发布清单|本次实际配置、定义、数量和输出摘要|`manifest.json`|

附件规定的 public 条件会命中源字段 `visibility=internal` 的行。预览和包清单明确提示命中数量与当前视图交付范围；没有把它静默改成旧的“仅 shared/public”规则。旧源 `visibility=hidden` 或旧本地 evaluation holdout 行则在任何虚拟视图强制排除，包括空白自定义筛选；这不是自动物理迁移，真实源和历史未被改写。缺少 status/quality/purpose 等字段时按实际缺失值评估，不猜测或映射旧名称，并显示诊断。

## 格式与可移植性

同一行信封包含稳定 sample_id、源 data、独立 annotations、annotation_status、选中附件引用及已接受的片段/步骤证据。未复核和冲突明确标记，不把 quality 值当作本系统独立复核结果。操作人/操作时间控制映射不导出。

|格式|编码与验证|
|---|---|
|JSONL|逐行规范 JSON，保持布尔/数值/对象/数组/null 和字段缺失语义|
|CSV|RFC4180、UTF-8 BOM；单元格采用 JSON 编码以保留嵌套类型并避免裸公式字符串，清单声明 csvCellEncoding=json|
|Parquet|真实 PAR1 文件，字符串列与 JSON 逻辑列；使用纯 JavaScript `hyparquet-writer@0.18.0`，独立 reader 回读嵌套数据和空表，未把 JSON 重命名为 parquet|

每个虚拟 ZIP 同时带有本视图范围的 `dataset.json`、`schema.json`、`labels.json`、`samples.jsonl` 交换副本、所选真实格式文件及经校验的附件。CSV/Parquet 也带 JSONL 交换副本，以复用已有标准包导入校验，不新增另一套导入流程。checksums 选项启用时可直接走现有标准包导入；关闭时仍可按所选数据文件映射导入。外部标签/证据保留为来源，不变成本地审核员已接受记录。

源字段“是否导出”同时应用于正式发布和工作快照；关联附件只从保留字段的有效引用选择。主库 README、完整源表、控制目录、来源归档、反馈和其他行的意见不得通过附件或 provenance 回流。数据集卡片由本次发布说明生成。参考：[hyparquet-writer 官方仓库](https://github.com/hyparam/hyparquet-writer)。

## 隐藏物理边界

隐藏存储位于本地状态目录的独立 `holdout/` 根，不注册静态文件路由，不纳入 Oxen 源文件树。实际路径使用项目 hash 与逻辑路径 hash，逻辑路径必须处于该项目的 `holdout/<dataset-hash>/` 下，拒绝绝对路径、跨项目、反斜杠、点路径、链接及不安全元数据文件。

Windows 根目录保护继承，DACL 仅保留当前服务用户、SYSTEM 和 Administrators；已有树逐项拒绝额外允许的 SID 和 reparse，检查最多 100,000 项并设 15 秒执行上限。POSIX 目录为 0700、文件为 0600，读取时拒绝 group/other 权限。首次使用时懒初始化并校验权限；已有目录启动时校验索引和全部 blob。未曾登记的空目录可只读预览，实际建立候选时先登记冻结空证据。已登记目录、索引或 blob 缺失/损坏会失败，不能变成“新的空隐藏集”。父级恢复流程根据 Release 证据要求同代 registry 和 holdout 根恢复。

导入采用 revision CAS 与 operationId 幂等，每批最多 100 个/8 MiB，目录最多 10,000 个/512 MiB；内容只写不可执行 blob，ZIP 不解包、不安装、不执行。索引保存原始 SHA256、可选样本 ID、可规范化 JSON 的内容 hash。与历史已发布正文/附件，或本次所选虚拟 data 的相同 ID、规范 JSON、附件字节相交时拒绝隐藏发布。这里只保证精确证据检查，不宣称能自动发现语义变体或所有同源关系。

|接口|权限与用途|
|---|---|
|GET `/api/v1/datasets/:datasetId/holdout`|release.hidden；只返回计数、revision、摘要和不透明成员 ID|
|POST `.../holdout/import`|release.hidden＋project.admin；显式独立导入，未自动搬运真实数据|
|GET `.../holdout/operations/:operationId`|同导入权限；返回 verified=true 的特定操作回执，不用“数量增加”推断成功；无记录 404、无法核实索引失败|
|POST `.../holdout/evaluate/read`|回环地址＋Bearer＋release.hidden；拒绝浏览器 Cookie/Origin/Fetch 模式，最多 20 项/4 MiB，要求评测用途并审计；只供受控本机评测，不运行 Skill 或模型|

没有隐藏正文 Release 下载或外链分享入口。hash-only 文件不含原文件名、样本 ID 或正文。现有源历史中的隐含数据仍受父级 trusted-master source gate 保护，启用视图不会把行字段误当成物理权限隔离。

## 工作快照与旧数据集

已配置视图的项目只能选择一个已保存虚拟视图导出工作快照，默认 public；物理隐藏视图禁止正文快照。未配置视图的旧项目保留内部完整样本导出，要求 release.hidden 的受信身份，所有产物仅 internal 且禁止分享。已配置后显式删空视图不会回退全量模式。旧数据集上已有全局字段标记不自动阻止管理员内部导出，也不自动开启公开视图。

发布 API 新主路径为 `/api/v1/datasets/:datasetId/releases`（datasetId 为 URL 编码的 namespace/repo）。原 `/api/repos/:namespace/:repo/releases` 仅作为同一新引擎别名；拒绝旧 deliveryMode/includeArchives 参数。预览、保存、构建、发布、撤回、下载、过期/撤销分享均经过实时鉴权。

## 本轮验证记录

- server TypeScript `--noEmit` 通过，未写入运行中的 dist。
- `.data/r19-final-release-tests.log`：32 项通过，覆盖新视图发布、字段导出、ZIP 导入/差异/边界、权限撤销、物理完整性、失败重试与历史退役。
- `.data/r19-release-core-final.log`：22 项通过，包含真实 Parquet 独立回读及空表、ACL/冻结证据、特定操作回执、默认工作快照及受控评测 HTTP 边界；浏览器 Cookie/Origin/Fetch、非回环及无权访问均实际拒绝。
- `.data/r19-real-restore-final.log`：20 项通过，其中新增实际存储恢复用例：真实 DatasetViewStore、NTFS ACL PhysicalHoldoutStore 和新 ReleaseService 发布 5 个产物后关闭，经 `controlBackupSources` 冷备份并恢复到新的隔离 NTFS 目录，重新初始化各 store/service，逐个核对视图定义、冻结物理摘要/数量、所有产物字节 SHA256、内部评测权限与审计及恢复后分享撤销；随后删除 registry、已登记 blob 分别确认失败。全程仅使用合成样本与 `.data/tests` 隔离目录，未执行生产备份。
- 新增 `view-release-r19.test.ts`、`physical-holdout-r19.test.ts`、`release-data-format-r19.test.ts`。旧 `tiered-release.test.ts`、`r18-release-simplification.test.ts`、`r12-tiered-real-workflow.test.ts` 专属旧算法测试已被新视图/备份恢复用例替代；通用 ZIP 读写、导入、防扩展炸弹、字段投影、活动元数据隔离及提交授权测试继续保留。
- 原 `tiered-release.ts` 与 `shared-work-snapshot.ts` 不再出现在 active 源码。没有执行 Oxen 内核修改、真实样本重分组、真实隐藏迁移、发布或服务部署。

浏览器、新原生服务、冷备份恢复及全量回归由主任务统一验收；本记录不把未完成的浏览器步骤写成通过。
