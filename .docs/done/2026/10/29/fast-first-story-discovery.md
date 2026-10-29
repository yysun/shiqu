# Faster first story and visible reading feedback

## Summary

Uncached discovery now reads small ordered blocks and requests one complete story first. The picker immediately brings a book animation, chapter scope and placeholder cards into view, then exposes the verified result. Finding more preserves existing selection and focus. Selected-story art recommendations run separately and preserve manual choices.

Compatible old story pools and cross-chapter evidence migrate without inference or skipped source units. A concurrent migration race is covered by a held-read regression. Implementation commits: `2906188`, `5599bf1`, `e98f064`; final delivery records verification against the updated book library.

## Verification

Node 24.22.1 / pnpm 11.25.0: 275 tests, typecheck and lint pass. Actual IAB checks cover desktop/mobile, reduced motion, loading, cancellation, deferred-art errors and selection races. Real Codex subscription discovery returned a verified Honglou story in 21.656 seconds with one 9,124-token estimated input; cache repeat took 38 ms. Existing three-story cache reused with zero inference. All 24 updated books retain ordered coverage within two chapters and 12k body tokens per block.

## Notes

Smaller blocks can increase calls for sparse themes and long cross-chapter events. The timing is one measured sample. No Docker/desktop packaging, push, dependency changes, storyboard or image production. Parallel source-publication and shelf-generation changes remain outside this story.

## Final VR

VR passed: all acceptance criteria complete.

| Acceptance criterion | Status | Evidence |
|---|---|---|
| Small ordered reading blocks, complete coverage, lossless oversized-chapter handling | complete | `story-reading-inputs.ts` caps blocks at two chapters and 12k body tokens; whole mode requires the complete request to fit the small budget. Updated-library audit covers all 24 books: maximum 11,981 body tokens, two chapters, and exhaustive ordered units. Oversized indivisible units fail explicitly without truncation. |
| First verified story returns promptly; subsequent discovery resumes safely | complete | Empty theme pools request one story; later expansions request up to five. Passing regressions cover incomplete-block resume, completed zero-result blocks, invalid/overlapping receipts, no-progress failures, cancellation, shared work and caller exclusions. Real Honglou cold request returned one verified story from chapter 1 in 21.656 seconds. |
| Existing cache results and conservative progress migration | complete | Legacy identity and source checks preserve compatible stories and pending events. Migration uses the old completed cursor, maps coverage conservatively, and rechecks the new cache inside the serialized migration worker. Held-read regression preserves newer state. Existing Honglou cache returned all three stories with zero model calls, mapped cursor 11 and one pending event; overlay verification wrote no existing user data. |
| Visible, accessible and honest reading feedback | complete | `StoryReadingState.tsx` and the focus/scroll fix show the book, theme, chapter scope, elapsed time, cancellation and placeholders. Progress remains indeterminate during model work. Actual IAB evidence covers desktop, full panel visibility at 390×844, reduced motion, checking stage, first-result selection, errors and existing-candidate interaction during further discovery. |
| Deferred art recommendations remain optional and safe | complete | Local scan prompt/schema omit art work. Selected verified sources use the separate recommendation endpoint and durable cache. Provider tests and controlled IAB checks establish no request before selection, manual-style and focus preservation, stale-response isolation, explicit application, cached reuse, recoverable failure and generation while art work is pending. |
| Both providers retain source validation and isolation | complete | Codex/Gemini regressions pass for art-free scans and selected-excerpt recommendations. Endpoint/wrapper tests reject missing, stale and cross-book receipts before inference, validate outputs and origins, deduplicate requests and safely report provider errors. |
| Complete verification with measured performance and stated limits | complete | Final Node suite: **275/275 passing** in 26.3 seconds; typecheck and lint passed. All six E2E scenarios have deterministic/state, actual IAB and isolated real-provider evidence. Real sample: 9,124 estimated request tokens, one cold discovery call, 21.656 seconds to first verified story, 38 ms hot cache; separate art request 9.756 seconds. No storyboard/image production or packaging was required. |

Evidence is under `.data/evidence/fast-first-story-discovery/`: `full-tests-final.log`, `typecheck-final.log`, `lint-final.log`, `ui-results.json`, three UI screenshots, `live-results.json`, `legacy-cache-results.json` and `final-books-audit.json`.

The latency measurement establishes feasibility for one Honglou/theme sample, not a fixed response-time guarantee or semantic zero-omission claim. Controlled UI responses verified interaction races separately from live-provider behavior. Native Rust suites are not applicable to this web/server change. All AP tasks are complete, and CR round 3 remains valid.

VR risk: non-low — persistent reading-plan migration, concurrent discovery and asynchronous selection/recommendation behavior.
VR review round: 1; reviewer: reused.

VR passed: all acceptance criteria complete.
