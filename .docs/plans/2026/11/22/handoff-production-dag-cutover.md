# 交接：制作 DAG 切换（M4.5）

本文件供接手的代理继续 M4.5。背景、决策与已完成的里程碑见 [实施计划](../21/plan-data-driven-production-dag.md)，规范见 [story-production-dag.md](../../../story-production-dag.md)。

## 工作位置

- 分支 `production-dag-cutover`，工作树 `.claude/worktrees/dag-cutover`（与主检出隔离，`main` 及读者的真实书库不受影响）。
- 分支起点：`main` 的 `aad2aac`，合并暂存分支 `wip/production-dag-0025`（`7940281`，迁移 0025、转换钩子、格式版本）后为 `cb853b8`；第 1 步提交 `5a0334e`，交接提交见本分支最新一次提交。
- 全部完成并验证后再合并回 `main`。切换前不要在真实书库上运行本分支：迁移 0025 仍可能就地修改，已升级的书库收不到后续修改。

### 在工作树中运行

- 工作树隔离会拒绝 `source ~/.nvm/nvm.sh`，直接用 Node 24.22.1：`export PATH="$HOME/.nvm/versions/node/v24.22.1/bin:$PATH"`，再用 `corepack pnpm …`。依赖已用 `corepack pnpm install --frozen-lockfile` 安装。
- 复杂的内联脚本会被隔离检查拒绝；把脚本写成文件再运行（`.scratch/` 未纳入版本，可删除）。
- 不要用 `pkill -f "node --test"`：会结束其他会话或工作树的测试。只结束本工作树的进程。
- 受控提供方的测试（引用 `tests/fixtures/production.mjs`，约 76 个文件）全部跑一遍较慢；旧测试在新路径上会等到超时，建议按文件分批或加 `--test-timeout`，结果直接写入文件，不要经管道。

## M4.5 的步骤与状态

1. **按节点的故障、事务记录、仅 DAG 的协调器** — 已完成，提交 `5a0334e`。
   - 迁移 0025（暂存分支并入）：删除 18 个承载制作规则的触发器，保留 7 个完整性触发器；`reader_faults` 以 `node`/`node_key` 取代 `page`；`production_jobs.error_code`；书库格式 2。转换钩子 `server/dag-migration.ts` 与测试 `tests/production-dag-migration.test.mjs` 通过。
   - `server/production-records.ts`：任务失败、重新排队、开始、成功、删除与故障和恢复回执的联动；`writeStory()` 在故事文档写入的同一事务中写准备与查找回执、替换回执，并在准备世代改变时作废故障。队列（`server/production-queue.ts`）、恢复与控制命令（`server/reader-commands.ts`）、准备与重选写入（`server/reader-intake.ts`、`server/reader-reselection.ts`）已改用这些事务；失败记录错误码。
   - `server/reader-production.ts` 重写为：选题查找、准备阶段（仍用旧的准备任务 `prepare` 与 `advanceStory` 的建议步骤）、其余全部经 `server/dag-production.ts`。没有 dag 的故事在确认后（或没有准备流程时）由 `DagProduction.adopt()` 建立 dag，已有旧版内容按 `convertDocument` 转换；没有原文的故事由 DAG 的 `verifySource` 工作取得原文。放行改为只放行当前需读者处理的结论（`DagProduction.override()`）；恢复对无任务的故障直接解除、对有任务的故障以授权重跑该任务。
   - 验证：`tests/production-dag-*.test.mjs` 全部通过（103 项）；类型检查通过。旧测试大量失败，见下文。
2. **新故事进入 DAG** — 大部分由第 1 步的 `adopt()` 与 `verifySource` 覆盖，尚缺：
   - [ ] 决策 7 的模型快照：建立 dag 时记录 `modelSnapshot`（`server/provider-snapshot.ts` 的 `currentSnapshot`），任务按快照构造提供方（`providerForSnapshot`），快照服务不可用时显示「快照服务不可用」并提供「应用当前模型设置」命令。目前 DAG 任务仍用当前全局提供方。
   - [ ] 为「没有准备流程的故事经 `verifySource` 取得原文」和「确认后经 `adopt()` 进入 DAG」各加一个从正式接口出发的场景测试（`f.create()` 与准备、确认流程）。
