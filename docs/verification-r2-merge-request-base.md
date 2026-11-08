# R2 合并请求的共同基线比较验证

日期：2026-11-08。范围：Web/BFF 的 MR 预览语义，不修改官方 Oxen 或现有仓库历史。

## 修复语义

目标分支已经合并第一支，而第二支尚未包含第一支时，直接比较 `targetHead → sourceHead` 会把目标独有文件误显示为第二支要删除的文件。实际原生合并采用三方语义，应保留这些独有变更。

现在固定两端提交，分页读取完整祖先 DAG，检查 head、所有父节点、父链一致性、可达性与无环性，再选取唯一的最佳共同祖先。`MergeRequestComparison.baseCommitId` 为该基线；`files` 比较 `baseCommitId → sourceCommitId`。目标头仍单独固定，继续用于 stale、CAS 及真实合并前检查。旧 MR 存储无需迁移，可以从原有两个固定提交计算基线。

祖先超过每端 10,000 提交、缺失父节点、没有共同基线、多个有效共同基线或不一致 DAG 均明确失败，不选择第一条历史记录或返回局部比较。文件 before 标签和删除前预览改用共同基线；目标头不再被当成文件 before 内容。这些界面调整的渲染核对由主线程单独记录。

## 专项测试

实际运行：`npx tsx --test apps/server/test/merge-requests.test.ts apps/server/test/merge-requests-live.test.ts`，**14 通过、0 失败、1 跳过**。跳过的是需显式开启的真实写入验收；没有在本次修复中重写已有真实合并历史。随后单独重复 `merge-requests.test.ts` 为 **14/14 通过**，`npm run typecheck` 退出码 0。

新增回归覆盖：

- 目标已经合并另一分支的标注，源只写自己的标注；比较只显示源新增文件，合并后双方文件仍在。
- 旧 MR 保存后目标前进：原比较保持固定并标 stale；显式 refresh 后仍计算正确共同基线。
- 源分支真正删除的文件仍显示 removed，before 来自实际共同基线。
- 缺失祖先、无共同祖先、多个有效 merge base、循环均在调用文件 diff 前明确拒绝。
- 历史顺序打乱及多父 DAG 仍按父链选择最新共同基线，不依赖时间或响应排序。

原有评论 CAS、关闭/重开、权限、队列撤权、重启恢复、合并结果不确定性及实际源祖先验证保持通过。

## 官方本地服务的只读验证

执行 `npx tsx .qa/verify-mr-merge-base.ts`，仅 GET 官方 0.67.0 服务上已有合成仓库 `local/r2-workflow-acceptance-mw7ckde1-2bb6d9`。使用该轮已保存的两个 MR 固定提交，不创建任务、提交、分支或再次合并。

| MR 源分支 | 固定源提交 | 固定目标提交 | 计算的共同基线 | 文件结果 |
| --- | --- | --- | --- | --- |
| `r2/live-4f3aea04-1` | `6e1e30cb141001b69d95a769e1cc55e2` | `35093dbbd82934f54ca98d22b0fa0c50` | `35093dbbd82934f54ca98d22b0fa0c50` | 6 added、0 removed |
| `r2/live-4f3aea04-2` | `a582fe8ee941950eb7ce1c966f2c28f3` | `6e1e30cb141001b69d95a769e1cc55e2` | `35093dbbd82934f54ca98d22b0fa0c50` | 5 added、0 removed |

第二支领先 2、落后 2 个提交，未把第一支的标注或审核证明显示为删除。两支分别再与当前 main `778c90d8765b5189c20ad2521babf23a` 比较，基线为各自源 head，ahead 为 0、文件变更为 0，符合两支已经实际合并的历史。

这也确认本轮官方历史接口提供了足以闭合的双亲 DAG，而非仅第一父链。元数据证据：`.data/r2-acceptance/mw7ckde1-2bb6d9/merge-base-verification.json`。本记录没有用户样本正文或令牌，接口验证不替代浏览器预览验收。
