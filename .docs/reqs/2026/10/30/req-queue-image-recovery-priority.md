# Queue image recovery and reading priority

Two gaps remain from the queue review. A story whose saved image file is lost can never finish, because retry keeps reusing the paid result that points at the missing file. And since every story became background work, the page someone is reading has no effect on what gets drawn next.

## Acceptance criteria

### Lost image recovery

- [x] When a generated image file is missing or unreadable as an image at publication, the story fails with a message saying a retry will redraw that page and may charge again, and `retryMayCharge` is true.
- [x] An explicit retry then redraws that page and the story can complete. No redraw happens without an explicit retry.
- [x] When the saved first image, which later pages use as their reference, is lost, the later page fails before any provider call with the same message. An explicit retry redraws the first image, then the later pages continue. Other saved pages are not redrawn.
- [x] If the file is readable again by the time of the retry, the retry publishes it without a provider call.
- [x] A transient read failure at publication behaves as it does today: `retryMayCharge` is false and a retry makes no provider call.

### Reading priority

- [x] While a reader has an active story open, that story's first image, current page and the six pages after it are drawn ahead of other stories' work and of its own later pages.
- [x] Moving to another page changes which pages come first within a few seconds, without cancelling work already running.
- [x] Closing the story, or losing the connection, returns it to normal background order. The story keeps generating.
- [x] Viewing a failed, paused, stopped, completed or frame-count-waiting story sends no demand and can never start or retry paid work. A failed priority request does not interrupt status updates.
- [x] Without a reader, stories keep today's order by page number, so a new story's early pages still come before an older story's later pages.

## Constraints

- No schema migration. Preserve owner scope, deletion disarm, pause and stop, the replay cap, and global worker limits.
- Existing messages and behaviour for real provider failures do not change.
- Verify with controlled providers and isolated data only: no paid calls, Docker builds or desktop packaging.

## Non-goals

- Detecting or repairing lost files for pages already published, other than the first image while a later page needs it.
- Automatic redraws, or redrawing completed stories.
- Removing legacy viewer-demand code, tick cost reduction, or job and artifact cleanup.

Verified 2026-10-30: VR passed all ten criteria. See `.docs/done/2026/10/30/queue-image-recovery-priority.md`.
