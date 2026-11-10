# R12 受限主库发布分组：管理元数据与写入边界

日期：2026-11-09，Asia/Shanghai。**本地 TypeScript Web/BFF 扩展**，不是 Oxen SaaS 已观察能力，也不修改固定 Oxen 0.67 OpenAPI、服务端或内核。用户已确认算法/QA仅下载发布产物，不进入包含隐藏样本的主库。

## 存储和权限

规范源 JSONL、源身份、源真值和人工独立意见保持原层次。分组保存为版本化 `.oxenweb/dataset/evaluation.json`，按既有稳定 `rowId` 关联。每行包含：

| 属性 | 值 | 含义 |
| --- | --- | --- |
| `visibility` | `null`、`shared`、`holdout` | 未分类、允许共享、内部隐藏；未分类不会自动进入共享包 |
| `suites` | `gold`/`regression` 数组 | 用途可重叠；选择用途不自动声明复核通过 |
| `familyId` | 字符串或 `null` | 同一来源包/攻击变体的人工关联组；不自动猜测来源 |

同一当前有效关联组不得混合 `shared` 与 `holdout`。整组选中后一次应用补丁，先应用整批再检查，避免顺序影响结果。新导入/新增行默认未分类；没有批量分类真实样本。

只有同时具备 `release.manage` 和 `data.edit` 的负责人可以修改分组。一般标注员、复核员直接调用写接口也得到403；任务的行分配不授予分组权限。分组本身不授予任何仓库读取权。可信主库成员仍可读取原件/历史，不能把行字段宣传成行级保密。

`DatasetSnapshot.evaluation`包含全表映射与数量；`DatasetPage.evaluation.rows`仅包含本页稳定ID。查询、筛选、排序使用 `evaluation.visibility`、`evaluation.suites`、`evaluation.family_id`，源同名键通过 `data.*`访问。多值套件的 `eq`按精确成员命中。

私有草稿查询另返回同页 `baseEvaluationRows`，固定为草稿基线的管理值，避免把已应用草稿的投影误当作原值。行会话红/绿状态可以据真实差异判断，同值批量操作不会伪装成一次实际修改。

## 显式启用与恢复保护

`GET /api/repos/:namespace/:repo/dataset/evaluation/policy`供有项目读取权者查看模式；`POST`严格接收 `{ "confirmPrivateMaster": true }`。启用要求上述双权限和当前项目私有。不存在关闭接口。

启用策略保存在BFF控制面 `evaluation-policy.json`：

```json
{"version":1,"projects":{"namespace/project":{"enabled":true,"enabledAt":"ISO timestamp","enabledBy":{"id":"actor","name":"name"},"operationId":"optional journal operation id"}}}
```

这是安全模式，不跟随仓库版本回滚。读取固定commit缓存后，仍重新检查当前策略；历史版本没有行映射时显示未分类，不退回默认共享。策略启用和项目设置变更使用相同项目串行锁，项目可见性在生成候选以及原生commit回调内再次检查。启用后不能通过设置或策略文件合并改为公开。

控制面恢复必须包含该策略文件。若Release存储已经有分层记录而策略缺失，应用启动报 `EVALUATION_POLICY_RECOVERY_REQUIRED`，要求恢复同批控制面；不推断为关闭。策略写入结果不确定时，当前进程报 `EVALUATION_POLICY_UNCERTAIN`，在核对和重启前阻止按普通模式继续发布。

## 草稿、提交和已有曝光

新增 `DatasetOperation`：`{ op: 'evaluation', rowIds, patch }`。补丁省略属性表示保持原值；`visibility:null`、`suites:[]`、`familyId:null`是明确清空。复用本人/项目/分支隔离草稿、revision CAS、差异预览和一次明确提交。保存草稿不创建工作区，不新增Oxen提交。正文新增与分组可在同一草稿原子提交，引用同一显式 `append.rowId`。

显式选择与原值相同，或本轮来回调整后回到基线，不更新分组时间。纯分组无实际差异时，明确提交清理本人草稿并返回原commit，不创建工作区或空提交。

纯分组不修改源行、不修改内容哈希、不生成新标签意见、不改变既有标注意义；因此不会把分组调整误当作一次重新打标。已提交分组更新独立逐条操作时间/操作人，标记 `kind: evaluation`；不向源JSONL注入系统时间或操作者。

`ReleaseService.exposed()`从不可变已发布成员证据（包括已撤回版本）提供已共享的ID、关联组及附件SHA。草稿规划、保存前及原生commit最后回调检查这些证据：已曝光的身份/家族/相同附件不能重新声明为未曝光隐藏集。旧版本恢复和合并也检查；不能借历史回滚抹去曝光事实。Release构建/发布还需独立检查，不能只依赖编辑时检查。

通用工作区与旧文件编辑入口继续保护整个 `.oxenweb`；不能绕过管理流程手写分组文件。合并涉及分组文件要求负责人双权限。原生核心之外的直接存储篡改不属于这套BFF权限边界，部署仍需保护官方上游与磁盘。

启用操作纳入现有操作日志和宏观日志；分组明确提交记 `dataset.evaluation_updated`，仅记录条目数与commit，不记录样本正文。启用的丢失响应只能在持久策略 `operationId`严格匹配时对账成功。

## 本模块验证记录

以下全部使用 `.data/tests`下临时合成夹具，无真实benchmark正文/附件、无生产服务改动。

- 最终 `npx tsx --test apps/server/test/dataset-evaluation.test.ts apps/server/test/dataset.test.ts apps/server/test/dataset-drafts.test.ts`：45/45通过（新分组测试13、既有源记录/查询测试15、既有私有草稿测试17；0跳过、0失败）。初轮42项之后的幂等及安全字典改动也包含在此次重新验证中。
- `npx tsx --test apps/server/test/dataset-evaluation.test.ts apps/server/test/repository-history.test.ts`：当时新分组测试6＋既有恢复测试8，共14/14通过。其后新增HTTP、对账、新行及最终曝光测试。
- 测试覆盖显式启用、私有约束、策略重启、旧commit缓存、分组草稿无提交、页内映射、源同名字段隔离、整组一致性、历史曝光/附件哈希、防权限撤销和发布竞态、真实HTTP403以及通用路径写入保护。
- 后续 `npx tsx --test apps/server/test/dataset-evaluation.test.ts`：13/13通过，包含“控制面写入结果不确定”的真实文件写失败夹具、无效空提交避免、继承属性名称稳定身份安全处理。故障夹具预期打印 `storage.write_failed/EPERM`，断言后续拒绝回退普通模式。
- `npx tsc --noEmit -p apps/server/tsconfig.json`：通过（exit 0）。
- 既有逐条操作授权回归由“写死回调次数”改为真实原生提交边界观察：每种操作及完整行范围在暂存前、Provider提交回调内都受检查，并在进入真正提交后撤权来证明head未移动。`npx tsx --test apps/server/test/dataset-activity.test.ts apps/server/test/dataset-evaluation.test.ts`最终19/19通过（activity6＋evaluation13；0跳过、0失败），包含 `baseEvaluationRows`基线验证。

浏览器UI、正式分层ZIP裁剪、发布/分享令牌和备份恢复由对应模块及总体验收记录负责，不能从上述单元/集成测试推导已经完成浏览器下载或生产容量验收。
