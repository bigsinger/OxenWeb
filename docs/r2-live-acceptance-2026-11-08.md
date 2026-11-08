# R2 官方 Oxen 真实服务验收（2026-11-08）

状态：**真实官方 Oxen 0.67.0 的 6 条合成样本完整链路已通过**；另有真实后端 1,000 条分配验证，以及 Demo/BFF 的 1,000 条完整协作机制验证，三项分别报告。浏览器交互由主线程独立验收。本记录只保存接口差异、计数、路径、提交和摘要，不保存令牌或样本正文。

## 当前通过结果

最终通过轮次为 `mw7ckde1-2bb6d9`，`.data/r2-acceptance/mw7ckde1-2bb6d9/verification.json` 的最终状态为 `passed`。

| 项目 | 实际结果 |
| --- | --- |
| 真实源仓库 | `local/r2-workflow-acceptance-mw7ckde1-2bb6d9` |
| 数据规模 | 6 条合成样本、2 个独立 ZIP 附件 |
| 独立身份 | 2 名执行者（editor/annotator），另一名 reviewer；实际使用不同令牌 |
| 规范 | 本轮独立控制面真实发布两维模板并固定版本绑定 |
| 保存 | 正文编辑、三级标签、真正选中 😀 的 Unicode 码点片段、JSON Pointer 步骤标注均经真实 workspace/commit 保存 |
| 权限负例 | 未分配样本修改、自我复核返回拒绝 |
| MR 与合并 | 两个 MR 实际创建、刷新、入队、轮询成功；经官方 CLI 合并 |
| 第一次合并提交 | `6e1e30cb141001b69d95a769e1cc55e2` |
| 最终固定提交 | `778c90d8765b5189c20ad2521babf23a` |
| 正式发布 | `v1.0.0`，发布 ID `85ee04ba-4462-4720-b979-a88c178d7455`，真实构建完成后发布 |
| 完整包 | 95,142 字节、15 个成员；包括 README、schema、changelog、原字段、采纳标签/片段/步骤、附件和原始归档 |
| 包 SHA-256 | `5765ffd3f420728cc9b99c3b773a51de5de630d6378a77f413078da7bd48f3be` |
| 包内验证 | 每个文件均被 checksums 覆盖且哈希匹配；导出的码点切片实际还原为 😀 |
| 真实重新导入 | `local/r2-workflow-roundtrip-mw7ckde1-2bb6d9`，提交 `e9344643d0f0107ec4f46338369b0c2a` |
| 重新导入结果 | 6 条身份完全一致；原字段及嵌套值、已采纳的三级标签、2 个附件字节保持一致；原审核证据只作来源保存 |
| 原始基线 | 原 JSONL 与源 ZIP 完整哈希不变；JSONL SHA-256 为 `56138bcb48477a106aa698b88acf249a62ab3e608b2fd8e50a9dd2490cadbc01` |
| Windows 路径预检 | 25 个受检跟踪路径；最长 checkout 219 字符，含保守临时后缀 239 字符；随后真实 CLI 验证成功 |

