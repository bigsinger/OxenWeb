# R8 项目维护与 0.1.0 交付

日期：2026-11-08。范围为原方案的数据管理与协作，所有功能在同一 `0.1.0` 工程版本内交付。本轮仅修改 TypeScript Web/BFF，没有修改官方 Oxen 0.67 server 或内核，没有操作四个真实 benchmark 项目的内容或标签。

## 项目维护

- 设置的危险区域提供可恢复移除。管理员先核对影响，再输入完整 `namespace/name`，后端重新检查 `project.admin`、分支/工作区状态摘要和移除 revision；不接受仅显示名称或旧确认状态。移除后从目录过滤，项目 BFF 路径返回410；管理员通过回收站、完整标识与记录 ID/revision 恢复。
- 这是本地 BFF 回收控制面，保留上游仓库、版本和未完成工作；不是 Oxen 原生删除或物理清理。直连官方服务仍须由部署方保护，不能把 Web 隐藏当成上游 ACL。
- 显示名称和简介可修改并版本化。卡片、项目标题、切换器和搜索采用显示名称；稳定仓库路径保留，避免损坏链接。固定契约下的本机 name-directory 存储没有可用的通用安全重命名能力，因此没有把改显示名称伪装成物理 rename。
- 概览 README 可直接编辑 Markdown、预览、核对差异、明确提交、查看分页历史和固定提交差异。新项目尚无数据集时也可先写 README。界面输入独立保留；本人有效样本草稿需先处理，README 不会顺带提交这些草稿。历史只读 README 及父版本，不为查看说明拉取整个大型数据集 diff。
- 常规设置移除手写标签。领域筛选采用数据集模板，再从主题、用途、样本形态、来源、语言和行业列表选择；样本模板可独立采用，不强制同时选择两层。模板/选项维护继续在全局治理，项目编辑只消费发布定义。

## 字段宽度、空项目与排序

“一键自动适配样本字段宽度”位于新增字段 ID 上方。从完整逻辑数据集中不放回随机抽取最多200条，按显示长度第85百分位、表头及中英文字符宽度估算权重；限制极长内容与嵌套访问预算。响应仅含字段统计与建议，不返回记录正文，也不调用模型。建议先填入未提交配置，可撤销或手调，明确保存后才生成版本。空字段按表头估算，抽样不是精确像素测量。

新项目数据编辑显示导入、手动添加首条及建立空数据集入口，不把尚未初始化显示为失败。初始化写受管空 JSONL、描述与稳定身份映射；手动样本随后沿用“编辑 → 私有草稿 → 明确提交”。首条尚未保存时即显示自身字段列；新字段自动出现，已经隐藏的列不会被强制展开。

新项目和已有数据集都可导入 CSV/TSV/JSONL/NDJSON/受管 ZIP。导入需检查清单、映射、固定分支预览、明确确认和提交；已有数据集追加，不覆盖规范源文件、人工意见或原附件。Skill 保持逐样本 ZIP，不执行内容。本人已有私有草稿时先明确处理，导入不会自动丢弃；实际新增权限、任务范围、类型、固定 HEAD 和预览指纹均由 BFF 校验。单次文件上限64MiB。

表头排序为升序 → 降序 → 清除。排序发生在完整过滤/查询及草稿合成之后、分页之前；数字按数字、布尔按布尔，缺失/null 有稳定位置。排序状态随本机检查点保留，不产生 commit。同页选择与本地新增字段不重新查询整表。

