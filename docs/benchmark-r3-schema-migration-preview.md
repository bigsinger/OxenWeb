# 四个真实基准库 R3 分层规范迁移预览

状态：只读预览，待主线程审阅后显式执行。未更改真实仓库、规范目录或标签赋值。

后续执行记录：主线程已审阅该精确计划并在R3正式BFF上执行。四库采用提交及源数据/旧标签校验见[R3实施验收](implementation-r3.md)。以上状态描述的是当时预览阶段；原计划与固定读取点保留，不改写为事后生成的预览。

预览文件：`.data/r3-schema-migration/2026-11-08T08-19-33-451Z-9dd7bf/preview.json`
计划校验：`fee05376ccf23890d21909eb0292e5a5531e30a00708fa57653fcdccff9d385e`

| 仓库 | 固定 main 头 / 回退读取点 | 样本 | 原标签列 | dataset/file/row 赋值 | 活动任务 | 拟采用样本模板 |
| --- | --- | ---: | ---: | --- | ---: | --- |
| local/benchmark-sensitive-data | `8e5048e44b326026b171e0be8473ecc3` | 2000 | 20 | 1 / 0 / 0 | 0 | r3_sample_sensitive@1 |
| local/benchmark-behavior-drift | `67274cf4a266c6c8f919930fa19c561` | 1719 | 21 | 1 / 0 / 0 | 0 | r3_sample_drift@1 |
| local/benchmark-prompt-injection | `bf5a99e7c4b9c9824f4a716f5874305b` | 2000 | 20 | 1 / 0 / 1 | 0 | r3_sample_injection@1 |
| local/benchmark-skills | `12acf2740484ee521bdd64244ae8724b` | 1000 | 21 | 1 / 0 / 0 | 0 | r3_sample_skill@1 |

共同采用 `r3_dataset_ai_safety` 数据集模板；宏观六维度仅 dataset。各样本模板默认4–6项，扩展项折叠。旧37字段池和旧选项值进入历史兼容区，不删除、不改名、不自动升格为新数据集值。

规范采用只写 `.oxenweb/schema-binding.json`。原 JSONL、原始归档和导入清单 SHA256 与固定导入版本一致；此字节级比较覆盖原始 truth。数据集标签的新赋值仍为空，JSON 中的 `suggestedDatasetDraftOnly` 只是显式待确认建议，不会由此脚本写入。没有创建任何样本判断或完成审核。

当前绑定及每列ID/语义键/类型/层级、新模板选项、默认显示维度和任务/审核影响见完整JSON；没有原记录正文。实际采用样本层前需处理活动任务。已有审批不自动变成新规范下的审批；旧证明不改写。

执行（必须先重启为R3新BFF，由主线程审阅该精确预览后手动运行）：

`npx tsx scripts/r3-benchmark-schema-migration.ts --apply "F:\bigsinger\OxenWeb\.data\r3-schema-migration\2026-11-08T08-19-33-451Z-9dd7bf\preview.json"`

执行会再次核对四库名称、main heads、目录revision、所有源SHA及任务，然后通过规范服务另存/发布与层级采用API串行执行。任一前置条件变化即停止；部分已完成会保留并打印元数据，需要重新预览后恢复，不盲目覆盖。实际新发布checksum以真实规范服务为准，语义内容必须与审阅计划一致。

回退读取点是每库原head，代表可复核的旧版本，不承诺自动重置分支。需要恢复采用关系时由负责人生成新的受控元数据提交；不能删除历史提交或更改原truth。
