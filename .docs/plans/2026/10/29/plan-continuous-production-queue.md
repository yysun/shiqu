# Continuous production queue

Story review base: `3a07851` (frame-count prerequisite merged after initial implementation). Original isolation base: `226ed02`. Primary checkout icon work remains untouched. Implementation milestone before integration: `b55ec83` (focused75/75, typecheck passed; full verification pending).

## Design

Add SQLite production job records (kind, pool, version, dependencies, payload/result, status, attempts and fenced lease) and viewer demand records. A generic in-process scheduler claims dependency-ready jobs under global per-pool limits. Default limits: text 1, images 3 (SHIQU_IMAGE_WORKERS, integer 1–8), local processing 2. Unknown handlers do not run. Expired running jobs become explicit failures, never automatic paid replays.

A reader production coordinator uses existing engine checkpoints for script/source preparation, then creates per-page image and publication jobs. Other scenes depend on published page zero. Image adapters validate/store native outputs at immutable per-attempt artifact keys for queued jobs (legacy calls retain old filenames). Image results are durable receipts; local publication independently verifies saved media and atomically updates session document/usage under both the session token and publication-job token. This prevents an expired provider call from overwriting replacement media bytes even when its database completion is fenced. The owner-scoped media route accepts only validated artifact filenames; anchor loading remains within the same story prefix. The coordinator holds and renews a fenced session lease while drawing, preserving legacy advance exclusivity. Queue and session leases renew while work is running, not only when an image completes.

Each browser viewer owns a demand lease (30 seconds, renewed at most every 10 seconds), scoped to this scheduler incarnation so persisted leases never restart paid dispatch after a process restart. Server calculates target current page + 6, capped by script length. POST production records demand and returns immediately; GET session exposes checkpoint progress. DELETE production releases only that viewer. Legacy /advance for queue-managed sessions routes through the coordinator, which recovers successful image receipts before any provider retry; unmanaged legacy sessions retain the old engine path. Reader polling is one second and remains alive while its read-ahead buffer is full. Page changes update demand without restarting a paid operation. Queued generation pauses without demand; successful paid jobs can still publish locally. Deletion hides data immediately but retains in-flight assets/results. Shutdown stops dispatch before terminating Codex children, drains in-flight work/publication, then closes SQLite.

Use stable versioned job keys and idempotent publication. Retry only failed jobs; successful receipts survive. A stopped/crashed process cannot start new work on restart until a new viewer supplies demand. Fenced job/session leases protect against stale completions. Generic test handlers for voice/video demonstrate dependencies without adding production integrations. No automatic regeneration on content edits; immutable input versions define future invalidation boundaries.

## Tasks

- [x] First SS probe: install frozen dependencies using pinned runtime and prove SQLite migration/JSON support and existing reader generation tests run. Failures stop dependent implementation and return to AR.
- [x] Add migration/schema and generic durable scheduler with bounded pools, dependencies, fencing, heartbeat, retry and drain behavior.
- [x] Add reader coordinator: demand leases, script checkpoint reuse, first-image dependency, rolling jobs, artifact publication, owner/deletion protection and session lease renewal.
- [x] Wire immediate production routes and app/server/desktop shutdown; retain legacy advance behavior.
- [x] Switch reader hook to independent viewer leases, page-relative demand and one-second progress polling; keep bounded recovery and saved-story behavior.
- [x] Add controlled-provider REST/SQLite integration tests and generic future voice/video extension coverage; update README/env examples.
- [x] Run full unit/integration tests, lint/typecheck/build and focused E2E scenarios; record actual evidence limits.

## Verification and risks

E2E spec: `.docs/tests/test-continuous-production-queue.md`. Test uneven completions, global caps, first-image dependency, individual visibility, multi-viewer leave/expiry, deletion, publication failure/retry, checkpoint races, restart, leases, shutdown and future DAG handlers. Reuse real SQLite and provider adapters with controlled results; no live inference. Browser prefers the in-app tab; its automation was disabled in Work settings, so the user-authorized fallback used isolated headless Chromium against a local controlled-provider harness. This is not verification of the user's existing browser session. Additive migration preserves old data; rollback requires stopping new queue workers before older binaries, whose legacy session API continues to read stored documents. Multiple independent application processes against one directory are not a supported deployment; database claims still fence duplicate jobs.

## AR round 1

AR blocked: legacy retry could bypass an image receipt, and pre-restart viewer leases could remain active. Fixed the plan by coordinating legacy advances for managed sessions and scoping demand to a scheduler incarnation. Regression scenarios cover both.
AR risk: non-low — paid concurrency, persistence, recovery and shutdown.
AR review round: 1; reviewer: new.

AR passed: no blocking architecture flaws.
AR risk: non-low — paid concurrency, durable dependencies, recovery and shutdown.
AR review round: 2; reviewer: reused.

