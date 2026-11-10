# R19合成界面与聚合验收

2026-11-10，Asia/Shanghai。本目录为本地1.1发布扩展的证据，不是Oxen SaaS观察。

|文件|实测内容|
|---|---|
|templates-desktop.png|独立合成目录另存ui_synthetic_golden后，可编辑自定义模板，系统模板仍只读|
|holdout-count-hash.png|2个独立合成文件的计数／摘要，预览不展示隐藏正文|
|release-published-desktop.png|浏览器创建CSV发布实例、物化并正式发布后的视图计数及5项产物|
|release-form-390.png|390px宽度下的创建表单；表格内部可滚动，无页面横向外溢|
|work-snapshot-view.png|public单视图工作快照，只生成1ZIP＋manifest|
|legacy-no-views.png|旧项目不自动创建视图，显示内部全量兼容及显式初始化入口|
|verification.json|最终570项回归、独立官方0.67、部署／健康、四真实库只读前后核对及浏览器聚合结果|

浏览器QA为独立3012／5174，仅合成记录和无执行行为ZIP。生产3001只读复核了模板页；未截图真实样本、复制令牌、自动迁移或发布真实数据。未点击本轮浏览器下载；原R11接管与3005／5173仍保留，不能由新夹具或程序读取冒充完成。临时QA服务已停止。

完整实现及边界见[主验收记录](../../implementation-r19.md)。
