# R19：以1.1视图与模板替换旧发布方式

日期：2026-11-10，Asia/Shanghai。依据[用户原方案](proposals/publishing-model-1.1-r19-user-spec.md)实施。发布模型版本为1.1，工程版本仍为0.1.0；此次未创建GitHub发行。官方Oxen 0.67.0、内核及固定OpenAPI均未修改。

## 当前入口与操作

|入口|职责与实际规则|
|---|---|
|全局“发布模板”|分视图模板和发布模板两类；系统只读，管理员可新增、修改、另存、移除自定义模板。修改模板不追改已建实例|
|项目“视图管理”|新项目自动创建golden、regression、holdout、public；实例可预览、修改、重置为来源模板和另存模板；老项目显式初始化|
|项目“Releases”|选择模板→临时覆盖→核对命中数及导出字段→保存发布实例→校验并物化→明确发布；保存固定源提交、实际配置、视图定义及隐藏目录成员|
|工作快照|复用同一视图物化流程，默认public视图；无视图老项目保留内部全量兼容，不支持外链分享；已配置后删光视图不会退回全集|
|独立隐藏存储|受控目录和ACL；授权人员可导入文件，每文件计1项，ZIP保持压缩数据且不执行。普通发布仅随机条目ID＋SHA256，不提供隐藏原文下载|

## 模板与兼容边界

|系统视图|筛选／数据来源|默认导出|
|---|---|---|
|golden|`"quality" = 'golden' AND "status" = 'active'`|数据ZIP|
|regression|`"purpose" LIKE '%regression%' AND "status" = 'active'`|数据ZIP|
|public|`"visibility" <> 'hidden' AND "status" = 'active'`|数据ZIP|
|holdout|独立`holdout/<dataset-hash>/`，无筛选条件|HIDDEN_MANIFEST.sha256|

三种系统发布模板为标准公开、内部回归、季度归档；季度归档采用真实Parquet。默认标准发布为三个数据ZIP＋隐藏哈希清单＋总manifest，共5个资产。三个虚拟视图可以重叠，预览分别计数并提供去重总数。

系统条件严格按附件执行：现有`quality=gold`不会自动当作`golden`，`purposes`不会当作`purpose`，缺失`status`不会补`active`。预览诊断并允许负责人调整项目视图；不改Sample CRUD、字段校验或真实源值。新public默认可包含internal行，预览及发布确认明确提示交付范围。旧源hidden及旧evaluation holdout记录在普通视图中硬排除，不能据此声称已物理迁移。

Sample不会为本次发布新增split/config/tier归属列；现有四维业务字段及分析记录保留。config固定default，无配置管理入口。金标业务声明与独立复核证明分开，未复核状态仍进入正确的导出标记，不将源quality冒充系统审核通过。

旧发布算法、固定四ZIP／隐藏ZIP、旧工作快照算法及专用界面、专用算法测试已移除。旧发布记录和磁盘产物仅为审计证据，标记legacy；旧下载、分享和变更入口返回410。历史已分享曝光仍保留，避免退役后重新把已曝光内容当作隐藏。旧R12/R13发布验收脚本仅报告退役并指向R19，不再运行旧算法。

## 实现与安全

|模块|实现|
|---|---|
|视图及模板|DatasetViewStore耐久注册表、revision/CAS和历史；受限DSL只接受字段、文本、=／<>／LIKE／AND，限制行数、比较量、文本和时间；预览／物化共用选择器|
|发布|复用原导出范围裁剪、字段投影、附件校验、ZIP及导入互换格式；增加真实CSV／Parquet编码；不复制原始主库README／归档到投影|
|冻结|commit＋实际配置＋视图定义／revision＋物理摘要决定语义；模板名称／说明快照仅辅助，不决定重现性；预览到保存期间变化返回409|
|隐藏|独立于Oxen普通源、静态文件及下载根；NTFS服务身份／SYSTEM／Administrators ACL，POSIX受限权限；路径／符号链接及内容校验，丢失已知存储或证据启动失败关闭|
|受控评测|仅loopback＋明确Bearer＋release.hidden能力；Cookie浏览器请求、跨源或无权请求拒绝。只读原件供内部评测，不执行ZIP；审计不含正文或原始purpose|
|导入对账|批次operationId＋revision＋完整SHA验证；未知结果保留原文件和标识，仅匹配已验证回执才能确认，不依据数量推断或盲重发|
|主库边界|配置视图的项目继续限制可信主库访问；普通QA／算法消费者仅取获准产物。字段／前端筛选不冒充行级ACL|
|备份|同代控制清单纳入dataset-view-registry.json和整个holdout目录；恢复重验证冻结证据与ACL，旧令牌和外链撤销；不降低恢复门禁|

