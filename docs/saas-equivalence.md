# 原方案数据管理与协作等价验收

当前版范围补充：图片、音频、视频样本管理暂不纳入；旧媒体证据继续保留。本地增加的领域模板、Skill ZIP、标注快照与四类样本导入，按[设计说明](ai-safety-annotation-design.md)、[真实服务验证](benchmark-template-validation-2026-11-08.md)和[完整性审计](completion-audit-2026-11-08.md)独立验收，不据此改写SaaS未观察或上游失败的项目。

范围基准：[功能快照](saas-feature-snapshot.md)。复核日期：2026-11-08。交付为同一个完整版本；不拆只读MVP或第二次上线。

本表仅包含原方案的数据管理/协作与用户后续明确的JSONL、自定义标签及三级标签要求。云模型目录、生成、训练、部署、计费及语义向量检索不在本次范围，不再作为完成条件。

用户已完成IAB登录；主线程已在合成测试项目实际完成上传、JSONL列新增/提交、SQL/NL查询、四类预览、行详情、历史及单文件结构化diff观察。证据01–23见 [登录后记录](evidence/saas-2026-11-08/01-projects.txt)。未实际执行的云权限/重命名/删除与报错后未到达的MR生命周期仍不能勾选。

## 通过标准

每例分别记录三层结果：本地真实服务/API与持久化、本地浏览器交互、SaaS冻结快照对照。只有三者必要证据齐备才写“等价通过”。代码存在、文档支持、HTTP200或按钮文字均不能代替真实结果。

自研存储/执行路径允许不同，但产品语义要明确：版本化配置文件与BFF角色是真实控制面，不冒充云ACL；自然语言模型计划不是SaaS Text2SQL；显式规则模式不能冒充模型结果。原方案只要求自然语言入口与结果，不自动增加任意SQL控制台或向量数据库承诺。

## 精确用例与映射

