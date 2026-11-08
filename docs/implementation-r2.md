# R1/R2 完整方案实施与验收

日期：2026-11-08。两轮确认需求已整合实现，统一构建与自动化检查通过；浏览器实际下载和跨设备分享保留下述验收限制。正式本机入口 <http://127.0.0.1:3001/>；四个实际项目可从 <http://127.0.0.1:3001/?q=benchmark> 筛选。

依据为 [已确认整合需求](proposals/dataset-labeling-workflow-v2.md)。仅修改自研 Vue/TypeScript Web、BFF 和本地扩展，未修改官方 Oxen server/内核。云生成、训练部署和图片/音频/视频样本管理不纳入。验收写入全部使用合成项目。

## 同一构建的交付映射

| 需求 | 实现与验证 | 入口 |
| --- | --- | --- |
| 标签治理与打标分层 | 指定组织维护者维护维度、释义、选项、领域模板和不可变发布版本；普通标注者入口隐藏且路由/API拒绝，缺项走反馈 | 全局标签管理 / governance |
| 导航和逻辑数据集 | 项目/公开项目/标签管理同级；项目六个主Tab；README概览独立，分支自动加载完整条目，无加载文件/数据库选择，旧标注/查询链接重定向 | App / RepositoryView / DatasetOverview |
| 样本编辑与标签 | 稳定ID正文覆盖，源真值/基线保持；逐操作者三级标签、字符片段/步骤，分歧与旧意见保留，完整检索/本机查询 | DatasetWorkbench / dataset-storage |
| 模板与旧项目 | 固定采用发布模板，活动任务不自动升级；多表旧项目可一次性配置入口、身份和附件，保留源字节/旧标签 | Settings → 标签模板/数据集配置 |
| 草稿保护 | 提交、保留草稿、放弃、取消四选项；浏览器会话恢复检查身份/项目/分支/基线/规范；离开和切身份保护 | Workbench / app store |
| 分工与复核 | 1000条按334/333/333分工；另一人复核；可选独立双标、模板表单仲裁；内容/ZIP字节/规范变化使复核失效 | TaskPanel / TaskContextBanner / workflow |
| MR与冲突恢复 | 唯一共同基线→源提交的变更预览，固定目标头防并发；官方CLI合并；冲突先恢复至源分支，重新复核，保留双亲血缘 | MergeRequestPanel / MergeResolutionPanel |
| ZIP导入与比较 | 网页识别→映射→预检→一次提交；逐Skill ZIP、原包/来源保留，不执行或递归展开嵌套ZIP；真实成员SHA与小文本逐行差异 | ZipImportDialog / ArchiveDiff |
| 完整发布与快照 | 草稿→构建→核对→发布，固定commit、不可变资产，预发布/最新/撤回/勘误；完整样本/标签/片段步骤/模板/README/变更/附件ZIP及再导入；工作快照独立 | ReleasesPanel / releases |
| 私有分享 | 签名固定版本链接，期限/撤销/当前权限校验，不自动开放本机网络 | release-routes |
| 样本数 | 卡片与列表在总大小前显示默认分支固定提交的逻辑条数，未知为—，不拿文件数替代 | RepoSummary / RepositoriesView |

## 最终检查

- `npm run build`通过：Vue与BFF类型检查、Vite生产包、TypeScript BFF编译。Vite仅有既有组件同时静态/动态引用的拆包提示。
- `npm test`：**158项，151通过，0失败，7项显式真实环境用例默认跳过**；跳过不计通过。完整日志为忽略文件`.data/r2-final-tests.log`。
- 专项覆盖鉴权/撤销/请求版本、治理/模板、稳定身份/旧格式、锚点、旧JSONL和高级workspace防任务旁路、发布失败恢复/资产清理/分享撤销、ZIP安全/完整往返、共同基线及双亲。
- Demo/BFF的1000条完整工作流：三名执行者334/333/333各写入，另一名reviewer复核，三次合并后有效赋值和采纳结果均1000、任务均merged、原JSONL字节不变。这不是对真实benchmark的人工作业结论。
- 官方Oxen0.67完整链路：6条/2ZIP，两位执行者及另一复核者，正文/三级标签/Unicode片段/步骤→MR→两次CLI合并→固定提交发布→15成员完整校验→新库再导入保真。最终commit `778c90d8765b5189c20ad2521babf23a`，包SHA `5765ffd3f420728cc9b99c3b773a51de5de630d6378a77f413078da7bd48f3be`。另有真实1000条分配验证，不把仅分配写成全量真实审核完成。
- 浏览器已验证ZIP全流程、模板另存/发布/采用、分支自动条目、草稿恢复、普通标注者治理隐藏/直达拒绝、独立复核/MR、ZIP文本差异、加载/空状态与390px窄屏。[浏览器记录](browser-r2-2026-11-08.md)保留实际截图和未通过项。

## 真实四库只读回归

新构建BFF以live模式运行于3001且健康ready。卡片API与数据编辑API条数一致，只记录数量和提交，没有保存源记录正文。原有数据集级配置保留，未新增真实条目或文件的测试赋值。

| 项目 | 样本数 | 当前main提交 |
| --- | ---: | --- |
| benchmark-sensitive-data | 2000 | `8e5048e44b326026b171e0be8473ecc3` |
| benchmark-behavior-drift | 1719 | `67274cf4a266c6c8f919930fa19c561` |
| benchmark-prompt-injection | 2000 | `9bf7a63f224eaea012986f0b6fc01531` |
| benchmark-skills | 1000 | `12acf2740484ee521bdd64244ae8724b` |

总计6719条。真实四库提交不变，Skill原包与每样本ZIP结构保留。

## 验收边界与运维

浏览器自动审批拒绝了本机快照ZIP的实际下载，该来源未获文件下载权限；没有绕过。因此**浏览器实际落盘下载未通过**，需用户在页面手动点击验证。独立合成包的API传输、SHA及再导入通过，不能替代该项。

分享期限/撤销/权限已测，他人设备可达下载未验证。本版保持回环运行，没有开放公网、改网络或向他人发送链接。完整ZIP导入/导出上限64MiB，超限明确失败不截断；完整扫描上限250000条。组织维护授权、任务、MR、发布及资产属于BFF控制面，需与Oxen仓库一同备份。

## 联调修复与知识沉淀

保持生成契约，修复wildcard多级路径编码；创建分支使用服务支持的现有分支并两端核对固定头；复核文件平铺且分叉前要求共同托管根，规避官方目录树索引问题；标注文件名单一完整SHA缩短Windows路径，兼容旧记录和审计。缺失/不一致/损坏/超限继续显式失败，不过滤错误冒充通过。

证据：[官方链路](r2-live-acceptance-2026-11-08.md)、[原生冲突恢复](verification-r2-native-merge.md)、[复核目录树](verification-r2-proof-tree.md)、[MR共同基线](verification-r2-merge-request-base.md)、[一次配置](dataset-configuration.md)、[Release/ZIP](releases-zip-r2-verification.md)。

映射已同步[SaaS冻结知识库](knowledge-base/oxen-saas/README.md)及[AI安全知识库](knowledge-base/ai-safety/README.md)。SaaS事实、官方能力、本地扩展、未通过项分别保留，不宣称无条件100%复刻。
