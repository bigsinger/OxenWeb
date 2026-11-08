# R2 审核证明树、固定提交与原生合并验证

日期：2026-11-08。版本：本地官方 Oxen CLI/server **0.67.0**。只使用本机服务 `127.0.0.1:3002` 上独立的合成探针仓库；没有改动四个真实基准仓库、官方内核或主服务进程。本文只保存路径、提交、大小、摘要及结论，不保存用户样本正文或鉴权材料。

## 结论与适配边界

在本轮测试中，**共同基线已经包含非空 `.oxenweb` 托管元数据，再把每份证明放在 `.oxenweb/reviews/<unique-id>.json`，可以保持两个分支的目录、原始字节和受控 CLI 克隆一致；原生合并后两份证明仍完整保留**。`reviews` 不必预先存在：只有 `.oxenweb/probe-metadata.json`、没有 `reviews` 的基线也通过了完整验证。

这是固定版本和合成用例下的兼容性证据，不能宣称官方所有目录布局均已修复。README-only 基线的反例仍然存在；历史更深层证明目录也已有不一致证据。BFF 应核对**实际选定 base commit** 中的托管元数据，不能仅检查项目当前 HEAD 或一个空目录，也不能跳过列出的文件发生的 404。Settings 初始化主线不会使旧提交自动具有这些前提。历史 `storagePath` 仍应按原路径读取，不因新布局而丢弃。

## 三个受控布局用例

分支分别只提交一份 46 B／47 B 的合成 JSON 证明；所有 SHA256 均由实际字节计算。目录通过固定 commit 读取，自己的证明须 200，另一分支证明须 404；目录列表正确还不足以证明原生克隆正确。

| 共同基线 | 合成仓库 | 两分支固定目录与 raw | 生产路径 clone | 结论 |
| --- | --- | --- | --- | --- |
| 只有 README，新建整个 `.oxenweb/reviews` | `local/r2-flat-proof-probe-1794111877343` | reviews 叶目录和 raw 分别正确，但左侧 `.oxenweb` 子目录引用右侧 reviews | 左侧 clone HEAD 正确，物理工作树却包含右侧文件 | **失败，必须保留反例** |
| 已有 `.oxenweb/probe-metadata.json`，无 reviews | `local/r2-flat-seeded-parent-1794112244688` | 两侧正确隔离 | 左右两侧 HEAD、文件名、字节 SHA 均正确，工作树干净 | 通过当前用例 |
| 上一基线再加 `.oxenweb/reviews/.keep` | `local/r2-flat-seeded-reviews-1794112246657` | 两侧正确隔离 | 左右两侧 HEAD、文件名、字节 SHA 均正确，工作树干净 | 通过当前用例，但 `.keep` 非必要 |

生产克隆精确采用 `clone <local-url> <new-directory> --branch <left-or-right>`，**没有 `--all`**。最初也观察了 `--all`，随后专门以实际 BFF 使用的命令重测；本表以无 `--all` 的结果为准。

| 布局 | left 提交 | right 提交 |
| --- | --- | --- |
| README-only | `98c8f331a42bee689f7dfbfdcc250e95` | `6b534430b387e3d4f431cab990104a14` |
| seeded-parent | `bc1aa9b8cc718442d4f898028a69c7bd` | `f2055259290123092a1cb9b1b1e0c80a` |
| seeded-reviews | `f29fcf19f8e05b4bbaef247efc7d8227` | `d5e40149e8ec58ead6f6560bd55b72f` |

两成功布局的左证明 SHA256 为 `82d92ef52957e1d408f94386d02ec9e884c2ea74f852b691eb03fbd08ba84624`；右证明为 `b252d9acce07bc9f83ce2daded2efcea778ff02c8b8f87b7ade27ed0df3981e0`。

元数据证据：`.data/r2-flat-tree-probe/r2-flat-proof-probe-1794111877343.json`、`.data/r2-flat-tree-probe/seeded-variants-1794112248717-complete.json`。原生克隆现场独立保存在该目录下，未当作 BFF 正式克隆。

