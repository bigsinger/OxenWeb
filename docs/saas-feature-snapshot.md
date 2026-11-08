# Oxen 数据管理与协作功能快照

冻结公开资料日期：2026-11-07。登录后UI快照与范围复核：2026-11-08（Asia/Shanghai）。

本次交付范围以用户最初的《Oxen Web UI 自研方案（单版本一次交付 · TypeScript）》以及后续明确的 JSONL、自定义标签列、dataset/file/row 三级标签要求为准。**只核对数据管理与协作功能；同一版本一次交付，不拆只读先行版本。**

用户已完成IAB登录，主线程在真实SaaS中创建并操作非敏感合成项目 `bigsinger/oxen-web-acceptance-20261108`。登录后证据已保存，本文按实际记录回填；未操作的状态仍待核。研究任务不操作主线程浏览器，不猜登录后私有接口。

## 范围边界

纳入：仓库列表/详情/基础设置、目录与文件浏览、文本/表格/图片/PDF 预览、提交历史/详情/diff、分支创建/切换/合并、commit/push、workspace、基础在线标注与标签、自然语言查询入口和真实结果、多模态文件与表格行关联、协作权限以及完整加载/空/错误状态。

明确排除本次验收：模型目录、云模型聊天/图像/视频/音频生成、生成工作台/队列、微调、模型部署、批量模型 evaluation、支付/credits/计费，以及由这些产品引出的账户控制面。语义向量检索、S3 运维、TB 级传输基准、完整 OAuth/注册流程也不是原方案的必交阻塞项。已有的音视频代码可保留，但不将其变成原“四类预览”以外的新承诺。

原方案要求 BFF 鉴权和协作可用，因而要验证真实的只读/编辑/管理限制；不要求复制 Oxen 云账户及组织系统。自研 BFF 权限的实际执行边界必须清楚。

## 固定证据

