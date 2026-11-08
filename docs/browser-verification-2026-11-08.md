# 2026-11-08 最终界面与构建验证

此记录针对当前单一交付版本。登录后 SaaS 观察见[登录后快照](saas-logged-in-snapshot.md)，后端正确性与真实 CLI 记录见[正确性验证](verification-2026-11-08.md)。本页记录已执行的本地浏览器动作，不用静态组件存在代替交互成功。

## 本地浏览器结果

| 实际操作 | 结果 |
| --- | --- |
| 在 2,001 行测试分支加载 JSONL，追加一条只保存在本地的测试草稿，点击“文件” | 站内未保存编辑确认出现；取消后仍在原文件/分支，1 项草稿保留 |
| 同一草稿下把分支选择器切到 main，然后取消 | 选择器恢复 `table-edit-1794067179822`，URL 未切换，草稿保留 |
| 明确放弃测试草稿后进入文件预览，点“返回目录”，刷新 | URL 不再含 file；刷新仍是目录，没有重新打开已经关闭的预览 |
| 打开 c9f41d8c… 的真实用户 JSONL 历史提交 | 完整显示新增 1、修改 2,000、总行数 2,000→2,001、新增 editor_note，分页而不缩减计数。检查中发现原生表格结构归一化会补出 null；已改用原 JSONL 全量保真比较，缺键与 null 区分有单测与真实回归 |
| 合成数据按相同 SaaS 条件在本机执行规则 `score 大于 0.9` | 返回 test-1/test-2，共 2 条，与 SaaS SQL 和自然语言两次查询一致 |
| 新建 MR，选择 ui-source→ui-target，比较 | 两端 commit 固定；显示领先 1/落后 0、两个变更文件，notes.txt 前后文本，以及 sample.jsonl 单条 label 的 pending→reviewed |
| 填标题和描述创建，保存评论，关闭，再重新打开 | URL 保存请求 ID；评论及快照保留，revision 随操作递增；关闭后出现重新打开按钮 |
| 核对确认框内 revision/source/target 并执行合并 | 实际 CLI merge/push 成功，界面变为已合并，显示实际结果 commit。目标内容经独立 API 回读确认，不只检查成功提示 |
| 重启 BFF，以生产构建重新打开同一 MR | r7/merged 和评论仍在，保留合并前审阅快照；已合并状态不再显示无法执行的“更新快照”警告 |
| 在样本行标签中填写未保存列名和选项，离开页面/切数据集 scope 后分别取消 | QA-DRAFT 列名和两项选项保留，scope 仍为 row；明确放弃后才能离开，没有提交测试标签或改写源数据 |
| 最终生产页面控制台 | error 日志为空 |

离开提示改为可访问的站内 alertdialog，保留浏览器标准 beforeunload 作为关闭窗口的保护。早期原生 confirm 卡住的页面只包含本次临时测试草稿，已通过关闭该测试页恢复；正式数据没有丢失。

## 可回读的 MR 证据

- 仓库：`local/saas-ui-check-1794095882937`。
- 初始目标：`199138db569407a607eb377ed0059d08`；审阅源：`f7d31e0664ba86a182d2962919d4cefc`。
- 请求：`8ccb6ba2-4b14-421c-989a-c7ec83d53cc6`，最终 r7/merged，结果目标 commit 等于审阅源，评论 1 条。
- `notes.txt` 已是审阅后的正文，JSONL 第一条 label 已为 reviewed。
- 独立回读：[JSON 证据](evidence/local-2026-11-08/03-merge-request-readback.json)。
- 截图/DOM：[生产构建](evidence/local-2026-11-08/05-production-merged.jpg)、[可见状态](evidence/local-2026-11-08/05-production-merged.txt)、[编辑离开确认](evidence/local-2026-11-08/01-unsaved-edit.jpg)、[保留标签草稿](evidence/local-2026-11-08/04-label-draft-preserved.jpg)。

## 最终命令结果

- `npm run generate:api`：成功，固定 Oxen 0.67.0，35 项有源码依据的规范修正。
- `npm run build`：成功，含 Vue/服务端类型检查、Vite、BFF 编译；最后服务端守卫更新后再次编译 server 成功。Vite 仅提示组件同时静态/动态引入，不影响运行。
- `npm test`：**70 项，63 通过，0 失败，7 个真实服务用例默认跳过**。不把跳过计为通过。
- 7 组真实服务用例均已在本轮显式启用执行：合并冲突保护、CLI 完整链路、MR、表格 diff、真实 2,000 行标签、设置/独立角色、源数据编辑。前四组由对应模块维护者执行，精确证据见后端记录与快照；主线程最终又执行了后三组，**3/3 通过、0 跳过**。

后三组的实际命令：

```powershell
$env:OXEN_LABEL_LIVE_TEST='true'
$env:OXEN_TABLE_LIVE_TEST='true'
$env:OXEN_SETTINGS_LIVE_TEST='true'
$env:OXEN_SAMPLE_FILE='<本地样本路径>/prompt_injection_bench.jsonl'
npx tsx --test --test-name-pattern='^real ' apps/server/test/labels-live.test.ts apps/server/test/table-editor-live.test.ts apps/server/test/settings-access.test.ts
```

本次标签分支 `label-validation-1794096170213`，标签提交 `52b32ab706e30335a15269106f230d68`，继承提交 `9ed6160ae7c04622050ee4330f28835f`；设置测试仓库 `local/settings-access-check-1794096169582`，配置分支 main/默认 Web 分支 review；数据编辑分支 `table-edit-1794096169761`、提交 `3c9c45003735f7b9fe6d5078dff863e9`，2,001 行且源 main 仍为 2,000 行，行标签保留，过期写入拒绝。

最终停止两个开发进程，运行 `npm start` 提供构建后的 SPA+BFF：`http://127.0.0.1:3001`。`npm run oxen:status` 返回 ready=true、Oxen 0.67.0、上游 `http://127.0.0.1:3002`。没有发布到外部托管平台，也没有执行 Git commit/push。
