# Queue interruption resilience

Requirement: `.docs/reqs/2026/10/30/req-queue-interruption-resilience.md`
E2E spec: `.docs/tests/test-queue-interruption-resilience.md`

Risk: non-low. This changes concurrency, availability and paid-work replay in the durable queue.
Story base: a147e551b648f05b1d61382fdffd758dc2920936. Preserve unrelated release and task-reasoning-effort changes in the shared checkout, and commit story paths only.

## Decisions

**Interruption is a queue classification, not a provider error.** While the queue is stopping, a failing non-drain job is recorded with `interrupted=1` and the existing interruption message, unless a new `terminal(error,job)` option says otherwise. The coordinator's rule is that a `ReaderError` with a 4xx status is terminal. `advanceStory` reports its original error through `onFailed`, so `script()` keeps that status instead of flattening it to 503. Publication jobs (`drain:true`) keep real failures, because they run to completion during shutdown.

A genuine provider error that happens to arrive during a stop is therefore replayed on the next start. This is accepted: the replay allowance bounds it, and a real failure then persists because the service is no longer stopping.

**Session state follows real failures only.** The session-save loop in `cycle()` ignores interrupted jobs. `script()` also needs two changes, because `advanceStory` writes `state='failed'` before the queue classifies the error:
- A stop-time failure clears the row back to idle, unless the error is a 4xx.
- A 4xx keeps its status, so the terminal rule keeps it failed. This is essential for a blocked review (422): `script()` always calls the engine with `retry=true`, so an automatic replay would pay for repair.

Together these also fix Resume after a pause plus a lost lease.

**Persistence errors are not job outcomes.** The success write moves out of the handler's `try`. If the success or failure write throws, the queue logs a safe code and leaves the job `running`. Its token leaves the map when the task settles, so the lease expires and the job recovers as an interruption, counted against the cap. The pre-handler section gets the same treatment. A handler that rejects with a SQLite error (`ERR_SQLITE_ERROR`) counts as a persistence error too, and `advanceStory` rethrows that error rather than recording it as a story failure.

**No latched fault.** Remove `fault` and the queue's self-`stop()`. The guard against paid dispatch with an unwritable database is the claim UPDATE, which runs before `execute`; if it throws, nothing starts and the tick fails. The next tick is the probe. A failed tick logs only on the transition into failure, using a safe code. `close()` logs tick errors and keeps draining, so a transient error cannot skip closing SQLite or releasing the desktop data lock.

**Readability is checked explicitly, not inferred from exception types.** `Document` is never schema-validated, so valid JSON with the wrong shape throws `TypeError` from unrelated code. A pure `readableStory(row)` in `lib/reader-model.ts` wraps `view(row)` in a try/catch, and `view` parses the selection and document and touches their fields. Because it is called only on already-fetched rows, database errors can never be swallowed.
- `cycle()` skips `graph` for unreadable rows, and the session-save loop releases their lease.
- `canRun` returns false after its cheap gates, so paused and failed stories pay nothing extra. It parses the document only after this check, and the check comes before the text-pool return, so a `{}` document cannot get a paid plan call.
- `GET /sessions` filters them out. The row stays in SQLite.
- The coordinator logs each story ID once per runtime.

**Tokens fence, not wall-clock time.** Recovery clears `lease_token`, and a replacement attempt writes a new one, so the token alone identifies the current attempt.
- Remove `lease_until>?` and `lock_until>?` from renewal, `isCurrent`, job success, session renewal, the publication write and `ownSession`'s own-lease check.
- `recoverExpired` skips jobs whose token this process holds. This covers API-driven recovery, such as a retry, that runs before the first tick after wake.

This stays safe with two services on one library, because a service that loses its claim no longer matches the token. The desktop data lock rules out a second service for desktop; a shared-volume deployment may replay, as the requirement states.

**Replay cap reuses `attempts`.** `resumeInterrupted` refuses when `attempts>=3`, so the job stays `failed` with `interrupted=1`, and the snapshot shows a retryable error. Claims are already counted before the handler runs, so crash loops count. `queue.retry` resets `attempts=0` on the story's failed and queued rows, and the pre-handler release decrements. The visible attempt count restarts after a manual retry, which reads correctly as a new run because the UI shows it only above 1. Rows from older versions counted released claims, so an inflated count can show a retryable error instead of resuming; this fails safe. No schema change is needed.

## Tasks

