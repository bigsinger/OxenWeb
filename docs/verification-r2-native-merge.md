# R2 官方 Oxen 0.67.0 原生冲突恢复验证

日期：2026-11-08。仅使用 `infra/oxen/bin/oxen.exe` 和完全合成文件；没有启动、修改官方 server 或内核，没有连接本地真实四个基准仓库。

## 隔离与可重复执行

运行 `node .qa/probe-native-merge.mjs`。探针在 `.data/r2-native-merge-check/<UUID>/` 新建独立仓库，每条 CLI 命令均传 `--config-dir <该 UUID>/isolated-config`。姓名与邮箱为合成值，关闭该隔离配置中的版本检查；没有写用户全局 CLI 配置，没有设置 remote、fetch、pull 或 push。

最终带断言的运行目录为 `.data/r2-native-merge-check/0fdebb12-fa05-40e2-9126-1bbfc6e1932d/`。每个场景的 JSON 保存命令、退出码、stdout/stderr、提交、父节点与合成内容；`commands.json` 保存完整顺序。第一轮探索证据在另一个独立 UUID 中保留，不混入最终断言结果。

## 实际步骤

每个场景从独立 `oxen init` 开始：添加基线文件并提交；`checkout -b source` 修改同一内容并提交；切回 `main` 修改相同内容并提交；执行 `merge source`，随后读取 `status`。

原生 CLI 的输出明确显示 `Found 1 conflicts` 和 `Merge conflicts: both modified`。**此时 merge 的退出码为 0**，不能把退出码 0 当成“已经成功合并”。BFF 必须核对实际冲突状态、最终提交及祖先关系。

| 场景 | 裁决步骤 | 结果 |
| --- | --- | --- |
| 文本取当前分支 | `checkout --ours same.txt` → `add same.txt` → `commit` | 当前分支文本被保留，工作树干净，生成双亲提交 |
| 文本手工裁决 | 写入新的合成文本 → `add same.txt` → `commit` | 自定义合成结果被保存，工作树干净，生成双亲提交 |
| 文本放弃合并 | `merge --abort` | HEAD 仍为合并前目标提交，文件恢复目标内容，工作树干净 |
| JSON 手工裁决 | 修改合成 `record.json` 的一个值 → `add record.json` → `commit` | 有效 JSON 被保存，工作树干净，生成双亲提交 |

父节点通过官方 `oxen node --node <新提交> --revision main --verbose` 的 `parent_ids` 验证，并断言恰好包含两侧提交，而非仅依靠 log 中出现源提交。

| 场景 | 原 source | 原 target | 裁决后提交 |
| --- | --- | --- | --- |
| 文本 ours | `2b9a66fc03599b0cb45d3a24747cdc1d` | `8e6578d57184399b01f3182b8da981e1` | `510d12c0efe3948176c48f0b133161c6` |
| 文本手工 | `ef6db71a438b67ac9c6e153422df40f2` | `a5a3ca811b6b78a76bd7385bed1b5764` | `ab69aca79ab6df8acf8f01ea0146b50c` |
| JSON 手工 | `ff9af4bb6d0e9acd771c854fe96ca89` | `fd89728860e6ffd2d2740435bcadc652` | `4c28bb099251b52b0eaa7a9b26813d2a` |
| 文本 abort | `cd4b8564411612d5bc08b11701590c46` | `851d7e1bb3553cb9e409400a238d4412` | 保持原 target |

## 支持边界与接入要求

本次证明固定官方 CLI 支持**本地普通文本及 JSON 文件**冲突后的取本侧、手工修改和双亲提交，以及放弃合并恢复。没有据此宣称所有表格格式、二进制、目录冲突、远端 push 或并发写入均已通过；这些必须另行验证。

## Web 裁决与本地服务真实推送补充

随后运行 `npx tsx .qa/verify-native-resolution.ts`，在独立配置和克隆目录中创建合成仓库 `local/r2-native-resolution-7feb0d7d`。验证官方服务端 `127.0.0.1:3002` 和固定 CLI 的完整链路：HTTP workspace 写入共同基线及两侧 JSON → 原生冲突检查 → 三方字段裁决 → CLI fetch/checkout/merge/add/commit → 验证双亲 → **只 push 源工作分支 `r2/source`** → HTTP 固定提交读回验证。没有改动真实四个基准仓库，也没有重启服务。

共同基线为 `101559a0cc4e8fc5023343148397a13d`；原源提交 `8fd68bcd8470c102c8b49c207cc02670`，目标 `7ecf95b914f9c57fdbd0e8722e11359a`。结果源提交 `f973b3b5c8c5f08d05e26a5bf562feb0`，恰好保留上述两侧父节点；目标分支仍为原目标提交。两个独立字段同时保留，冲突字段选择源值；读回文件 SHA256 为 `4140f6861543054a10805f7dae6f742aff40f4628c267295431389fe9d3514b4`。元数据证据位于 `.data/r2-native-resolution/7feb0d7d-0b17-4208-983a-18c0e5a9a81e/verification.json`，原生恢复元数据保存在该运行的 `control/native-merge-recovery/`。

这项补充证明本地官方服务上的普通 JSON 冲突可完成真实远端推送，不覆盖二进制、目录删除冲突或网络断线后的不确定推送。首次合成探针以 commit ID 作为官方创建分支的 `from_name` 得到404，按固定接口行为改为现有分支名后成功；失败仓库独立保留。BFF 裁决结果明确标记 `resolved-on-source`、`requiresReview: true`；更新比较快照并重新复核后才可最终合并目标。

Web 接入必须固定源、目标与基线提交，逐项裁决并验证完整覆盖实际冲突。规范、身份、原始真值和导入基线不允许通过自由文本改写；托管记录只能在允许的内容／标签字段内进行三方比较。提交前再次校验权限和 heads；裁决提交完成后核对双亲、内容摘要和实际写入分支，随后才可以确认 push 结果。

失败时在尚未提交的原生合并状态中使用 `merge --abort`；如果本地提交已经生成或 push 结果不确定，应保留隔离现场和恢复信息，不自动重置分支，也不能盲目重推或宣称目标未变。裁决改变样本、标注、附件或规范时，旧审核不能继续作为新内容的发布依据。
