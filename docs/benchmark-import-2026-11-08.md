# 2026-11-08 本地 benchmark 数据导入记录

本记录只保存结构、计数、路径、校验值和操作约定。样本正文、提示词、凭证示例、Skill 内容、判断理由不写入文档或发送外部服务。源目录为 `E:/temp/benchmark样本`；四个原始 ZIP 均保持原样。

## 范围与导入映射

| 源 ZIP | 新建私有仓库 | 条目数 | 原始文件数 | 主要结构 |
| --- | --- | ---: | ---: | --- |
| Enterprise Sensitive Data benchmark.zip | local/benchmark-sensitive-data | 2,000 | 1 | 8 个原始字段，保留 `id` 和 `ground_truth` |
| intent-deviation-v1.0.0.zip | local/benchmark-behavior-drift | 1,719 | 4 | 46 个原始字段，稀疏字段保留，`uid` 映射为 `id` |
| prompt_injection_bench.zip | local/benchmark-prompt-injection | 2,000 | 1 | 14 个原始字段，保留 `id`、原始标签和嵌套 `meta` |
| Skill样本_V1.1.zip | local/benchmark-skills | 1,000 | 7,441 | 每个样本目录重新封装为一个 ZIP，每个 ZIP 对应一行清单 |

总计 **6,719 条**。已有 `local/prompt-injection-bench` 等仓库不在本次写入范围；四个新仓库统一以 `data/samples.jsonl` 作为可预览、标注和查询的数据源。

每个仓库包含：

- `source/archives/<原始 ZIP 名>`：源 ZIP 的逐字节副本。
- `source/files/<原始成员路径>`：前三类的原始 JSONL 及随包的 README、manifest、checksums，文件字节保持不变。
- `data/samples.jsonl`：标准化的查询与标注入口，JSON 字段值和嵌套结构保持不变；原始排版在 source 中保留。
- `packages/skill-NNNNNN.zip`：仅 Skill 仓库具有，每个原样本目录对应一个包。
- `bundle-manifest.json`：版本、来源、映射约定、逐文件 SHA-256 与大小，以及每个 Skill 包内成员的来源和 SHA-256。

前三类在原始字段之外加入保留字段 `__bundle_provenance`，记录原始 ZIP 名和哈希、成员路径、物理行号、原始标识字段及值。源数据若已有该字段则拒绝导入，禁止覆盖。企业敏感数据和提示词注入数据沿用原 `id`；行为偏移数据没有 `id`，其 `uid` 的 1,719 个值全部唯一，因而新增 `id = uid` 并保留原 `uid`。`case_id` 只有 1,642 个唯一值，不能作为条目标识。

Skill 行包含 `id`、`package_path`、`package_sha256`、`package_bytes`、`file_count`、`uncompressed_bytes`、`ground_truth` 和 `__bundle_provenance`。`id` 来自原目录名。`ground_truth` 逐值保留根目录 `_expected.json` 的 `result` 和 `reason`，不推导其他攻击类别或人工判断。每个 ZIP 根目录均有 `SKILL.md`、`_expected.json` 以及原目录内全部文件。重打包只固定 ZIP 时间为 1980-01-01，文件权限为普通文件 0644、目录 0755；成员文件字节逐一核验一致。26 个内嵌 ZIP 保持不透明，不递归解包。

## 原始结构核对

企业敏感数据的字段为 `benchmark_id`、`benchmark_group`、`benchmark_group_zh`、`benchmark_target_category_match`、`benchmark_target_categories`、`id`、`text`、`ground_truth`。`ground_truth` 包含 `categories[]`、`has_sensitive_info:boolean`、`sensitive_values[]`、`sensitive_spans[]`。原 `id` 和 `benchmark_id` 分别都有 2,000 个唯一值；五个 benchmark_group 各 400 条。

