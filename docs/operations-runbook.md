# 单实例运行、备份恢复与故障对账

更新：2026-11-10，R22；备份及恢复基础记录始于R10，后续追记保留当时事实。本项目只扩展 TypeScript Web/BFF 和运维工具；官方 Oxen 0.67.0、内核、存储格式及固定 OpenAPI 保持原样，应用仍为0.1.0。下文是当前单活动 BFF 的运行手册，不提供多活动实例或不停写热备。

R22候选`7fc66c2`的[CI](https://github.com/bigsinger/OxenWeb/actions/runs/42831759415)已通过完整回归583项（576通过、7条件跳过、0失败）、官方专项7/7及浏览器12/12。548工程文件的干净拷贝完成安装、API生成四契约字节核对、构建和严格类型检查，首次测试类型失败日志保留且已修正。正式部署于2026-11-10 14:28:50 UTC另行完成并通过，下文记录实际更新结果，不以隔离验收代替部署。

2026-11-10 R21：首次使用团队权限前必须通过可信维护程序显式初始化通用`source-access-markers.json`；已有实例先核对并保留原受限项目，新空环境才可初始化空列表。Live不会自动把缺文件解释为无保护配置；缺文件时所有源数据保守受限。当前备份与恢复只使用通用marker和最新发布保留策略，旧registry／物理库不再作为活动控制源。详细行为和合成证据见[R21源保护与恢复](r21-source-protection-and-recovery.md)；旧轮恢复说明保留当时事实，不复活被明确清除的发布版本。

## 启动、身份与停写

从工程根目录完成 `npm ci`、`npm run build` 后使用 `npm start`。团队部署设置 `BFF_TEAM_MODE=true` 和受保护的 `BFF_TOKEN`；该模式缺少 owner token 就拒绝启动。不要给标注人员共用 owner 凭据；在访问管理发放独立、受限、带到期时间的凭据，token 只展示一次。匿名/错误凭据不会回退成本机 owner。

R21首次启用团队权限或升级权限保护文件时，先停止BFF，再运行只读计划：

```powershell
npx tsx scripts/ops-source-access-init.ts
```

仅确认是新空策略，或已核对升级实例没有原受限项目标记时，才显式初始化空策略：

```powershell
npx tsx scripts/ops-source-access-init.ts --execute --initialize-empty
```

需要保留项目保护时使用`--execute --retain namespace/repository`，多项目重复`--retain`；维护工具只增不删，存在活动BFF租约会拒绝执行。不要用`--initialize-empty`替代遗失的保护策略：应恢复同代`source-access-markers.json`备份，核对后启动。该入口不写样本或Oxen提交。

正式入口 `apps/server/src/index.ts` 在创建应用前持有两份排他租约：规范化控制目录与本机上游 authority。同一服务账号/锁空间内，换端口或更换 `DEMO_DATA_FILE` 不能为同一上游开启第二个活动 BFF。存活 PID 的锁不自动抢占；死进程锁可在校验后回收。锁损坏、目录或服务版本不符应停下核对，不能手工删锁以启动第二个写入者。注入式合成测试不抢正式租约。

部署约束是一个受管服务账号、一个活动BFF、上游只允许该入口；本地租约不冒充Oxen内核的分布式锁。Windows其他账号的独立TEMP、其他机器或不同远端别名不在该锁空间中，不能各自启动写入BFF后宣称受全局排他保护。应通过服务管理和上游网络入口保证这些入口不存在；不为此改动Oxen内核。

实例管理员可在运维界面发起停写，或调用 `POST /api/maintenance/drain`。新写入返回 `INSTANCE_DRAINING`，已有请求及其已接受的后台工作继续排空。owner 响应包含当前 PID 和剩余写入数，普通人员没有此权限。`POST /api/maintenance/resume` 恢复写入。SIGTERM/SIGINT 路径先排空，再关闭应用、释放锁；排空超时保留服务与未决线索，不将其报成成功退出。Windows 的外部硬终止不保证触发 JavaScript signal handler，因此受控备份必须先执行 drain。

`GET /api/health` 区分上游就绪、运行状态和待核对操作；owner 的 `/api/operations/health` 给出更详细的容量与对账计数。安全运维 JSON 日志只包含白名单标识、结果码、计数和耗时，不写请求正文、原始查询、Cookie、token、ZIP 成员或任意 error 对象。

## 不可变构建与安全更新

Web静态服务使用`wildcard:false`，资源路由在BFF启动时登记。运行时替换`apps/web/dist`不会注册新hash文件，可能让脚本请求得到HTML并导致空白；运行中的server构建同样不得覆盖。开发热更新不适用于正式静态部署。

1. 在独立stage目录准备固定候选源码，执行`npm ci`、`npm run generate:api`和`npm run build`。核对lockfile、四个固定契约文件及server/web构建树SHA；stage不使用真实数据或现用凭据，不在运行目录执行构建。
2. 核对升级前备份、现用配置、受限源保护策略及原构建回退路径。R22不要求修改Oxen内核或真实样本；相同0.1.0字符串不能代替代码和构建指纹。
3. 使用现用owner入口drain，等待已接收写入及后台工作排空。核对响应PID、租约、实际命令行和工作目录；若未排空、PID不符或租约状态不明，停止升级，不另起第二个写入BFF。
4. 受控停止已核对的BFF，确认进程退出及租约释放后再交换完整server/web构建。保留同代旧构建和配置用于回退，不逐个覆盖正在服务的资源；仅更新Web/BFF时不擅自停止或替换上游Oxen。
5. 以原受管身份和配置启动单一BFF，确认健康、租约、API、静态hash资源和项目导航，再按既有维护状态恢复写入。验证权限、草稿读取及一次受控合成读写；正式数据只作获准的摘要比对，不自动发布。
6. 若启动或验证失败，重新drain并停止已核对的新BFF，恢复匹配的旧构建/配置后启动。保留失败记录，不以运行时热换dist修复；不得为了启动而删除未知租约或跳过源访问保护。

R22旧QA环境曾热换静态目录后出现空白，随后停止该旧进程的自动审批被拒；没有绕过审批或将该次失败记为通过。最终复验改用新端口3016及不可变构建目录，持续模块503故障时失败面板和导航仍可用（实际拦截2次请求，预置故障上限不是实际请求数），清除故障后显式刷新设置恢复。隔离故障验收与下面的正式部署结果分别记录。

2026-11-10 14:28:50 UTC，正式3001由PID41100受控切换为PID50256：drain剩余写入为0，上游authority及controlRoot双租约、PID与监听均核对；停止后交换完整构建并启动。新JS/CSS均返回200，MIME和实际字节与构建一致；健康状态ready、acceptsWrites=true、pending=false。官方3002保持运行且未变更，无数据迁移。四真实库在before/predeploy/after三个时点的源提交、正文和私人草稿摘要一致；正式发布页已只读打开验证，无发布或样本写入。PID仅是本次回执，不应在后续维护中直接照抄，详细证据见[R22实施记录](implementation-r22.md)。

## 持久写与未知结果

治理、身份、任务、MR、生命周期、Release、草稿及检查点采用集中耐久写：同目录独占临时文件 → 完整写入 → 文件 fsync → 最终权限/CAS 回调 → 原子替换 → 平台支持的目录 fsync。Windows 不支持的目录刷新明确作为平台限制；进程中断的旧完整文件/新完整文件验证，不等同物理断电或磁盘控制器认证。写失败不能给出“已保存”。

高影响写操作有独立操作 ID、actor、请求摘要、固定基点和 workspace/commit/job/Release 锚点。请求 ID 与内容必须匹配，其他 actor 无权读取或重用它。日志不存原始内容或完整响应。成功的同 ID 请求读取已核验结果；执行中或结果未知的请求进入“待核对”，不会盲目再 commit/merge/publish。后台任务排队不代表完成，完成后才更新状态。

运维页可查看并核对：

1. commit：操作 trailer、固定父提交和实际提交 ID；没有可靠锚点则继续待核对。
2. merge：目标提交同时包含固定 source/target 祖先，随后对账 MR/任务控制面；不能只凭分支名判定合并完成。
3. Release：固定提交、状态、索引与实际资产 SHA；缺失或损坏资产拒绝发布/下载，不能把孤立文件视为完整发布。
4. 进程重启：旧 prepared/running 转待核对，内存队列和浏览器会话不当作已恢复任务。

未知结果应先保留输入、核对操作页和固定提交，再决定后续动作。手工修改 journal JSON、删除待核对记录或自动换一个 ID 再发同一命令，都不能代替对账。

R22的DELETE也区分已确认完成、确定拒绝和结果未知。响应丢失时先按当前身份、项目及目标只读核对，不主动重放DELETE；读取失败或失去权限仍保持未知。若服务端以匹配的操作ID明确证明完成，则保留“已撤销”等真实结果，后续GET失败单独提示，恢复按钮只读。操作核对链接携带该操作ID并在新窗口打开，不清掉原页面输入。

最终3016合成复验在真实撤销204后丢弃响应：浏览器内部重试了同ID请求，journal阻止第二次执行并返回完成证明；页面显示已撤销及读回失败，只读重试后列表恢复。该观察是一次界面动作、两次同ID HTTP请求、一次实际撤销，不应记成“只发过一次HTTP请求”。不把同ID完成证明扩展到错误ID、缺状态或其他POST操作。

成功/已确认失败的详细操作元数据保留90天，随后压缩为不可复用的最小墓碑（原ID、actor ID、摘要和终态）；不保留原人员名称、项目/分支、结果锚点。待核对/执行中的记录不按90天清理。墓碑继续用于拒绝过期ID重用，不能删掉后把同一ID当新请求。默认总记录上限10万、文件上限64MiB，并为每个未决操作预留16KiB锚点预算；达到保护线时先拒绝新高影响操作，不先执行再报容量错误。`prune()`、初始化和后续新写可收敛过期详细记录，`retentionState()`可查看预算；容量调整/归档必须保留墓碑索引，不能通过清空文件绕过。本轮没有删除业务版本或Release资产。

## 同代冷备

先查看实际来源与计划；这些命令不会停止服务或写真实备份：

```powershell
npx tsx scripts/ops-backup.ts plan
npx tsx scripts/ops-backup-coordinated.ts
```

Windows 备份读取受管 `infra/oxen/run/data-location.json` 指向的 WSL 原生 ext4 活跃数据，通过本机 WSL UNC 路径复制；不会把工程中迁移前 `infra/oxen/data` 当成权威。脚本核对 checkout project ID 与受管 origin。远程上游或其他部署拓扑不自动套用本机停止命令。

一个 generation 一起保留：完整官方对象/提交/分支/工作区；治理、访问凭据、任务、MR、裁决、策略、活动与回收状态；操作 journal 和全局审计；Release 索引与资产；操作者隔离的私有草稿及原始检查点；CLI checkout；必要配置、官方安装/契约版本及密钥引用。CLI checkout 在未证明干净且无未推送内容前不排除。内存导入预检与会话不伪装为可恢复状态。新权威控制面文件必须同步加入清单。

清单同时记录 Node 版本、Git commit/dirty、服务端/前端构建树 SHA、契约和 lockfile SHA，备份包括现有 server/web 构建与workspace包清单，不包括`node_modules`。当前R10仍是本地集成代码，不能仅凭“0.1.0”字符串认定旧GitHub tag与本轮代码一致；换机应使用匹配源码/构建指纹，安装依赖后核对，或采用已验证的备份构建产物。未提交状态如实记dirty，不冒充已发行代码。

备份需要两次无写入者检查；清单最后写入，并逐项验证大小/SHA 和未列出的文件。源在复制中改变、链接、缺文件、坏 hash 或不完整清单均失败。ZIP/Skill 只按原始字节复制，不解压执行。默认本地目标 `.backups/` 已被 Git 忽略，备份不得落进任何源目录。

配置本地副本和受限异机/离线加密副本的位置、密钥保管人后，可执行单命令维护：

```powershell
# 路径是示例，应替换为已确认的实际备份位置。
npx tsx scripts/ops-backup-coordinated.ts --execute --destination-root F:\OxenBackup-local --encrypted-root E:\OxenBackup-offline
```

加密副本从受保护环境读取 `OXEN_BACKUP_KEY`，格式为32字节随机 key 的 Base64；不要写入聊天、任务参数、源码或公开截图。流式 AES-256-GCM 同时验证完整性，不将任意 ZIP/tar 直接解压。缺少合法 key 会在停服务之前拒绝。key 应由负责人单独保管，否则只有密文不能恢复。

Windows 的`0600/0700`模式位不能代替NTFS ACL。负责人应先为明确新建的专用备份根设置当前执行账户所需的受限ACL，使generation继承，再运行备份；不要递归修改一个未知共享父目录。不同盘符或名叫“offline”的目录都不能自行证明异机/离线，真实独立副本及key可获取性需实测。

协调顺序为 owner 停写 → 核对本机 BFF 租约/PID → 停止已排空 BFF → 调用既有受管脚本停 Oxen → 完整复制/校验及加密镜像 → 启动原官方服务 → 隐藏启动本项目已构建 BFF → 恢复写入。复制失败也会按序尝试恢复服务，原始错误和恢复失败分别报告。并发维护锁拒绝重复启动。只停止经本机租约和官方脚本核对过的进程，不停止整个 WSL 或无关服务。

成功的本地备份保留最近7个日代和4个 UTC 周锚点；仅清理本地目标根内已核对的过期完整 generation。未知目录、链接或损坏的备份不会自动清理；原件、版本、草稿和审计不按备份保留规则删除。加密离线副本的独立保留策略由负责人配置，不能把本机清理等同远端清理。

日/周保留会合并同日多次备份，不能把升级前的临时代当作永久锚点。升级或治理迁移需要保留的代应另存到独立的维护锚点根，例如`.backups/upgrade-anchors/<generation>`；日常计划使用另一个管理根，不把锚点纳入日常清理。复制已校验的代后仍须重新核对完整manifest/SHA。这是同机保留策略，不能因此声称已有异机副本。

## 每日计划与目标

Windows 可先生成计划，确认路径后再安装：

```powershell
powershell -NoProfile -File scripts/ops-backup-schedule.ps1 -LocalRoot F:\OxenBackup-local -EncryptedRoot E:\OxenBackup-offline -At 02:00
powershell -NoProfile -File scripts/ops-backup-schedule.ps1 -LocalRoot F:\OxenBackup-local -EncryptedRoot E:\OxenBackup-offline -At 02:00 -Install
```

安装命令创建 checkout 专属任务，使用当前用户的交互身份，不保存 Windows 密码；隐藏执行，忽略重叠触发，错过时间在可用时补跑。它要求用户已登录、Node/构建/本地保护配置可用、备份设备和 key 可获取。不会为定时任务改管理员权限、关闭认证或强行终止超过30分钟的维护。已存在的同名任务先人工核对，不直接替换无关任务。本文和工具就绪不代表任务已安装。

建议目标为 RPO≤24h、RTO≤4h、维护停写≤30min，均按批准的完整体量/机器实测。RPO 从故障时刻回看最近一个完整校验且实际可取得的备份的一致性切点；RTO 从业务不可用或还原演练宣布开始计时，包含获取备份、key、解密、核对、启动与必要读取。缺设备/key、错过备份或校验失败均不算达标。同一硬盘两个目录不能算异机副本。

最新R11构建已完成完整本地同代备份与fresh隔离恢复：generation `3c0027b6-4922-42f3-a845-62d7d38418af`，3709文件，15仓库/44分支/13数据集/11860逻辑样本及资产、私有身份隔离读回相符；停写7分43.787秒，完整RTO4分47.076秒，详见[R11记录](implementation-r11.md)和[安全摘要](evidence/r11/acceptance-summary.json)。R10代1a6e33db当时3701文件、停写7分29.463秒、完整RTO4分49.5秒的验收仍作为历史，已由日保留替换，旧目录不再存在；4276维护锚点及其含故障修复21分04秒记录仍保留，见[R10记录](implementation-r10.md)。以上均为同机、固定官方二进制及Node环境已备妥的演练；生产每日任务、独立离线位置和key保管仍待实际部署，异机恢复未验收。不得把合成小体量的秒级恢复报告成生产 SLA。

## 隔离还原

```powershell
npx tsx scripts/ops-backup.ts decrypt --backup E:\OxenBackup-offline\generation.owb --destination E:\OxenRestore-decrypted
npx tsx scripts/ops-backup.ts verify --backup E:\OxenRestore-decrypted
npx tsx scripts/ops-backup.ts restore --backup E:\OxenRestore-decrypted --destination E:\OxenRestore-isolated
```

目标必须是新隔离目录，工具拒绝覆盖已有目录或当前控制面/CLI/Oxen目录。恢复先验证整个 generation，再复制；所有旧成员/管理员凭据撤销，Release 分享撤销，保留 actor ID 与原意见/草稿归属。会话不恢复，owner 应急 token 重新配置，人员新凭据以原 actor ID 重新签发。缺失、损坏或跨代不一致时不要启用团队访问。

恢复还会剥除配置副本中的旧`BFF_TOKEN`、`OXEN_AUTH_TOKEN`和`OXEN_BACKUP_KEY`，强制`BFF_TEAM_MODE=true`，并写`restore.env`要求新的owner token；不会因未配置凭据而悄悄回到隐式owner。原备份及现用配置均不改动。已撤销人员可由管理员按原actor ID再发受限凭据，实际原生合成演练已验证同人取回原私有草稿和非法输入，原基点不被权限配置提交意外前移。

Windows 的官方服务仍应运行在 WSL 原生 ext4。校验后的官方数据应在受控停写窗口放到新机器受管的空原生目录，并核对该机器 project ID、data-location 指针与配置；不能用旧机器绝对路径直接覆盖当前指针，也不能把 DrvFS 当成原生数据目录。BFF 的恢复控制面和 CLI 路径应通过本机配置指向已核对的还原目录。工具不自动接管旧生产目录。

上线前逐项比对仓库/分支 HEAD、条目数/稳定身份、原 JSONL/ZIP hash、采用模板、标签与复核指纹、任务/MR、Release 索引和资产、回收记录、私有草稿及非法 UI 输入。隔离官方演练脚本 `npx tsx scripts/r10-backup-acceptance.ts` 仅使用独立3006/3007及 `r10-*` 合成根；不会停止或读取生产3002，完成后核对 PID/exe/端口并停止合成服务。

实测回执保存在本机 `.data/r10-recovery/latest.json` 及对应目录，不随源码提交。工程回归为 `apps/server/test/operations-runtime.test.ts`，覆盖故障写、进程 kill、排空、未知结果、错误凭据/坏备份、加密鉴别和维护失败后的服务恢复顺序。

## 当前完整本地体量的升级窗口

下面只用于已确认的本机部署，必须先核对实际进程和路径，不能直接照抄一个过期PID。旧R9进程没有新租约，不能交给新协调器冒认；首次升级由负责人受控执行，之后使用正常协调器。

1. 核对正式BFF的PID、命令行和工作目录，确认无在途业务写入后停止该BFF；保留官方3002暂时运行供只读固定版本清单。
2. 执行`npx tsx scripts/ops-recovery-capture.ts`。脚本拒绝BFF仍在响应；只保存仓库/分支HEAD、主分支条目/身份/原件/标签/模板的哈希和计数到`operations/backup-read-inventory.json`，不输出正文。该文件被纳入同代备份。
3. 执行`node scripts/oxen.mjs stop`，仅停止经受管PID/exe核对的官方实例。
4. 执行`npx tsx scripts/ops-backup.ts create --destination .backups\r10-pre-upgrade-实际时间`，再执行`npx tsx scripts/ops-backup.ts verify --backup 同一路径`。目的地必须不存在。外部位置/key尚未落实时只完成本地代，不声称已有独立加密副本。
5. `node scripts/oxen.mjs start`，使用`npm start`启动已构建的新BFF，核对版本、数据和权限。失败按原构建/配置回滚，不覆盖原生数据试运气。
6. 执行`npx tsx scripts/ops-recovery-acceptance.ts --backup 同一路径`。工具在复制/启动前必须核对备份runtime记录和当前server/web构建树、lockfile、契约四项SHA，缺记录或不匹配直接拒绝。只有匹配后才从固定的当前server dist导入应用、provider和dataset实现，不执行备份给出的任意代码路径，也不以可能未构建的当前TS源码替代。它只在新的WSL隔离根恢复完整generation，核对全部文件后组装控制面，用loopback3010官方服务和无监听的BFF注入比对备存HEAD、身份、行/原件/标签/模板摘要；owner token仅在内存。完成后核对exe/端口并停止3010，不切换或写入生产3002。回执`.data/r10-production-recovery/latest.json`必须包含`matchedCurrentBuild:true`、`restoredBffFromVerifiedBuild:true`及四项匹配hash，不含样本正文。

失败时按阶段保留`failure-<attempt>-<phase>.json`，只记录错误类型、稳定错误码、HTTP状态和存在的工程代码位置；不写错误正文、断言actual/expected、token或样本。BFF关闭失败也继续尝试停止隔离官方实例。不同构建的ApiError按稳定status/code识别，不依赖跨模块的`instanceof`。

若完整复制已成功（有`restore-receipt.json`）而控制面组装未完成，可显式加`--reuse-name r10-production-recovery-实际后缀`复用，保留旧失败副本。工具仍先验证原备份与当前构建，再独立核对receipt的generation、原manifest SHA、固定源路径和每一个恢复文件；凭据、分享、环境文件必须精确符合原恢复时间的撤销/清理变换。缺失应有文件、篡改文件、额外文件、符号链接和启动后被存储引擎改变的内容都会拒绝复用。只有manifest声明为目录且文件数为零的空源允许旧副本未实体化；组装时创建空目录。新控制面使用`control-<attempt>`，不覆盖原失败目录；复用核对回执另存。该入口不降低build匹配要求，也不把失败副本或脚本测试当成恢复验收通过。

旧构建下的升级前代仍是有效安全快照，但不能冒充新构建的同build恢复验收。最终build若因修复变化，需要在该新build下重新生成完整代并验收；不通过降低hash要求迁就旧快照。备份与当前Node版本另行记录，不把相同“0.1.0”字样当作代码相同证据。

预估（运行时只读统计，不是一致快照）：3668文件、128,773,784字节，约122.8MiB；活跃WSL官方存储3037文件、118,153,340字节。统计包含当前测试项目、完整历史与构建，没有用四类样本的行数推定备份体积。实际copy/verify/恢复应单独计时；最终回执优先于这份预估，生产RPO/RTO及独立副本不可由小型合成演练替代。

## 官方故障专项

`scripts/r10-fault-acceptance.ts`默认只声明计划；执行命令是`npx tsx scripts/r10-fault-acceptance.ts --execute`。它使用独立3011及`r10-faults-*`原生根，已实际完成下述四项专项，回执为`.data/r10-faults/latest.json`，不是仅语法核对。

计划验证真实官方commit已完成但provider回复丢失，重建BFF后按固定marker核对且重试不增提交；三条纯合成文本经过真实任务/独立人员复核后完成merge，再通过仅在自身fixture根内暂换MR JSON文件类型触发实际控制面写失败，恢复原文件并重建BFF后核对MR、任务和HEAD，不重复merge；另一个真实merge在proxy保存targetHead前丢失回复，重建后派生的已验证HEAD必须进入MR修复而非写空mergedCommitId；已复核的正式Release候选缺引用资产时拒绝下载、发布和对账，恢复资产并核对SHA后仍不把原失败发布误标为成功。

所有故障文件移动前显式解析路径并校验在该独立根内，原件放escrow保留，finally分别尝试恢复文件、关闭BFF和核对停止官方进程；不递归移动/删除未知目录、不触3001/3002、不打印正文/token，也不执行ZIP内容。实际回执`.data/r10-faults/latest.json`和`.data/r10-fault-acceptance-final.log`记录四项通过；资产场景的未知build proof边界如下，不由Demo专项或正常恢复路径代替。

首次官方专项执行在资产场景因脚本期待错误而停止：真实build已成功并登记终态，后来人为移走资产不应改写该历史成功，所以对原终态操作返回200是正确行为；当次真实下载已返回410。修正后的脚本在关闭BFF后显式注入另一个defer的未知结果元数据记录，再重建BFF检查该未知proof。它不是实际build回复丢失，回执明确标`unknownProofMetadataOnly`。缺资产时下载/发布和未知proof核对须拒绝，原历史build仍为成功；恢复资产后未知proof才可成功，而此前失败的publication仍不能冒充已发布。此修正仅改验收脚本，不修改后端行为。

R12：`evaluation-policy.json`是独立的sticky安全控制面，已加入`ops-backup.ts`清单和`ops-recovery-acceptance.ts`映射。`recovery-control-acceptance.ts`按同代文件检查启用身份/operationId，并单独核对Release私有永久曝光`memberships`；公开Release DTO继续不含此字段。必要API摘要新增evaluation行映射哈希。不能只恢复Oxen分支或删掉这份策略文件，tiered索引存在却策略缺失会拒绝启动，持久化结果不确定会阻止降级。[R12实际备份恢复](implementation-r12.md)另记最终代和实际时长；R11/R10结果保持历史，异机副本和日任务仍待部署。

2026-11-09 R12最终追记：最终同代`71cfd9fd-46e8-4b10-82a0-f58f1afd5181`已完成fresh完整隔离恢复，3717文件、停写7分47.101秒、完整RTO4分55.258秒；15库/44分支/13数据集/11860条摘要和1份sticky分组策略读回相符。源代正式Release/任务/有效草稿/有效人员凭据为0，独立合成闭环覆盖这些非零场景；不冒称源代存在。最终runtime四SHA、6份私有输入/6组隔离与3资产SHA均核对，3010停止、正式3001/3002健康；详见[R12](implementation-r12.md)。首个R12临时代1a2582f9已由同日保留策略剔除，不能使用旧路径；R11前一UTC日代与4276锚点仍保留。R12启用后不支持把R11旧BFF直接接回同一控制面，须用识别sticky策略的同代构建恢复。异机副本、密钥、日任务与持续RPO24h仍未部署，不因此改写为通过。
