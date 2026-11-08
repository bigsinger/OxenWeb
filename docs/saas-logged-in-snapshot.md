# 登录后 SaaS 功能快照与对照结果

核对日期：2026-11-08，Asia/Shanghai。范围为原方案的数据管理与协作，以及用户明确要求的 JSONL、自定义标签列和数据集/文件/条目三级标签；云生成、微调、部署及计费不纳入。

## 会话、数据与证据

已经实际登录并核对 `https://www.oxen.ai/bigsinger`，角色为项目所有者。应用内浏览器能可靠确认 URL，原先的 Chrome 控制阻碍已解除；不能再沿用“登录后页面尚未访问”的结论。

专用私有项目：[bigsinger/oxen-web-acceptance-20261108](https://www.oxen.ai/bigsinger/oxen-web-acceptance-20261108)。仅使用 5 份合成文件：sample.jsonl、sample.csv、alpine.png、dataset-card.pdf、notes.txt，合计 4,109 bytes。用户明确批准后，浏览器上传审批仍拒绝自动选择文件，因此由用户亲自完成上传和提交，随后已从页面回读确认。**桌面真实 2,000 条样本集没有上传到 SaaS。**

仓库创建生成初始提交 `abb978cfd341e9cc297f247ead8e8947`；5 份文件的实际上传提交为 `9cdb1f188c36199c64830531bf8199ee`，实际消息为 `1`。在 SaaS 工作区增加 review_note 列并提交，生成 `3eaa4c32dbda863f9a16fed8f0494e34`，消息为 `Verify synthetic JSONL column editing`。

截图和可见 DOM 记录保存在 [evidence/saas-2026-11-08](evidence/saas-2026-11-08/)。原始下载链接中的临时签名、有效期已脱敏；未保存密码、登录令牌或 Chrome 会话文件。记录中的瞬时 storage 旧值属于 SaaS 页面缓存现象，不能用旧标题统计替代文件实际状态。

## 逐项观察与本地对应

| 能力 | 已观察的登录后 SaaS 行为 | 本地实现与对照判断 | 证据 |
| --- | --- | --- | --- |
| 仓库列表、创建、详情 | Projects 空状态，New project 的 Name/Description；创建后显示 private、owner、storage、files、updated；进入仓库 | 仓库列表/新建/详情、真实统计、搜索/排序可用；采用独立中文界面，不声明像素复刻 | 01、02、06 |
| 目录和文件导航 | 目录列表、List/Grid、排序、分支选择、Resource path、文件类型和最近提交；Manage Files 提供 Upload files/Add folder/Create Dataset | 目录树、列表、面包屑和路径返回可用；返回目录与切换文件由 URL 驱动，未保存标签可阻止离开 | 02、06、19 |
| 文本、图片、PDF | notes.txt 正文可读；alpine.png 实际显示；PDF 可见正文、缩略图和 1/1 页 | 安全文本、同源图片、PDF.js 画布/翻页/缩放已在本机真实验证 | 16、18、19 |
| JSONL 表格 | sample.jsonl 被识别为 tabular，3 行，原 6 列；嵌套 meta 保留；增加列后 7 列 | 支持导入/预览/结构化编辑；真实用户文件 2,000 行/14 字段、原件 SHA、末页已验证 | 07、10、11、17 |
| 单条详情 | Row 1 弹层，逐字段显示、空值、Previous/Next、1/3 | 逐条详情、长文本/嵌套值、稳定行 ID、关联媒体和行标签；标签为用户批准的本地版本化扩展 | 17 |
| 工作区与源数据编辑 | Edit 创建 `/workspaces/<uuid>/database/sample.jsonl`；Add column 的 Name/Type/Show as；Commit message→Commit changes→回到文件并显示新 commit | JSONL 行增删改与列增删/重命名；数据和标签同提交；普通文件通过 workspace 上传/文本编辑。不同格式的能力边界明确显示 | 08、10、11 |
| 数据列类型与显示 | Type：Text/Number/List/Decimal/Checkbox/Date/Time；Show as：Default/Image/Video/Link/Code/Markdown | JSONL 保留原 JSON 类型，标签另外配置 single/multi/text；本地不把 SaaS 显示类型伪装成原始数据字段类型，也不宣称复刻所有展示方式 | 08 及本次可见菜单记录 |
| 提交历史与详情 | 文件 History 列出两次相关提交；Resource at commit；详情作者/时间/hash、Δ1 file、Schema Changed、+1 cols、6×3→7×3 | 历史、详情、原版本预览、文本前后值和结构化表格 diff；新表格差异显示完整计数、列变化和分页 | 20、21、22 |
| 表格文件 diff | Base/Diff/Head，7 columns/3 rows，3 modified，review_note.right；可选单元格看行详情 | 原生 Oxen tabular 差异优先，必要时完整 JSONL 本机比较；仅在两侧全量核验唯一业务 ID 后对齐修改行 | 22；本地 tabular-diff 测试 |
| 分支创建和切换 | New branch：Branch name/Source；实际创建 acceptance-review；切换到旧分支保留 notes.txt 路径并提示 File not found in branch | 创建/切换和版本上下文可用；本地切分支回到目录。两种导航选择有差异，均不展示另一版本的旧内容 | 03、04；本次切换可见结果 |
| 分支比较与合并请求 | Developer tools→Branches/Merge Requests；空列表→New merge request→Compare changes；相同分支和无新提交有明确提示 | 本地补充独立合并请求协作元数据；实际 merge 使用既有真实 CLI/原生预检，不能用本地成功冒充 SaaS MR 生命周期已核对 | 05、09、23 |
| 查询入口与结果 | `SELECT * FROM df WHERE score > 0.9` 返回 2 行；自然语言 `Show rows where score is greater than 0.9` 同样返回 2 行，View generated SQL 可见生成 SQL；Clear query 恢复 3 行 | 有限规则引擎及用户允许的模型计划在本机执行，固定 commit；显示实际展示条数/总匹配条数，模型不接收记录正文。按用户接受的替代实现验收，不冒充 SaaS Text2SQL | 14、15 |
| 元数据、默认分支、权限 | General 含 Rename repo/Description/Visibility；Users & Collaborators 的 Administrator/Editor/Viewer；本轮只读观察，没有邀请、改角色、改可见性或删除 | 描述/tags 和默认 Web 分支、BFF viewer/editor/admin 是本地控制面；上游原生权限/默认分支保持只读。SaaS 账号/OAuth/组织不是同一套后端 | 12、13 |
| 三级标签 | 本轮可见数据列和行详情没有证明原生具备用户要求的三级选项标签体系 | 按用户明确要求独立扩展 `.oxenweb/labels.json`，真实版本化提交、分支隔离、选项校验、末行赋值、继承、冲突和重启读取；不能虚称来自 SaaS 私有 API | 本地 labels/JSONL 证据 |

## 不能伪造通过的异常和边界

1. **SaaS 非空分支比较被上游错误页阻断。** `compare/branch/acceptance-review..main` 在上传后、刷新后、增加列产生新 head 后均显示 `Whoops, there was an error on our end.`。因此没有创建云端合并请求，也没有核对其合并、关闭、评论、冲突完整流程。09/23 保留错误页，本地真实合并与 MR 协作必须单独留证。
2. **SaaS 提交 diff summary 部分报错。** 提交详情显示 `There was an error loading the diff summary for this commit.`；同时文件变化、列数变化与单文件结构化 diff 可用。因此不把整个 diff 功能笼统标为失败或成功，分别记录。
3. **没有执行云端权限、默认分支、删除、重命名操作。** 权限仅核对可见角色；不宣称完整云端多账号权限矩阵已实测。仓库重命名和 SaaS 云存储管理在开源 OpenAPI 中没有本项目采用的可靠写契约，本地仓库标识保持不可改，不用虚拟显示名冒充真实 rename。
4. **本地实现存在明确容量与格式边界。** 上传、代理、文本展开和结构化比较有上限；超过限制须给出错误/截断说明。其他格式的原生行列编辑、SaaS Code/Markdown 等所有列展示模式未逐一复刻，不从 JSONL 通过推定它们全部通过。

登录后快照核对已经完成上述范围，并发现真实差异后在同一版本补齐本地功能。最终应将“登录后已核对”“本地功能通过”“上游异常阻断”“接受的本地替代实现”分别记录。**这不是没有例外的 100% SaaS 复刻通过证明。**

本地最终浏览器、MR实际合并/目标回读、构建与63项常规/7组真实服务结果见[最终界面与构建验证](browser-verification-2026-11-08.md)。
