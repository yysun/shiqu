---
schema: test-manager/root/v1
title: 拾趣流程验证
status: ACTIVE
created: "2026-11-03"
---
# Test Strategy

质量目标：验证故事新建、编辑与状态机的用户可达性、保存一致性和不重复执行。支持本地开发质量判断；发布批准人UNDEFINED，不自动发布。

范围：网页Playwright、正式HTTP/生产队列/SQLite/媒体；状态机协议补充。排除真实模型内容质量、桌面打包、Docker及真实书库。

风险：R1误启动/重复生成；R2草稿或历史丢失；R3暂停/失败被观察操作意外恢复；R4重选多卡片或跨版本污染；R5开发库误指向桌面。均HIGH，风险owner UNASSIGNED，证据映射见story-lifecycle。

方法：业务E2E走UI；仅协议竞态测试可直接发送命令，read-only API/SQLite核对UI保存。开发启动隔离探针、边界/决策组合、状态转换及恢复覆盖。受控回执通过正式provider/engine执行，不调用付费服务。

环境：Node24.22.1/pnpm11.25.0/Chromium/Vite，构建为Git hash加工作区diff标识；checkout独立开发数据，原文合成不含用户信息。时间用UTC留证，业务时区America/Toronto。

数据：每运行独占`.data/e2e/<run>`，不清除失败证据或覆盖旧运行；不写生产。生命周期测试不复用人工`.data/dev-local`；例外C007实际启动该开发目录，以readonly提供方禁用生成，允许正常初始化/迁移，不提交故事命令、不清空已有数据。SQLite/trace留本地，摘要归.tests，不保存密钥。

进入测试须用例就绪、依赖可用、数据隔离、预期可观察。验收要求适用用例都有待验构建的有效结果，且 P0/P1 无未解决的 FAIL 或 BLOCKED。预期失败的自动用例在管理台按实际结果登记。失败保留，重跑追加。Major 阻断重要流程，Minor 可绕过。授权人 UNDEFINED。

结果面向用户，执行阶段报告关键发现，结束汇报覆盖/失败/残余风险及运行证据。只读辅助证据不得替代UI完成声明。

制作 DAG 验收从[原编号索引](story-lifecycle/SUITE.md#制作-dag-验收索引)进入，用例写操作与预期；仓库里的集成、升级、恢复及回归测试提供对应断言。用例就绪与候选构建已通过分别记录。