3. **删除旧流程并处理旧测试** — 未开始。
   - [ ] `lib/reader-engine.ts` 的 `advanceStory` 只保留准备阶段（原文核对、建议）；删除编排、结语、审片、修订、换画风、绘图步骤，以及提供方中只服务这些步骤的方法（`outline`、`planBatch`、`plan`、`review`、`reviewFrameCount`、`restructure`、`repair`、`reflection`、`reflectionCandidates`、`summarizeStoryboard`、`restyle` 等；`lib/production-dag/calls.ts` 复用的提示词常量须保留）。
   - [ ] 计划中「删除并替换旧规则」一项：`lib/reader-model.ts` 的制作步骤推导与 `productionComplete()`、`lib/reader-revision.ts` 的旧修订规则、`lib/reader-revision-images.ts`、`lib/reader-story-brief.ts` 的失效函数、`lib/reader-review.ts` 的 `pendingRepairs`；`lib/generation-progress.ts` 与 `lib/production-stages.ts` 改读引擎状态；`client/ui/useStoryRevision.ts` 改用服务端预估（引擎 `preview()`）。`server/reader-revisions.ts` 中旧的 `forkRevision` 主体在全部故事都有 dag 后可删除，只保留 DAG 分支。
   - [ ] 复制（`server/reader-copy.ts`）对 DAG 故事的行为未验证：复制须带上 dag（或明确只复制文字并重新转换），并按画幅身份复制图片。
   - [ ] 被删除的旧能力需在 DAG 路径补回或在计划中明确取舍：阅读中的故事优先绘制当前页与后续六幅（旧 `pagePriority` 与发布背压），目前 DAG 绘图只按画幅位置排序；单独的「发布」步骤已不存在，绘图结果在保存前核对文件可读。
   - [ ] 旧测试：下文列出已观察到的失败。处理原则——测试旧流程内部步骤（编排批次、旧审片检查点、发布任务、旧修订规则）的测试随代码删除；测试仍然有效的产品行为（命令行、后台生成、暂停与继续、复制、恢复、优先级、调度节拍查询）改为针对 DAG 路径重写，并在 `tests/manifest.json` 更新 `covers`。按 AGENTS.md，评估工具与测试必须调用正式流程。
4. **检查、文档与合并** — 未开始。
   - [ ] `corepack pnpm typecheck`、`lint`、`test:changed`；`test:safety`、`test:startup`（升级、格式拒绝、版本 1 日志、转换可重做）；`src-tauri` 原生测试（`library.rs` 的日志版本范围已改，测试中 `{"version":1}` 不完整日志仍须被拒）。
   - [ ] M6 文档：状态机文档、用户指南、`AGENTS.md` 的书库说明（格式 2 需要 0.15.0 及以上）。
   - [ ] 合并回 `main`，删除暂存分支 `wip/production-dag-0025` 与本工作树。

## 状态（第 2–4 步完成，待用户确认后合并）

- 第 2 步 `ae7b18f`：`adopt()` 建立 dag 时记录 `modelSnapshot`，DAG 任务按快照构造提供方（`server/app.ts` 提供快照服务，测试注入的提供方沿用自身）；快照服务不可用时任务以 409 失败并显示「快照服务不可用」，`production-control` 的 `apply-model` 为「应用当前模型设置」。新增场景测试：经正式确认接口、无准备流程的故事经 `verifySource`、快照记录与不可用。
- 第 3 步 `73075bd`、`2457e13`、`7ae487e`：`advanceStory` 与 `nextStep` 只保留候选查找和准备故事；删除旧的提供方方法、`storyboardReviewGenerator`、旧修订规则、`forkRevision` 的旧主体；`view()` 的步骤与审片状态由 `lib/production-dag/progress.ts` 推导（经 `registerDagProgress` 登记，避免与 `reader-model` 形成加载循环）；复制（`server/reader-copy.ts` + `lib/production-dag/copy.ts`）按画幅身份带文字或图片；阅读优先由 `viewedPriority` 恢复（当前页至预读六幅与首幅先于未被阅读的绘图）；已付费的绘图结果即使故事已删除也保存。旧测试：约 30 个文件整体删除或大幅缩减，其余改写到 DAG 路径；清单、扩展 E2E（六个减为三个）与层级声明同步。
- 第 4 步：`typecheck`、`lint`、`test:pr`（按分支相对 `main` 的改动文件）、`test:safety`、`test:startup` 通过；M6 文档已更新（状态机文档、用户指南、AGENTS.md）。**未运行：** `src-tauri` 原生测试（构建需要 `desktop/resources/node`，只有桌面准备才会生成，按 AGENTS.md 不作为常规验证运行）；`test:models` 手动项；没有在界面上验证。

