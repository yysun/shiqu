# Queue image recovery and reading priority

Requirement: `.docs/reqs/2026/10/30/req-queue-image-recovery-priority.md`
E2E spec: `.docs/tests/test-queue-image-recovery-priority.md`

Risk: non-low. Retry can now pay for work that previously could not re-run, and scheduling order changes.
Story base: 9d429df0c14203a16bcdf4a15b10ea46efe1d632. Preserve the unrelated release, client UI and story-revisions changes in the shared checkout. `lib/reader-model.ts` overlaps with story-revisions on the `SessionView` line, so only this story's `retryStage` change is staged there. Final verification runs from a clean worktree of the commit.

## Decisions

**Lost files are classified at the point of use, and consent comes from the retry.** Publication and the image handler both check the file and throw `ReaderError(409,lostImageMessage)` when it is missing or its bytes aren't a valid image. A saved image result that isn't valid at all also counts as lost, replacing its old 502: that failure is deterministic and already stuck, and it can only pay after the warned retry. Rows with the old 502 or 503 text aren't marked, so their first retry re-runs publication and marks them, and the second redraws after showing the warning. A read that throws stays a transient failure, as it does today. The saved message is what marks the job, because the job table has no other place for it and no migration is allowed. The snapshot prefers a marked job over other failed jobs, and reports `retryMayCharge:true` and a new `retryStage:'redraw'`, so the reader is told before clicking. `StoryRetry` falls through to its general copy for that state and the error beside it gives the real warning, so no UI change is needed.

**Only a person can trigger a redraw.** `runQueuedStoryGeneration` and `runStoryGeneration` retry a failed story automatically up to twice, exempting only `retryStage:'review'`. Both stop on `'redraw'` too. Otherwise a reader-mode story, still reachable through `POST production-control {action:'reader'}`, would pay for redraws nobody asked for.

**The two file checks differ on purpose.** Publication keeps today's strict check: the bytes must match the file's content type. The image handler matches what providers accept, which is any recognised image type, so a legacy reference that works today can't start failing. It resolves the file with `referenceImageKey`, which handles reordered stories. If that returns null, the handler leaves the provider's existing error in place, because that story is already failing today.

**Retry re-checks the file before paying.** In `demand(retry)`, before `queue.retry`, each failed job marked lost looks up its target page's image and publication jobs: the page itself for a publication job, page 0 for an image job. The file to check comes from the image job's `result.value` for a publication job and from `doc.images[0]` for a reference. If the file is readable again, it does nothing and normal retry republishes. An invalid or empty saved value counts as lost. A read that throws counts as not lost, so the retry never pays because of a transient error.

For a lost file, the check runs first, then the writes, in this order, for each marked job. A marked job that is still failed blocks image work until the last write. A new `queue.rerun(id)` runs on the image job, then the publication: it moves a succeeded or failed job to queued, clears its result and token and resets attempts, and never touches a running job. Then that page's slot is cleared with an atomic `json_set`, only if it still holds the URL that was checked, so it can't clear a newer image. `queue.retry` runs last. Nothing can draw in between, because these writes are synchronous SQLite with no real I/O, and a filled slot returns its saved value without a provider call anyway. After a crash mid-sequence, an empty result or slot counts as lost and the writes are idempotent, so the retry converges.

**Priority is one function of page and demand.** With `boost=productionReadAhead+1`:
- Background demand: `boost+page`, which keeps today's order among unread stories and puts every viewed page ahead of it.
- Viewer demand: page 0 gets 0; pages from the current page through `through_page` get `page-d.page`; anything else gets `boost+page`.

The minimum across demands is still used, and the existing per-tick upsert applies changes within a tick. Viewed pages behind the reader fall back to background order, so a jump forward draws the current page first. Anchor-first holds through the job dependency, not through priority.

**Other work yields during a viewed story's publication.** The priority alone isn't enough, as a probe showed: viewed and other pages strictly alternated. After each viewed page its publication runs, backpressure refuses the viewed story's next image, and `pump` hands the free worker to the next candidate for a full paid draw. So `canRun` refuses an image job with `priority>productionReadAhead` while a story has all of the following:
- a live viewer demand in this runtime, `generation_control='active'`, no failed job, and not deleted
- a publication that is running, or queued with a succeeded parent
- a queued image with `priority<=productionReadAhead`

The query starts from live viewers with a fixed join order, because scanning every job would block the event loop on a large library. A publication only counts while it is under 15 seconds old, by the `updated_at` of the running publication or of its succeeded parent. That is the bound on the hold: viewer demand can't provide one, because an open reader keeps renewing it, and a stuck publication would otherwise stall image work for every story. Priorities at or below `productionReadAhead` only come from viewer demand. A row can keep one briefly after a viewer leaves, which is harmless because the rule also requires a live viewer. The rule sits in `canRun`'s non-local block before `ownSession`, so a refused job's story doesn't take a session lock. While a viewed anchor is still drawing, other stories may use spare workers, because nothing is held then. Running work is never cancelled.

