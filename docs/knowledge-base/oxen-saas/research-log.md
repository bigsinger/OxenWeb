# 调研日志

## 2026-11-08：登录后产品与交互快照

来源是已登录的 `bigsinger` 合成私有项目。实际执行了创建项目、用户手工上传5份合成文件、JSONL预览、workspace新增Text列与commit、SQL/NL条件筛选、单条详情、四类预览、文件历史与结构化diff、分支创建/切换；权限设置只读观察。23组截图/DOM与精确提交记录见 [登录后快照](../../saas-logged-in-snapshot.md)。没有把用户真实2,000条样本上传到SaaS。

异常单独记录：非空 branch compare 多次上游错误；commit diff summary 部分错误，但单文件diff可用。本地独立MR/规则或模型计划/三级标签有自己的验证，不能代替未观察到的SaaS原生行为。

## 2026-11-08：界面一致性复核与知识库建立

用户指出当前浅绿侧栏布局简陋，要求风格、布局、板块、内容与操作尽量参考SaaS。先复用已有23组证据，仅补核4个设计缺口：

| 记录 | URL/角色/动作 | 观察结果 | 证据 |
| --- | --- | --- | --- |
| R24 | 项目所有者；进入私有项目根目录 | 顶部项目切换、项目masthead、Manage project/Developer tools、分支/列表/文件及commit条 | captures/2026-11-08/repository-layout.jpg / .txt |
| R25 | 同页打开Developer tools | Branches、Merge Requests菜单；管理与开发入口在项目右侧同一区 | developer-tools.jpg / .txt |
| R26 | 同页打开Manage Files，仅观察后关闭 | Upload files、Add folder、Create Dataset；未上传或新建内容 | manage-files.jpg / .txt |
| R27 | 打开sample.jsonl，仅观察 | 查询输入38px高/14px文字、项目标题32px/600、Resource path、图标动作、History和表格总行数 | dataset-resource-toolbar.jpg / .txt |

计算样式还观察到：SaaS字体为Inter及系统fallback；顶部控件#333、14px、12px圆角；管理按钮12px/8px圆角；紫色主按钮#712acc。本地参数选择与观察值分列，见[设计系统](design-system.md)。不读取SaaS编译源码。

实现决策：把本地固定侧栏改为顶部导航/项目切换，项目管理与版本入口归组；文件默认列表并保留辅助树；查询/编辑/标注/历史携带同一文件上下文；深色tokens贯穿所有页面。保留真实存储/权限/版本保护；技术实现说明移到可展开帮助，不充当用户主流程内容。

本轮没有新的SaaS写入，不改原生权限、默认分支或云数据。后续开发从此知识库检索页面和证据，只有缺口才追加针对性观察，不重新全站调研。

本地实现已统一为深色顶部导航、项目资源层级和同上下文操作。最终浏览器验证及本地截图见[界面改版与验证](../../ui-redesign-2026-11-08.md)。本地验收标签写入只发生于合成项目，云端观察与本地验证独立记录。

## 2026-11-08：全量实现审计后的定向复核

用户要求重新检查完成情况，并将图片/音频/视频样本管理移出当前版。复用冻结快照的11个页面目录和既有证据，逐项审查本地实现、限制、测试与缺口，见[完整性审计](../../completion-audit-2026-11-08.md)。这不代表重新执行云端写入验收。

R28：所有者角色，在 `https://www.oxen.ai/bigsinger/oxen-web-acceptance-20261108/database/main/sample.jsonl` 打开 Dataset actions，仅见 Run inference/Fine-tune a model（本版范围外）；打开 Download，先显示 Preparing download，随后显示 Download file。没有点击最终下载，没有新增云端数据或权限操作，也没有由此推断其他页面不存在模板功能。证据：[菜单截图](captures/2026-11-08/dataset-download-recheck.jpg)、[完整可见AX](captures/2026-11-08/dataset-download-recheck.txt)。

本地模板与ZIP查看是用户需求驱动的独立扩展，记录在[AI安全知识库](../ai-safety/README.md)，不写成SaaS事实。SaaS分支比较和部分提交摘要的历史错误仍保留，不改写为通过。

## 2026-11-08：R1/R2 用户确认方案的本地实施验收

此项是本地实现记录，不新增 SaaS 观察。复用上面的冻结知识库，按用户两轮确认调整导航、标签治理与数据编辑、任务/复核、Releases。角色包括实例所有者、独立的两位合成标注者和另一位复核者；入口为本机 `127.0.0.1:5173` 的独立合成 QA 与构建后的 `127.0.0.1:3001`。

已在浏览器观察 ZIP 识别/映射/提交、模板发布与采用、分支自动加载、四选项草稿恢复、三级标注/ZIP 实际文本差异、任务独立复核和无权身份隐藏治理入口。证据只含合成内容，见 [浏览器记录](../../browser-r2-2026-11-08.md) 和 `../../evidence/r2-2026-11-08/`。组件映射更新于 [交互目录](interaction-catalog.md)，新架构和测试结果更新于 [R1/R2 实施记录](../../implementation-r2.md)。

浏览器自动审批拒绝了本机快照 ZIP 的实际下载，此项保留为未通过；没有绕过审批，API 验收不能替代浏览器下载。官方 Oxen 0.67 的独立合成链路已另行完成真实 CLI 合并、发布包 SHA 校验与再导入，见 [官方联调](../../r2-live-acceptance-2026-11-08.md)。本轮没有上传真实样本到 SaaS，也没有改动官方 server 或内核。
