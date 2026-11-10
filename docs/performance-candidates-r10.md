# R10 性能候选：未实施

日期：2026-11-09。本文是只读排查和后备设计，不是已上线优化或性能承诺。正式容量运行期间没有修改下述服务端、共享协议或负载脚本；最终结果以 [三轮容量验收](r10-capacity.md) 与 [R10实施记录](implementation-r10.md) 为准。中间的冷请求和短测不能代替完整门槛；若既定三轮全部通过，本版不为可选优化改动已验源码。

## 已核对的实现事实

| 位置 | 当前行为 | 成本与候选 |
| --- | --- | --- |
| [DatasetService.read](../apps/server/src/dataset.ts) | 固定提交快照最多4项；Map命中没有提升顺序，实际接近FIFO；每次返回深拷贝完整快照 | 候选A1：命中后提升为真正LRU，容量仍为4，不缓存授权、不扩大快照数 |
| [WorkflowService.preflight](../apps/server/src/workflow.ts) | 先`datasets.read`取得完整深拷贝，再检查按固定提交、任务revision组成的15秒预检缓存 | 候选A2：先resolve固定提交与当前任务revision，命中原预检缓存时跳过整表读取；miss仍重新读已提交快照并重新取任务。不能用私有预览行作权威预检，也不新增权限缓存 |
| [DatasetService.materialize](../apps/server/src/dataset.ts) | 每个新HEAD仍读取、解析、计算规范源原件哈希；已存在的WeakMap只在同一plan内复用原件证据 | 候选B：仅JSONL/NDJSON，按官方固定资源身份复用不可变原rows、每index原hash及原始SHA；CSV/TSV保持当前路径 |

A1/A2的小补丁仅放在本机`.data/r10-performance-design/01-lru-and-preflight.patch`，`git apply --check`通过，**没有应用**。B只有原型和集成说明，没有接入Provider或DatasetService，也没有进行端到端性能验证。原型6个极小合成测试通过，只验证冻结、隔离键、single-flight、错误重试和预算/LRU；不计为正式负载通过。

## 候选B的证据与边界

使用[固定生成契约](../packages/contracts/src/oxen.d.ts)已有的`GET /api/repos/{namespace}/{repo_name}/meta/{resource}`，不猜新接口、不改Oxen内核。已有一次合成只读观察确认：请求固定commit时，entry的resource.commit.id与resource.version等于请求值，path正确，hash为32位原生十六进制，size与原件一致。未验证latest_commit就是首次导入，不能以它的时间或路径/mtime作为唯一身份。

只有普通文件、非workspace、固定commit/version/path严格匹配、hash和size有效时才提供可复用证明；缺任何证据就走原raw路径。上游鉴权失败或其他错误不能借旧缓存绕过。键包含配置authority及基础路径、固定原生契约版本、namespace/repo、规范路径、原生hash/size、解析版本；不包含token。第一次raw读取的SHA-256仍保留，不能把原生短hash冒充SHA-256。

缓存只保存原JSONL行、原始字节SHA和按index计算的原行hash，**不保存Buffer、原文字符串、映射、descriptor、标签、模板、草稿、操作者计划、权限或HEAD判断**。每HEAD重读identity map并核对其baseline SHA/长度/唯一性，再用当前rowIds配对index hash；不能沿用另一HEAD的rowIds。原始行冻结，逻辑覆盖替换Map中的行对象；公开返回仍隔离可变对象。

`datasetOverlayProvider`必须显式禁用原生文件身份方法：它的raw可能已被内存写入覆盖，Proxy却会默认转发底层meta。当前同plan的seed证据保持原有严格同commit/路径边界，不能给新的规范源预览伪造证明。

## 预算、风险及启用门槛

候选使用进程级单一**128MiB估算预算**和条目数上限，不能每个DatasetService再各开128MiB。计入UTF-16字符串、对象/属性/数组槽、index hashes和key开销；过大或过于复杂的源不保留，LRU淘汰；相同已证明原件的并发只合并原件解析，绝不合并授权判断。缓存与现有快照共享原rows引用，不复制规范源。

四个源共45,586,959字节。粗暴按3倍原件大小收费会超过128MiB，使大表反复淘汰；按2倍估计也只是字符串的一部分，实际对象图必须逐项收费。即使账面预算符合，旧快照仍可能持有已淘汰的原件，临时parse/深拷贝也不在保留预算内；必须重新实测峰值RSS≤1.5GiB与三轮空闲收敛，不能由估算推断通过。

启用前至少验证：authority/repo/path/hash/size/native版本隔离；错误或缺失meta、raw大小不符不入缓存；overlay规范源替换不复用底层证明；新HEAD映射、schema、标签与activity仍重新加载；返回对象修改不污染其他请求；CSV/TSV不变；原SHA及基线hash一致；跨actor、撤销权限、schema变更和最终HEAD/CAS继续在原边界拒绝。完成专项、全量测试及类型/构建检查后，**从零重新计完整三轮**，保留旧失败记录，不拼时长、不删除冷样本、不调高目标。
