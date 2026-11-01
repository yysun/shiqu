# Test: production queue hardening

Use an isolated data directory and a controlled provider. Make no paid calls.

## Newest version only

### Old version whose row still says active

Each route needs its own old version, with `generation_control` set to `active` and a newer version in its family:

- **Scheduler and `POST /production` with `retry:true`:** a version with queued text and image jobs.
- **Managed `POST /advance`:** the same version. This goes through `demand`.
- **Direct `POST /advance`:** a version with no jobs and no intake. This is the one that reaches the `repo.acquire` condition.
- **`POST /source`:** a version with a plan and no saved source.

For each:

- **Then** no provider call starts for the old version, and each job's attempts are unchanged.
- **And** the old version reads as paused with a note that it's old, and the newest version continues.

### Old version holding a viewer

- **Given** an old version with a live viewer row and a recent publication, and another story waiting to draw a low-priority image.
- **When** the scheduler runs.
- **Then** the other story draws without waiting for the old version.

### New version appears just before paying

- **Given** an image job for v1 that has passed `canRun`.
- **When** v2 is published before `image()` calls the provider.
- **Then** the provider isn't called, and the job returns to the queue with no attempt used.

### Interrupted old job

- **Given** a text job and a publication job on v1, left running by a dead service, with v2 published.
- **When** their leases expire.
- **Then** the text job isn't resumed, and the publication job still resumes when its story's control allows it.

### Deleted newest version

- **Given** v1 and a deleted v2.
- **When** v1 is resumed, then v2 is restored and resumed.
- **Then** v1 is refused, v2 stays stopped until its own resume, and v2 then runs.

### Stale tab

- **Given** a stale tab showing a blocked version that has been superseded.
- **When** the reader retries, chooses **跳过问题并绘图**, or resumes.
- **Then** the skip and resume are refused with a message pointing to the newest version, the retry starts no work, nothing changes, and no paid call starts.

### Corrupt row

- **Given** one saved row with invalid JSON.
- **When** another story is scheduled, revised and resumed.
- **Then** all of those succeed, and the shelf still loads.

## Atomic publication

### Crash around publication

- **Given** a story with a valid revision submission.
- **When** the INSERT fails, or the service stops immediately after it.
- **Then** after a failed INSERT, v1 remains the newest and can run. After a stop, only v2 can run when the service returns, with no further write needed.

### Default and paused submissions

- **Given** a story with a valid edit.
- **When** it is submitted by default, then another with `paused:true`.
- **Then** the default version runs immediately, and the paused one is saved without running while the older versions stay ineligible.

### Replay

- **Given** a submitted version that the reader has since paused or resumed.
- **When** the same submission is replayed, including two replays at once.
- **Then** the same version returns, images aren't copied again, no generation repeats, and the later pause or resume stands.

### Old work in flight

Run these separately, because one version can't have a script step and an image draw in flight together:

- **Script step:** v1 has a held script step, and v2 is published. When the step finishes, it saves to v1 only, v2's document is unaffected, and v1 starts nothing further.
- **Image draw:** v1 has a held image draw, and v2 is published. When the draw finishes, the image publishes to v1 only, v2's document is unaffected, and v1 draws nothing further.

### Rows saved before this change

- **Given** a paused child with `revision.handoff` set, saved by an earlier build.
- **When** its submission is replayed, or it is resumed.
- **Then** it runs once, and the handoff flag is cleared.

## Four pools

### Search beside script work

- **Given** a story with candidates and a story waiting for its script.
- **When** a "find more" search is held open and a candidate is chosen.
- **Then** both the other story's script and the chosen story's preparation run while the search is still open, and a second search waits.

### Upgrading a saved search

- **Given** a library with one queued and one interrupted `discover` job saved with `pool='text'`.
- **When** the service starts with the new migration.
- **Then** both searches run and their results reach their stories.

## Checkpoints and receipts

### Only missing work

- **Given** a story with text checkpoints, saved images and a finished image awaiting publication.
- **When** the service restarts, the reader retries, and a caption-only version is submitted.
- **Then** no saved step is paid for again, publication reuses the receipt, and the new version reuses copied images.

### Style edit before the plan