## 无 reviews 基线的实际原生合并

本次执行 `node .qa/probe-flat-proof-merge.mjs`。该脚本针对固定合成现场，成功后 left 已推进；再次运行会明确拒绝旧初始 head，重做测试需先建立新的等价 seeded fixture，不能覆盖既有证据。脚本只接受上述合成仓库名称前缀，使用新的 UUID 现场和独立合成 CLI identity 配置；没有写全局用户配置。实际步骤为：精确生产命令克隆 left → plain fetch → 准备 right 固定 head → checkout left → merge right → 检查 clean 状态及双亲 → 只 push 合成 left → 固定提交 HTTP 读回 → 新生产命令克隆 left 再次校验。

合并提交 **`9f5f95ec50c12c7572ebc65ae589a6d3`**，通过 `oxen node --node <commit> --revision left --verbose` 验证双亲恰为 `bc1aa9b8cc718442d4f898028a69c7bd` 和 `f2055259290123092a1cb9b1b1e0c80a`。合并后的两份证明 HTTP 均 200，分别为 46 B／47 B，SHA256 与合并前完全相同；新克隆 HEAD 为该合并提交，两个文件的实际 SHA 一致，工作树干净。

完整命令和元数据证据：`.data/r2-flat-tree-probe/native-merge-87b8610d-f89c-4f9a-bbb3-6349f18565c8/verification.json`。本项证明非冲突的合成审核证明可以经官方 CLI 合并、推送和读回；不替代工作流权限、双人裁决、发布审核的端到端验收。

## 为什么不采用通用 CLI／hash 遍历兜底

官方源码固定为 commit [`0d3045335f93d77171f95f599a3cee3a080622ae`](https://github.com/Oxen-AI/Oxen/tree/0d3045335f93d77171f95f599a3cee3a080622ae)。

- [`oxen ls`](https://github.com/Oxen-AI/Oxen/blob/0d3045335f93d77171f95f599a3cee3a080622ae/crates/oxen-cli/src/cmd/ls.rs) 使用 `--commit`，没有 `--revision`，且复用目录读取链，不是独立可信树来源。不能据命令名字假设它可纠正 HTTP 树。
- [`oxen node --node <hash> --verbose`](https://github.com/Oxen-AI/Oxen/blob/0d3045335f93d77171f95f599a3cee3a080622ae/crates/oxen-cli/src/cmd/node.rs) 可读实际 Merkle 子节点，但 README-only 反例中，左 `.oxenweb` 节点 hash `a4b5c6ac04660501b953ed8f35336f53` 的子 VNode 实际引用右 reviews `6cfbd66ad22479f2c5eab842f9967fd7`。直接 hash 图本身已不一致，不能作为通用修复手段。
- 官方 [`tree/nodes/hash/{hash}` 路由](https://github.com/Oxen-AI/Oxen/blob/0d3045335f93d77171f95f599a3cee3a080622ae/crates/oxen-server/src/services/tree.rs) 返回节点元数据；[`node_to_json`](https://github.com/Oxen-AI/Oxen/blob/0d3045335f93d77171f95f599a3cee3a080622ae/crates/oxen-server/src/controllers/tree.rs) 不带 wrapper children，不能直接遍历完整子树。其 JSON 中 u128 hash 还是裸数字，JavaScript `Number` 解析有精度损失，不能从它重建 hash。
- [`compare/entries`](https://github.com/Oxen-AI/Oxen/blob/0d3045335f93d77171f95f599a3cee3a080622ae/crates/oxen-server/src/services/compare.rs) 的浅层结果可能仅显示变更目录；本轮也观察到父目录比较没有叶项而更深目录有实际 add/remove。因此浅层计数不能代替完整性验证。

以上为原版 0.67.0 的本地观测及源码定位，不宣称定位到或修复官方根因。适配范围应保持为已验证的自有证明布局；遇到不一致必须显式失败或要求初始化／迁移，不能伪造缺失内容或静默忽略。
