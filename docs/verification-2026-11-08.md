# 本地 API、CLI 与一致性审查记录

本记录覆盖原方案中的本地数据管理和协作后端，记录具体修复、命令及回读结果，不作 SaaS 等价结论。检查使用本项目自己的 Oxen 服务、样例仓库和测试数据；未操作 Chrome，也未向外部 SaaS 写入。

检查时 `http://127.0.0.1:3001/api/status` 返回 live/ready、BFF 1.0.0；`http://127.0.0.1:3002/api/version` 返回 Oxen 0.67.0。这是当次观察，不代表后续持续运行状态。

## 已修正的具体问题

| 问题 | 修改及验证 |
| --- | --- |
| 目录固定 100 页后静默停止 | `LiveProvider.tree` 收齐分页，并将 branch 固定成实际 commit；第 101 页、25,250 条的回归用例通过 |
| Diff 固定 10 页，权限检查可能漏掉后续策略文件 | `LiveProvider.diff` 收齐分页，base/head 固定为 commit；第 11 页的 `.oxenweb/repository.json` 被包含 |
| workspace 只显示每类首 1,000 个变更 | added/modified/removed 分别核对完整页数；第 1,001 条策略文件被包含，避免权限判断基于不完整清单 |
| 根提交文件只取 1,000 个、递归深度 12 | 改为迭代遍历；16 层深目录中的 1,200 个文件完整返回 |
| 列表/预览跨请求读取移动分支 | 内部分页使用固定 commit；预览 raw URL 指向本次读取的 commit，不能在稍后取媒体时无提示切到新 head |
| 上游分页不完整仍可能呈现为完整结果 | 目录/diff/changes 发现提前空页返回明确错误；超过 100,000 项的安全上限也明确失败，不返回无标记的部分结果 |
| 外部 workspace 的目标分支可能被猜成 main | 无 BFF 映射时，仅在恰好一个分支匹配 base commit 时推断；多个候选保持未知，提交返回 `WORKSPACE_BRANCH_UNKNOWN` |
| CLI merge 冲突可能以进程退出码 0 返回 | 实际合并前调用原生 mergeability API；冲突路径返回错误，不启动 CLI/push。CLI 合并后再次验证工作树清洁 |
| 排队期间分支或权限变化 | 入队捕获 source/target commit；Provider 锁内及预备后核对 heads；执行与写入前重新验证 actor 权限，撤权后排队任务不能继续写入 |
| 策略合并期间 admin 被降为 editor | 根据固定 source/target diff 捕获策略变更，在 `beforeWrite` 仍要求 admin；不能因为降权后的身份仍有普通 write 权限就允许发布策略 |
| UI 远端分支合并混入本地未发布提交 | `localBranchHead` 用固定版本 CLI 的 `log --revision … -n 1` 严格读取 head；source/target 本地 tip 与捕获的远端 tip 不同则拒绝，不重置或丢弃本地提交 |
| CLI head 误要求固定 32 字符 | 后续 MR 真实回归发现 main 的完整 hash 只有 30 字符，HTTP 与 CLI 一致；解析器改为未补零的 1–32 位十六进制，仍要求首行 commit heading 并与远端 ID 精确比较 |
| 表格 diff 被原文本 256 KiB 门槛挡掉 | `LiveProvider.diff` 已接入独立 `buildTabularDiff`；原生分页与保真结构化 fallback 的测试由对应模块记录，不能把 fallback 冒充 Oxen 原生结果 |

相关代码：`apps/server/src/live.ts`、`managed-cli.ts`、`provider.ts`、`app.ts`、`tabular-diff.ts`。

实际服务还揭示了一个契约描述边界：Oxen 0.67 的 mergeability GET 使用 commit hash 范围时返回 `resource_not_found`，使用分支名成功。因此预检使用分支名，并在前后核对其 commit ID 一致；不能用 mock 的 hash 范围成功代替真实 API 验证。

## 常规回归

实际执行并成功退出：

```powershell
npx tsc --noEmit -p apps/server/tsconfig.json
npx tsx --test apps/server/test/consistency-audit.test.ts
```

