# Oxen Web 0.1.0

独立实现的 Vue 3 + TypeScript 数据版本管理工作台，配套 Node.js / Fastify BFF。本版聚焦文本与 JSONL、AI 安全标注模板、Skill ZIP 包及原方案的数据管理与协作；图片、音频、视频样本管理不纳入本版验收。仓库与文件、提交与结构化 diff、分支/MR、workspace、commit/push、JSONL 行列编辑、三级标签、查询、版本化设置和协作权限集成在同一版本中。

首次整合源码版本为 **0.1.0**。完整安装步骤见[入门文档](docs/getting-started.md)，功能变更见[CHANGELOG](CHANGELOG.md)，来源、第三方依赖与当前授权状态见[NOTICE](NOTICE.md)。当前未指定工程对外开源许可证；公开源码不改变第三方许可。

## 本机启动

需要 Node.js **22.16.0+**、npm **10+**及Git。Windows x64使用WSL2 / Ubuntu-24.04运行官方Oxen **0.67.0** server，CLI在Windows运行；这是本项目已验证的本机服务路径。Linux x64脚本路径未列为独立实测环境，macOS连接外部上游服务，不运行本项目二进制安装脚本。详见[环境边界与克隆步骤](docs/getting-started.md)。

```powershell
npm ci
npm run generate:api
npm run build
npm test
npm run oxen:install
npm run oxen:start
npm run oxen:seed
npm start
```

生产构建页面由BFF在 <http://127.0.0.1:3001> 提供，本地Oxen默认监听`127.0.0.1:3002`。需要Vite开发页面时改用`npm run dev`，地址为 <http://127.0.0.1:5173>。`oxen:seed`仅创建程序生成的本机测试库并写入`infra/oxen/local.env`，不依赖真实样本；该文件在BFF启动时自动加载，根`.env`可覆盖，已有环境变量优先。两份env文件只在本机保存，不纳入源码。

`npm run oxen:status`检查服务，`npm run oxen:stop`只停止本项目受管服务并保留数据；安装时不能覆盖正在运行的二进制。更新Web前先结束旧BFF，构建后重新`npm start`并刷新页面，使用同一批静态资源。具体运行与验收以实际记录为准，不将默认地址或源码版本号当作外部托管已发布。详细服务目录和WSL存储规则见[infra/oxen](infra/oxen/README.md)。

2026-11-08 已按登录后 SaaS 快照统一改为深色工作空间、顶部项目切换与资源导航、密集文件/表格和协作面板。后续 UI 开发先查[产品与 UI 知识库](docs/knowledge-base/oxen-saas/README.md)，复用页面目录、设计规则、交互记录和截图；缺口再定向补充。改版内容与浏览器核对见[本轮界面验证](docs/ui-redesign-2026-11-08.md)。

既有本地验收已将四个源 ZIP 导入四个私有项目，共 **6,719 条**，统一入口 `data/samples.jsonl`。Skill 为 **1,000 个独立 ZIP + 1,000 行清单**，保留原包、原始真值、来源与哈希；网页只读查看包清单和文本。这些真实数据不随源码交付，新clone无需取得它们即可构建和运行合成测试。六套预制标注模板支持按维度选择、一次提交应用及后续自定义，三级标注支持固定版本快照导出。详见[模板设计](docs/ai-safety-annotation-design.md)、[导入记录](docs/benchmark-import-2026-11-08.md)、[模板真实服务验证](docs/benchmark-template-validation-2026-11-08.md)及[完整性审计](docs/completion-audit-2026-11-08.md)。

R1/R2 改造采用“项目 / 公开项目 / 标签管理”全局导航，以及“概览 / 数据编辑 / 任务与复核 / 版本与合并 / Releases / 设置”项目导航。README 作为概览，选择分支后自动打开完整逻辑数据集，日常操作不再选 `data/` 文件。组织维护者管理标签维度与不可变模板版本，标注者在数据编辑中消费模板、编辑样本和打标；任务按稳定身份分配个人分支，另一人复核后合并，支持独立双标仲裁。卡片与列表在总大小之前显示默认分支的真实样本数。详见[整合方案](docs/proposals/dataset-labeling-workflow-v2.md)与[实施和验收记录](docs/implementation-r2.md)。

R5已将项目标签统一为main的一份分类：卡片、顶部及概览保持一致，明确“编辑标签”并独立保存；aisec关键词与模板维度区分展示。数据编辑支持行内按类型修改、复制新身份、紧凑ID/数字列及删除后的正确全选；样本修改先保存私有草稿，再核对并一次提交，项目标签保存不会提交这些草稿。项目标签基线和当轮验收见[R5记录](docs/implementation-r5.md)。

R7继续完善日常编辑：字段表单和无效JSON输入可自动保留并恢复，处理样本草稿后继续配置；多窗口检查点使用双CAS防止覆盖。数据表使用完整可用宽度，详情通过覆盖抽屉查看，字段支持自动/固定像素/权重列宽。提交和表格差异显示真实行级与行内变化，JSON可查看结构化或原始文本。详见[R7实施与验收](docs/implementation-r7.md)。

