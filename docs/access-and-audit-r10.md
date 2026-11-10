# R10 身份、权限、令牌与全局操作日志

日期：2026-11-09。实现范围仅为本项目的 Web/BFF，使用现有 Oxen 仓库策略文件及本地控制面，不修改官方 Oxen server、内核或 OpenAPI；上游监听和网络隔离仍由部署方维护。

## 使用入口

- 全局“访问管理”：实例管理员可管理全部已发放令牌；项目权限管理员只能管理其当前令牌范围内、仍有管理权限的项目。创建项目令牌时选择项目、人员和角色，默认有效90天，可选择7–365天。
- “我的访问令牌”：查看当前身份在当前授权范围内的凭据，以及由本人发放、仍可管理的令牌。实例引导凭据 `BFF_TOKEN` 不在此列表显示或复制，继续通过部署配置维护。
- 已有项目的角色与独立能力继续由“项目设置 → 用户与协作者”维护。全局目录显示当前项目角色并链接到该设置；项目管理员并不因此成为组织标签字典维护者。
- 全局“操作日志”：仅实例管理员和明确授权的审计人员可见。可按操作类型、人员、项目和时间筛选，分页展示宏观动态。审计人员的实例令牌不会因此获得私有项目数据读取权。

新令牌只在创建/轮换成功时显示一次，服务只保存哈希。无法从目录复制任何人的历史原始令牌。离开仍有一次性令牌的页面会提醒保存，但不会把令牌写进检查点、日志或源码。轮换本人当前令牌会先使用新凭据建立会话，保留同一个人员身份，再刷新目录；旧令牌和旧会话立即失效。

## 身份与范围

人员身份 `actorId` 与认证凭据 `credentialId` 分离。为已有人员发放新项目令牌、或轮换令牌，保留稳定 actor ID，不把其历史意见记成另一个人。

每个项目令牌的 `scope` 是实际授权边界：同一人持有项目A和项目B两个令牌时，A令牌不能读取、编辑或管理私有B，也不能经个人令牌接口取回、轮换或撤销B令牌。项目移除成员只撤销该项目的 membership 和该范围的凭据，其他项目的合法令牌仍有效。实例管理员范围会明确说明覆盖所有当前及未来项目，是单独发放的实例角色，不能由项目管理员发放。

为已有人员发放同项目令牌时，下方角色是实际采用的项目角色；已有成员可按本次选择更新，界面会就近说明。角色及独立能力变化仍生成版本化策略与宏观审计事件。

对早期没有 `scope` 的本地凭据，启动时只在读取现有项目策略后、恰好找到一个 membership 的情况下确定范围并持久化；找不到或多匹配时不猜范围，不授予私有项目权限，交由实例管理员明确重新发放。该处理不修改源样本、标注意见或 Oxen 原生 ACL。

整体恢复撤销凭据后，管理员仍可从已知历史人员中选择原 actor，重新发放明确项目范围的新凭据。若 membership 和角色未改变，该操作不推进仓库 HEAD，因此保留的私有草稿与检查点可继续按原 actor 和基点核对，不需要创建“同名新人员”来替代原人。

实例人员也支持同身份重发：在“访问管理”选择“实例级权限 → 为已有实例人员重新发放同角色令牌”。目录包含已撤销的原实例人员，显示名称取可信历史记录，原实例角色只读；重新发放需要再次明确确认实例权限。服务端只接受已知原实例人员，项目管理员、仅有项目身份的人员及任意UUID不能借此获得实例权限。重发保留原 `actorId` 和 `owner/collaborator` 身份类型；更换实例角色返回409，不迁移私有文件命名空间。新凭据独立生成，旧凭据持续撤销。

凭据到期和撤销同时作用于 Bearer 与已有会话。无效认证材料不会回退为本机 owner。团队模式 `BFF_TEAM_MODE=true` 禁用无凭据的 loopback owner，启动必须配置引导凭据；日常标注、复核使用独立受限令牌。恢复工具将备份中的成员凭据统一撤销，保留身份而不复活历史 token；不恢复旧浏览器会话。

### 界面的凭据上下文

显式“切换身份”本来就会整页重载，退出会跳转公开项目。本轮补齐了另一个实际入口：同源标签页共享会话，另一标签页换成同一人员的另一项目凭据后，原标签页“刷新连接”虽然取得新的 `credentialId`，旧实现仅比较actorID，会留下此前页面与缓存。

