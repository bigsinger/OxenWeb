# 旧项目一次性数据集入口配置

负责人在项目“设置 → 数据集配置”中选择当前分支真实存在的 CSV、TSV、JSONL/NDJSON、README、业务身份字段和附件字段。普通数据编辑工作台没有加载文件选择器，配置后继续按分支自动加载完整逻辑数据集。

配置同时要求 `data.edit` 与 `tasks.manage`；项目 owner 全权，其他身份需明确具备两项能力。公开访问和普通标注、编辑、复核身份只读，直接调用 POST 同样检查能力。历史提交可核对候选元数据，但不能提交。

接口为 GET `/api/repos/:namespace/:repo/dataset-configuration?ref`、GET `/dataset-configuration/table?ref&path` 和 POST `/dataset-configuration`。POST 参数为 `ref`、`expectedCommit`、`path`、可选 `readmePath`、`identityField` 与 `attachmentFields`；读取表格信息只返回字段、行数和摘要，不返回记录正文。

服务端固定提交扫描候选，不允许入口或附件映射指向策略、元数据、原始归档、仓库内部路径。所选身份字段必须每行非空且类型为字符串或有限数字，并逐行唯一。它声明已有业务身份，不重写源字段；稳定行 ID 沿用旧 API 的 `stableRowIds` 并写入身份映射，保留历史行标签关联。后续正文编辑锁定已配置的业务身份字段。

仅当固定版本不存在 `bundle-manifest.json`、`.oxenweb/dataset.json`、新版 dataset format 和身份映射时允许配置。已导入的四个真实基准项目均属于拒绝范围。一次配置通过官方 workspace 仅新增 `.oxenweb/dataset.json` 和 `.oxenweb/dataset/identity-map.json`，CAS 生成一个提交；保存前预检，保存后使用无缓存 DatasetService 读取固定新提交，核对样本数、稳定 ID、附件与源文件 SHA256。原样本、真值、规范和标签文档不被修改。回读失败会返回已生成的 commitId，禁止将其当成未提交而盲目重试。

容量边界：JSONL/NDJSON 最多64MiB，CSV/TSV 最多25MiB，250000条样本、1000个字段、稳定身份映射8MiB、README 2MiB；候选扫描最多8层、20000个目录项。超限明确拒绝，不使用截断数据建立配置。

自动测试：`npx tsx --test apps/server/test/dataset-configuration.test.ts`。真实官方本地服务合成验收：`npx tsx .qa/verify-dataset-configuration.ts`，仅新建 UUID 合成项目，不改真实基准库或服务进程。
