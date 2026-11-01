# Extract stories from selected chapters

## Summary

Chapter selection now uses native checkboxes (up to 24 chapters) and a selected count, without a selected stack. Starting extraction creates a resumable discovery task. The LLM receives only the selected chapters in book order; the reader chooses an extracted story before production preparation. Named Liaozhai stories and Shishuo anecdotes keep direct preparation.

Verified extraction results persist in a shared disk cache keyed by canonical chapter scope, edition, theme and model settings. New tasks reuse results after restart and regardless of checkbox click order. Find-more retains the scope and excludes already offered stories. Existing source verification and final production confirmation remain enforced.

The prior authorized simplified/traditional multiword full-text search changes are included in the implementation milestone. Contents responses still contain short previews only. No migration, new dependency, paid verification or packaging.

## Verification

Source milestones: `16d4575` and `6b0ed83`. Typecheck/lint/diff-check passed; focused 13/13 and final full 728/728 passed under Node 24.22.1 / pnpm 11.25.0 with two concurrent files. All four E2E scenarios passed using isolated SQLite/media and controlled providers. Temporary preview stopped, verification tab closed and viewport reset; user's port 3000 tab preserved.

## Notes

Chapters containing isolated defects may be scanned; each extracted candidate must independently satisfy existing provenance, quality and token checks. Explicit chapter scopes cannot enter the legacy non-intake creation path. Delivery is committed locally; no push was requested.

## Final VR (verbatim)

VR passed: all acceptance criteria complete.

VR risk: non-low — persisted discovery scopes, source provenance, shared caching and production gates.
VR review round: 2; reviewer: reused.

1. **Complete — chapter multiselect.** Native checkboxes support up to 24 chapters, retain selections through filtering, and show a count without a selected stack. IAB checks cover deselection, keyboard Space, book/mode resets and a 390px layout without horizontal overflow. Named stories retain direct selection.
2. **Complete — extraction before preparation.** Selecting chapters creates a discovery task and candidate list. Controlled IAB counters show discovery 1, recommendation 0, storyboard 0 and image 0 before candidate choice. Choosing a story reaches count/production confirmation without starting storyboard or images.
3. **Complete — exact source scope.** Provider input contains only selected chapters 70/71 in canonical book order with the original edition and unit IDs. Tests reject out-of-scope model receipts and verify cross-chapter originals. Reload, restart and find-more retain the selected scope; explicit-scope caches remain distinct from whole-book discovery.
4. **Complete — validation and replay.** API tests reject empty, excessive, duplicate, forged, stale, cross-book, nonchapter and mixed scopes before insertion. Omitted/false intake cannot bypass validation. Reversed chapter click order replays canonically without duplicate tasks.
5. **Complete — source-quality boundaries.** Chapters with isolated defects remain available for scanning, while extracted candidates still pass existing source-quality, range and token checks. Contents metadata retains short previews and does not expose full chapter bodies.
6. **Complete — compatibility and search.** Simplified/traditional, full-width and multiword full-text search remain covered. Existing direct-story tasks, named Liaozhai/Shishuo choices and theme discovery retain their supported paths. Verification used isolated data and controlled providers without paid inference or packaging.
7. **Complete — persistent extraction cache.** A fresh task after application restart and replacement of the discovery wrapper reuses disk-backed stories without another LLM call. Reversed chapter order shares the canonical cache. Find-more excludes previously offered stories and continues within the same scope.

All AP tasks and all four E2E scenarios are complete. Final Node 24.22.1 / pnpm 11.25.0 unit/integration verification passed **728/728**, with zero failures, cancellations or skips in 87.9 seconds. Terminal evidence: `.data/evidence/selected-chapter-extraction/full-tests.log`. Typecheck, lint and diff checks passed.

AR round 2 and CR round 2 remain valid for source commits `16d4575` and `6b0ed83`. No remaining acceptance or review gaps.
