# Plan: fast-first-story-discovery

Git base: `6a3496e`. Risk: non-low; reading-plan/cache compatibility, provider contracts, async selection and user-visible progress.

Use chapter-aware 12k-token blocks capped at two chapter labels. Request one story for an empty theme pool; later expansions retain the existing maximum of five. Maintain complete ordered unit coverage and cross-chapter pending references. Keep a narrowly scoped reader for the previous plan/key format to migrate existing state; map the old completed frontier to the containing new block conservatively, retaining verified stories and pending evidence. Do not overwrite or delete old documents.

Use a separate scan schema/prompt without art instructions, while keeping the old contract available only for legacy cache identity and compatibility. Selected-story art recommendations use a dedicated validated local-source endpoint, the current provider, and the existing cache for deduplication/reuse. The client treats recommendations as optional assistance and never overwrites a manual choice on an asynchronous response.

- [x] First SS probe: inspect actual Honglou chapter sizes, existing cache/manifest compatibility, and available browser control. Check that first blocks can be materially smaller; if stable units exceed the budget, choose an explicit lossless boundary policy before proceeding. Record feasible runtime evidence without claiming semantic or latency guarantees.
- [x] Implement small ordered reading blocks, legacy progress migration, first-story request sizing, chapter/stage progress metadata, and regressions for coverage, pending evidence, cache reuse, cancellation and concurrent readers.
- [x] Implement deferred verified-source art recommendation across both providers, server route/cache, and client async state; test validation, deduplication, errors, stale selection and manual overrides.
- [x] Implement the accessible reading panel, honest in-flight motion, placeholder cards, reduced motion and mobile layout. Keep cancellation and existing story selection available.
- [x] Update focused discovery/transport/provider regressions and affected docs; run focused checks, then commit the implementation milestone with its validation state.
- [ ] Run TT: all applicable Node unit/integration suites, typecheck and lint. Native Rust suites are not applicable to this web/server change.
- [ ] Execute `.docs/tests/test-fast-first-story-discovery.md`: controlled browser cases plus real cold/hot discovery and selected-source art checks, without story/image production. Measure first verified story input/time; distinguish test browser from the user's session if IAB is unavailable.

Review/evidence records will be appended here. No dependency change or production build is needed. Smaller blocks can increase model calls and cross-chapter bookkeeping; retry/next remains explicit. Existing high-volume caches require validation once on migration. External/custom sources keep their existing discovery contract.

AR passed: no blocking architecture flaws.
AR risk: non-low — reading-plan migration, provider contracts, concurrent discovery and asynchronous art recommendations.
AR review round: 1; reviewer: new (`review_fast_discovery`).
Review constraints: migrate from old cursor rather than readThrough; incomplete input blocks are not completed progress; guard existing selection/generation against late find-more results; art identity includes source.

Browser probe: IAB remains disabled in Work settings. Controlled browser verification will use the available independent Playwright test surface and will be reported separately from the user's page.

SS probe passed: all 24 books inspected; no source unit exceeds 12k tokens. Honglou chapter 1 is ~7,500 body tokens versus previous first block 44,293; chapter 2 is ~5,974. Evidence: `.data/evidence/fast-first-story-discovery/feasibility.json`. Oversized indivisible units fail explicitly without truncation, matching the existing lossless rule.

SS implementation: small 12k/two-chapter boundaries, one-story bootstrap, legacy migration, actual chapter/checking metadata, deferred cached source-validated art, and reading panel implemented. Focused 38 discovery/transport/art/migration tests pass; typecheck and lint pass. Affected real-library tests also expose concurrent publication-source fixture changes (traditional glyph/unit counts expected before catalog replacement); their changes are preserved and excluded. Story-only verification will distinguish this baseline from our assertions.
