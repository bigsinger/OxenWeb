# R19 1.1 发布的隔离合成验收

最终整合补充：主线程在所有代码冻结后再次执行官方3008，run为`r10-r19-publishing-mw9ha18f`，2026-11-10 00:31:29通过。全量570项中563通过、0失败、7条件跳过；实际部署、真实源只读核对、浏览器与冷备恢复范围见[主验收记录](implementation-r19.md)和[聚合结果](evidence/r19/verification.json)。本文件下方保留各次专项回执，未以程序读取替代浏览器实际下载。

日期：2026-11-10，Asia/Shanghai。脚本` scripts/r19-publishing-acceptance.ts `只创建新鲜合成存储与项目，不读取四类真实样本，不触及生产3001／3002，不执行Skill包或浏览器下载。该记录是本地扩展验收，不是SaaS功能观察。

## 运行与复用

```powershell
# 默认只打印计划，不启动服务或写项目
npx tsx scripts/r19-publishing-acceptance.ts

# 独立官方Oxen 0.67.0，专用3008端口
npx tsx scripts/r19-publishing-acceptance.ts --execute

# 独立Demo，仍使用真实HTTP处理链和真实ZIP/CSV/Parquet序列化
npx tsx scripts/r19-publishing-acceptance.ts --demo --execute
```

官方模式复用`qa-native-server.ts`：名称必须`r10-*`，先核对3008未占用，原生数据位于本次专用WSL目录，客户端配置／clones／控制文件位于本次`.data/r19-publishing-acceptance/<run>/`。结束时验证PID的官方二进制及端口，只停止其自己的3008。不会停止、复用或清理生产服务。每次运行使用唯一项目，不盲目重放旧run。

`seedPublishingFixture(app, provider, {namespace:'local',repo:'r19-...'}, ownerToken?)`可供主线程的独立浏览器QA入口复用。它通过POST `/api/repos`验证新项目自动初始化四个视图，再由受控fixture写入源文件、独立物理目录和合成权限。`verifyPublishingFixture(fixture)`执行下表全部验收。返回值中consumer/evaluator含合成测试令牌，调用者仅可写入忽略目录，不能打印或放进文档／截图。脚本最终回执不含凭据。

## 样本与期望

8条普通源样本覆盖：golden／normal／旧gold，purpose／旧purposes，active／inactive／缺失status，public／internal／旧hidden；仅第一条关联一个程序生成的无行为Skill ZIP。源记录没有split/config/tier。字段定义由fixture显式允许golden与gold，不修改全局字段目录，也不调用Sample编辑去补归属列。

独立隐藏目录另存2个合成JSON成员，包含专用内容、样本ID及原文件名金丝雀。主库README也含隐藏金丝雀，用于确认生成的dataset card不会复制整个主库说明。

|标准默认视图|实际成员|
|---|---:|
|golden|2|
|regression|2|
|public|5|
|holdout|2，仅哈希|
|虚拟视图去重|5|

internal行按用户附件的`visibility <> hidden`进入公开投影并有说明，未恢复旧版shared/public规则。旧gold与purposes不被悄悄映射到golden／purpose；缺status和inactive不匹配默认active。普通源中的旧hidden行不进入任何普通发布数据包。quality只表示fixture的业务声明，没有冒充专家审核；未复核状态继续保留在导出envelope中。

## 已实际执行

|检查|实际结果|
|---|---|
|新Dataset默认视图|POST创建后golden／regression／holdout／public四实例已存在|
|标准发布|预览完整计数及去重→带commit／viewsRevision／planDigest CAS保存候选→异步构建→显式发布|
|产物|3个data ZIP＋HIDDEN_MANIFEST.sha256＋总manifest.json，共5资产|
|物理隐藏|公开哈希清单恰2行，不含正文、源样本ID或原文件名；不存在隐藏数据ZIP|
|防泄漏|逐资产及ZIP成员检查隐藏内容、旧hidden源行ID、禁导出字段金丝雀均缺席；解析后的data也无内部禁导出字段|
|权限|无hidden能力的consumer可读取哈希；隐藏元数据／正文受控读取拒绝；cookie评测拒绝；明确Bearer内部评测可读2条并出现宏观审计，日志不含正文|
|JSONL／CSV／Parquet|三种实际发布均逐行对照身份、源truth、布尔及附件；CSV用既有解析器读取JSON单元格；Parquet验证PAR1头尾并用独立hyparquet解析真实列式内容|
|工作快照|显式选择public，只生成public数据ZIP及总manifest两资产；5行，没有物理隐藏清单或隐藏正文|
|checksums与固定成员|逐包核对checksums、manifest数据摘要、固定commit、sampleIds；总manifest逐项校验资产SHA|
|模板／实例|系统PATCH／DELETE拒绝；自定义创建、实例修改不回写模板、显式reset、实例另存模板；删除来源后reset拒绝|
|发布临时覆盖|CSV／Parquet仅当前Release生效，模板及实例未变化|
|删除发布模板|已有Release仍保有templateSnapshot并可按原摘要下载，不依赖当前模板存在|
|旧无视图库|由Provider直接创建的独立旧fixture保持configured=false；可内部全量发布，仅internal且不可分享，不自动初始化四视图|
|源完整性|8条原始canonical字节与稳定身份、源值完整保持；没有新增Sample归属字段或执行ZIP|

