# R3 本地项目盘点与测试项目清理提案

状态：**仅设计，待用户审阅备份及完整删除名单后整体确认；本轮没有删除、移动、改权限或修改项目内容。**

盘点日期：2026-11-08。来源为当前运行的 `http://127.0.0.1:3001/api/repos`，逐项目只读查询 branches/workspaces，并对照本项目既有验收文档与合成测试脚本。范围仅为该 BFF 当前可见的 `local` namespace，不代表 SaaS 账号或所有其他 namespace。

## 直接回答

**四个 benchmark 之外不能全部当成可删的纯测试项目。** 当前共有 **32 个项目**：4 个正式 benchmark；2 个含用户真实桌面样本的旧导入／验证副本；1 个本地 seed 示例；3 个最终通过的 R2 验证项目；1 个 SaaS 对照合成项目；21 个旧合成探针／失败现场候选。

- `prompt-injection-bench` 是原先导入的用户真实 2,000 条样本，建议保留。
- `jsonl-browser-verification` 是浏览器导入同一真实文件形成的验证副本，不能称为“只有合成数据”。本轮只读流式摘要确认两个 main 下的原 JSONL 都是 **1,476,731 字节**，SHA256 都是 `f9a1f1514b6ebe5b049bde307c87d53625c02628f3d7947f47470c9c9a5b4a4d`。这只证明该文件相同，不证明仓库历史、元数据或所有分支相同。
- `visual-search` 经 `scripts/oxen.mjs` 的 seed 实现确认，是生成的本地示例／集成项目，并非可证明的用户业务样本；但它是既有示例、含 16 个分支，应作为保留项单独说明，不因名称没有 benchmark 就批量删除。
- R2 最终成功轮次与失败现场要分开：`mw7ckde1-2bb6d9` 的完整协作、再导入、1,000 条分配三个项目建议暂保留；前五轮记录的 status 均为 failed，其中一轮已经完成两次 merge、在发布门禁被正确阻止，不能笼统声称这些项目“没有成功写入”。

## 计数口径

以下文件数、大小直接保留列表接口的上游仓库摘要，条目数为 BFF 对所选默认版本计算的 sampleCount；不额外声称 settings 中 Web 默认分支与上游摘要统计口径完全一致。大小为接口显示的逻辑文件字节，**不是服务器物理磁盘占用、全历史／全分支大小或预计可回收空间**。非托管数据集的条目数记为 `—`，不等于文件里没有表格记录。分支数来自 branches 全列表；workspace 格式为“总数／有 changes 的个数”。只读读取没有把样本正文存入文档。

四个 benchmark 的 API description 有现存乱码，本表按 [四包导入记录](../benchmark-import-2026-11-08.md) 给出用途，不伪称 description 已修复。

## 建议保留：10 个

全部名称均位于 `local/`；这里写完整项目标识，避免通配符误选。

| 项目 | 来源／描述与保留理由 | 条目 | 文件 | 字节 | 分支 | workspace |
| --- | --- | ---: | ---: | ---: | --- | ---: |
| `local/benchmark-behavior-drift` | 用户四包之一：行为偏移 | 1,719 | 10 | 76,562,898 | 1：main | 0／0 |
| `local/benchmark-prompt-injection` | 用户四包之一：提示词注入；存在后续正式配置 | 2,000 | 11 | 3,814,521 | 1：main | 0／0 |
| `local/benchmark-sensitive-data` | 用户四包之一：敏感数据 | 2,000 | 7 | 13,075,412 | 1：main | 0／0 |
| `local/benchmark-skills` | 用户四包之一：Skill 供应链安全 | 1,000 | 1,006 | 12,740,910 | 1：main | 0／0 |
| `local/prompt-injection-bench` | 用户桌面真实 JSONL 的原先导入；有标签及编辑验证分支，不能只按 main 文件相同推定无其他价值 | 2,000 | 2 | 1,476,842 | 7：main、4 个 label-validation、2 个 table-edit | 3／0 |
| `local/visual-search` | seed 生成的既有示例；API 描述 Live integration extension metadata；保留最基本的本地演示及集成入口 | 3 | 8 | 4,533 | 16：main、6 对 bff-check 源／目标、cli-write-check、integration-check、ui-validation | 8／0 |
| `local/r2-workflow-acceptance-mw7ckde1-2bb6d9` | 最终 passed 的真实 Oxen 协作、两次原生 merge、独立复核与正式发布来源 | 6 | 25 | 70,208 | 3：main、r2/live-4f3aea04-1、r2/live-4f3aea04-2 | 0／0 |
| `local/r2-workflow-roundtrip-mw7ckde1-2bb6d9` | 上一完整标准包的真实再导入成功结果，供版本／来源对照 | 6 | 12 | 183,064 | 1：main | 0／0 |
| `local/r2-workflow-allocation-mw7ckde1-2bb6d9` | 真实 1,000 条样本、334／333／333 无重复遗漏分配证据；没有宣称全部已标注／复核 | 1,000 | 4 | 59,250 | 4：main、r2/allocation-24af337b-1／2／3 | 0／0 |
| `local/saas-ui-check-1794095882937` | API 明确为 SaaS 镜像合成验收；保留一套小型 UI／标签／MR 对照夹具，便于继续对照 SaaS 快照 | — | 10 | 5,507 | 3：main、ui-source、ui-target | 2／0 |

