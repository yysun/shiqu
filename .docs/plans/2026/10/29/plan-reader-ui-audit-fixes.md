# Reader UI audit fixes

Git base: `f8a5e66a5891409c745d2c902d91e533dbe3feac`. Include existing uncommitted `ReaderShelf.tsx` and `reader.css` work; exclude the independent root README rewrite.

Risk: non-low — recovery spans owner-scoped API metadata, frontend library reconciliation and all four screens. Restoration must never resume production or discard reading checkpoints.

## Decisions

Keep the existing DELETE and restore POST unchanged. Enrich the existing GET deletions response with a title from owner-scoped session/published-story joins. Build a deleted-stories sheet in Me and a shelf Undo notice using the same restoration handler. Refresh generated and published library snapshots after restore without calling `resume`, so no viewer demand or generation starts. A failed refresh remains retryable and must not lose the deleted item recovery entry prematurely.

Generated list snapshots are limited to 80; passively fetch and merge the restored generated session directly so older stories return too. Include deletion kind alongside title to select the correct passive reload. Published metadata is joined only for published stories; generated metadata requires matching ownership.

Use truthful library labels rather than inventing read-history tracking. Feed unfiltered readable and pending stories to the shelf, then apply favorite/search filters together so the result count has a reliable denominator. Shared typography, colors and hit-area rules repair the four screens while preserving the agreed compact/full-width structures. Shorten Home's illustration and promote the existing new-story action. Remove the disabled share preview.

Viewer refinement requested during acceptance: normal narration becomes 22px desktop/21px phone, line-height 1.65; larger-text preference uses 28px/26px. This changes the existing typography scale only, with no new architecture or persistence contract. Recheck both viewer sizes and request targeted CR before VR.

## Executable tasks

- [x] Extend `ReaderRepository.deletions` with owner-scoped titles; add integration regression coverage for generated/published titles, foreign ownership, repeat restore, checkpoint/favorite preservation and no production calls.
- [x] Add a passive library refresh in `useStoryGeneration`; connect Undo and a deleted-stories sheet from Me in `Reader.tsx`, including loading, empty and retry/error states.
- [x] Correct shelf/Me labels and unfiltered totals, combine favorite/search filtering, and provide explicit filter reset in `ReaderShelf.tsx`.
- [x] Apply shared readable metadata and 44px tools in `reader.css`, preserving compact/full-width layout; shorten Home hero/promote its new-story action and remove disabled Reader sharing.
- [x] Apply the requested viewer narration refinement and verify normal 22px/21px text at desktop/phone sizes, retaining the optional 28px/26px scale.
- [x] Run typecheck, lint and all applicable Node unit/integration tests; run the in-app scenarios in `.docs/tests/test-reader-ui-audit-fixes.md` and record evidence.

## Validation and risks

Verify the initial Home viewport, single/two-column shelf cards, long book names, Me and Reader/ending. Use a reversible deletion and restore of an existing story without opening unfinished stories; compare its database checkpoint before/after. Do not reset historical deleted items or favorites. Exercise reload recovery and unsuccessful restore through integration fixtures. Use browser viewport overrides only for the explicit responsive verification, then restore the existing viewport. No bundling commands.

Milestone commits and verification results will be recorded here as completed.

Implementation milestone: `6ceda2a` (`feat(reader): address four-page UI audit findings`). Includes the existing compact-card work. Focused tests, non-bundling suite, browser rendering, typecheck and lint passed before the milestone; independent CR follows.

AR passed: no blocking architecture flaws

AR risk: non-low — restoration crosses owner-scoped persistence metadata and frontend library reconciliation.
AR review round: 1; reviewer: new

Independent review inspected the source and scenarios without running tests. Its implementation guidance on owner joins, both frontend suppression sets, idempotent retry after failed refresh and the 80-session limit is incorporated above.

## Implementation evidence

Focused recovery/generation/favorite tests: 40/40 passed. Typecheck, ESLint and PostCSS parsing pass. The initial CSS removal left one dangling selector; browser verification exposed it, and the corrected stylesheet passes PostCSS and Vite rendering.

The full non-bundling test set (31 named files) passes 228/228. A sandboxed attempt could not open loopback test ports; the broad elevated command was rejected because its file glob included a bundling test. The approved replacement excludes the entire `desktop-lite.test.mjs` file, whose parent-EOF scenario invokes esbuild. No bundling test or packaging command ran.

Initial in-app checks pass at 649×853 and 390×844: Home actions fit, filters show 1/20 and 0/20 and clear to 20, Me labels 20 library stories/1 favorite, and the ending retains working actions without sharing placeholders. Compact cards retain their toolbar/footer; full-width cards retain cover/details/corner tools. The viewport override has been reset.

Live pending-story deletion/Undo and deletion/reload/Me restoration both succeeded. Read-only comparison confirms its entire session row, favorite/page values, zero production jobs and all original deletion markers exactly match the pre-check baseline. Pending restore attempts remain locally retryable until all passive snapshots load, including lost POST responses; reopening/reloading the deleted list retries these idempotent operations before replacing recovery records.

Screenshots are under `/Users/esun/.codex/visualizations/2026/10/29/01a187ff-2868-7570-999c-d29df8f6d8bb/fixed-*.jpg`.

## Review and verification

CR passed: no major findings

CR risk: non-low — recovery spans owner-scoped metadata, frontend suppression/reconciliation, and shared UI changes.
CR review round: 1; reviewer: reused

Independent CR covered the entire scoped diff since `f8a5e66`, the requirements/plan/scenarios, recovery tests and screenshots. Source remained unchanged after milestone `6ceda2a`. Failed-refresh/lost-response frontend handling was assessed by source inspection; live evidence covers successful Undo and reload/Me restoration.

TT: 228/228 tests passed in the 31 non-bundling files; all applicable changed behavior is covered. The 7 native-runtime scenarios in `desktop-lite.test.mjs` were excluded because that file contains a bundling scenario and automatic approval required excluding it entirely. Typecheck, ESLint, PostCSS parsing and whitespace checks pass. No required suite is absent; no package or Docker build was run.

ET: scenarios 1–6 passed in the existing in-app browser, including both specified viewport sizes, source/preferences/ending, explicit filter resets and two restoration paths. Evidence and limitations are recorded in `.docs/tests/test-reader-ui-audit-fixes.md`. Shared shelf metadata contrast is 5.40:1 on tag backgrounds and 5.70:1 on the card background. No physical-device or packaged-app claim is made.
