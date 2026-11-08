# Oxen 契约快照与能力边界

本项目固定 2026-11-07 下载的 Oxen repository OpenAPI **0.67.0**。原始规范为 `contracts/oxen_server_openapi.json`；来源、SHA256、文档与服务端源码版本记录于 `contracts/source.json`。官方文档的 [docs.json](https://github.com/Oxen-AI/docs/blob/be5dfa1717e78dd3a390e8be617c408a764cbdec/docs.json) 将 Repository API 指向 [公开 JSON](https://hub.oxen.ai/api/_spec/oxen_server_openapi.json)。JSON 为独立发布产物，不能声称它由所引用的源码 commit 构建。

## 可重现生成

运行 `npm run generate:api`。`packages/contracts/generate.mjs` 先检查原始 SHA256，再写入 normalized 规范、修正日志和 TypeScript 类型。它不从网络拉取新版本，不自动跟随 SaaS 改版。当前记录 **35 项**依据固定源码验证的修正，另统一 operationId；本轮补充 index/meta 三处实际路由，具体证据和变换见 `contracts/normalization.json`。

公开规范含有以下生成元数据缺陷，原文件保持不变：

- 多个控制器重复使用 `get/index/show/create` 等 operationId。生成 overlay 改为确定性的 method + path 唯一 ID，并在 `x-original-operation-id` 保留原值。
- 目录、历史、数据帧与 workspace 列表的部分参数被标为 `in: path`，但 URL 模板无对应占位符。已读取固定源码，确认是 `web::Query<T>` 后，仅对这四个接口改为可选 query。详见 `contracts/normalization.json`。
- workspace 创建注解写为 `PUT .../workspaces/get_or_create`，清空注解写为 `DELETE .../workspaces/clear`；实际注册在 workspace collection，即 `PUT/DELETE .../workspaces`。已依据 [services/workspaces.rs](https://github.com/Oxen-AI/Oxen/blob/0d3045335f93d77171f95f599a3cee3a080622ae/crates/oxen-server/src/services/workspaces.rs) 修正 overlay。前者的错误路径在真实 0.67.0 返回 404，修正后创建成功。
- compare 的 entries、commits、dir tree 和 dir entries 注解将路径段顺序写反。已依据 [services/compare.rs](https://github.com/Oxen-AI/Oxen/blob/0d3045335f93d77171f95f599a3cee3a080622ae/crates/oxen-server/src/services/compare.rs) 修正 overlay，其中 `GET .../compare/entries/{base_head}` 已真实核对返回文件变更。
- `FileContents` 的派生 schema 写为 `{Text:string}` / `{Binary:number[]}`，但 [model/file.rs](https://github.com/Oxen-AI/Oxen/blob/0d3045335f93d77171f95f599a3cee3a080622ae/crates/liboxen/src/model/file.rs) 的自定义 Serde 实际调用 `serialize_str` / `visit_str`，JSON 文本内容应直接传字符串。visitor 没有 `visit_seq`，因此保守将 JSON 契约修正为 string；二进制仍使用 multipart 文件上传。该修正用于新仓库初始 README 创建，原始规范保持不变。

源码证据：[dir.rs](https://github.com/Oxen-AI/Oxen/blob/0d3045335f93d77171f95f599a3cee3a080622ae/crates/oxen-server/src/controllers/dir.rs)、[commits.rs](https://github.com/Oxen-AI/Oxen/blob/0d3045335f93d77171f95f599a3cee3a080622ae/crates/oxen-server/src/controllers/commits.rs)、[data_frames.rs](https://github.com/Oxen-AI/Oxen/blob/0d3045335f93d77171f95f599a3cee3a080622ae/crates/oxen-server/src/controllers/data_frames.rs)、[workspaces.rs](https://github.com/Oxen-AI/Oxen/blob/0d3045335f93d77171f95f599a3cee3a080622ae/crates/oxen-server/src/controllers/workspaces.rs)。后续接口要使用未修正的其他缺陷参数时，需要先核查源码并补充显式 overlay。

## 页面与公开接口映射

下表的 `R` 为 `/api/repos/{namespace}/{repo_name}`。所有参数、请求体与响应字段最终由生成类型约束；以下仅列实现所需摘要。

| 功能 | 方法与路径 | 请求/响应要点 |
| --- | --- | --- |
| namespace 列表 | `GET /api/namespaces` | 服务端 namespace，不能等同 SaaS 组织权限模型 |
| 仓库列表 | `GET /api/repos/{namespace}` | `repositories[]` 仅有 namespace、name、可选 min_version；没有通用 `GET /api/repos` |
| 仓库详情 | `GET R` | `repository` 含 is_empty、size、data_types、可选 default_resource；列表需详情补充统计 |
| 创建仓库 | `POST /api/repos` | `RepoNew` 必填 namespace、name；description/is_public 是可选创建字段 |
| 文件树 | `GET R/dir/{resource}` | resource=`main/data/train`，query page/page_size/depth/sort_by/reverse；响应 `entries[]`，不是嵌套 data.entries |
| 原始内容 | `GET R/file/{resource}` | 返回二进制；可用于文本、图片、PDF。width/height/thumbnail 为 query |
| 文件元数据 | `GET R/metadata/{resource}` | 含 data_type、mime_type、size 等，避免按扩展名盲推所有内容 |
| 表格预览 | `GET R/data_frames/{resource}` | `data_frame.view.schema.fields`、`data_frame.view.data`、`data_frame.view.pagination`；支持 query filter/sql/columns/page/page_size 等 |
| 提交历史 | `GET R/commits/history/{resource}` | resource 为分支/commit 或含文件路径；query page/page_size；revision history 有 totals，path history 仅 has_more |
| 提交详情 | `GET R/commits/{commit_id}` | `commit` 含 parent_ids、author、email、timestamp、message |
| diff 清单 | `GET R/compare/entries/{base_head}` | base_head=`base..head` 或 `base...head`；`compare.entries[]` 和 counts；原规范路径顺序有误，overlay 已修正 |
| 单文件 diff | 原规范注解路径与实际注册也存在差异 | 实际 `GET R/compare/file/{base_head_resource}`，资源编码为 `base..head/path`；当前 BFF 使用 diff entries 与前后原始内容，未依赖此未归一化路径 |
| 分支列表 | `GET R/branches` | `branches[]` 含 name、commit_id、可选完整 commit |
| 创建分支 | `POST R/branches` | `{new_name, from_name}`；本机 0.67 实测来源分支名可用，commit 哈希作为 from_name 返回 404，不能照注解假定可用；固定基线需创建前后核对 head；同名可能返回已有分支 |
| workspace 列表 | `GET R/workspaces` | query name 可选；`workspaces[]` 含 id、name、commit、created_at，没有通用 branch_name |
| 创建 workspace | `PUT R/workspaces` | `{workspace_id, branch_name, name?, resource_path?}`；workspace_id 必填，原规范路径有误，已 source-backed overlay 修正 |
| workspace 详情/删除 | `GET/DELETE R/workspaces/{workspace_id}` | 不假定删除会删除远程分支 |
| workspace 文件上传 | `POST R/workspaces/{workspace_id}/files/{path}` | multipart 文件暂存，供写入及标注 sidecar 使用 |
| workspace 删除文件暂存 | `DELETE R/workspaces/{workspace_id}/files` | JSON 字符串路径数组；206 表示部分失败 |
| workspace changes | `GET R/workspaces/{workspace_id}/changes` | 暂存变更清单 |
| workspace commit | `POST R/workspaces/{workspace_id}/merge/{branch}` | `{message,author,email}`，409 表示并发冲突；也可用 CLI |
| 合并检查/执行 | `GET/POST R/merge/{base_head}` | POST `{name,email}` 将 head 合并入 base；冲突返回409。与普通 push 内部 merge 端点语义不同，已实测成功 |

`resource` 为包含 revision 与相对路径的通配资源。BFF 必须拒绝路径穿越，分别编码路径段，保留目录层级，不能把整串中的 `/` 当普通字符处理。分支名称中包含 `/` 时，需确保 revision 解析正确；选择 commit_id 可以消除 revision/path 的歧义。

2026-11-08 的真实 0.67 验收补充：openapi-fetch 0.15 默认将 wildcard 路径整体编码，会在 workspace 中创建字面的 `.oxenweb%2Fdataset...` 目录。适配器现在仅针对已知 wildcard 路由逐段编码，不全局 URL decode。新建多层审核证明目录还观察到分歧分支目录/compare 子项串值；本地审核扩展采用共同初始化的 `.oxenweb` 根与平铺证明文件，保持实际证明/哈希校验，不改官方内核。Windows CLI 同时实测长路径约束，内部标注文件改用单一完整 SHA-256 名称并保留旧路径审计。完整失败证据、修复边界及最终真实 MR/CLI/发布/ZIP 再导入通过结果见 [R2 官方服务验收](r2-live-acceptance-2026-11-08.md)。

## CLI 写操作

固定源码中的参数如下。BFF 通过 argv 数组与 `shell: false` 调用；不得把用户输入拼接成 shell 命令。工作目录必须来自服务端仓库映射，且每个本地 checkout 的 checkout/commit/push/merge 操作需要串行化。

| 意图 | 调用 |
| --- | --- |
| 暂存指定文件 | `oxen add <path>` |
| 本地 commit | `oxen commit -m <message>` |
| push | `oxen push origin <branch>` |
| 获取远端分支 | `oxen fetch --branch <branch>`；fetch 没有 REMOTE 位置参数 |
| 合并到当前本地分支 | `oxen merge <source-branch>` |
| 放弃冲突合并 | `oxen merge --abort` |
| 创建远程 workspace | `oxen workspace create --branch <branch> --name <name>` |
| workspace 上传 | `oxen workspace add <path> --workspace-id <id> --directory <directory>` |
| workspace commit | `oxen workspace commit --workspace-id <id> --branch <branch> -m <message>` |
| 删除 workspace | `oxen workspace delete --workspace-id <id>` |

证据：[commit](https://github.com/Oxen-AI/Oxen/blob/0d3045335f93d77171f95f599a3cee3a080622ae/crates/oxen-cli/src/cmd/commit.rs)、[push](https://github.com/Oxen-AI/Oxen/blob/0d3045335f93d77171f95f599a3cee3a080622ae/crates/oxen-cli/src/cmd/push.rs)、[merge](https://github.com/Oxen-AI/Oxen/blob/0d3045335f93d77171f95f599a3cee3a080622ae/crates/oxen-cli/src/cmd/merge.rs)、[workspace commands](https://github.com/Oxen-AI/Oxen/tree/0d3045335f93d77171f95f599a3cee3a080622ae/crates/oxen-cli/src/cmd/workspace)。

workspace commit 直接落到远程分支，无需另做 push（[官方文档](https://github.com/Oxen-AI/docs/blob/be5dfa1717e78dd3a390e8be617c408a764cbdec/getting-started/command-line/workspaces.mdx)）。普通 `oxen merge` 不支持 remote-mode checkout。`branches/{branch_name}/merge` 用于 push 过程中 client/server commit 协调；冲突也可能以 200 返回原 server commit，不能按 200 一概提示分支合并成功。

本地集成实测：普通本地 checkout 可以通过 `workspace commit --workspace-id ... --branch ... -m ...` 提交 HTTP 创建的远端 workspace；root 文件暂存上传的 `files/` 空路径尾斜杠有效；`GET R/file/{workspace_id}/file.txt` 可读暂存文件。`POST R/merge/main..integration-check` 已成功更新 main，并通过原始文件读取验证合并内容。

WSL/DrvFS 上的 Oxen 0.67.0 server archive 将部分 RocksDB 小文件编码为 GNU sparse 条目（tar type `S`），而 0.67.0 CLI 的安全解包仅接受常规文件和目录，导致新 commit fetch 失败。已将本地 server SYNC_DIR 安全复制到 WSL 原生 ext4，并保留项目原件，Windows CLI 全链恢复；详见 `infra/oxen/README.md`。若其他部署遇到类似 fetch 错误，且尚未发生写入，可回退到已验证的 merge API。不得在 merge 或 push 后失败时重复执行另一条写入路径。

`oxen fetch --branch name` 会更新已有本地 branch head，且不更新工作树；不能无条件用于 push 前同步。固定源码的 `fetch_all`（CLI 无参数 `oxen fetch`）只为缺失分支创建 head，对已有分支保留 head 并下载对象；已有分支应通过 checkout/pull 正常合并，避免覆盖未推送提交。`status` 和 `branch` 没有 JSON/porcelain 输出选项，使用它们时需要固定版本并显式识别输出。

## 尚不能从公开契约推出的 SaaS 能力

1. **自然语言查询**：repository OpenAPI 提供 SQL/filter 查询数据帧，没有自然语言转查询或对话 endpoint。不得猜测 `/query`、`/chat` 等 SaaS 接口。本项目若实现本地查询解释器，需明确是自研 BFF 能力及其支持语法；若接语言模型，需另有 provider 契约和凭据。
2. **在线标注**：[官方标注文档](https://github.com/Oxen-AI/docs/blob/be5dfa1717e78dd3a390e8be617c408a764cbdec/features/labeling_data.mdx) 描述行/列/单元格编辑、保存、commit 的流程，但当前下载的 OpenAPI 没有专用标注任务或数据帧行写入接口。可通过受契约支持的 workspace 文件上传实现独立 sidecar 标注；这不等于复现 SaaS 全部表格编辑能力。
3. **元数据设置**：规范没有通用 `PATCH R` 更新 description/visibility。`PATCH R/rename` 请求 `{repo_name}`，仅支持由 auth provider 分配 repository UUID 的部署。独立 BFF 应用元数据必须标明存储边界，不能声称已写入 Oxen 原生仓库 metadata。
4. **鉴权/权限**：公开规范没有 SaaS 登录、组织成员管理和角色配置接口。独立 BFF 鉴权与上游服务 token 分开管理。
5. **产品快照**：公开文档和源码可确认功能语义，不能代替登录 SaaS 后逐页记录当前布局、空/错/加载状态及关键路径。需要实际账号补齐 UI 快照验收。

这些限制应作为同一版本的联调与验收条件记录，不以“未来阶段”替代用户要求的一次交付。