- **Given** a paused 60-frame story with 40 storyboard pages saved.
- **When** only the art style is changed.
- **Then** the preview says saved work is kept, the new version plans only the remaining 20 pages, and it pays for no new outline.
- **And** a paused short story with a saved draft and no storyboard keeps that draft under the same edit.
- **And** changing requirements or frame count instead replans from scratch.

## Failure containment

### One missing session row

- **Given** ready `script`, `discover`, `image` and publication jobs whose session row was deleted by hand.
- **When** another story is created.
- **Then** that story completes, and the problem is logged once per job.

### Delete and restore during a script step

- **Given** a story with a script step in progress.
- **When** the story is deleted, the step finishes, and the story is restored and resumed.
- **Then** no failure appears, the paid step doesn't run again, and the story completes without a retry.
- **And** a step that genuinely failed during deletion stays visible and can be retried after restore.

## Review-failure flow

### Repeated manual corrections

- **Given** a story blocked by review.
- **When** an issue is corrected with **保存并重新审核**, the new version is blocked too, and it is corrected again.
- **Then** only the newest version can run and appears on the shelf, each earlier version reads as paused and is unchanged, and no image is drawn before a review passes.

### Paused story

- **Given** a story that is both blocked and paused.
- **When** **继续自动修复** is viewed, then a correction is saved through the timeline's 修改分镜, because an issue's 手动修改 isn't offered on the paused sheet.
- **Then** the repair button is disabled while paused. After saving, the parent reads as paused and the new version runs its review.

### Unchanged actions

- **Given** a blocked newest version.
- **When** the reader chooses **继续自动修复**, or **跳过问题并绘图**.
- **Then** repair runs up to 20 more rounds and stops early if nothing changes, or drawing starts from the current storyboard. Paid work already saved doesn't run again.

## Optimization

### Stories that can't run

- **Given** 20 paused 80-frame stories, some deleted, plus superseded versions whose rows still say `active`.
- **When** the scheduler runs.
- **Then** none of their text, image or search jobs are evaluated, and their publication jobs with finished images still complete.

### Deleted reader-mode story whose row still says active

- **Given** a reader-mode story whose control is `active`, with ready queued `script`, `image` and `discover` jobs, and an `image-publish` job whose image dependency succeeded and whose image file is valid.
- **When** the story is deleted through the library API, its control remains `active` under the existing background-only trigger, and the scheduler runs.
- **Then** `canRun` is never called for its queued text, image or search jobs, no provider call starts, and those jobs use no attempt.
- **And** the publication job still saves the already-paid image to the deleted story without redrawing it.
- **And** unrelated runnable stories and the ready orphaned-job cases from AC18 still reach their normal execution or error handling.

### Unchanged active stories

- **Given** active stories with live viewers, and no change to their saved state.
- **When** the scheduler runs and the viewers renew their leases.
- **Then** no job is rewritten. When a viewer moves to another page, priorities update on the next pass.

### Superseded-input job cleanup

- **Given** an image job running when its story's plan changes.
- **When** that job fails afterward.
- **Then** it is removed and doesn't mark the current version as failed.

### Shelf and opened story

- **Given** a completed story and an unfinished story with saved source text.
- **When** the shelf loads, then each story is opened.
- **Then** the shelf response has no source text, while the source sheet, review tools and PDF/ZIP export work.

### Blocked story that can't load

- **Given** a blocked revision with a reused first image, in the in-app browser with an isolated data directory.
- **When** the shelf loads, only `/api/reader/sessions/:id` is made to fail, the story is opened, and the review notice is followed.
- **Then** the issues and actions appear, the shelf response contains no source text, and **继续自动修复** shows the failure inside the sheet if the session still can't load.

### Review tools rendering

- **Given** a render of `StoryReviewTools`.
- **When** it receives a trimmed shelf row with issues and a story, then a `story:null, sourceReady:true` session.
- **Then** the first shows the tools, and the second renders nothing.

### Expired viewers

- **Given** expired demand rows from past runs and one live viewer.
- **When** a tick runs.
- **Then** the expired rows are gone, and the live viewer's page keeps its priority.

## Unchanged behavior

