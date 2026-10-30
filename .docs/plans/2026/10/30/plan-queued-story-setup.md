# 排队选题与统一制作确认

风险 non-low：持久化生命周期、选题的付费文本调度、并发与确认门槛。原修订故事1123072是依赖；其 switchVersion 失败恢复修复继续验证，不回退新队列8db844d/5277e90及结束页书架入口。
Git base: 1123072（原修订里程碑）；进入SS时已有的Reader失败恢复属于后续第三阶段依赖。

## 设计

继续使用 reader_sessions 和 production_jobs，无迁移。创建 session 的请求增加 intake:true（旧请求不变），Document.intake 保存 phase、generation、候选批次和进度。先创建再调度；UI 的选题请求不再直接调用页面 streaming suggestions。

新阶段：discovering → choosing → preparing → confirming → confirmed。discover job 使用现有 provider.suggestions / local-book 缓存与来源校验，文本池1个工作位，按既有租约/中断恢复；结果和批次保存后选择阶段不持锁、不执行后续。max40批，保存排除项及出处回执，已选候选只从服务器保存的批次索引提取，不接受客户端伪造 source。候选附带已有画风建议，缺少建议可手选默认，不伪造推荐。

选择后 preparing 使用现有 prepareOriginal/recommend，保存原文与幅数建议后转 confirming。复用画风和幅数控件，提供故事重选/书籍主题回显/原文查看/制作要求。最终UI按unified-story-setup统一流程与编辑器，不展示叙事详略，保留隐藏已有值。一条 confirm 请求持久化最终画风、要求、详略、准确幅数并释放 confirmed 门槛。要求变更可主动重新推荐数量（新 generation），也可以采用明确自定义的幅数直接确认；画风不改变候选或幅数建议。初始书籍/主题不就地改，另建任务。

每个意图动作携带 expected generation（CAS），同一动作重放匹配已保存 lastAction/requestId 返回当前状态；不匹配的并发请求409。选择/重新推荐仅允许非running、尚未confirmed、未产生plan的状态；旧prepare晚回执受session token保护。generation纳入该intake专有的scriptVersion，避免重选同一故事复用错误的prepare收据。候选增批入队后允许回看已保存批次，运行中不切换故事（明确提示先暂停并等当前任务保存）。队列已批准的失败重试/丢图与优先级机制保持。

视图增加 intake（有限候选、phase/generation/progress），现有generationProgress phase增加discover/story-choice/production-confirmation；nextStep 对 choosing/confirming阻断后续，discover由coordinator专用handler执行。legacy advance对intake统一走production coordinator，并且engine对不能处理的discover不误走audio。frame-count旧入口不得绕过intake的完整确认。

## 执行任务

- [x] 首个 probe：受控provider完整suggestions返回持久化候选、离开重启仍待选择且image/plan调用为0；失败停止依赖实现并回AR。
- [x] 实现 intake 类型、视图和repo原子动作/CAS，API创建flag和setup动作，封堵旧frame-count/advance绕过确认。
- [x] coordinator增加discover handler、完整进度与候选检查点，原文/幅数准备及scriptVersion世代隔离；不占用等待用户的文本池。
- [x] 新建UI先选书籍主题再创建队列任务，替换页面临时选题流程；制作确认页复用样式/幅数/要求/原文内容；状态卡和书架正确展示与恢复，关闭不取消后台任务。
- [x] 队列/REST测试覆盖失败重试、崩溃保存、重启、同动作重放、并发选择、推荐更新、旧客户端绕过、空候选/40批边界、明确确认才绘图，保留旧队列与修订测试。
- [x] IAB隔离服务验证书籍主题先入书架、离开/刷新后继续、候选选择及统一确认；适用完整TT、类型/lint及独立CR，不打包。

## !! 顺序与并发隔离修订

