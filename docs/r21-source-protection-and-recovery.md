# R21：通用源保护与最新发布恢复

日期：2026-11-10，Asia/Shanghai。根据用户明确取消旧发布兼容、已发布版本只留最新的要求，本轮删除R20只读归档模块及其专属测试，不再加载视图registry、模板、冻结物理库或旧资产DTO。旧轮文档保留当时事实，不代表当前入口。

## 通用项目保护

`SourceAccessMarkers({filename})`仅维护`source-access-markers.json`中的`{version:1,repositories:[{namespace,repo}]}`。它不包含发布、样本、视图、模板或分层配置，也没有产品API、删除入口或样本内容读取功能。

|接口／状态|行为|
|---|---|
|`init()`|严格、有界读取通用标记，损坏／重复／危险身份拒绝启动|
|`isRestricted(key)`|配合既有全局字段管理和sticky权限策略，维持完整主库访问边界|
|`retainRestrictions(keys)`|可信维护程序耐久合并，串行写入；不会清空既有项目保护|
|空列表初始化|显式`retainRestrictions([])`仍落一个权威空文件，不是删除已有列表|
|缺失文件|保守保护所有项目源数据，直到可信维护程序核对并显式初始化；不会当作普通无保护项目|
|不确定写结果|返回错误并阻断后续保护查询；重启后核对耐久状态，不能给出已保存或降权|

首次使用团队权限前，管理员必须显式初始化源保护marker。新安装可在核对控制目录和空环境后初始化空列表；已有实例应在维护窗口核对并保留原来受限的项目身份后再初始化，不能因配置丢失盲写空文件。Live模式不自动进行空初始化。Demo模式只为合成环境显式初始化，已有保护列表仍保留。维护入口见[运行手册](operations-runbook.md)；没有新增网页权限或产品功能。

维护命令`npx tsx scripts/ops-source-access-init.ts`默认只读。停止BFF、核对新空策略后可用`--execute --initialize-empty`；保留已有项目用可重复的`--execute --retain namespace/repository`。活动租约阻止执行，操作只增不删。源保护文件丢失必须恢复同代备份，不能用empty绕过。

普通算法／QA访问源数据仍受原项目完整主库边界约束；项目管理员及明确获准读取受限源的身份维持原资格。取消旧视图和清除发布记录不会放开原文件、搜索或历史。

## 当前备份与恢复

active控制备份由旧registry／物理库改为通用marker；`releases/`一起保留当前记录、资产、最新保留策略、删除证明和永久曝光安全摘要。原始样本、Oxen对象、任务／复核、草稿／检查点、凭据撤销和匹配构建校验继续遵守原冷备流程。

|对象|恢复校验|
|---|---|
|已发布版本|每个项目只保留最新`dataset-v1`发布|
|未发布草稿和内部工作快照|当前格式继续保留，打断构建恢复为failed|
|旧格式、旧已发布或已撤回版本|按只读retention计划与持久UUID删除证明核对；接口404，活动资产文件不存在|
|分享链接|被清除版本的链接移除；保留版本的链接恢复后全部撤销|
|永久安全摘要|已曝光身份／哈希与revision单调保留，删除下载版本不等于从未曝光|
|保留资产|仍严格核对同代SHA／大小及实际BFF下载，不能把损坏误报为有意删除|

`recovery-control-acceptance.ts`使用`inspectReleaseRetention()`读取同代备份的预期保留计划，再核对活动副本的记录集合、删除墓碑、清理队列、资产不存在、404与安全摘要。它不启动旧功能，也不为被清除版本重建包。

`ops-recovery-acceptance.ts`只装配当前控制源；退役registry或物理库即便存在旧备份，也留在离线bundle。旧代若含退役控制源但缺通用marker，则拒绝作为当前在线恢复，要求先完成显式权限迁移并生成当前代备份。保留离线备份文件不等于重新上线旧记录。

## 实际验证与边界

仅使用`.data/tests/`新鲜合成目录，包含真实`createColdBackup`、`restoreBackup`和`ReleaseService`调用：

- generic marker并发合并、空初始化、重启、危险／过大配置、原子替换后应答失败、缺文件时保守关闭、权限边界及当前冷备恢复。
- retention恢复验证最新发布保留、旧记录及资产有意删除、分享处理、当前内部快照、打断构建、保留包损坏、墓碑缺失和安全摘要回退。
- `settings-access.test.ts`的条件Live夹具在自己的`mkdtemp`控制目录显式创建空marker；没有在真实控制目录操作。

定向8项测试实际全部通过，回执`.data/r21-source-recovery-tests.log`；设置权限Demo回归6通过／1个条件Live跳过，记录`.data/r21-settings-access-tests.log`；strict＋noUncheckedIndexedAccess检查记录`.data/r21-source-recovery-type.log`。Live夹具此次只改代码，未执行其真实服务分支。

本子任务未运行生产备份、恢复、发布清理、build或部署，未删除任何真实物理样本或资产。维护窗口的实际清理与浏览器结果由本轮主验收单独记录。