现在界面授权上下文采用 `kind + actorId + credentialId`。取得不同凭据的状态后，项目、日志、操作核对等普通页面重新挂载；项目Query缓存按完整上下文隔离，旧请求取消并移除，列表请求传递AbortSignal。全局项目、治理能力、访问能力先同步清空，并按上下文和请求代次拒绝迟到响应。旧提示、搜索和待确认操作同步关闭。跨标签页登录本身没有新增广播机制；此修复保证在本页读取到新身份状态后，不继续展示上一凭据的内容。

访问管理和本人令牌页面保留同actor组件实例，避免自轮换把新令牌的一次展示直接卸载；这些页面仍在完整上下文变化时同步清空旧目录、表单及原始令牌。自轮换仅在新会话身份与返回的credentialID吻合、完成Vue清理周期后显示新值。前一凭据请求迟到时，不自动登录、不展示新token；发放和撤销的过时完成也不回填当前页面。私有草稿、检查点的持久owner key继续是原 `kind:actorId`，没有把认证凭据写入私有身份或移动文件。

新增 `access-context-client.test.ts` 的6项与既有 `dataset-navigation.test.ts` 的3项联合实际 **9/9通过**：真实Vue同步上下文重置、真实QueryClient取消迟回且A/B缓存隔离、头部旧scope和同scope旧请求拒绝、自轮换一次展示与外部换scope后清除、旧scope轮换结果不自动登录、未验证新会话不展示。Web `vue-tsc --noEmit`通过；该专项不是实际双浏览器标签页验收，浏览器复验由本轮总验收另行记录。

## 服务端保护

`RepositoryAccessService` 验证真实角色、能力、凭据范围和有效性。全局令牌管理对人员归属、原发放者、当前项目管理权限及实际 token scope 做检查；失去项目管理权后不能继续轮换曾发出的凭据。现有项目访问路由与新的全局入口共用同一服务。

项目策略变更在进入串行更新和实际 commit 前重新检查管理员权限。中途被撤销或降级，不产生新的策略提交；受控临时 workspace 清理仍保留。审计仅在成功变更处写入，撤销已经撤销的凭据不会重复产生宏观事件。

`access-credentials.json` 继续使用 version1，新增可选的稳定 actor、发放者、到期、scope 和实例角色元数据；持久写使用 `durableWriteJson`。新增 `global-audit.json` 与凭据、仓库策略一并进入整体备份清单。日志保留90天、最多10万条期间记录，满额明确报错，不静默删除期限内事件。

宏观日志只记录事件ID、发生时间、动作、actorID/名称、项目、对象ID及受限标量详情；不记录样本正文、原始查询、Cookie、token或附件内容。身份服务记录项目授权、角色变化、项目撤权、实例角色发放和凭据轮换/撤销；项目创建/移除/恢复、Release、治理和重要配置由应用白名单钩子记录。不会为过去没有日志的动作伪造历史。

## 本地 BFF 接口

| 接口 | 用途与权限 |
| --- | --- |
| `GET /api/access-management/capabilities` | 当前身份可见入口标志，不代替服务端实际授权 |
| `GET /api/access-management` | 管理范围、可选择人员、项目和不含秘密的凭据摘要；要求实例/项目管理权 |
| `POST /api/access-management/grants` | 新人员或已有人员的项目令牌；实例管理员也可明确发放 administrator/auditor |
| `GET /api/me/access-tokens` | 当前身份与本人发放、且在当前范围内的凭据摘要 |
| `POST /api/me/access-tokens/:id/rotate` | 相同人员/范围的新凭据，立即撤销旧凭据，仅成功当次返回新 token |
| `POST /api/me/access-tokens/:id/revoke` | 撤销单个凭据，不删除人员历史意见 |
| `GET /api/audit-events` | 管理员/审计员读取筛选分页日志 |

这些是本地扩展，不能作为 Oxen 原生认证能力宣传。敏感凭据响应不进入操作结果 journal；权限动作通过无秘密的 audit 和凭据状态核对，不为重放而持久化原 token。

## 验证记录