测试构建的 ZIP 保存于 `.data/r2-acceptance/mw7ckde1-2bb6d9/synthetic-release.zip`。生产 UI 可只读打开 [真实源工作台](http://127.0.0.1:3001/repos/local/r2-workflow-acceptance-mw7ckde1-2bb6d9/table) 和 [重新导入工作台](http://127.0.0.1:3001/repos/local/r2-workflow-roundtrip-mw7ckde1-2bb6d9/table)。这些 localhost 链接只对本机有效。

本轮任务、角色、发布记录属于独立的 `.data/r2-acceptance/.../control-plane`，不把它们混入生产 BFF 的控制面。真实仓库和版本文件位于共同本地 Oxen 上游，生产工作台可浏览；生产任务/发布列表不会凭空出现独立测试控制面的记录。

## 环境与边界

- 官方本地服务：`http://127.0.0.1:3002`，`/api/version` 实测 `oxen_version=0.67.0`。
- BFF 使用 `DEMO_MODE=false`、真实 `LiveProvider` 和 `createApp().inject()`，没有以 DemoProvider 代替上游。
- 每轮使用新的 `local/r2-workflow-acceptance-<run>`、独立 `.data/r2-acceptance/<run>/control-plane`、CLI clones 和发布存储。脚本不启动、停止或重配生产服务。
- 只创建合成 JSONL、ZIP、README、规范、独立身份和任务；**没有改动 `benchmark-sensitive-data`、`benchmark-behavior-drift`、`benchmark-prompt-injection`、`benchmark-skills` 四个真实 benchmark 仓库**。
- 测试 owner 令牌每轮随机产生；owner/协作者令牌只在进程内使用，不写本记录、verification 或控制台。

脚本：[scripts/r2-live-acceptance.ts](../scripts/r2-live-acceptance.ts)。每次运行均创建独占的新 UUID 目录和新仓库，不盲目复用失败工作区；失败保留证据，退出码为 1。只有全部验收完成才写入 `status=passed`。详细记录原子保存为 `.data/r2-acceptance/<run>/verification.json`。

## 已发现的真实契约差异

### 1. 创建分支的 from_name

首轮 `mw7b7l79-fea663` 已完成真实 workspace 初始化、组织规范发布/绑定和三级基础标签。任务创建把固定 commit 哈希传给公开分支接口的 `from_name`，官方 0.67 返回 `404 resource_not_found`，任务状态正确保留为 `setup-failed`。

修正方式是从已存在的来源分支创建，创建前后分别核对来源 head 和新分支 commit 等于已锁定基线；不把不断移动的分支当作固定版本，也不删除失败分支掩盖结果。该问题被 DemoProvider 接受 hash 的行为掩盖，真实后端验证补足了差异。

### 2. wildcard 路径与目录分隔符

第二轮 `mw7b9k6q-1d7d37` 分支创建成功，但逐样本保存失败。官方 workspace `11f523b9-31f1-45d5-b12f-893cb549a3b6` 的只读 changes 实际出现 `.oxenweb%2Fdataset%2Frows/...`、`.oxenweb%2Fdataset%2Flabels%2Frow/...` 字面目录。

生成客户端将 wildcard 参数整体编码为 `%2F`，与实际 0.67 路由行为不一致。已由 LiveProvider 适配器对明确的 `path/resource/branch/base_head` wildcard 路由按段编码、保留 `/` 分隔；普通 namespace/repo 仍保持校验和正常编码，字面百分号与 Unicode 不做全局解码。失败工作区没有在修正后继续提交。

### 3. 新建多层目录在分歧分支上的列表串值

第三轮 `mw7bgp7u-91b925` 已真实完成两个任务、两名执行者、另一名独立复核者，共 6 条样本的正文编辑、三级标签、Unicode 片段和步骤标注；越权行修改和自我复核均被拒绝。

MR 比较阶段遇到 404：官方 compare/目录列表把另一个分支的任务证明列到了当前分支。实际用各自固定提交读取各自证明均为 200；当前分支读取错误列表里的另一个任务证明才为 404。源码核对和只读复核排除了“UUID 被当作 workspace 别名”的初始猜测。

本地扩展改为平铺 `.oxenweb/reviews/<task-id>-<review-id>.json`，并在创建任务前要求基线已有共同 `.oxenweb` 根目录，否则在产生任务、分支、workspace 前明确要求一次性配置。旧证明仍按记录中的原 storagePath 读取，不改写官方 server 或核。平铺后的真实 MR 比较与两次原生合并已通过；未初始化任务无副作用的独立回归也通过。

另用 `--inspect-run mw7bgp7u-91b925` 在全新 DatasetService 中重新读取两个旧固定分支，均为 6 条样本、各 3 个正确执行者记录，无跨 actor 串值；这些数据物化检查没有依赖原进程缓存。

### 4. Windows CLI 的长路径

第四轮 `mw7c8f26-220086` 已进入真实合并队列，但原 `targetSHA256-actorSHA256.json` 命名导致 checkout 目标路径 281 字符、临时文件 296 字符，官方 Windows CLI rename 返回系统错误 3。

逐目标/actor 标注文件改用完整 `SHA256(target,actor).json`，保留 256 位摘要强度，文件名由 134 缩为 69 字符；兼容旧双摘要记录，只读保留旧审计，同目标同 actor 新旧并存时确定采用新路径，不产生自我冲突。旧记录通过 supersededLabelRecords 供完整导出审计。脚本在合并前检查所有跟踪文件及临时后缀的最长路径，不以单纯迁移测试目录掩盖问题。

第五轮 `mw7ch3pd-4d0410` 的最长 checkout 路径为 219 字符，保守临时路径为 239 字符，官方 CLI 已完成两次 MR 合并。随后发布预检正确阻止了测试自己引入的两处文件级人工意见分歧，未放宽门禁；基本成功场景随后改用一致的文件级值，冲突场景由独立负例保留验证。

## 合成全规模工作流

独立 `workflow-review.test.ts` 已完成 1,000 条完整 Demo/BFF 机制验收：三名独立执行者按 334/333/333 分工，各分支批量写入标注，另一名 reviewer 逐项复核，三次顺序合并。最终 1,000 条有效赋值和 1,000 条采纳结果齐全，任务均为 merged，原始 JSONL 字节未变。耗时约 79 秒。该项验证完整应用机制，不替代真实 Oxen 链路，也不是对真实 benchmark 的人工审阅结论。

## 两类 1,000 条验证的区别

| 验证 | 数据与后端 | 已完成范围 | 不作的推断 |
| --- | --- | --- | --- |
| 真实 1,000 条分配 | 官方 Oxen 0.67.0；`local/r2-workflow-allocation-mw7ckde1-2bb6d9` | 真实创建 1,000 条样本及独立三人任务；334/333/333；稳定身份集合恰好 1,000 个，无重复遗漏 | 没有对这 1,000 条继续打标、复核或发布 |
| Demo 1,000 条完整工作流 | 合成 DemoProvider，经真实 BFF 权限/保存/任务/复核/合并逻辑 | 三个分支批量标注全部条目，另一身份独立复核，三次顺序合并；最终 1,000 条有效赋值、1,000 条采纳结果、全部任务 merged，原 JSONL 不变 | 不以它替代真实后端的合并验证，不宣称真实 benchmark 已由人工审核 |

正式发布、原生 CLI 两次合并和完整包再导入的真实服务证明来自上面的 **6 条完整真实链路**，不把不同规模和后端的测试结果相互替代。

浏览器交互验收由主线程统一执行；本脚本通过真实 BFF 注入和官方上游验收，不将接口测试替代浏览器验收。