## 0.1.0 本轮R8范围

- 项目显示名称和简介可维护，稳定`namespace/name`路径不变；管理员分步确认完整标识后移除项目，可从回收入口恢复，不永久删除上游仓库。
- 项目概览维护README，支持编辑、本机保留输入及历史diff；设置中提供结构化项目标签入口。
- 样本字段可按最多200条随机样本的p85估算列宽，只填入配置供检查，不自动提交。
- 空项目可手动添加条目或导入JSONL/CSV/ZIP，已有数据集可追加导入；数据编辑表头先对完整筛选结果排序，再分页。
- 发布源码排除真实运行数据、原始SaaS captures及历史截图，仅保留已确认合成的R7/R8证据。历史文档中部分原始附件链接仅在本机档案可见。

这些是本版本的实现范围，最终测试、提交与部署凭实际回执登记，不把功能清单当作验收通过。R1–R7历史事实继续保留。GitHub开源候选的许可、维护状态、开源/付费能力边界与取舍见[中文对照](docs/research/open-source-alternatives-2026-11-08.md)：没有一款已核实完整等价，当前继续采用Oxen底座与独立Web/BFF。

## 结构

```text
apps/web/             Vue Router、Pinia、Vue Query、Tailwind、独立组件与视图
apps/server/          BFF、生成类型的上游客户端、受管 CLI、版本化标签/设置、权限与查询
packages/shared/      UI view model 与应用内部协议
packages/contracts/   OpenAPI 生成脚本、类型、可追踪修正记录
contracts/            官方原始 OpenAPI、来源版本与哈希
scripts/oxen.mjs      官方本地服务的安装、启动、停止、初始化、检查
infra/oxen/           固定版本与部署说明；二进制与运行数据均忽略
docs/                 架构、参考索引、快照与验收边界
```

## 契约与功能边界

后端契约固定为官方 `oxen_server_openapi.json` 0.67.0，校验原始 SHA256；代码生成执行 **35 项**有固定源码依据的规范修正，保留原件。运行 `npm run generate:api` 可确定性重新生成。详细来源见[契约参考](docs/contract-reference.md)，工程结构参考见 [CSGHub 索引](docs/csghub-reference.md)，没有复制 CSGHub 源码。

- 仓库、文件、表格、历史、分支、workspace 通过真实 Oxen 服务；复杂写入经受管 CLI 执行。
- 自定义标签维度支持稳定英文 ID、显示名称、释义、单选/多选/文本、选项与弃用。管理位于组织标签管理，项目固定绑定已发布模板版本。正文覆盖、人工赋值和字符片段/步骤写入 `.oxenweb/dataset/` 的版本记录；项目分类在main独立保存，样本意见按操作者和工作分支保存。原始表格及truth受保护，当前不再保留旧标签兼容档案（R4用户明确取消）。内容变化会使对应标注或复核过期，不把源字段审核状态当成人工审核。
- 已将用户提供的真实 **2,000 行 / 14 列 JSONL** 导入 `local/prompt-injection-bench/data/prompt_injection_bench.jsonl`。导入逐行校验 UTF-8/JSON 对象，错误给出物理行号；预览保留嵌套对象、数组、bool 和 null，分页可到末行。当前样本编辑采用稳定 ID 覆盖记录，不重写导入基线；旧编辑接口不能绕过受管数据与任务范围。旧轮验证见 [JSONL 与标签验证](docs/labels-and-jsonl.md)，当前编辑交互以[R7实施记录](docs/implementation-r7.md)为准。
- 描述、tags、默认 Web 分支、公开/私有设置和协作者角色保存为 **`.oxenweb/repository.json`**。BFF 实际执行 viewer/editor/admin 权限、列表隔离、写入拦截和撤销；这些是本应用的控制面，不冒充 Oxen SaaS 账号体系或上游服务器原生 ACL。
- 查询有两种明确选择：Codex 只生成经过校验的只读查询计划，再由本机执行；规则查询全程在本机处理。两者在支持的处理上限内读取完整表格，不再仅取首 500 行。真实样本规则计数已验证扫描 2,000 行并返回 `label=1` 的 1,000 条。
- 模型查询只发送字段名、类型和用户问题，**程序不发送记录正文**。允许外发的复选框默认关闭，未明确勾选时前端禁止提交、后端返回403。用户已明确授权此范围，真实样本模型查询已通过：扫描2000行，匹配label=1的1000条，按attack_family分为15组；记录正文留在本机。模型失败不会自动改成规则结果。
- 合并请求提供固定版本比较、讨论、关闭/重开和真实 CLI 合并；元数据在 BFF 本地持久保存，写入核对角色、请求 revision 与两端 commit，任务中断后需显式恢复，不调用私有 SaaS API。
- 网页支持 ZIP 清单识别、映射预检与一次提交，Skill 始终按样本独立 ZIP 存储；成员比较使用真实 SHA 和受限文本差异。Releases 固定原生 commit，构建完整样本、标签、模板、README、变更摘要、附件及校验值；工作快照与正式发布区分，支持预发布、最新稳定版、撤回和到期/撤销的固定版本分享。单个完整导入/发布 ZIP 上限 64 MiB，超限明确失败，不截断。分享需要可达部署地址，本机回环地址不会被自动公开。
- 用户已将范围锁定为**原方案的数据管理与协作全套**；云生成、微调和部署不纳入。2026-11-08 已完成登录后核心页面核对，保存23组真实证据，并据此补齐结构化diff与合并请求。SaaS非空分支比较自身报错、部分提交摘要报错，以及双方存储/权限/格式边界均明确记录，不声明无例外的100%复刻。详见[登录后快照与对照结果](docs/saas-logged-in-snapshot.md)及[验收矩阵](docs/saas-equivalence.md)。

