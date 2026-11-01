# Story or chapter picker

## Summary

Selecting a bundled book now lists its stories or chapters immediately. Readers can search titles and snippets across simplified/traditional characters and punctuation widths, select a verified original, and prepare production without AI discovery. Theme discovery remains available. Liaozhai exposes named stories, Shishuo exposes individual anecdotes, and other books expose parsed chapters. Unavailable source ranges remain visible with a reason.

Direct choices use canonical server-derived titles/ranges, persist one selected candidate and original, and retain the final production confirmation gate. Book/mode changes clear stale choices, and delayed requests cannot restore another book's list.

## Verification

Node 24.22.1 / pnpm 11.25.0: typecheck, lint, diff check, focused tests 4/4 and complete unit/integration suite 718/718 passed. All four E2E scenarios passed in the in-app browser with isolated SQLite/media and controlled generation. Phone width 390px had no horizontal overflow. Independent AR2 and CR2 passed.

The first restricted full run encountered localhost restrictions. The unrestricted default-concurrency run passed 716/717 with one 80-frame production deadline under load; that case passed alone in 4.49s. Final full execution with two concurrent files passed every test in 89.8s. No test timeout or generation logic was weakened. Evidence log: `.data/evidence/story-chapter-picker/full-tests.log`.

## Notes

Implementation milestones: `0376ba4`, `d240e9f`. No schema/dependency changes, paid inference, Docker build or desktop packaging. Temporary preview stopped; viewport reset and verification tabs closed. Existing user preview preserved. Original source-quality and token limits still restrict direct choices.

## Final VR (verbatim)

VR passed: all acceptance criteria complete.

VR risk: non-low — source provenance, persistent intake identity and production confirmation gates.
VR review round: 2; reviewer: reused.

1. **Complete — book contents and search.** Book selection defaults to direct contents. In-app browser checks cover searchable titles/context, simplified/traditional text, punctuation widths, loading, retry and empty results.
2. **Complete — precise source boundaries.** Integration coverage verifies Liaozhai named-story ranges, all 1,129 Shishuo anecdotes and chapter receipts. Existing resolver quality/token gates remain authoritative; browser verification confirms 166 unavailable Taiping chapters are disabled.
3. **Complete — durable, gated preparation.** Direct selection stores the canonical candidate and original, then reaches production confirmation. Controlled browser counters show discovery 0, recommendation 1, storyboard 0 and image 0. Integration tests verify exact source, replay without duplication, conflicting replay rejection and persistence across restart.
4. **Complete — selection lifecycle and compatibility.** Browser checks verify book/mode clearing, discarded delayed responses, theme discovery and custom-book theme-only behavior. Restored preferences clear obsolete source selections.
5. **Complete — validation and isolated verification.** Integration tests reject forged, stale, cross-book and non-catalog receipts before insertion. Verification uses isolated SQLite/media and controlled providers, with no paid inference or packaging.

All AP tasks are complete. Node 24.22.1 / pnpm 11.25.0 full-suite verification passed **718/718**, with zero failures, cancellations or skips; log: `.data/evidence/story-chapter-picker/full-tests.log`. Typecheck, lint and all four E2E scenarios passed.

AR round 2 and CR round 2 remain valid for source commits `0376ba4` and `d240e9f`. The subsequent user-guide correction accurately describes the default contents path and current confirmation controls; no additional findings.
