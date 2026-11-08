# 页面与交互目录

统一来源：2026-11-08 登录后合成私有项目。原证据编号对应 `docs/evidence/saas-2026-11-08/`。本轮补充截图在 `captures/2026-11-08/`。具体云端 URL 见 `page-map.json`。所有“本地映射”都是实现说明，不是从 SaaS 推导的后端接口。

| ID / 页面 | SaaS 可见结构和动作顺序 | 已知状态/边界 | 本地映射 |
| --- | --- | --- | --- |
| UI01 工作空间/项目列表 | 用户/存储 → Projects → Search/New project → Updated/Files/Total size → View project | 空列表提示创建；New project 的 Name/Description；新建默认私有 | RepositoriesView：工作空间概览、项目卡片/列表、搜索/筛选、新建；JSONL 导入是本地扩展 |
| UI02 项目/目录 | 顶部项目切换 → 名称/可见性/OWNER/STORAGE → Manage project/Developer tools → 分支、Clone、Manage Files → List/Grid/排序 → 最新 commit/History → 文件行 | 本次头部 storage 曾缓存旧值；单次头部不能代替文件实际状态 | App + RepositoryView + FileBrowser：顶部导航、项目 masthead、开发者菜单、资源导航、列表/网格、可选目录树、真实提交条 |
| UI03 文件管理 | Manage Files → Upload files / Add folder / Create Dataset；上传有 Target directory、Commit Message、Commit Files | 浏览器上传审批曾拒绝自动传文件，由用户手动完成合成文件上传；不绕过 | FileBrowser 文件管理菜单 → WorkspacePanel action/path 上下文 → 选择/新建同分支工作区 → 上传/编辑/提交；仅 JSONL 可原生行列编辑 |
| UI04 表格/查询 | 分支+Resource path → Search for anything → Actions/Edit/Developer/Download/Delete → commit/History → 列头/行号/数据 → 总行数 | JSONL 3行，嵌套对象保留；自然语言和 SQL 都可返回2行；查看 generated SQL；Clear query 恢复 | FilePreview 的完整数据查询入口携带文件/问题到 QueryPanel；源文件目录选择、明确规则/自然语言模式、固定commit、只读计划、结果真实计数；不冒充云端任意SQL |
| UI05 行详情 | 行号旁展开 → Row 1 → 字段/Empty → Previous row/Next row → Close | 本轮原始 image 字段是路径文本，没有把它当成已观察到云端自动媒体关联 | FilePreview/AnnotationPanel：字段详情、长文本与对象、上一条/下一条、仓库媒体预览；本地三级标签侧栏 |
| UI06 编辑/工作区 | Edit → workspaces/UUID/database/file → Add column → Name/Type/Show as → Add → Commit → Commit message → Commit changes → 文件新版本 | Type 有 Text/Number/List/Decimal/Checkbox/Date/Time；Show as 有 Default/Image/Video/Link/Code/Markdown；只实际执行 Text 列新增 | DatasetEditor/WorkspacePanel：JSONL 行列编辑、版本说明、待提交项、真实提交、原值/标签保护；不同格式显示实际替换能力，不虚构全部展示类型 |
| UI07 文本/图片/PDF | Resource path、分支、原件、编辑/开发入口、History、正文/媒体；PDF缩略图/1of1/页码 | 实际内容和像素已见；不把 MIME 适配当成所有格式播放已过 | FilePreview/PdfPreview：文本行号、图片、PDF.js、音视频、重试和边界 |
| UI08 提交历史/详情 | Commits/文件 History → 消息、作者、时间、hash、Resource at commit → 变更摘要 → 文件 diff | 部分 diff summary 报错，但 Δ1file、+1cols、6×3→7×3 与单文件diff可用 | CommitPanel：历史、父版本、文件索引/筛选、变更前/当前版本预览；未有真实路径历史契约时只筛详情文件，不谎称列表按文件过滤 |
| UI09 表格 diff | Base/Diff/Head → Schema、列/行数、modified计数 → 数据网格 → 单元格行详情 | 新增review_note显示3modified；native结构可能补null，不能据此捏造原JSONL值 | TabularDiff：列变化、完整计数、状态过滤/分页、前后值；JSONL两侧原文件全量比较，保留缺键/null |
| UI10 分支/MR | Developer tools → Branches/Merge Requests；New branch 的 Name/Source；New merge request → target/source比较 | 相同分支和无ahead明确不可创建；非空compare上游错误，不推定后续云生命周期 | BranchPanel/MergeRequestPanel：分支表、发起MR、固定版本审阅、讨论、关闭/重开、真实merge和任务恢复；本地独立协作元数据 |
| UI11 项目设置/权限 | Manage project → General / Users & Collaborators；名称、描述、Visibility；角色Administrator/Editor/Viewer | 只读观察云端角色，未邀请/改权限/删仓库；无可靠原生rename写契约 | SettingsPanel/AccessPanel：同结构侧导航、版本化元数据、BFF角色与撤销；准确说明本地控制边界 |

## 高频操作的本地路径

2026-11-08 R1/R2 用户确认的本地导航覆盖早期路径；上表保留 SaaS 冻结事实，不能据此声称以下本地扩展也是 SaaS 原生功能。

打开数据：项目 → 数据编辑 → 当前分支的完整逻辑样本。编辑、三级标签、检索和片段/步骤在同页；README 在概览。标签维度与发布模板改由同级全局“标签管理”维护，普通标注者无入口且路由/API 拒绝。多表旧项目由负责人在设置一次性配置入口，标注者不选择物理数据文件。

