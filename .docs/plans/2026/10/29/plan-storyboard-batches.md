# Storyboard batches

Base: `93437e0e1db301e46af4185d845f42eee2b0c3b4`

在现有 JSON 文档中增加可选 storyboard 检查点（固定元数据、逐幅提纲、已保存分镜），无需数据库迁移。现有完整 plan 继续作为绘图唯一入口。生成引擎每步仅执行一次提纲或最多 20 幅细化调用，队列按检查点派生不同脚本任务，保留既有暂停、需求和重试规则。短篇继续原有 plan 调用；自动幅数先由提纲确定。

- [x] 第一实现步骤确认队列可用不同脚本键串行推进检查点，完成任务只在完整 plan 后释放图片依赖；若不可行，停止并重新审查方案。
- [x] 增加提纲与批次的共享校验、提示和两提供方实现；本地原文验证覆盖新入口。
- [x] 引擎保存每步结果与用量，队列串行续批且尊重暂停和重启；保持完整 plan 才绘图。
- [x] 暴露已保存数和当前范围，更新进度提示。
- [x] 按用户补充要求将总上限改为 80，消除后台队列 59 的硬编码；提示和输入、媒体、事件上限统一引用 readerMaxFrames。
- [x] 增加边界、错误输出、重试、并发、暂停/重启、提供方传参和完整 HTTP 队列回归验证。
- [ ] 使用 Node 24.22.1、pnpm 11.25.0 运行 typecheck、lint、全部单元/集成测试；按测试文档验证界面。

风险：队列任务键必须随检查点变化，不能将未完成分镜误当整篇脚本成功。批次输出需严格按剩余数量校验后才追加。提纲增加一次推理调用，不能将分批宣传为必然节省总时间。原文和用户字段仍只是资料。

AR passed: no blocking architecture flaws

AR risk: non-low — 跨提供方调用、JSON 检查点、队列依赖与 80 幅边界；独立 reviewer review_batches 完成两轮（第二轮复用，覆盖用户新增 80 幅要求）。

SS 首个探针：Node 24.22.1 下 tests/storyboard-batches.test.mjs 的两提供方 45 幅 HTTP/SQLite 测试通过，保存数 0/20/40/45 且全部分镜完成前无图片调用，方案可行。

SS 窄验证：storyboard-batches、storyboard-ui、local-books 共 34/34 通过；local-image-batches、reader-production、generation-progress 与首批 storyboard 测试共 54/54 通过。80 幅后台绘图、索引 79 媒体/事件/进度、暂停/停止/失去需求、重启、坏批次与精确重试均有真实 HTTP/SQLite 证据。浏览器由 Work 设置禁用，界面验证为实际 React 组件静态渲染。