| 用例 | 原要求/快照 | 两端要执行/观察的最小步骤与断言 | 本地证据与剩余核对 |
| --- | --- | --- | --- |
| E01 | 仓库列表/详情；P01 | 进入仓库列表→筛选/搜索→打开仓库；核对名称、描述、文件/大小信息与进入后的上下文；空列表有明确状态 | 本地真实API/浏览器已测；SaaS01–02实见Projects、New project、条目Files/Total size及项目页；搜索各状态未全测 |
| E02 | 仓库创建/基础设置；P01/P02 | 创建专用仓库→写描述/tags→刷新/重启→读回；设置修改生成版本，不仅改表单 | 本地版本文件真实读回；SaaS新建仅Name/Description、默认private；General12有Rename/Description/Visibility/Delete但只读观察，无云设置写入证据。本地不声称支持云rename/delete |
| E03 | 文件树；P03 | 展开至少两级目录→面包屑返回→选择文件；切换分支/仓库后旧请求不能覆盖新内容；空目录/不存在路径明确反馈 | 本地树及真实目录有记录；SaaS导航形态与异常状态待对照 |
| E04 | 文本预览；P04 | 打开文本并核对正文/行号；长文本显示截断边界和原件入口；HTML/样本中的指令只显示为数据 | 本地已测；SaaS19真实文本正文已见，长文本/行号/错误状态未据此自动通过 |
| E05 | 表格预览；P04/P13 | 导入或打开同结构表格→显示字段/类型→首尾页/跳转→读取嵌套对象/null/bool/list；原件完整下载校验 | 本地真实JSONL2000行/14字段、完整SHA和第2000条已通过；SaaS07实际3行6字段及嵌套meta、编辑后7字段。SaaS大表末页/跳转未用小样本假定通过 |
| E06 | 图片/PDF预览；P04 | 图片加载真实像素；PDF可见正文、页数与缩放；坏文件/不存在文件有错误；切换文件旧加载不能覆盖当前文件 | 本地图片640px与PDF.js画布/缩放有浏览器记录；SaaS16/18真实图像及PDF1/1正文已见；异常状态仍分别核 |
| E07 | 提交历史/详情；P05 | 选择分支→打开多条历史→打开单次提交；核对作者、时间、父版本、变更文件；根提交与不存在提交有正确结果 | 本地真实历史/详情已测；SaaS20路径专属2提交、21单次详情和Schema变化可见，但summary真实加载报错；不写成全成功 |
| E08 | diff；P05 | 以已知修改前后版本比较，明确新增/删除/修改文件，文本能看到真实前后值；表格修改必须可见数据内容差异，不能仅显示文件名或把大表格误称二进制 | 完整diff live通过：CSV原生modified1及0.91→0.94；JSONL为防Polars struct补null，收齐native后使用完整源文件保真比较，engine=local-structured，modified2000+added1、2000→2001、editor_note列、before整行与源deepEqual；9单测含缺键/null回归。SaaS22有Base/Diff/Head/Schema/3modified网格。本地最终UI回归另记 |
| E09 | 分支列表/切换/创建；P06 | 从现有分支创建专用分支→切换→文件/历史同步；刷新/返回后分支上下文正确 | 本地真实API/CLI/浏览器已测；SaaS03–04创建acceptance-review并显示列表，切换保留路径，旧branch缺文件真实显示File not found |
| E10 | 合并；P06 | 在两个专用分支制造不同文件修改→合并→回读目标commit和内容；再制造同文件冲突，确认冲突可见、目标不被覆盖、没有误报成功，可安全恢复 | 本地正常CLI链路与专用audit-conflict仓库真实冲突保护通过，目标commit/原文保留、冲突前未创建clone或push，见verification-2026-11-08；不只依赖退出码0。SaaS非空compare持续上游错误，冲突反馈未到达 |
| E11 | workspace基础操作；P07 | 创建workspace→上传/编辑→看暂存→读草稿；未commit时主分支不变；取消/删除只影响草稿；空workspace状态明确 | 本地真实上传/暂存/预览/提交/删除路径有证据；SaaS06上传commit与08–11独立workspace新增Text列并commit实际执行；撤销/删除未逐项测 |
| E12 | commit/push；P07 | 对草稿写commit message→提交→历史和文件读回；执行真实push并核对remote/目标分支；失败不显示成功，无未推提交丢失 | 本地CLI优先与有依据HTTP路径、缺失clone初始化有真实集成；SaaS06上传及11workspaceCommit实际回到新版本；两端workspace提交直写远端，不误说成仍需push才可见 |
| E13 | 在线标注/自定义列；P08 | 创建自定义列名，设置单选/多选/文本与选项→保存→刷新/历史读取；重复列、非法选项、错误基数被拒绝 | 本地单/多选/文本/非法输入与浏览器“风险判定”提交已测；SaaS08列新增及Type/Show as菜单已观察，执行Text列新增。自定义标签选项/三级scope属于本项目明确新增，不据普通列菜单宣称SaaS同款 |
| E14 | dataset/file/row三级标签；P08/P13 | 分别保存三个scope→跨页到第2000条→刷新→回读；仓库/文件/业务行之间不串值；后续提交继承、分支隔离、旧版本可读 | 真实三区分/稳定ID/继承/分支/重启通过，浏览器末行标签通过；dataset在本项目明确为当前仓库，不假定SaaS同名模型 |
| E15 | 原始JSONL编辑；P14 | 编辑单元格、增删行、增删/重命名列→预览/撤销→commit；数据与受影响标签同提交；历史原值保留，过期expectedCommit返回409 | 本地结构化编辑及2000→2001真实集成通过；SaaS08–11确实在workspace新增review_note并commit，3行6字段→3行7字段。其他行列操作仍不据此自动通过 |
| E16 | 自然语言查询；P09 | 用真实表格提条件/排序/聚合问题→执行→展示说明/结果；独立计数核对；无结果、歧义/不支持和执行错误不编造答案；切换上下文固定版本 | 本地真实2000行模型计划：label1=1000、15组sum1000，正文不发送。SaaS14SQL和15NL均返回合成score>0.9的2行，View generated SQL展开SELECT。当前本地受限计划说明与SaaS生成SQL不同，需准确显示实现语义，不能写成相同Text2SQL |
| E17 | 多模态行关联；P10 | 从一行打开仓库内图片/PDF关联→切换行/版本→预览匹配；空值/坏路径有反馈，拒绝路径穿越 | 本地图片关联已测；SaaS17行详情1/3及7字段已观察，image路径可见，未据此推定点击媒体关联已完成；只用合成数据 |
| E18 | 默认分支/元数据；P02 | 修改默认Web分支到现有review→离开重新打开→实际浏览review；配置分支仍固定main；错误分支拒绝，刷新/重启保持 | 专用真实仓库已测defaultBranch=review/configurationBranch=main；前端默认打开与SaaS语义待最终核对 |
| E19 | 协作权限/BFF鉴权；P11 | viewer可读/不可写，editor可写数据/不可改policy，admin可管理；private访客拒绝/public访客只读；独立token登录、角色调整与撤销既有session均生效 | 本地完整角色矩阵及真实Oxen独立仓库通过；SaaS13实际三角色Administrator/Editor/Viewer已见，但未添加联系人或切换云角色，不宣称云ACL实测。UI须说明BFF边界 |
| E20 | 加载/空/错误状态；P12 | 对列表/目录/预览/历史/分支/workspace/标签/查询/设置逐一记录加载、空、失败、无权限和重试；写入中不能重复提交或错报成功 | 逐页状态仍须补齐记录，不能以通用error组件推定全部通过 |
| E21 | 跨页/版本/并发；P03/P08/P09/P14 | 快速换仓库/分支/文件/页码后最终内容正确；提交捕获原上下文；旧版本写入409且不覆盖；窄屏可操作 | 本地部分已有测试/浏览器记录；最终当前build逐项核对 |
| E22 | 单版本可运行与稳定性；全范围 | 同一build集成全部模块，代码生成/类型/测试/build通过，真实服务/CLI/鉴权启停和失败恢复可复现 | 实际命令结果写对应记录；默认跳过live测试不算执行通过，不能用演示成功替代真实服务 |
| E23 | 合并请求协作；P15 | 列表空态→比较source/target，阻止同分支/无ahead→发起→评论→关闭/重新打开→固定heads审阅→merge→回读目标；并发revision/分支移动拒绝，actor撤销与policy权限在执行前生效，中断不得盲目重试 | SaaS05有空态/New merge request及比较限制，09/23非空compare真实上游报错，未到达后续生命周期。本地10完整hooks测试及真实createApp/Oxen/raw/restart通过。主线程当前UI在local/saas-ui-check-1794095882937实际create/comment/close/reopen/merge→r7 merged，id8ccb6ba2-4b14-421c-989a-c7ec83d53cc6；目标head=source f7d31e0664ba86a182d2962919d4cefc，notes及JSONL label=reviewed、1comment回读通过，见evidence/local-2026-11-08/03-merge-request-readback.json。云后续生命周期仍不宣称等价通过 |

