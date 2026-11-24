# Production DAG and story state retest · 24 November 2026

**Hold workflow sign-off on `2b6d1c71`.** All four original reproductions now pass on newly saved revisions. The hand-edited character fix also passes. Four production paths still fail. Two can repeat a paid drawing call, one hides the manual review exit, and one affects stories users saved before updating.

## Open findings

| Priority and case | Reproduction and consequence | Acceptance condition |
| --- | --- | --- |
| P1 · C022 · Continue repeats a drawing after replanning | Fail the first drawing of a four-frame story, pause, change only narrative detail, save, and Continue. Preview reports zero inherited faults. The revised first frame has the **same frame key and all five original hard-input hashes**, including the visual and drawn cast. The worker draws it again and completes the story. Changing the art style as well produces different inputs and correctly allows a new drawing. | Keep an unresolved job fault pending while its inputs are unknown. Match it before dispatch. Equal inputs require targeted recovery. Changed inputs can proceed on Continue. |
| P1 · C023 · Recovery redraws an image that is already readable | Save a first-frame drawing, make its first verification read return missing, then restore access. The original job holds the paid receipt and the file is readable. A retry on the original version finishes with **zero** further first-frame draws. Save an acceptance-only revision first, then Continue and explicitly retry its inherited fault. Recovery calls the drawing provider **once more for the same frame**. | Verify the inherited receipt and file against the current drawing inputs. A readable matching artifact completes through local storage, even when its receipt belongs to the parent. |
| P1 · C024 · A revision loses the manual exit from review failure | Fail review on a complete four-frame draft. When paused, the parent offers Skip Review. Change only the synopsis and Continue. Independent work settles, and the child retains all four failed frame verdicts. Pause again. The child has all four storyboard frames, labels the fault “generation,” omits Skip Review and returns **HTTP 409** for the current fault ID. A reader with a repeatedly failing reviewer loses the documented way to draw the completed draft. | Retain the review operation and its surviving targets. Revalidate the current draft and fault ID before offering or accepting Skip Review. Preserve the existing pause and explicit drawing authorization. |
| P1 · C025 · Updating leaves previously affected revisions broken | Created faults and saved the affected child on **both** the published 0.15.0 tag and the pre-fix format-3 build. Shut down each old service, copied its synthetic library, then opened it with the fixed application. The 0.15.0 copy completed the real format-3 migration. In both builds’ visual cases, Continue calls the generator again and ends at **four ready, story failed**, with one empty frame key. In both registration cases, the child has zero faults and re-registers both unchanged items on Continue. | Reconcile affected persisted children against their parent’s recorded work, with owner, revision, and input checks. Show real recovery targets before ordinary work can be sent. Verify that healthy revisions and authorizations survive reopening and running the repair twice. |

The revision code drops ordinary faults when current hard inputs are unavailable. Only the saved-image-loss branch creates an awaiting-match record. Carried job rows retain their origin ID and input hash, but omit the original job link. The retry path settles a jobless fault before the worker schedules new work. The review projection and command handler both require a local job to classify and skip a failed review. The corrected carry logic runs when saving new revisions. [Revision matching and persistence](../../../../server/dag-revisions.ts#L227) · [Retry and fault projection](../../../../server/reader-production.ts#L310) · [Review command validation](../../../../server/dag-production.ts#L675) · [Paid drawing receipt reuse](../../../../server/dag-production.ts#L269)

## Confirmed fixes

| Case | Evidence on the fixed build |
| --- | --- |
| C018, failed visual batch | All four concrete keys survive an unrelated revision. Ordinary Continue and restart make zero visual calls. One targeted recovery, replayed with the same request ID, runs one batch and leaves shelf and detail completed with four images. |
| C019, failed item registration | Both item IDs survive a style-only revision. In a three-item batch with one preserved, one rewritten and one removed, Continue registers only the new text. Targeted recovery registers the one unchanged blocked item. |
| C020, saved preparation | Restart settles the queued receipt with zero new attempts, keeps usage and draft intact, and exposes Confirm on shelf and detail. The original recommendation was generated once, and confirmation succeeds. |
| C021, landscape controls | Clicked Generate and Pause in the reader, then Resume on the bookshelf. Story settings reported the complete landscape set. The companion service test held three sent drawings, verified that the fourth stayed unsent while paused and that portraits were preserved, then counted four landscape calls after Resume. [Paused bookshelf](shelf-paused.jpg) · [Finished reader](reader-finished.jpg) |
| C016, manually added cast | Editing a frame description to name another existing character now includes that character in the drawing job. The caption-only control preserves the existing drawing. |

[Registered integration tests](../../../../tests/production-reader-exit-flows.test.mjs) · [Character and review scenarios](../../../../tests/production-dag-scenarios.test.mjs)

## Runs and limits

The source under test was a frozen archive of `2b6d1c715c7a4994556c2037ef82b296902616ba`. Node 24.22.1 ran the production application, queue, SQLite and file storage against isolated libraries with deterministic provider responses. The UI run used the ChatGPT in-app browser and a local Vite reader. Provider counts refer to calls observed by the controlled adapter. The upgrade fixtures were created by each older build before opening copies in the current application.

| Selection | Result |
| --- | --- |
| Changed-source PR gate over both fix commits | 438 passed, 2 skipped, 0 failed |
| 69 review and adjacent files plus the two original repro tests, default tier | 673 passed, 10 failed, 1 skipped, 0 TODO |
| 22 of those files rerun at full tier | 154 passed, 4 failed. All four are the legacy synopsis tests already counted above. |
| 80-frame case, run separately at full tier | Passed in 59.8 seconds. All four storyboard batches and 80 distinct drawings completed within the test deadline on this run. |
| Working-tree QA change gate | 30 passed. |
| Focused production probes | Five failing assertions across four findings and two passing controls. Reproduced using each historical seed build. |
| Typecheck and lint | Both passed. |

The ten failures recur from the prior review. Four synopsis tests and one command-replay test issue Resume while already active and stop at HTTP 409. Two file-recovery tests expect a second drawing after a valid file becomes readable. One orphan-job test uses an empty payload for its purported valid DAG job. The other two concern a paused preparation setup and an assertion on the compatibility control field during revision replay. These failing tests leave real verification gaps even where the assertion conflicts with the current contract. Results from overlapping runs must be read separately. [Exact run results](results.json) · [Prior triage and the complete 59-scenario coverage matrix](../2026-11-24-current-dag-review/review.md)

The 59-scenario matrix still contains rule-only coverage and unverified combinations. Scenario 35 now has passing production evidence. Scenarios involving fault inheritance and saved paid outputs still have failing combinations, detailed above. The service-wide recovery and rate-limit behavior remains explicitly deferred. [DAG requirements](../../../../.docs/story-production-dag.md) · [Lifecycle scope and review skip conditions](../../../../.docs/reqs/2026/11/24/req-production-lifecycle-state.md)

To reproduce the new findings, run `node <absolute-path-to-replay.mjs> <older-source-root>` from the current source root under the pinned Node version. Each source root needs its normal dependencies. Use an older source root at `v0.15.0` or `69495ab8`. The script creates disposable libraries, reports one JSON object per check, and exits nonzero on a failed expectation. [Runnable probes](replay.mjs)
