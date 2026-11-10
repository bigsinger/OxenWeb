# R11 合成界面证据

日期：2026-11-09。仅包含本机合成数据、界面控件及工程校验摘要，不包含真实benchmark正文、Cookie或原始令牌。

| 文件 | 观察结果 |
| --- | --- |
| [download-gate-awaiting-user.png](download-gate-awaiting-user.png) | 原固定合成工作快照及ZIP资产页面；用户明确授权后浏览器审批仍拒绝，等待用户手动完成。页面“可下载”不代表浏览器已落盘 |
| [field-export-settings.png](field-export-settings.png) | 默认勾选的description已取消并明确保存；源字段仍存在，开关仅作用于正式Release |
| [field-export-mobile.png](field-export-mobile.png) | 390px字段设置，恢复后默认勾选可见，页面无横向溢出 |
| [version-restore-preview.png](version-restore-preview.png) | 固定基点/目标、完整文件动作及保留访问策略说明 |
| [version-restore-confirmation.png](version-restore-confirmation.png) | 自定义说明、项目/分支二次输入和明确按钮；文本框Enter不会提交 |
| [version-restore-mobile.png](version-restore-mobile.png) | 390px恢复弹窗，可滚动且无页面横向溢出 |
| [version-restore-committed.png](version-restore-committed.png) | 新恢复提交、父提交及export字段高亮删除，旧历史未重写 |
| [version-restore-unknown.png](version-restore-unknown.png) | 真正提交后回复丢失，输入保留、禁止重复提交并提供新页核对入口 |
| [version-restore-reconciled.png](version-restore-reconciled.png) | 实际固定标记核对成功、原commit锚点；不是再次执行恢复 |
| [version-restore-history.png](version-restore-history.png) | 核对后历史为11条，仅新增一次；其余两次恢复和原字段提交仍在 |
| [deployed-version-entry.png](deployed-version-entry.png) | 最终编译版3001上的既有合成项目恢复入口；只读核对，没有在正式实例执行恢复 |

本轮范围和实际通过/未通过结果见[R11实施记录](../../implementation-r11.md)。

[安全验收摘要](acceptance-summary.json)保留构建哈希、真实测试数、完整恢复计时与下载未通过状态，不含样本正文或凭据。R10旧备份被日保留替换的事实与本轮最新代分开记录。

字段与恢复来自独立3012/localhost:5174，原固定下载来自3005/127.0.0.1:5173。分离用于保留用户手动下载会话，不在新服务或其他通道重新下载被拒绝的资产。截图不能代替正式Release字段投影/回导、原生恢复、权限与故障专项。
