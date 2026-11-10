# R22 删除与撤销结果核对

日期：2026-11-10。此项是本地 Web/BFF 扩展；复用已冻结的 SaaS 交互资料，没有新增 SaaS 观察，没有修改 Oxen 内核或 OpenAPI。

## 当前交互

| 结果 | 页面行为 | 后续操作 |
| --- | --- | --- |
| 服务端明确成功 | 显示成功，移除当前目标；成功后的列表刷新失败单独提示 | 只读刷新；不会把刷新失败显示成删除失败 |
| 浏览器传输层重发同一 DELETE，收到匹配操作记录的成功回执 | 仅当当前出站操作 ID 与响应 ID 一致，且响应为 `OPERATION_ALREADY_SUCCEEDED`／`X-Operation-State: succeeded` 时按已确认完成处理 | 不需要再次 GET 证明成功，也不额外发送 DELETE；后续刷新失败单独提示 |
| 已证明写入前拒绝 | 保留目标，显示权限、版本冲突或校验错误 | 权限不放宽；旧访问策略须重新读取后才能再修改 |
| 网络中断、响应不可读或写后故障 | 先读取同一项目、同一凭证上下文的当前状态 | 可证明目标已不存在／分享已撤销时，明确显示“已从最新状态核对”；否则保留未知 |
| 核对时无权限、网络失败或目标仍存在 | 显示结果待核对，锁定当前目标的重复删除／撤销 | “核对结果”仅发 GET，不重放 DELETE |

工作区删除和项目协作者撤销记录目标身份，不随列表重新选择而改变。账号、凭证或项目切换会同步清除旧页面状态；递增上下文代数也阻止切换后再切回时接受旧响应。项目协作者的一次性令牌不跨身份显示。页面已用授权读取证明目标移除时，只清除匹配操作 ID 的全局提示，不清除其他操作提示，也不改写服务端日志。

## 路由覆盖与边界

| DELETE 路由 | 持久操作记录 | 页面／核对方式 |
| --- | --- | --- |
| `/repos/:namespace/:repo/releases/:id/shares/:shareId` 及现存 v1 数据集别名 | `release.share.revoke`，固定 Release UUID 和分享 UUID | 发布页使用脱敏分享列表；受权限约束的 `revokedAt` 可供操作对账确认 |
| `/repos/:namespace/:repo/workspaces/:id` | `workspace.delete`，固定工作区 ID | 工作区页读取本项目完整工作区列表，核对目标是否已不存在 |
| `/repos/:namespace/:repo/access/:id` | `access.revoke`，固定协作者 UUID | 项目访问页读取本项目完整访问策略，核对目标是否已不存在；保留原 CAS |
| `/repos/:namespace/:repo/labels/columns/:columnId` | `annotation.column.delete`，沿用提交锚点 | 覆盖现存 API；当前界面没有列删除入口，本轮未恢复旧标签维护功能 |

`resourceId` 仅接收 UUID。日志仅保留操作摘要与允许的锚点，不保存令牌、分享签名或请求正文。工作区和访问策略的当前缺项只证明当前状态，页面不会据此把未知服务端日志归因为本次请求成功。分享撤销可通过现有只读对账入口、同项目同 Release 的撤销证据确认；无证据或无法读取时仍为未知。

登录退出、临时 ZIP 检查文件清理、私有 UI 输入检查点删除不进入业务操作日志。非退出 DELETE 在网络失败时仍明确提示结果未知，不生成伪造的操作核对链接；检查点的版本检查、私有草稿保护和临时文件清理规则保持原状。项目移除等 POST 操作不属于本项 DELETE 改造。

## 自动验收

运行 `npx tsx --test apps/server/test/delete-operation-r22.test.ts apps/server/test/operation-http.test.ts apps/server/test/publishing-operation-boundary.test.ts apps/server/test/settings-access.test.ts`：32 项，31 通过、0 失败、1 原生服务显式启用项跳过。记录：本机忽略目录 `.data/r22-delete-regression.log`。

新增 10 项覆盖：实际分享撤销完成后丢响应；写入完成后的审计故障与重启只读对账；403 明确拒绝；核对权限丢失和网络失败；跨项目目标隔离；工作区删除与访问 CAS 拒绝；工作区／访问删除完成后丢响应且各仅一次 DELETE；旧身份结果隔离与只清匹配全局提示；令牌形状锚点拒绝；不可读响应和核对期间身份变化不误报成功。仅使用隔离合成临时存储。

浏览器故障注入随后发现：一次 UI 意图／fetch 也可能因传输层自动重发而产生两个相同 ID 的后端 DELETE；第二次已被持久日志阻止执行，返回已完成回执。针对这一事实增加了两项测试，总计 `delete-operation-r22.test.ts` 12 项通过、0 失败（`.data/r22-delete-transport-retry.log`）。真实路由测试消费首次 204，再向同 ID 发第二次请求，验证后端撤销方法实际仅执行一次、日志状态 succeeded、前端只发一次 fetch、无额外 GET 证明，并保留成功后的独立刷新错误语义。缺少成功状态、响应操作 ID 不匹配、过期身份上下文仍不能确认；POST 不适用该 DELETE 回执规则。修复后再次 `npm run typecheck` 通过。

最终同组回归重跑：34 项，33 通过、0 失败、1 原生服务显式启用项跳过，记录 `.data/r22-delete-regression-final.log`。独立官方 0.67.0／3008 的完整发布验收另由主任务记录，不以此跳过项冒充原生权限测试通过。

`npm run typecheck` 验证 Vue 与服务端类型。最终合成CUA真实撤销后断开响应，浏览器传输层同ID重试被journal阻止重复执行；页面将完成回执确认为“已撤销”，后续GET503独立提示列表刷新失败，不再同时显示未知横幅。只读重试恢复列表。远端12项浏览器回归全部通过，含响应丢失后GET核对场景；详见 [R22主记录](implementation-r22.md)。没有运行本机Playwright／CDP，没有改写真实样本或实际协作权限。
