数据集管理平台 1.1 增量改造方案（用于已有项目）

〇、方案说明（给开发智能体的上下文）

本项目是一个已经开发了一半的数据集管理平台。现有基础功能已基本可用，包括：

· Sample 的增删改查、批量导入、字段校验
· Dataset 的创建、编辑、列表、归档
· 基础的导出能力（全量或简单条件导出）
· Sample 表已包含业务字段，如 quality、visibility、purpose、difficulty、source 等
· 已有权限和审计的基础框架

当前缺失的是“分层数据集”的视图层和发布层：没有 Split 视图定义、没有隐藏集物理隔离、没有 Release 物化与 manifest、没有模板机制。

本次改造的目标是：在不破坏已有功能的前提下，增量加入“视图层模板 + 发布层模板 + 四层资产（金标/回归/隐藏/公开）管理”，形成 1.1 版本。

硬约束（必须遵守，不得为了实现新功能而破坏现有基础）：

1. Sample 表不得新增 split、config、tier 等归属字段。 分层完全由 Dataset 层的视图定义派生。
2. 不重构现有 Sample CRUD、Dataset CRUD、导入校验。 新功能通过新增表和新增接口实现。
3. 复用现有导出能力，把“导出全量”扩展为“按视图筛选后导出”，不另起一套导出引擎。
4. 隐藏集必须物理隔离：独立目录、独立权限、发布只出哈希、评测走内部受控接口。
5. 所有新功能对未配置模板的老 Dataset 保持向后兼容：老 Dataset 没有视图时，仍可按原方式全量导出。
6. Config 固定为 default，不增加 config 管理界面，不参与业务逻辑。

以下为 1.1 的完整增量方案。

一、1.1 核心增量：两层可覆盖模板

在 1.0 的“视图定义”和“发布配置”之上，各加一层系统预置模板，实现：

· 零配置可用：新建 Dataset 自动从系统模板实例化四个默认视图；发布时默认选中标准模板，直接可发。
· 可自由修改：用户可改视图实例、可临时改发布配置、可另存自定义模板。
· 模板与实例解耦：改模板不影响已创建实例；改实例不影响模板。

```
系统预置模板（只读，可被实例覆盖）
        ↓ 实例化
Dataset 视图实例（可改，可重置为模板默认）
        ↓ 被引用
Release 发布实例（从发布模板实例化，可临时改，可另存）
```

二、四层资产定义（1.0 已定，1.1 沿用）

分层 视图类型 默认筛选条件 导出策略 可见性
金标 virtual "quality" = 'golden' AND "status" = 'active' data public
回归 virtual "purpose" LIKE '%regression%' AND "status" = 'active' data public
隐藏 physical 无 filter，独立目录 holdout/ hash_only hidden
公开 virtual "visibility" <> 'hidden' AND "status" = 'active' data public

说明：

· 公开集是“除隐藏集外的可见投影”，与金标、回归允许重叠。
· 隐藏集不使用 filter，边界由 physical_path 定义，数据物理隔离。
· 筛选语法对齐 Hugging Face where 谓词风格：列名双引号、字符串值单引号、支持 =、<>、LIKE、AND。

三、视图层模板方案

3.1 新增视图模板表

在现有数据库中新增一张表（字段列表，具体类型按现有项目风格）：

```
view_template
  id
  template_name        唯一，如 tpl_golden
  split_type           virtual / physical
  default_filter       文本，virtual 专用
  physical_path_pattern 文本，physical 专用，支持 {dataset_id} 占位
  default_export_policy data / hash_only
  default_visibility   public / internal / hidden
  description
  is_system            boolean，系统模板为 true，不可删
  created_by
  created_at / updated_at
```

3.2 系统预置四个视图模板（初始化数据）

平台启动或升级时插入以下四条 is_system = true 的记录：

```yaml
# 1. 金标模板
template_name: tpl_golden
split_type: virtual
default_filter: '"quality" = ''golden'' AND "status" = ''active'''
default_export_policy: data
default_visibility: public
description: 专家确认的代表性案例，基础能力基线

# 2. 回归模板
template_name: tpl_regression
split_type: virtual
default_filter: '"purpose" LIKE ''%regression%'' AND "status" = ''active'''
default_export_policy: data
default_visibility: public
description: 历史缺陷和事故固化用例

# 3. 隐藏集模板
template_name: tpl_holdout
split_type: physical
physical_path_pattern: "holdout/{dataset_id}/"
default_export_policy: hash_only
default_visibility: hidden
description: 最终评测用，物理隔离，永不导出数据

# 4. 公开集模板
template_name: tpl_public
split_type: virtual
default_filter: '"visibility" <> ''hidden'' AND "status" = ''active'''
default_export_policy: data
default_visibility: public
description: 除隐藏集外的全部可见样本
```