`consistency-audit.test.ts` 加入真实短 hash 的解析回归后再次执行，**12/12 通过**。测试覆盖短 hash/非法 heading、分页/深度/版本检查、原生合并预检、workspace 歧义、撤权后的队列写入拦截、策略合并等待期间 admin→editor 的拒绝、私有任务结果权限及模型身份边界。分页和权限故障用可控的契约响应及本地持久 fixture 测试；它们不是外部 SaaS 测试。

本记录中的 12 项不是项目当前全量测试总数。表格 diff、标签、源编辑、仓库设置、MR 和浏览器的其他测试由各自记录说明。

## 真实冲突保护

命令：

```powershell
$env:OXEN_AUDIT_LIVE_TEST = 'true'
npx tsx --test apps/server/test/consistency-audit-live.test.ts
Remove-Item Env:OXEN_AUDIT_LIVE_TEST
```

真实测试 **1/1 通过**，约 2.15 秒。使用 Fastify 请求真实 Provider，由 Provider 实际连接本地 Oxen：

| 项目 | 实际值/结果 |
| --- | --- |
| 仓库 | `local/audit-conflict-1794094608883` |
| 源分支提交 | `e9ac6932a5aef58dfd150398c093ff95` |
| 目标分支提交 | `5e7839da4658e822d3672de0f20a6a35` |
| 冲突文件 | `data/conflict.txt`，两分支从同一原值分别修改 |
| 合并结果 | job failed，错误包含冲突文件路径 |
| 目标回读 | commit ID 未变，文件仍为目标版本 `target version` |
| CLI 副作用 | 受管 clone 目录不存在；未初始化 clone、未执行 push |

测试仓库保留于本项目本地服务以便核对。临时 BFF 数据和 clone 根由该测试自身清理。

## 真实正常 CLI 链路回归

命令：

```powershell
$env:OXEN_LIVE_TEST = 'true'
npx tsx --test apps/server/test/live-integration.test.ts
Remove-Item Env:OXEN_LIVE_TEST
```

该次真实测试 **1/1 通过**，约 19 秒。继续验证 workspace 暂存/上传、真实 CLI workspace commit、合并、push、真实内容回读、版本化设置和新仓库自动 clone。

| 项目 | 实际值/结果 |
| --- | --- |
| 样例仓库 | `local/visual-search` |
| 源分支 | `bff-check-1794094729378-source` |
| 目标分支 | `bff-check-1794094729378-target` |
| CLI workspace 提交 | `61937dc40efb8658574ba5bf1dd7e062` |
| Merge | 原生预检后，plain fetch、checkout/pull source、checkout/pull target、CLI merge、post-clean、push target 成功；目标文件回读通过 |
| Push | source 推送成功，CLI 返回 `Everything is up to date` |

数据写入在专用分支和新测试仓库执行；原有完整集成用例还会在本地 `visual-search` 样例的 main 更新测试用 repository.json 描述/tags。没有改写用户桌面原始 JSONL，也没有修改外部 SaaS 数据。

## 模型身份边界

完整鉴权 hook 的实际回归表明：公开仓库的匿名 GET 可读，但现有认证层拒绝所有匿名 POST，包括规则查询 POST。因此，早先只阅读仓库 read-hook 时提出的“匿名模型额度”假设，在当前完整应用中没有复现为可利用漏洞。

模型路由另加非 guest 的纵深校验，提示仅为 `Sign in before using model queries.`，不声称匿名规则 POST 已获允许。回归验证：

- 匿名公开 GET 成功；匿名 model POST 即使设置字段外发允许也返回 401。
- 已登录 viewer 可执行本机规则查询。
- 所有者未明确允许字段结构外发的 model 请求返回 403。

测试将模型 binary 指向不存在的临时路径，即使鉴权退化也不会实际启动 Codex 或发送任何模型请求。

## 尚需明确保留的本地边界

