# DAG and story recovery review · 24 November 2026

**All four previously reported defects pass on `3eb2d6ae`. Hold workflow sign-off for the landscape retry defects.** A failed landscape can disappear from the retry list after a revision. A landscape retry can also purchase an image whose original paid file is readable. A third issue hides a free portrait recovery when the model is unconfigured.

## Reproduced on this build

| Priority | Production path and outcome | Acceptance condition |
| --- | --- | --- |
| P1 · C026 | Finish four portraits and request four landscapes. The provider rejects page 3. Its parent shows 3/4, failed page 3 and a retry action. Change only the acceptance requirement, Continue, and restart. The child retains the optional fault for page 3, now classified as a generic step failure. Landscape status reports **running, 3/4, no failed pages**, with zero queued or running landscape jobs. Settings offers Pause. Pause and Resume leave it stuck. The portrait story remains completed and its exported ZIP contains all four portrait WebPs. | Include unresolved inherited landscape faults in the landscape read model and retry authorization. The status should report the failed page and offer a retry targeting only that page. Preserve portrait completion and export. |
| P1 · C027 | The third landscape was drawn successfully. Its first verification read returned missing. Before Retry, the artifact at the exact paid-receipt address passed the production landscape pixel and aspect-ratio checks. A normal landscape Retry nevertheless dispatched **one further drawing call** for page 3. The set reached 4/4. | On retry, validate the saved receipt against the current inputs and read its artifact before starting another paid attempt. A matching, readable result must finish with zero further draws. |
| P2 · C028 | A two-page revision was missing only its final portrait. The ancestor’s paid output was readable. With the model unconfigured after restart, shelf and detail reported failed at 1/2, and their rendered controls omitted Retry. Submitting the existing fault ID directly returned **HTTP 202**, a succeeded receipt, and completed the story at 2/2 with **zero** drawing calls. | Offer local recovery for an eligible inherited receipt from both surfaces. If that file can no longer be used, require the normal generation authorization and service before paid work. |

The landscape status derives failed pages from jobs owned by the current version and frame-local errors. The inherited fault is held separately. The retry path starts a new landscape attempt. Free recovery eligibility in the lifecycle action list considers local image-loss faults, while the command handler can also restore a carried drawing. [Landscape status and retry](../../../../server/dag-production.ts#L477) · [Free recovery actions](../../../../server/reader-production.ts#L533) · [Recovery command](../../../../server/reader-production.ts#L369)

## Verified fixes

| Prior finding | Result |
| --- | --- |
| C022 · Equal drawing inputs after replan | Changing only narrative detail kept the failed first frame blocked through Continue and restart. Changing art style released the old fault. Explicit recovery of the matching frame completed the work. |
| C023 · Readable paid portrait | The original same-version and cross-revision probes both observed zero extra first-frame drawings. The registered tests also exercised temporary read failure, recovery replay and a file that returned between authorization and dispatch. |
| C024 · Skip Review | A complete four-frame child retained the review fault. In the in-app reader, Skip Review left generation paused at 0/4. Clicking Resume finished all four portraits. The final session reported completed with the review override recorded. [After Skip Review](review-paused.jpg) · [After Resume](review-drawn.jpg) |
| C025 · Libraries with broken saved revisions | Libraries were populated on the 0.15.0 tag and the pre-fix format-3 build `69495ab8`, then opened by the current application. Both regained all four visual targets and both registration targets. Ordinary Continue made zero repeat calls. The registered migration tests additionally covered an already-complete ghost failure, prior user recovery, multiple generations and two independent batches with the same error message. |

## Verification and limits

Tested a frozen snapshot and verified that its changed files match commit `3eb2d6ae0dcfb9890d952875ec8c9ec912eaa1e0` byte for byte. Tests used Node 24.22.1, temporary SQLite libraries, production services and controlled providers. Only the inherited review path was clicked in the in-app browser in this round. The other two UI discrepancies were verified against production API responses and rendered reader components.

| Run | Result |
| --- | --- |
| Broad review, the same 69 files plus the original two regression probes | 691 passed, 1 heavy case skipped, 0 failed |
| Heavy 80-frame case run separately | Passed in 15.1 seconds, with four batches and 80 distinct drawings |
| 22 overlapping adjacent files at full tier | First run had 157 passes and one timeout waiting for the 21-frame story to finish. The complete serial rerun passed all 158. The timeout remains a timing risk under concurrent load. |
| Changed-source gate covering the fix | 358 passed |
| Native desktop tests | 27 passed |
| Typecheck and lint | Both passed |
| Previous independent reproduction script | 7/7 assertions passed with each historical seed build |
| Three additional recovery scenarios | All three failed their expected outcome |

The earlier 59-scenario inventory still distinguishes rule-level assertions from end-to-end observations. The optional-failure export check now has direct production ZIP evidence in the four-frame fixture. These runs do not certify every UI or provider combination. [Prior coverage matrix](../2026-11-24-current-dag-review/review.md) · [Prior failed runs](../2026-11-24-dag-retest/review.md) · [Machine-readable results](results.json)

Run `node <absolute-path-to-edges.mjs>` from the repository root with the pinned Node version and installed dependencies. Each case creates and removes its own library. The script exits nonzero when an expectation fails. [Runnable cases](edges.mjs)
