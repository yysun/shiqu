# Production queue hardening

## Problem

A review of story creation, editing and queue management reproduced these defects on temporary databases with a stubbed provider:

- A superseded version can keep drawing, and spending, while hidden from the shelf. Only the UI and the resume path try to prevent this.
- A new version is published and its parent paused in separate writes, so a crash can leave the parent running.
- One story search blocks all other text work, including the same story's preparation.
- A style-only edit before the plan exists discards paid storyboard pages.
- One job whose session row is missing stops scheduling for every story.
- Deleting a story during a script step, then restoring it, leaves a misleading failure that resume cannot clear.
- One corrupt saved row breaks revisions for every story.
- Scheduling cost grows with stories that cannot run, the shelf response repeats full source text on every poll, and expired viewer rows are never removed.

## Outcome

1. The newest version is the only version that can start generation work, and this is checked when work actually starts, not only in the UI or the resume path.
2. Publishing a new version and retiring the old one happen atomically. Old requests that have already started may still save, but no new work starts for the old version.
3. Search, text, image and local publication run in four independent pools.
4. Saved stage checkpoints and image generation receipts are kept, and only missing work is done.
5. Last of all, scheduling, the shelf response and expired viewer rows are optimized.

## Acceptance criteria

### Newest version only

- [ ] AC1: A version with a newer version in its family starts no new text step, image draw or source lookup, whichever route reaches it: the queue, `POST /advance`, `POST /production`, `POST /source`, recovery of an interrupted job, or a row whose control says `active`. A text step that already holds its lock may finish, including any calls within that step.
- [ ] AC2: If a newer version appears after a job passes its first eligibility check, but before an image's provider call or a text step's lock, that work doesn't start and the job uses no attempt.
- [ ] AC3: Deleting the newest version doesn't make an older version eligible. Restoring and resuming the newest version works.
- [ ] AC4: A superseded unfinished version is reported as paused, never as running or queued. Its saved document is readable as before.
- [ ] AC5: Resuming, or skipping review on, a superseded version returns 409 with a message pointing to the newest version, and changes nothing. Retrying one starts no work. The reader sees that it's an old version where the resume control would be, rather than a button that can only fail.
- [ ] AC6: A corrupt saved row doesn't stop eligibility checks, scheduling or revisions for other stories in the reader API.

### Atomic publication

- [ ] AC7: One database write publishes a new version and makes every older version ineligible. There is no moment, including after a crash, when both can start work.
- [ ] AC8: A default submission starts running with no second write. A `paused:true` submission is saved without running.
- [ ] AC9: Replaying the same submission returns the same version with no second copy of images or generation, and doesn't override a later pause or resume.
- [ ] AC10: An old request already in flight when a new version is published can save its result to the old version. A finished old image can still publish, and neither reaches the new version.
- [ ] AC11: A row saved earlier as a paused child awaiting handoff can still be recovered by replaying its submission, or by resuming it.

### Four pools

- [ ] AC12: While a search runs, another story's script step and the same story's preparation both start and can finish.
- [ ] AC13: No more than one search runs at a time, at most one non-search text step runs at a time, and the image and local limits are unchanged.
- [ ] AC14: A search saved before this change, whether queued or interrupted, still runs after upgrade.

### Checkpoints and receipts

- [ ] AC15: Paid results already saved are not paid for again after a retry, restart, crash replay, or job reprocessing. This covers text checkpoints, image receipts, publication retries and images reused by a new version.
- [ ] AC16: A style-only edit made before the plan exists keeps the saved storyboard pages or draft, including a short story that has a draft and no storyboard. The new version doesn't pay for that work again, and the edit preview says so.
- [ ] AC17: Requirement and frame-count edits before the plan exists still replan from scratch.

### Failure containment

- [ ] AC18: A queued text, search, image or publication job whose session row is missing doesn't stop other stories from running, and the failure is logged once for that job.
- [ ] AC19: Deleting a story during a script step and restoring it shows no failure. After resume it finishes without repeating the paid step or needing a retry. A step that genuinely failed stays visible and retryable.

### Review-failure flow

- [ ] AC20: The flow in `8924e5d` works on the newest version as it did before this change: continuing automatic repair, manual edits from an issue, saving and re-reviewing, and skipping review to draw. After repeated corrections, only the newest version can run.

### Optimization

- [ ] AC21: A scheduling pass doesn't evaluate queued text, image or search jobs of paused, deleted or superseded stories, or queued text and image jobs of stories already marked failed. Deletion is determined by the deletion marker, including reader-mode rows whose control still says `active`. Their publication jobs still run. With 20 paused 80-frame stories, a warm pass runs at most 60 statements and takes at most 10% of the baseline time.
- [ ] AC22: A scheduling pass doesn't rewrite jobs for an active story whose saved state and viewers haven't changed, and a viewer's renewal alone doesn't count as a change. With 20 unchanged active 80-frame stories, a warm pass runs at most 25% of the baseline statements.
- [ ] AC23: Superseded-input jobs that are queued or failed are still removed, including a job that fails after its story has already changed.
- [ ] AC24: The shelf list no longer includes full source text. The source sheet and exports still work once a story is opened. When a blocked story with a saved first frame is opened in the reader, its review notice and tools stay available from shelf data even if its full session fails to load. A blocked story with no images behaves as it does today: a load failure shows a message, and tapping the card retries.
- [ ] AC25: Expired viewer rows are removed automatically, and live viewers are unaffected.

## Constraints

- This work builds on the review-failure flow with a 20-round repair cap, committed as `8924e5d`.
- No new paid call may start without the fresh demand, durable background intent or explicit retry that the queue already requires.
- Existing libraries upgrade through the existing migration runner. The shelf and desktop rule for which version is newest stays the same.
- Use pnpm, Node 24.22.1 and the existing test fixtures. Do not build Docker images or package the desktop app.

## Non-goals

- Finding 2: whether automatic review may change a reader's manual edits, or redraw beyond the preview. This also applies to **保存并重新审核**: a correction can be replaced by automatic repair, then drawn without asking.
- Finding 4: automatic retry of transient provider failures, and rewording the provider error.
- Finding 11: removing legacy code paths, beyond making them obey the eligibility rule.
- Rewriting the shelf's version query. It is measured but only changes if it remains the main cost.
- Hardening `desktop/library.sql` against corrupt rows.
- Repairing rows already damaged in a live library.
