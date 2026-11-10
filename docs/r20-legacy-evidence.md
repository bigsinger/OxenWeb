# R20：移除发布视图后的历史安全证据

日期：2026-11-10，Asia/Shanghai。用户最新要求将发布改为完整数据集发布与自动变更说明；本文记录取消R19视图／模板／物理隐藏操作后的最小历史保留边界。这是本地BFF实现与合成验收，不是新的SaaS观察。

旧`dataset-view-filter/routes/store`、`physical-holdout`及其路由、共享视图／隐藏导入类型和旧专属功能单测已移除。没有保留模板初始化、筛选DSL、实例CRUD、隐藏导入或评测正文接口。旧视图发布物化和UI由对应模块同时移除，历史R19研究文档与当时验收结果保留。

磁盘上的`dataset-view-registry.json`、`holdout/`、历史发布记录、冻结证据和资产没有删除、迁移或改写。备份与恢复仍按同一代保留这些文件。

## 唯一只读历史模块

`apps/server/src/legacy-publishing-evidence.ts`提供：

|方法|边界|
|---|---|
|`new LegacyPublishingEvidence({registryFile, holdoutRoot})`|只指向现有归档路径|
|`init()`|有界读取旧registry的项目身份，生成受限主库Set；验证现有隐藏catalog、index、普通成员文件与SHA，不创建目录或数据|
|`isRestricted(key)`|同步权限标记查询；旧空视图配置仍为受限主库|
|`reconcileRequired(keys)`|历史1.1发布需要的registry记录丢失时503，不退回普通源读取|
|`reconcileHoldouts([{key,snapshot}])`|验证冻结身份、原完整成员元数据、revision及digest，跨项目或成员缺失失败|

模块不公开样本内容、文件名、视图定义或模板。启动时仅收紧已有根目录的文件权限并验证后代权限；不更改索引或成员字节。Windows使用.NET ACL接口，拒绝重解析点和意外读取主体；POSIX要求归档成员无组／其他用户权限。目录、索引或权限不能可靠确认时停止启动。

容量保护为registry读取前32MiB、单项8MiB、归档扫描全程120秒／10万次检查／1GiB读取预算；超限整体失败，不返回截断结果。冻结对账使用索引Map避免逐成员反复线性搜索。没有引入SQL、模型请求或新的Sample字段。

权限条件仍是原有完整主库边界：普通算法／QA读者不能借助取消视图访问旧主库、原文件或历史；管理员和明确获准读取隐藏主库者保留原访问资格。已配置但后来删空的旧项目不会降级。

## 恢复工具适配

`recovery-control-acceptance.ts`不再请求被移除的视图／模板API。旧registry的模板、实例、空配置与历史按备份原始字节及完整JSON核对；旧Release私有`memberships`、`frozenHoldouts`、固定配置和指纹在磁盘核对，不送入DTO。

|记录种类|恢复后的行为|
|---|---|
|`dataset-v1`新发布|正常资产下载与SHA读回；打断构建恢复为failed并增加revision|
|历史1.1发布|只读；已发布资产继续按原权限下载；旧配置从DTO移除，在raw证据完整保留；不重建产物，不修改历史queued/building状态|
|更早旧发布方式|DTO显示只读／legacy、资产为空、latest=false；保留资产原文件并核对SHA，下载／分享接口410|
|所有分享凭据|保留身份与范围证据，恢复后全部撤销；不会恢复已外发令牌|

`ops-recovery-acceptance.ts`保留registry／holdout显式映射和原构建指纹、隔离根及源摘要校验。Oxen恢复副本仍在本次独立WSL目录，BFF控制文件装配在本次本机新目录；ACL须在已存在的还原根重新确认，不因历史功能已取消而跳过。

## 实际验证

独立合成测试只使用`.data/tests/`新目录，结束时检查路径仍在该目录内再清理；没有访问真实样本或生产服务。

- `legacy-publishing-evidence-r20.test.ts`：原始字节保持、空配置与trusted-master权限边界、缺registry／冻结证据／成员失败、损坏及未登记文件失败、身份与路径校验、后代额外读取权限拒绝、过大registry提前拒绝。
- `recovery-control-r19.test.ts`已适配R20：真实ReleaseService同时覆盖新发布与历史1.1、旧方式410、分享撤销、打断的新构建、退休资产损坏、DTO隐藏后的raw配置篡改、宽权限还原根拒绝。
- 两组定向合成测试实际10／10通过，回执：`.data/r20-recovery-evidence-tests.log`；strict＋noUncheckedIndexedAccess检查通过，记录：`.data/r20-archive-recovery-type.log`。

这些是只读归档与恢复校验器的合成证明；没有运行生产冷备份、完整生产代恢复、修改真实存储、构建dist或部署，不能替代后续实际运行验收。
