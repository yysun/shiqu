# Story frame count

Story base: `e4a1106fe27337fa3a586acca7f9feb3be1b570c`（保留原故事基线）。
Correction base: `226ed02c23a2155a92ca16c37cdd2e160ed7a4b8`。此前已交付的自动/指定方案，本轮按用户 !! 修订；此前 AR/VR 对新方案失效。

## Current decisions

Selection 增加可选 narrativeDetail=brief/balanced/detailed；缺省保留旧会话路径，新 UI 默认 balanced，并不沿用旧 localStorage 的 numeric/auto 入口。Document 增加可选 frameRecommendation 和 frameCountConfirmed，保持现有 JSON 存储，无迁移。新流程为 recommend → 等待用户选数量 → plan → source/image；旧会话和已有 plan 不进入推荐。

recommend 使用既有 session lock。先调用本地 prepareOriginal，非本地来源通过既有 source resolver 以所选书与故事标题读取原文，原文保存后才调用轻量 count/reason schema。将原文来源 hint 缩窄为实际需要字段，不构造伪分镜。推荐与最终分镜都使用同一份保存原文；本地 wrapper 继续核对 source receipt。source unavailable 不靠模型记忆编造推荐。

等待数量时 nextStep 返回空但不是 complete；SessionView 显式暴露 recommendation/awaitingFrameCount，客户端停止自动推进。新增 owner-scoped POST sessions/:id/frame-count，严格校验 1–60，用状态+document+selection CAS 原子保存 numeric length 与确认标志。相同确认幂等；冲突/运行/已有 plan 拒绝改写；advance 自身也不能绕过等待状态。保留原额度、租期、超时和失败重试。

初始配置只显示详略三个选项，主操作“推荐画幅数”。复用现有生成 Sheet，在推荐完成后显示理由、同步滑块/数字、“使用推荐数量”和“生成 N 幅”；不用额外确认弹窗。书架待生成项可回到同一选择阶段。初始选择和运行数量状态分离，避免旧偏好跳过新流程。

Providers 共享推荐 schema/prompt 与详略语义；不含固定数量映射或 30–60 配额。最终 plan 的 exactPageCount 使用确认数量，且包含 narrativeDetail；旧 auto 提示也移除 30–60 强导向。UI 保持窄屏布局和键盘/禁用语义。

## Current tasks

- [x] 扩展 model/contract/source hint、两 provider 与 local wrapper：详略、推荐 schema/prompt、同原文推荐与分镜；新旧兼容。
- [x] 扩展 engine/repository/API：原文保存、recommend checkpoint、等待与完成判定、CAS 数量确认；支持失败重试、并发与幂等。
- [x] 扩展 generation loop/hook、Reader 与 StoryFrameCount：详略先选、可恢复数量面板和精确生成；书架/刷新，锁定与移动布局。
- [x] 新增受控 provider/REST/SQLite 回归：三档、1/60、非法输出/输入、来源失败、确认冲突、重启和重试；保留旧全套批次测试。
- [x] 更新 README；运行完整 pnpm test、typecheck、lint、production build（Node24.22.1 / pnpm11.25.0），无 Docker/安装包构建。
- [x] 执行 .docs/tests/test-story-frame-count.md：真实前端+隔离受控服务，可见默认/三档/建议/调整/确认/书架恢复及390宽布局。

## Current risk / first probe

Non-low：新增持久检查点和确认接口，跨 UI/provider/reader generation 状态机。先以受控 Gemini/Codex、真实 SQLite 跑 recommend → 等待 → 原子确认 → 精确 plan；证实无图/分镜提前执行、重启复用和来源失败阻断后继续 UI。失败需修订并重新 AR。旧版本不识别新等待阶段，回滚需保留新版或恢复之前数据备份。

## Previous delivery evidence (superseded where current decisions differ)


SS feasibility probe passed: Node 24.22.1 / pnpm 11.25.0, 18 targeted tests using both actual provider adapters, real temporary SQLite and FileMedia. Auto plans of 1 and 30, exact 1/8/10/12/30/60, mismatch rejection, frame-60 media/progress/events and restart all passed. No live inference.

