# R13 源字段是否展示

日期：2026-11-09。本地Web/BFF扩展，复用冻结SaaS字段设置与数据编辑的交互层级；不新增SaaS观察，不修改Oxen官方服务端、内核和OpenAPI。

项目设置 → 样本字段，在“是否导出”下方提供“是否展示（数据编辑表格）”。默认勾选。负责人取消并明确保存后，该源字段不显示于数据编辑表格；设置本身仍列出它，方便恢复展示。详情、源数据、检索和导出独立保留，“是否导出”继续单独控制正式Release中的字段投影。列隐藏不是访问控制，也不是评测隐藏集。

契约为`DatasetFieldMetadata.visible?: boolean`，未提供和true都表示可在表格展示，false表示项目表格不展示。旧定义不迁移、不自动写true；新标志只有显式修改和保存时进入版本化描述。权限、expectedCommit和配置提交沿用已有`schema.bind`保护。

该属性属于纯展示配置，和宽度、顺序、选项颜色一样从`semanticDatasetFields()`移除，不改变源规则、样本私有草稿的schema哈希或独立复核指纹。保存后已有样本草稿仍须显式同步新基点，不能自动覆盖并发正文或规则变更。原始输入检查点支持true/false恢复，宽度撤销和排序还原保留独立的展示、导出选择；移除字段配置时明确说明两项均恢复默认勾选。

当前R13新描述可能包含visible字段；R12旧BFF的严格描述校验不识别它。因此升级和恢复仍使用识别该契约的同代构建，不能直接将旧BFF连到已写入R13描述的控制面。本模块未操作真实样本或真实项目配置。

模块验证：

- `field-visibility.test.ts`新增3项，覆盖默认与严格布尔、导出选择独立、检查点外部变更恢复、列宽/顺序撤销、源JSONL与稳定ID不变、隐藏字段仍可检索、复核/schema哈希不变、样本草稿显式同步及同值不建新提交。
- 联合`field-metadata`、`sample-field-config-ui`、`sample-field-checkpoint`、`field-order`、`dataset-fields`、`release-field-projection`共42/42通过，0跳过/0失败。日志`.data/r13-field-visibility-tests.log`。
- 前端`vue-tsc --noEmit`、服务端`tsc --noEmit`退出0；本模块diff检查通过。日志`.data/r13-field-visibility-{web,server}-typecheck.log`。
- 数据表项目可见性边界、个人列偏好和浏览器整体验证由R13集成记录补入；本模块测试通过不冒充页面已实际观察。