保留 R2 这三库不是把它们当用户业务数据；它们都是合成数据。原因是它们是当前成功证据的主锚点。以后确认验收文档、独立控制面、完整历史备份均可恢复后，也可另行提出删除，不与本轮旧现场候选混在一起。

来源： [JSONL 与标签](../labels-and-jsonl.md)、[旧追加验证](../verification-update.md)、[本地集成](../integration-results.md)、[R2 真实服务验收](../r2-live-acceptance-2026-11-08.md)、[SaaS 对照浏览器记录](../browser-verification-2026-11-08.md)。

## 单独待确认的真实样本副本：1 个

| 项目 | 条目／文件／字节 | 分支／workspace | 建议与限制 |
| --- | --- | --- | --- |
| `local/jsonl-browser-verification` | 2,000／2／1,476,762 | main；0／0 | 可作为**明确的可选删除项**：这是旧浏览器导入验收，main 原 JSONL 与保留的旧导入相同；但含真实用户数据，备份完整仓库并明确确认此精确名称后再删。不能混入“纯合成测试”通配批量删除。 |

## 旧合成项目删除候选：精确 21 个

**以下全部只是候选，尚未执行。** 用户可在本轮整体确认这21个精确名称的清理范围；执行仍以完整备份可校验为前提。若要加上真实副本，应将其作为第22个可选项单独明确选择，默认不删。

| 项目 | 描述／来源及成为候选的理由 | 条目 | 文件 | 字节 | 分支 | workspace |
| --- | --- | ---: | ---: | ---: | --- | ---: |
| `local/audit-conflict-1794094549502` | 旧隔离 merge 冲突夹具；最终验证另有记录，不是用户数据 | — | 3 | 345 | 3：main、source、target | 3／0 |
| `local/audit-conflict-1794094608883` | 已记录通过的原生冲突拒绝探针；保留证据后可清理旧实体 | — | 3 | 345 | 3：main、source、target | 3／0 |
| `local/bff-provision-1794064362702` | 旧自动 clone／首次 workspace 写入探针；描述为空，来源由旧集成用例前缀支持，不单独推断成功状态 | — | 2 | 105 | 1：main | 1／0 |
| `local/bff-provision-1794066967909` | API 描述 Automatic managed clone integration check；旧链路夹具 | — | 3 | 344 | 1：main | 1／0 |
| `local/bff-provision-1794094742522` | 同上，后续重复集成轮次 | — | 3 | 344 | 1：main | 1／0 |
| `local/merge-request-check-1794095407299` | 旧合成 MR 验收轮次，已有更完整 R2 成功锚点 | — | 3 | 407 | 2：main、review | 1／0 |
| `local/merge-request-check-1794095782634` | 旧合成 MR 中间轮次；本次只见源／目标不同 head，不仅凭此判定最终合并结果 | — | 2 | 320 | 2：main、review | 1／0 |
| `local/merge-request-check-1794096042918` | 已记录真实 MR／评论／merge／重启读回成功；旧专项夹具，非“失败空壳” | — | 3 | 407 | 2：main、review | 1／0 |
| `local/settings-access-check-1794067096537` | 旧版本化设置及 admin 权限验收，当前 Web 默认 review；**有未提交 changes** | — | 2 | 362 | 2：main、review | **1／1** |
| `local/settings-access-check-1794096169582` | 同类后续轮次，当前 Web 默认 review；**有未提交 changes** | — | 2 | 362 | 2：main、review | **1／1** |
| `local/r2-flat-proof-probe-1794111877343` | README-only 基线下 flat proof 树／克隆不一致的负例；需保留失败元数据、分支及原生 clone 证据后再清理 | — | 1 | 37 | 3：main、left、right | 2／0 |
| `local/r2-flat-seeded-parent-1794112244688` | 共同 .oxenweb、无预建 reviews 的成功对照；left 后续已真实合并两证明，证据已沉淀 | — | 2 | 79 | 3：main、left、right | 2／0 |
| `local/r2-flat-seeded-reviews-1794112246657` | 预建 reviews 的成功对照变体；不是失败现场，但属已结束探针 | — | 3 | 112 | 3：main、left、right | 2／0 |
| `local/r2-legacy-config-92e7d01e` | 两条合成样本的旧项目选择数据源／一次配置成功探针，源码 .qa/verify-dataset-configuration.ts 明确 synthetic-only | 2 | 6 | 726 | 1：main | 0／0 |
| `local/r2-native-resolution-f5953c0d` | 原生三方裁决的首次失败现场；from_name 用 commit 的官方契约差异，后续新库重跑成功 | — | 2 | 144 | 1：main | 0／0 |
| `local/r2-native-resolution-7feb0d7d` | 原生 JSON 三方裁决／双亲／真实 push 成功探针，已写独立验证；备份后可退休 | — | 2 | 144 | 2：main、r2/source | 0／0 |
| `local/r2-workflow-acceptance-mw7b7l79-fea663` | verification=failed；建任务时 from_name 使用 commit 得到 404，主线初始化／治理已写入 | 6 | 14 | 23,146 | 1：main | 0／0 |
| `local/r2-workflow-acceptance-mw7b9k6q-1d7d37` | verification=failed；wildcard 参数整段编码导致字面 %2F 路径；**保留了有 changes 的失败 workspace** | 6 | 14 | 23,146 | 3：main、r2/live-35be9e7c-1／2 | **1／1** |
| `local/r2-workflow-acceptance-mw7bgp7u-91b925` | verification=failed；两个独立任务已审核，MR 时上游嵌套证明目录串值，不能把现场说成没有数据 | 6 | 14 | 23,280 | 3：main、r2/live-ffca1794-1／2 | 0／0 |
| `local/r2-workflow-acceptance-mw7c8f26-220086` | verification=failed；Windows CLI 原双 hash 路径过长，已保存审核和合并失败诊断 | 6 | 14 | 23,280 | 3：main、r2/live-bc871488-1／2 | 0／0 |
| `local/r2-workflow-acceptance-mw7ch3pd-4d0410` | verification=failed，stage=native-merge-2；两次真实 merge 已成功，发布门禁拒绝文件级人工意见分歧，属于正确拦截的失败基本场景 | 6 | 25 | 70,119 | 3：main、r2/live-6e9219a0-1／2 | 0／0 |

