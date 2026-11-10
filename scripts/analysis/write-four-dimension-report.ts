/** Export aggregate research only; private candidate IDs, fingerprints and keys never enter docs. */
import assert from 'node:assert/strict';import {readFile,writeFile} from 'node:fs/promises';import path from 'node:path';import {digest} from './readonly-snapshot.js';
const root=path.resolve('.'),pointer=JSON.parse(await readFile(path.join(root,'.data/r17-four-dim-candidates/latest.json'),'utf8')),directory=pointer.directory;
const summary=JSON.parse(await readFile(path.join(directory,'summary.json'),'utf8')),checksums=JSON.parse(await readFile(path.join(directory,'artifact-checksums.json'),'utf8')),repro=JSON.parse(await readFile(path.join(directory,'reproduction-verification.json'),'utf8'));
for(const[file,sha]of Object.entries(checksums)){const relative=path.relative(directory,path.join(directory,file));assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));assert.equal(digest(await readFile(path.join(directory,file))),sha);}
assert.equal(repro.passed,true);const kinds=['sensitive','injection','skills','drift'],names:Record<string,string>={sensitive:'敏感数据',injection:'提示词注入',skills:'Skill供应链',drift:'行为漂移'},pct=(n:number,total:number)=>(100*n/total).toFixed(2)+'%',cell=(n:number,total:number)=>`${n.toLocaleString('en-US')}（${pct(n,total)}）`;
const strict=summary.scenarios.find((s:any)=>s.scenario==='strict-fingerprint-isolation'),balanced=summary.scenarios.find((s:any)=>s.scenario==='guard-only-coverage-comparison');
const rows=(s:any)=>kinds.map(kind=>{const k=s.perKind[kind];return`|${names[kind]}|${k.total.toLocaleString('en-US')}|${['train','dev','test','unassigned'].map(split=>cell(k.split[split].rows,k.total)).join('|')}|`;}).join('\n');
const sumTable=(s:any)=>`|样本集|总条数|train|dev|test|暂缓／未分配|\n|---|---:|---:|---:|---:|---:|\n${rows(s)}\n|合计|6,719|${['train','dev','test','unassigned'].map(split=>cell(s.totals.split[split],6719)).join('|')}|`;
const strictMembers=(await readFile(path.join(directory,strict.scenario,'candidates.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
const repoKind=new Map(summary.sourcePins.map((p:any)=>['local/'+p.repo,p.kind]));
const groupMatrix=Object.fromEntries(kinds.map(kind=>{const selected=strictMembers.filter(row=>repoKind.get(row.repository)===kind);return[kind,Object.fromEntries(['train','dev','test-shared','test-hidden','unassigned'].map(group=>{const filtered=selected.filter(row=>group==='unassigned'?row.proposed_split===null:group.startsWith('test-')?row.proposed_split==='test'&&row.proposed_visibility===group.slice(5):row.proposed_split===group);return[group,{total:filtered.length,goldTarget:filtered.filter(row=>row.quality_target==='gold').length,normalTarget:filtered.filter(row=>row.quality_target==='normal').length}];}))];}));
const publicSummary={date:'2026-11-09',status:summary.status,ruleVersion:summary.ruleVersion,createdAt:summary.createdAt,sourcePins:summary.sourcePins.map(({repo,kind,commit,rows}:any)=>({repo,kind,commit,rows})),sourceEvolution:summary.sourceEvolution,observedExistingSplitGuardCrossings:summary.observedExistingSplitGuardCrossings,duplicateAliasRowsExcluded:2000,scenarios:summary.scenarios,strictQualitySplitMatrix:groupMatrix,readOnly:{repositoryWrites:0,realClassificationWrites:false,sourceBodiesSentExternally:false,independentReviewAccepted:0,realPublishedReleases:0},reproducibility:{candidateFilesCompared:repro.comparedCandidateFiles,identicalMembershipsAndCandidateMetadata:repro.identicalMembershipsAndCandidateMetadata,sameSourceHeads:repro.sourceHeadsUnchangedBetweenSuccessfulRuns},limits:summary.limits};
await writeFile(path.join(root,'docs/research/real-dataset-four-dim-candidates-r17-summary.json'),JSON.stringify(publicSummary,null,2)+'\n');
const quality=kinds.map(kind=>{const k=strict.perKind[kind];return`|${names[kind]}|${cell(k.quality.targets.gold.rows,k.total)}|${cell(k.quality.targets.normal.rows,k.total)}|${cell(k.split.unassigned.rows,k.total)}|0|`;}).join('\n');
const purpose=kinds.map(kind=>{const k=strict.perKind[kind];return`|${names[kind]}|${['training','regression','smoke','evaluation'].map(v=>cell(k.purposes[v].rows,k.total)).join('|')}|`;}).join('\n');
const visibility=kinds.map(kind=>{const k=strict.perKind[kind];return`|${names[kind]}|${['internal','shared','hidden','public'].map(v=>cell(k.visibility[v].rows,k.total)).join('|')}|`;}).join('\n');
const matrix=kinds.map(kind=>{const m=groupMatrix[kind]!;return`|${names[kind]}|${['train','dev','test-shared','test-hidden'].map(g=>`${m[g]!.total}（${m[g]!.goldTarget}／${m[g]!.normalTarget}）`).join('|')}|${m.unassigned!.total}|`;}).join('\n');
const views=kinds.map(kind=>{const k=strict.perKind[kind];return`|${names[kind]}|${k.views.devRegression}|${k.views.goldTestReviewPriority}|${k.views.hiddenAcceptanceCandidate}|${k.views.shareViewCandidate}|0|`;}).join('\n');
const sourcePins=summary.sourcePins.map((p:any)=>`|${names[p.kind]}|\`${p.commit}\`|${p.rows}|`).join('\n');
const text=`# 四类真实样本四维划分候选 R17

日期：2026-11-09，Asia/Shanghai。**只有本机只读分析与候选文件，没有修改真实 split、quality、purposes、visibility、权限或发布。** 本文取代“把金标／回归／隐藏放在同一 split”的理解，不追改 R14 历史报告。完整机器可读聚合见[汇总 JSON](real-dataset-four-dim-candidates-r17-summary.json)。

建议先审阅严格隔离候选的分布与风险，暂不直接确认全部成员。提示词和漂移可继续做成员／配对复核；敏感与 Skill 需要补充独立样本或人工裁定公共复用内容，不能用接近目标比例代替独立性。

## 固定输入和变化核对

|样本集|本轮固定 main|条数|
|---|---|---:|
${sourcePins}

全量6,719条，旧提示词别名2,000条只作为历史同源证据，不重复计数。R14派生证据、缓存模块／密钥摘要及当前固定记录逐项核验；不重新执行 Skill、不展开26个不透明嵌套包、不调用模型。相较R14，提示词项目有1条记录的 quality／purposes／visibility 变化；攻击正文、源真值、来源、身份和附件没有变化。因此按排除四维管理字段后的完整记录相等复用R14关系，保留当前四维原值为独立观察列。当前有1条普通质量声明，另6,718条未提供质量；有效独立复核仍为0。不是所有当前 quality 都是 null，更不是已有657条金标。

**原导入的提示词 train/dev/test=1,600/200/200 并非独立性背书：已有8个保守同源组跨原 split，涉及20条（train11、dev6、test3）。** 原值未被改写；本次严格候选与原值有947条角色不同，对照方案963条不同，须作为新划分版本确认，不能覆盖旧评测记录。

## 候选规则

|维度／边界|本轮建议与规则|含义限制|
|---|---|---|
|split|可分配6,565条按60% train／20% dev／20% test软预算，整组分配；154条暂缓|比例是可调整建议，未得到真实赋值批准；不是每库必须凑满目标|
|quality|从可分配样本按领域与 split／源类别均衡挑选约10%金标优先复核目标，其余普通目标|657是复核预算，不是发现或已审核的金标；所有目标仍需最终独立复核|
|purposes|train：训练；dev：回归储备＋常规评测；test：常规评测；从dev再选最多约全库可分配量2%的冒烟储备|回归尚需补充真实历史缺陷／案例引用；冒烟和回归可重叠，不能把各用途相加当总样本数|
|visibility|train/dev及暂缓默认内部；test内按整组约一半指定分享、一半隐藏；不建议自动公开|用于保留可交付测试与独立隐藏验收两类候选，50/50也是待确认预算；字段本身不授予权限|
|同源基础组|R14全部 hard／guard 关联，包括跨提示词／漂移组|同组不得跨train/dev/test或隐藏／非隐藏；guard仍是保守关联，未冒充人工谱系结论|
|严格附加组|敏感数据相同实体指纹、Skill关键文档／代码／配置字节复用做传递合并|是更严格的反记忆假设，公共样板也可能被过度合并；需专家裁定，不能据此断言同源|
|暂缓|135个未解析显式配对引用整组传播，提示词2条＋漂移152条|不分配split、不设置质量目标、不进入用途集合；访问目标保持内部|

百分比默认以各库全部条数为分母，总计以6,719为分母；**60/20/20目标以6,565条可分配样本为分母**。用途为多选；质量目标／访问目标／split是不同维度。先确认并提交四维取值，再做最终独立复核；复核后修改四维值会使旧证明失效。

上述组合是本轮候选默认值，**不是四字段相互依赖的合法性约束**。例如train/dev确认接收者和权限后也可指定分享；test也可有回归用途。本轮先提供开发回归储备与可分享／隐藏测试两种交付候选，不把train/dev长期禁止分享，也不把test回归自动混进反复调优的开发回归。当前平台的四个固定发布视图仍按R16规则选择；其他正式评测集合须另定清单和规则。

## 主候选：严格实体／关键成员隔离

${sumTable(strict)}

全体实际比例为train ${pct(strict.totals.split.train,6719)}、dev ${pct(strict.totals.split.dev,6719)}、test ${pct(strict.totals.split.test,6719)}、暂缓 ${pct(154,6719)}；在可分配6,565条中分别为 ${pct(strict.totals.split.train,6565)}／${pct(strict.totals.split.dev,6565)}／${pct(strict.totals.split.test,6565)}。未为达成60/20/20拆开整组，也不声称此启发式成员是唯一或全局最优。

### 质量目标与复核预算

|样本集|金标复核目标|普通质量目标|暂缓无目标|当前有效金标|
|---|---:|---:|---:|---:|
${quality}
|合计|657（${pct(657,6719)}；可分配样本${pct(657,6565)}）|5,908（${pct(5908,6719)}）|154（${pct(154,6719)}）|0|

私有清单的 §quality_target§ 表示上述目标，§gold_review_priority§ 表示复核队列，§proposed_quality§ 保持null表示本次没有获批可直接赋的质量结论；§observed_current_dimensions§ 保留现有真实值及缺失状态。金标目标可分布于train、dev、test，不会被当成另一个split。

### 用途目标（允许交叠）

|样本集|训练|回归储备|冒烟储备|常规评测|
|---|---:|---:|---:|---:|
${purpose}
|合计|${strict.totals.split.train}|${strict.totals.regressionReviewCandidate}|${strict.totals.smokeReviewCandidate}|${strict.totals.split.dev+strict.totals.split.test}|

冒烟目标原约131条，严格敏感dev仅8条，因此实际99条；不从train或隐藏test偷偷补数。回归储备893条尚未被证明都是历史失败案例，需人工补齐缺陷关联。

### 访问目标

|样本集|内部|指定分享候选|隐藏候选|公开|
|---|---:|---:|---:|---:|
${visibility}
|合计|${cell(strict.totals.visibility.internal,6719)}|${cell(strict.totals.visibility.shared,6719)}|${cell(strict.totals.visibility.hidden,6719)}|0|

隐藏优先隔离到独立私有项目；现阶段算法／QA只下载获准发布包，不获得主库读取权。源文件、搜索、API、下载、导出、历史和重复别名均须保持相同访问边界。当前平台没有宣称完整行级ACL，不能勾选hidden就当隔离完成。指定分享还需明确接收者与可撤销发布包授权；本次没有创建链接或变更权限。

### 四维交叉检查

各格为总条数（其中金标复核目标／普通目标），不是复核通过人数。

|样本集|train|dev|test＋指定分享|test＋隐藏|暂缓|
|---|---:|---:|---:|---:|---:|
${matrix}

|固定集合候选|开发回归储备|可分享金标测试优先复核|隐藏验收候选|分享测试全集候选|目前可正式发布|
|---|---:|---:|---:|---:|---:|
${views}

当前均无有效独立复核，不能直接构建正式包。确认后冻结稳定样本ID、样本修订／内容摘要、答案版本／采纳摘要、划分版本及评分规则版本；动态筛选不等于固定集合。

## 对照方案：仅按R14 guard隔离，保持覆盖比例

${sumTable(balanced)}

对照并非推荐的可信隐藏方案。其访问目标为内部5,409、指定分享655、隐藏655、公开0；金标复核目标仍657，回归储备1,311、冒烟131、常规评测2,621。此方案的源类别配比接近原库（例如Skill test恶意140／正常60），但重复实体和关键成员跨集合，不能只看比例漂亮便批准。

|对照风险|跨train/dev/test指纹|受影响条目（两侧去重）|隐藏／非隐藏跨边指纹|受影响隐藏候选|
|---|---:|---:|---:|---:|
|敏感实体|198|1,986|130|200／200（100%）|
|Skill关键成员|24|719|15|74／100（74%）|

主候选在以上**已检测到的**指纹与guard关系中跨边均为0；这不等于语义、翻译改写、未知来源或公共预训练无泄漏。

## 未解决问题与建议

|问题|本轮实际影响|下一步|
|---|---|---|
|敏感实体巨组|2,000条形成8个严格分量，最大1,982；主候选train1,985、dev8、test7。隐藏仅3条（1含敏感、2不含），分享test4条全为含敏感|暂不批准代表性隐藏验收。补充独立实体池及正常对照；否则只能把极小集作为独立性检查，不能报告总体性能|
|Skill公共成员与正常类别聚集|严格test148条=144恶意／4正常；隐藏73条=72恶意／1正常；dev175条仅1正常。原库700恶意／300正常|审阅公共辅助代码与任务关键逻辑的边界，补充独立正常Skill。若保留严格集，只作偏难挑战集单列结果；不冒充70/30代表集|
|未解析配对|135个引用缺对端，整组传播154条暂缓；暂缓漂移均源attack|补齐对应来源、事件与对照；不能丢掉引用后凑目标比例|
|原提示词split跨同源|8个guard组20条跨原train/dev/test；提出新版本候选，不追改原始来源split|逐组审阅新分配，旧实验继续引用旧清单；不能承诺原导入80/10/10无泄漏|
|跨库谱系|5个提示词／漂移保守组，涉及8提示词＋57漂移，已全局整组处理|任何单库另行划分都要带上全局组，避免跨项目泄漏；旧提示词别名2,000条不得另发|
|检测盲区|R14文本242,485次比较／Skill21,471次；跳过57／19宽泛桶，26嵌套包未展开|后续做人工语义／翻译／事件谱系核对，不把本次0已知切边写成无泄漏证明|
|质量与回归证据|当前有效独立复核0；657金标目标、893回归储备只是优先队列|补答案、判据、证据及历史缺陷ID，最终独立复核之后才能命名正式金标／回归集合|
|披露与调优污染|负责人此前声明四类未外发／未训练调参；当前系统未见四库正式发布|仍需记录真实披露对象／时间；以后反复用于调优的test转入新版本dev／回归，并补独立test；历史结果不改写|

## 本机文件、复现与验证

最终私有目录：§${path.relative(root,directory).replaceAll('\\','/')}§。两种情景各有 §candidates.csv/jsonl§、§train.jsonl§、§dev.jsonl§、§test.jsonl§、§unassigned.jsonl§；包含稳定ID、当前固定提交、记录摘要、同源组、四维目标、原值观察、暂缓原因和固定版本查看链接。CSV有BOM及公式首字符防护。**这些成员、隐藏索引、HMAC指纹、密钥与随机种子均Git忽略，不随公开代码或分享包发布。**

新运行：

§§§powershell
npx tsx scripts/analysis/run-four-dimension-candidates.ts --execute
§§§

同一快照／控制切点重放使用 §--directory <已有本机run目录>§，重复读取固定版本并沿用私有种子；控制切点变化会停下，不能混切点。另行新建当前切点并沿用既有种子可使用 §--seed-from <已有run目录>/allocation.key§。代码只允许本机r17目录内种子，不通过命令行传种子内容。

本次全量GET固定并核对当前记录；强制回环同origin GET、禁止重定向／Provider写方法，Oxen写入0、CLI调用0，未调用云模型。重放期间曾发现全局策略／发布控制文件变化，因此保留原成功切点，另建当前稳定切点；四项目相关发布仍0，源HEAD未变化。两成功切点沿用同一私有种子，12份成员CSV/JSONL字节摘要完全一致。最终HEAD、源字节和控制切点前后均一致。

纯算法4项针对性测试覆盖整族三分、暂缓传播、巨组不拆、确定性、质量队列分离及跨边按侧去重；分析入口及依赖执行严格TypeScript检查。实际运行回执／输入校验／重现证明在本机run目录，不把失败的中间重放当通过。未新增Git提交，未改Oxen内核。
`;
await writeFile(path.join(root,'docs/research/real-dataset-four-dim-candidates-r17.md'),text.replaceAll(String.fromCharCode(167),String.fromCharCode(96)));
console.log(JSON.stringify({written:true,aggregateOnly:true,rows:6719,directory,files:['docs/research/real-dataset-four-dim-candidates-r17.md','docs/research/real-dataset-four-dim-candidates-r17-summary.json']}));
