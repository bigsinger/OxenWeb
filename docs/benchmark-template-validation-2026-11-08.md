# 2026-11-08 Benchmark 模板与版本化标签联调记录

本记录仅包含仓库、计数、提交、路径、摘要和配置规则，不包含样本正文、敏感值、攻击文本、Skill 指令或原始判断理由。导入基线见 [benchmark 导入记录](benchmark-import-2026-11-08.md)，字段与接口定义见 [AI 安全标注设计](ai-safety-annotation-design.md)。

## 真实服务结果

本机 BFF `http://127.0.0.1:3001` 返回 `mode=live, ready=true`，上游 Oxen 为本地真实服务。四个私有仓库均在导入提交之后应用匹配的版本 1 模板；模板定义、来源、数据集元数据和仓库说明均真实版本化。共 **6,719 条**源样本，原始字段及基准真值没有被模板替换或重新解释。

| 仓库 | 模板 | 样本数 | 标签列 | 模板来源记录 | 数据集／文件／条目赋值数 |
| --- | --- | ---: | ---: | ---: | --- |
| `local/benchmark-sensitive-data` | `sensitive-data@1` | 2,000 | 20 | 1 | 1 / 0 / 0 |
| `local/benchmark-behavior-drift` | `behavior-drift@1` | 1,719 | 21 | 1 | 1 / 0 / 0 |
| `local/benchmark-prompt-injection` | `prompt-injection@1` | 2,000 | 20 | 1 | 1 / 0 / 0 |
| `local/benchmark-skills` | `skill-supply-chain@1` | 1,000 | 21 | 1 | 1 / 0 / 0 |

数据集只填写四项：

- `data_source = 用户提交`。
- `task_type = 安全评测`。
- `risk_category` 分别为 `[敏感数据]`、`[行为偏离]`、`[提示词注入]`、`[供应链]`，描述该数据集的领域。
- `annotation_guideline` 记录源 ZIP 名、`data/samples.jsonl` 入口和原始真值解释，明确人工标签独立保存。

没有填写 `review_status` 或 `human_judgment`，没有将原始审阅字段当成当前人工审核已完成。敏感数据中的 `ground_truth` 对象，提示词注入中的原始标签与嵌套字段，行为偏离的场景、轨迹和审阅字段，Skill 的原始 `_expected.json` 与清单中的 `ground_truth` 均保持原样。存在敏感信息不等于存在恶意意图。

仓库仍为 private，原有导入所有权标记与说明保留；仅追加领域、条目数和标注入口说明，以及 benchmark、ai-safety 和领域模板标签。

## 提交证据

每个仓库在固定导入提交之后恰有四次新提交：① 模板列与来源记录，② 数据集元数据，③ 仓库说明与标签，④ 发布前的条目级上下文字段范围调整。第 1、2、4 次 diff 只有 `.oxenweb/labels.json`，第 3 次只有 `.oxenweb/repository.json`。逐项核对父提交顺序；模板应用没有分拆成逐列提交。

| 仓库 | 不可变导入提交 | 模板提交 | 数据集元数据提交 | 完成后 main |
| --- | --- | --- | --- | --- |
| sensitive-data | `e62533a53924797ec1a8788fc90bac13` | `d7efcc2c08bd422f57b38b8ecb35cd20` | `34c21a106abdbc28bd116f651c19e974` | `8e5048e44b326026b171e0be8473ecc3` |
| behavior-drift | `b50d4a4cde6d76ff63cc586cb1dafc89` | `e155ae3710f5158c0f7cdf559d8c9864` | `209fad9a435f675f55f90d34f46489e8` | `67274cf4a266c6c8f919930fa19c561` |
| prompt-injection | `a84fec826f0eb02ab08add7d4fa2791c` | `a2a2394d44c7c8e8376929b5053304c8` | `6a4fc9fd54e8466e45849272dd51a20` | `9bf7a63f224eaea012986f0b6fc01531` |
| skills | `ca2e5129e9380840f7a9b89e5f828e64` | `bb91b61e07d95eb0d035b1a180f0785a` | `54b658a66597b96ce31eeb8720bff3a1` | `12acf2740484ee521bdd64244ae8724b` |