- 目录/diff/暂存列表最多 100,000 项；原文件代理 25 MB、上传 10 MB；表格 diff 自身也有行数/字节上限。超限是明确错误，不是完整结果。
- 普通大文本 diff 仍保留原来的前 20 个文件且每个小于 256 KiB 的内联展开限制；表格不再受该文本门槛限制。
- 外部 CLI workspace 缺少可靠 branch 映射且存在多个候选时，尚无显式分支绑定 UI；现在会拒绝猜测目标分支。
- 分支/权限检查无法构成公开 Oxen API 没有提供的跨系统原子 CAS；服务端同文件冲突检查与客户端显式刷新仍然必要。
- 本地锁、会话和任务队列是单 BFF 进程模型；MR 持久状态及中断恢复的独立审查见下节，不能因已注册路由就认定通过。

本记录不覆盖登录后 SaaS 页面、角色矩阵或 MR 交互等价性，也不替代根任务维护的实际页面观察与最终验收结论。

## MR 后端独立代码审查

为避免重复运行，MR 模块维护代理负责其测试执行，本审查读取实现并核对 actor、CAS、job 和 restart 路径，向维护代理提交定向失败用例。本节不把代码存在或路由注册当作 SaaS 交互通过。

确认的实现边界：

- actor 来自服务端 `requestIdentity`，请求体不能指定作者；记录按 namespace/repo 隔离，统一仓库访问 hook 仍然生效。
- `expectedRevision` 在单个序列化持久事务内检查；评论、关闭、重开及刷新使用同一 CAS。临时文件 rename 成功后才发布新内存快照。
- 创建/比较保存实际 source/target commit；合并前要求当前 heads 匹配，策略文件变更在 Provider 的 `beforeWrite` 阶段仍要求 admin。
- `merging` 与 attemptId 先持久化；job ID 登记仓库，任务结果读取执行相同仓库权限检查。重启只标记 interrupted，不自行猜测成功或重放写入。

审查提出并由模块维护者修正/补测的失败路径：

| 用例 | 修正后的要求 |
| --- | --- |
| Provider 已写远端，返回前抛超时/连接错误 | 保持 `merging + interrupted`，要求检查目标；只有源码明确的写前拒绝才回普通 open，不盲目重试 |
| target 发生无关提交，但 Provider 返回 success | 必须确认新 target 的祖先包含已审阅的 source commit，不能仅凭 target ID 改变就标 merged |
| queue.add 因容量拒绝，尚未创建任务 | 回 open，清除 attempt，Provider 调用为 0；持久状态可重载 |
| admin 在 Provider 准备期间降为 editor，source/target heads 未变 | 策略合并的 beforeWrite 仍按 admin 检查，拒绝实际写入 |

模块维护代理报告 `apps/server/test/merge-requests.test.ts` **10/10 通过**，包含这些新增失败用例及既有角色/CAS/重启检查；本审查没有重复执行该套测试。

维护代理随后使用下面的命令执行最终真实 MR 联调，**1/1 通过**，已包含新 target 祖先校验与短 hash 解析修复；这里记录其回传证据，不冒充独立重复执行：

```powershell
$env:OXEN_MERGE_REQUEST_LIVE_TEST = 'true'
npx tsx --test apps/server/test/merge-requests-live.test.ts
Remove-Item Env:OXEN_MERGE_REQUEST_LIVE_TEST
```

| 项目 | 实际值/结果 |
| --- | --- |
| 专用仓库 | `local/merge-request-check-1794096042918` |
| 审阅 source | `371d418394f9c916de3f74f0dbacc367` |
| 合并前 target | `8a23426c8b74c4b8d84a0e8c39d68fd5` |
| 合并后 target | `371d418394f9c916de3f74f0dbacc367`，祖先检查包含审阅 source |
| 持久层回读 | target `review.md` 为提交的真实内容；评论存在；新 BFF 实例读取状态 merged |

该测试未修改根任务的独立浏览器验收仓库。最终页面交互结果由根任务单独记录。

MR 元数据明确使用 BFF 本地持久文件，未冒充 Oxen SaaS 私有协作接口。该设计不是多进程数据库事务，也不保证 HTTP 确认与远端写入之间的原子提交；遇到确认失败应重读 MR 和 target，不能自动重复执行。
