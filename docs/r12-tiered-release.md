# R12 分层发布的后端契约与安全边界

日期：2026-11-09。本文记录本地 TypeScript Web/BFF 扩展，不是 Oxen SaaS 原生能力，不修改 Oxen 0.67.0 内核或固定 OpenAPI。产品选择是“一份受限私有主库，算法与 QA 仅下载发布包”，不提供同一主库的行级保密权限。

## 固定视图

稳定样本 ID 对应的版本化管理信息为 `visibility: null | shared | holdout`、可重叠的 `suites: ('gold' | 'regression')[]` 和可选 `familyId`。新条目不自动共享，分组也不制造人工审核结论。

| JSONL | 成员 |
| --- | --- |
| `gold.jsonl` | 已有效独立复核且明确 shared，套件包含 gold |
| `regression.jsonl` | 已有效独立复核且明确 shared，套件包含 regression |
| `nonhidden-all.jsonl` | 已有效独立复核且明确 shared，以稳定 ID 去重 |
| `hidden.jsonl` | 已有效独立复核且明确 holdout |

构建先对已分类条目调用真实复核校验，取得有效采纳成员，再对这些成员重做完整复核预检。这样未分类和未复核条目被明确排除并计数，项目或文件级未处置问题仍能阻止正式交付；不会通过忽略整个预检错误伪称通过。纯分组不代替金标专家复核。

## BFF API 与 DTO

- 创建、修改 Release 支持 `deliveryMode: standard | tiered`。项目必须先显式启用受限主库策略；启用后所有正式候选强制 tiered，历史源 commit 和旧标准候选不能绕过。未启用项目保留标准发布。工作快照仍是内部完整快照。
- `GET /api/repos/:namespace/:repo/releases/:id/preview` 仅 `release.manage` 可调用，固定候选 commit，返回 `ReleaseDeliveryPreview`：各集合条数、交叠数、未分类/未核准条数、附件数、纳入/排除字段及阻止原因。
- `DatasetRelease.delivery` 保存构建时预览，`ReleaseAsset` 具有 `audience`、`view`、`shareable`。列表和详情会为无 `release.manage` 的用户移除 holdout 资产以及完整分层预览，不能只依赖 UI 隐藏按钮。
- `POST .../releases/:id/shares` 支持 `{expiresAt, assetId}`；tiered 必须明确选中 `shared-bundle` ZIP。JSONL、隐藏 ZIP、内部工作快照都不能用普通分享令牌分发。分享列表保留绑定的 `assetId`，原令牌仍只在创建时返回一次。
- 隐藏 ZIP 和 JSONL 的直接下载要求当前 `release.manage`。普通令牌即使误绑定隐藏资产也拒绝。过期、撤销、撤回与发放者当前分享权限仍在读取时复核。
- 安全策略开启后，旧标准全量包的新分享和既有分享令牌均拒绝；资产字节不被重写，管理人员仍可在受限主库核对旧文件。

固定契约类型位于 `packages/shared/src/releases.ts`；本段路由为本地 BFF 扩展，不添加 Oxen 上游猜测接口。

## 包内容与裁剪

共享 ZIP 只含三个共享 JSONL、这些行实际引用的附件、逐行标签/细粒度采纳信息、按成员裁剪的复核摘要与 provenance、生成的中性 README、manifest 和逐文件 SHA。隐藏 ZIP 只含隐藏视图及自己的相应文件。四个 JSONL 也分别提供为带 audience 的直接资产，单独 JSONL 中的附件路径需配合同范围 ZIP 使用。

所有源字段继续遵循 R11 `export !== false` 投影；系统稳定 `sample_id` 始终保留。指向未导出字段的 span/step 同步移除。系统操作时间/人员不作为样本列写入。成员、规则版本、字段清单、附件和复核摘要固定在候选源 commit，不在下载时重新筛选。

不自动复制主库 README、Release 自由文本说明、全量导入清单、原始包、来源证据文件全集、反馈全集、全项目标签赋值或整个多样本任务的正文。已选样本本身的自由文本与标签备注不会被任意语义脱敏；这里保证结构引用范围，不声称实现通用 DLP。源字段名称、模板定义与稳定关联 ID 也不代表匿名化。

`includeArchives=true` 在分层模式明确拒绝。源规范表、主库 README（两个已知 README 路径均以 Unicode NFC 与不区分大小写比对）、身份映射、`.oxenweb`/`.oxen` 控制路径、`provenance`、`source/archives` 原始包与 `source/files` 原始文件路径不能伪装为样本附件回流。附件按实际保留字段的引用重建；同路径或相同实际字节 SHA 不能跨 shared/holdout。Skill ZIP 是惰性原字节，只做读取和 SHA，不展开、安装或执行。整体沿用 64 MiB 和构建时限，超限失败不截断。

## 曝光与不可变记录

内部发布记录保存共享与隐藏的成员、family 和实际附件 SHA，公共 DTO 不包含该内部索引。`ReleaseService.exposed(key)` 为元数据写入提供本项目已发布共享范围：发布后撤回仍算已曝光，不能再把同身份、已知同族或相同附件字节称为未曝光 holdout。发布再次核对，避免先构建的隐藏候选在另一个共享候选发布后绕过。

新标准完整发布也固定其共享曝光摘要；更旧的标准记录从原固定 commit 重建，历史不可核对时明确拒绝，不默认视为未曝光。不作全局跨项目去重，也不声称检测未填写 family 的语义近似样本。已启用安全策略是控制面持久数据，历史恢复不能关闭；若启动发现已有 tiered 发布记录但策略文件缺失，须恢复同代控制面备份。

## 已执行的专项验证

`npx tsx --test apps/server/test/tiered-release.test.ts`：10 项通过，0 失败、0 跳过。包含四集合与交叠、所有共享 ZIP 成员的合成隐藏 canary 检查、字段与 fine 投影、原 ZIP SHA、明确 asset 分享、隐藏列表/直链/令牌拒绝、旧标准分享失效、曝光撤回与先构建后曝光、复核变化/CAS/当前权限、相同内容重复构建 SHA、完整内部快照及实际 HTTP 头和撤销过期。

`npx tsx --test apps/server/test/tiered-release.test.ts apps/server/test/releases.test.ts apps/server/test/release-field-projection.test.ts`：合并专项回归 34 项通过、0 失败、0 跳过，含 README 大小写/Unicode 别名回流与原始 `source/files` 附件拒绝；过期测试统一使用同一可控时钟。BFF `tsc --noEmit` 通过。以上使用纯合成测试，复核适配器单测不冒充真实审批；真实工作流、官方服务及浏览器验收由 R12 主实施记录另行记录。没有读取真实 benchmark 内容、未触碰原 3005/5173 下载验收服务、没有把新的 API 包测试当作旧浏览器下载通过。