## 配置

复制 `.env.example` 到 `.env` 可连接其他实例。关键项：`OXEN_SERVER_URL`、`OXEN_NAMESPACES`、`OXEN_CLI_BIN`、`OXEN_CLI_ROOT`、`OXEN_CONFIG_DIR`。CLI 仓库只能位于受管根目录下的 `<namespace>/<repo>`，目录必须包含真实 `.oxen`，符号链接不能越界。缺少 clone 时 BFF 会在受管目录安全初始化，并验证 origin 与目标服务、仓库匹配；CLI 或网络前提不足时明确报错。

默认仅绑定回环。配置 `BFF_TOKEN`（至少 16 字符）可启用浏览器 HttpOnly 会话或 Bearer 鉴权；非回环 BFF 强制要求令牌。`BFF_ALLOWED_HOSTS` 为明确允许的主机名，默认只接受回环主机，阻止 DNS rebinding。Oxen 自托管服务自身不提供鉴权，不应绕过网关暴露。前端所有写操作经过同源与自定义头校验；JSONL 专用导入、原件读取与结构化差异的每个源文件上限为 64 MiB，工作区通用上传为 10 MiB，其他原件代理及原生 diff 响应为 25 MiB。ZIP 只读清单上限25 MiB/5,000条目，单条文本256 KiB；命令和解压读取有超时及输出上限。

模型查询需要本机 Codex CLI 已安装并登录，可用 `OXEN_QUERY_CODEX_BIN` 指定可执行文件；字段结构外发仍受每次请求的显式允许控制。规则查询不需要模型。当前完整扫描上限为 250,000 行；超过上限或上游分页不完整会报错，不返回伪装成全表的采样结果。

显式设置 `DEMO_MODE=true` 可运行独立持久化演示夹具；界面始终标示演示模式，与真实服务数据隔离。未配置真实服务时不会自动降级为演示。

## 验证

```powershell
npm run typecheck
npm test
npm run build
```

常规测试覆盖鉴权/权限/撤销、路径隔离、CLI、workspace、标签治理、稳定样本与多操作者意见、任务与独立复核、固定版本发布/分享、ZIP往返、JSONL/大文件diff、查询与MR。0.1.0/R8全套322项（315通过、0失败、7默认跳过）；官方0.67合成全链路及干净源码安装/构建已验证，见[R8实施与验收](docs/implementation-r8.md)。

历史R7完整构建通过，306项回归（299通过、0失败、7默认跳过），并曾重启3001该轮最终构建完成页面烟测；输入恢复、慢等待保护、列宽、真实文本diff、原生0.67联调及浏览器证据见[R7实施与验收](docs/implementation-r7.md)。R6类型字段与修改状态的历史验收见[R6记录](docs/implementation-r6.md)，R5项目标签与草稿恢复见[R5记录](docs/implementation-r5.md)。R3当时190项回归、原生草稿联调、真实四库模板采用和测试库清理见[R3记录](docs/implementation-r3.md)。[R1/R2记录](docs/implementation-r2.md)作为历史保留。真实四库导入证据见[导入记录](docs/benchmark-import-2026-11-08.md)和[真实模板验证](docs/benchmark-template-validation-2026-11-08.md)。

2026-11-08 R4：修复同页选择条目重载整表的问题；字段详情显示ID、可用中文名、类型与帮助。按用户要求取消旧标签兼容记录，四真实项目关键词改为aisec，源样本不变。最终198项回归（191通过、0失败、7默认跳过）及浏览器请求计数、生产部署见[R4实施与验收](docs/implementation-r4.md)。

2026-11-08 R6：项目设置新增样本字段类型与有限选项；表格按配置编辑，草稿红色、成功提交本轮绿色，重载清除绿色。卡片所有标签可筛选，维度版本操作移入高级项；发布快照仍保留。当轮265项回归（258通过、0失败、7默认跳过）及证据保留于[R6记录](docs/implementation-r6.md)，设计来源见[官方实践参考](docs/research/typed-field-editing-2026-11-08.md)。

2026-11-08 R7：独立本机界面检查点不产生commit/workspace；列宽只影响展示，纯宽度更新可先保存。恢复前核对字段基线，真实字段或样本提交继续执行权限、规范和任务校验。设计来源与采用边界见[持久编辑与差异参考](docs/research/durable-editor-and-diff-2026-11-08.md)，最终证据以[R7记录](docs/implementation-r7.md)为准。
