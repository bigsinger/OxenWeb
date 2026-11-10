# R21：每个项目仅保留当前发布

日期：2026-11-10。按用户最新确认替代 R20 的历史保留行为。本地 BFF 改造，不修改 Oxen 内核、源提交历史、数据集原文件、样本草稿或真实业务数据。

## 保留规则

|对象|处理|
|---|---|
|dataset-v1 已发布整库版本|每个项目仅保留发布时间最近的一条；并列时依次按 createdAt、ID 降序稳定决定。旧 latest 标记不影响选择|
|旧已发布/withdrawn 记录|移除记录及分享，再清理该记录的发布资产；不保留历史下载兼容入口|
|其他旧模型的 release/snapshot|移除记录及发布资产，不再兼容旧分层包|
|dataset-v1 未发布草稿、ready、failed|保留；重启中的 queued/building 按既有故障恢复规则标为 failed|
|dataset-v1 内部工作快照|保留既有创建者和 data.export 权限规则，不对外分享|
|Oxen 源、提交、README、数据集文件、样本草稿|不删除、不重写，不属于本次清理范围|

新发布自动成为唯一当前发布（latest=true），替换本项目上一条发布。移除预发布选项与手工 latest 路由；请求携带 prerelease 会校验失败。撤回当前发布会移除其记录、资产和分享，项目暂时没有已发布版本。

## 发布说明与并发

草稿仍保存自动说明、作者最终说明及比较基线的版本和固定提交。构建可以读取被冻结的源提交，不需要旧 Release 记录继续存在。

实际发布前及最终串行持久化事务内，均检查草稿基线 ID 等于当前发布 ID（首版双方为 null）。另一人先发布后，旧基线候选返回 **409 RELEASE_BASELINE_CHANGED**，原草稿与人工说明保留，要求编辑、重新预览保存后再发。不会悄悄改掉作者文案，也不会让两个候选都以旧基线覆盖当前版本。

## 可检查的清理协议

只读函数 `inspectReleaseRetention(rootDir)` 不启动 ReleaseService、不写任何文件。返回：

|DTO|内容|
|---|---|
|projects|项目、保留 ID/版本、拟移除 ID|
|removeRecords|拟移除记录的 ID、项目、kind、status、version|
|candidates|仅 UUID 发布目录及 UUID 资产 ID 的清理队列|
|assetFiles|实际相对路径和文件大小，可生成维护前清单|
|blockers|未知文件、链接、非目录、越界等阻断原因与相对位置|
|totals|前后记录数、release/snapshot 删除数、资产数/字节、分享数、已有待清理数|

主任务应先执行真实根只读检查并记录，再完成同代备份/维护切换。开发验收只使用 `.data/tests`，不运行生产清理。

清理顺序：

1. 把所有已曝光的样本 ID、同源组 ID、附件 SHA256、内容 hash 合并进独立永久安全账本，耐久写入。
2. 在一次 records.json 耐久事务中：保存新当前版本、移除旧记录和全部旧分享、保存 UUID 清理队列及删除证明。此刻旧下载和链接已经失效。
3. 逐个检查并删除资产普通文件，然后移除空目录；不使用递归删除。
4. 清理成功后耐久移除 pending 项。中断后缺失文件被视为已完成，重新启动幂等续清。

未知名称、非 UUID 成员、子目录、符号链接/junction/reparse 或实际路径越界会阻断物理清理，保留未知内容。旧记录不会因此重新变得可读；当前发布返回 cleanupPending=true，维护人员可以通过只读计划查明原因。清理队列失败不回滚已经撤销的旧资产授权。

## 控制文件与恢复

|位置|最小结构与用途|
|---|---|
|`releases/records.json`|沿用 version=1；retention={version:1,revision,purgedReleaseIds,pending:[{namespace,repo,releaseId,assetIds}],exposureRevision,lastAppliedAt,lastError?}|
|`releases/exposure-ledger.json`|独立安全摘要：{version:1,revision,projects:[{namespace,repo,rowIds,familyIds,attachmentHashes,contentHashes}]}；不含旧发布说明、版本详情、样本正文、资产字节或令牌|

purgedReleaseIds 是仅含 UUID 的删除证明，用来阻止混入旧 records 的记录复活，不是可浏览下载的版本历史。曝光摘要不能因删除旧记录而丢失，否则已发给他人的样本或同源组会错误地变成“从未曝光”。两个控制文件和资产根必须同代备份。账本缺失、损坏或 revision 小于 records.retention.exposureRevision 时启动失败，不能按空账本继续。

恢复旧备份时，启动按同样规则先规范化旧记录、撤销旧链接并执行清理。保留的源提交不受影响。丢失账本或混合代次不自动降级；恢复人员必须核对同代控制文件。

## 实际验证

`.data/r21-retention-tests.log`：**7 项通过、0 失败**：

- 只读计划前后 records 字节相同；日期决定保留项，旧 latest 不覆盖日期；旧模型、withdrawn 和旧快照被删除，新草稿/内部快照保留。
- 第二次发布移除第一版记录、资产目录、分享，同时 Oxen provider 存储逐字节不变；自动说明仍比较替换前的固定提交。
- 未知文件阻断时旧记录/分享已经失效；模拟部分文件已删后重启安全续清。
- 实际 NTFS junction 指向合成外部目录时不删目标，待清理状态可检查，无跳过测试。
- 两个并发候选恰好一个发布成功，另一个 409；失败草稿及作者说明保留，可重新核对基线。
- 安全账本缺失/旧代均拒绝启动；把已删除 ID 混回记录并伪造未来发布时间也不能复活。
- prerelease/latest 入口移除；撤回删除当前发布并保留永久曝光摘要。

合并保留的整库/字段/ZIP/写入边界回归后，`.data/r21-release-final.log` **31 项通过、0 失败**；server TypeScript `--noEmit` 通过。

R20 的标准 ZIP、字段导出、README/标签、故障恢复和授权检查继续回归。主任务统一记录真实只读检查、复制根演练、维护切换、全量回归与浏览器验收；本文不把未执行的生产维护写成通过。