settings 两库中 Web 默认分支为 review，而上游 branches 的 isDefault 标记仍为 main；这里按接口各自语义记录，没有改写它们。workspace 无 changes 也不等于没有有价值的提交、审核证明或历史。

候选来源与失败原因参见 [旧真实性验证](../verification-2026-11-08.md)、[原生裁决](../verification-r2-native-merge.md)、[证明树对照](../verification-r2-proof-tree.md)、[R2 真实服务验收](../r2-live-acceptance-2026-11-08.md)。本轮还逐一只读读取了六轮 `.data/r2-acceptance/<run>/verification.json` 的 status/stage，前五轮 failed、最后一轮 passed。

## 官方删除能力与后续执行边界

固定本地契约 `contracts/oxen_server_openapi.json`（Oxen 0.67.0 快照、SHA256 `2ae57812994900f768c841e7e20d25418555ffbf37c3690775e2af5b8c581660`）明确包含：

```text
DELETE /api/repos/{namespace}/{repo_name}
```

此为 **Oxen 官方仓库删除 API**，不是手写猜测接口。namespace/repo_name 都是必填单路径段，无 request body；规范全局声明 api_key 鉴权。响应 200 的语义是 **Repository deletion started**，说明后台启动删除，不能将它当作已全部删除；400 为路径段非法，404 为项目不存在。本轮只读解析了规范，**没有发送 DELETE 或做删除试探**。

当前 BFF 的 `3001` 没有接入仓库 DELETE 路由；workspace 的 DELETE 不能替代删项目。以后若实施，应由受控 BFF 调用配置的官方上游（当前 `3002`），沿用上游鉴权并加项目删除授权／审计；不能为了清理直接绕开权限或手工递归删除未知目录。规范没有 expectedCommit／expectedHeads、回收站或恢复 API，不承诺原子防并发删除或一键撤销。

执行前应把下列内容做成可核对的备份与清单。已明确确认的21个名称无需重复请求同一授权；如出现新写入、无法验证备份或清单外内容，则停止受影响项目并说明差异：

1. 重新只读盘点，生成每个精确 namespace/name 的分支名／固定 head、全部提交可恢复性、workspace（含暂存内容）及关联关系清单。若清单后项目有新写入，停止该项并重审；BFF 锁不能自动阻止外部 CLI 或其他客户端写入。
2. 做可恢复备份并校验读回：包括官方仓库全历史／全分支／工作区，以及 BFF 本地 MR、任务、审核授权副本、设置、角色权限、Release 记录和资产、分享撤销／到期状态、受管 clone／失败恢复现场。真实数据和鉴权材料放受控本地备份，不写进知识库。
3. **普通工作快照／Release ZIP 不等于完整仓库备份**，不包含所有分支、历史、workspace 和 BFF 控制面；对已观测到树／clone 不一致的旧负例，更不能只看 clone 退出码就声称备份完整。需选择并验证一致的服务端备份方式，保留原有失败证据。
4. 固化已确认执行单：默认21个精确旧合成项目；真实副本jsonl-browser-verification默认保留，另外明确选择后才能加入；上述10个保留项排除。不得使用 `benchmark 以外全部`、`r2-*` 等动态通配命令替代已确认名单。
5. 整体确认后才实施；每个官方后台删除都核对完成（只读 GET 与列表共同验证）、记录结果与失败，停止对不确定状态的盲目重试。官方删除不会自动清除 BFF 控制面、分享、Release 资产或本地 clone；这些需先备份，再按独立清单禁用／清理，不能留下仍可下载的旧分享，也不能误删其他项目的公共数据。

本轮交付止于上述盘点与提案。应用、服务进程、项目数据、权限和磁盘上的真实仓库都保持本轮原状。
