# 本机只读样本划分分析

当前四维候选入口为`run-four-dimension-candidates.ts`，默认仅打印计划，`--execute`才读取本机固定版本；不写真实split／quality／purposes／visibility。复用并认证R14派生关系，按同一私有种子输出严格实体／关键成员隔离及guard比例对照两组CSV／JSONL和train／dev／test／暂缓清单。实际结果、当前源变化、质量复核预算、比例和残留泄漏见[R17报告](../../docs/research/real-dataset-four-dim-candidates-r17.md)。成员、隐藏索引及种子只在忽略的`.data/r17-four-dim-candidates/`；当前active目录任意变动不追改这些固定分析切点。

R14工具，仅供已获授权的数据负责人在本机运行。Oxen官方内核、服务端与固定OpenAPI不变；不启动BFF应用，不初始化或修改项目策略，不创建workspace，不调用CLI，不写真实分组，不发布包。

## 输入与执行

本轮固定四个`local/benchmark-*`项目的main和旧`local/prompt-injection-bench`别名。复用`DatasetService.read`及已校验的治理快照，还原规范源文件、稳定身份映射、已提交正文覆盖、人工意见及独立评测元数据；不使用私有草稿，不把导入行数当作当前有效成员。

```powershell
# 固定当前不可变版本，输出字段结构/数量，不输出正文。
npx tsx scripts/analysis/profile-readonly.ts
$analysisRunDirectory = (Get-Content -LiteralPath .data/r14-split-analysis/run-directory.txt -Raw).Trim()

# 无--execute仅输出范围计划；带开关才读取已获授权的本机数据。
npx tsx scripts/analysis/run-readonly-analysis.ts
npx tsx scripts/analysis/run-readonly-analysis.ts --execute --directory $analysisRunDirectory

# 从已有派生候选与指纹生成报告；不访问网络或原始正文。
npx tsx scripts/analysis/write-analysis-report.ts --directory $analysisRunDirectory
```

输出固定在`.data/r14-split-analysis/<run>/`，Git忽略。`fingerprint.key`和`allocation.key`只在本机保管，不能跟随候选清单外发。这里包含隐藏候选的稳定成员定位；算法/QA仍只消费另行批准的非隐藏发布包。

HTTP守卫只允许配置中的loopback `:3002`同origin GET，禁止重定向和写方法；Provider代理只开放读方法。开始固定分支与三项控制面切点，重用run时必须相同；结束核对HEAD、源字节及控制文件是否变化。并发推进须另建run或重新审阅，不能自动覆盖他人的版本。

## 检查和候选的含义

- `text-families.ts`：带命名空间的来源/case/parent关系、完整文本精确摘要、实体遮盖/变量模板及有界词法候选；敏感实体和局部文本摘要均使用域分离HMAC。
- `skill-families.ts`：有界ZIP/CRC/大小/声明摘要/路径校验，保留精确包与成员集合，根`_expected.json`和实际payload分开。嵌套归档不展开，任何文件均不执行、不安装、不跟随链接。
- 主脚本将已发现强关系形成hard族；模板/词法/配对候选仅形成guard保守隔离组，不提升为人工已核准同源。泛化授权规则、粗类别、语言和单独公共样板不直接连族。
- 未解析配对、源结论疑似不一致、归档检查失败或无法核对的已发布曝光，沿整个guard组暂缓。正常/攻击最小对照允许在同族出现，不能据此报truth冲突。
- `candidate-allocation.ts`：整组分配，曝光强制共享、blocked暂缓，旧别名计数权重0。按行目标优化总量、粗类别及细分层，确定性局部搜索不声称全局最优。
- `boundary-overlap.ts`：仅用派生HMAC核对实体/关键成员在共享与隐藏之间的直接交叠，另计算严格相等指纹传递分量及整组行数可达性；不把相等实体/公共辅助代码自动认作同源。报告生成器另给Skill严格成员隔离的替代候选，并检查200行与140/60联合类别目标的可达性；当前两类且无blocked/曝光约束的前提显式断言。
- 金标/回归只从拟共享池选，先分粗类别配额，再分层及按证据/边界排序；允许交叠，不把源truth或`review_status=complete`当本系统独立复核。无有效复核时，正式可发布数为0。

词法扫描有字符/采样/倒排桶/比较数量上限；报告必须保留跳过和截断计数。不能把“已发现关系跨边0”当作语义、翻译或第三方预训练无污染证明。

`--reuse-features`仅供已经有`feature-cache-manifest.json`的同一run：核对指纹文件、HMAC密钥、源pins及两模块SHA后复用特征；有效记录和控制切点仍重新核对。首次未建此清单时直接重新读取即可，不允许绕过一致性检查。该缓存只影响分析耗时，不修改数据语义。

## 产物与校验

`candidates.csv/jsonl`含固定提交、系统稳定样本ID、hard族、guard组、拟议范围/用途、暂缓原因及固定版本定位链接。另提供金标、回归、隐藏、拟共享及暂缓各CSV和主要JSONL。CSV防公式注入，原始身份以JSONL为准。`families.json`和`evidence.jsonl`提供成员关系，真实正文不进入这些清单。

`artifact-checksums.json`校验派生文件。`pins.json`/`read-only-verification.json`记录来源和只读核对；`report.md`给负责人阅读。工程公开文档只收录聚合与源版本摘要，不能复制隐藏成员表、源值、实体、包指令或密钥。

合成测试由根`npm test`自动包含。模块专项覆盖归档边界、HMAC/模板语义、跨库整组隔离、类别配额、暂缓/曝光、别名权重与CSV防公式；真实运行另在本机完成不变量和产物SHA检查。当前结果及限制见[真实候选审计](../../docs/research/real-dataset-split-candidates-r14.md)。
