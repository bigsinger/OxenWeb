# Oxen Web 0.1.0

Vue 3 + TypeScript 数据集管理工作台，配套 Node.js / Fastify BFF，连接官方 Oxen **0.67.0**。不修改 Oxen server、内核或固定 OpenAPI。本版面向文本、JSONL/CSV 与作为惰性附件保存的 Skill ZIP；图片、音频、视频管理及云训练/部署不在范围内。

**当前行为以 R21 为准：每个项目仅保留最新已发布版本。** 发布整份已提交数据集，自动比较替换前版本生成可编辑 Release Notes，交付一个 ZIP 和 manifest。新版发布会删除旧发布记录、文件及分享链接；项目提交历史、私人编辑草稿与当前格式的待发布候选保持独立。全局发布模板、项目视图管理和分层发布已移除。

- 使用者：[使用说明](docs/user-guide.md)
- 开发者：[安装与开发](docs/getting-started.md)
- 管理员：[运维、备份与恢复](docs/operations-runbook.md)
- 当前实现与实测：[R21 记录](docs/implementation-r21.md)、[验证摘要](docs/evidence/r21/verification.json)
- 变更历史：[CHANGELOG](CHANGELOG.md)，各轮实施文档是当时事实，不覆盖当前规则。

首次交付 tag 为 `v0.1.0`；后续改造在 `main`，应用版本仍为0.1.0。来源与授权边界见 [NOTICE](NOTICE.md)，项目尚未指定对外开源许可证。

## 克隆与构建

需要 Node.js **22.16.0+**、npm **10+** 和 Git。源码不包含真实样本、凭据、本地服务数据或编译产物。

```powershell
git clone --branch main https://github.com/bigsinger/OxenWeb.git oxen-web
cd oxen-web
npm ci
npm run generate:api
npm run build
npm test
```

Windows x64 已验证 WSL2 / Ubuntu-24.04 运行官方 server、Windows 运行 CLI 的方式。Linux 安装脚本及 GitHub Actions 单独记录实际结果；macOS 使用外部受保护的 Oxen 服务，未声明安装脚本支持。完整环境边界见[入门文档](docs/getting-started.md)。

## 本机启动

```powershell
npm run oxen:install
npm run oxen:start
npm run oxen:seed
npm start
```

生产页面由 BFF 在 <http://127.0.0.1:3001> 提供，上游默认为 `127.0.0.1:3002`。`oxen:seed` 创建合成测试项目，将本机配置写入被忽略的 `infra/oxen/local.env`；不需要真实样本。需要开发热更新时运行 `npm run dev`，前端地址为 <http://127.0.0.1:5173>。

服务运行时不要直接覆盖 `apps/*/dist`。先排空写入并停止 BFF，再更新构建和重启。`oxen:stop` 只停止本项目受管上游，不删除数据。旧控制目录升级前核对[源访问保护初始化](docs/operations-runbook.md)和备份；不要在未知旧权限状态下初始化为空。

## 已有工作流

| 工作 | 入口与行为 |
| --- | --- |
| 项目管理 | 项目卡片显示样本数、大小和 main 项目标签，按最近修改排序；概览展示可编辑 README |
| 数据维护 | 选择分支自动打开条目；按类型行内编辑、复制、删除、批量修改，私有保存后统一提交 |
| 表格布局 | 显示名称和字段 ID、拖动列顺序与分隔条、保存个人布局；只点击序号打开属性抽屉 |
| 字段与标签 | 全局管理员维护目录，项目选择模板；显示/导出独立控制，单选/多选可配颜色 |
| 协作与版本 | 任务、独立复核、分支、合并请求、文本/结构化 diff；恢复旧数据创建新提交 |
| 当前发布 | 固定提交和比较基线，自动说明、打包校验、确认替换；下载与有期限的链接分享 |
| 内部快照 | 导出已提交的完整工作包，按字段导出配置，仅创建者和获准身份访问，无公开分享 |
| 身份与运营 | 个人令牌、项目角色、管理权限、宏观操作日志、故障对账、受控备份恢复 |

发布包含全部数据行，不按 split、quality、purposes、visibility 等业务字段筛行或分包；“是否导出”控制源字段。业务字段不代替访问控制。正式分享会交付整个发布包，核对接收对象后再分享。历史上受限源访问保护仍由后端执行。

## 配置与边界

参考 `.env.example`。上游、命名空间和 CLI 分别通过 `OXEN_SERVER_URL`、`OXEN_NAMESPACES`、`OXEN_CLI_BIN`、`OXEN_CLI_ROOT` 配置。CLI 只在受管根目录和匹配 origin 的仓库工作。

默认绑定回环。团队部署必须配置高强度所有者令牌、团队模式、明确允许的主机和受保护的网关，不能绕过 BFF 暴露无鉴权上游。前端写入执行同源、角色和版本校验；令牌与会话不进入源码。

规则查询在本机执行；可选模型查询需要已登录的本机 Codex CLI，并逐次明确允许发送字段名、类型和问题，程序不发送记录正文。模型失败不伪装成规则成功。完整扫描有25万行上限；超过上限或分页不完整明确失败。

完整导入/发布 ZIP 上限64 MiB；其他上传和预览限制见[使用说明](docs/user-guide.md)与[入门文档](docs/getting-started.md)。Skill 包始终是不可信数据，不安装、不运行其中脚本，不访问包内引用网址。共享链接需要接收者能够访问的部署地址，本机回环不会自动公开。

显式 `DEMO_MODE=true` 使用独立演示存储并显示演示标识；真实连接失败不会自动切换演示。

## 验证

R21 本机完整回归 **551 项：544 通过、0 失败、7 个外部环境条件跳过**；类型检查和隔离目录构建通过。官方0.67.0合成联调验证连续发布、自动变更说明、旧资产物理删除和权限。浏览器验证桌面及390px窄屏、打包/发布、重复版本保留输入和空筛选。具体结果、限制和可复现命令见[R21](docs/implementation-r21.md)。

合成测试与真实源数据隔离；当前真实四库没有重新划分、自动发布或改写正文。真实样本内容、成员候选及本机运行数据不随源码公开。公开截图仅收录已检查的合成场景，见[证据规则](docs/evidence/README.md)。

UI 开发先查冻结的 [SaaS 知识库](docs/knowledge-base/oxen-saas/README.md)；标注和安全样本工作也查 [AI 安全知识库](docs/knowledge-base/ai-safety/README.md)。复用已有观察，缺口再浏览，不检查编译后的 SaaS 前端，不复制 CSGHub 源码。