行为偏移数据的 46 个字段包括来源、场景、原始目标、可信上下文、攻击载荷、授权规则、轨迹、验证证据和审阅信息；缺失、null、数组和对象保持原样。`scenario_type` 的计数为 benign 798、attack 921；`review_status` 为 complete 1,719。`evidence_level` 为 derived 154、constructed_probe 85、observed_trace 1,480。原始 JSONL 为 37,257,351 字节，保留单文件；此类 JSONL 的本地读取和专用导入上限为 64 MiB。

提示词注入数据的字段为 `id`、`label`、`label_name`、`text`、`lang`、`attack_family`、`attack_subtype`、`source`、`source_id`、`source_category`、`source_dataset`、`expected_detection`、`split`、`meta`。原始 benign/malicious 各 1,000 条；train/dev/test 为 1,600/200/200。此 ZIP 中 JSONL 的 SHA-256 与之前桌面样本集一致，但本次仍新建独立仓库。

Skill 有 1,000 个 `packages/skill-NNNNNN/` 目录，每个均有根 `SKILL.md` 和 `_expected.json`，每个目录有 2–15 个文件。原始 `_expected.result` 为“恶意”700 条、“正常”300 条；`reason` 保留而不在本文展示。目录内 Python、shell、环境文件、字节码、依赖清单和 Skill 指令一律仅作为数据，不运行、不安装。

完整字段类型和出现次数保存在被 Git 忽略的 `.data/benchmark-import/profiles.json`。

## 原始 ZIP SHA-256

| ZIP | 字节数 | SHA-256 |
| --- | ---: | --- |
| Enterprise Sensitive Data benchmark.zip | 1,406,491 | `61b766e9879222e5308374bbf468d243764838b90f68f0bcb445fdfb5279e79d` |
| intent-deviation-v1.0.0.zip | 2,831,329 | `1ec543a14743f12a390e84e9f10f44ed839555d7d624c08495d1fd9e0a9c7c9b` |
| prompt_injection_bench.zip | 309,307 | `4521d2e5555e63789326d2f8c882595228790afad408e07cf4857478d4da620d` |
| Skill样本_V1.1.zip | 5,404,691 | `56756f84a5c1ebbdadc4cde4f2fe6d4355cd2b14a794b47f3ec4840b52b0cefc` |

原始 JSONL SHA-256：

| 数据 | SHA-256 |
| --- | --- |
| 企业敏感数据 | `eb475f3b6ae87d9da49f5ada38f91411030d8e86c8c7ee4582ada951eba708ef` |
| 行为偏移 | `655f437562ff8f2c10e1dc143e964c615bcc2bcdc3f810d7bcfd23bf5f443ea9` |
| 提示词注入 | `f9a1f1514b6ebe5b049bde307c87d53625c02628f3d7947f47470c9c9a5b4a4d` |

## 暂存及验证

暂存计划 SHA-256 为 `305bfcb2dc752a67e5bcec41916a480cf4ade5ecf295d0b1ca4efbbbb6b825c0`，目录为 `.data/benchmark-import/staged/305bfcb2dc752a67/`。源文件及导入记录均在 `.data/` 下，由项目的 Git 忽略规则排除。

| 仓库 | data/samples.jsonl 字节数 | SHA-256 | 导入文件数（含清单） |
| --- | ---: | --- | ---: |
| benchmark-sensitive-data | 6,119,823 | `1e4a108fa7b4fe5a0424fac373154f040b0c997f0fa35187bb8d76872623e758` | 4 |
| benchmark-behavior-drift | 36,449,317 | `7d1283520119e0b24b65d527d84b1352e184199195037b8b6fab46769c819b13` | 7 |
| benchmark-prompt-injection | 1,897,415 | `01ed451f5a036f20dc8e9bdc6fa079a817b4a312f13db2033eb904732b5633bb` | 4 |
| benchmark-skills | 1,120,404 | `18957f84c1052053479b37efc90eeb877776a95c64590e093a9ff3a24cdbac30` | 1,003 |

验证顺序为：读取 ZIP 中央目录 → 拒绝路径穿越、绝对路径、符号链接、重解析路径、大小写冲突、加密文件和异常压缩比例 → 有界读取及 CRC 校验 → 严格 JSON 解析（重复键、非标准数字拒绝）→ 条数和标识唯一性核对 → 原始记录与标准化记录逐行语义比对 → 包内文件逐一哈希核对 → 源 ZIP 导入前后哈希一致。

