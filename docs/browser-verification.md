# 浏览器验证记录

日期：2026-11-07（Asia/Shanghai）。使用 Codex 内置浏览器对本机 Vue 页面、真实 BFF 与 Oxen 0.67.0 进行交互检查；不依赖演示后端。API 与 CLI 的补充证据见 [集成验证记录](integration-results.md)。

| 操作 | 观察结果 |
| --- | --- |
| 仓库列表进入 `local/visual-search` | 实际目录、文件数量、大小与更新时间显示正常 |
| `data/labels.csv` 预览 | 3 行、6 列及 Oxen 字段类型正确，包含 confidence 0.98、0.94、0.87 |
| 表格行关联 `images/alpine.png` | 旁栏图片完成加载，实际自然宽度 640 px |
| 文本预览 | README 正文按行可读，未把文件内容作为 HTML 执行 |
| PDF 预览 | 初始原生 iframe 在内置浏览器白屏，改为 PDF.js canvas；实际看见标题 `Oxen Visual Search Dataset` 与两行说明，1/1 页，缩放 114%→89% 生效 |
| 历史与 diff | 打开 `2333994e…` 提交，看到 `data/labels.csv` 中 confidence 0.91→0.94 的前后内容 |
| 创建与切换分支 | 真实创建 `ui-validation`，当前分支选择器及列表同步 |
| Workspace | 创建“浏览器功能验收”，暂存 `docs/browser-verification.txt`，变更列表显示 1 个新增文件 |
| Commit | 输入 `Verify browser workspace editing and commit`，生成 `65fed128…`；工作区恢复 0 处变更，历史包含新提交 |
| Push | 任务状态为“已完成”，CLI 输出推送到 `ui-validation`，确认 Everything is up to date |
| 标注 | 针对已加载的真实 commit `a18bcf7f…`、第1行保存 approved 与备注；界面显示“标注已保存到加载时的数据版本” |
| 规则查询 | `confidence 大于 0.9 按confidence降序 前2行` 返回两行，confidence 0.98/0.94；明确显示 `local-rules`、提交版本、读取3/3行及执行说明 |
| 元数据 | 描述与 vision/multimodal/annotated 标签保存成功；访问权限与默认分支保持上游只读 |
| 窄屏 | 390×844 下提交详情可读，主文档宽375≤视口390；功能tab可横向滚动，临时尺寸检查后恢复默认 |
| 运行错误 | PDF 成功渲染与缩放后，浏览器 error 日志为空 |

检查中修复：开发代理 Host 改写造成写入被同源校验拒绝，改为保留 Host；commit diff 的官方规范路径与真实路由不一致，按固定源码修正；标注和查询固定实际 commit 上下文并取消过期响应；PDF 不再依赖浏览器内置阅读器。

最终 `npm run build` 成功（包含 Vue/TypeScript 类型检查、Vite 构建、BFF 编译），`npm test` 13 项通过、真实服务测试默认跳过；真实集成已另行显式执行通过。停止开发服务器后，运行 `npm start` 在 `http://127.0.0.1:3001` 提供构建后的 SPA 与 BFF；浏览器确认仓库列表、真实统计及元数据正常，深层路由 HTTP 200，`/api/status` 返回 live / ready，Oxen `/api/version` 返回 0.67.0。

未宣称验证：SaaS 登录后的冻结交互快照、多用户 SaaS 原生标注任务、通用 AI 查询、上游 ACL 更新。当前规则查询与本地标注/元数据扩展有明确能力说明，详见 [快照与验收边界](product-snapshot.md)。
