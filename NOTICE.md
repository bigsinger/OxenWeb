# 来源与第三方依赖

本工程独立实现 Web 与 TypeScript BFF；未复制 Oxen SaaS 编译前端或 CSGHub 实现源码。CSGHub 与其他标注项目仅作公开产品及工程模式参考，记录见 `docs/research/`。

- Oxen CLI/server 为官方独立安装的软件，来源与固定哈希见 `infra/oxen/release.json`，不包含在本仓库。上游项目及其许可：[Oxen-AI/Oxen](https://github.com/Oxen-AI/Oxen)。
- 原始 OpenAPI 规范及生成类型保留来源、版本、哈希和修正记录，见 `contracts/source.json` 与 `docs/contract-reference.md`。
- npm 依赖通过 `package-lock.json` 固定；它们各自的版权与许可保留在所安装包中。Vue、Vite、Fastify、jsdiff 等第三方包没有作为本项目自研代码声明。
- 合成测试夹具与截图不包含真实数据集；真实样本与运行数据不随源码发行。

本工程当前未添加对外开源许可证。公开仓库与可复现构建不改变第三方许可，也不代表另行授予未声明的再分发权利；项目所有者可另行确定工程许可证。