3.3 Dataset 视图实例表（在 1.0 视图表基础上加字段）

如果 1.0 的视图表尚未建立，则新建；如果已有雏形，则补充以下字段：

```
dataset_split
  id
  dataset_id
  split_name            golden / regression / holdout / public / 自定义
  split_type            virtual / physical
  filter_json / filter_text
  physical_path
  export_policy         data / hash_only
  visibility
  source_template_id    可空，记录从哪个模板实例化而来
  is_default            是否由系统模板自动生成
  created_at / updated_at
```

3.4 实例化规则

1. 新建 Dataset 时，自动从四个系统模板生成四个视图实例：
   · split_name 沿用模板语义名（golden / regression / holdout / public）
   · 字段值复制自模板
   · source_template_id 指向对应模板
   · is_default = true
2. 用户修改实例：只改实例，不改模板。
3. “重置为模板默认”按钮：按 source_template_id 重新拉取模板值覆盖实例。
4. 用户新增视图：可选择“从模板创建”（选系统或自定义模板）或“空白创建”。
5. 用户可另存自定义模板：把当前视图实例的配置保存为新模板（is_system = false）。

3.5 自定义视图模板示例

```yaml
template_name: my_hard_golden
is_system: false
split_type: virtual
default_filter: '"quality" = ''golden'' AND "difficulty" = ''hard'' AND "status" = ''active'''
default_export_policy: data
default_visibility: public
description: 金标中的困难题，用于压力评测
```

四、发布层模板方案

4.1 新增发布模板表

```
release_template
  id
  template_name
  split_names          数组或关联表，记录包含哪些视图
  format               jsonl / csv / parquet
  visibility_override  JSON，如 {"holdout": "hash_only"}
  include_dataset_card boolean
  include_checksums    boolean
  is_system            boolean
  created_by
  description
  created_at / updated_at
```

4.2 系统预置三个发布模板

```yaml
# A. 标准对外评测包（默认模板）
template_name: tpl_standard_public
is_system: true
splits: [golden, regression, public, holdout]
format: jsonl
visibility_override: {holdout: hash_only}
include_dataset_card: true
include_checksums: true
description: 默认发布方案，对外评测标准包

# B. 内部回归门禁
template_name: tpl_internal_regression
is_system: true
splits: [regression]
format: jsonl
include_dataset_card: false
include_checksums: true
description: 仅含回归视图，快速验证历史问题是否复发

# C. 季度全量归档
template_name: tpl_quarterly_archive
is_system: true
splits: [golden, regression, public, holdout]
format: parquet
include_dataset_card: true
include_checksums: true
description: 全量归档，隐藏集只出哈希
```

4.3 发布流程（在现有发布基础上增量）

```
1. 用户点“发布”
2. 平台展示发布模板选择器，默认选中 tpl_standard_public
3. 选中模板后展示预览：
   - 按模板 splits 列出各视图当前命中样本数
   - 显示去重后总数
   - 隐藏集仅显示数量，不显示内容
4. 用户可临时调整：改 format、勾选/取消视图、改 visibility_override
5. 用户可“另存为模板”或“覆盖自定义模板”
6. 确认 → 平台异步物化 → 生成 Release
```

零配置路径：不改任何东西，选默认模板，确认，直接产出 golden / regression / public / holdout 四个产物，隐藏集只出哈希。

4.4 临时修改与持久化规则

· 发布时的临时调整只影响本次 Release，不回写模板，也不回写视图实例。
· 用户可主动“另存为模板”把临时配置持久化。
· 系统模板只读，不可编辑、不可删除；用户可“另存为”自定义模板。

4.5 Release 记录增加字段

在现有 Release 表上增加：

```
template_name        辅助信息，记录本次用了哪个模板（可空）
template_snapshot    可选，记录模板配置快照
```

注意：可复现性仍由“数据快照标识 + 视图实例定义快照 + 产物 checksum”保证，模板名不参与复现校验，只作辅助追溯。

五、优先级与冲突规则

1. 实例 > 模板：视图实例和发布实例一旦创建，以实例字段为准；模板只用于初始化和重置默认。
2. 临时修改不持久化：发布时的临时调整不影响模板和视图实例。
3. 系统模板只读：is_system = true 不可编辑删除，只能被另存或实例覆盖。
4. 模板变更留痕：自定义模板的增删改写审计日志。
5. Release 快照的是实例配置，manifest 中记录实际筛选条件和 checksum，不依赖模板存在。

