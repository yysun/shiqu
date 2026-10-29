# Plan: fast-first-story-discovery

Git base: `6a3496e`. Risk: non-low; reading-plan/cache compatibility, provider contracts, async selection and user-visible progress.

Use chapter-aware 12k-token blocks capped at two chapter labels. Request one story for an empty theme pool; later expansions retain the existing maximum of five. Maintain complete ordered unit coverage and cross-chapter pending references. Keep a narrowly scoped reader for the previous plan/key format to migrate existing state; map the old completed frontier to the containing new block conservatively, retaining verified stories and pending evidence. Do not overwrite or delete old documents.

Use a separate scan schema/prompt without art instructions, while keeping the old contract available only for legacy cache identity and compatibility. Selected-story art recommendations use a dedicated validated local-source endpoint, the current provider, and the existing cache for deduplication/reuse. The client treats recommendations as optional assistance and never overwrites a manual choice on an asynchronous response.

- [x] First SS probe: inspect actual Honglou chapter sizes, existing cache/manifest compatibility, and available browser control. Check that first blocks can be materially smaller; if stable units exceed the budget, choose an explicit lossless boundary policy before proceeding. Record feasible runtime evidence without claiming semantic or latency guarantees.
- [x] Implement small ordered reading blocks, legacy progress migration, first-story request sizing, chapter/stage progress metadata, and regressions for coverage, pending evidence, cache reuse, cancellation and concurrent readers.
- [x] Implement deferred verified-source art recommendation across both providers, server route/cache, and client async state; test validation, deduplication, errors, stale selection and manual overrides.
- [x] Implement the accessible reading panel, honest in-flight motion, placeholder cards, reduced motion and mobile layout. Keep cancellation and existing story selection available.
- [x] Update focused discovery/transport/provider regressions and affected docs; run focused checks, then commit the implementation milestone with its validation state.
- [x] Run TT: all applicable Node unit/integration suites, typecheck and lint. Native Rust suites are not applicable to this web/server change.
- [x] Execute `.docs/tests/test-fast-first-story-discovery.md`: controlled browser cases plus real cold/hot discovery and selected-source art checks, without story/image production. Measure first verified story input/time; distinguish test browser from the user's session if IAB is unavailable.

Review/evidence records will be appended here. No dependency change or production build is needed. Smaller blocks can increase model calls and cross-chapter bookkeeping; retry/next remains explicit. Existing high-volume caches require validation once on migration. External/custom sources keep their existing discovery contract.

AR passed: no blocking architecture flaws.
AR risk: non-low — reading-plan migration, provider contracts, concurrent discovery and asynchronous art recommendations.
AR review round: 1; reviewer: new (`review_fast_discovery`).
Review constraints: migrate from old cursor rather than readThrough; incomplete input blocks are not completed progress; guard existing selection/generation against late find-more results; art identity includes source.

Browser probe: IAB remains disabled in Work settings. Controlled browser verification will use the available independent Playwright test surface and will be reported separately from the user's page.

SS probe passed: all 24 books inspected; no source unit exceeds 12k tokens. Honglou chapter 1 is ~7,500 body tokens versus previous first block 44,293; chapter 2 is ~5,974. Evidence: `.data/evidence/fast-first-story-discovery/feasibility.json`. Oversized indivisible units fail explicitly without truncation, matching the existing lossless rule.

SS implementation: small 12k/two-chapter boundaries, one-story bootstrap, legacy migration, actual chapter/checking metadata, deferred cached source-validated art, and reading panel implemented. Focused 38 discovery/transport/art/migration tests pass; typecheck and lint pass. Affected real-library tests also expose concurrent publication-source fixture changes (traditional glyph/unit counts expected before catalog replacement); their changes are preserved and excluded. Story-only verification will distinguish this baseline from our assertions.

Implementation milestone: `2906188` (focused tests/typecheck/lint passed; full TT, ET and acceptance pending). The shared checkout also advanced through unrelated commits `b2becd0` and `6d4921d`; story base remains `6a3496e`. Selected hunks in tests/local-books were staged separately so publication-source assertions remain unstaged. A committed snapshot under `.data/evidence/fast-first-story-discovery/committed-check/` isolates story verification from those in-progress working-tree fixtures.