用户明确顺序：1) 后端队列生命周期与确认门槛；2) 新流程显示及制作确认UI；3) 故事修订兼容新流程、恢复失败路径修复和统一验收。现有1123072保留，switchVersion失败回退修复已写入并经IAB验证 page=1/saved=true，但在第三阶段最终审查交付。

每个 intake job payload 带 setupGeneration；coordinator 对 dispatch、snapshot、失败聚合、lease最终保存及中断恢复统一筛选当前generation，历史失败/排队任务保留但不控制新世代。provider结果保存同时检查session token和document.intake.generation；新动作仅在非running时CAS变更generation。priority/yield查询中的旧失败也不得阻止当前世代。确认后的图片任务同样标记generation。旧session无intake时保持原行为。

旧frame-count入口对intake一律拒绝；legacyadvance统一进coordinator，不可绕过选择或制作确认。source GET 在已保存original且无plan时仍可读。创建requestId须比较已保存的创作意图指纹，不被进度改变；setupaction另有独立requestId/hash，重放不再次生成。等待阶段不能因为nextStep=null被标记completed。选择新候选只换故事依赖，保留已手动设置的画风/要求/详略，不默默应用新画风建议。

新增验证：旧queued/failed job在换generation后不派发、不阻塞、不污染状态；late结果不能写入新generation；空候选和待确认不完成；旧入口不能触发后续；制作页读原文不依赖plan。

AR passed: no blocking architecture flaws.
AR risk: non-low — durable paid discovery, generation transitions and confirmation gates.
AR review round: 2; reviewer: reused.

阶段1 SS证据：reader-intake+reader-production 29/29；新建/重启待选/完整确认门槛、CAS选择、幂等、旧queued/failed世代隔离、失败准备替换、来源预览、40批/空结果均通过。新旧队列与修订联合71项曾有managed外部owner契约回归，已恢复原false行为，并以29项覆盖复测通过；其余70项当轮通过。后端typecheck和所改文件eslint通过。

## 审核闭环补充（用户新增要求）

在第一阶段后端流程继续补齐审片闭环，然后显示循环进度。将原一次自动修复扩为 readerMaxAutomaticRepairs=3：审核 → 定向修复（每批≤20幅）→全篇复核，未通过且repair轮数未达到3则继续；修复整个返回批次的caption/prompt均无实际变化时立即阻止绘图并待处理。达到3轮仍有问题同样阻止；手动继续复用保存issues，重置当前自动段计数但不清除历史报告。每次新审核有独立round/jobkey，不复用先前审核收据；文本池等待/暂停/停止与复用图失效继续沿用当前约束。

UI 显示审核/修订轮数和循环说明；不能把每次复核当最终通过。测试：第2/3轮才解决、持续问题3轮后停、无变化立即停、多批修订后才能复核、手动继续/暂停重启、caption-only保持原图。旧单轮预期随需求更新，不放宽其他断言。该补充随后经闭环AR round4通过并已实现，见下方证据。

闭环AR round3补正：ReviewCheckpoint增加 stopReason=limit|unchanged 和只增不减的repairHistory（每批请求幅号与实际改动）。无变化停止时不把本批标为已修复，保留此前批次review.repaired；手动继续对unchanged保留已完成批次，只处理剩余幅号；对limit使用最新审核问题并清空本轮进度。每次手动继续仍推进job-key round防收据重用，但实际审核次数取reports.length，修复批次数取history.length，当前自动段完整修复轮数单独显示，不能拿job-key当真实轮次。修订history/付费usage在抛出blocked前入库。新增40问题：先20改动、后20无变化、继续只修后20再复核的精确回归。已由下方AR round4通过。

闭环 AR passed: no blocking architecture flaws.
AR risk: non-low — paid repair loops, partial checkpoints and manual continuation.
AR review round: 4; reviewer: reused.

