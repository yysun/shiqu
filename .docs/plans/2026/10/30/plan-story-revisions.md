# 故事修订实现计划

Git base: c49d53abc2da9a17b88738bef163bc19ff2c68f1
风险：non-low；涉及持久化、媒体所有权、队列依赖和跨组件编辑。

版本使用独立 session，无破坏性迁移。Document.revision 保存父/root/version、原始绘图输入和复制后的图片（非递归快照）；原 session 完整保留。新版本重新审片；每次编排/修订完毕，按实际绘图输入与基线对比决定哪些复制图仍可用。制作要求变化影响 imagePrompt，全部重绘；幅数变化重编排后允许相同索引且输入完全相同的图复用。第一幅失效引起所有依赖它的图片失效。

提交为 owner-scoped CAS INSERT SELECT：token 含父 document/selection 与整个版本家族当前最大版本号 epoch，INSERT 的同一 SQL 校验 document/selection/epoch 并分配 epoch+1；同基线不同 requestId 只有一个能成功，刷新编辑快照后可从原版另起分支。requestId 重放必须匹配 owner/parent/token/changes 指纹；在媒体写前先检查已占用 ID。复制文件以内容 SHA256 命名为不可变资产，复制完成才发布 row，竞争失败仅可能遗留无引用本地资产。

子版首次 INSERT 为 paused 且 revision.handoff=true，绝不具备调度资格。统一 resume 路径先持久化暂停父版，再启用子版并清除 handoff；崩溃时最多留下暂停的子版，可由同请求重放或用户恢复继续，重启不会自动重复付费。旧 in-flight 仅保存父 session。不改旧 job，故无跨版覆写。新版本图片路径属于新版自身；无需扩大 media API 授权。

制作要求或幅数变更与手动分镜修改互斥，UI 明示两者不能同时提交，并提供保留重编排设置/保留手改分镜的明确选择，服务端也拒绝冲突。画风可与任一组合。重编排前显示“复用待编排后判定”的保守估计，不承诺精确最终图数。

- [x] 首个 SS probe：使用既有 SQLite/媒体受控 fixture，证明复制资产可作新版参考、原版晚完成无法写新版；失败则修订设计并重审。
- [x] lib/reader-revision.ts：严格修改输入、纯重做规划/影响摘要、复制图失效计算；禁止无效与互斥修改。
- [x] lib/reader-model.ts/repository/api + server reader revision service：编辑快照、幂等 CAS 创建、媒体复制及版本关联；重启可恢复。
- [x] lib/reader-engine.ts：编排及修订后重新计算可复用图片，配文不触发绘图；现有队列只处理缺图。
- [x] UI：复用 Sheet，统一草稿，现有流程标题进入相应编辑；复用画风/幅数控件；显示影响及一次入队按钮，版本返回入口和草稿丢弃。
- [x] 有意义的纯逻辑和 REST/SQLite/文件/受控 provider 集成测试，覆盖无变化、旁白、提示词、首幅、画风、要求、幅数、审片修订扩大影响、并发/幂等/权限/重启/删除父版。
- [x] 运行 pnpm test/typecheck/lint（隔离记录无关已有失败），IAB 完成 test-story-revisions.md；不构建 Docker/桌面包。

验证依赖：真实 Node24 SQLite、FileMedia、生产 provider 适配器的受控 transport；浏览器用开发服务测试 fixture，不发送真实推理。全项目现有 legacy hash golden/lint worktree 问题须重核范围，不能修改无关测试以凑通过。

## 队列更新后的重新 AP（2026-10-30）

原故事 Git base 保持 c49d53a；当前集成基线 5277e90（队列实现 8db844d、回归 5277e90，结束页书架入口 9d429df 均为并行已提交工作，不能回退或混入修订故事提交）。暂停时未提交的修订实现计入本故事范围，重新验证后才能确认完成。

新队列按当前阅读幅数提升优先级，短暂让出正在发布的阅读故事；丢失文件只在显式重试后重绘。修订仍创建全新 session，不调用旧 queue.rerun，不清空父版任务、不重置已成功 job。新版本沿用 generation_mode=background 和 useStoryGeneration 的 focus 上报，阅读新版时优先级自动生效。首次提交 handoff 从 paused 子版开始，父版已在途的 publication 继续保存原版，不能误判为新版本可复用结果。