### 已知缺口与取舍（来自测试改写时的发现）

- 删除旧测试后没有 DAG 对应测试的保证：升级时已付费但未发布的图片回执被 0025 采用；改名在后续修订中被继承；横图的重启保留、删除后恢复、暂停修订期间禁止开始、重绘修订继承其余横图；图片丢失后文件在重试前恢复则免费复用；首图损坏不作参考发给提供方；单幅付费失败保留同批成功图片；各任务耗时与超时的持久化；`reader-revisions` 的梗概预览、`artStylePrompt` 换画风与恢复、指定首幅原图、仅换图的前提拒绝；命令行「定向 run 不派发其他故事、`--until prepared`、直接推理路由」。
- 行为变化：修订保存后须 `continue` 才开始；修改首幅画面描述只重绘该幅；付费绘图保存失败后重放会再次付费（无回执）；已完成但闲置的故事在没有需求时重启后不再被调度结算；首幅图丢失时非首幅的恢复请求返回 202 并等待首幅（不再 409）；`ready` 不扣除图片丢失故障。
- 其余：`/review-history` 与 `/prompts` 的结果仍读旧的 `doc.visualReview`，DAG 故事为空；修订的 `plan` 元数据（如 `sourceReference`）未校验；缩短幅数时阅读位置不再收缩；`adopt()` 不再经旧的幅数确认门槛；横图状态不核对文件；并发同样的横图开始请求，后者返回 409；客户端 `useStoryRevision` 仍用旧的 `revisionImpact` 估算（服务端 `preview()` 与 M5 界面未做）；`lib/reader-generation-contract.ts` 与 `lib/reader-review.ts` 经 `reader-model` 互相引用，导入顺序脆弱。

## 已观察到的旧测试失败（第 3 步之前，仅作历史记录）

以下来自一次未跑完的受控提供方全量运行（264 项已执行、约 70 个失败的测试名，含父子重复），仅作起点；完整清单需重新运行。可用测试名在 `tests/` 中搜索对应文件。

