# 集成验证记录

验证日期：2026-11-07（Asia/Shanghai）。本记录区分真实 Oxen 服务、Oxen Web 自研扩展与隔离演示数据。所有功能属于同一个交付版本。

## 真实服务

- Oxen Server / Windows CLI：官方 **0.67.0**，来源、下载校验与运行方法见 `infra/oxen/README.md`、`infra/oxen/release.json`。
- 服务地址：`http://127.0.0.1:3002`；受管 CLI clone：`infra/oxen/repos/local/visual-search`。
- 服务数据使用 WSL 原生 ext4 存储；原项目下 DrvFS 数据副本保留。原因：DrvFS 的 RocksDB 小文件被 Rust tar 编码为 GNU sparse，0.67 Windows CLI 安全解包拒绝此类条目。
- API 原件与源码依据：`contracts/source.json`；对官方注解与实际路由差异的确定性修正：`contracts/normalization.json`。没有凭空添加上游接口。

## 自动检查

执行 `npx tsc --noEmit -p apps/server/tsconfig.json` 成功。

`apps/server/test/server.test.ts` 的 9 项测试全部通过，覆盖：

- 演示 workspace 暂存、提交、快照 diff 与服务重启后的持久化。
- 三路合并的真实冲突识别与目标分支保留。
- BFF token、httpOnly session、CSRF 和跨来源写入拦截。
- 文件路径穿越、Oxen/Git 内部路径与受管 clone 边界。
- CLI `shell:false`、字面参数传递、超时、输出上限。
- 每仓库写任务串行以及不同仓库并行。
- 元数据与按 commit ID 隔离的标注持久化。
- CSV 引号、逗号、转义及换行。
- 未配置时明确报错，绝不自动降级为演示成功。

自然语言规则引擎的独立测试由根代理维护，见 `apps/server/test/natural-query.test.ts`。

## 真实端到端联调

命令（PowerShell）：

```powershell
$env:OXEN_LIVE_TEST = 'true'
npx tsx --test apps/server/test/live-integration.test.ts
Remove-Item Env:OXEN_LIVE_TEST
```

最终真实联调 **1/1 通过**（耗时约 13.2 秒），使用 Fastify `inject` 请求真实 BFF 逻辑，BFF 实际连接本地 Oxen Server，并执行真实 Windows Oxen CLI。测试使用隔离的临时受管 clone，结束后清理其自身临时目录。

| 检查 | 证据 |
| --- | --- |
| 仓库列表/详情 | `local/visual-search` 真实大小、文件数量和更新时间；ACL 信息为 `unknown`，没有伪造私有权限 |
| 文件树 | 读取真实目录以及 `data` 子目录 |
| 文本 | `README.md` 返回文本内容 |
| 表格 | `data/labels.csv` 返回 3 行真实数据及字段类型 |
| 图片 | `images/alpine.png` 返回 image 预览 |
| PDF | `docs/dataset-card.pdf` 返回 PDF 预览，raw 响应 `%PDF` 文件头校验通过 |
| 提交/diff | 读取历史分页、提交详情与实际修改文件 |
| 分支 | 创建 `bff-check-1794064353944-source` 与 `bff-check-1794064353944-target` |
| Workspace | 创建、编辑 `notes/bff-check-1794064353944.txt`、读取暂存内容、multipart 上传根目录文件 |
| CLI commit | 真实 `workspace commit --workspace-id … --branch … -m …` 生成 `3eac56df0aed61b59d185b642a83ef9b` |
| CLI merge | plain `fetch`、checkout/pull source、checkout/pull target、merge、push target 成功；目标分支文件可读 |
| CLI push | 推送 source 成功，CLI 返回 Everything is up to date |
| 查询 | 对真实表格执行 `confidence > 0.9`，返回 `engine=local-rules` 的解释型结果 |
| 标注 | 对 main 的真实 commit ID + 文件 + 行 ID 保存标注，重启 BFF 后仍可读 |
| 元数据 | description/tags 写入本地扩展 JSON，重启 BFF 后仍可读 |
| 新建仓库与首次写入 | 创建带 README 的全新 `local/bff-provision-*` 仓库；在全新受管根下，首次 workspace commit 自动 clone 成功；真实内容可读；随后 CLI push job succeeded |
| 错误 origin 拦截 | 对真实 clone 使用不匹配的预期上游地址，`assertRemote` 返回 REMOTE_MISMATCH，未执行写入 |

额外修复了一处由真实创建用例揭示的官方规范差异：`FileContents` 的 Rust 自定义 Serde 将文本编码为普通 JSON 字符串，官方原件却标注为 `{Text: string}`。normalized 合同现根据固定源码修正，创建接口已使用真实支持的字符串载荷。

这些联调分支保留在本地样例服务中，便于复核，不影响远端公共服务或用户既有仓库。

## 产品与运行边界

- 标注与 description/tags 是 **Oxen Web BFF 自研扩展**，保存于 `.data/live-extensions.json`；它们不是 Oxen SaaS 原生任务接口，也不会自动写入上游版本历史。标注按实际 commit ID 隔离。
- 自然语言入口使用受限的中英文解释规则，支持的条件、排序、数量限制以及采样范围会随结果说明；它不是 SaaS AI 服务。查询最多读取所选表格前 500 行。
- 公开 API 未提供通用 visibility/defaultBranch 更新；live 设置明确禁用对应修改。自托管 Oxen Server 自身没有此 BFF 的 session gate，服务绑定 loopback。
- CLI 写入验证 clone 的 origin 与当前上游/namespace/repo 一致；不匹配立即拒绝。写入前要求受管工作树清洁，避免覆盖未暂存修改。新仓库缺少 clone 时，在受管目录中自动 provision。
- plain `fetch` 会保留现有本地 branch head；禁止使用会覆盖 head 的 `fetch --branch`。CLI merge/push 后发生失败不会自动重做写入；只有前置只读 clone/fetch 的已知兼容性故障才允许切换到已核对的 HTTP merge 接口。
- SaaS 账号交互快照尚未由当前环境取得，不能宣称逐像素或完整 SaaS 产品语义验收已经完成。浏览器交互验收由根代理补充。
