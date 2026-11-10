# R19：1.1 视图与发布模板元数据

R20历史说明：用户随后取消此发布方式，本文保留当时实现与验收事实；当前不再有视图／模板操作功能，磁盘历史证据的保留边界见[R20只读归档](r20-legacy-evidence.md)。

日期：2026-11-10，Asia/Shanghai。依据用户提供的《数据集管理平台1.1增量改造方案》实现；这是本地TypeScript BFF扩展，不修改Oxen内核、服务端或固定OpenAPI，也不新增Sample的split/config/tier归属字段。

## 数据组织

沿用项目现有耐久JSON控制面的工程模式，新增独立`dataset-view-registry.json`，逻辑上包含`view_template`、`release_template`、`dataset_split`及不可变变更历史。没有新建另一套Sample数据库或重构现有Sample／Dataset CRUD、导入校验。

|对象|实现规则|
|---|---|
|系统视图模板|固定tpl_golden／tpl_regression／tpl_holdout／tpl_public；只读，不允许改删或通过自定义同名覆盖。启动时可用，第一次目录写入时与完整注册表一起持久化|
|系统发布模板|固定标准对外JSONL、内部回归JSONL、季度Parquet三条；格式选项是发布配置，实际序列化复用发布物化模块，不在模板存储另建导出引擎|
|自定义模板|仅实例管理员新增、修改、删除；每项revision CAS、名称唯一；写入完整历史快照和宏观审计，删除不影响既有实例／Release快照|
|数据集视图实例|新Dataset由创建流程显式初始化四个默认实例；旧Dataset GET不自动建立视图。用户可空白创建、从模板创建、编辑、删除、重置或另存模板|
|模板／实例解耦|实例复制来源模板的实际字段与sourceTemplateId／revision；改模板不改实例，改实例不改模板；重置才显式读取当前来源版本。来源已删时拒绝重置，不能落到后来同名的新模板|
|发布配置快照|`snapshotRelease`复制当前视图实例和实际发布配置，保存模板名称及快照作辅助；临时format／视图选择／导出策略／card／checksums覆盖不写回模板或视图|
|旧项目区别|从未配置视图：configured=false、revision=0、views=[]，交由发布兼容分支。配置后删空：configured=true，不允许假装旧库退回全量导出|
|恢复门禁|`isConfigured`只查控制状态，不复制完整视图；`reconcileRequired`遇到已有视图发布但注册表缺失时503拒绝，须恢复同批控制面备份|

配置固定`default`，没有config管理界面或可变业务逻辑。视图元数据不修改源行、源truth、字段类型、人工意见或复核状态；独立Release快照须由发布服务结合数据commit和checksum冻结。

## 默认条件与实际字段差异

|视图|固定系统默认|
|---|---|
|golden|`"quality" = 'golden' AND "status" = 'active'`|
|regression|`"purpose" LIKE '%regression%' AND "status" = 'active'`|
|public|`"visibility" <> 'hidden' AND "status" = 'active'`|
|holdout|physical，无filter，hidden＋hash_only|

现有数据可能使用`gold`而不是`golden`、多选`purposes`而不是`purpose`、没有`status`。预览明确给出字段缺失／词汇差异及0命中，不把缺失当active，不自动改真实样本或模板。用户可以明确修改当前视图实例，例如改为`"quality" = 'gold'`，或`"purposes" LIKE '%regression%'`；该建议不等于自动采纳。

`<> 'hidden'`按附件定义包含internal，预览会报告其中internal数量供负责人核对受众，没有偷偷恢复旧版shared/public筛选。与此同时，普通源文件中遗留的`visibility=hidden`（含数组）或旧evaluation holdout声明，无论虚拟条件是否提到visibility，均从普通视图数据出口排除并提示显式物理迁移；不移动／删除源值。

## 安全谓词与预览

`dataset-view-filter.ts`只解释双引号字段、单引号文本、`=`、`<>`、`LIKE`与`AND`。支持双引号／单引号的成对转义，拒绝OR、脚本、函数、分号及注释。没有SQL拼接、eval或用户正则。字段ID上限500字符，值2048，整式16000，最多50个AND条件。

缺失／null在否定比较中也不匹配；字符串数组按成员匹配，`<>`必须所有成员都不相等。LIKE的`%`与`_`采用有界通配符匹配；`_`按Unicode码点，emoji不会被错误拆成两个UTF16单位。