Demo实际通过：`.data/r19-publishing-acceptance/r10-r19-publishing-mw9gng2l/verification.json`，完成于2026-11-10 00:13:35。

官方0.67.0实际通过：`.data/r19-publishing-acceptance/r10-r19-publishing-mw9gol85/verification.json`，完成于2026-11-10 00:14:37，原生3008。源SHA256为`bb1b8dc7d670e59f2bda14eaf7be2113d5813f0dd769f9cc0d0fd54e089dcc07`，`productionTouched=false`。最新回执分别为`latest-demo.json`和`latest-native.json`；日志`.data/r19-publishing-demo.log`／`.data/r19-publishing-native.log`。

脚本按项目strict＋noUncheckedIndexedAccess独立TypeScript检查通过，回执`.data/r19-publishing-script-type.log`。没有运行生产build、修改dist或部署。此处程序读取ZIP证明物化与内容正确，没有把它当成浏览器实际落盘验收，更不替代原R11下载接管。

补充工作快照后重新执行：Demo于2026-11-10 00:19:10通过，回执`.data/r19-publishing-acceptance/r10-r19-publishing-mw9gumlp/verification.json`；官方0.67.0于00:19:42通过，回执`.data/r19-publishing-acceptance/r10-r19-publishing-mw9gv3qy/verification.json`。两者均记录`publicSnapshotRows=5`，源SHA与上次完全一致，3008只停止本次进程。早先运行结果保留，不覆盖为新范围的证据。

## R19恢复脚本适配范围

`scripts/recovery-control-acceptance.ts`与`ops-recovery-acceptance.ts`沿用同一已验证备份代、相同构建指纹、全分支／源／身份／标签摘要基线及隔离目标检查。恢复映射新增`dataset-view-registry.json`和独立`holdout/`；Oxen bundle仍放在本次WSL隔离目录，BFF控制副本每次新建于本次本机`.data/r10-production-recovery/<run>/control-<attempt>`，防止在Windows对UNC路径略过NTFS权限检查。

|恢复对象|核对方式与边界|
|---|---|
|旧发布历史|原记录和资产文件继续按备份SHA核对；对外DTO必须是`legacy=true`、`latest=false`、空资产列表，旧下载／分享API为410，不复活旧算法|
|分享授权|私有存储保留所有身份、摘要及范围，全部撤销；旧版分享列表API410，1.1列表正常读回且每项撤销|
|1.1发布|固定commit、配置、模板快照、资产SHA及正常下载读回；withdrawn仍410，非ready仍409，打断构建重启为failed|
|私有固定证据|`memberships`与`frozenHoldouts`在存储逐项核对，不进入DTO|
|视图目录|目录字节、修订、系统／自定义模板、脱离模板的实例及空配置墓碑均保留；空配置不得退回旧全量发布|
|物理隐藏目录|catalog、索引和成员字节均属于同代备份；启动时对已存在root重新收紧权限，再只读验证Windows整树仅当前用户／SYSTEM／Administrators FullControl、root禁止继承、拒绝重解析点；不能验证则失败|

新增`apps/server/test/recovery-control-r19.test.ts`使用全新合成目录和真实ReleaseService：正常恢复对照、退休资产被篡改仍能检测、已存在宽权限root必须拒绝，实际3／3通过。Windows读回采用.NET权限API，避免Node启动的Windows PowerShell 5模块自动加载失败，不降低权限条件。独立strict＋noUncheckedIndexedAccess检查覆盖两个恢复脚本、新发布脚本及新测试，记录`.data/r19-recovery-script-type.log`；定向测试记录`.data/r19-recovery-control-tests.log`。

这一补充仅证明脚本适配和隔离合成测试，没有启动生产备份、恢复真实数据、运行完整生产代恢复或触及dist。真实全代恢复仍须满足原脚本的匹配构建与已完成备份前置条件，不能把历史旧版恢复结果改称为R19验收通过。
