# JSONL 导入与版本化标签

本项目的标签配置、三级赋值和旧标注迁移结果，统一写入仓库内的 `.oxenweb/labels.json`，由真实 Oxen workspace 提交。该路径不属于 Oxen 内部 `.oxen` 目录；普通数据提交会继承标签文件，分支分别保存各自版本。

## 已导入的用户样本

| 项目 | 实际结果 |
| --- | --- |
| 本地仓库 | `local/prompt-injection-bench` |
| 文件 | `data/prompt_injection_bench.jsonl` |
| 数据量 | 2,000 行，14 列，1,476,731 字节 |
| 导入提交 | `b3264dd7e12a4153bfcdbb91637dedb0` |
| 验证标签分支 | `label-validation-1794066891776` |
| 标签提交 | `58df407006edfec0ca095b7bda0e4da0` |
| 后续普通提交 | `c4bb635957db9a1be278d99161f88bb6`；仍保留全部三级标签 |

样本内容视为不可信数据，不作为任何命令、提示或系统指令执行。原始文件没有改写；导入及提交在本项目自己的本地 Oxen 服务中进行。

预览逐行解析 JSON，保留嵌套对象、数组、布尔值、数值和 `null`。第 20 页（每页 100 行）的末行与原始第 2,000 行完整结构比较通过，没有只展示前 500 行。字段类型依据真实值推断，复杂结构标记为 `struct` / `list` / `json`。

## 标签模型

- 标签列：`id`、`name`、`type=single|multi|text`；单选和多选配置选项，各选项可带十六进制颜色。
- 数据集赋值：`scope=dataset`，不带路径或行 ID。
- 文件赋值：`scope=file`，指定仓库相对路径。
- 条目赋值：`scope=row`，指定文件及稳定行 ID。
- `values` 以标签列 ID 为键；单选/文本是字符串，多选是无重复的字符串数组。未知列、未知选项和错误基数均返回 422。
- 同一 scope/path/rowId 只有一个赋值记录；发送空 `values` 可删除该记录。删除标签列会同时删除对应值，并纳入同一提交。

JSONL 在全文件 `id` 均存在、为字符串或数字且唯一时，以类型和 ID 的哈希生成行身份，编辑其他字段或调整排序仍保留标注。缺少唯一 ID 时，退回规范化内容哈希加重复项序号。响应 `rowIds` 与 `rows` 一一对应，不覆盖用户自己的任何字段。CSV/其他上游表格优先使用 Oxen `_oxen_id`，否则使用内容及全局位置；修改身份字段或缺少主键时不能推断任意行重排的语义。

通过不同时修改标签文件的数据提交移除行时，其历史赋值保留在版本文件中，不会错误转绑到其他行，也不会阻塞其他标签保存；内置行编辑器可在同一提交中处理相关标注。新增赋值必须指向当前版本中存在的文件/条目。

## API

仓库前缀：`/api/repos/:namespace/:repo`。

| 方法与路径 | 作用 |
| --- | --- |
| `GET /labels?ref=…` | 读取指定分支/提交的标签文件与实际 `commitId` |
| `PUT /labels` | 保存完整列配置及赋值 |
| `POST /labels/columns` | 新增或更新一列 |
| `DELETE /labels/columns/:id` | 删除列及对应赋值 |
| `POST /labels/assignments` | 保存数据集、文件或行级赋值 |
| `POST /labels/migrate` | 将旧 sidecar 标注迁移成真实版本文件 |
| `POST /api/import/jsonl/validate` | multipart 文件预校验，返回行数及字段类型 |
| `POST /api/import/jsonl` | multipart 导入新/现有仓库并真实提交 |

标签写入都要求 `ref` 是分支并提供 `expectedCommit`；成功返回新的 `LabelState.commitId`。同一 BFF 的标签写入按仓库串行，检查目标分支和实际 workspace 基准，并在提交前再次检查。过期版本返回 `409 LABEL_VERSION_CONFLICT`。公开 Oxen API 没有客户端提供的全分支 CAS 参数；外部并发更新同一标签文件还由 Oxen workspace 合并冲突保护，不宣称实现了上游不存在的严格 CAS 接口。

导入字段：`file`、`namespace`、`repo`、`branch`、`path`、`createRepository=true|false`；现有仓库还要求 `expectedCommit`，新仓库可提供 `description`。新仓库初始化后可创建指定分支；现有仓库的目标分支必须存在。导入动作在任何仓库读写前调用授权 callback；普通 workspace 上传和文本编辑 `.jsonl/.ndjson` 时同样逐行校验。

文件上限 10 MB，要求 UTF-8，每个非空行必须是 JSON 对象。语法或类型错误返回 `error.details.line`（物理行号；可识别时也返回列号），校验失败不会暂存文件。

旧 `POST /annotations` 已停止写入并返回 410，避免继续产生不纳入版本的新标签；旧 GET 保留迁移兼容。迁移沿当前分支历史查找旧记录，将可唯一定位的行转换为稳定 ID；无法匹配的原记录保存在 `legacyMigration.unmatched`，不会误绑。迁移 ID 同时保存以防重复导入。

## 验证

```powershell
npx tsx --test apps/server/test/labels.test.ts
$env:OXEN_LABEL_LIVE_TEST = 'true'
$env:OXEN_SAMPLE_FILE = '<用户提供的 JSONL 绝对路径>'
npx tsx --test apps/server/test/labels-live.test.ts
```

离线 **6/6 通过**：嵌套值及编码/行号、版本文件及三级赋值、过期并发写入、选项/基数、上传前校验与 2,000 行分页、旧标注跨提交迁移、唯一 ID 编辑/排序及孤儿赋值保留。

真实 Oxen **1/1 通过**：样本导入、完整分页、三级标注进入 `.oxenweb/labels.json` 的提交 diff、main 与验证分支隔离、旧 expectedCommit 拒绝、标签提交前后行 ID 稳定、后续提交继承，以及重新创建 BFF 后从上游提交读取相同标签。最终该次检查约 3.9 秒。
