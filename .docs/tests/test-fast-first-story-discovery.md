# E2E: fast-first-story-discovery

1. Cold discovery: with no cache for a chosen local book/theme, open the picker, choose a book/theme and start discovery. Immediately observe the book animation, placeholders, theme/book text, elapsed time and cancel action. Observe actual chapter labels from server progress. In-flight progress remains indeterminate; first verified result replaces placeholders and is selectable. Check mobile and reduced-motion states.
2. Continue and resume: choose "找更多/换一批" after the first story. Existing candidates remain usable while searching. New results exclude prior sources; completed/unfinished boundaries and cross-chapter pending evidence survive a cancelled/restarted request. No fake completion percentage.
3. Warm and legacy cache: load the existing Honglou 爱情与错过 cache under the previous plan. Verify the three already-found stories return without inference, then repeat with the new cache. Verify model/edition changes never import incompatible results.
4. Deferred art: no recommendation request is sent before choosing a story. Selecting a local story starts one recommendation request using its verified source. Manual styles and generation remain available while pending; success explains the style and requires explicit application, failures allow retry. Change selection during a held response and confirm it does not affect the new story. Existing recommendations need no new call.
5. Errors/cancel: cancel a held cold request and verify the panel disappears. A simulated discovery failure releases the picker and offers retry; an art failure does not remove the story or disable generation.
6. Real provider: use an isolated cache directory and current subscription provider for one cold/hot request on a local book/theme. Record actual first-request chapter range, input size, request count, time to verified story, hot-cache time, and a selected-source art result. Do not produce a storyboard/image or touch existing reader exclusions.

Browser verification uses deterministic held responses to inspect in-flight UI and races; real requests establish provider feasibility separately. Screenshots and command evidence live in `.data/evidence/fast-first-story-discovery/`. If IAB is disabled, disclose the supported test-browser fallback and do not claim its state is the user's page.

## Execution — 2026-10-29

All six scenarios passed against the updated books. IAB was available on resume and used directly; no separate Playwright session was needed. Controlled responses exposed loading and failure/race states without inference, while isolated subscription requests established real-provider feasibility.

| Scenario | Evidence | Result |
| --- | --- | --- |
| Cold visible state, mobile, reduced motion, verified first result | `ui-results.json`, loading desktop/mobile PNGs, `live-results.json` | passed |
| Continue, exclusions, cancellation, persisted resume, pending evidence | IAB checks plus discovery-cache and fast-first-story regressions in `full-tests-final.log` | passed |
| Existing legacy results and version/model isolation | `legacy-cache-results.json`, migration/namespace regressions | passed; three stories, zero model calls |
| Deferred art, stale responses, manual style/focus, cache, errors/retry | `ui-results.json`, `deferred-art.png`, provider/endpoint regressions, live selected-source art | passed |
| Cancel/error releases picker; generation remains available | IAB controlled discovery/art/session responses; no real story/image production | passed |
| Real cold/hot discovery and art | `live-results.json` | passed; 21.656 s cold / 38 ms hot; separate art 9.756 s |

Files above are in `.data/evidence/fast-first-story-discovery/`. Temporary network, viewport/media and test-history overrides were cleared. Latency is one measured book/theme sample, not a guaranteed upper bound.