新增 `apps/server/test/access-management.test.ts` 的10项风险用例覆盖：仅哈希/元数据列表；发放者及到期；稳定身份轮换与旧会话失效；同人跨项目范围、个人接口防扩权及独立撤权；标注员/项目管理员不可发实例权限；失去管理权不可管理旧发令牌；实例管理员撤销与自轮换；审计只读无项目数据权；过期与本机回退保护；提交前权限重查；宏观日志落盘、筛选、分页和秘密字段拒绝；并发发放的最新策略串行与显式CAS；恢复后的历史actor再发。

S02恢复闭环审查随后发现并补齐原实例人员的重发缺口。该文件新增2项后单独实际执行 **12项全部通过**：拒绝项目人员/任意UUID伪装实例身份、拒绝项目管理员重发实例凭据、可信名称与原角色锁定；真实合成冷备份/恢复统一撤销原实例管理员凭据后，由bootstrap为同一actor重新发放，恢复原私有草稿及非法JSON界面检查点，另一实例管理员和bootstrap均读不到该人员的私有输入，旧token仍401且仓库HEAD不变。全量回归数字应以此补齐之后的总验收日志为准，此处12项是专项执行结果。

完整生产代恢复脚本现在从指定备份代读取控制面基线，并通过隔离副本的实际BFF接口逐项核对任务/复核fingerprint与proof、MR、Release资产和回收状态。私有状态用原actor的同角色临时凭据验证完整读回和跨actor隔离，包括 `owner:UUID` 实例管理员；全部验证凭据最终撤销。已在备份前真实撤销、到期或失去membership的历史身份不会自动恢复权限，另列受保护历史数量；不得把文件SHA通过误报为这些身份已通过API读回。

实现过程早期（并发发放/恢复人员两项专项加入前）联合运行 `access-management.test.ts`、`settings-access.test.ts`、`governance.test.ts`：当时19项，18通过、0失败、1个既有 live 项默认跳过，日志 `.data/r10-access-tests-final.log`。前后端类型检查通过，日志 `.data/r10-access-webtypes.log`、`.data/r10-access-servertypes.log`。这些是模块与路由回归，不冒充浏览器交互、上游隔离或整体恢复演练已经完成；最终浏览器、官方服务、全量回归和运维演练由R10总验收单独记录。

联合回归随后发现两个实际问题并修复：无显式 HEAD 的同项目并发发放不能拿初始化旧 HEAD 当CAS；现在在策略串行更新中基于最新分支执行，显式提供旧 HEAD 仍拒绝，拒绝的发放不会留下可用孤儿凭据。另一个是演示存储逐条 sidecar 写入都复制并fsync整个约11MB状态，导致原1000条三人协作测试180秒超时。新增可选的 Provider 本地 `writeWorkspaceBatch`，Demo在一次原子耐久变更中暂存全部预校验文件；DatasetService保留全部写前、写后和commit前授权/HEAD检查。官方 LiveProvider未实现该可选方法，继续固定契约的逐文件路径，未修改Oxen内核。

`demo-workspace-batch.test.ts` 的2项验证单次存盘、与逐文件写入结果一致、非法输入及存盘失败后内存/磁盘完整保留旧状态；导入故障测试同步覆盖真实批量边界。最终访问/批量/工作流/目录专项20项全通过，日志 `.data/r10-access-batch-final.log`；原1000条完整协作测试维持规模及180秒上限，实际16.8秒通过，日志 `.data/r10-thousand-batch.log`。这些是合成Demo回归，不能据此宣称官方服务也达到相同时延。

## S02 接口权限矩阵与实际证据

R10最终 `npm test` 实际为 **396项、389通过、0失败、0取消、7默认跳过**，日志 `.data/r10-tests-complete-final.log`。构建和固定契约无差异通过，日志 `.data/r10-build-complete-final.log`、`.data/r10-contracts-final.log`。下表按权限风险分组列出已有自动化的正反例；不是声称做过所有路由×所有角色的穷举，也不能代替上游网络边界配置。