设计参考为一手资料：[GitHub 删除确认](https://docs.github.com/en/repositories/creating-and-managing-repositories/deleting-a-repository)、[GitHub Web 编辑](https://docs.github.com/en/repositories/working-with-files/managing-files/editing-files)、[AG Grid 内容与权重列宽](https://www.ag-grid.com/javascript-data-grid/column-sizing/)。本项目采用可恢复移除、抽样及本机输入保护，是本地设计，不冒充 SaaS 原生行为。本轮复用冻结 UI01/02/04/06/08/11，没有新增登录后 SaaS 调研。

## 验证证据

最终全套 `npm test`：322项，315通过、0失败、7默认跳过，日志 `.data/r8-tests-final.log`。最终 `npm run build` 包含前后端类型检查并通过，日志 `.data/r8-build-release.log`。从暂存源码树生成独立副本，不带本机 `.env`、数据或已装依赖，实际完成 `npm ci`、契约生成、构建和相同322项回归；最后的模板界面修复后再次独立安装、生成及构建通过。生成契约与原工程逐字节一致。日志 `.data/r8-clean-*.log`，综合回执 `.data/r8-evidence/verification.json`。没有将默认 live 跳过项冒充真实服务通过。

`scripts/r8-project-acceptance.ts` 使用官方0.67与新建合成库 `r8-project-acceptance-mw7tdcfk`。实际通过：README先于数据 → 0字节规范JSONL → 手动首条 → 追加两条JSONL → 全表排序后分页 → 自动权重 → README历史/diff → 名称简介 → 可恢复移除/410/目录隐藏 → 恢复3条。原规范文件仍为0字节，逻辑内容通过版本化覆盖记录保存。README提交 `ba7e2de0256e93154c5261ea0ebdc606`，空数据集提交 `44c1dd7e16b80a4e1a90c72c3f3d3200`，追加提交 `245751c285268d9d94048de6e661a33d`。回执 `.data/r8-native/verification.json`。

应用内浏览器仅使用独立合成夹具，实际核对：

| 路径 | 结果 |
| --- | --- |
| 新项目 → 数据编辑 → 手动首条 → 私有草稿 → 一次提交 | 成功，提交后本轮绿色；初始没有伪造示例样本 |
| README → 编辑 → 核对修改 → 提交 → 历史 | 真实版本与增删高亮可见，[差异截图](evidence/r8-project-management/readme-diff.png) |
| 名称/简介 → 保存 | 标题和顶部切换器即时更新，稳定路径仍为 `local/r8-empty-ui` |
| 独立项目模板 → 结构化标签 | 可只选项目模板，主题/来源/行业等列表可选，[选项截图](evidence/r8-project-management/structured-project-labels.png) |
| 危险区 → 两步 → 错误/完整标识 → 移除 → 回收恢复 | 错误标识禁用，完整标识可恢复移除，恢复卡片与数据；[确认截图](evidence/r8-project-management/remove-confirmation.png) |
| score 表头 | ascending、descending、none正确，降序首条qa-12/12，[排序截图](evidence/r8-project-management/table-sorted.png) |
| 未保存新增记录含新字段 | id/text/new_dimension当场可见，撤销新增后不改原样本 |
| 自动适配 | 12/12条、17字段，id/score=1，prompt=5.5；撤销回原配置，重新适配后明确保存成功，[评估截图](evidence/r8-project-management/auto-width.png) |
| 390×844导入面板 | 页面380px、面板352px，无整页横向溢出，[窄屏截图](evidence/r8-project-management/import-mobile.png) |

浏览器验证导入入口和限制展示，没有执行浏览器文件上传；实际JSONL追加由原生专项验证，CSV/JSONL/Skill ZIP通过合成路由回归。未将按钮出现计为文件上传成功。

本地正式3001已重启最终0.1.0构建。官方合成库实际显示3条样本，score升序首条为imported-one；README与历史可读，独立采用项目模板后设置标签入口即时更新。页脚为0.1.0，warning/error均0，见[正式表格](evidence/r8-project-management/live-sorted-grid.png)、[正式README历史](evidence/r8-project-management/live-readme-history.png)。重复失败验收库仅移入可恢复回收站；正式目录14项，四真实库不变。临时3005/5173已关闭，3001与官方3002继续运行。

## 工程发行

根工程、全部workspace、内部依赖和lockfile统一为0.1.0；API状态及页脚读取同一版本常量。GitHub CI执行干净安装、契约生成一致性、构建和测试。换机器步骤见[入门](getting-started.md)，功能变化见[更新记录](../CHANGELOG.md)，候选开源项目见[实际调研对照](research/open-source-alternatives-2026-11-08.md)。

发布使用显式源码白名单及暂存清单检查。真实数据、运行配置、CLI二进制、缓存、日志、私有回执和登录后的原始截图不提交。历史本地证据与公开合成截图的边界见[证据说明](evidence/README.md)。未强制添加被忽略的文件，未替项目所有者选择开源许可证，来源声明见[NOTICE](../NOTICE.md)。