- [x] 恢复 SS 的首个 probe：现有 reader-revisions、reader-production、queue-image-recovery、reader-production-client 测试和类型检查，核对新参考校验接受复制图片路径；若 probe 显示架构冲突，停止依赖实现并回 AR。
- [x] 完善 revision 创建：检查输入长度、无变化、分镜元数据范围、幂等与 family epoch 竞争，故障后 paused handoff 可从重放或恢复继续，已完成/删除的父版不阻碍新版恢复。
- [x] 补充新队列回归：新版丢失参考/新生成图片后显式重试只重绘缺图、不恢复旧版 paid dispatch、不从 revision.base 复活丢失结果；阅读新版 focus 上报沿用既有能力。
- [x] 完成 UI：关联草稿与所属故事，阻止重复提交和保存中离开；保证三个层叠 Sheet 的关闭/焦点/滚动恢复，刷新冲突提示、版本导航、小屏编辑，以及保存成功但打开失败仍能找回新版。
- [x] 扩展真实 SQLite/文件/受控 provider 测试至需求矩阵；IAB 按 E2E 验证编辑取消、受控提交和版本切换，不调用真实生成、不改真实《大葫芦》的内容。
- [x] 完成 SS 后提交可回退里程碑（只含故事修订代码/测试/文档）；完成独立 CR、完整适用 TT 和 ET。版本号/CHANGELOG/Cargo 的并行修改不提交。

验证：Node24 + pnpm，先定向新旧队列测试；类型检查；eslint 仅实际源码及全项目 lint 分别记录。TT 执行全部 tests/*.test.mjs，不能以既有失败的描述代替本轮证据。桌面入口沿用运行中的 pnpm desktop:preview；Reader 用现有 IAB 标签及临时隔离的受控 Vite/REST 测试实例，不运行打包命令。

复用资产复制时必须核验 bytes：本次预览会复用的非空 URL 对应文件若丢失、损坏或不在父版媒体空间，提交在发布 child 前失败，草稿保留；不能将复制失败静默变成自动付费绘图。仅有意失效的图（画风/全局要求、已修改画面）可以不复制；幅数重新编排时，存在的基线原图需通过检查后才用于后续复用。UI 解释具体幅号和提交未发生；不自动重试生成。复制读写抛错同样不能付费降级。新增丢失/损坏/暂时读取失败案例，断言无 child、无新增 provider image 调用。

AR passed: no blocking architecture flaws.
AR risk: non-low — persistent version publication, paid dispatch and asset reuse.
AR review round: 4; reviewer: reused.

## SS 证据

- 新旧队列 probe 73/73；扩展修订与审片、阅读交互相关 54/54，修订专项 16/16，Node24.22.1。类型与全部修改文件 lint 通过。
- pnpm11 默认 verifyDepsBeforeRun 尝试自动重装依赖；本次使用 `--config.verify-deps-before-run=false` 运行已有 pinned runtime，不改依赖/锁文件。
- IAB 隔离实例 3010/3011、真实 SQLite/FileMedia 与受控 provider：通过流程进入幅数/画风/分镜/要求草稿，冲突选择、纯配文 8 图复用/0 重绘预览，实际提交 child 第2版；计数 images=8、plans=1、reviews=2，原版配文保持；三个 Sheet 关闭后 body/root 样式全部还原。375px 无横向溢出。证据 .data/evidence/story-revisions/。
- 当前常规 3000 书库未返回历史《大葫芦》9970...；仅做 GET 打开尝试，没有编辑或创建该故事版本。完整提交验证在隔离实例，真实故事未触发生成。
- 新增书架版本标签以区分同名新旧版；复用实际新版图片，不改变原任务队列代码。

SS milestone: 1123072。独立 CR round1 指出新版打开失败回退时可能清空原收藏/进度；已捕获并恢复完整阅读状态，IAB 故障实例强制新版本 GET503 后，原版仍第2幅且取消收藏按钮可见，REST page=1/saved=true；截图 failed-version-preserves-progress.png。该 Reader 修复已由第三阶段最终 CR与IAB故障证据确认。
TT: 467 项 466 通过，唯一失败为 fast-first-story.test.mjs:36 的既有 legacy cache hash golden（ed2dea vs39814a）；完整 lint 唯一为 .claude/worktrees/sweet-lederberg-4788bd/lib/reader-pdf.ts 的既有 no-control-regex；本任务修改文件 lint 与 typecheck 通过。
用户 !! 调整为先新建队列流程、再显示UI、最后故事修改；该顺序已完成，联合回归与最终验收见末尾证据及done文档。

最终联合收尾：新建排队→统一确认→完成4幅→仅配文修订→返回原版在IAB通过，新旧版本与4图复用已核对；回退失败保持第2幅/收藏证据有效。CR round4 passed，无主要发现。完整TT483项482通过，唯一既有legacyhash失败不变；类型和本次源码lint通过，全lint既有worktree错误隔离。ET记录已补齐；最终VR见本故事done文档。