| 边界 / 代表接口 | 应采用的授权及拒绝行为 | 已实际执行的自动证据 |
| --- | --- | --- |
| 登录与撤销：`POST/DELETE /api/session`；受保护读取 | 原始token仅用于认证；过期/撤销Bearer与旧session失效，携带无效凭据不回退本机owner | `access-management.test.ts` 的到期、轮换、管理员撤销与自轮换；`settings-access.test.ts` 的重启、旧会话、无效凭据回退拒绝 |
| 私有项目目录、原件：`GET /api/repos`、项目/file/raw | 匿名或无项目身份不读取私有库；公开访客只读，不能写 | `settings-access.test.ts` 的公开/私有目录过滤与viewer/editor/admin钩子；`consistency-audit.test.ts` 的工作区与私有job读取边界 |
| 实际项目scope | 同actor的A凭据不能读取私有B，也不能经个人凭据管理轮换/取回B凭据 | `access-management.test.ts` 同人双项目、个人接口防扩权、A项目撤权不影响B，包含直接服务与HTTP请求 |
| 项目策略：`PATCH .../settings`、项目PATCH | `project.admin`；普通编辑不能经通用文件/工作区间接修改策略；进入更新及commit前终检 | `settings-access.test.ts` 间接策略绕过拒绝；`access-management.test.ts` 写中撤权后无commit/无残留workspace；`repository-management.test.ts` 固定标识、CAS与源内容保持 |
| 项目成员：`POST/PATCH/DELETE .../access[/id]` | 当前管理员管理本项目；能力不包含组织字典维护；显式旧HEAD拒绝；无显式HEAD并发发放不丢其他成员 | `access-management.test.ts` 三个并发发放、过期CAS、角色降级后失去旧凭据管理权；`settings-access.test.ts`角色变化立即生效 |
| 全局发放：`POST /api/access-management/grants` | 项目管理员只能发管理范围内的项目角色；仅实例管理员可发administrator/auditor | `access-management.test.ts` 普通人员/项目管理员实例扩权403、审计员只有日志读权、摘要不含token/hash |
| 本人凭据：`GET /api/me/access-tokens`；`POST .../:id/rotate/revoke` | 当前范围、actor、原发放者及仍有效的项目管理权同时校验；轮换保留actor，不扩scope | `access-management.test.ts`他人令牌拒绝、同人跨scope拒绝、自轮换、全局撤销、历史actor再发且不推进未变策略HEAD |
| 全局审计：`GET /api/audit-events` | 仅实例管理员/明确审计员；标注员、项目管理员不会自动获得全局日志 | `access-management.test.ts` 403与审计员正例、分页筛选、敏感详情拒绝；`operation-http.test.ts` 只记录宏观动作不记录查询/正文/认证材料 |
| 标签字典/模板/维护者：governance写接口 | 组织治理权限独立于项目admin；普通标注仅消费发布快照 | `governance.test.ts` 组织与项目权限隔离、发布不可变、通用文件/旧接口绕过拒绝；`label-templates.test.ts` 数据权+组织权+CSRF门禁 |
| 正文、赋值、任务复核：`POST .../dataset/save`、tasks提交/复核 | data.edit、annotation.assign、任务条目范围、源身份保护；禁止自审和伪造actor | `workflow-review.test.ts`范围逃逸/伪造actor/非法片段锚点、自审拒绝、取消任务不复活、1000行三人完整分支与独立复核；吞吐以独立容量验收为准，不从1000行正确性或代码上限推断 |
| 私有草稿：`GET/PUT .../dataset/draft`、commit/discard/rebase | actor/project/ref隔离、ID+revision CAS、当前权限/任务范围终检；失败保留草稿 | `dataset-drafts.test.ts`跨身份/项目/分支、撤权、陈旧分支、ABA、提交失败与明确同步；普通读取不授予写入 |
| 原始输入：`GET/PUT/DELETE .../dataset/ui-state` | 撤写后仍可保留本人已有输入，但不能应用；撤读后全部拒绝，不能删除他人检查点 | `dataset-ui-state.test.ts`撤读/撤写、双CAS、非法大输入、HTTP保护；`dataset-ui-state-client.test.ts`并发与删除重建边界 |
| 导入与附件 | 新建库需要owner，追加需要data.edit；预检归属、固定HEAD、来源/身份/附件校验，Skill不执行 | `releases.test.ts`无认证ZIP401、他人预检拒绝、陈旧指纹、实际合成往返及包边界；`dataset-onboarding-order.test.ts`的初始化/追加与来源身份保护 |
| 资产/分享/发布：releases、snapshots、assets、shares | 正式发布需要有效独立复核、固定提交与release能力；私有下载、分享到期/撤销与当前发起人权限继续校验 | `releases.test.ts`过期/撤销分享、撤回与快照、资产篡改和未合并提交、HTTP实际字节、完整校验；`operation-http.test.ts`ready资产不能冒充发布成功 |
| 可恢复移除/恢复：`POST .../lifecycle/remove/restore` | 管理权、完整项目标识与最新revision；普通人员拒绝，移除后的仓库路径410且不泄露回收目录 | `repository-management.test.ts`错误名称422、普通人员403、陈旧状态409、原件与workspace保持、重启后状态保持 |