累计扫描预算由内部构造器提供，HTTP不能提高：默认100万row visits、200万比较、128MiB比较文本、500万通配符步数、2秒截止。预览的全量选择和后续诊断共用预算；发布可与已有构建截止回调结合。任一预算超限整体413 `VIEW_FILTER_SCAN_LIMIT`，不返回截断计数。预览精确全表计数、最多前10条正文并限制2MiB；大记录造成的正文缩减有独立提示。物理预览只请求count／digest，始终不返回sampleIds、正文或文件名。

## 物理目录与权限

`{dataset_id}`展开为`sha256(namespace + '/' + repo)`，默认逻辑目录`holdout/<64hex>/`；不把命名空间斜杠、绝对宿主路径或原文件名带入目录。自定义physicalPath只能位于同一数据集安全前缀下；拒绝跨项目、`..`、重复分隔、反斜杠、百分号编码及控制字符。物理模板／实例强制无filter、hidden＋hash_only，发布临时覆盖也不能改data。实际独立目录权限、文件哈希、评测接口由物理隐藏存储模块实现，本模块不读取隐藏字节。

模板读取需已认证身份，写入需活动实例管理员。项目视图管理需项目管理员；预览／读取均复用当前主库源权限。服务写入前及原子替换前再次授权，按序列化锁校验CAS；权限在替换前撤销时旧文件和历史保持，不留下新定义。原子替换尝试后结果不确定则停止目录读取，不能降级全量导出。

注册表达到28MiB或历史／实例容量上限时阻止新写，保留全部旧历史。宏观审计只含动作、目标和revision，不写样本正文或筛选值；模板历史仅为受控元数据，不进入公开知识截图。

## API与代码

公共扩展前缀`/api/v1`，JSON沿工程使用camelCase。Dataset路径ID为`encodeURIComponent(namespace + '/' + repo)`，只编码一次。

|端点|请求／响应|
|---|---|
|GET /view-templates、/release-templates|`{revision,items,canManage}`|
|POST /view-templates、/release-templates|创建完整自定义定义，系统标志由服务端决定|
|PATCH /{kind}-templates/:id|完整定义＋expectedRevision|
|DELETE /{kind}-templates/:id?expectedRevision=N|当前模板revision，系统模板拒绝|
|GET /datasets/:id/splits|DatasetViewsState，包括configured／views／权限|
|POST /datasets/:id/splits/initialize|旧未配置库显式初始化，expectedRevision=0|
|POST /datasets/:id/splits|空白实例定义＋数据集视图expectedRevision|
|POST /datasets/:id/splits/from-template|expectedRevision、templateId、可选splitName|
|PATCH /splits/:id|`{expectedRevision,view}`|
|DELETE /splits/:id?expectedRevision=N|按数据集视图revision保护|
|POST /splits/:id/reset-to-template|`{expectedRevision}`|
|POST /splits/:id/save-as-template|templateName、可选description；仍需实例管理员模板权限|
|GET /splits/:id/preview?ref=main|保存实例的完整计数及受限预览|
|POST /datasets/:id/splits/preview|`{ref,view}`，临时预览不保存|

共享模型`packages/shared/src/dataset-views.ts`；服务`dataset-view-store.ts`；解析／统一源选择`dataset-view-filter.ts`；接口`dataset-view-routes.ts`。`selectDatasetViewSource`供预览和发布共用，避免两套筛选边界。

## 实际验证与边界

本模块12项合成测试通过，owned文件strict＋noUncheckedIndexedAccess检查通过，无生产build／dist写入、真实源或控制面修改。覆盖：可执行语法拒绝、Unicode／数组／null、计算预算、4+3默认模板、旧库不自动初始化、跨重启、系统不可变、自定义生命周期、实例解耦／重置／删除后保留、临时发布配置、物理路径和hash_only、并发CAS、配置删空与恢复门禁、替换前权限撤销、真实Fastify权限／全量计数／最多10条／物理不读正文及旧hidden排除。

命令：`npx tsx --test apps/server/test/dataset-views-r19.test.ts`，回执`.data/r19-views-tests.log`；类型回执`.data/r19-views-owned-type.log`。本模块未声称UI浏览器、官方原生物化、Parquet文件或生产部署通过，这些由整合验收另行记录。