- [x] `server/production-queue.ts`: add the `terminal` option and classify stop-time failures. Separate the success write and make outcome-write errors log and leave the job running. Remove `lease_until` from `renew`, `isCurrent` and the success write. Skip own tokens in `recoverExpired`. Remove the self-stop. Make `retry` reset attempts on failed and queued rows and the pre-handler release decrement them. Update the file header.
- [x] `lib/reader-model.ts`: add `readableStory`. `lib/reader-api.ts`: filter unreadable rows from `GET /sessions`.
- [x] `server/reader-production.ts`: remove `fault`. Add the safe tick log, and log and continue in `close()`. Skip unreadable stories in `cycle` and `canRun`. Add the replay cap. Provide `terminal`. Clear the stop-time row failure and use 422 for blocked reviews in `script`. Make session renewal, `ownSession` and the publication write token-only. Have the session-save loop use real failures only. Update the file header.
- [x] `lib/reader-engine.ts`, `lib/reader-repository.ts`: rethrow SQLite errors and report the original error through `onFailed`.
- [x] `tests/shelf-generation.test.mjs:90`: expect `attempts` to be 1 after an explicit retry.
- [x] `tests/queue-interruption.test.mjs`: controlled regressions for every acceptance criterion:
  - Stop during image, script and preparation work, while active, paused and stopped; stop with saved pages; blocked review and deterministic 4xx during stop.
  - Transient tick error, thrown claim write, tick error during `close()`.
  - Bad selection, `document='{}'`, `document='null'` and truncated JSON with a queued job, each with other stories completing and the shelf loading.
  - Failed success write, failure write, engine checkpoint save and publication write.
  - Clock jump, late stale result across two queues, dead-runtime recovery, the cap, retry reset across a story, pre-handler release.
- [x] `tests/codex-provider.test.mjs`: prove that killing a running fake Codex process with `stopCodexProcesses` rejects the in-flight call, and that the real `startDesktop` stop records an interruption, so the stop path above is the path real quits take.
- [x] `README.md`: state that stopping the service resumes interrupted work and that automatic recovery is bounded.
- [x] Execute `.docs/tests/test-queue-interruption-resilience.md`.

## Validation

Node 24.22.1 and pnpm per `.nvmrc`. Focused: `pnpm exec node --experimental-strip-types --test tests/queue-interruption.test.mjs`. Full suite, typecheck and lint belong to TT. No UI changes, so no browser pass is needed. No paid providers, Docker builds or desktop packaging.

## Risks

- **Replay cost:** a stop can replay an uncertain paid call, which the README already discloses. At most three attempts per job between manual retries.
- **Lost outcome write:** a finished paid result is lost if its write fails, and recovery pays again. This needs a database failure at that moment and is bounded by the cap.
- **Gemini quit:** in-flight fetches aren't aborted on stop, so a quit that kills Node before they drain recovers through lease expiry, up to 180 seconds later, rather than stop classification. Same outcome, later.
- **Stop-time clear failing:** if the database also fails while `script()` clears the row, the provider message, which can be the subscription or login text, stays visible until a manual retry.
- **Hung handler:** a handler that never settles keeps its slot while the process lives. This is unchanged from today, and provider timeouts bound it.
- **Rollback:** revert the commits. No persisted format changes, and older versions read the same rows.

## Review log

AR passed: no blocking architecture flaws.
AR risk: non-low — durable paid-work replay, concurrency and availability.
AR review round: 2; reviewer: reused.

SS milestone: 1dfe462 (queue, coordinator, API, regressions, README). Verified with focused suites on Node 24.22.1.

CR passed: no major findings.
CR risk: non-low — durable paid-work replay, concurrency and availability.
CR review round: 2; reviewer: reused.
Follow-ups applied after round 1: drain and pre-tick regressions, real desktop stop test, parked-lease release, safe error-name logging. After round 2: session-save loop reads jobs before the row.

TT: `pnpm test` on Node 24.22.1 ran 414 tests: 413 passed, 1 failed. The failure is `tests/fast-first-story.test.mjs` (`small reading plans cap chapters…`), a discovery-namespace hash assertion that also fails on a147e55 and 276b772, so it predates this story and is out of scope. Typecheck and lint pass. Later runs are recorded under VR round 1 below.

ET: flows 1-8 in `.docs/tests/test-queue-interruption-resilience.md` passed through `tests/queue-interruption.test.mjs`, `tests/production-queue.test.mjs` and `tests/codex-provider.test.mjs`, using controlled providers and a fake Codex process. No in-app browser pass: no UI changed. Laptop sleep is simulated by forcing leases past expiry; no real sleep, packaged desktop app or paid provider was used.

VR round 1: incomplete. A failed engine checkpoint save reported a provider failure, and a deterministic 4xx in script work replayed after a stop. Both are fixed through `onFailed` and the engine's persistence rethrow, with regressions added for those cases plus preparation, saved pages, and script work while paused or stopped.

CR passed: no major findings.
CR risk: non-low — durable paid-work replay, concurrency and availability.
CR review round: 3; reviewer: reused.

TT and ET after eac5712, on Node 24.22.1: `pnpm test` ran 420 tests, 419 passed; the one failure is the same `tests/fast-first-story.test.mjs` assertion. Typecheck and lint pass. Flows 1-8 pass.

VR passed: all acceptance criteria complete.
VR risk: non-low — durable paid-work replay, concurrency and availability.
VR review round: 2; reviewer: reused.