## AR round 3 input

Implementation inspection identified that fixed per-page provider filenames allow a stale paid completion to replace media bytes even if its job result is fenced. The plan now uses immutable per-attempt image keys, a validated owner-scoped artifact URL, and dual job/session fencing on publication. Existing legacy filenames remain readable. Current focused tests: 19/19 pass before this change; legacy compatibility: 60/60 pass. Re-review requested before dependent artifact changes.

AR passed: no blocking architecture flaws.
AR risk: non-low — paid-output durability, media routing and concurrent recovery.
AR review round: 3; reviewer: reused.

Rollback limitation: older binaries can read session documents but cannot serve new artifact URLs. Stories generated by the queue require this server version (or a deliberate media conversion) after downgrade; additive SQLite compatibility does not guarantee image-route compatibility.

SS probe passed: Node24.22.1 / pnpm11.25.0; frozen install and all35 existing generation tests passed (real SQLite migrations/JSON). Focused implementation evidence before integration:75/75 queue/client/legacy generation tests pass, including both providers and stale-media attempt fencing.

## Frame-count integration / AR round4

The independent frame-count change is now committed as3a07851 and merged as a prerequisite. A new story with narrativeDetail must complete only source/recommendation before the existing count confirmation gate. Its distinct prepare job (source/recommendation, never a completed script dependency) succeeds with an awaiting-confirmation output; the browser releases demand and shows the existing control. Confirmation transitions from prepare to script identity, even if numeric selection.length is unchanged, and creates the subsequent script job; no plan/image is dispatched before confirmation. Queue/client tests must cover both provider adapters, saved recommendation/reopen, confirmation, and no repeated recommendation. Legacy advance remains unmanaged until first production demand. This preserves a newly committed contract, not a new product feature. Review comparisons exclude the prerequisite via git diff3a07851.

AR passed: no blocking architecture flaws.
AR risk: non-low — confirmation persistence, job identity and paid-stage dependency gating.
AR review round:4; reviewer:reused.

Frame-count integration implemented with distinct prepare/script identities; both-provider confirmation/reopen and numeric-identical-confirmation tests pass. Final focused queue suite:26/26 pass before CR (full-suite TT and browser ET pending).

## CR round1

CR blocked: deleted pending publication with an expired session lease could fault the scheduler; shrinking read-ahead demand could falsely report running; lost retry responses could spend budget against stale failure. Fixed via raw owner-scoped expired-session recovery, demand-eligible status, and GET recovery after transport failure. Added regressions; focused29/29 pass. Also distinguish publication retry in reader text and update count help for continuous lookahead.
CR risk: non-low — durable paid work, scheduler availability, recovery and lifecycle.
CR review round:1; reviewer:reused.


## Final verification evidence

CR fixed: deleted-session recovery no longer poisons the scheduler; backtracking reports an idle full buffer; lost retry responses re-read current state before spending further retry budget. Rerun result passed.
CR risk: non-low — durable paid work, recovery, scheduler availability and lifecycle.
CR review round: 2; reviewer: reused.

TT passed: `pnpm test` 216/216, Node 24.22.1 / pnpm 11.25.0; no skipped/cancelled tests. `pnpm run typecheck`, `pnpm run lint`, `pnpm run build` and `git diff --check 3a07851` passed after the final source changes. No applicable Rust source or packaging change; Node desktop lifecycle coverage is included in the full suite.

ET passed: all seven E2E specification flows are evidenced by the controlled REST/SQLite integration tests and generic extension tests. Isolated headless Chromium additionally exercised first-image gating, out-of-order visibility/refill, page-one demand enabling page eight before the old boundary, leaving/reopening without repeating outputs, count confirmation, and publication retry with one paid image result reused. No page runtime errors, no live inference. In-app browser automation was attempted but unavailable (`Local browser use is disabled in Work settings`); the separate test session was disclosed before use, following AGENTS.md fallback guidance. Five screenshots were saved and reading/publication-retry screens visually inspected.

Local evidence: `.data/evidence/continuous-production-queue/tests.log`, `browser-check.mjs`, `browser.log`, `browser-result.json`, and screenshots `01-reference-pending.png` through `05-publication-retry.png`. Browser fixtures reused an existing bundled illustration; they do not establish generated visual quality or live throughput. No Docker build, paid call, push, or modification to primary-checkout icon work.

VR passed: all acceptance criteria complete.
VR risk: non-low — durable paid work, dependency scheduling, recovery and lifecycle.
VR review round: 1; reviewer: reused.

Delivery milestones: b55ec83 (queue implementation), f06453a (frame-count prerequisite integration), a12d0cc (review recovery fixes). Final delivery commits only verified story documentation. No source changes after the passing second CR or final verification.
