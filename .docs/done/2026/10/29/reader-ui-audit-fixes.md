# Reader UI audit fixes

## Summary

Home, Bookshelf, Reader and Me now share readable metadata and larger tool targets. Home exposes resume and new-story actions in the initial viewport. Shelf filters show matched/total counts with a reset, and library totals include unfinished stories without calling them read history. Compact cards retain the book-name/tools row beneath the image and combined reading footer; full-width cards retain their established structure.

Reader deletion now offers Undo and a durable recovery sheet in Me, using existing owner-scoped tombstones and restore routes. Passive snapshot refresh preserves checkpoints and does not resume generation. Failed or uncertain restoration attempts remain retryable. The ending no longer promotes unavailable sharing actions.

Normal narration is reduced to 22px desktop/21px phone at 1.65 line height. Optional larger narration remains 28px/26px; the stored preference was not changed.

## Verification

Node 24.22.1 / pnpm 11.25.0. Focused recovery/generation/favorite checks pass 40/40; the complete non-bundling test selection passes 228/228 across 31 named files. Typecheck, ESLint, PostCSS parsing and whitespace checks pass. Independent CR round two passed. In-app scenarios cover all four pages at 649×853 and 390×844, source/preferences/ending, filter resets, Undo and recovery after reload. Exact SQLite comparison preserves the tested story's whole session row, favorite/progress values, job records and the original deletion markers.

Execution details and screenshot paths: [.docs/tests/test-reader-ui-audit-fixes.md](../../../../tests/test-reader-ui-audit-fixes.md). Local test log: `.data/evidence/reader-ui-audit-fixes/node-tests.log`.

## Notes

- Source milestones: `6ceda2a` (four-page audit fixes) and `2f78624` (viewer narration refinement). No push or packaging command was run.
- Automatic approval rejected the broad test command because its glob included a file containing bundling. The approved replacement explicitly excluded the whole `desktop-lite.test.mjs` file; its seven unrelated native-runtime scenarios were not run. No bundling scenario ran.
- The initial stylesheet removal left a dangling selector. In-app verification exposed it; the corrected stylesheet passes PostCSS and Vite rendering.
- No migration, import-script change, permanent deletion or provider/queue redesign. The separate root README rewrite remains in the working tree.

## Final acceptance review

VR passed: all acceptance criteria complete

| Criterion | Status | Evidence |
|---|---|---|
| Readable metadata across Home, Bookshelf, Reader and Me | Complete | Shared metadata rules use 12px text and stronger foreground colors. Recorded shelf contrast is 5.40:1 on tag backgrounds and 5.70:1 on card backgrounds. Phone screenshots show readable shelf labels, Me statistics and shaded Reader metadata. |
| Smaller normal narration with optional larger text | Complete | Rendered measurements confirm 22px/36.3px desktop narration and 21px/34.65px phone narration. CSS retains the optional 28px desktop/26px phone scale. Refreshed Reader screenshots show more artwork without control overlap; the stored preference was unchanged. |
| Home exposes resume and new-story actions initially | Complete | In-app checks at 649×853 and 390×844 show both explicit actions above fixed navigation. At the original viewport the new-story button ends at y=616.22. The chooser opens and closes without requesting suggestions. |
| Undo and durable deleted-story recovery preserve data without starting production | Complete | Shelf Undo and delete/reload/Me restoration succeeded for《裴度还带》, with counts moving 20→19→20. Read-only comparison confirms its entire session row, progress/favorite values, zero production jobs and original deletion markers match the baseline. Me’s recovery sheet shows titles, deletion dates and Restore controls. Owner-scoped integration fixtures cover generated/published recovery, rejected foreign access, idempotence and passive access beyond the 80-session list cap. |
| Bookshelf and Me describe totals truthfully | Complete | Bookshelf now says「全部故事」and Me reports 20「书架故事」and 1「已收藏」, matching the visible readable and unfinished entries. Counts no longer claim all stored entries have been read. |
| Matching, independent 44×44 tool targets | Complete | Recorded DOM measurements show 44×44 favorite/delete controls with matching `rgb(82,103,71)` colors. Screenshots show separate tool targets, outside the reading buttons. |
| Explicit matched/total filter counts and reset | Complete | Browser checks show title search 1/20, impossible search 0/20 and favorite filtering 1/20.「清除筛选」restores all 20 stories. Test filters were cleared afterward. |
| Story ending contains available actions only | Complete | The ending retains next-story, previous/restart, PDF, PNG and source actions. Disabled sharing controls and their availability placeholder are removed from source and the refreshed ending screenshot. |
| Preserve compact and full-width card structures | Complete | Compact screenshots show the book name and right-aligned tools together beneath the image, with progress and Continue on one row. Full-width screenshots retain side-by-side cover/details, corner tools and the existing separate reading-detail structure. |
| Complete verification without bundling or unrelated changes | Complete | All AP tasks are complete. Recorded Node execution passes 228/228 tests across 31 named files; typecheck, lint, PostCSS and whitespace checks pass. In-app scenarios 1–6 cover all four screens, both viewport sizes and both recovery paths. CR round two passed through `2f78624`; implementation source is unchanged since that review. No desktop preparation, bundle, Docker build, push or paid generation was performed. The unrelated README rewrite remains unstaged. |

Evidence limits: frontend failed-refresh and lost-response handling was reviewed in source; live verification covers successful Undo and reload/Me recovery. Server failure and ownership boundaries are covered by fixtures. Larger-text CSS was preserved without changing the user’s stored preference. No physical-phone, packaged-application or complete accessibility-conformance claim is made. The entire `desktop-lite.test.mjs` file was excluded because it includes bundling; its seven unrelated native-runtime scenarios were not run.

The viewport override was reset and the relevant preview retained. No files were edited or suites rerun during this acceptance review. DD is not a prerequisite for this verdict.

VR risk: non-low — owner-scoped recovery metadata, frontend library reconciliation and shared presentation affect all four screens.
VR review round: 1; reviewer: reused
