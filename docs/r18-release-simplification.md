# R18：默认四包发布与隐藏集出口

日期：2026-11-09。本记录是用户确认后的本地 Web/BFF 扩展，不是新增 SaaS 观察，不修改 Oxen 服务端或内核。

## 操作与筛选

项目设置移除“发布分组”入口。创建 Release 直接填写版本、说明和评分规则版本，保存候选、预览、构建、核对发布；不再要求用户先启用分组或选择标准/分层模式。

生产 BFF 显式启用 `fourViewDelivery`。每次发布固定一份 Oxen 主线提交，生成四个独立 ZIP；各 ZIP 的清单、JSONL、采纳答案、复核摘要及附件均只含该包成员。源码中的旧格式构建分支只保留历史格式回归与兼容测试；生产 HTTP 不能选择该分支绕过四维检查。

| 包 | 固定筛选 | 对外分享 |
|---|---|---|
| 金标测试集 | split=test、quality=gold、visibility=shared/public，四维完整且有效独立复核 | 可为此包单独生成有效期链接 |
| 开发回归集 | split=dev、purposes含regression、visibility=shared/public，四维完整且有效独立复核 | 同上 |
| 可分享样本全集 | visibility=shared/public，四维完整且有效独立复核 | 同上 |
| 隐藏测试集 | split=test、visibility=hidden，四维完整且有效独立复核，未曾共享曝光 | 不生成外链 |

`internal`、未分类、四维未完整和未完成有效复核的样本不自动共享。回归用途不能绕过 `internal` 或 `hidden`。金标是质量声明，不替代独立复核；各包不能直接合并计总分，金标/回归可能被全集包含。正式发布继续冻结稳定 sample_id、样本内容修订、采纳答案版本及外部评分规则标识；平台不执行评分。

缺任何一个核心字段、字段类型或选项语义不符合受支持发布规则，预览/构建失败并明确报错。不能因管理员调整目录或恢复旧提交而退回全量标准包。构建、复核、规范变更、CAS、已曝光 ID/family/附件字节、已知同源跨划分和发布前再次核验继续保留。

## 权限与持久化边界

新增独立能力 `release.hidden`。实例管理员和项目 admin 默认拥有；lead、reviewer、editor、annotator、viewer 默认没有。管理员可在项目权限的“独立能力”中指定可信人员，授予此能力意味着允许访问受限主库及隐藏评测内容，不能给只下载包的算法/QA。

Release 列表、详情及所有变更响应按当前能力裁剪隐藏资产、完整计数、交付预览、比较与内部错误明细；完整预览与生产正式构建检查需要隐藏能力。直接猜测隐藏资产 ID 仍由下载服务鉴权，读完文件后再次核对权限、状态与资产摘要。隐藏包不可生成分享链接；分享列表排除无权获知的资产，分享下载继续核对发行人当前权限、过期与撤销状态。历史全量包/旧内部快照也不能向普通接收者开放，旧全量分享链接失效。

创建/更新/构建四包候选时，服务端自动建立原有 sticky 私有主库控制记录，持项目策略锁核对本地 settings.policy 私有状态、当前 release.manage 授权并持久化；原生 Oxen summary 的 visibility=unknown 不替代此权威控制策略。它只收紧访问，不改样本或创建 Oxen 提交。手动旧策略入口保留原授权校验，设置 UI 不再展示。控制文件继续纳入既有备份，重启仍以历史分层记录核对策略；策略缺失拒绝启动，不静默重新生成丢失的安全状态。

主库搜索、原文件、表格、API、历史等入口由中央 `RestrictedMasterAccess` 阻断无隐藏能力者；不是基于行字段的行级 ACL。算法/QA 仍按已确认方式只领取受权发布资产/链接，不进入主库。部署必须同时包含此中央门禁，不能仅依靠本页面隐藏下载按钮。

## 非隐藏工作快照

