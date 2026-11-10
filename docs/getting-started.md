# Oxen Web 0.1.0 入门

本项目是Vue 3 + TypeScript前端与Node.js/Fastify BFF，连接官方Oxen 0.67.0，不修改上游server或内核。本版面向文本/JSONL/CSV数据、AI安全标注和Skill ZIP包；图片、音频、视频样本管理以及模型训练/部署不在范围内。来源与授权状态见[NOTICE](../NOTICE.md)，版本范围见[CHANGELOG](../CHANGELOG.md)。

## 环境与支持边界

| 环境 | 使用方式与验证边界 |
| --- | --- |
| Windows x64 | 已验证的本机路径：Node.js≥22.16.0、npm≥10、Git、WSL2及已初始化的`Ubuntu-24.04`；Windows运行CLI，WSL运行官方Linux server |
| Linux x64 | 安装脚本包含原生Linux CLI/server路径，可使用下述`oxen:*`命令；本项目本轮未声称在独立Linux主机完成安装与浏览器验收 |
| macOS及其他架构 | 不运行本项目的Linux/Windows二进制安装脚本。连接外部、受保护的Oxen 0.67.0服务；复杂写入还需为BFF配置本机可用、版本匹配的官方CLI。该组合未列为本轮实测环境 |

Windows先安装并初始化WSL2的Ubuntu 24.04，确认发行版名为`Ubuntu-24.04`且版本为2。终端检查：

```powershell
node --version
npm --version
git --version
wsl --list --verbose
```

本地安装需要能够下载官方GitHub release。脚本不会修改全局PATH，也不会安装数据集中的任何Skill、依赖或脚本。安装已有同端口服务时，先确认它是本项目受管实例；工具不会接管其他服务。

## 取得源码与构建

源码仓库为 `bigsinger/OxenWeb`；最新改造在 `main`，应用版本仍为0.1.0。`v0.1.0` tag仅代表首次交付，不含之后的改造。当前行为和验收以[R21记录](implementation-r21.md)为准。

```powershell
git clone --branch main https://github.com/bigsinger/OxenWeb.git oxen-web
cd oxen-web
git switch -c codex/development
npm ci
npm run generate:api
npm run build
npm test
```

