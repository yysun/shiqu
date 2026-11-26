# Background story generation

> 已被取代：见[制作规范精简 1-3](../../11/24/req-production-spec-simplification.md)。涉及原约定「读者选择前台或后台模式」。确认后的故事依读者控制在后台推进，候选查找仍需有人查看。 [后台制作与授权](../../../../story-production-dag.md#保存暂停与继续)

Service restarts should continue work the reader explicitly asked to finish in the background. A restart must never undo a manual pause or stop.

- [x] Readers can opt an unfinished story into “后台生成整篇” from the shelf and reader; the saved mode survives reloads and service restarts.
- [x] Active background stories generate every missing page without an open viewer, reusing saved scripts/images and respecting global worker limits and frame-count confirmation.
- [x] Manual pause and stop persist, block new paid dispatch from every window and legacy advance, and survive restart. Explicit resume retains the selected mode; in-flight results still save.
- [x] Startup resumes queued background work and expired interrupted attempts after leases expire. Saved results are reused; real provider failures remain failed until explicit retry. Foreground-only stories retain reader-demand behavior.
- [x] Owner/origin/input checks and deletion isolation remain enforced. Deleting a story disarms background generation so restoration does not restart it.
- [x] UI exposes mode, pause/stop/resume and truthful status; README replaces the blanket restart restriction with the mode-specific policy and interrupted-call charge implications.
- [x] SQLite migration, controlled-provider restart/concurrency/failure tests, client behavior tests, typecheck/lint and in-app browser flows pass without paid requests, Docker builds or desktop packaging.

Non-goals: provider-side job lookup, infinite retries, scheduling, new concurrency settings, changing completed assets, or automatically opting existing stories into paid background work.
