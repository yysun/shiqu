# Queue image recovery and reading priority

## Summary

- **Lost image recovery:** a missing or corrupt image file now fails with a message saying a retry will redraw that page and may charge again. An explicit retry redraws it, including a lost first image, and later pages then continue from the new one. A file that comes back before the retry is published for free, and a read error that may be temporary still never pays. Automatic client retries stop on this failure.
- **Reading priority:** an open story now tells the server which page is showing. Its first image, current page and the next six pages are drawn ahead of other stories, and ahead of its own later pages. Other stories' images also wait briefly while a viewed page publishes, for at most 15 seconds, because otherwise they took the free worker after every viewed page. Closing the story or losing the connection returns it to normal order, and it keeps generating.

There is no schema change, and rollback is a plain revert. Commits: 8db844d, 5277e90, 6a73774.

## Verification

Node 24.22.1 and pnpm 11.25.0:

- **Full suite, clean worktree at 5277e90:** 448 of 450 pass, and typecheck and lint pass. Neither failure comes from this story:
  - `tests/fast-first-story.test.mjs` already failed before this work and is fixed on the unmerged branch `claude/sweet-lederberg-4788bd` (4708a84).
  - `tests/development-access.test.mjs` hung in the clean worktree, which has no `dist` and a symlinked `node_modules`. It passes in the main checkout.
- **After 5277e90:** 6a73774 changes tests and docs only. Those test files pass on it.
- **Mutation checks:** removing the yield rule, the retry re-check, the first-image rule, the read-ahead limit or the viewer-expiry filter each fails the matching tests.
- **Browser check:** `scripts/dev.mjs` with a temporary library and a fake Codex that never finishes work, from the shared checkout before 5277e90 was committed. The open story reported to `/production` on opening and every 10 seconds alongside polling. Pause produced one further request, the viewer leaving, then none for 15 seconds. Resume made the demand row live again. Closing removed it while the story kept running.
- AR passed in round 2. CR passed in round 3. VR passed in round 2.

Not tested: real provider calls, Docker and the packaged app. In the browser, page changes and a dropped connection were not exercised; tests cover both, the expired lease by setting its expiry directly.

### VR result

#### Acceptance criteria (test paths under `tests/`)

**Lost image recovery**

1. **Missing or unreadable file at publication fails with a redraw and charge message, and `retryMayCharge` true: complete.**
   - Code: `server/reader-production.ts:293-294`, snapshot `:131-138`.
   - Tests: `a ${name} file at publication asks first, then redraws only on explicit retry` (`queue-image-recovery.test.mjs:46`, missing and corrupt); `an invalid saved image result is treated as lost, and redraws only on explicit retry` (`:76`); `publication requires the bytes to match the file type; a reference only needs a usable image` (`:85`); `mixed lost and transient failures warn about the charge` (`:120`).

2. **Explicit retry redraws and the story can complete; no redraw without explicit retry: complete.**
   - Code: `server/reader-production.ts:120`, `:222-236`; client guards `lib/reader-production-client.ts:51`, `lib/reader-generation.ts:41`.
   - Tests: `queue-image-recovery.test.mjs:46` (ticks and a non-retry request make no provider call, then one retry redraws once); `automatic retry stops on a lost image, and only an explicit retry goes through` (`reader-production-client.test.mjs:150`); `the legacy client never retries a lost image automatically` (`queue-image-recovery.test.mjs:194`).

3. **Lost first image fails the later page before any provider call; retry redraws it, later pages continue, other saved pages are not redrawn: complete.**
   - Code: `server/reader-production.ts:287`, `:222-236`.
   - Test: `a ${damage} first image fails the next page before paying, and retry redraws only it` (`queue-image-recovery.test.mjs:60`), which asserts per-page provider call counts of `[2,1,1,1]`.

4. **A file readable again at retry publishes without a provider call: complete.**
   - Code: `server/reader-production.ts:233`.
   - Test: `a file that comes back before the retry is published without paying again` (`queue-image-recovery.test.mjs:98`).

5. **A transient read at publication stays `retryMayCharge` false, and retry makes no provider call: complete.**
   - Tests: `a read that throws stays transient: no charge warning and no redraw, even at retry` (`queue-image-recovery.test.mjs:106`); `local publication failure and legacy retry reuse the paid receipt and record usage once` (`reader-production.test.mjs:65`).

**Reading priority**

6. **First image, current page and six after it are drawn ahead of other stories' work and the story's own later pages: complete.**
   - Code: `pagePriority` at `server/reader-production.ts:33`; yield rule at `:191`, `:201`.
   - Tests in `queue-image-recovery.test.mjs`:
     - `an open story draws its first image, current page and read-ahead ahead of other work` (`:130`)
     - `a viewed first image goes ahead of an older story's waiting first image` (`:138`)
     - `only the current page and six after it go ahead of unread stories` (`:146`)
     - `${name} ends the hold on other stories` (`:233`)
     - `a viewed first image still drawing leaves spare workers free for other stories` (`:240`)
     - `two viewed stories both finish` (`:251`)
   - Browser check: the open story reported to `/production` on opening and every 10 seconds.