新工作快照仅导出四维完整且 visibility=shared/public 的已提交行，不要求已通过正式复核，明确标记 `unreviewed-work-snapshot` 或冲突状态。按“是否导出”字段投影，按所选行和导出字段引用挑选附件，不附主库 README、原始导入包、任意反馈、隐藏/内部/未分类成员。`snapshotScope=shared-classified` 记录当前语义；旧快照不假称非隐藏快照。普通快照不是完整内部备份；完整备份继续使用既有运维权限和冷备流程。

## 表单与验收

空版本、标题、说明、来源与评分规则字段显示建议和显式“采用建议”按钮。空输入按无修饰 Tab 采纳建议，保持浏览器正常向前移动焦点，不自动填入非空输入，也不在挂载或保存时静默接受。评分规则建议只是外部规范 ID 示例，仍须负责人填写已受控版本；保留校验、脏表单确认和模态焦点保护。

已执行自动化：新增 R18 八项，加上 R12 实际 HTTP 独立标注/复核/合并/发布/冷恢复流程，共 9 项通过；此前其余 Release/投影/分层40项通过，48项合并回归后另增原生visibility=unknown专项通过。覆盖四包成员及辅助文件裁剪、hidden能力独立于release.manage、猜ID下载、每包分享、快照漏出金丝雀、核心规范失败关闭、角色默认与建议输入、自动策略持久化及缺失策略拒启动。现有 Release/字段投影/分层 40 项此前通过；合并回归最终结果由本轮统一记录补充。前后端严格类型检查通过。

浏览器最终路由、Tab 焦点、窄屏与实际下载验收由主任务在隔离合成环境补充；本文件创建时尚未声称这些已通过。本轮未操作四个真实数据集、未部署、未重新划分真实样本，未运行 Skill ZIP。

代码映射：`ReleasesPanel.vue`、`release-form-hints.ts`、`SettingsPanel.vue`；`releases.ts`、`tiered-release.ts`、`shared-work-snapshot.ts`、`dataset-evaluation.ts`；能力注册/`AccessPanel.vue`；专项 `r18-release-simplification.test.ts`。R12 合成 fixture 已升级为四维、四 ZIP：金标2、开发回归1、可分享全集4、隐藏2；8条中另含未分类与未复核，trusted worker/reviewer 明确拥有主库权限，consumer viewer 用于验证隐藏拒绝。

## R18 发布前置拒绝与历史对账修复

部署后发现旧版两次创建 Release 的本地前置拒绝被当成“结果未知”：`kind=release.create`、`reasonCode=EVALUATION_POLICY_REQUIRED`、`anchors={}`。这是旧 R16 `create` 在进入 Release 控制记录 `mutate` 前抛出的明确守卫，并非提交丢失或后台构建未完成。后来启用策略、存在新发布草稿，不是重放或删除该草稿的理由。

对账仅增加这一精确历史情况：记录必须仍为 `reconciliation-required`，操作种类与错误码精确匹配，anchors 完全为空；若控制策略的 `operationId` 反而指向该操作，则保留待核对。符合条件时，仅将该操作日志改为 `failed / RELEASE_CREATE_PREWRITE_REJECTION_VERIFIED`，不读取或修改源数据、Release 草稿、个人编辑草稿和布局，不重放请求。其他错误、其他操作、进程中断、已有 workspace/commit/release/asset anchor 均继续走原核查，不泛化所有 409/422。

新请求使用按 Release 操作种类、错误码及 HTTP 状态逐项列出的本地前置守卫，只在 `execution.writeAttempted === false` 时确认未写入。Release 控制记录持久化前现在同 Provider/策略控制面一样标记 `writeAttempted=true`；因此即使响应丢失或持久化后又抛出相同错误码，仍保留“需要核对”，不能误报失败。相同 operation ID 依旧不能自动重试或复用。

本修复的测试使用隔离合成 journal 重载，验证两条精确旧记录可结束、私有草稿字节和 revision 不变、Provider/Release 查询未触发；同时覆盖未知错误、正向 anchor、策略写证据及已有副作用的情况。真实生产记录的授权对账和最终健康状态由主任务执行并补充，此子任务未调用真实对账 API，也未重新构建或部署。
