# 开源方案对照与交付准备审计

调研日期：2026-11-08。范围是文本/JSONL数据集、AI安全标注、自定义模板与项目/条目标签、多人任务复核、数据版本/分支/MR、发布包、Skill ZIP惰性查看及自托管权限。图片/音视频样本、训练与云计算不计入。本次先用GitHub插件实际搜索仓库，再读取官方仓库元数据、README、依赖清单与官方文档；没有安装这些项目、运行示例或访问真实样本库。

结论：**本次没有找到已核实可直接替代本项目全部要求的开源整套产品。** 标注工具与数据版本工具各有优势；“可上传ZIP”“多人可登录”“能导出JSON”分别不等于安全包管理、独立复核和包含标签/说明/变更记录的固定版本Release。以下“待适配/未核实”是本次资料审查的边界，不是断言产品永远不能实现。

## 面向本项目的对照

| 项目 | 开源版已核实的匹配能力 | 关键缺口、付费边界 | 对本项目的建议 |
| --- | --- | --- | --- |
| [Oxen](https://github.com/Oxen-AI/Oxen) | 大数据文件版本控制、原生JSONL表格处理、CLI/Python/HTTP API、自托管服务。与当前固定0.67后端契约和数据仓库一致。[官方README](https://github.com/Oxen-AI/Oxen/blob/main/README.md) | 开源CLI/server不等于托管SaaS完整前端；本文没有将云账号、任务复核、模板治理或本项目Release扩展算成内核自带。当前项目的权限与协作由BFF补充。 | **继续作为唯一版本底座**；保留已有Web/BFF，不修改内核。仓库main的新功能不自动纳入当前0.67交付。 |
| [doccano](https://github.com/doccano/doccano) | 文本分类、序列标注、序列到序列；JSONL导入/导出、标签配置、成员管理；项目角色包含administrator/annotator/approver。[教程](https://doccano.github.io/doccano/tutorial/)、[角色与架构](https://doccano.github.io/doccano/developer_guide/) | 通用文本标注较合适；本次未核实任意嵌套源记录编辑、组织级不可变模板、项目与样本双层分类、Git式数据分支/MR、完整Release和惰性恶意ZIP的成套流程。approver角色存在不代表已经满足本项目全部双人复核证据约束。 | **最相关的轻量文本标注备选**。若未来缩减为单纯文本打标，可单独试点；当前可参考项目角色、标签快捷操作和导出交互，不合并数据模型。 |
| [Label Studio Community](https://github.com/HumanSignal/label-studio) | 自托管、可配置标注模板、文本/片段/多选、Data Manager和标注导出。JSON任务可导入；JSONL在官方导入文档中标为存储连接方式，不能假设网页直接上传任意JSONL均等价。[导入](https://labelstud.io/guide/tasks)、[模板设置](https://labelstud.io/guide/setup_project) | **Community没有项目/工作区RBAC、角色工作流、指定复核员和重叠分配**；这些在Starter Cloud/Enterprise有不同范围。Community用户可见所有项目，不能用付费截图认定开源版隔离。[版本对照](https://labelstud.io/guide/label_studio_compare)、[Community用户](https://labelstud.io/guide/signup)。未核实Git分支/MR、Release或本项目ZIP安全流程。 | 标注控件与模板设计参考价值高；**开源版不能直接替代当前权限和协作要求**。仅在明确接受商业版或另建控制面时评估迁移。 |
| [Argilla](https://github.com/argilla-io/argilla) | 面向LLM反馈的多字段/Chat、单选/多选/评分/排序/片段/文字问题、说明与记录元数据；owner/admin/annotator按workspace分权；最少多人提交数和队列；SDK导入及本地/Hub导出。[字段与问题](https://docs.argilla.io/latest/how_to_guides/dataset/)、[分配](https://docs.argilla.io/latest/how_to_guides/distribution/)、[角色](https://docs.argilla.io/latest/how_to_guides/user/)、[导出](https://docs.argilla.io/latest/how_to_guides/import_export/) | 最少多人响应不等于独立审核批准；本次未核实Git数据分支/MR、项目与条目双层模板治理、完整Release、惰性ZIP。**README明确不再开发新功能，以修复/补丁为主**，近期push不能掩盖这一维护策略。[维护声明](https://github.com/argilla-io/argilla#readme) | AI安全/LLM反馈问卷最值得参考；若作为独立标注服务，先评估固定版本维护成本。**不建议现在整体替换**已完成的版本协作工作流。 |
| [DataChain](https://github.com/datachain-ai/datachain) | Python惰性查询，JSON/JSONL/CSV/Parquet，Pydantic类型、文件指针、版本化数据集、lineage、行级diff和导出；适合本地清洗/校验。[读取](https://www.datachain.ai/docs/guide/reading-data)、[数据集](https://docs.datachain.ai/concepts/datasets/) | 开源核心是库/CLI；**Studio网页、团队权限、分布式作业不能自动算入开源自托管能力**。[Studio](https://www.datachain.ai/docs/studio)。没有在一手资料中核实所需人工任务/复核UI、Git MR、Release及恶意ZIP管理。 | 可作为将来的**离线导入/数据校验辅助**，按需独立调用；不应为当前工作台引入第二套在线数据真相、自动执行样本Skill或默认外发内容。 |
| [DVC](https://github.com/treeverse/dvc) | 数据文件与对象存储缓存，Git中保存版本元数据；分支/commit/tag切换配合`dvc checkout`，适合外部GitHub/GitLab协作。[README](https://github.com/treeverse/dvc/blob/main/README.rst)、[官方入门](https://doc.dvc.org/start) | JSONL可以作为文件版本化，但不是逐条标注WebUI；MR/权限依赖Git托管与存储系统，模板、复核、Release包及包内diff需自建。Studio相关产品不等于DVC CLI自带。 | 如果组织已经全面采用Git+DVC，可作为**另一条架构路线**；当前已有Oxen时再叠DVC会增加两套版本状态，不建议同时引入。 |
| [CSGHub](https://github.com/OpenCSGs/csghub) | 自托管资产门户、Git/LFS式数据仓库、网页文件操作与数据集卡片。公开文档展示CSV/Parquet/JSON数组预览、任务/行业标签和组织协作，但相关站点文档不能一概视为CE交付承诺。[仓库](https://github.com/OpenCSGs/csghub)、[版本选择](https://www.opencsg.com/docs/en/csghub/101/choose_edition)、[预览](https://www.opencsg.com/docs/en/dataset/datasetviewer) | **OpenCSG在线社区、CE和EE有区别**。本次未核实CE包含本项目条目标注/双人复核/JSONL完整编辑/恶意ZIP与Release整包工作流；不能把云端/EE标签或Skills入口直接当作这些能力。[更新/标签文档](https://www.opencsg.com/docs/en/dataset/dataset_repo_settings) | **继续只借鉴门户、路由和列表结构**。整合完整平台会更换资产模型与控制面；无必要为本版引入模型训练等范围外模块，更不复制源码。 |

AI安全领域的风险、来源、攻击意图、预期/观察行为和人工结论仍需按本项目语义建模。通用标注平台能配置选项，不代表已经提供适用于四类样本、保留源truth且经过确认的专用模板。

## 许可、技术栈与维护快照

下表许可为GitHub主仓库SPDX标识，实际复用仍需读取对应版本LICENSE/NOTICE及子包声明；没有据此执行许可法律判断。`pushed_at`为GitHub API最近推送UTC日期，可能包含补丁或自动化提交，不能当作产品路线保证。七个仓库在本次读取时均未标为archived。

| 项目 | 主仓库许可 | 实际技术栈/证据 | 最近push（UTC）与维护说明 |
| --- | --- | --- | --- |
| Oxen | Apache-2.0 | Rust核心、Python绑定；[README](https://github.com/Oxen-AI/Oxen/blob/main/README.md) | 2026-11-06；[API元数据](https://api.github.com/repos/Oxen-AI/Oxen)；项目交付仍固定0.67 |
| doccano | MIT | Django/Python，Nuxt2/Vue2/TypeScript；[开发文档](https://doccano.github.io/doccano/developer_guide/)、[前端清单](https://github.com/doccano/doccano/blob/master/frontend/package.json) | 2026-04-14；[API元数据](https://api.github.com/repos/doccano/doccano)；最近推送较早，迁移前需验证维护与升级成本 |
| Label Studio | Apache-2.0 | Python/Django、React/TypeScript；[仓库](https://github.com/HumanSignal/label-studio)、[前端清单](https://github.com/HumanSignal/label-studio/blob/develop/web/package.json)；子包另有许可声明 | 2026-11-07；[API元数据](https://api.github.com/repos/HumanSignal/label-studio)；开源/商业版分别判断 |
| Argilla | Apache-2.0 | FastAPI/Python，Nuxt2/Vue2/TypeScript；[服务清单](https://github.com/argilla-io/argilla/blob/develop/argilla-server/pyproject.toml)、[前端清单](https://github.com/argilla-io/argilla/blob/develop/argilla-frontend/package.json) | 2026-11-02；[API元数据](https://api.github.com/repos/argilla-io/argilla)；明确停止新增功能、继续补丁修复 |
| DataChain | Apache-2.0 | Python/Pydantic、SQL与本地SQLite；[README](https://github.com/datachain-ai/datachain) | 2026-11-08；[API元数据](https://api.github.com/repos/datachain-ai/datachain)；库与Studio分开 |
| DVC | Apache-2.0 | Python CLI；[README](https://github.com/treeverse/dvc/blob/main/README.rst) | 2026-11-06；[API元数据](https://api.github.com/repos/treeverse/dvc)；检索时canonical仓库为`treeverse/dvc`，旧组织URL不可当作当前归属 |
| CSGHub | Apache-2.0 | Vue3/Vuex/Element Plus，Go/Gin；[前端清单](https://github.com/OpenCSGs/csghub/blob/main/frontend/package.json)、[Go依赖](https://github.com/OpenCSGs/csghub/blob/main/go.mod) | 2026-11-05；[API元数据](https://api.github.com/repos/OpenCSGs/csghub)；CE、EE与在线服务分开核实 |

## 建议的取舍

当前保留Oxen版本底座及自研Web/BFF最符合已经确认的数据模型与操作顺序。后续优先参考doccano的文本标注/角色、Argilla的问题定义/多人响应、Label Studio的标注控件，以及CSGHub的资产门户；需要大规模离线清洗时再独立评估DataChain。DVC是替换版本引擎的架构选项，不是当前UI的附加组件。

若要真正替换，先用合成数据核验五条完整路径：JSONL嵌套原值往返、管理员模板与标注者隔离、多人独立意见与复核失效、固定版本合并发布、恶意Skill ZIP不执行/不落盘展开且能比较包成员。仅靠演示界面或项目介绍不判通过。本次未发现上述七个项目的官方资料证实最后一条完整安全工作流。

## 源码提交准备的只读审计

本次未提交Git、未删除文件或修改代码。运行目录和真实数据不进入研究文件；实际命令与敏感路径细节只反馈给主线程。

| 项目 | 已确认结果 | 提交前处理 |
| --- | --- | --- |
| 运行数据排除 | `.data/`、`node_modules/`、各层`dist/`、根`.env`已忽略；`infra/oxen/.gitignore`另排除bin/downloads/data/logs/repos/config/run及local.env，已用`git check-ignore`核对 | 保留忽略规则，暂存前继续看完整文件清单，不强制加入运行目录 |
| 私人机器路径 | 初审发现环境示例、导入辅助脚本默认目录及少量历史验收文档含本机盘符/用户目录；本次已将两处用户桌面样本路径替换为占位符，主线程已处理环境示例并负责脚本参数化 | 历史记录保留操作事实，机器路径用`<本地样本路径>`表达；不把机器路径误认为凭据泄露 |
| 凭据模式 | 对待提交文本做私钥/GitHub/OpenAI token/Authorization/签名URL模式扫描，未发现高置信命中；测试中的固定owner-token是合成断言数据 | 这是有限模式检查，不是完整秘密扫描认证；尤其不把`.env`、local.env或运行回执强制暂存 |
| 截图与可见DOM | 共90张图片；本次重点抽查8张，7张可辨认为合成样本/模板或仅元数据，1张旧离开确认背景模糊且显示真实导入项目名。未在这些抽查中发现可读的真实样本正文；未逐张背书全部90张 | 历史`docs/evidence`和整个SaaS原始captures仅本地留存；只将已确认合成的R7/R8证据列入源码交付白名单，由主线程维护Git忽略/例外。账号、私有项目等元数据也纳入这项分离 |
| 仓库状态/许可 | `git ls-files`当时仅有README，其余项目目录尚未纳入；未找到本项目根LICENSE/NOTICE | 确认完整源码清单和本项目许可/第三方声明后再提交，不能只提交README或将“无许可证文件”当作自动开放授权 |

以上审计只覆盖可提交工程与文档，不读取四个真实仓库记录，不将样本包、攻击正文或凭据拷入知识库。截图检查保留抽查范围与不确定性，未把“没有看到问题”写成全量隐私验收通过。

源码与本地研究档案分别交付：旧文档继续保存真实调研结论，引用的历史截图/DOM可在本机查阅，但不保证公开clone包含这些原始附件。对外可复现材料采用合成夹具、脚本、测试及白名单证据；排除历史附件不等于把它们重新认定为安全，也不改写旧验收结果。
