# R15 合成界面验收

2026-11-09，Asia/Shanghai。仅包含独立合成QA及正式服务已有合成项目，没有真实benchmark正文、成员清单、凭据或新增SaaS截图。

- `labels-after-id.png`：桌面表格id之后即人工标签，编辑按钮保留。
- `visible-fields-auto-fit.png`：当前取消prompt展示、搜索列表只剩prompt，实际适配仍为其余16个字段。
- `labels-narrow.png`：390px窄屏的标签列和宽表内部滚动。
- `deployed-label-order.png`：正式构建保留已有score/text/id顺序，再显示人工标签、evaluation及系统记录。
- `acceptance-summary.json`：499项回归、类型/构建、实际浏览器及受控更新的脱敏摘要。

执行步骤、撤销与隐藏边界、数据/协议未变的范围见[R15实施记录](../../implementation-r15.md)。分层存储的研究与当前实现区别见[说明](../../research/dataset-partition-storage-r15.md)。原人工下载接管页仍保留；本轮无下载，不据此改变原落盘验收结论。
