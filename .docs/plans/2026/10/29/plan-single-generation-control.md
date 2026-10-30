# Single generation control

Risk: non-low — changes default durable paid-work intent and upgrades persisted session controls.
Story base: fc1621530a60f69d5cbfccc0875996533ad0d864. Entry worktree snapshot: /tmp/shiqu-single-generation-base. Preserve unrelated existing discovery/timeline/desktop changes and the prior accepted pause/resume UI change. Story: single-generation-control.

New client sessions use passive status observation; the durable coordinator starts work, while explicit Retry keeps its existing one-shot production request. New repository creates explicitly persist background/active in the initial INSERT (no two-write activation race). Resume atomically sets background/active, preserving snapshots and failures. Keep old reader/background/stop API actions for compatibility; the modern UI exposes only pause/resume. Add a once-only migration: existing reader rows become background; active incomplete reader rows become paused, while completed/manual paused/stopped and already-background rows keep their saved control. Do not reset documents, errors, jobs, leases or timestamps. Normal fixture create exercises the new API default. Explicit createLegacyReader test helpers create reader-mode rows to keep old demand/lease contracts covered without changing production defaults.

- [x] First SS probe: use isolated in-memory SQLite to apply the migration twice and verify controls/checkpoints/job receipts are preserved; no live library startup.
- [x] Remove preference component/switch and stale styles; keep one shared secondary action at progress locations; update mode-dependent status/README.
- [x] Set durable default at create, atomically activate background on resume, and add safe legacy migration.
- [x] Add controlled regressions for no-viewer creation/completion, leave/restart, paused/resumed whole-story continuation, failed retry behavior, migration/idempotence and no UI switches. Keep legacy demand regressions explicit.
- [ ] Run applicable unit/integration suites and typecheck/lint; run matching E2E spec in the in-app browser with isolated provider/data fixtures.

Validation: .docs/tests/test-single-generation-control.md. Node 24.22.1, pnpm 11.25.0. No network provider calls. First probe failure returns to AR. Rollback: keep legacy mode/controls and migration history; a code rollback can still read background/paused rows without data loss. Shared-library services must be upgraded together, as before.

AR passed: no blocking architecture flaws.
AR risk: non-low — persistent generation intent and saved-control migration.
AR review round: 1; reviewer: new.
Independent review confirms explicit background INSERT, atomic Resume, safe once-only migration, passive observation and explicit failure Retry. Before source/migration edits, stop or isolate the existing watched development backend so it cannot apply the migration to the personal library.

SS probe passed: isolated in-memory migration checked 7 legacy states, saved documents/error/timestamps/live lease fields and idempotence. Existing watched dev process 4462 was stopped before edits; ports 3000/3002 closed. No personal database opened. Focused 74/74 tests and typecheck passed before the additional explicit pause/resume-on-failure regression.
