# CSGHub 工程参考索引

仅借鉴组件分工、路由和状态组织模式；未复制 CSGHub 源码或其后端数据模型。参考固定为 `OpenCSGs/csghub@3073d25535d95c1312c6f3904e63feb33c81cd4b`，不自动跟随上游。

| 关注点 | 官方模块 | 本项目采用的模式 |
| --- | --- | --- |
| 应用装配/路由 | [frontend/src/main.js](https://github.com/OpenCSGs/csghub/blob/3073d25535d95c1312c6f3904e63feb33c81cd4b/frontend/src/main.js) | Vue 3 + Vue Router + Pinia；本项目单独集中路由并按页面拆分 |
| 仓库页外框 | [RepoDetail.vue](https://github.com/OpenCSGs/csghub/blob/3073d25535d95c1312c6f3904e63feb33c81cd4b/frontend/src/components/shared/RepoDetail.vue) | header/tabs/content 分工，数据加载状态统一 |
| 仓库列表 | [RepoCards.vue](https://github.com/OpenCSGs/csghub/blob/3073d25535d95c1312c6f3904e63feb33c81cd4b/frontend/src/components/shared/RepoCards.vue)、[RepoItem.vue](https://github.com/OpenCSGs/csghub/blob/3073d25535d95c1312c6f3904e63feb33c81cd4b/frontend/src/components/shared/RepoItem.vue) | 容器负责筛选与分页，条目组件消费 view model |
| 文件浏览 | [RepoFiles.vue](https://github.com/OpenCSGs/csghub/blob/3073d25535d95c1312c6f3904e63feb33c81cd4b/frontend/src/components/shared/RepoFiles.vue) | 文件区域独立于仓库布局，分支选择与文件导航共享上下文 |
| 提交历史 | [RepoCommits.vue](https://github.com/OpenCSGs/csghub/blob/3073d25535d95c1312c6f3904e63feb33c81cd4b/frontend/src/components/shared/RepoCommits.vue) | 独立历史列表、分页与分支选择；URL 保存可分享的选择状态 |
| 提交详情/diff | [RepoCommit.vue](https://github.com/OpenCSGs/csghub/blob/3073d25535d95c1312c6f3904e63feb33c81cd4b/frontend/src/components/shared/RepoCommit.vue) | 详情页单独加载，按内容类型渲染 diff；不复用其 API 字段 |
| 请求入口 | [packs/useFetchApi.js](https://github.com/OpenCSGs/csghub/blob/3073d25535d95c1312c6f3904e63feb33c81cd4b/frontend/src/packs/useFetchApi.js) | 统一请求、鉴权失败与错误处理。本项目采用 BFF + typed contracts，不使用其 JWT 逻辑 |
| 仓库共享状态 | [stores/RepoDetailStore.js](https://github.com/OpenCSGs/csghub/blob/3073d25535d95c1312c6f3904e63feb33c81cd4b/frontend/src/stores/RepoDetailStore.js)、[stores/RepoTabStore.js](https://github.com/OpenCSGs/csghub/blob/3073d25535d95c1312c6f3904e63feb33c81cd4b/frontend/src/stores/RepoTabStore.js) | Pinia 保存跨组件上下文，服务数据由查询缓存管理，避免两份服务端状态 |

参考依据为上述模块的 import、职责和工程装配关系。交互语义仍由 Oxen SaaS 快照确定，HTTP 契约仅由固定 Oxen OpenAPI 决定。CSGHub 中与推理、微调、部署实例等有关的模块不在本次参考范围。
