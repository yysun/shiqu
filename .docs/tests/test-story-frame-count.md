# Story frame count E2E — revised detail → recommendation → count → storyboard

Use real provider adapters with controlled model responses, real temporary SQLite/FileMedia and REST. No live inference or personal data. Prefer in-app browser; if its tool gate persists, disclose and use a separate Playwright test session.

1. New UI defaults to 适中 and offers 简短/详细; no fixed count presets or manual count before recommendation. Old saved numeric preferences do not skip this flow. Each detail reaches recommendation and plan prompts, with no 30–60 instruction.
2. Each provider: create a new detail-enabled session; first advance saves verified original and count/reason, with zero plan/image requests. Repeated advance waits, remains idle and not complete. Restart reopens exact suggestion/original. A source failure returns recoverable failed state and makes no recommendation/plan/image request; invalid recommendations fail before planning.
3. Confirm count via owner-scoped REST. Reject 0/61/fraction/string/null, wrong owner, missing recommendation, running checkpoint. Same count confirmation is idempotent; differing/concurrent choices cannot overwrite an accepted count. Only after confirm can a plan be requested, with exact chosen length and same original/detail. Restart/lost response reuses checkpoints. Invalid plan count fails before images.
4. Browser at390px: choose story/detail, request recommendation, see reason and count; slider and number sync at1/60 and keyboard adjustment, 1 shows 单幅概述, restore recommended count. Confirm starts generation with locked controls and exact count. A second pending recommendation can be closed and reopened from shelf/reload with no repeat provider call. Inspect screen/focus/overflow, error/retry and no extra modal.
5. Existing numeric8/10/12 and auto sessions resume directly from saved plan with no recommendation. Retain1/60 reading/batches/media/events/progress/restart regression tests, provider auth and source-isolation behavior.

Record evidence and limits in current plan/delivery document; controlled results do not establish live-model narrative quality.
