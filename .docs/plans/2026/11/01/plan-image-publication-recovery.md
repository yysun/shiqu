# 图片保存冲突后的恢复

Git base: 0d76c207b2f3303e177caaa21b2d09b7d4e1121f

风险 non-low：涉及持久任务与并发写入，必须保持租约及付费重试边界。已有无关改动：lib/reader-local-contract.ts、server/local-story-discovery.ts、tests/chapter-main-stories.test.mjs。

- [x] 首先在受控 fixture 中复现两个 image version 共存及当前 publication 与 document URL 冲突。无外部模型调用。
- [x] server/reader-production.ts 统一计算当前图片 version；筛选、调度、执行与保存均拒绝旧 image/image-publish 版本，保留历史成功回执而不让旧失败阻塞。
- [x] 清理旧 queued/failed 图片任务，保留 running/succeeded 回执；仅当 row.error 匹配被清理旧失败、没有当前 failed/running 任务且 document/selection/state/error CAS 成功时清除历史失败，保持手动控制。检查 viewedPublicationPending 与过期锁恢复旁路查询。
- [x] 当前版本已付费 image 结果优先于旧版本抢先写入的槽位：publication 在文件校验后重新读故事、检查 version，使用旧槽位值 + plan/selection/setup generation + session/publication token 的 CAS 发布；禁止 full-document CAS 阻塞并发兄弟页面。既有失败通过显式重试重新发布，不重绘；旧回执与无关图片保留。
- [x] client/ui/StoryRetry.tsx 将 publication 的操作文案统一为“重试生成”，说明改为重试保存图片、不重新绘制；更新对应 UI 断言。
- [ ] 运行相关队列/重试/版本集成测试、全部单元集成测试、typecheck 与 lint；独立 CR 后逐项 VR。

验证场景：.docs/tests/test-image-publication-recovery.md。
浏览器在 Work 设置中禁用；使用实际 React 渲染及 REST/SQLite fixture 验证。生产书库只读。

AR 已确认恢复策略：当前版本成功 image 回执应覆盖观测到的旧槽位，盲目保留 document 可能保留不符合当前分镜的图片。文件校验期间可能变化，写入前必须从 fresh row 重新判断；同值回执保持幂等。

AR risk: non-low — 修改持久任务版本隔离、并发图片保存及既有失败恢复。
AR review round: 1; reviewer: new
AR passed: no blocking architecture flaws

SS 证据：新增最初 5 项回归在修复前全部失败；修复后 queue-image-recovery、queue-interruption、storyboard-ui 与最初 5 项共 59/59 通过；扩展媒体等待后版本检查、SQL CAS 变化、兄弟页并发及保留当前真实失败后，新文件 9/9 通过。typecheck、lint 通过。尚待全套测试与独立 CR/VR。