**The observer sends priority, not work.** `observeStoryGeneration` gets an optional `focus:{viewerId,page}`, where `page` is a getter. Only when a snapshot shows a background, active story that isn't failed, completed or waiting on a frame count, it sends `POST /production` with `retry:false` on a page change or every 10 seconds. The page is clamped to the story's last page, and is 0 until page 0 is published, because the reader's page can be left over from another story. The POST runs outside the poll with a single in-flight guard, so a slow or hung request can't stop status updates, and its errors are swallowed. `finally` waits at most 2 seconds for it using the injected `sleep`, then sends `DELETE` if it ever posted. The server's existing lease expiry covers a lost connection. The poll itself stays a one-argument GET, so existing observation tests still hold. A background active story is already authorised for every page, so this adds no paid work.

## Tasks

- [ ] First SS probe: confirm `tests/reader-production.test.mjs` still passes with the publication error change, since it covers transient read failures.
- [ ] `server/production-queue.ts`: add `rerun`.
- [ ] `server/reader-production.ts`: add `lostImageMessage` and the file checks in `publish` and `image`; add retry recovery in `demand`; report the lost state in `snapshot`; add the priority function in `graph` and the yield rule in `canRun`. Update the file header.
- [ ] `lib/reader-model.ts`: add `'redraw'` to `retryStage`. `lib/reader-production-client.ts`, `lib/reader-generation.ts`: stop automatic retry on it.
- [ ] `lib/reader-production-client.ts`: add `focus` to `observeStoryGeneration`. `client/ui/useStoryGeneration.ts`: pass it. Update both file headers.
- [ ] `README.md`: state that a lost image can be redrawn on retry and that the open story is drawn first.
- [ ] `tests/queue-image-recovery.test.mjs`: regressions for lost file at publication, lost and corrupt first image, restored file, transient read, mixed lost and transient failures, no redraw without retry, other pages not redrawn, and priority across stories, strict order through publications, page jump, closing, no-reader order, and `retry:false` against a just-failed or paused story starting nothing. Yield release: a paused or failed viewed story holds nothing, a viewer leaving ends the hold, a stuck publication stops holding after 15 seconds, a viewed anchor still drawing leaves spare workers free, and two viewed stories both finish.
- [ ] `tests/reader-production-client.test.mjs`: focus is sent only for eligible snapshots, follows page changes, clamps stale pages, tolerates errors and a never-resolving POST, and leaves on exit. Automatic retry stops on `'redraw'`.
- [ ] Execute `.docs/tests/test-queue-image-recovery-priority.md`.

## Validation

Node 24.22.1 and pnpm. Focused: `node --experimental-strip-types --test tests/queue-image-recovery.test.mjs tests/reader-production-client.test.mjs`. Full suite, typecheck and lint belong to TT. The hook wiring runs in the in-app browser against `scripts/dev.mjs` with a temporary `SHIQU_DATA_DIR` and a fake Codex that never finishes work.

## Risks

- **Redrawing the first image:** pages already drawn keep the old reference, so characters may differ slightly. Accepted, because the story is otherwise stuck, and the reader chose to retry.
- **Message as a marker:** rewording `lostImageMessage` would strand failed rows from the older wording, which then behave like a retry that fails again. It is a single constant.
- **Starvation:** a viewed story takes each worker that comes free for up to seven pages while it is open. This is the intended trade-off, and it ends when the pages are drawn or the story closes. A publication that can't finish holds other stories for at most 15 seconds.
- **Temporary reader limits during a first-image redraw:** story updates pause and page 0 progress returns 400 until the new image is published. Both recover on their own.
- **Rollback:** revert the commits. No persisted format changes.

## Review log

AR passed: no blocking architecture flaws.
AR risk: non-low — paid redraws and scheduling order.
AR review round: 2; reviewer: reused.

SS milestone: 8db844d (queue, coordinator, client, regressions, README). Follow-ups after CR round 1: tests for the first-image and read-ahead clauses, invalid saved results, file-check strictness and the legacy client guard; the yield query now starts from live viewers.

Browser check on Node 24.22.1, from the shared checkout at 8db844d plus the then-uncommitted follow-ups and unrelated story-revisions work: an open story reports to `/production` on opening and every 10 seconds alongside normal polling; Pause produces one further request (the viewer leaving, inferred from timing and the demand row) and none for the next 15 seconds; Resume makes the demand row live again; closing removes it while the story keeps running. Page changes were not exercised, because the fake Codex never produces a first image; they are covered by the observer tests. This used `scripts/dev.mjs` rather than `pnpm desktop:preview`, because the reader needs a real server and isolated data. Temporary library and fake Codex, so no paid call and no change to the real library.
