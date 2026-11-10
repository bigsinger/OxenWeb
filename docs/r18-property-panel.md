# R18 样本属性面板

日期：2026-11-09。范围：数据编辑的样本详情抽屉。本页记录 Web 层交互选择，不改变 Oxen 内核、OpenAPI 或冻结的 SaaS 事实。

## 参考依据

微软官方 [Visual Studio Properties window](https://learn.microsoft.com/en-us/visualstudio/ide/properties-window?view=visualstudio) 描述了所选对象的属性和值、类别和字母排序、类型对应的编辑入口、只读状态，以及当前属性的类型与说明区域。本文只借鉴该属性面板的信息组织方式；没有声称已对 Visual Studio 2026 的所有主题和像素作实机比对。

已有 Oxen SaaS 行号展开、上一条／下一条、关闭的观察继续复用 [UI05](knowledge-base/oxen-saas/interaction-catalog.md)。下列属性表、人工标注及证据分组均为本地实现选择。

## 实现

| 区域 | 交互与边界 | 本地代码 |
| --- | --- | --- |
| 身份与导航 | 行号打开非模态抽屉；切换行或上／下一条直接更新对象，不重载表格。焦点和无效输入保护沿用已有逻辑 | `DatasetWorkbench.vue` |
| 紧凑分组 | 内容属性、人工标注、信息与证据三个页签；方向键及 Home／End 切换。页签切换保留未完成 JSON 编辑 | `DatasetWorkbench.vue`、`DatasetWorkbench.css` |
| 属性／值 | 默认逐项可浏览，不逐个折叠。左侧 ID、显示名称、实际类型；右侧纯文本值。已配置但未设置的字段也列出；与 null、空字符串分别展示。表格隐藏不等于访问控制 | `DatasetSampleFields.vue`、`dataset-property-grid.ts` |
| 长文本与说明 | 六行或超过 480 字符的值提供展开和复制；JSON、脚本、链接始终作为文本。点击属性即在底部展示说明与类型。复制失败有可见提示，可手动选择 | `DatasetSampleFields.vue` |
| 字段定位 | 搜索 ID、显示名称、类型、说明；项目顺序或 A–Z。搜索仅在本机描述字段，不搜索记录值、不请求模型 | `dataset-property-grid.ts` |
| 人工标注 | 我的意见、片段／步骤、既有标签及其他标注者意见集中展示；原始字段、源真值与人工意见独立。权限、草稿和统一提交逻辑不变 | `DatasetWorkbench.vue` |
| 信息与证据 | 最后修改和操作人保留真实证据解释；固定版本、内容摘要、同源家族、附件和独立标注证据可查。不会以当前时间推测未知历史 | `DatasetWorkbench.vue` |

R17 表头拖动、像素列宽、个人布局 CAS 保存、跨页精确批量编辑与草稿检查点均保留。未执行真实样本写入、提交或发布。

## 验证记录

- 自动验证：`npx vue-tsc --noEmit -p apps/web/tsconfig.json` 通过；`npx tsx --test apps/server/test/dataset-property-grid.test.ts apps/server/test/dataset-grid-ui.test.ts apps/server/test/dataset-visual-layout.test.ts` 共 16 项通过。覆盖源字段／配置字段顺序、缺失／null／空文本、元数据搜索、原型键、长文本、类型选项别名、行详情切换／无效输入保护以及 R17 布局回归。
- 前端生产构建 `npm run build --workspace @oxen/web` 通过；Vite 仍报告既有的静态／动态混合导入与大 chunk 提示，本次未把它们描述为新增故障或已解决事项。
- 浏览器实际验证由集成验收单独记录：桌面与窄屏、连续切行、长文本展开／复制、搜索空态、键盘页签、JSON 草稿、人工标注及历史只读。代码存在不代表这些路径已实际通过。

主线程最终实测见[整体验收](implementation-r18.md)：默认18项、短字段复制和说明、搜索空态、连续切行、方向键页签、无效JSON保护以及390px／正式3001已验证；原生长文展开成功，但工具剪贴板完整回读未计通过。合成与原生证据、未重做的历史只读路径分别保留，不把单一类型检查当作全部交互验收。