AR passed: no blocking architecture flaws

AR risk: non-low — extends persisted selection semantics and reader/provider contracts across generation and resume.

AR review round: 1; reviewer: new.

Browser availability probe: the computer-use tool returned `Local browser use is disabled in Work settings` on discovery and direct iab creation. This does not establish that the user disabled a setting or is using Work; the underlying cause is unresolved. UI E2E used a separate Playwright session with temporary controlled data, disclosed to the user.


SS implementation milestone: `0dce9c3` (`feat(reader): support automatic and adjustable story frame counts`), with focused 18-test probe and typecheck passed before commit.

CR passed: no major findings

CR risk: non-low — persists expanded count intent and extends provider/reader boundaries.

CR review round: 1; reviewer: reused.

TT: full `pnpm test` passed 176/176 on Node 24.22.1 / pnpm 11.25.0. `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`, and `git diff --check` passed. No additional applicable unit/integration suites for these reader changes; desktop native suites are outside scope.

ET: `.docs/tests/test-story-frame-count.md` scenarios 1–4 passed through the controlled provider REST tests. Scenario 5 passed in a separate Playwright browser against a temporary real local SQLite app with a controlled generation provider, without reading production data or calling inference. Verified auto default, manual 36, slider/number synchronization at 1/30/60, ArrowRight keyboard adjustment, 60 retained across auto/manual toggle, single label, disabled controls during session creation, POST length 1, rendered first/only frame and ending, and count controls only in new-story configuration. At viewport 390×844 the picker measured clientWidth=scrollWidth=332 (no horizontal overflow); inspected mobile screenshot. Browser console showed no errors (one development warning). A test locator initially expected “下一页” instead of the actual “读完，回味”; reading and ending were subsequently verified with the actual controls. Visual screenshot inspection found the existing global label style made mode labels and the numeric suffix stack vertically. Scoped row direction/margins and native input sizing were corrected in reader.css; affected UI, lint and build were rechecked.

Limits: controlled responses establish application contracts and UI behavior; the later real-model full-plan call hit the existing120-second cap; narrative quality and visual consistency could not be assessed. Existing saved numeric preferences remain selected until the user chooses auto. No database migration, Docker build or push.


SS styling milestone: `aef4d33` (`fix(reader): keep frame count controls aligned on mobile`). Rechecked picker row layout, 1/30/60 synchronization and remembered60; lint and build passed after the CSS repair.

CR passed: no major findings

CR risk: non-low — the story extends persisted count intent and reader/provider contracts; round 2 reviews only the scoped CSS repair and its interaction with global label/input styles.

CR review round: 2; reviewer: reused.

VR passed: all acceptance criteria complete

VR risk: non-low — coordinated client/server and persistence validation.

VR review round: 1; reviewer: reused.

All five criteria are evidenced: automatic planning, synchronized 1–60 controls, durable provider plans, single/60-frame reading and recovery, and legacy compatibility. Recorded verification: 176 tests, typecheck, lint, build and browser E2E passed.


Additional user-requested live trial: after clarification from the different historical Shiji Dongguo to Dongguo and the wolf, the historical attempt was cancelled. A single full-plan call to configured `gpt-6.1-sol` using the shared production auto prompt/schema and2610-character verified public-domain《中山狼传》timed out at the existing120-second runner limit; no count or plan was returned. A separate count-only preview succeeded in40644ms: gpt-6.1-sol recommended58 frames with beat allocations4/9/5/8/6/10/7/4/5 (sum58), including the old apricot tree and old ox retrospectives. The current30–60 guidance influenced this request; this is not a neutral/unprompted count or successful complete storyboard. Output: outputs/story-frame-count/dongguo-wolf-count-recommendation.json. This is material live evidence: controlled acceptance remains passed, but full-plan live readiness is not proven and the existing timeout may be inadequate for long automatic plans. No inference retry or timeout policy was changed in the application.


Final VR reassessment after the live timeout:

VR passed: all acceptance criteria complete
VR risk: non-low — provider and persistence contracts.
VR review round: 2; reviewer: reused.

