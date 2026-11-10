# 自动化回归入口

测试分为已有服务/纯函数回归、官方 Oxen 联调、浏览器真实交互。默认回归和新增R10场景使用独立合成夹具，不读取桌面 benchmark；7项显式关闭的历史live用例中有3项依赖用户原始样本或历史固定commit，不能混为合成通用门禁。任何路径均不执行 Skill，不将真实数据或凭据写入报告。

## 命令

```text
npm ci
npm run build
npm test
npx playwright test --list
npx playwright install chromium
npx playwright test
```

`--list` 只验证发现与加载，不启动浏览器或服务。运行浏览器命令会调用 `scripts/r10-e2e-server.ts` 创建本机3005/5173的独立 Demo BFF/Vite，已有端口占用即拒绝，不接管、停止或改写现有服务。命令仅在CI或获准的本机标准Playwright环境使用；当前Codex机器的浏览器验证通过已启用的CUA执行，不在shell启动额外浏览器。

夹具持久在被Git忽略的 `.data/r10-ui-qa/`。首次执行建立12条合成样本，追加导入使用 `tests/e2e/fixtures/append-synthetic.jsonl` 两条惰性文本；最后测试会生成一份合成工作快照并实际下载。重新验收应在独立checkout或经过核对的全新合成目录中执行，不能通过盲目删除计算路径来重置数据。

## 同一套浏览器步骤

`tests/e2e/scenarios.mjs` 不创建浏览器、不请求HTTP API、不读取应用内部状态。它只调用传入的页面适配器：goto、getByRole/getByLabel/getByText、locator、只读DOM evaluate、可见/隐藏等待、filechooser和download。

- CI：`createPlaywrightScenarioAdapter(page)`，由 `workspace.spec.ts` 调用。
- 当前CUA：`createCuaScenarioAdapter(existingTab)`，由主线程在CUA运行同一个scenario。需要重新加载已导入模块的新导出时，使用新的file URL查询版本，不能把旧模块缓存当作新测试。
- `tableScenario`：全部已配置与系统表头、14/12px、序号直接切换、正文选择/双击取消、表格宽度、选项颜色、真实时间排序/过滤。
- `managementScenario`：管理员访问、本人令牌、操作日志页面、无原始token、无匹配筛选和布局；不发放任何真实权限。
- `readmeScenario`：编辑→高亮diff→明确提交入口；最后还原原文，不产生README commit。
- `transferScenario`：实际文件选择上传、预览、明确追加提交、工作快照构建、实际浏览器下载。调用者提供绝对合成JSONL路径；返回downloadPath供本地只读校验，不能用API下载代替浏览器成功。

每个UI动作后读取页面可见结果，关键异步步骤等待真实表格、空状态或资产。CI下载验证读取已完成的本地ZIP，核对所有校验和、条数、导入记录与系统操作列未混入样本。ZIP只在内存中按边界读取，不解压执行。

## CI与证据边界

GitHub工作流先完成固定契约生成、构建和现有回归，再执行官方0.67的合成权限联调，最后运行上述浏览器回归。只有相应job实际运行通过才可报告CI验收；本地发现5个测试并不能代替执行。

浏览器默认关闭trace/video，避免保存Cookie、签名URL或凭据。失败截图仅限合成页面，输出在 `.data/e2e-results/`，HTML报告在 `.data/e2e-report/`；CI只保留该合成报告，不上传 `.env`、控制面JSON、actors.json、真实样本、服务配置或整个 `.data`。上传/下载若被浏览器审批拒绝，必须记录为未通过，不能以按钮出现或后端API通过代替。

R10实际执行结果由项目最终实施/验收文档及 `.data/r10-evidence/` 回执记录。本文件描述可运行入口，不宣称尚未运行的CI或浏览器步骤已经通过。

2026-11-08 本机CUA实测：共享表格场景、管理页面场景和README差异撤销场景通过；真实文件选择上传两条JSONL、预览、明确提交及14条样本的工作快照构建通过。该快照下载事件被浏览器安全审批拒绝，下载仍未通过，等待用户对具体本机合成ZIP操作的答复；没有重试、换方式下载或把API结果代替下载成功。CI仅完成 `--list` 的5项发现，尚未远端执行，不能标为5项全部通过。事件等待立即附加拒绝处理，保留原错误再交给调用者，避免审批拒绝变成未处理Promise并重置CUA环境。

