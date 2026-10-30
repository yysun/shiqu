# Single generation control

Risk: non-low — changes default durable paid-work intent and upgrades persisted session controls.
Story base: fc1621530a60f69d5cbfccc0875996533ad0d864. Entry worktree snapshot: /tmp/shiqu-single-generation-base. Preserve unrelated existing discovery/timeline/desktop changes and the prior accepted pause/resume UI change. Story: single-generation-control.

New client sessions use passive status observation; the durable coordinator starts work, while explicit Retry keeps its existing one-shot production request. New repository creates explicitly persist background/active in the initial INSERT (no two-write activation race). Resume atomically sets background/active, preserving snapshots and failures. Keep old reader/background/stop API actions for compatibility; the modern UI exposes only pause/resume. Add a once-only migration: existing reader rows become background; active incomplete reader rows become paused, while completed/manual paused/stopped and already-background rows keep their saved control. Do not reset documents, errors, jobs, leases or timestamps. Normal fixture create exercises the new API default. Explicit createLegacyReader test helpers create reader-mode rows to keep old demand/lease contracts covered without changing production defaults.

- [x] First SS probe: use isolated in-memory SQLite to apply the migration twice and verify controls/checkpoints/job receipts are preserved; no live library startup.
- [x] Remove preference component/switch and stale styles; keep one shared secondary action at progress locations; update mode-dependent status/README.
- [x] Set durable default at create, atomically activate background on resume, and add safe legacy migration.
- [x] Add controlled regressions for no-viewer creation/completion, leave/restart, paused/resumed whole-story continuation, failed retry behavior, migration/idempotence and no UI switches. Keep legacy demand regressions explicit.
- [x] Run applicable unit/integration suites and typecheck/lint; run matching E2E spec in the in-app browser with isolated provider/data fixtures.

Validation: .docs/tests/test-single-generation-control.md. Node 24.22.1, pnpm 11.25.0. No network provider calls. First probe failure returns to AR. Rollback: keep legacy mode/controls and migration history; a code rollback can still read background/paused rows without data loss. Shared-library services must be upgraded together, as before.

AR passed: no blocking architecture flaws.
AR risk: non-low — persistent generation intent and saved-control migration.
AR review round: 1; reviewer: new.
Independent review confirms explicit background INSERT, atomic Resume, safe once-only migration, passive observation and explicit failure Retry. Before source/migration edits, stop or isolate the existing watched development backend so it cannot apply the migration to the personal library.

SS probe passed: isolated in-memory migration checked 7 legacy states, saved documents/error/timestamps/live lease fields and idempotence. Existing watched dev process 4462 was stopped before edits; ports 3000/3002 closed. No personal database opened. Focused 74/74 tests and typecheck passed before the additional explicit pause/resume-on-failure regression.

SS behavior milestone: 9d3b7bf (backend defaults/migration/client observation and initial regressions). UI files overlap pre-existing discovery/timeline work; preserve those unrelated hunks when saving milestones.

CR passed: no major findings.
CR risk: non-low — default durable paid-work intent and saved-control migration.
CR review round: 1; reviewer: reused.

CR passed: no major findings in changed inputs.
CR risk: non-low — persistent generation intent and saved controls.
CR review round: 2; reviewer: reused.
Independent follow-up covers the active-background waiting status, whole-story frame-count copy, and explicit legacy-mode fixture setup. Manual pause/failure/completion/frame-count precedence stays intact.

ET: in-app browser on isolated 3337/3338, real reader/API/SQLite and controlled fake providers. Shelf and reading preferences have no background switch or enable dialog. Preferences Restore immediately changes to Pause; Pause immediately changes to Restore. Frame-count confirmation remains, then progress shows whole-story intent. Leaving the reader completes the 7-frame story; a separately paused story retains 7/10 saved images after draining in-flight calls and isolated backend restart. Calls stay at 14 (7+7), with no duplicate saved frames. Screenshots: single-control-preferences.png and single-control-shelf.png under /Users/esun/.codex/visualizations/2026/10/30/01a18a43-e699-7061-96bf-751fcbae8610/. The temporary script/server/library were removed afterward. No personal-library mutation or paid provider calls during verification.

TT: the initial sandboxed attempt could not bind temporary server ports and was stopped. A permitted full run exposed legacy fixtures that unintentionally competed with the new automatic scheduler; their setup now explicitly selects reader mode, while the normal creation/default integration tests remain background by default. Legacy source backfill now models a paused migrated task. Both deletion/recovery tests verify exact checkpoint preservation and generation_control=stopped. The last full run was 370/371; corrected reader-generation checks passed 39/39. Final verification results are recorded below; typecheck, lint and diff checks pass.

The original pnpm dev service was restarted externally during the work; reuse it for final read-only inspection. Do not initiate test generation against the personal library.

SS compatibility/status milestone: e9b480a. Final source and tests are stable.

Final TT evidence: Node 24.22.1 / pnpm 11.25.0. The final full runner recorded 371 passing test instances, then one file-level failure because the pre-existing development-access worker stalled after its work; the worker was terminated to release the runner. The same file passed both tests in isolation (2/2, 261 ms), with a 55-second outer timeout. All 371 distinct test cases passed; the 2 isolated cases repeat coverage already recorded in the full log before the worker shutdown stall. Logs: /tmp/shiqu-single-control-tests-passed.log and /tmp/shiqu-single-control-development-final.log. The earlier deletion/recovery mismatch passed all 39 reader-generation tests after correcting the expectation. Typecheck, lint and git diff --check pass. No Docker build or desktop packaging.

Final ET evidence: isolated UI fixture verified direct Restore/Pause in real preferences, no mode switches/enable dialog, frame gate, whole-story completion after leaving, and persisted pause/reused results after restart. Temporary fixture was stopped/removed. The original 3000 service was already restarted externally (PID 39353, Node 22) before final read-only inspection; no duplicate server was launched. Its shelf shows the legacy reader story paused at 5/10 with only Restore. At 375px the button stays inside the viewport with a 44px target and no background switch. Screenshot single-control-final.png in the same visualization directory. No test generation was requested against the personal library.

CR passed: no major findings in changed inputs.
CR risk: non-low — persistent generation and saved controls.
CR review round: 3; reviewer: reused.
The last changed recovery assertion preserves every checkpoint while expecting deletion to disarm generation.

1. **Complete — One visible control.** Shelf and preferences source and inspected screenshots show Pause/Resume beside progress, without a background switch or enable confirmation.
2. **Complete — Automatic whole-story generation.** Atomic background creation, passive observation, both provider regressions and isolated UI completion after leaving prove the default behavior; frame-count confirmation remains.
3. **Complete — Durable pause/resume.** Integration and UI evidence cover draining in-flight results, no refill while paused, restart persistence and reuse of saved images when resuming.
4. **Complete — Safe upgrade.** Migration and idempotence tests preserve checkpoints, errors, timestamps, leases, receipts and existing background/manual intent; unfinished reader sessions become background/paused.
5. **Complete — Existing protections.** Explicit failure retry, deletion/restore disarming, ownership/origin checks, concurrency and lease tests remain covered. The final recovery assertion correctly expects only `generation_control` to change to `stopped`.
6. **Complete — Verification.** **371 distinct tests passed.** A development-access worker stalled after its two cases passed; both cases also passed in isolation with normal exit. Typecheck, lint and diff checks passed. Isolated browser evidence covers the requested behavior without paid calls or personal-library test generation.

All plan tasks are complete; no unresolved implementation findings.

**VR passed: all acceptance criteria complete**

VR risk: non-low — default persistent generation and saved-control migration.
VR review round: 1; reviewer: reused.
