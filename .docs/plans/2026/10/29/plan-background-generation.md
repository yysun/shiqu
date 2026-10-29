# Background story generation

Risk: non-low — persistent paid-work intent, restart recovery, concurrency and reader controls.
Story base: e404837 (current parent of preserved implementation milestone 453f923). Original base e05c7a8091c28feafe4579cf822d2360a0fbcb28 and milestone 025da5c were rewritten by concurrent repository history work; scoped implementation contents were preserved and re-reviewed. Preserve unrelated dongguo/empty-library documentation and CHANGELOG changes.

Design: add generation_mode (reader/background) and generation_control (active/paused/stopped) to reader_sessions with reader/active defaults. Expose them in every session snapshot. A validated owner-scoped production-control action changes these fields. Viewer requests and legacy advance never override manual control. Background demands are synthesized from saved active, visible, incomplete sessions through page 59, without viewer TTL. Keep frame-count confirmation. An additive SQLite deletion trigger atomically disarms background work and clears viewer demands for reader and desktop deletion paths; restoration stays stopped. Local publication drains after pauses/deletion.

Expired interrupted queue claims may requeue only for active background sessions; guard updates by original lease token/expiry and recheck saved control before dispatch. Persist a job interrupted marker so paused claims can recover on explicit background resume without retrying real provider failures. Ordinary failed jobs never auto-retry. Recover expired session locks for active background stories without stealing live leases, including legacy preparation. Successful results remain authoritative. Shutdown changes process dispatch state, not saved user intent. Shared SQLite runtimes must fence both jobs and session ownership.

- [x] First SS probe: controlled SQLite fixture proves migration and persisted active background demand can be loaded without browser state; no real-provider invocation. Fail and return to AR if startup cannot be fenced with existing leases.
- [x] Add additive migration/schema/view fields and owner/origin-validated production-control API. Block paused/stopped legacy and reader requests; disarm on deletion.
- [x] Extend coordinator demand/recovery/dispatch to active background stories and whole-story limits, preserving gates, live leases, local drain, real failures and saved assets.
- [x] Add shared controls on shelf, generation status and reader settings; pause stops browser demand/automatic retries, resume keeps saved mode; background uses passive polling. Update statuses and README.
- [x] Add/run controlled tests for both providers, no-viewer completion, restart/expired attempts, manual override across viewers/restart/legacy, deletion/restore, failure, owner validation and client polling.
- [x] Run applicable non-packaging unit/integration suites, typecheck/lint and targeted in-app browser flows in an isolated fixture. Use pnpm desktop:preview for launcher smoke only; reader UI runs in the existing in-app browser against a controlled isolated backend. No personal library writes or paid requests.

E2E spec: .docs/tests/test-background-generation.md. Node 24.22.1 and pnpm 11.25.0. No dependency changes planned. Additive defaults preserve foreground behavior; background interruption recovery is explicitly authorized by opting into the mode and may charge again when a remote response was lost.

AR passed: no blocking architecture flaws.
AR risk: non-low — durable paid intent, restart recovery and shared-runtime fencing.
AR review round: 1; reviewer: new.
Independent review covered legacy unmanaged advance, desktop deletion, stable graph IDs and paused interruption recovery. Implement with a DB deletion trigger, repository acquisition guard and distinct interrupted marker.

SS probe and focused checks: Node 24.22.1 / pnpm 11.25.0; 62/62 tests pass across background generation, queue, reader production, client and shelf contracts. Both controlled providers complete persisted background stories without viewer requests. Additive schema migration succeeds; locks and interrupted markers support restart with live-lease fencing. Typecheck, lint and diff checks pass. SS additionally reconciles a fully published story whose final state save was interrupted. No paid requests.

SS milestone: 453f923 (originally025da5c), focused 62/62 and typecheck/lint passed before milestone.

CR round1 blocked on two concrete issues: stale mode changes could overwrite manual pause, and control changes could implicitly retry real provider failures. Fixes update only the intended persisted field and keep failed sessions in the passive observation policy. Forced interleaving and client-policy regressions protect both. The browser also exposed a label flex-direction collision, corrected locally.

CR fixed: concurrent mode changes preserve manual pause/stop, and mode/control changes keep failed stories passive until explicit Retry; rerun result passed.
CR risk: non-low — durable paid intent, concurrency, and restart recovery.
CR review round: 2; reviewer: reused.

TT: Node 24.22.1 / pnpm 11.25.0. All 38 non-development-access test files passed 304/304, with zero skips/cancellations; development-access passed 2/2 in an isolated TAP run. An earlier concurrent development-proxy run stalled and was terminated; the isolated rerun passed without story edits. Added upgrade/idempotence regression passed 1/1 afterward:307 distinct tests total. Application packaging/build commands were not run; existing desktop lifecycle integration tests compile temporary test helpers. No Docker build or paid provider request.

ET: in-app browser3327/3328 on a temporary SQLite/media fixture. Enabled background from readable and pre-image shelf cards; paused while calls were held, drained four results, restarted service and reloaded: background/paused persisted and opening reader made no new calls. Reader settings stop and reader/background toggles preserved stopped. Explicit Resume completed the first 10-page story. A second story remained active in background after returning to shelf; fixture restart completed all 10 pages with no viewer demand. Progress sheet showed background intent, 0/10saved images, saved script/source and real stage timer. Desktop Vite preview1420 read the same isolated two-story fixture successfully. Screenshots: background-stopped.jpg and background-running.jpg under /Users/esun/.codex/visualizations/2026/10/29/01a1894a-05b4-7580-826c-8cce6927efaa/.