The timeout does not invalidate the existing feature criteria or prove that the deadline needs changing.

The live full-plan trial **failed**: no count or plan returned within 120 seconds. Record that explicitly. A successful count-only preview would not verify the production planning flow.

Repeated full-plan timeouts would justify reopening runtime design. Increasing the deadline must account for the existing 180-second session lock.

## Current AR

AR passed: no blocking architecture flaws

AR risk: non-low — adds a persisted recommendation checkpoint and atomic count confirmation across reader state, providers, source storage and UI.

AR review round: 1; reviewer: new.

Source boundary: custom URL input may lack the book/chapter hint previously supplied by a completed plan. The existing resolver must report unavailable rather than invent a recommendation. Document and test this limitation; no new arbitrary webpage fetcher is in scope. Local source receipt/anomaly checks cover recommendation as well as final planning.


## Current implementation evidence

First SS feasibility probe passed: 24 controlled provider/REST/SQLite tests, then 36 focused tests after adding local-source and lost-response coverage. Both providers use saved original → recommend → idle waiting → CAS confirmation → exact plan, with no early storyboard/images. Three detail values,1/60, invalid output/input, competing confirmation, missing URL source and restart/retry passed. Typecheck passed after UI wiring.


Current SS milestone: `3a07851` (`feat(reader): recommend frame counts from narrative detail before storyboarding`). Focused36/36, typecheck, lint and production build passed. Includes only this correction's files; unrelated icons remain uncommitted.

CR passed: no major findings

CR risk: non-low — introduces a persisted recommendation/confirmation stage across source retrieval, provider calls, SQLite state, REST and reader UI.

CR review round: 1; reviewer: reused.

Current TT: complete `pnpm test`187/187 passed on Node24.22.1 / pnpm11.25.0 (log `/tmp/shiqu-detail-full-tests.log`). Final source typecheck, lint, production build and whitespace check passed. No Rust changes, additional applicable native suites, Docker build or desktop installer build.

Current ET: revised scenarios1–5 passed with controlled model results and real SQLite/local originals. Visible frontend at390×844 in separate Playwright session: legacy numeric60 preference still enters default适中; all three detail choices available; no count control before recommendation; detailed sent to recommendation; count7 suggestion/reason displayed with no plan/image jobs. Slider/number1/60, ArrowLeft→59, restore7 and 单幅概述 verified. One dialog, width=scrollWidth=390; screenshots inspected (`outputs/story-frame-count/detail-options-mobile.png`, `detail-recommendation-mobile.png`). Closing to shelf and browser reload restored the same suggestion without another provider call. Delayed confirmation locked number/slider/button. Simulated lost confirmation response recovered by GET and produced exactly one detailed plan withcount1 and one image. A second brief session failed3 automatic attempts, displayed retry, then recovered recommendation after manual retry; shelf/reload reopened this second session without another call. Controlled error/retry validation does not prove real model quality. Console clean after final reload except existing mobile meta deprecation; an intentional aborted confirmation generated the expected transport error earlier.

ET setup correction: the first fixture proxy used Vite's default host rewrite, triggering the application's existing cross-site request rejection before selection. Fixed the fixture to preserve Host (changeOrigin:false), restarted isolated data and reran; no production security change. In-app browser inventory again returned `Local browser use is disabled in Work settings`; underlying cause remains unknown and no user setting was changed. Separate session was disclosed. UI fixture uses real local receipts/SQLite with controlled Codex adapter, no live inference or personal library.


## Current VR / delivery

VR passed: all acceptance criteria complete

VR risk: non-low — durable recommendation and count confirmation coordinate source retrieval, providers, SQLite state, REST and reader UI.

VR review round: 1; reviewer: reused.

All six revised criteria complete. Full final independent result retained verbatim in .docs/done/2026/10/29/story-frame-count.md. DD complete; !! stopped before final GC. The user subsequently authorized committing the remaining delivery documentation locally. Temporary UI service, browser and SQLite fixture closed/removed; evidence screenshots retained in ignored outputs.
