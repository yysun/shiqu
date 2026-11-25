# Independent landscape controls and offline recovery

Verified the working tree based on `cd412ed6` using disposable libraries and controlled drawing responses.

| Case | Outcome | Observed result |
| --- | --- | --- |
| C031 | Pass | With the model disconnected, a readable original portrait moved from 1/2 to 2/2. A legacy landscape from a library produced by `839a0f9f` moved from 3/4 to 4/4 and reopened at 4/4. A standalone print also recovered offline. Each path produced zero additional image calls. A missing portrait remained pending until the file became readable. |
| C033 | Pass | The shelf deletion replay sent only the first page, which was already in flight at deletion. |
| C034 | Pass | In the in-app reader the older print displayed 1/4 and offered “应用当前横图模型”. After selecting it the reader still showed 1/4 and offered “恢复”. Only explicit Resume sent pages 2–4. The child revision continued to offer its own first landscape creation. A separate active-print run sent page 1 with model A and pages 2–4 with B. The portrait DAG compared equal before and after. |
| C035 | Pass | Sending the source print ID to a newer revision with active portrait generation returned HTTP 409 and the portrait stayed active. A genuine legacy landscape pause also preserved the portrait control, held the remaining pages through restart, and resumed from its own step. |

The model command is bound to the print, its saved model and the available replacement. Already sent work can finish. A paused print keeps its pause through model replacement and restart. Offline retries check the saved drawing inputs and local image before applying the result.

[Registered regression cases](../../../../tests/production-reader-exit-flows.test.mjs) · [Independent reproduction](../2026-11-24-independent-print-review/replay.mjs)