CR round 1 blocked on a stale migration overwrite race. Fixed in milestone `5599bf1`: recheck the new key inside the migration flight before importing old state. A held-null-read regression proves newer stories and cursor survive. Focused 39/39 tests passed; independent CR round 2 requested. The committed-check snapshot includes both story commits.

CR fixed: migration now rechecks the target cache inside its serialized worker; rerun result passed. CR passed: no major findings. CR risk: non-low — persistent cache migration and concurrent discovery. CR review round: 2; reviewer: reused (`review_fast_discovery`).

Resumed after source replacement delivery `ec20f8d`. Current-tree TT first run: 268/270 pass; two failures are in unrelated in-progress shelf-generation action labels (`查看详情` vs old `继续生成`/`重试生成`) while lib/shelf-generation.ts and its client are edited elsewhere. All book/discovery/provider/migration tests pass against the updated catalog, typecheck and lint pass. Do not alter that parallel work. IAB is available again; ET will use it for visual and interaction verification.

ET found the initial reading panel below the viewport after starting discovery. Fixed the picker to focus/scroll the reading panel on start, and avoid stealing focus when a later batch completes after a story was selected. In-app browser verification at desktop and 390x844: full panel visible; motion disabled under prefers-reduced-motion; progress has no value; chapter/checking labels, cancellation, single-result selection, held find-more, stale art, manual style preservation, art error/retry, explicit apply and recommendation reuse pass. A controlled session-start error proves generation uses the selected source and cancels a pending search without producing a story/image. Temporary fetch overrides/history test entries and viewport/media overrides were cleared. Evidence: ui-results.json and three PNGs under `.data/evidence/fast-first-story-discovery/`.

Real provider ET: isolated Codex subscription 红楼梦/放下执念 cold 21,656ms, one 9,124-estimated-token request (7,692 text chars), one verified story in chapter1; hot cache38ms. Deferred selected-source art 9,756ms; cached recommendation645ms. Existing 爱情与错过 legacy cache returns all3 stories without inference, mapped cursor11 with1pending event; overlay-only migration608ms/hot21ms, zero writes to existing user data. See live-results.json / legacy-cache-results.json.

Visibility/focus milestone `e98f064` verified by controlled IAB ET; typecheck/lint pass. CR passed: no major findings. CR risk: non-low — persistent discovery state and asynchronous picker behavior. CR review round: 3; reviewer: reused. Prior cache/provider/concurrency conclusions remain valid.

Updated-library audit: all24 plans have exhaustive ordered coverage, at most2chapters and at most11,981bodytokens per block. Honglou114blocks, first7,535bodytokens,4,164units fully covered. Evidence: final-books-audit.json.

Final TT: current updated checkout275/275 Node unit/integration tests passed in26.3s (`full-tests-final.log`); the parallel shelf tests were reconciled by their owning work without changes from this story. Typecheck and lint passed under Node24.22.1/pnpm11.25.0. Native Rust suites are not applicable; no builds.

ET passed: all6 named scenarios evidenced by controlled IAB interaction/visual checks, real isolated cold/hot subscription requests and selected-source art, existing-cache overlay migration, plus the deterministic persisted-state/source/security regressions. Details: ui-results.json, live-results.json, legacy-cache-results.json, final-books-audit.json and PNGs in `.data/evidence/fast-first-story-discovery/`. Actual IAB (not a separate session) became available after resuming. Source-check and request-stage verification preserve actual limits: measured latency is one Honglou/theme sample, not a guarantee for themes spanning many chapters.

VR passed: all acceptance criteria complete. All seven REQ criteria are checked after independent acceptance review. VR risk: non-low — persistent reading-plan migration, concurrent discovery and asynchronous selection/recommendation behavior. VR review round: 1; reviewer: reused. Complete final result: `.docs/done/2026/10/29/fast-first-story-discovery.md`. Final GC commits these verification records only; implementation milestones remain `2906188`, `5599bf1`, and `e98f064`.