范围调整分别将数据来源、任务类型，以及对应领域的技能来源／审核建议、基线目标／版本增加 R 层级。每个仓库只发出一次 `PUT /labels` CAS 批量更新，提交说明为 `Refine copied preset scopes for per-item source, task and case context`。没有增加维度或选项，没有改写自定义列名、现有选项、模板来源和任何赋值；每个 Skill ZIP 以及每个行为偏离案例都可独立填写这些上下文。该调整属于本次尚未发布的版本 1 默认规范定稿；已复制配置的修改是显式提交，不是目录自动同步。

| 仓库 | 范围调整前（仓库说明提交） | 增加 R 的语义键 |
| --- | --- | --- |
| sensitive-data | `eea0740452e2af09f76f4dc0a24fde5f` | `general.data_source`、`general.task_type` |
| behavior-drift | `2d86306e5ced57993ce04a643022e1f4` | 上述两项、`drift.baseline_goal`、`drift.baseline_version` |
| prompt-injection | `7bf645123340833aa6285fbe2521d2d6` | `general.data_source`、`general.task_type` |
| skills | `eb9b16eec3a2ce77f0ef987fce87a2e4` | 上述两项、`skill.provenance`、`skill.recommendation` |

## 源数据与导出核验

完成后固定提交与不可变导入提交的完整字节比较均通过，比较对象为每个仓库的 `data/samples.jsonl`、`source/archives/<源 ZIP>` 和 `bundle-manifest.json`。这验证了原始真值在内的整个规范文件未被改动，而不是仅抽查若干记录或统计值。

| 仓库 | 规范 JSONL 字节数 | 完成后 SHA-256（与导入基线相同） |
| --- | ---: | --- |
| sensitive-data | 6,119,823 | `1e4a108fa7b4fe5a0424fac373154f040b0c997f0fa35187bb8d76872623e758` |
| behavior-drift | 36,449,317 | `7d1283520119e0b24b65d527d84b1352e184199195037b8b6fab46769c819b13` |
| prompt-injection | 1,897,415 | `01ed451f5a036f20dc8e9bdc6fa079a817b4a312f13db2033eb904732b5633bb` |
| skills | 1,120,404 | `18957f84c1052053479b37efc90eeb877776a95c64590e093a9ff3a24cdbac30` |

对四个仓库分别调用 `GET /api/repos/local/:repo/labels/export?ref=<完成后提交>`，确认附件头、`format=oxen-web-label-snapshot`、`version=1`、仓库身份、`fixedCommitId`、完整列、完整赋值和模板来源与同版本 `/labels` 一致。再以 `ref=main` 读取，确认它解析到当时的相同提交；导出前后的 main 不发生变化。

导出仍是标签快照，不合并原始样本，不含未保存草稿，不是评测报告。条目关联应使用相同固定版本预览返回的稳定 `rowId`，不能用显示行号猜测。

## 调用方式与复核工具

工具为 `.qa/verify-benchmark-templates.mjs`。它限制 loopback BFF 和四个明确仓库名，先核对完成的导入状态及固定版本 SHA，再串行调用模板、数据集标签与设置接口。每次写入使用该次读取的 `expectedCommit`；不发送记录正文到外部服务，不输出或保存原始记录。

```powershell
# 只复核现有模板、元数据、提交、导出和完整摘要，不写仓库
node .qa/verify-benchmark-templates.mjs

# 授权初始化／恢复这四个仓库的模板与数据集元数据
node .qa/verify-benchmark-templates.mjs --apply
```

元数据证据输出为 `.qa/benchmark-template-validation.json`，包含全部提交、摘要和断言结果；重试保留最初成功写入的提交证据。已配置相同内容时不会新增重复模板或元数据提交。工具同时核对六项条目上下文字段的 R 范围与四次提交的顺序。导入状态 `.data/benchmark-import/import-state.json` 保留原固定导入提交，没有改写为后续标签提交。

## 联调中修复的问题

行为偏离数据的规范 JSONL 为 36.4 MB。第一次应用模板时，标签服务为验证历史引用调用完整提交详情，意外触发历史导入的结构化 diff 25 MB 限制，返回 413；这次失败发生在创建标签 workspace 之前，没有写入或伪报成功。

标签服务现在优先使用提供方的元数据引用解析能力，固定版本读取和导出不再为了取得提交 ID 展开历史大文件 diff。新增自动化测试令完整提交详情故意失败，确认固定引用标签读取、模板写入和导出仍走元数据路径。修复后四个仓库的真实调用与只读复核全部通过。

该记录证明本地真实服务的模板／标签／导出和数据完整性；浏览器交互验收在独立合成仓库进行，不向这四个基准仓库写入虚构的人工作业结论。
