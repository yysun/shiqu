---
schema: test-manager/suite/v1
suite: story-lifecycle
title: 故事新建、编辑与状态机
risk: HIGH
state: ACTIVE
owner: UNASSIGNED
planned_start: UNPLANNED
planned_end: UNPLANNED
---
# 故事新建、编辑与状态机

目的：验证开发数据库上新建、编辑、重选、失败恢复的真实用户流程和状态机边界。风险R1/R2/R3/R4/R5分别由C001/C002/C003-C004/C005/C007覆盖，协议C006补充幂等、重启、竞态与媒体核对。

依赖：Node24、pnpm、Playwright Chromium、生产SQLite/媒体和受控模型adapter；无外部账号/密钥。构建6c791fa起的工作区，实现完成后记录hash/diff。

数据：独占`.data/e2e/<run>`，两段合成原文及控制图片；例外C007启动真实.data/dev-local，以readonly提供方禁用生成，允许正常初始化/迁移，不提交故事命令、不清空已有数据。UI状态由真实命令生成，不直接伪造持久状态来证明UI路径。媒体丢失等故障只在协议场景注入。UTC记录时间。

进入测试须用例就绪、隔离服务可用。验收须适用用例在待验构建上通过，且 P0/P1 无未解决缺陷。C008–C017 是制作 DAG 的关键回归。完整的逐场景清单见 [制作 DAG 路径与验收](../../.docs/tests/test-data-driven-production-dag.md)。C001–C007 的旧运行只作为对应构建的历史证据。每次复跑追加记录。测试使用合成书库和受控生成器。

回归使用仓库登记的源码测试。C008 和 C013 的阅读器验证用应用内浏览器，在隔离 Vite 服务上执行。制作状态及授权用正式 API、协调器和 SQLite 验证。修改启动目录时复测 local、默认目录兼容性和私有文件。修改制作状态时复测重试、版本隔离以及界面状态与队列一致性。

已知限制：受控回执不能证明真实AI内容/图片质量；Playwright是独立会话。UI没有停止按钮时以协议覆盖，不声称UI支持停止。