阶段2/3 SS证据：定向新建流程/审片闭环/修订/桌面共享SQL 55/55；类型和全部本次修改源码 lint 通过。阶段1 commit=e762a93。IAB3012：选《庄子》/聪明与糊涂/自定义要求，提取挂起时返回书架、刷新仍同session；选择后仅1次提取，0分镜/0绘图，原文已可查看；完整确认4幅后进入分镜并读到4幅剪纸故事。新增原文/候选历史、手改设置随新候选原子保存。桌面共享SQL补充当前generation过滤和新阶段/闭环实际计数，不暴露prompt或历史正文。

既有修订 Reader失败回退修复保留完整收藏/阅读状态，IAB已有故障证据。新流程故事修订UI衔接、独立CR、完整TT及ET现均完成，证据见最终联合收尾；不运行构建或推送。

CR round2修复：远程原文缓存按所选书籍、故事、出处回执和引用线索的SHA256分别保存；不再读取session级无绑定source.json。已保存doc.original检查点不变，同故事返回仍复用。真实FileMedia+远程HTML解析路径验证A→B→A分别使用正确原文、仅取两次、两次推荐均对应当前原文；遗留无绑定错误缓存不能被读取。

legacy awaitingFrameCount仅用于无intake旧流程；coordinator单独识别intake.confirming为正常准备完成。confirming→more→discovering→choosing覆盖真实队列、观察循环和书架状态，避免旧幅数建议导致停止刷新。定向41/41、typecheck及修改文件lint通过。审核闭环、版本隔离结论仍交独立CR复核。

CR fixed: both round-2 findings are resolved; rerun result passed.
CR risk: non-low — source fidelity, durable lifecycle and paid generation gates.
CR review round: 3; reviewer: reused.

TT后续修复：世代过滤前先检查可读性，不能让null或截断document使整条队列tick抛错；SQL世代条件也对损坏JSON作安全解析。循环终态停机用例扩到3轮修复/4次审核，进度断言包含真实轮数。批量job筛选只解析一次session document，避免80幅故事逐job反复解析大分镜。原80幅分批/队列21项全部通过，新增intake确认80幅/四批/每幅只调用一次的回归。

CR passed: no major findings.
CR risk: non-low — queue isolation, recovery and large-story scheduling.
CR review round: 4; reviewer: reused.
只读独立复查确认：损坏记录隔离、世代过滤的每批解析、三轮修复停机边界均无主要问题。最终定向44/44（包含intake80幅）、原分批21/21；类型/实际修改源码lint通过。ET记录已补充至两个test文档。完整TT以Node参数放在文件列表前、concurrency=1重跑，避免所有大书库与80幅生成同时竞争CPU引起15秒fixture超时，不改任何超时断言。

最终TT：Node24.22.1/pnpm11.25.0，`pnpm --config.verify-deps-before-run=false exec node --experimental-strip-types --test --test-concurrency=1 --test-timeout=60000 tests/*.test.mjs`，483项482通过/1失败；唯一失败fast-first-story.test.mjs:36既有legacy cache hash golden（actual ed2dea… vs expected39814a…），与原SS记录相同。本次intake80幅与两种provider既有80幅均通过；所有本次需求相关用例通过。并行运行出现的80幅15秒等待超时在实际串行全套中不再出现；未扩大断言时间或削弱断言。

Typecheck与实际修改文件eslint通过。完整lint唯一失败仍是并行遗留worktree `.claude/worktrees/sweet-lederberg-4788bd/lib/reader-pdf.ts:13 no-control-regex`，不改无关文件。IAB ET与REST/队列覆盖记录已写入两个test文档，验证服务/临时标签已关闭，故障注入已清除。代码里程碑1123072、e762a93、1945967、92f7cd8、2c94e81；无推送、无打包、未包含版本号/CHANGELOG/Cargo并行修改。

验证边界：当前真实3000书库不含历史《大葫芦》9970...；未对真实故事编辑或触发付费。本轮所有提交、确认与修订的IAB操作均在临时隔离SQLite/FileMedia实例，provider由受控适配器提供；多轮审核的真实队列执行由集成测试证明，浏览器截图显示循环规则和初审通过的实际状态。
