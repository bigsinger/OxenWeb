# R13 合成验收证据

2026-11-09，Asia/Shanghai。本目录只包含本地合成项目的截图和无正文/凭据的验收摘要。不是SaaS新增观察，不含四类真实benchmark内容。

- `field-visibility.png`：独立QA设置prompt时，“是否导出”勾选、“是否展示”取消；两者相互独立。截图处于保存前的明确可审阅状态，后续保存与表格/详情核对见实施记录。
- `label-editing-desktop.png`：桌面独立人工标签表单，显示单选/多选及已恢复的当前身份意见。
- `wide-table-narrow.png`：390px窄屏的宽表，已横向移动到人工标签列；红色表示标签未提交，正文列未被压缩。
- `deployed-field-settings.png`、`deployed-settings-context.png`：正式3001的合成项目，字段设置入口及默认复选框核对的页面上下文。
- `deployed-table.png`：正式3001的合成表格稳定渲染视图。
- `acceptance-summary.json`：完整回归、官方原生专项与部署构建树摘要，无真实样本成员索引。

浏览器合成写操作只发生于独立3012/5174；官方原生写操作只发生于独立3008的8条fixture。正式3001仅在既有3条合成项目读取，新构建部署后其HEAD未改变。新创建的QA页面与进程已清理，原人工下载接管页/服务继续保留，不将原下载标记通过。

详细动作、边界和日志位置见[实施记录](../../implementation-r13.md)。真实分层仍为[待确认提案](../../proposals/real-dataset-splits-r13.md)，无真实候选名单或正文进入本目录。