7. **Moving to another page changes what comes first within a few seconds, without cancelling running work: complete.**
   - Tests: `moving to another page changes what comes next without cancelling the running page` (`queue-image-recovery.test.mjs:157`); `an open active story reports its page for priority, follows page changes and leaves on exit` (`reader-production-client.test.mjs:115`).
   - Timing comes from the 1-second poll and the immediate priority update in `demand`.
   - Limit: the browser check didn't change page, because the fake Codex never produced a first image, so the hook's page getter is verified by reading only.

8. **Closing the story, or losing the connection, returns it to background order, and the story keeps generating: complete.**
   - Closing:
     - Test: `closing the story returns it to page order, and it keeps generating` (`queue-image-recovery.test.mjs:165`).
     - Browser check: 0 demand rows left, with the script job still running.
   - Losing the connection:
     - Test: `a lost connection returns the story to background order, and it keeps generating` (`queue-image-recovery.test.mjs:176`).
     - Test: `expired viewer demand stops dispatch even if the browser never sends leave` (`reader-production.test.mjs:48`).
     - Replacing the expiry filter in `demands()` fails both tests.
   - Limit: the expired lease is simulated by setting `expires_at=0`. The browser check didn't drop a real connection.

9. **Viewing a failed, paused, stopped, completed or frame-count-waiting story sends no demand and can't start or retry paid work; a failed priority request doesn't interrupt status updates: complete.**
   - Tests:
     - `a story that is not actively generating never reports a page` (`reader-production-client.test.mjs:134`)
     - `a failed or hung priority report never interrupts status updates or exit` (`:142`)
     - `a non-retry request against a ${state} story starts nothing` (`queue-image-recovery.test.mjs:201`, failed, paused and stopped against the server)
   - Browser check: Pause produced one request (the `DELETE`), then none for 15 seconds. `DELETE` and `POST` were told apart by demand row and timing, not by method name.
   - Limit: completed and frame-count-waiting are covered at the observer with mocked snapshots.

10. **Without a reader, stories keep today's order by page number: complete.**
    - Test: `without a reader, order stays by page across stories` (`queue-image-recovery.test.mjs:186`).

#### Constraints

- **No schema migration:** complete. `git diff 9d429df 5277e90` shows no change under `drizzle/` or `db/`.
- **Owner scope:** complete. Queries are scoped by owner, `rerun` only takes ids from owner-scoped jobs, and `queue routes validate input/origin and use server owner identity` covers the routes (`reader-production.test.mjs:109`).
- **Deletion disarm:** complete (`reader-production.test.mjs:56`, `background-generation.test.mjs:114`).
- **Pause and stop:** complete (`background-generation.test.mjs:26`).
- **Replay cap:** complete (`queue-interruption.test.mjs:298`).
- **Global worker limits:** complete (`reader-production.test.mjs:30`, `background-generation.test.mjs:129`).
- **Provider failures unchanged:** complete. The `safeError` path is untouched, and `a real provider failure while running is not treated as an interruption` covers it (`queue-interruption.test.mjs:128`).
- **Controlled verification only:** complete. Tests use the fixture provider, and the browser check used a temporary library and fake Codex.

#### Plan tasks

Every implementation and test task is done in 8db844d, 5277e90 and 6a73774.
- `rerun`: `server/production-queue.ts:46`.
- File checks, retry recovery, snapshot, priority and yield rule: `server/reader-production.ts`.
- `'redraw'` and both client guards: `lib/reader-model.ts:28`, `lib/reader-production-client.ts:51`, `lib/reader-generation.ts:41`.
- `focus`: `lib/reader-production-client.ts`, `client/ui/useStoryGeneration.ts:103`, with headers updated.
- README: lines 122 and 124.
- E2E flows 1-6 map to the tests above: flow 1 `:46`, flow 2 `:60`, flow 3 `:98`, flow 4 `:106`, flow 5 `:130`, `:157`, `:165`, `:176`, flow 6 `reader-production-client.test.mjs:134` and `queue-image-recovery.test.mjs:201`.

#### Doc inaccuracies

All six inaccuracies found in review were corrected in 6a73774.

VR passed: all acceptance criteria complete

## Notes

- **Redrawing the first image:** pages already drawn keep the old reference, so characters may differ slightly. Until the new first image is published, story updates pause and page 0 progress returns 400.
- **Older stuck stories:** rows with the old publication error aren't marked as lost. Their first retry re-runs publication and marks them, and the second redraws after showing the warning.
- **Stays stuck on every retry:** a saved image that is readable but whose filename doesn't match its page keeps showing the redraw message without redrawing. Nothing is charged. Reaching this takes a crash, a restored file and a reordered story.
- **Not covered:** lost files for pages already published are not detected, other than the first image while a later page needs it. Low-risk paths without a test: the URL guard on the slot clear, the handler's read-error fallback, and a first-image redraw after pages were reordered.
- **Shared checkout:** `lib/reader-model.ts` had uncommitted story-revisions work on the same line, so only the `retryStage` change was staged. The story-revisions work was not reviewed against this change.
