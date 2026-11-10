# R16 样本字段删除

这是 Web/BFF 扩展，沿用官方 Oxen 0.67 工作区与提交，不改 Oxen 服务端或内核。

| 行为 | 实现规则 |
| --- | --- |
| 删除尚未保存的新逻辑字段 | 仅移除当前表单中的字段输入，其他输入继续保留，不创建提交。 |
| 删除现有可编辑字段 | 输入完全相同的字段 ID 确认，当前所有条目移除此键和值，同时删除字段配置，合为一次明确的新提交。 |
| 受保护字段 | `split`、`quality`、`purposes`、`visibility` 四个全局预置字段，以及身份、来源、既有源真值和附件引用字段不能删除；项目设置保留禁用按钮与原因。 |
| 权限 | 同时校验 `read`、`schema.bind`、`data.edit`，暂存后、提交边界继续核对权限与分支 HEAD。 |
| 并发及未完成工作 | 继承字段语义变更的本人样本草稿和活动任务保护。失败不会丢弃草稿；其他字段未保存的配置输入先保留，成功后继续在新基点编辑。 |
| 历史与归档 | 当前有效记录通过 RowRecord 覆盖更新；原始表字节、身份映射、ZIP 及历史提交保持。删除字段不构成历史数据清除。 |
| 复核 | 内容哈希变化；既有标注记录保留作历史证据，旧内容哈希的意见不能成为新内容的有效审核证明。 |
| 全局字段的项目显示 | 名称、类型和选项在字段管理维护；项目可以继续设置排序、列宽、是否展示与是否导出。同步全局规则先载入表单，明确校验保存后形成版本。 |

## 本地接口

`POST /api/repos/:namespace/:repo/dataset/fields/delete`

```json
{
  "ref": "main",
  "expectedCommit": "固定的当前提交",
  "fieldId": "temporary_note",
  "confirmFieldId": "temporary_note",
  "message": "删除不再使用的样本字段"
}
```

返回新的 `DatasetFieldsState`。`capabilities.delete` 表示当前身份同时具备配置与内容修改权限；字段是否受保护另由 `protectedFields` 判断。

| 错误码 | 含义 |
| --- | --- |
| `DATASET_FIELD_DELETE_CONFIRM` | 确认字段 ID 不完全一致。 |
| `DATASET_FIELD_DELETE_PROTECTED` | 全局预置、身份、来源、附件引用或源真值受保护。 |
| `DATASET_FIELD_NOT_FOUND` | 此固定版本没有相应字段。 |
| `DATASET_VERSION_CONFLICT` | 分支 HEAD 已变化；没有把旧计划套用到新版本。 |
| `DATASET_FIELDS_DRAFT_IN_USE` | 本人仍有样本草稿，需先明确处理；表单输入与样本草稿不混为一次提交。 |
| `TASK_TEMPLATE_IN_USE` | 存在活动标注任务，先完成或撤销后再变更结构。 |

## 实际检查记录

2026-11-09，本轮新增 `apps/server/test/dataset-field-delete.test.ts` 的六项检查全部通过：501 条样本单次原子删除、无源值逻辑字段、旧表首次覆盖存储、受保护字段与确认/CAS、权限撤销与失败清理、实际 HTTP 草稿保留。与已有字段和全局目录检查合跑共 **25 项通过、0 失败、0 跳过**，日志仅本机 `.data/r16-field-delete-tests.log`。前端 `vue-tsc` 已通过。

`scripts/r16-dataset-fields-acceptance.ts` 默认只输出计划；用 `--execute` 才创建合成私有项目。本轮已于 2026-11-09 10:40:49 UTC 完成本机 BFF／官方 0.67 的实际合成 HTTP 验收，项目为 `local/r16-synthetic-fields-mw94rjov`，三条自建样本的真实字段删除、历史／源字节保留、保护／CAS 和全局字段展示／导出复选框均通过。该合成脚本不修改四个真实项目或全局目录，不运行样本归档。完整回归、浏览器证据及后续真实定义采用结果见[R16 总体验收](implementation-r16.md)。