| 证据 | 来源与状态 |
| --- | --- |
| SaaS UI 入口 | [www.oxen.ai/login](https://www.oxen.ai/login)；密码、magic link、GitHub、Google 入口实见。用户完成IAB登录，主线程已观察 `/bigsinger` Projects 与专用项目，证据见 `docs/evidence/saas-2026-11-08` |
| API host | `hub.oxen.ai` 根路径曾返回404，但其公开规范可下载；不能把 API host 根404当作 SaaS 不可用 |
| Repository OpenAPI | `contracts/oxen_server_openapi.json`，版本0.67.0；来源/哈希见 `contracts/source.json`。归一化规范固定35项依据源码的修正，不自动追新版本 |
| 官方服务端源码 | `Oxen-AI/Oxen@0d3045335f93d77171f95f599a3cee3a080622ae`；仅核路由、序列化与行为，不分析托管前端编译产物 |
| 官方文档 | [Datasets](https://docs.oxen.ai/examples/data/datasets)、[Data Frames](https://docs.oxen.ai/features/data_frames)、[Labeling](https://docs.oxen.ai/features/labeling_data)、[File Metadata](https://docs.oxen.ai/concepts/file_metadata)、[Diffs](https://docs.oxen.ai/concepts/diffs)、[Workspaces](https://docs.oxen.ai/examples/data/workspaces)；固定文档仓库commit为 `be5dfa1717e78dd3a390e8be617c408a764cbdec` |
| 本地真实服务 | Oxen Server/CLI 0.67.0；本地服务及CLI验证见 `infra/oxen/README.md`、`docs/integration-results.md` |
| 本轮新增实测 | `docs/verification-update.md`、`docs/labels-and-jsonl.md`；真实2000行JSONL、标签、模型计划查询、表格编辑与版本化设置/角色验证 |
| 范围外资料 | 已保存的Hub v281规范及模型相关类型仅为研究资料；不作为本次需求、依赖或验收门槛 |

“公开文档说明”“公开契约支持”“本地真实操作通过”“SaaS 登录后观察”“两端等价通过”是不同证据等级。只有最后一项可以标作等价通过。

## 已实际观察的SaaS快照

测试账号角色为项目OWNER。仅上传合成小样本，不上传用户2000行benchmark。证据目录为 [saas-2026-11-08](evidence/saas-2026-11-08/01-projects.txt)，以下编号对应其中的同名前缀文本/截图。

| 证据 | 实际页面与行为 | 未被该证据证明的部分 |
| --- | --- | --- |
| 01–02 | `/bigsinger`有Projects、Search projects、New project；新建弹窗仅Name/Description。专用项目默认private，初始commit `abb978cfd341e9cc297f247ead8e8947`。仓库有List/Grid、目录排序、Clone、Manage Files、branch与commit入口 | 空间搜索所有状态和多人账户隔离未测 |
| 03–06 | 创建 `acceptance-review`；Manage Files含Upload files/Add folder/Create Dataset；上传页面含target directory/commit message/CommitFiles。合成5文件实际提交 `9cdb1f188c36199c64830531bf8199ee` | Add folder/Create Dataset仅观察入口；未据此声称它们已操作成功 |
| 07–11 | `sample.jsonl`显示3行6字段；Edit进入独立workspace URL。Add column含Name、Type与Show as；Type实见Text/Number/List/Decimal/Checkbox/Date/Time，Show as实见Default/Image/Video/Link/Code/Markdown。新增 `review_note` 后commit `3eaa4c32dbda863f9a16fed8f0494e34`，回读3行7字段 | 仅执行Text列新增；其余类型/渲染配置的保存及行增删未逐项操作。自定义标签列/三级scope是本项目明确新增要求，不推断SaaS同款 |
| 12–13 | General settings有Rename repo/Description/Visibility与Save Changes；Storage显示UUID/Version store S3；另有Delete repo。Users & Collaborators有用户名/email输入、Administrator/Editor/Viewer角色 | 没有重命名、删除、改云可见性、添加真实联系人或切换他人权限；不能据UI控件推断真实ACL已验收。tags/defaultBranch未在该屏观察到 |
| 14–15 | SQL `WHERE score > 0.9` 与自然语言问题均实际返回2行；NL有View generated SQL，展开为 `SELECT * FROM df WHERE score > 0.9;` | 只证明这条合成查询；其他聚合、错误、历史、成本或模型配置未测 |
| 16–19 | 图片真实渲染；行详情含7字段、前后行1/3；PDF真实可见1/1页及标题/license；文本正文可见 | 行详情显示image路径不自动证明关联媒体点击行为已完成；坏文件等异常未测 |
| 20–22 | 文件专属History有2提交；单次commit列出1文件/新增1列/6×3→7×3，但summary加载报错。单文件compare成功，有Base/Diff/Head、Schema、3 modified rows，网格含 `review_note.right` | commit summary错误如实保留，不把上游错误当本地可忽略diff的理由 |
| 05、09、23 | Merge requests空态有New merge request；Compare changes选择target/source，同分支警告、source无ahead阻止创建。非空branch compare在重新加载及新head后仍显示“Whoops, there was an error on our end.” | SaaS实际创建、评论、关闭/重新打开和merge生命周期未完成，不能宣称其精确UI等价；本项目独立BFF协作流程另做真实验收 |

切换branch会保留文件路径；切到该文件不存在的 `acceptance-review` 时，真实显示File not found in branch。这是已观察的范围内错误状态，不代表所有页面错误状态均已覆盖。

## 范围内页面/行为清单

| 快照ID | 要观察的实际产品行为 | 本地实现/契约依据 | SaaS对照状态 |
| --- | --- | --- | --- |
| P01 | 仓库列表、筛选/搜索、进入详情、新建与空列表 | namespace仓库API、仓库列表/详情、新建；列表按BFF权限过滤 | Projects/新建/项目页已观察01–02；最终本地当前build对照继续回填 |
| P02 | 仓库描述、tags、默认浏览分支、可见性及基础协作设置 | `.oxenweb/repository.json`真实版本文件；BFF控制面；默认Web分支不冒充上游未公开属性 | General/Access已观察12–13；云rename/delete未操作，本地也不据此声称同款；tags/defaultBranch未见 |
| P03 | 目录展开、面包屑、文件选择、空目录与不存在路径 | `GET .../dir/{resource}`，真实目录适配与路径校验 | 待对照导航方式，不假定与SaaS布局相同 |
| P04 | 文本/表格/图片/PDF四类文件预览、分页与错误 | 原文件/数据帧API，JSONL保真解析、图片、PDF.js canvas | 四类SaaS预览已观察07、16–19；坏文件和大表分页仍不自动通过 |
| P05 | 提交列表、单次详情、作者/时间/父版本、变更文件与diff | history/commit/compare API；已补原生完整结构化diff及唯一业务id前后对齐 | SaaS文件history/单次commit/结构化grid已观察20–22，summary有真实错误；本地当前UI回归待记录 |
| P06 | 分支列表/切换/创建、合并确认、成功与冲突反馈 | branches、merge、CLI；真实目标分支回读 | 本地成功及专用同文件冲突目标保留已实测；SaaS03–04创建/切换可用，非空compare上游错误 |
| P07 | workspace创建/读取/上传/暂存/编辑/删除、commit、push | 公开workspace API与CLI、BFF任务；草稿和提交有独立版本边界 | SaaS上传commit、Edit workspace与新增列commit已实际执行06–11；删除/撤销与CLI push语义分别核对 |
| P08 | 基础在线标注；自定义列名、单/多选/文本、选项；三级标签 | `.oxenweb/labels.json`真实提交，业务稳定行ID、分支隔离与继承 | 新标签要求本地已实测；不假定SaaS具有同名三级scope模型 |
| P09 | 自然语言问题输入、执行说明、结果表格、无结果/失败 | 用户授权后Codex仅接收字段与问题生成只读计划，真实2000行本机执行；显式规则模式 | SaaS NL返回2行并展示generated SQL已观察15；本地执行计划和SaaS SQL展示形态不同，明确记录 |
| P10 | 从表格行关联图片/PDF等仓库内文件，切换行后上下文一致 | 同源原文件代理、关联预览；schema渲染metadata有公开依据 | 图片关联已有本地实测；实际SaaS行关联交互待观察 |
| P11 | viewer/editor/admin差异、私有隔离、访客只读、身份撤销 | BFF实际角色拦截；独立令牌只存哈希；上游仅回环；配置分支固定且重启不回退 | SaaS三角色下拉已观察13；真实云角色切换未操作。本地真实矩阵通过，不冒充云账户 |
| P12 | 每个范围内页面的加载/空/错误/权限/取消与窄屏状态 | 对应组件/表单/任务状态；逐条证据见等价矩阵 | 无记录的状态保持待核对 |
| P13 | 用户JSONL导入、完整下载、2000行/14列、末页与嵌套结构 | 用户真实文件已导入；完整SHA一致、末行与结构保真 | 本地通过；若做SaaS同样本测试须遵守数据上传授权，不自动上传 |
| P14 | JSONL源数据行列编辑、草稿/撤销/提交、历史与标签一致 | 自研结构化编辑经公开workspace文件写入；行列/标签同提交 | SaaSText列新增/commit已观察08–11；完整spreadsheet每种操作不能推定通过 |
| P15 | 合并请求列表、比较、发起、评论、关闭/恢复、合并 | 独立BFF本地持久协作元数据；CAS revision、捕获heads、真实provider/jobs执行merge | SaaS空态和比较限制已观察05/09/23；非空比较上游报错，云后续生命周期精确对照暂未完成。本地UI完整发起/comment/close/reopen/merge与raw读回已通过，见本地03证据 |

## 契约能力与已发现的实际边界

### 查询

公开 `GET /api/repos/{namespace}/{repo_name}/data_frames/{resource}` 列出 `sql`、`filter`、`columns`、排序和分页参数；固定源码确认这些是query参数。2026-11-08对本地 `local/visual-search/data/labels.csv` 的只读复核：

- `filter=confidence > 0.9` 返回正确的2条记录（0.98、0.94）。
- `sql=SELECT COUNT(*) AS n FROM df` 返回HTTP200、opts中也保留SQL，但未索引的该资源实际仍返回3条原始记录，没有返回计数。**因此不能把规范参数存在或HTTP200当作raw SQL已通过。** 原生SQL需要正确的索引/workspace路径及结果断言，不能静默将它当作已执行。
- 本项目自然语言路径是“字段/问题→受限计划→本机完整扫描”，不是Oxen SaaS Text2SQL，也不自动降级为规则结果。它满足原要求中入口/真实结果的实现方向；最终交互等价仍以登录后观察及同问题结果对照判定。

登录后已实际观察SQL输入与NL生成SQL展开控件，见证据14–15。本地通过受限模型计划解释执行，而非任意SQL执行器；需把这种执行说明差异明确展示，不将两种实现混称为同一接口。任意SQL控制台或向量搜索仍不扩大原需求。

### 合并与冲突

公开 `GET R/merge/{base_head}` 返回顶层 `is_mergeable`、`conflicts`、`commits`；`POST`合并请求体是 `{name,email}`，冲突响应为409。分支 `branches/.../merge` 是push内部协调，不能误用。

本地只读复核 `GET .../merge/main..integration-check` 实际返回 `is_mergeable=true`、空conflicts。另在合成 `local/audit-conflict-1794094608883` 构造同文件两分支不同修改，真实job失败并报告 `data/conflict.txt`，目标commit和target version原文保留，未初始化clone或push，见 [真实正确性记录](verification-2026-11-08.md)。固定CLI的merge命令忽略内部可空commit返回值，**不能只依据退出码0判成功**；现已添加写前mergeability与merge后push前clean检查。

### 表格diff

实际服务单文件路径是 `GET R/compare/file/{base_head_resource}`，尾部资源编码为 `base..head/path`，与原OpenAPI注解不同；不能按失效注解直接请求。2026-11-08已只读核对原两个提交的 `data/labels.csv`：返回 `compare.diff.tabular`，added_rows包含confidence=0.94、removed_rows包含0.91，并有base/head schema和summary。

已实现 `tabular-diff.ts` 收齐原生分页、Schema列变化与前后行显示；只有读取两侧完整文件、核对唯一业务id之后才对齐modified，不能凭局部差异行推断唯一性。原生失败时，CSV/TSV/JSONL可完整保真比较，超过明确上限则报错，不返回采样冒充完整diff。

2026-11-08真实只读测试：CSV上述版本engine=oxen、modified=1，confidence由0.91到0.94；JSONL `b3264dd7e12a4153bfcdbb91637dedb0`→`c9f41d8cad2e12c0b0d3c47495290408` 收齐原生4001增删行，但发现Polars会在嵌套struct并集补齐原文件不存在的null键。因此JSONL前后值与差异一律使用两侧完整原文件保真比较，engine明确为local-structured，note单独保留原生计数；不会将归一化null显示成源修改，也能识别真正缺键→null。结果modified=2000/added=1，sourceRows=2000→2001，新增editor_note，before整行与原始JSONL deepEqual通过。9单测及显式真实live测试通过；对应UI仍须浏览器核对。SaaS实际Base/Diff/Head与3 modified行见22，不再仅凭官方文档推测。

### 合并请求

本项目新路由 `/api/repos/:namespace/:repo/merge-requests` 是独立BFF API，不加入Oxen官方OpenAPI，也不猜云私有接口。标题/说明/评论/状态保存在实例本地 `merge-requests.json`，原始数据合并仍通过已有Provider和CLI/公开HTTP路径。每次写协作状态有expectedRevision；比较捕获source/target真实commit；分支变化必须显式刷新。队列执行与写前复核actor和policy权限。中断、写后响应丢失保持不确定状态，要求检查目标再显式恢复，禁止自动重试。

10项完整鉴权/权限hooks集成测试通过，含入队失败恢复、provider准备期间admin降权，以及目标发生无关更新时不误判source已合入；成功必须确认新target完整祖先中含审阅的source commit。显式真实live最终复核在合成 `local/merge-request-check-1794096042918` 完成发起、评论、merge、目标 `review.md` 原文回读和重启后merged状态回读。source `371d418394f9c916de3f74f0dbacc367`，target从 `8a23426c8b74c4b8d84a0e8c39d68fd5` 变为前者。此前一次复核因CLI head解析错误要求32位而写前失败；已按Oxen可变长hex修复后重跑通过，不隐去失败。主线程另在 `local/saas-ui-check-1794095882937` 完成当前UI发起/comment/close/reopen/merge，目标原文及JSONL reviewed值、1条comment回读通过，见 [本地03读回](evidence/local-2026-11-08/03-merge-request-readback.json)。SaaS后续生命周期因真实上游branch compare错误未观察完成，不能据本地通过倒推SaaS操作成功。若请求确认失败，客户端须重新读取MR/job/目标分支，后端也要求显式刷新比较后再重试；本地元数据与远端merge不冒称一个跨系统原子事务。

### 元数据、标签与权限

- 公开schema/column metadata接口为整体替换，`_oxen`保留用于image/link渲染。通用SaaS仓库设置和云成员控制面未公开，本项目没有猜它们的接口。
- 当前仓库描述、tags、默认Web分支、可见性和成员策略实际进入 `.oxenweb/repository.json`，访问由BFF执行；不是旧sidecar方案，也不改变云端ACL。
- 标签实际进入 `.oxenweb/labels.json`。dataset scope在本项目明确为当前仓库，file为相对路径，row为文件内稳定业务身份；不将其冒称SaaS同款存储模型。
- 原生workspace行/列CRUD有公开源码但未完整进入固定OpenAPI；本项目通过有契约的文件暂存/提交实现结构化编辑，不猜私有端点。

## JSONL样本的验收基准

用户文件 `<本地样本路径>/prompt_injection_bench.jsonl`：1,476,731 bytes，2000条对象，14个字段，2000个唯一字符串id；label_name中benign/malicious各1000。meta为包含object/list/bool/null的真实嵌套字段。完整原文件SHA256为 `f9a1f1514b6ebe5b049bde307c87d53625c02628f3d7947f47470c9c9a5b4a4d`。

样本文本仅作为数据，不执行其中指令。正文没有发送模型；字段结构与问题的模型调用已有用户单独授权。SaaS登录状态不自动授权把整个用户样本上传到外部网站。

最终逐项验收见 [等价矩阵](saas-equivalence.md)，主线程的最短观察路线见 [观察清单](saas-observation-checklist.md)。
