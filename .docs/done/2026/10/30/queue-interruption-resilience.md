# Queue interruption resilience

## Summary

- **Service stop:** a provider call that ends because the service is stopping, including the desktop app killing Codex, is now recorded as an interruption. Active stories resume on the next start without a retry, and paused or stopped stories keep their control until Resume.
- **Failure isolation:** the latched fault and the queue's self-stop are gone. A failed tick dispatches nothing and the next tick retries. A story whose saved data can't be read is skipped alone and left off the shelf, with its row retained. A failed job-outcome write no longer shows a provider message; the job recovers as an interruption.
- **Leases and replays:** lease tokens now fence attempts instead of wall-clock time, so a live call survives a clock jump such as laptop sleep and its result is saved. Automatic recovery runs a job at most three times, and an explicit retry restores the allowance for the whole story.

There is no schema change, and rollback is a plain revert. Commits: 1dfe462, bb8d9be, eac5712, and the delivery commit that adds this document.

## Verification

Node 24.22.1 and pnpm 11.25.0, on eac5712:

- `pnpm test`: 419 of 420 pass. The one failure is `tests/fast-first-story.test.mjs` (`small reading plans cap chapters…`), a discovery-namespace hash assertion. It also fails on a147e55 and 276b772, before this story's first commit, so it is out of scope and unchanged.
- `pnpm run typecheck` and `pnpm run lint` pass.
- E2E flows 1-8 in `.docs/tests/test-queue-interruption-resilience.md` pass through the repository tests, using controlled providers and a fake Codex process. `tests/codex-provider.test.mjs` runs the real `startDesktop` stop against that fake process, and was confirmed to fail when stop-time classification is removed.
- AR passed in round 2. CR passed in round 3. VR passed in round 2.

Not tested: a real laptop sleep (simulated by forcing leases past expiry), the packaged desktop app, real Codex or Gemini calls, and Docker. No UI changed, so there was no browser pass.

### VR result

**Acceptance criteria**

Test paths: QI is `tests/queue-interruption.test.mjs`, PQ is `tests/production-queue.test.mjs`, BG is `tests/background-generation.test.mjs`, RP is `tests/reader-production.test.mjs`, CP is `tests/codex-provider.test.mjs`, SG is `tests/shelf-generation.test.mjs`.

| Req line | Criterion | Status | Evidence |
|---|---|---|---|
| 9 | A stop records an interruption, for image and script/preparation work | Complete | QI:44 image, QI:51 script, QI:72 preparation, CP:134 kill rejects, CP:141 real `startDesktop` stop, PQ:64 |
| 10 | Active story resumes, reuses saved results, no subscription or login error | Complete, with one disclosed risk | QI:44 and QI:83 assert no 订阅/登录 while polling; QI:83 kill with saved pages, drawn `[1,2,2,2,1]`; QI:51, CP:141, BG:72, BG:149 |
| 11 | Paused or stopped story stays that way; Resume continues | Complete | QI:62 image in flight, QI:92 script in flight, each for pause and stop |
| 12 | Real and deterministic failures stay failed, including during a stop | Complete, with one disclosed boundary | QI:115 blocked review, QI:103 deterministic 4xx in script work, PQ:64 terminal rule, QI:128 and BG:105 real failures |
| 16 | A transient tick error stops only that cycle | Complete | QI:136 |
| 17 | Unreadable story is isolated, shelf loads, data retained | Complete | QI:184-189 bad selection, `{}`, `null`, truncated JSON; QI:205 no paid plan call |
| 18 | A failed outcome write doesn't stop the queue, isn't reported as a provider failure, and recovers as an interruption | Complete | QI:218 success write, QI:231 failure write, QI:243 engine checkpoint save, QI:255 publication write, PQ:80 pre-handler |
| 19 | No new paid work while the database can't be written | Complete | QI:149; the claim UPDATE is the guard |
| 20 | Shutdown with a transient error still drains and closes the database | Complete | QI:172 drain with publication saved, QI:158 close |
| 24 | Live call keeps claims across a clock jump; second service is fenced | Complete | QI:267, QI:282, PQ:53. Simulated by forcing expiry; no real sleep |
| 25 | Late results are fenced; dead-service attempts recover | Complete | PQ:38, PQ:53, RP:151, RP:178, BG:82, BG:149 |
| 26 | At most three automatic runs, then a retryable interruption | Complete | QI:298 asserts `interrupted=1`, `retryAllowed`, no fourth call. The message text was confirmed in a one-off run, not in a repository test |
| 27 | Explicit retry restores the allowance; released claims don't count | Complete | QI:298 including a sibling row, PQ:73, SG:91 |

**Disclosed risk (line 10).** If the database also fails while `script()` clears the row during a stop, the row keeps the engine's provider message after restart. That can be the subscription/login text, and it stays visible until a manual retry. This is an exception to "never" and needs two independent faults.

**Disclosed boundary (line 12).** "Deterministic" is implemented as a `ReaderError` with a 4xx status. A local check that throws a provider error instead, such as `INVALID_ANCHOR` (`server/generation.ts:82-83`, `lib/reader-gemini.ts:152,155`), is recorded as an interruption if it lands during a stop. It re-runs once on restart with no provider call, then stays failed.

**Constraints.** All met; none of these changes affect them.
- No migration; recorded interruptions keep working (BG:82).
- Owner scope (PQ:45, RP:107), deletion disarm (BG:114, RP:54), frame-count confirmation (RP:189, BG:122), publication drain (RP:101, QI:172), pause and resume (BG:26, QI:62).
- Safe logging (QI:136, QI:184-189).
- Controlled providers only.

Non-goals were not implemented.

**Plan tasks.** All tasks are complete, including the regression task. The stop matrix is now covered by QI:44, QI:51, QI:62, QI:72, QI:83, QI:92 and QI:115.

**README.** Line 124 is accurate.

VR passed: all acceptance criteria complete

## Notes

- **Failed checkpoint saves:** in script work, a failed save now loses that step's in-memory paid result, and recovery pays for the step again. The earlier code kept the result through a second save but reported a provider failure. Managed jobs are capped at three attempts.
- **Legacy `/advance`:** on an unmanaged story, a SQLite error returns a generic 500. The row recovers after its 180-second lock expires. This path was traced, not tested.
- **Two services on one library:** a service can't tell a sleeping peer from a dead one, so it may replay the call. The sleeper's late result is fenced out. The desktop data lock rules this out for the desktop app.
- **Gemini quit:** in-flight fetches aren't aborted on stop. A quit that kills Node before they drain recovers through lease expiry, up to 180 seconds later.
- **Upgraded rows:** old rows counted released claims in `attempts`, so a job already at three shows a retryable error instead of resuming.