Run the existing queue, interruption, revision, intake, image recovery and flow-control suites. Paid results are not repeated, blocked reviews still need consent, and publications still drain during shutdown.

## Execution evidence — 2026-11-01

Controlled execution uses real application HTTP handlers, SQLite, filesystem media and stubbed provider adapters. It does not claim paid-provider crash guarantees or a manual device test. Final selected harness run: **250 passed, 0 failed, 0 skipped**; full unit/integration run: **805 passed**. Commands and the default-concurrency Vite hang are recorded in the [plan](../plans/2026/11/01/plan-production-queue-hardening.md#evidence).

| Scenario group | Executed evidence and observed outcome |
|---|---|
| Newest version, deleted newest, stale controls, corrupt rows | [Hardening](../../tests/production-queue-hardening.test.mjs), [paused versions](../../tests/paused-editing-versions.test.mjs) and [revision](../../tests/reader-revisions.test.mjs) harnesses: old starts refused, attempts unchanged, deleted children never promote history, restore/resume works, corrupt unrelated rows stay contained. Two new HTTP races publish a child immediately before resume/background UPDATE: 409, unchanged parent, zero draws. |
| Publication crash, default/paused, concurrent replay, old in-flight work, legacy handoff | Revision and paused-version harnesses exercise failed INSERT, restart after active INSERT, concurrent replay, later controls and version-local media/checkpoint writes. Hardening tests retain legacy handoff recovery. |
| Four pools and upgrade | [Queue](../../tests/production-queue.test.mjs) migration/limit harness and [flow-control](../../tests/story-flow-control.test.mjs) HTTP harness: held search stays open while same-story preparation and another story finish; second search waits. Queued/interrupted migrated searches retain identity and resume. |
| Missing work and pre-plan style edits | Revision, hardening, [review](../../tests/storyboard-review.test.mjs), [production](../../tests/reader-production.test.mjs), [generation](../../tests/reader-generation.test.mjs) and [local-image](../../tests/local-image-batches.test.mjs) harnesses: checkpoint/receipt reuse, 40/60 storyboard and short-draft preservation, requirement/count reset, correct next saved step and no repeated saved text/image charge. |
| Missing session; deletion during successful/failed script | Hardening and [interruption](../../tests/queue-interruption.test.mjs) harnesses: all four orphan kinds log once without stopping valid work; restored saved steps continue without replay, genuine failures remain retryable. |
| Manual correction, paused review, continue/skip | Flow-control, paused-version, revision and review harnesses: repeated correction leaves newest eligible, paused actions stay disabled, default corrected child reviews, repair cap/no-op checkpoints and explicit override remain intact. |
| Candidate filtering, warm cost, renewal, late failure, expiry | Hardening harness plus recorded five-warm-pass cost probe: no evaluation of ineligible jobs, paid publication retained, zero unchanged upserts, late obsolete failure removed, only expired demand deleted. AC21/22 numeric targets passed. |
| Trimmed shelf and actual opened source/export | Actual Reader in the in-app browser, isolated fixture: shelf had empty source text/no original with issues retained; opened source displayed 73 saved characters. ZIP 12,416 bytes unpacked to `图片/01.webp`, `图片/02.webp`, `分镜.md`, `故事.json`; PDF 187,029 bytes began `%PDF-`. |
| Blocked first-image story fails to load | Intercepted only full-session GET with 503; normal browser clicks opened shelf card, review notice and issues/actions, then showed the controlled retry error inside the sheet. |
| Blocked story with no image fails to load | Normal browser clicks showed the controlled load error; clicking the card again increased observed failed GET requests from 4 to 5. |
| Review tools render | [UI render harness](../../tests/storyboard-ui.test.mjs): trimmed first-image row retains issues/tools; `story:null, sourceReady:true` renders an empty string; paused repair is disabled. |

Browser interactions were automated normal clicks on a fresh visible tab; they were not manual phone/desktop testing. The initial hidden tab's synthetic clicks were superseded by this execution. Ancillary production/progress writes received fixture-only proxy-origin 403 responses; mutating production/revision/review routes were verified through the controlled HTTP harnesses, not claimed as browser-write evidence.