- 1 frames use a single short plan or bounded batches
- 20 frames use a single short plan or bounded batches
- 21 frames use a single short plan or bounded batches
- 21 requested repairs are saved as 20+1 and only then reviewed again
- 40 frames use a single short plan or bounded batches
- 60 frames use a single short plan or bounded batches
- CLI image-only edit redraws selected pages after explicit resume/run and preserves text, review and other images
- Claude uses public production CLI, scene batches, count review and targeted repairs and stops before images
- DeepSeek runs the public production CLI through 20/20/1 scene batches and both review gates without images
- Gemini converts watercolor scene prompts to cinematic before drawing
- Gemini converts woodblock scene prompts to classical-oil before drawing
- Gemini production completes discovery after the 1-to-32 transition, preparation, reviews and images
- Gemini task effort survives real queued review checkpoints alongside existing usage
- SQL candidates exclude paused, failed, superseded and active reader-mode deleted jobs, but retain publication and orphans
- Skill can copy text, wait for a user decision, then attach independent images to the same story
- a blocked review during a stop stays failed and never repairs automatically
- a blocked revision that reused its first image can still be drawn past
- a blocked story shows every issue, can be edited, and draws on the reader's word exactly once
- a clock jump during a live call keeps its claims, saves its result and pays once
- a corrupt file at publication asks first, then redraws only on explicit retry
- a corrupt first image fails the next page before paying, and retry redraws only it
- a deterministic 4xx in script work during a stop stays failed without replaying
- a display-title change during publication cannot fail the already-paid image
- a failed checkpoint save during script work is not a provider failure and recovers
- a failed failure write does not stop the queue or report a provider failure
- a failed job ends the hold on other stories
- a failed search stays with the search; obsolete jobs do not block the next one
- a failed success write is not a provider failure and recovers as an interruption
- a fault storage failure rolls back the blocked child instead of publishing an unrecoverable revision
- a file that comes back before the retry is published without paying again
- a lost connection returns the story to background order, and it keeps generating
- a lost first image redraws everything, and an unreadable one creates nothing
- a lost image is redrawn in the new version rather than blocking it
- a lost paid publication file requires a new explicit redraw rather than upgrading save authorization
- a missing file at publication asks first, then redraws only on explicit retry
- a missing first image fails the next page before paying, and retry redraws only it
- a missing opening introduction is repaired in frame one without replanning or adding frames
- a pause ends the hold on other stories
- a paused blocked revision requires resume before an explicit retry repairs and completes it once
- a paused failed review can be explicitly accepted without rerunning or changing the script
- a paused unfinished storyboard can be revised; late work, replay and restart do not resume or overwrite it
- a publication write error recovers without paying for the image again
- a queued text job for an unreadable document makes no paid plan call
- a read that throws stays transient without redrawing, even at retry
- a real provider failure while running is not treated as an interruption
- a running image checkpoint cannot revert the name; later revisions inherit it while fresh stories do not
- a shortened storyboard uses original frame identities, previews its own synopsis, and audits the fixed count
- a story-only style prompt survives draft reload and reaches storyboard and image jobs
- a stuck publication ageing out ends the hold on other stories
- a style revision saves the supplied first frame and draws only the remaining pages
- a viewed first image goes ahead of an older story's waiting first image
- a viewed first image still drawing leaves spare workers free for other stories
- all-rejected selection repairs only the selected sentence, then audits without stale candidates
- already-paid image publishes to a deleted active reader-mode story without another draw
- an image error uses its captured provider after defaults change
- an invalid saved image result is treated as lost, and redraws only on explicit retry
- an old in-flight image cannot publish late or start its queued siblings after inputs change
- an old viewer cannot hold back another story after a newer version is published
- an open story draws its first image, current page and read-ahead ahead of other work
- an uncertain reference read cannot reach a provider that has a separately readable media handle
- atomic active child survives restart and deleted parent; lost response replays without duplicate copy or generation
- automatic more cannot race past a chosen story at the SQL write fence
- automatic recovery stops at three attempts, and a retry restores the allowance
- changing only the style prompt redraws the story and restoring the preset redraws with its default
- checking a restored anchor settles only its pre-inference dependent failure and completes without a retry
- closing the story returns it to page order, and it keeps generating
- codex: 25 saved frames precede the separate ending and whole-story audit
- codex: 8 saved frames precede the separate ending and whole-story audit
- codex: an expired missing remote result resumes automatically but saved images do not repeat
- codex: anchor runs alone, later scenes publish out of order under one session lease
- codex: audit selects candidate 2 exactly and persists its evidence before drawing
- codex: audit selects candidate 3 exactly and persists its evidence before drawing
- codex: caption-only revision reuses every copied image, original and deleted-parent independence
- codex: early demand, single anchor, rolling refill, individual visibility and moving lookahead
- codex: ending-only repair is audited again and preserves every scene
- codex: failed ending resumes after restart without re-planning saved scenes
- codex: image-only redraw replaces selected pages including anchor without review or touching other images
- codex: immutable attempts and exact same-story anchor validation protect replacement bytes
- codex: invalid recommendations preserve the original and require an authorized retry
- codex: new stories generate every page without a viewer or a mode request
- codex: numeric detail prepares once and waits for durable explicit count confirmation
- codex: only corrupt media fails the queue; explicit retry preserves completed work
- codex: outage in the second batch keeps the first batch and retries only missing work
- codex: outline and 20/20/5 checkpoints precede every image
- codex: reordered story resumes at page 11 after restart without regenerating ten saved images
- codex: review is a separate queued job and gates all drawing
- codex: saved per-story requirements, actual prompts and acceptance-only revisions survive restart without redrawing
- codex: shutdown drains saved images; startup resumes only the missing background pages
- codex: source-specific setup suggestions survive restart, edits and confirmation, then route to their own stages
- codex: step timing uses the persisted production claim across reads and renewals
- codex: structural omissions block before any repair or image and survive retries and restart
- codex: style changes preserve planning and review; requirements and counts re-audit
- codex: twenty automatic repair rounds then block; concurrent manual continue reuses saved issues
- codex: 原典故事 edits title and ending after saved scenes, then independently audits both
- codex: 放下执念 edits title and ending after saved scenes, then independently audits both
- concurrent publication fences background control without changing the old version
- concurrent publication fences resume control without changing the old version
- confirmation drafts retain both requirements through restart and apply them only on explicit confirmation
- copy defaults to text only and accepts explicit image choices without reusing another art style
- copy preserves a passed storyboard and evidence; only images run in the destination
- copy retains partial image positions and later production draws only the missing page without review
- corrupt copy image keeps saved text and decision; retry finishes the same story without another question
- cross-library copy stores prompt records in the target; a text copy made before migration can still attach images
- deletion hides a story immediately while retaining every in-flight image and receipt
- direct desktop and development share stories/media/progress and exclude duplicate generation
- draft copies reject images and invalid checkpoints and retain explicit mode in replay identity
- every old-version start point refuses without changing attempts or documents
- expired background attempts recover with saved control (active) and never steal live claims
- expired background attempts recover with saved control (paused) and never steal live claims
- expired background script locks restart planning without viewers
- explicit draft copy preserves pending review, source text and provenance without inference
- explicit draft copy preserves repair review, source text and provenance without inference
- explicit retry publishes the current paid result over a stale slot once, without redrawing
- failed choice audit resumes after restart without regenerating candidates or frames
- failed criteria enter existing targeted repair and must pass a fresh audit before drawing
- failed publication INSERT leaves no child and replay publishes one active version
- failing tests:
- first-image loss preserves in-flight work, blocks new dependent calls and survives pause/restart
- formal review flow persists ordered history and before text without affecting generation on read
- frame count validation, owner, running lock and concurrent conflicting confirmation are fenced
- gemini: step timing uses the persisted production claim across reads and renewals
- healthy restored files complete locally with pause and no viewers
- healthy restored files complete locally with reader and no viewers
- healthy restored files complete locally with stop and no viewers
- image concurrency is configurable and global across stories; text/source are not repeated
- image continuation rejects a changed source after the Skill checkpoint and preserves the text copy
- image start rechecks newest version after its first dispatch check
- image-only redraw refuses an unreviewed story and missing unselected media without starting work
- independent publication recovery does not draw or clear an unrelated missing image
- independent recoveries can run together; first-image loss fences nonfirst redraws
- invalid candidates [" ","醒来之后，梦中的自在仍值得回味。","梦与醒的分界，也未必是心境的分界。"] preserve the saved storyboard
- invalid candidates ["梦中的自在，也能照见醒时的拘束。","梦中的自在，也能照见醒时的拘束。","梦与醒的分界，也未必是心境的分界。"] preserve the saved storyboard
- invalid candidates ["梦中的自在，也能照见醒时的拘束。","醒来之后，梦中的自在仍值得回味。"] preserve the saved storyboard
- invalid inputs, unchanged drafts, stale parent, and cross-owner IDs never create a child or write copied media
- invalid missing choice cannot mutate the saved plan or discard candidates
- invalid range choice cannot mutate the saved plan or discard candidates
- invalid reason choice cannot mutate the saved plan or discard candidates
- invalid title audit {"title":"   ","reason":"标题不准确。"} cannot change the plan or authorize drawing
- invalid title audit {"title":"","reason":"标题不准确。"} cannot change the plan or authorize drawing
- invalid title audit {"title":"字字字字字字字字字字字字字字字字字字字字字字字字字字字字字字字字字字字字字字字字字","reason":"标题太长。"} cannot change the plan or authorize drawing
- invalid title audit {"title":"庄周梦蝶","reason":""} cannot change the plan or authorize drawing
- late parent image writes remain isolated and derived eligibility blocks additional old dispatch
- legacy numeric background preparation retains count confirmation and does not plan or draw early
- local publication failure and legacy retry reuse the paid receipt and record usage once
- metadata survives late full checkpoints, queue completion, restart and revision inheritance without extra generation
- missing copy image keeps saved text and decision; retry finishes the same story without another question
- mixed issues repair all scene batches before rewriting the ending from the corrected whole
- mixed lost and transient failures prioritize the redraw action
- moving to another page changes what comes next without cancelling the running page
- new queue: copied anchor loss warns without paying, explicit retry redraws only anchor and edited scene
- new queue: lost revision publication only redraws its own edited page after retry
- one scene change redraws only that image, with copied anchor; first scene change redraws all
- only the current page and six after it go ahead of unread stories
- paid failure stops refill, keeps sibling successes and retry only draws missing scenes
- production queue draws every frame through the separate image provider and keeps text on the text provider
- pruning catches a job failing after the earlier changed-story pass, and expires only expired viewers
- publication requires the bytes to match the file type; a reference only needs a usable image
- quitting after pause during script work keeps the control, and Resume plans again
- quitting after stop during script work keeps the control, and Resume plans again
- quitting during frame-count preparation resumes it without a retry
- quitting during script work resumes planning without a retry
- reader deletion disarms background work; restore cannot restart it
- ready orphaned jobs in all four pools are contained and logged once while a valid job runs
- real CLI copy never asks for terminal input, with or without JSON mode or image flags
- reopening review notes waits for a fresh snapshot before enabling edits
- repair missing output cannot mutate the saved plan
- repairing an ending in a revision retains all existing images
- replacement of a failed active story inherits current control but clears only the new work
- replacement of a stopped story inherits current control but clears only the new work
- restart before viewer expiry never resumes paid work until a fresh viewer request
- restored files are reused by both health checks and a durable redraw command without inference
- restoring a file after a new ordinary redraw failure preserves its fault until an explicit free reuse
- results arriving after a clock jump, before any tick renews the claims, are still saved
- resume upgrades a paused reader story to whole-story work and reuses every saved image
- reusable corrupt asset is redrawn in the new version
- reusable missing asset is redrawn in the new version
- review changing the first frame reports the real redraw count; no preview, no notice
- review duplicate pages fail validation without image requests
- review out-of-range pages fail validation without image requests
- review repair invalidates newly changed staging but preserves caption-only repair images
- saved ending receipts and concurrent advances cannot repeat a paid ending
- saving only a storyboard synopsis retains the review, portraits, and landscape artwork
- saving pauses the old version, keeps favorites and valid progress; replay respects later resume and pause
- session and job heartbeats fence legacy advances while slow images are still running
- shelf refresh exposes choice and failure states without retrying
- shelf refresh reports running and queued work without dispatch or viewer renewal
- single-control upgrade preserves background intent, manual controls, failures, leases and receipts
- startup reconciles a fully published background story whose final session save was interrupted
- targeted run cannot dispatch another active story and direct-inference API routes never execute
- temporary storage errors and stale image reports cannot create redraw permission; truncated images do
- the reader leaving ends the hold on other stories
- two blocked manual corrections leave only newest eligible; stale retry/skip and old paid lock stay isolated
- two images lost after completion can recover separately without clearing or blocking the other fault
- unchanged ending blocks drawing and manual continuation uses the saved ending issue
- unknown/conflicting criteria stop immediately with evidence, no fabricated repair or drawing
- upgrade backs up and repairs stranded blocked revisions without replacing authorizations or healthy checkpoints
- upgrading a pre-background library preserves checkpoints and pauses old stories
- viewing a saved failure preserves its attempt count until an explicit retry resumes generation
- warm paused pass uses at most 60 statements; unchanged active state and viewer renewals perform no upserts
- without a reader, order stays by page across stories
- 一个节拍执行的故事查询都不全表扫描 stories，版本判断使用表达式索引
- 可选横图按原幅生成，重启后只重试失败或丢失的横图
- 未变化的故事不再读取全文；局部写入、任务数变化、指定清理和重启时按原规则处理
- 重新生图先重绘竖图，再自动重绘同幅横图并继承其余可用横图
