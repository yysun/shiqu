# 图片保存冲突后的恢复

Git base: 0d76c207b2f3303e177caaa21b2d09b7d4e1121f

风险 non-low：涉及持久任务与并发写入，必须保持租约及付费重试边界。已有无关改动：lib/reader-local-contract.ts、server/local-story-discovery.ts、tests/chapter-main-stories.test.mjs。

- [x] 首先在受控 fixture 中复现两个 image version 共存及当前 publication 与 document URL 冲突。无外部模型调用。
- [x] server/reader-production.ts 统一计算当前图片 version；筛选、调度、执行与保存均拒绝旧 image/image-publish 版本，保留历史成功回执而不让旧失败阻塞。
- [x] 清理旧 queued/failed 图片任务，保留 running/succeeded 回执；仅当 row.error 匹配被清理旧失败、没有当前 failed/running 任务且 document/selection/state/error CAS 成功时清除历史失败，保持手动控制。检查 viewedPublicationPending 与过期锁恢复旁路查询。
- [x] 当前版本已付费 image 结果优先于旧版本抢先写入的槽位：publication 在文件校验后重新读故事、检查 version，使用旧槽位值 + plan/selection/setup generation + session/publication token 的 CAS 发布；禁止 full-document CAS 阻塞并发兄弟页面。既有失败通过显式重试重新发布，不重绘；旧回执与无关图片保留。
- [x] client/ui/StoryRetry.tsx 将 publication 的操作文案统一为“重试生成”，说明改为重试保存图片、不重新绘制；更新对应 UI 断言。
- [x] 运行相关队列/重试/版本集成测试、全部单元集成测试、typecheck 与 lint；独立 CR 后逐项 VR。

验证场景：.docs/tests/test-image-publication-recovery.md。
浏览器在 Work 设置中禁用；使用实际 React 渲染及 REST/SQLite fixture 验证。生产书库只读。

AR 已确认恢复策略：当前版本成功 image 回执应覆盖观测到的旧槽位，盲目保留 document 可能保留不符合当前分镜的图片。文件校验期间可能变化，写入前必须从 fresh row 重新判断；同值回执保持幂等。

AR risk: non-low — 修改持久任务版本隔离、并发图片保存及既有失败恢复。
AR review round: 1; reviewer: new
AR passed: no blocking architecture flaws

SS 证据：新增最初 5 项回归在修复前全部失败；修复后 queue-image-recovery、queue-interruption、storyboard-ui 与最初 5 项共 59/59 通过；扩展媒体等待后版本检查、SQL CAS 变化、兄弟页并发及保留当前真实失败后，新文件 9/9 通过。typecheck、lint 通过。尚待全套测试与独立 CR/VR。

SS 里程碑：05e2cc2。CR 第一轮发现参考图读取等待期间版本失效仍可能调用绘图；已在模型调用前再次检查，新增受控回归，新文件 10/10 通过。首次全套 775 项中 772 项通过，3 个 80 幅场景超时；修正 currentJobs 按任务重复解析故事的开销，每批筛选只计算一次 imageInputs。随后 queue-image-versions + reader-intake 24/24 通过，80 幅场景约 5.1 秒，未放宽超时。

CR risk: non-low — 涉及持久队列、付费绘图调度及并发保存。
CR review round: 2; reviewer: reused
CR fixed: 绘图前增加参考文件读取后的版本复核，阻止等待期间失效的任务调用模型；rerun result passed

运行环境：Node 24.22.1 / pnpm 11.25.0。localhost:3000 的实际 Vite 响应已包含新保存说明、无“重试展开”。只读查询确认开发服务已清理旧版本 queued/failed，保留旧 succeeded 回执，当前故事仍有 16 幅且等待显式重试。未发送 production POST、未手工写生产数据库。

最终 TT：`pnpm exec node --experimental-strip-types --test --test-concurrency=2 tests/*.test.mjs` 776/776，通过，约 94.5 秒；三个 80 幅场景分别约 5.7/5.0/6.1 秒。`pnpm typecheck`、`pnpm lint` 通过。保留原有超时及断言。默认并发复跑为 775/776，一个 80 幅场景在约 15.5 秒超时，保留该资源竞争限制，不宣称默认命令通过。

ET：按匹配场景使用实际 REST/SQLite/媒体 fixture 执行版本并存、失败重试、晚到及并发保存；实际 React SSR 和回调检查覆盖 UI。浏览器在 Work 设置中禁用，未验证手机实际点击，也未在生产故事上触发付费继续。

SS 后续里程碑：3469e3c（绘图前复核及批量输入上下文）。收尾时新增的 lib/shelf-browser.ts 工作区改动属于并行任务，未纳入本故事。

VR risk: non-low — 持久任务恢复、付费调用边界和并发写入。
VR review round: 1; reviewer: not applicable
VR passed: all acceptance criteria complete
- 过期任务：currentJob/currentJobs、清理和文件等待后的复核一致；受控测试证明旧任务不调用提供方、不覆盖新页、不传播旧失败。
- 已有冲突：REST 显式重试采用当前已付费回执，同页绘图调用仍为 1；同值重放不重复 usage。
- 内容保护：兄弟页可并发写入；plan/selection/generation 和双重租约保护 CAS；当前真实失败及暂停/停止均保留。
- 文案：SSR 与 localhost:3000 的实际 Vite 响应确认 publication 显示“重试生成”及“重试保存”说明。
- 验证：完整 776/776（并发 2）、typecheck、lint，独立 CR 第二轮通过；所有 AP 任务已完成。默认并发超时与手机实测缺口已明确记录。