协作交付：任务与复核 → 个人任务分支 → 提交复核 → 另一人审核 → 版本与合并 → Releases 固定提交构建/核对/发布。卡片及列表按默认分支固定提交计算样本数，显示于总大小之前。验证与限制见 [R1/R2 实施记录](../../implementation-r2.md)。查询问题不自动执行，也不自动允许字段外发。

提交文件：文件管理 → 选择/创建工作区 → 暂存内容 → 核对变更 → 提交说明 → 提交 → 历史/对应版本回读。远端 workspace 提交已可见，不把 Push 虚构成其必经步骤。

审阅合并：开发者工具 → 分支/合并请求 → 选择两端 → 比较固定版本 → 标题描述 → 讨论 → 核对版本 → 确认合并 → 真实任务与目标版本回读。状态/heads变化要求重新比较；已合并保留原审阅快照。

## 空、错、加载与离开

2026-11-08 R5本地更新：UI01/02的项目卡片、顶部及概览改用main统一项目标签，增加明确“编辑标签”和独立保存；aisec等main关键词保留可见但不伪造成维度选项。UI04/05/06的数据工作台增加按原类型的行内编辑、小身份/数字列、复制为新身份，以及删除复制项/非法输入/全选候选的回归修复。样本编辑仍先暂存和保存私有草稿，再显式一次提交；项目标签保存不带上样本草稿，也不重载当前表格。根因、229项实际回归、官方0.67合成联调和主线程浏览器计数见[R5验收](../../implementation-r5.md)。这取代R3的分支标签展示方式，保留R4不重载选择、字段帮助和取消旧兼容的历史事实；没有新增SaaS原生功能结论。

2026-11-08 R4本地更新：同页条目选择只更新高亮、详情与sample URL，不重新查询整表或强制保存草稿；外部跨页定位和真正上下文变化继续加载。源字段说明同时显示ID、可用别名、实际类型及纯文本帮助，未知字段不推断。用户取消旧兼容要求后，相关界面和数据流已移除。实际Vue回归、合成浏览器查询计数、窄屏及正式部署证据见[R4验收](../../implementation-r4.md)。本轮复用冻结研究，没有新增SaaS观察。

2026-11-08 R3本地扩展更新：项目目录默认修改时间倒序，结构化数据集标签筛选和卡片摘要来自同一默认分支固定commit，样本数与标签不混版。全局治理采用组织/领域筛选及数据集/样本两类模板；项目当前读取版本显示数据集标签，样本工作台只消费专题字段。保存顺序为编辑多项→本机私有草稿→前后值核对→一次提交；工作区与分支分别解释。旧意见兼容保存、权限与任务范围、明确的未保存保护继续生效。所有语义表格垂直居中。详见[R3实施验收](../../implementation-r3.md)及合成截图；这些是用户要求的本地设计，没有新增或篡改云端观察结论。

加载留在当前上下文并显示状态；空目录/无项目/无匹配/无提交不等于请求失败。失败提供重试和原因；权限不足区分访客、只读与授权身份。未保存的数据/标签/评论离开时使用站内确认，取消保留输入和分支选择；刷新/关闭继续使用浏览器标准保护。

2026-11-08 R5补充：main 项目标签保存后的本人样本草稿可显式同步基点，限定仅项目标签文件变化，重新校验双 CAS、规范、源内容与权限，不自动合并。过期草稿保留本人下载入口；两条浏览器恢复路径和原生导出通过，浏览器下载审批拒绝，未计为落盘通过。均为本地扩展，详见[R5验收](../../implementation-r5.md)。

2026-11-08 R7本地映射更新：UI04/05/06的`DatasetWorkbench`改为完整宽度表格与覆盖详情抽屉，切行不重取整表；`SampleFieldsPanel`和工作台通过独立`dataset-ui-state`保留非法/未完成输入，先处理样本草稿再回来继续配置，导航等待持久化，失败停留。字段基线外部变化先对照，多窗口使用ID+revision双CAS；覆盖原来只能放弃字段表单的离开方式。UI11样本字段增加自动/固定像素/权重列宽，纯展示更新不改变规则和源记录。UI08/09的`TextDiff`提供真实行/行内高亮、上下文及JSON原始入口，超限明确提示。事实、实现、原生回执和合成/生产证据分别登记于[R7记录](../../implementation-r7.md)，官方设计来源见[研究记录](../../research/durable-editor-and-diff-2026-11-08.md)。没有新增SaaS原生能力结论，也未改变此前上游错误和下载审批的记录。

2026-11-08 R6本地扩展：UI01卡片的关键词及所有结构化标签均可独立筛选，保留原搜索；标签治理将维度版本选择移入高级详情，已发布快照语义保留。UI06/UI11设置增加样本字段类型、有限选项、空值与必填约束，编辑控件按配置选择；未提交/私有草稿红色、明确成功提交本轮绿色，刷新清除绿色。规则变更、权限、CAS、源真值和活动任务受保护。实际265项回归、官方0.67合成服务与浏览器证据见[R6验收](../../implementation-r6.md)和[实践参考](../../research/typed-field-editing-2026-11-08.md)。本轮无新增SaaS观察，不把BFF字段schema扩展冒充上游能力。

2026-11-08 R8本地映射：UI01/02/04/06/08/11增加可恢复项目移除与管理员恢复、显示名简介、概览README编辑/历史、结构化项目标签、抽样列宽、空项目导入/新增及完整结果排序。复用冻结SaaS证据，不新增云端观察；322项回归、原生0.67与合成浏览器结果见[R8记录](../../implementation-r8.md)。
