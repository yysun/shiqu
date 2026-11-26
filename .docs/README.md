# 文档索引

系统行为以代码为准。按日期存放的需求、计划、交付和报告均为历史记录。

| 领域 | 涵盖主题与路径 | 文档 | 状态 |
| --- | --- | --- | --- |
| 选题与准备 | 候选、首次确认、替换选题 · `server/reader-intake.ts`、`server/reader-reselection.ts` | [生成状态机](story-generation-state-machine.md) · [准备流程](story-creation-flow.md) | 当前 |
| 制作生命周期 | 状态、读者操作、授权与故障 · `lib/production-lifecycle.ts`、`server/reader-production.ts` | [制作生命周期](story-production-lifecycle.md) | 当前 |
| 制作产物 | 有效性、复用、调度与调用 · `lib/production-dag/` | [制作与编辑 DAG](story-production-dag.md) | 当前 |
| 分镜审核 | 原文核对、审片与修订 · `lib/reader-review.ts`、`lib/production-dag/review.ts` | [审核方法](storyboard-editorial-review.md) | 当前 |
| 读者与 CLI | 阅读、书库升级、CLI 用法 · `client/`、`db/library-format.json`、`server/cli.ts` | [使用指南](user-guide.md) | 当前 |
| 内置技能 | 安装、更新与命令 · `skills/shiqu/`、`server/agent-cli.ts` | [内置技能](../skills/shiqu/SKILL.md) · [使用示例](use-as-skill.md) | 当前 |
| 本地开发 | 启动、配置与排查 · `server/start.ts`、`server/system-settings.ts`、`desktop/` | [开发指南](development.md) | 当前 |
| 自动检查 | 测试选择、成本与启动矩阵 · `tests/manifest.json`、`scripts/test-plan.mjs` | [测试选择](testing-triggers.md) · [启动测试](startup-testing.md) | 当前 |
| npm 发布 | 打包、验证与发布 · `scripts/build-npm.mjs`、`.github/workflows/publish-npm.yml` | [npm 发布](npm-publishing.md) | 当前 |
| 旧版制作总览 | 创建、编辑与队列 · `server/reader-production.ts` | [旧版制作总览](story-creation-editing-queue.md) | 已被取代 → [生命周期](story-production-lifecycle.md)、[DAG](story-production-dag.md)、[状态机](story-generation-state-machine.md) |