## 本次已知真实证据

- [本轮追加验证](verification-update.md)：JSONL源SHA一致、2000行末页、浏览器自定义列/三级标签、源数据编辑、真实模型计划结果与独立角色验证。
- [标签与JSONL](labels-and-jsonl.md)：实际仓库/路径/提交、schema与稳定行身份、分支/历史/并发、导入校验和旧标注迁移。
- [浏览器验证](browser-verification.md)：原四类预览、图片关联、PDF画布、历史、分支、workspace/commit/push及窄屏；其中早期旧sidecar/只读设置描述仅代表当时版本，当前设置已版本化，不能沿用为最新结论。
- [集成记录](integration-results.md)、[服务说明](../infra/oxen/README.md)：真实Oxen/CLI链路、精确接口与环境修复。

公开SQL/filter/mergeability/原生tabular diff的最新只读复核及边界见 [功能快照](saas-feature-snapshot.md)。`filter`与原生tabular内容已核对；未索引资源上的SQL聚合虽返回200但未产生聚合结果，因此不标作SQL通过。高级SQL/向量能力不扩大原需求。

## SaaS观察证据如何回填

按 [最短观察清单](saas-observation-checklist.md) 走原范围。每条补：实际URL/页面标题、账号角色（不含密码/token）、关键控件名称、操作前后/空错加载状态、截图或可复现文本、对应E编号、本地build和结果。未观察到的高级功能不凭公开营销页引入范围；实际发现范围内基本行为缺失则在同一版本补齐。

当前结论：原范围SaaS核心页面已有实际登录后证据，本地多项真实数据/版本/权限验证通过；**仍须回填当前本地UI最终回归，以及未完成的状态与已记录差异，不能提前宣布整体完全等价**。SaaS非空branch compare错误如实保留，不拿范围外云能力增加上线条件。