默认上限为每 ZIP 100,000 个成员、总解压体积 1 GiB、单成员 128 MiB、压缩比 1,000、JSONL 单条 16 MiB、最多 1,000,000 行。这里的解包/读取上限用于离线暂存；前端普通上传、原始文件下载等接口仍使用各自明确上限。

## 执行与恢复

```powershell
# 只读取目录、大小和哈希，不导入
python scripts/benchmark-bundles.py

# 有界读取，统计结构；不输出样本正文
python scripts/benchmark-bundles.py --profile

# 安全暂存、重打包、逐项验证；不写 Oxen
python scripts/benchmark-bundles.py --stage

# 归档边界、JSON 严格解析、字段保留、内嵌 ZIP 不执行的回归检查
python scripts/benchmark-bundles-checks.py

# 新建四个私有仓库，通过官方 Oxen CLI 导入并回读验证
python scripts/benchmark-bundles-import.py
```

导入器只接受本机 loopback BFF/Oxen 地址。BFF 创建私有仓库及权限策略提交，然后在 `.data/benchmark-import/clones/<repo>/` 使用官方 CLI：

```text
oxen clone http://127.0.0.1:3002/local/<repo> <repo> --branch main
oxen remote -v
oxen status
oxen log --revision main -n 1
oxen add .
oxen commit -m "Import benchmark bundle <source-sha-prefix> (<count> samples)"
oxen push origin main
```

执行前检查 origin、工作区干净和初始远端 main。复制不触碰 `.oxen`、`.oxenweb`，保留 BFF 创建的私有策略。提交后核对本地 HEAD；push 前再次确认远端仍为已记录基点，变化即停止；push 后核对远端等于本地提交。这是客户端前置比较检查，CLI 没有跨 BFF 与上游的一次原子 CAS；本次使用全新专属仓库，避免并发写入。

`.data/benchmark-import/import-state.json` 持久记录新仓库所有权、基点、进度、提交和验证结果，可重复运行恢复；已有同名仓库但没有本次所有权状态时拒绝写入。未知改动、错误 origin、变化的 HEAD、哈希不符均停止，不自动覆盖或清理。命令使用参数数组和 `shell=False`，有超时与输出上限。

导入完成后，通过 BFF 的不可变提交引用回读 `bundle-manifest.json`、原始 ZIP 和规范 JSONL，比较完整 SHA-256；再以文件预览核对实际服务端条数。标注模板由独立的模板接口在导入提交之后应用，不能替换或猜测原始 ground truth。

## 远端结果

四个新私有仓库均已通过官方 Oxen CLI 完成导入；服务端真实 JSONL 预览条数、规范文件完整哈希、原始 ZIP 完整哈希及清单完整哈希均已回读核对通过。

| 仓库 | 不可变导入提交 | 服务端条数 |
| --- | --- | ---: |
| local/benchmark-sensitive-data | `e62533a53924797ec1a8788fc90bac13` | 2,000 |
| local/benchmark-behavior-drift | `b50d4a4cde6d76ff63cc586cb1dafc89` | 1,719 |
| local/benchmark-prompt-injection | `a84fec826f0eb02ab08add7d4fa2791c` | 2,000 |
| local/benchmark-skills | `ca2e5129e9380840f7a9b89e5f828e64` | 1,000 |

这些提交代表导入时的数据快照；随后应用标注模板可能推进 main，不改变上述不可变引用。详细、可恢复的执行状态保存在 `.data/benchmark-import/import-state.json`，其中只记录来源哈希、文件数量、条数、提交和验证结果，不记录样本正文或令牌。

验证补充：5 项归档/字段安全回归检查全部通过；导入器重复运行返回四个 `already-complete`，未重复提交或写入已有数据。

公开文档中的个人工作站路径已泛化；实际样本和本机原始记录未随代码发布。
