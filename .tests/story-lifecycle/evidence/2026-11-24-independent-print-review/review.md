# Story production and independent print sets at cd412ed6

Old landscape sets now belong to their source revision. Saving a style edit leaves the new revision at 0/4 landscapes and makes zero new landscape calls. The reader can explicitly select an older set with its own page order and captions. Current production tests rendered that set in both 7×5 and Letter layouts. [Print requirements](../../../../.docs/reqs/2026/11/24/req-standalone-landscapes.md)

## Open findings

| Case | Trigger | Observed result |
| --- | --- | --- |
| C033 · P1 | Start four landscapes on version 1, hold the first send, save and continue version 2, and delete its only shelf card. | The in-app reader confirmed deletion and offered Undo. The controlled transport then received **new calls for pages 2, 3 and 4** from the older version. An independent API run reached 4/4 while the shelf was empty. Deleting the actual source version directly paused its queue and restoring it left the queue paused. |
| C034 · P2 | Pause a four-page print after page 1 enters the provider. Remove its original model configuration, select a working replacement, resume and apply current model settings. | Resume returned 202 and Apply returned 200. After restart the source print still required the unavailable model. It reported running at 1/4 with three queued jobs and no retry or replacement token. |
| C035 · P2 | Submit the previous revision’s real print ID to the new revision’s landscape Pause endpoint while a new portrait is in flight and the new version has no print set. | The call returned 202 and changed the new story’s portrait control from active to paused. The legacy fallback ignores the supplied print ID. This was verified at the command boundary. |
| C031 · P2 | A drawing receipt was saved and first verification failed. Restore readable bytes and disconnect the model before retry. | An original portrait remained failed at 1/2 and returned 503. A pre-standalone landscape also remained partial at 3/4. Both recovered online with zero new drawings. A **new** standalone landscape recovered offline at 4/4, also with zero new drawings. |

C033 is a difference between deleting one revision and deleting the card through which a reader controls the whole story. A running print on a superseded revision deliberately continues during ordinary editing. When the card is removed, only the card’s revision is paused. New sends still check the source revision’s own deletion record. [Deletion transaction](../../../../lib/reader-repository.ts) · [Final dispatch check](../../../../server/reader-production.ts)

C034 needs a print-level way to adopt an available model or explicitly replace the blocked job. The portrait model action updates the story DAG. The print queue retains its own model snapshot. C035 can keep support for legacy controls by checking the identity of any explicitly named print before invoking portrait control. [Print control](../../../../server/landscape-print.ts) · [Legacy fallback](../../../../server/reader-production.ts)

## Prior findings and verification

- C029 and C032 passed in the original style-edit replay. The new revision returned zero landscape URLs and sent zero optional draws. The earlier complete set remained printable through the separate set selector.
- C030 passed twice after opening disposable libraries written by `839a0f9f`. One had a pending inherited optional fault. The other already had the erroneous success receipt. Both returned 409 on generic retry, preserved the dedicated retry, drew only page 3 and completed at 4/4. Fresh standalone sets keep their faults on the source version. The old replay expected a child fault ID and could not test this new storage model without adapting the setup.
- The changed-source gate passed 656/656. The focused full-tier selection passed 176/176, the separate 80-frame run passed, and 27 native library tests passed. Typecheck and lint passed. These counts overlap.
- The broad 69-file run passed 700 checks on its first invocation. One test could not bind a loopback listener in the sandbox, and the heavy 80-frame case was skipped by default. Both passed when run separately. The working-tree QA gate passed all 30 checks.
- All draws used controlled transports and disposable SQLite libraries. C033 was also exercised through the in-app browser. The 59-scenario inventory still distinguishes production traces from rule-only checks. [Earlier coverage matrix](../2026-11-24-current-dag-review/review.md)

Run the three new checks from the repository root using the pinned Node and `node --test .tests/story-lifecycle/evidence/2026-11-24-independent-print-review/replay.mjs`. Each is expected to fail on this build. [Runnable checks](replay.mjs) · [Recorded observations](results.json)