`npm ci`使用提交的lockfile安装工作区依赖。`generate:api`从固定的官方OpenAPI及有来源的修正记录生成类型；不要手改生成文件来猜测接口。`build`包含前后端类型检查，`npm test`使用合成夹具；默认跳过的live用例不能算作真实服务通过。具体验收结果在[README](../README.md#验证)及对应实施记录中登记。

## Windows本机官方服务

以下命令在项目根目录的PowerShell中执行；Linux x64脚本分支使用同样的npm命令，但不需要WSL。

```powershell
npm run oxen:install
npm run oxen:start
npm run oxen:seed
npm run oxen:status
npm start
```

`install`下载固定的官方0.67.0 CLI/server并核对版本；Windows CLI和Linux server的固定校验值见[release.json](../infra/oxen/release.json)。安装会拒绝覆盖正在运行的受管服务。`start`在后台启动，健康检查通过才报告ready；`status`也会检查版本。`seed`只生成本机测试数据和CLI连接配置，不导入真实样本。已有种子checkout时不覆盖仓库内容。种子包含历史通用文件预览夹具，不代表本版增加媒体样本管理范围。

默认地址：

| 入口 | 地址 |
| --- | --- |
| 生产构建Web与BFF | <http://127.0.0.1:3001> |
| 官方Oxen服务 | `http://127.0.0.1:3002` |
| 可选Vite开发页面 | <http://127.0.0.1:5173>，需另运行`npm run dev` |

`seed`生成的`infra/oxen/local.env`会在BFF启动时自动加载。需要修改配置时，将[.env.example](../.env.example)复制为项目根`.env`后编辑；已有进程环境变量优先，其次根`.env`，再使用自动生成的本地配置。两个env文件均只在本机使用，不提交源码或放入截图。

R21：首次使用团队权限前，管理员须在可信维护入口显式初始化`source-access-markers.json`。Live缺少此文件时，所有项目源数据保守按受限主库处理；不要用删除文件或盲写空列表来解除已有保护。新安装核对为空环境后可初始化空列表，已有实例须先保留原受限项目。Demo只对合成控制目录初始化。具体步骤见[运行手册](operations-runbook.md)及[源保护与当前恢复边界](r21-source-protection-and-recovery.md)。

停止BFF后先执行`npx tsx scripts/ops-source-access-init.ts`查看只读计划。确认新空环境后，使用`npx tsx scripts/ops-source-access-init.ts --execute --initialize-empty`；已有保护用`--execute --retain namespace/repository`，可重复`--retain`。活动BFF租约存在时工具拒绝执行。保护文件遗失应恢复同代备份，不能直接初始化空策略。

Windows的server活跃数据放在WSL原生ext4下的`<WSL-HOME>/.local/share/oxen-web/<project-id>/data`，指针保存在受忽略的`infra/oxen/run/`。不要随意移动checkout、手改指针或用Windows挂载盘上的旧副本覆盖它。路径由脚本计算，不依赖原开发机器用户名或盘符。详细的迁移、备份与平台限制见[本地服务说明](../infra/oxen/README.md)。

停止官方服务使用：

```powershell
npm run oxen:stop
```

这只停止经PID/可执行文件核对的受管实例，不关闭整个WSL，不删除仓库。BFF前台进程使用Ctrl+C停止。升级Web时先结束旧BFF，重新构建并`npm start`，然后刷新浏览器，使页面与静态资源来自同一次构建。

## 连接外部上游

在根`.env`中设置服务地址、命名空间和本机CLI配置：`OXEN_SERVER_URL`、`OXEN_NAMESPACES`、`OXEN_CLI_BIN`、`OXEN_CLI_ROOT`、`OXEN_CONFIG_DIR`。地址只填服务URL，不内嵌用户名、密码或token。外部服务与CLI应匹配固定0.67.0契约；当前实现不跟随后续SaaS改版或上游main自动升级。

先构建，再`npm start`。HTTP浏览与CLI写入是两项不同前提：只配置HTTP地址不能据此认定commit/push/merge均可用。CLI checkout必须位于受管根目录，origin须与目标仓库匹配；前提不足会明确报错。macOS走此连接方式，不使用本项目的`oxen:install/start/seed`安装路径。

默认仅绑定回环。供其他机器访问时需配置至少16字符的`BFF_TOKEN`、正确的`BFF_ALLOWED_HOSTS`及受保护的上游网关；不要直接暴露不带鉴权的官方本机server。凭据只放本机环境配置，不写入README、命令截图或研究档案。

## 建立第一份文本数据集

登录适用身份后，在项目面板新建项目：空项目可手动添加条目，或导入JSONL、CSV及符合导入规范的ZIP；已有数据集可通过追加导入加入样本。导入前查看映射、唯一身份和预检结果，不把source truth自动转成人工标注。可先用本地合成内容：

```jsonl
{"id":"demo-1","title":"合成样本一","text":"仅用于界面验证","score":1}
{"id":"demo-2","title":"合成样本二","text":"不含真实敏感内容","score":2}
```

日常路径是：项目概览维护README → 选择工作分支 → 数据编辑中编辑与打标 → 保留本机输入/保存私有草稿 → 核对差异 → 一次提交。表头排序对当前筛选后的完整结果进行，再分页。任务和复核按稳定条目身份、真实提交及权限执行；最后由Releases构建固定版本包。

管理员或指定人员在全局标签管理维护领域、维度、选项和已发布模板；标注者只消费采用的规范。项目结构化标签可在设置维护，统一取main分类；样本意见继续按工作分支隔离。字段类型、名称、帮助及列宽在设置的样本字段维护。自动估算列宽最多随机采样200条，取p85并考虑表头，仅填入可检查的配置表单，不自动提交。

显示名称和简介可修改，稳定的`namespace/name`仓库标识和路径不变。项目移除由管理员分步确认完整标识，属于可恢复的本应用回收状态；从回收入口恢复，不永久删除上游仓库文件。回收记录、权限与本机草稿属于BFF本地运行状态，应与Oxen数据一起备份。

## 源码与本地档案

源码不包含真实样本、源ZIP、运行数据库、CLI二进制、登录会话、`.env`或`infra/oxen/local.env`。历史SaaS原始captures和旧截图只在本机留存；仅已确认合成的R7/R8证据进入交付白名单。旧实施文档中的部分附件链接因此只在原本机研究档案可见，不把未公开附件当作新clone已具备的验收材料。

后续开发先查[冻结SaaS知识库](knowledge-base/oxen-saas/README.md)和[AI安全知识库](knowledge-base/ai-safety/README.md)。Skill ZIP始终作为不可信样本数据只读查看，不安装、执行或自动展开嵌套包。本版没有承诺任意云端功能完整复刻；开源替代方案与已核实的能力边界见[中文对照](research/open-source-alternatives-2026-11-08.md)。
