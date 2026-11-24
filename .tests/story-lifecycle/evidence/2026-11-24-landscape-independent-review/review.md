# DAG and story-state re-review at 839a0f9f

The three reported drawing recovery fixes passed. Four additional assertions failed in three workflows. The stale landscape PDF and optional drawing dispatch both block release under the suite’s P1 exit criterion. Each run used the production application, disposable SQLite and media, and controlled model transports. Node 24.22.1 and pnpm 11.25.0. [Recorded results](results.json)

## Open findings

| Case | Trigger | Observed consequence | Acceptance check |
| --- | --- | --- | --- |
| C029 · P1 | Create four landscapes, change the story’s art style, Continue, and hold every replacement landscape response. | The landscape API returned completed at 4/4. All four DAG products evaluated invalid, and every returned file matched its parent byte for byte. The production landscape PDF renderer read all four old images and produced a PDF. | Count and export only current-input landscapes. A completed portrait story can still offer a landscape PDF using the reader’s portrait fallback. |
| C032 · P1 | The same style edit, with no landscape command on the child. | Three optional landscape calls had already entered the drawing transport. Only the parent had requested landscapes. | The ordinary revision leaves optional redraws awaiting reader authorization. Preserve the separately authorized single-frame redraw workflow. |
| C030 · P2 | Pass the child’s inherited, optional page-3 fault ID to the generic recovery route used by CLI retry. | The API returned 202 with a succeeded receipt. After draining the queue, restarting and draining again, the landscape status was running at 3/4, with zero queued or running jobs, no failed page and no retry token. | Either run the targeted recovery or reject the command while keeping the working landscape retry. |
| C031 · P2 | The original drawing job saved a receipt. Its image was unavailable at the first verification and readable again before retry. Disconnect the model and restart without creating a child. | Both the second portrait and third landscape lost their retry action and returned HTTP 503. Reconnecting the provider restored 2/2 and 4/4 respectively with zero extra drawing calls. | Check the original job’s matching local receipt before applying the provider requirement. A missing or invalid local file must still require authorization for a new draw. |

The status calculation counts nonempty landscape URLs. The PDF caller accepts a completed set with one URL per page. The DAG also treats a retained landscape field as an ongoing request. These decisions can simultaneously publish an obsolete printable set and dispatch new optional work. The specification explicitly requires a reader action after portrait changes and separately describes the single-frame redraw exception. [Landscape status](../../../../server/dag-production.ts) · [Reader PDF selection](../../../../client/ui/Reader.tsx) · [On-demand DAG inputs](../../../../lib/production-dag/document.ts) · [DAG contract](../../../../.docs/story-production-dag.md)

Generic recovery can mark an inherited fault with no local job resolved. For offline recovery, the local portrait probe handles specific loss or inherited faults, and the landscape POST checks for a model before reaching receipt reuse. [Recovery handler](../../../../server/reader-production.ts) · [Landscape endpoint](../../../../lib/reader-api.ts) · [CLI retry command](../../../../server/headless-cli.ts)

## Closed findings verified on this build

- **C026** — After an acceptance-only revision and restart, the in-app reader showed page 3 failed at 3/4. Clicking its Retry link dispatched exactly one landscape draw for page 3. The same settings dialog updated to show all landscapes ready. The original reproduction also exported all four portraits while the optional fault was pending. [Reader after retry](landscape-ready.jpg)
- **C027** — Targeted online retry verified the original landscape receipt and reached 4/4 with zero extra draws.
- **C028** — The inherited portrait receipt remained recoverable without a configured model. Shelf and settings both exposed Retry. The production response completed the child at 2/2 with zero extra draws.

## Verification and coverage

| Run | Result |
| --- | --- |
| Broad DAG and story-state selection | 701 passed, one heavy case skipped. The separate full-tier 80-frame run passed with four batches and 80 distinct draws. |
| Full-tier adjacent scenarios | One 21-frame completion timed out during the first 158-test run while other suites were active. The exact case passed in isolation. The complete serial rerun passed 158/158. |
| Source-impact gate for the fix | 623 passed, two optional historical rollback checks skipped in the gate. Reran both migration and backup files with the actual v0.14.0 source and all 17 checks passed, including both rollback branches. |
| Prior seven reproduction checks, including actual saved-library migration | 7/7 with libraries created by v0.15.0, and 7/7 using pre-fix build 69495ab8. |
| Working-tree QA gate, native desktop, typecheck and lint | 30/30 JavaScript checks and 27/27 native checks passed. Typecheck and lint passed. |

These selections overlap. The 59-scenario inventory still includes rule-level evidence and unsupported operations. Specific remaining end-to-end gaps include an edit and restart midway through a 20-frame job, a 40-frame review returning an off-target suggestion, and changing a target in another session between display and click. The browser action tested in this round was the dedicated landscape retry. The PDF finding used the production renderer with the reader API’s returned images, and generic recovery used the CLI’s production HTTP route. [Full scenario inventory](../2026-11-24-current-dag-review/review.md) · [Prior recovery checks](../2026-11-24-dag-recovery-retest/review.md)

Run the [four new checks](replay.mjs) with the pinned Node from the checkout root using `node .tests/story-lifecycle/evidence/2026-11-24-landscape-independent-review/replay.mjs`. Each scenario creates and removes a temporary library. A nonzero exit records an unmet expectation.
