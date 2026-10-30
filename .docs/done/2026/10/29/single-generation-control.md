# Single generation control

## Summary

Stories now start whole-story production automatically. Shelf and reading preferences expose only the secondary Pause / Resume action beside progress; no background switch or enable confirmation remains. Pause survives restart; Resume reuses saved work. Frame-count confirmation remains.

The once-only upgrade converts unfinished reader-mode sessions to background/paused, preserving checkpoints and preventing upgrade-triggered generation. Existing background intent and manual stops/pauses remain intact; legacy API actions remain compatible.

## Verification

Node 24.22.1, pnpm 11.25.0. 371 distinct tests passed. The development-access worker stalled after both cases passed in the full run; both repeated successfully in isolation with normal exit. Typecheck, lint and diff checks passed. Independent CR round 3 passed. The scoped staged delivery snapshot also passed typecheck and the storyboard UI regression separately from unrelated working-tree changes.

In-app browser on isolated 3337/3338 verified absent switches/dialogs, direct Pause/Resume in preferences, frame-count gating, whole-story completion after leaving, and pause persistence with saved results after restart. Final read-only 375px check on the already-running 3000 service confirmed a migrated story remains paused at 5/10 with Restore beside progress. Screenshots: [final shelf](/Users/esun/.codex/visualizations/2026/10/30/01a18a43-e699-7061-96bf-751fcbae8610/single-control-final.png), [preferences](/Users/esun/.codex/visualizations/2026/10/30/01a18a43-e699-7061-96bf-751fcbae8610/single-control-preferences.png).

## Notes

Backend/compatibility milestones: 9d3b7bf and e9b480a. UI delivery stages only generation-control changes; pre-existing discovery/timeline/desktop edits remain separate. No paid test requests, personal-library test generation, Docker build or desktop packaging. Native packaging and physical-phone behavior were not verified or required. Temporary fixture server and source were removed.

## Verification review

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
