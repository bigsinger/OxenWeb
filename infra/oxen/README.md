# 本地 Oxen 服务

项目目录内固定安装官方 **Oxen v0.67.0**，与 `contracts/oxen_server_openapi.json` 的版本一致。Windows CLI 在 Windows 进程中运行；官方不支持 Windows server，因此服务端在本机 **WSL2 / Ubuntu-24.04** 中运行。未安装 Docker，未修改全局 PATH 或 Oxen 用户配置。服务代码、二进制、配置及本地 checkout 在项目目录；server 活跃数据使用 WSL 用户目录下的原生 ext4 存储，原因见下文。

## 命令

在项目根目录运行（等价于根 npm 的 `oxen:*` scripts）：

```text
node scripts/oxen.mjs install
node scripts/oxen.mjs start
node scripts/oxen.mjs seed
node scripts/oxen.mjs status
node scripts/oxen.mjs stop
```

`install` 将官方 release 下载到 `downloads/`，核对 `release.json` 固定 SHA256，解压到 `bin/`，核对 CLI/server 版本。不能在服务运行时覆盖二进制。Linux x86_64 环境可直接运行服务，但其 CLI 包的首次下载 hash 记录于本地 installed.json；本次实际联调与固定校验对象为 Windows CLI + WSL server。

`start` 在后台隐藏启动服务，默认仅监听 `127.0.0.1:3002`；Windows 通过 WSL localhost forwarding 访问。`OXEN_LOCAL_PORT` 可改端口，`OXEN_WSL_DISTRIBUTION` 可改 WSL 发行版。只有健康检查通过才报告 ready，PID、SYNC_DIR 与启动信息写 `run/server.json`。不会接管占用同端口的非受管服务。`stop` 读取 PID，并确认 `/proc/<pid>/exe` 指向本项目 server 后才发送 SIGTERM，不会关闭整个 WSL 或其他服务。

首次启动会自动取得 WSL 默认用户的 HOME，将项目原 `data/` **只复制**到 `<WSL-HOME>/.local/share/oxen-web/<project-id>/data`，并将指针记录于 `run/data-location.json`。project-id 为项目绝对路径的稳定 SHA256 前16位；本工作区为 `4ec72b115d9269a1`，活跃路径为 `/home/sing/.local/share/oxen-web/4ec72b115d9269a1/data`。原项目 `data/` 保留、不删除；后续启动直接使用指针，不重新复制或覆盖活跃数据。若原生目录已存在但没有指针，脚本拒绝覆盖，需人工核对后恢复指针。迁移既有运行实例时，先 stop 再 start。

使用原生 ext4 是为了规避 Oxen 0.67.0 的平台兼容问题：WSL 的 `/mnt/f`（DrvFS）使 server tar builder 将部分 RocksDB 小文件写为 GNU sparse 条目，而同版本 CLI 安全解包拒绝此类型，造成 fetch 失败。将数据物化复制到 ext4 后，真实 Windows CLI fetch、pull、merge 和 push 均已恢复。

`seed` 创建并通过真实 CLI commit/push 推送 `local/visual-search`，含文本、CSV、PNG、PDF 和两条提交历史。数据为程序生成的 CC0 样例，不依赖远程媒体。已有 checkout 时不重新创建仓库、不覆盖数据；只刷新本地 BFF 环境配置。

## 目录与连接

| 路径 | 内容 |
| --- | --- |
| `bin/`、`downloads/` | 固定版本二进制与原始压缩包 |
| `data/` | Windows 下保留的迁移前原始副本；Linux 原生运行时为 SYNC_DIR |
| `<WSL-HOME>/.local/share/oxen-web/<project-id>/data` | Windows/WSL 运行时的活跃 SYNC_DIR，仓库数据由 Oxen 自己管理 |
| `repos/local/visual-search/` | Windows CLI checkout，供 BFF 写操作使用 |
| `config/client/` | Windows CLI 用户身份与 auth 配置，通过 OXEN_CONFIG_DIR 隔离 |
| `config/server/` | server 配置隔离目录 |
| `logs/` | 服务 stdout/stderr |
| `run/` | 健康检查、PID、安装信息和活跃数据指针 |
| `local.env` | seed 自动产生的 BFF 环境变量（不含密钥） |

运行数据、日志、配置、二进制和 `local.env` 通过本目录 `.gitignore` 排除；脚本、发行版来源和本说明纳入版本管理。

BFF 启动时加载 `infra/oxen/local.env`，其中关键项为 `DEMO_MODE=false`、`OXEN_SERVER_URL=http://127.0.0.1:3002`、`OXEN_NAMESPACES=local`、`OXEN_CLI_BIN`、`OXEN_CLI_ROOT` 和 `OXEN_CONFIG_DIR`。同一 checkout 的 CLI 写操作由 BFF 队列串行执行。

Oxen server 本身不鉴权（[官方自托管说明](https://github.com/Oxen-AI/Oxen/blob/0d3045335f93d77171f95f599a3cee3a080622ae/SelfHosting.md)），本地实例仅绑定回环地址；浏览器访问经过 BFF。若要让其他机器访问，应由鉴权网关保护上游，并配置 BFF_TOKEN；不要将此本地监听地址改为公网监听。

## 已验证

本次实际运行 `oxen 0.67.0` 与 `oxen-server 0.67.0`，`/api/version` 健康；真实 CLI 初始化、暂存、commit、push、workspace commit、fetch、分支创建/切换、pull、merge、再次 push 成功，最终工作树干净；HTTP repo、目录、表格分页、提交历史、分支及 workspace 列表与经源码修正的契约一致。根目录 workspace 上传、workspace-ID 文件预览和 HTTP 分支 merge 也已实测成功。样例 PNG 为 640×400，PDF 含有效 xref 和单页内容。它们用作集成夹具，不是生产数据。
