# Background story generation

## Summary

Stories can now opt into “后台生成整篇” from the reader shelf, generation progress or reader preferences. Durable background intent resumes missing work when the service starts. Manual pause and stop survive restart and override every window and legacy generation entry point; changing mode cannot clear a pause. Deletion disarms background generation, including desktop deletion.

## Verification

Node 24.22.1 / pnpm 11.25.0. 307 distinct unit/integration tests pass: 304 in the main test selection, two development-proxy tests in an isolated rerun, and one added upgrade/idempotence regression. Final typecheck, lint and diff checks pass. Independent AR and CR round2 passed. In-app controlled-provider UI checks covered shelf activation, manual pause/restart/reload, reader settings stop/mode toggles/resume, live progress and unattended completion after restart. pnpm desktop:preview smoke passed against the same temporary library. Verification tabs and servers were closed.

## Notes

Successful scripts/images are reused. Queued work and interrupted background attempts resume after existing leases expire; an accepted remote request with a lost result may incur another charge. Actual provider failures require explicit Retry. Existing stories default to reader mode. All services sharing a library must support the new schema/recovery policy. No paid requests, Docker builds, desktop packaging or personal library changes were performed. Existing desktop integration tests compile temporary helper fixtures; the installed desktop application was not repackaged. Concurrent unrelated library/history/docs work was preserved.

Implementation milestones: 453f923 and 9c3eb1c. The original feature milestone025da5c was preserved as453f923 by concurrent history work; current scoped story base is e404837. Final delivery records only story-owned documentation.

## Final verification review

1. **Complete — Persistent background mode.** Shelf and reader controls save the selected mode; restart and browser fixtures confirm persistence.
2. **Complete — Whole-story generation without viewers.** Both controlled providers finish every missing page, reuse saved assets, respect the shared worker cap, and retain frame-count confirmation.
3. **Complete — Manual pause/stop override.** Persisted controls block reader and legacy dispatch across restart. Explicit resume preserves mode; in-flight results save. Concurrent mode changes cannot overwrite a pause.
4. **Complete — Restart recovery.** Queued and expired interrupted background work resumes with lease fencing. Successful outputs are reused; real failures await explicit Retry. Reader-only stories retain demand-driven behavior.
5. **Complete — Isolation and deletion.** Owner/origin/input checks pass. Shared deletion trigger disarms reader and desktop background work; restoration cannot restart it.
6. **Complete — UI and documentation.** Controls and status match saved intent. Inspected screenshots show running background progress and manually stopped state accurately. README documents mode-specific restart behavior and possible charges for interrupted requests.
7. **Complete — Verification.** Reported 307 distinct tests pass, including upgrade/idempotence preservation. Final typecheck, lint, and diff checks pass. Isolated in-app flows and desktop Vite preview pass without paid requests, Docker builds, desktop packaging, or personal-library mutation.

All plan tasks are complete. Reviewed implementation `453f923` and fixes/evidence `9c3eb1c`, based on `e404837`. CR round 2 passed; no unresolved findings.

**VR passed: all acceptance criteria complete**

VR risk: non-low — persistent paid intent, restart recovery, and concurrency.
VR review round: 1; reviewer: reused.