模块细节：[视图及模板](r19-view-templates.md)、[发布物化与隐藏存储](r19-release-materialization.md)、[界面](r19-publishing-ui.md)、[官方合成验收](r19-publishing-acceptance.md)。这些是本地Web/BFF扩展，不是新SaaS观察。

## 实际验证记录

独立Demo及官方Oxen 0.67.0专用3008已实际通过：8条合成源样本、2个独立隐藏成员，golden2／regression2／public5／holdout2；JSONL、CSV、真实Parquet独立回读、逐资产SHA、防隐藏与禁导出字段泄漏、模板覆盖解耦、受控评测、旧无视图内部全量及public单视图快照。源码和身份未改变，未读取或执行真实Skill包。详细回执路径见专项文档。

|最终检查|实际结果与证据|
|---|---|
|全量回归|570项，563通过、0失败、7项外部环境条件跳过；`.data/r19-full-tests-verified.log`，exit0。跳过项不是通过；独立新原生发布脚本另外实际运行|
|类型与构建|最终Vue／server typecheck exit0；Vite及server tsc构建到`.data/r19-build-stage-1794241714490`后整体切换，没有对运行中dist原地构建。Vite仍有大于500KB分块提示，非构建失败|
|最终官方服务|独立0.67.0、3008，最终run `r10-r19-publishing-mw9ha18f`，2026-11-10 00:31:29完成；覆盖public快照2资产、三种格式、真实Parquet独立读回、防泄漏和权限，exit0，已停止该自有服务|
|冷备恢复|真实视图／隐藏／Release stores创建5资产后冷备并恢复到新NTFS隔离目录；逐资产SHA及视图／冻结隐藏证据一致；分享撤销、内部评测授权和审计通过；缺registry／已知blob、额外Everyone读权限均拒绝。20项恢复组合及6项ACL定向实际通过|
|恢复工具|新增registry／holdout装配映射；BFF控制副本在独立NTFS，Oxen恢复仍在独立WSL。旧记录／字节只审计并验证SHA，旧下载／分享410；现代资产正常读回。3项工具测试及strict检查通过，没有运行此次生产全量恢复|
|浏览器|独立3012／5174合成项目：系统只读、自定义另存、命中2条预览、非法OR报错、物理2文件仅计数摘要；CSV实例保存→物化→正式发布→指定最新稳定版；默认public快照仅1ZIP＋manifest；老项目无视图空态及内部全量提示；390px表单无页面横向外溢；生产3001模板页只读复核通过|
|真实源保护|四真实项目更新前后main提交、canonical字节SHA／大小、本人私有草稿SHA全部一致；4项目仍configured=false，不自动改值、分组、移动或发布。私有核对文件仅`.data/r19-real-source-before.json`／`after.json`|
|部署|2026-11-10 00:32:09维护排空→校验实例锁／PID→替换产物→重启→恢复写入，00:32:11完成；upstream未停止。`ready=true`、`acceptsWrites=true`、`pendingReconciliation=false`|

全量回归中先发现旧发布错误码测试未更新，以及Windows PowerShell 5恢复探针的Get-Acl模块自动加载失败；分别改为新发布提交边界断言及.NET全树只读ACL校验，未放宽权限，最终全量重跑通过。已知文件丢失和宽权限负例持续失败关闭。

新构建SHA256：server `02e880e5909700fcb1d3a44fb2e30d80761e3891766da7bc5b01650ffacde801`，web `522406766951643b9fd75ea30fbf84f2d599f8087b261d9884d87dea3955ad0a`；固定OpenAPI仍为`2ae57812994900f768c841e7e20d25418555ffbf37c3690775e2af5b8c581660`，新增Parquet依赖后的lockfile为`052f2ce7a9015fee9e1ea25b3a3dfd344a17fdfe07c35a8af8ada00d282a662f`。旧构建另存忽略目录供回退，此次没有重复生产全量冷备，不声称完成异机／异地恢复或新的生产RTO验收。

聚合结果：[verification.json](evidence/r19/verification.json)。截图仅合成内容：[模板](evidence/r19/templates-desktop.png)、[物理摘要](evidence/r19/holdout-count-hash.png)、[正式发布](evidence/r19/release-published-desktop.png)、[390px表单](evidence/r19/release-form-390.png)、[单视图快照](evidence/r19/work-snapshot-view.png)、[旧项目空态](evidence/r19/legacy-no-views.png)。没有实际点击资产下载、上传真实文件或把程序读取当浏览器落盘；原R11浏览器下载接管和3005／5173保持独立保留，不以新夹具绕过。

已停止本轮临时3012／5174；生产3001／3002继续运行。使用入口为`http://localhost:3001`。现有真实库开始使用新发布前，应在“视图管理”显式初始化，并按实际字段调整条件、预览；物理隐藏迁移及真实发布另行执行，不能把历史候选或字段本身当作已经落地的物理隐藏库。
