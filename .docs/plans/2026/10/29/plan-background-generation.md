# Background story generation

Risk: non-low — persistent paid-work intent, restart recovery, concurrency and reader controls.
Story base: e05c7a8091c28feafe4579cf822d2360a0fbcb28. Preserve unrelated dongguo/empty-library documentation and CHANGELOG changes.

Design: add generation_mode (reader/background) and generation_control (active/paused/stopped) to reader_sessions with reader/active defaults. Expose them in every session snapshot. A validated owner-scoped production-control action changes these fields. Viewer requests and legacy advance never override manual control. Background demands are synthesized from saved active, visible, incomplete sessions through page 59, without viewer TTL. Keep frame-count confirmation. An additive SQLite deletion trigger atomically disarms background work and clears viewer demands for reader and desktop deletion paths; restoration stays stopped. Local publication drains after pauses/deletion.

Expired interrupted queue claims may requeue only for active background sessions; guard updates by original lease token/expiry and recheck saved control before dispatch. Persist a job interrupted marker so paused claims can recover on explicit background resume without retrying real provider failures. Ordinary failed jobs never auto-retry. Recover expired session locks for active background stories without stealing live leases, including legacy preparation. Successful results remain authoritative. Shutdown changes process dispatch state, not saved user intent. Shared SQLite runtimes must fence both jobs and session ownership.

- [x] First SS probe: controlled SQLite fixture proves migration and persisted active background demand can be loaded without browser state; no real-provider invocation. Fail and return to AR if startup cannot be fenced with existing leases.
- [x] Add additive migration/schema/view fields and owner/origin-validated production-control API. Block paused/stopped legacy and reader requests; disarm on deletion.
- [x] Extend coordinator demand/recovery/dispatch to active background stories and whole-story limits, preserving gates, live leases, local drain, real failures and saved assets.
- [x] Add shared controls on shelf, generation status and reader settings; pause stops browser demand/automatic retries, resume keeps saved mode; background uses passive polling. Update statuses and README.
- [x] Add/run controlled tests for both providers, no-viewer completion, restart/expired attempts, manual override across viewers/restart/legacy, deletion/restore, failure, owner validation and client polling.
- [ ] Run applicable non-packaging unit/integration suites, typecheck/lint and targeted in-app browser flows in an isolated fixture. Use pnpm desktop:preview for launcher smoke only; reader UI runs in the existing in-app browser against a controlled isolated backend. No personal library writes or paid requests.

E2E spec: .docs/tests/test-background-generation.md. Node 24.22.1 and pnpm 11.25.0. No dependency changes planned. Additive defaults preserve foreground behavior; background interruption recovery is explicitly authorized by opting into the mode and may charge again when a remote response was lost.

AR passed: no blocking architecture flaws.
AR risk: non-low — durable paid intent, restart recovery and shared-runtime fencing.
AR review round: 1; reviewer: new.
Independent review covered legacy unmanaged advance, desktop deletion, stable graph IDs and paused interruption recovery. Implement with a DB deletion trigger, repository acquisition guard and distinct interrupted marker.

SS probe and focused checks: Node 24.22.1 / pnpm 11.25.0; 62/62 tests pass across background generation, queue, reader production, client and shelf contracts. Both controlled providers complete persisted background stories without viewer requests. Additive schema migration succeeds; locks and interrupted markers support restart with live-lease fencing. Typecheck, lint and diff checks pass. SS additionally reconciles a fully published story whose final state save was interrupted. No paid requests.