六、与现有系统的集成点（给开发智能体的实施指引）

6.1 数据库增量

· 新增 view_template、release_template 两张表
· 在 dataset_split 表上补充 source_template_id、is_default 字段（如果该表尚未建立，按 1.0 定义新建）
· 在 release 表上补充 template_name 字段
· 不改 Sample 表、Dataset 主表结构

6.2 后端接口增量

```
# 视图模板
GET    /api/v1/view-templates                列出系统+自定义模板
POST   /api/v1/view-templates                创建自定义模板
PATCH  /api/v1/view-templates/{id}           修改自定义模板（系统模板拒绝）
DELETE /api/v1/view-templates/{id}           删除自定义模板（系统模板拒绝）
POST   /api/v1/datasets/{id}/splits/from-template   从模板创建视图实例
POST   /api/v1/splits/{id}/reset-to-template        重置为模板默认

# 发布模板
GET    /api/v1/release-templates
POST   /api/v1/release-templates
PATCH  /api/v1/release-templates/{id}
DELETE /api/v1/release-templates/{id}

# 发布（在现有发布接口上扩展）
POST   /api/v1/datasets/{id}/releases
       请求体增加 template_name、临时覆盖字段
```

现有 Sample / Dataset / 导入 / 导出接口保持不变。 导出接口可增加可选参数 split_name，不传则维持原全量导出行为。

6.3 前端增量

· Dataset 详情页新增“视图管理”tab：
  · 列表展示该 Dataset 的视图实例，标注“来源模板”
  · 新建时可选“从模板创建”
  · 每个视图提供“预览”（命中数+前10条）和“重置为模板默认”
· 发布页：
  · 增加模板选择器，默认选中标准模板
  · 展示预览，允许临时调整
  · 提供“另存为模板”
· 模板管理页：
  · 系统模板只读展示
  · 自定义模板增删改
· 新建 Dataset 向导：创建成功后提示“已按系统模板初始化四个默认视图，可前往视图管理修改”

6.4 异步任务增量

· 发布物化任务复用现有异步框架（Celery/RQ 等）
· 新增逻辑：
  · 对 virtual 视图：按 filter 查 Sample 表 → 写文件 → 算 sha256 → 上传
  · 对 physical 视图：列目录 → 逐文件算 sha256 → 生成 HIDDEN_MANIFEST.sha256 → 只上传清单
  · 汇总 manifest，写入 template_name 作为辅助字段
· 失败重试沿用现有机制

七、实施顺序建议（供智能体按步执行）

1. 数据库迁移：新增两张模板表，补充 dataset_split、release 字段；插入系统预置模板数据。
2. 后端模板 CRUD：实现视图模板和发布模板的接口，系统模板只读保护。
3. 视图实例化逻辑：新建 Dataset 时自动从系统模板生成四个视图；实现“从模板创建”和“重置为模板默认”。
4. 发布接口扩展：在现有发布接口上增加 template_name 参数和临时覆盖字段；预览接口按模板汇总各视图样本数。
5. 物化任务扩展：在现有导出任务中加入 virtual 按 filter 导出、physical 只算哈希的分支。
6. 前端视图管理 tab 和 发布模板选择器。
7. 兼容性测试：老 Dataset 无视图时仍可原方式导出；系统模板不可编辑；临时修改不持久化。

验收标准

· 新建 Dataset 后自动出现 golden / regression / holdout / public 四个视图，可直接发布。
· 默认发布模板可零配置产出四个产物，隐藏集只有 HIDDEN_MANIFEST.sha256。
· 用户可修改视图实例，不影响模板；可“重置为模板默认”。
· 用户可另存自定义视图模板和发布模板。
· 发布时临时改 format 或增删视图，只影响本次 Release。
· 系统模板不可编辑删除。
· Sample 表未新增 split/config 字段。
· 老 Dataset 不配置视图时，原有导出行为不变。

八、1.1 定稿要点

1. 系统预置四个视图模板 + 三个发布模板，新建 Dataset 自动实例化，零配置可发布。
2. 模板是默认值来源，实例化后与模板解耦；用户可改实例、可另存自定义模板、可重置为默认。
3. 临时修改不持久化，Release 快照的是实例配置。
4. 系统模板只读，自定义模板可增删改，全部留痕。
5. 1.0 所有规则不变：Sample 表不加 split/config 列，隐藏集 physical + hash_only，发布自动物化 virtual 视图、只算 physical 哈希。
6. 增量改造，不破坏已有功能：新功能通过新增表和新增接口实现，现有 Sample/Dataset/导入/导出保持兼容。