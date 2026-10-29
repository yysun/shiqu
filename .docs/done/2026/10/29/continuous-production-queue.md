# Continuous production queue

## Summary

Reading now drives a durable server queue instead of waiting for fixed three-page groups. Source/count preparation and the complete storyboard precede a single reference image, then three configurable image workers continuously refill a six-page lookahead window. Each successful image has an immutable attempt artifact and a separate local publication job, so local retries reuse paid outputs. Viewers hold independent leases; leaving pauses new generation while settled results still save.

Jobs carry versions, dependencies, saved outputs and fenced leases. Separate pools support future voice/motion/video handlers; production voice and video remain disabled. The existing frame-count confirmation gate and legacy story behavior are preserved. Configuration: `SHIQU_IMAGE_WORKERS=1..8`, default3, text1 and local publication2.

## Verification

Node24.22.1, pnpm11.25.0. `pnpm test`:216/216 passed, zero skipped/cancelled. `pnpm run typecheck`, `pnpm run lint`, `pnpm run build` and `git diff --check 3a07851` passed. Twenty-nine focused queue/client tests cover both real provider adapters with controlled inference, real SQLite and files. Seven E2E scenarios are evidenced in the test spec/plan.

In-app browser automation was disabled in Work settings. The disclosed isolated headless Chromium fallback verified the built React reader, count confirmation and publication retry; zero runtime errors, five screenshots. It reused bundled test illustrations. No live inference, throughput benchmark, generated-quality assessment or Docker build occurred. Local evidence is under `.data/evidence/continuous-production-queue/`.

## Notes

Code is in the attached isolated worktree; primary-checkout icon work was preserved. Review base3a07851 includes the independently completed frame-count feature. Source milestones: b55ec83, f06453a, a12d0cc. No push or packaging was performed.

The additive SQLite migration runs at startup. Older servers cannot serve the new immutable artifact URLs, so a downgrade requires this media-serving implementation or a deliberate conversion. This remains a single-server local application. Queuing improves scheduling; actual provider capacity can still cause reading stalls. An interrupted remote request without a saved receipt can be charged again on retry.

## Final acceptance review

VR passed: all acceptance criteria complete.

| Criterion | Status | Evidence |
|---|---|---|
| Durable continuous production and individual progress | Complete | Coordinator creates script, image and publication dependencies; both-provider REST tests prove anchor isolation, uneven completion visibility and immediate refill. Browser verifies the built reader; client polls every second. |
| Six-page lookahead and separate bounded pools | Complete | Server calculates current page + 6, capped by script length. Config validation and cross-story tests prove configurable image limits; generic scheduler enforces separate text/image/local pools. Backtracking regression confirms idle full-buffer status. |
| Independent demand, cancellation and draining | Complete | Viewer-specific runtime-scoped leases, leave/expiry/deletion tests, restart-before-TTL regression and shutdown drain test preserve in-flight results while stopping new paid work. |
| Stable identities, stored results and resumable recovery | Complete | Versioned IDs, dependency records, immutable attempt artifacts and fenced results are persisted in SQLite. Publication/legacy retry tests reuse paid receipts; expired-work tests require retry. Lost-response regression re-reads saved state. |
| Session exclusivity, bounded failures and preserved contracts | Complete | Image and slow-script heartbeat tests exclude legacy duplicate calls. Failure/sibling retention, dual publication fencing, owner/media validation and deleted pending-publication recovery pass. Existing source/style/prompt suites remain green. |
| Future voice/video compatibility without enabling generation | Complete | Generic handler/pool extension test proves script branching, independent voice/images, processing/motion dependencies, video assembly gating and artifact reuse after assembly retry. Production voice/video remains disabled. |
| Compatibility, documentation and required verification | Complete | Both-provider confirmation/reopen and unchanged numeric-count tests preserve the preparation gate; legacy suites pass. Migration, settings, recovery and downgrade limitations are documented. Final full suite: 216/216, zero skipped/cancelled; current typecheck, lint, build and diff checks passed. All seven E2E flows are covered. |

Browser evidence used a disclosed isolated headless Chromium session because in-app automation was disabled. The saved harness/result and screenshots support the claimed reader, confirmation and publication-retry flows; runtime errors were zero. I independently inspected the reading and retry screenshots. Controlled providers were used throughout: no live generation, throughput benchmark or generated-image quality claim.

All AP tasks are complete. CR round 2 remains valid; source is unchanged since that review.

VR risk: non-low — durable paid work, dependency scheduling, recovery and lifecycle.
VR review round: 1; reviewer: reused.

Read-only verification; no tests rerun or files changed.
