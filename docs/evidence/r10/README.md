# R10 合成界面证据

来自本机独立 `local/ai-safety-ui-qa` 合成项目，以及最终编译版3001上的`local/r8-project-acceptance-mw7tdcfk`合成项目和宏观维护日志。不含四类真实benchmark正文、账号秘密或原始令牌。浏览器会话仅用于本地功能回归，没有向SaaS上传真实记录。

| 文件 | 可核对内容 |
| --- | --- |
| [access-management.png](access-management.png) | 访问管理入口、范围/角色/有效期和摘要目录；没有原始token |
| [global-audit.png](global-audit.png) | 项目/治理/权限宏观日志、筛选、时间、actor和项目对象 |
| [field-option-colors.png](field-option-colors.png) | 已保存的自定义选项色及自动分配色，配置与样本编辑分离 |
| [unknown-result-preserved.png](unknown-result-preserved.png) | 合成远端提交成功但回复丢失后，保留私有输入并提示核对 |
| [operation-reconciled.png](operation-reconciled.png) | 只读提交标记核对成功，保留固定结果锚点，没有再次提交 |
| [narrow-sample-drawer.png](narrow-sample-drawer.png) | 390px抽屉与下一条样本导航，当前样本qa-2；窄屏抽屉覆盖表格，使用抽屉上一条/下一条 |
| [credential-context-cleared.png](credential-context-cleared.png) | 合成双标签页、同actor不同项目凭据：原页刷新身份后清空旧样本，正确显示无权限；不是项目请求故障 |
| [final-local-service.png](final-local-service.png) | 最终编译版3001：合成3行、时间倒序、操作人、系统记录不导出、完整字段和别名；正文及表头实际14px |
| [final-global-audit.png](final-global-audit.png) | 最终编译版3001：4条真实宏观停写/恢复事件；不包含样本正文和凭据 |

完整步骤、限制和真实测试数量见 [R10实施验收](../../implementation-r10.md)。浏览器下载受到审批拒绝的事实保留，截图中的“可下载”只代表服务构建就绪，不代表实际落盘成功。

[可移植验收摘要](acceptance-summary.json)只保留工程版本、计数、时长、哈希及未完成条件，不含原始令牌、源记录或私有意见正文。本机详细执行日志和恢复副本仍在忽略的`.data/`与`.backups/`中。

## 最终编译版界面复验

2026-11-09，应用内浏览器，`http://127.0.0.1:3001`，1280×720。页面标题“Oxen Web · 数据协作工作台”，有实际项目/表格内容，没有框架错误覆盖层；明确重新加载后读取的error/warn为0。初次携带QA端口的旧会话时，正式服务正确拒绝私有项目；通过现有“使用本机所有者身份”清除旧会话后恢复开发者owner，未创建新凭据或扩大任何人员授权。

- 点击`imported-one`序号打开详情，再直接点击`imported-two`序号，详情一次更新；表格宽度前后均1230px。
- 关闭抽屉，系统时间升序使`manual-one`在先，倒序使较晚导入的两行在先；正文、别名、系统列及“不导出”说明正常。截图为倒序状态，抽屉未打开。
- 顶部“访问管理”、页面“我的令牌”（标题“我的访问令牌”）和“操作日志”均实际读取成功；当前正式部署尚无已发放人员凭据，目录0项是实际空状态，未为演示发放真实权限。日志读到4条停写/恢复事件。
- 合成项目保持固定源HEAD`d3ec343ab4cf`，没有新提交；只更新本人工作台导航/排序检查点。390px布局、颜色编辑及回复丢失交互由上方QA场景提供独立证据，不把它们说成在正式项目中又执行了写入。

最终合成项目页面保留供负责人查看；仅关闭agent创建的QA页，核对脚本归属后停止3005/5173临时服务。正式3001/3002继续运行。浏览器实际ZIP下载仍未通过，不用服务端资产读回代替。