实际覆盖了 GET、POST、PUT、PATCH、DELETE 的权限/归属拒绝及合法路径。HTTP拒绝与界面隐藏分开验证；“按钮不可见”不算权限测试。没有把所有者共享令牌作为多人协作方案，也没有把BFF权限冒充官方Oxen原生ACL。

隔离官方0.67恢复回执 `.data/r10-recovery/latest.json` 进一步实际验证：2个旧成员凭据撤销、旧token401；显式为原actor重新发项目凭据后，其私有草稿与非法输入可取回，分支、源JSONL/ZIP、模板、任务、MR、Release资产保持。该12行合成验证是本轮独立原生证据，不意味着7个默认跳过的历史live用例已重新执行。

## U01–U08 交互覆盖与未扩大结论

| 编号 | 已实现的交互落点 | 实际证据与验证边界 |
| --- | --- | --- |
| U01 保存层次 | 工作台按钮明确“保存私有草稿/提交到分支”；原始输入、私有预览、复核和发布分别说明，绿色不等于复核 | `dataset-drafts`/`dataset-ui-state`回归证明保留与commit不同；共享表格/README场景实际读取这些界面。没有把仅保存检查点算作已提交 |
| U02 已有快捷键与焦点 | 全局页脚“操作帮助”，按页面列出现有按键；字段Alt移动、序号按钮、Esc/Shift+Enter语义明确 | R10共享表格场景实际双击并Esc取消；其余按键表/焦点恢复已作源码核对，5项共享用例未穷举全键盘与全部弹窗，不声明完整无障碍认证 |
| U03 标签层次与帮助 | 显示适用层、已填数量、维度ID、选项释义；更多维度的已填数量，未填/不确定/不适用区分 | `governance`、`workflow-review`、字段/标签既有回归保持语义和独立意见；本轮共享UI用例未逐个遍历所有领域模板与折叠选项 |
| U04 筛选与批量范围 | 当前页/已选/匹配量分开；提示页外选择不扩范围；实际候选ID和排除数量可核对 | `dataset-cell-editing.test.ts`的候选/删除/权限回归；共享表格场景实际清空未来时间筛选后恢复，不能据此声称全选跨页的全部浏览器组合都已执行 |
| U05 错误与未知结果 | 非法JSON就近中文提示保留原文；网络未知结果提供操作核对入口，不统一自动重试 | `operation-http`实际丢回复重启/对账、actor+method+payload绑定；`dataset-ui-state`/草稿回归保留失败输入。界面错误矩阵不由5项共享测试全部覆盖 |
| U06 版本上下文 | 分支+固定hash、历史只读明确；源字段排序用data.命名空间；diff前版→后版，项目标签全项目共享 | `dataset-navigation`、`tabular-diff`、`text-diff`回归与固定历史元数据测试；共享表格仅main场景，不能当作重新核对全部SaaS历史差异行为 |
| U07 编辑→核对→提交 | README先核对高亮diff再出现明确提交；完整JSON、字段配置和检查点沿用明确保存/取消/恢复 | CUA共享README场景实际改合成输入→新增高亮→提交入口→还原原文，无commit；`repository-management`、`sample-field-checkpoint`与草稿回归保持权限/CAS/恢复 |
| U08 导入与交付步骤 | 导入显示选择/映射/预览/提交，Release显示固定版本/构建/发布/下载真实状态，关闭说明临时预检清理 | CUA真实选择并上传2条JSONL、预览、明确提交到14条、快照构建实际通过；下载受浏览器审批拒绝仍未通过。服务端ZIP/Release/导入回归不是浏览器下载成功的替代 |

以上只改善已存在能力，没有引入新的标注任务类型、自动判断或云服务。最终构建的完整本地体量隔离恢复及三轮容量已通过，详见[总验收记录](implementation-r10.md)。全量自动回归通过不覆盖尚未完成的浏览器下载、异机/离线备份位置核验；这些放行条件须在总验收逐项给出实际结论。
