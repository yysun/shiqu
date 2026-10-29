# Continuous production queue

Fixed three-page demand starts too late, wastes free slots behind slow calls, and holds normal client updates until a batch settles. Reading should drive a continuously refilled pipeline, with durable outputs reusable by later voice/video stages.

## Acceptance criteria

- [x] A server-owned durable queue prepares the script/source once, establishes the first-image reference alone, then continuously refills available image slots without waiting for sibling images. Generated media is published separately; the reader receives individual progress within its one-second poll interval.
- [x] Reading maintains up to six pages ahead of the current page (plus the current page), capped by actual script length. Default global image concurrency is three across stories/viewers, configurable within a bounded range. Text and local processing have separate limits.
- [x] Independent viewer leases keep active demand alive; leaving, deletion, lease expiry, and shutdown stop new paid dispatches. Already-started results and dependent local publication are retained. One viewer leaving cannot cancel another viewer.
- [x] Jobs have stable identities, explicit dependencies, input versions and stored results. Duplicate requests cannot duplicate paid work. Retry resumes failed/missing stages without regenerating successful images when local publication fails. Restart preserves jobs/assets; ambiguous interrupted paid jobs require retry rather than silently replaying.
- [x] Session locks remain exclusive against legacy advance calls and are renewed during queue execution. Failures stop further paid dispatch for that story, retain settled results, and expose bounded recovery. Owner scope, deletion, original/source, style and production prompts remain intact.
- [x] A generic handler/pool contract supports independent future voice and motion jobs and video assembly dependencies. Deterministic extension tests demonstrate branching/dependencies and output reuse; production voice/video remains disabled.
- [x] Existing stories, the source/recommendation/count-confirmation gate, and legacy advance API continue to work. Document behavior, limits, recovery, migration and future extension boundaries; full applicable tests, lint/typecheck/build and focused REST/browser checks pass without paid provider calls or Docker builds.

## Constraints and non-goals

Use pnpm and Node 24.22.1; SQLite and the current single-server architecture. Preserve unrelated ongoing frame-count/icon work in the primary checkout. No new queue service, paid provider integration, voice/video implementation, speculative image transformations, automatic script editing, or background full-story generation after leaving. Current image validation/storage is reused; local publication validates the saved artifact. Read-ahead reduces stalls but does not guarantee production keeps up with reading.

Verified 2026-10-29: independent VR passed all seven criteria; final full suite216/216, current lint/typecheck/build/diff checks and controlled REST/headless browser E2E passed. See the plan and completion report for evidence and verification limits.