## 最终默认回归及7项live跳过的准确含义

R10最终本地 `npm test` 日志 `.data/r10-tests-complete-final.log` 实际为 **396项、389通过、0失败、0取消、7跳过**。构建、前后端类型与固定契约无差异均通过。7项全部由各自 `OXEN_*_LIVE_TEST !== 'true'` 的显式开关触发；不是默认静默探测不到服务，也不是允许失败用例。不要将日志中的 `ok ... # SKIP` 算成执行通过。

2026-11-09 R11新增字段导出与版本恢复后，本机最终默认套件及448文件的独立干净源码安装/构建均为 **410项、403通过、0失败、0取消、7跳过**；日志`.data/r11-tests-final.log`与`.data/r11-clean-final.log`。原生恢复可用`npx tsx scripts/r11-version-restore-acceptance.ts --execute`在独立3008执行，默认无参数只输出计划；不触正式3001/3002、不读真实benchmark。字段投影/回导、暂存并发篡改拒绝、未知结果与操作时间证据见[R11验收](../docs/implementation-r11.md)。

本轮明确授权后，对R10原固定合成ZIP的浏览器下载再试仍被自动审批拒绝；未获得落盘证据，已保留原页面请求用户手动下载，没有改用新功能夹具或其他通道取该文件。字段/恢复浏览器场景在独立夹具验证，不把服务端ZIP回导当作这次浏览器下载通过。

| 开关（设为true才执行） | 文件 | 额外前提与覆盖 | 默认门禁处理 |
| --- | --- | --- | --- |
| `OXEN_AUDIT_LIVE_TEST` | `consistency-audit-live.test.ts` | 受管官方0.67与本机连接配置；新建合成冲突库，验证目标HEAD保持、原生合并预检及不额外配置CLI clone | 可在独立服务单独执行；本轮默认仍跳过 |
| `OXEN_LABEL_LIVE_TEST` | `labels-live.test.ts` | 还需明确提供 `OXEN_SAMPLE_FILE`；断言用户文件恰有2000条/14列，并使用历史 `local/prompt-injection-bench` 路径及测试分支 | 真实样本历史回放，不能在公开CI隐式开启或上传用户数据 |
| `OXEN_LIVE_TEST` | `live-integration.test.ts` | 官方0.67、CLI与seed生成的 `local/visual-search` 文件布局；验证预览、实际CLI commit/merge/push、查询及扩展持久化 | 需要专门原生环境及固定夹具，默认不执行 |
| `OXEN_MERGE_REQUEST_LIVE_TEST` | `merge-requests-live.test.ts` | 官方服务/配置；自建合成库，验证MR比较、评论、真正合并及BFF重启 | 可作为独立原生协作门禁；不是默认套件中已执行通过项 |
| `OXEN_SETTINGS_LIVE_TEST` | `settings-access.test.ts` | 官方服务/CLI/配置；自建合成私有库，验证版本化策略、角色、撤权及默认分支 | CI `native-contract` job仅明确启用这一项，必须job实际成功才能报告原生权限通过 |
| `OXEN_TABLE_LIVE_TEST` | `table-editor-live.test.ts` | 历史2000条 `prompt-injection-bench` 项目与源文件；在新分支做正文/列/追加及标签保持、陈旧版本拒绝 | 属于依赖历史用户样本的回放，需核对前提和授权后独立执行 |
| `OXEN_TABULAR_DIFF_LIVE_TEST` | `tabular-diff-live.test.ts` | 依赖历史CSV/用户JSONL项目的四个源码固定提交hash，不是新机器seed能复现的任意提交 | 保留历史证据入口，不作为干净checkout通用门禁；不能替换hash为无差异来凑通过 |

上述3个依赖用户样本/固定历史的用例不是当前合成CI的输入。保持来源、角色和授权边界，先读用例前提，再向**隔离的受管官方服务**提供配置；不要为开启开关而把本机真实数据带进CI，也不要盲目将7个开关一起打开。执行命令形式为明确选择一个测试文件并仅设置其对应开关，例如在已准备的原生合成环境中：

