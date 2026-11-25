# Shelf deletion and landscape print recovery

Tested the working tree based on `cd412ed6` with the production reader, a disposable SQLite library per case, and controlled image responses.

| Case | Result | Observation |
| --- | --- | --- |
| C033 · shelf deletion | Pass | The original build sent pages 2–4 after deletion. With the fix, the first request could finish, restart preserved 1/4, and the source revision rejected a stale Resume with HTTP 404 while hidden. After restoration only an explicit print Resume sent pages 2–4, once each. |
| C034 · unavailable print model | Fail | With a working replacement model selected, Resume returned 202 and applying the current model returned 200. After restart the print still reported its original model unavailable at 1/4, with no retry or replacement token. |
| C035 · stale print control | Fail | Sending the earlier print ID to the child revision's landscape Pause while a portrait was running returned 202 and paused portrait production. |
| C031 · offline receipt recovery | Fail | A readable original portrait stayed at 1/2 with HTTP 503. A legacy landscape written by the pre-standalone app stayed at 3/4 with HTTP 503. Both recovered after reconnecting with zero new draws. A standalone landscape recovered offline at 4/4 with zero new draws. |

In the in-app reader, deleting the sole card took the shelf from one story to zero. Undo restored the card. Story settings displayed “第 1 版横图 · 1 / 4 幅” with a “恢复” link. Clicking it completed the remaining work. The registered regressions also cover a deletion record saved by the older build, deletion after a worker claimed its first image but before sending, and deleting a historical revision while its successor prints. [Registered tests](../../../../tests/production-reader-exit-flows.test.mjs) · [Original reproductions](../2026-11-24-independent-print-review/replay.mjs)

The last 0.14.x tag in this checkout is `v0.14.0`. Both offline retries returned 503 on that release. The portrait had a saved receipt and recovered online without another draw. The old landscape had a readable file but no saved job result and drew one page again after reconnection. Standalone print IDs, per-print model snapshots and ongoing standalone prints on superseded source versions came later.

The change-impact run passed 493/493 with both 0.14.0 rollback checks enabled. The focused DAG, queue and reader suites passed 161/161. The suites overlap. All 27 native tests, typecheck and lint passed. The [lifecycle ledger](../../../STATUS.md) records 32 passing and three failing cases. The [59-scenario matrix](../2026-11-24-current-dag-review/review.md) identifies the branches still covered only by rules or missing an end-to-end trace.