```powershell
$env:OXEN_SETTINGS_LIVE_TEST='true'
npx tsx --test apps/server/test/settings-access.test.ts
Remove-Item Env:OXEN_SETTINGS_LIVE_TEST
```

这里只给可复现入口，当前docs-only审查没有执行这些额外live用例或停止任何服务。R10新增 `scripts/r10-backup-acceptance.ts` 的独立官方3006/3007、12条合成恢复实测另有回执，已验证旧凭据401、原actor再发取回草稿与输入、固定HEAD/原JSONL/ZIP/模板/任务/MR/快照资产；它不能自动把上表7项都改成通过。

## 放行时各类证据分开计算

1. **源码契约/构建/默认回归**：本轮已通过；386/379/7的数字保持原义。身份及UX分组矩阵见 [访问与审计说明](../docs/access-and-audit-r10.md)。
2. **官方原生行为**：给出实际合成脚本、官方版本、独立实例、记录结果；Linux CI `native-contract` 尚未远端运行，不能引用Windows历史观察替代该job。
3. **实际浏览器**：共享3个场景已由CUA执行；上传/提交与构建通过，下载仍须有真实成功文件与校验后才能放行该项。`playwright test --list`通过不算5个场景执行通过，桌面成功不自动证明完整窄屏/键盘/错误组合。
4. **运维与容量**：RPO/RTO、异机/离线副本、key可获取、维护窗口和4用户容量按总验收的实际环境/计时/字节核对；单元测试、12条恢复或1000条正确性用例不能替代生产规模目标。

根因修复后的首次失败记录应保留：本轮曾发现并发grant旧HEAD冲突及Demo逐文件耐久存盘导致1000条用例超时，修复后重新完成全套回归。未执行、审批阻塞、环境前提缺失与已失败应分别记录，不合并成“全绿”。

S02实例身份恢复补齐的独立专项：`npx tsx --test apps/server/test/access-management.test.ts` 实际12/12通过。新增2项包含真实合成 `createColdBackup`/`restoreBackup` 后原globaladmin凭据全部失效、bootstrap按原actor/原角色重发并读回其私有草稿/UI检查点；其他实例管理员与bootstrap不能读该actor的私有输入，旧凭据持续401，HEAD保持。另覆盖项目人员与随机UUID不能冒充实例人员、项目管理员不能发实例权限、已有人员名称可信及禁止隐式角色/kind迁移。该专项在上面的全量回归之后加入，最终总数须采用其后实际重跑日志，不能把专项结果与旧全量数字相加当作已经执行。

S02前端凭据上下文专项：`npx tsx --test apps/server/test/access-context-client.test.ts apps/server/test/dataset-navigation.test.ts` 实际9/9通过，新增6项使用真实Vue watcher和QueryClient验证同步清空、取消迟到请求、同actor不同scope的缓存隔离、普通页面key变化、Access自轮换一次展示及迟回保护。`npx vue-tsc --noEmit -p apps/web/tsconfig.json`通过；没有运行build或更新dist。普通身份切换的既有整页reload保留，草稿持久principal未改变；实际多标签页与改后管理路由的浏览器复验需要总验收另行给出证据，不能将这些状态/竞态单元测试写成浏览器通过。

R12补充：发布分组独立存储，不注入源记录或安全判断；用途选择不代替专家复核。`dataset-evaluation.test.ts`、`tiered-release.test.ts`及`r12-tiered-real-workflow.test.ts`覆盖草稿/CAS、双权限、sticky策略/故障对账、真实标注复核合并、四集合、所有包成员canary、README及原表附件旁路、隐藏资产/旧外链拒绝、曝光永久记录、旧版本恢复与同代冷恢复。`dataset-evaluation-ui.test.ts`覆盖真实基线的同值修改标记及Vue恢复时序。最终全量441项、434通过、7条件跳过；跳过项不计作通过。官方服务另用`node --import tsx scripts/r12-tiered-acceptance.ts --execute`独立3008合成演练，默认不带execute只输出计划；不碰正式3002。详细回执与浏览器边界见`docs/implementation-r12.md`。
