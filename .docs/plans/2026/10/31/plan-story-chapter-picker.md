# Story or chapter picker

Git base: 024fc44
Risk: non-low — new source-selection API and durable intake preparation affect source provenance and generation gates.

Use the existing deterministic local book parser and resolver. A metadata-only contents endpoint returns bounded entries with original titles, snippets and verified receipts; blocked ranges remain visible with a reason. Split Liaozhai using the same named-heading rule as legacy lookup, and Shishuo at its established one-anecdote unit boundary. Other books offer chapter ranges. Direct intake creation validates membership in that book's contents, derives title server-side and seeds one selected batch in preparing/idle-search state. No schema migration or additional queue step. Existing recommendation and final-confirmation gates remain authoritative.

- [x] Add contents types/indexing, read endpoint and canonical direct-intake validation in server/local-book-contents.ts, server/app.ts, lib/services.ts, lib/reader-api.ts and server/reader-intake.ts.
- [x] Add searchable picker and mode controls to client/ui/Reader.tsx with stale-response protection and matching reader styles.
- [x] Add focused API/index/intake regression coverage; verify provenance, replay and absence of pre-confirmation discovery/storyboard/images.
- [x] Run pnpm typecheck, pnpm lint and full pnpm test under Node 24.22.1; execute .docs/tests/test-story-chapter-picker.md in the in-app browser using isolated data.

First SS probe: load actual local books and index representative Liaozhai, Shishuo and chapter sources. Proceed only if deterministic ranges resolve within existing quality/token constraints; blocked sources must be visibly unavailable, never bypass verification.

AR passed: no blocking architecture flaws
AR risk: non-low — source-selection API and durable intake preparation touch provenance and generation gates.
AR review round: 1; reviewer: new.
Independent review: picker_review. Canonical creation identity includes the receipt; restored preferences must clear source/title so direct selection is explicit.

User clarification: “select a book, list stories/chapters”. Book entry defaults to direct contents; explicit mood/surprise entry keeps theme discovery. This changes presentation defaults only.

AR passed: no blocking architecture flaws
AR risk: non-low — source provenance and durable intake gates remain in scope.
AR review round: 2; reviewer: reused.

SS probe passed: real Liaozhai first named story (590 chars), Shishuo first anecdote (90 chars), and Xiyou first chapter (7,064 chars) resolve through existing quality/token gates. Implemented metadata index, canonical direct creation and default contents UI. Focused integration tests 3/3, typecheck, full lint and diff check passed under Node 24.22.1 / pnpm 11.25.0. Browser ET in progress on isolated controlled preview.

SS milestone: 0376ba4. Source/header documentation and user guide updated; no dependencies, schema migrations or packaging changes.

CR passed: no major findings
CR risk: non-low — direct receipts cross source provenance, persisted intake identity and production confirmation boundaries.
CR review round: 1; reviewer: reused.
Independent reviewer inspected full 024fc44..0376ba4 story diff, resolver, coordinator, preference restoration and replay. Largest 500-entry Taiping index measured 377/358 ms after 483 ms load; no blocking performance concern.

ET: controlled IAB on 127.0.0.1:3210 verified book selection defaults to contents, simplified→traditional title search, Liaozhai direct creation→confirming, reload/resume, exact saved source, Xiyou chapter choice, Shishuo individual anecdotes/context, mode/book clearing, delayed Liaozhai response discarded after Xiyou switch, empty query results, request failure/retry, custom-book theme-only mode, theme submission with a single controlled discovery. At 390×844 document scrollWidth=390; screenshot visually inspected. Direct creation counters: discovery0/recommendation1/storyboard0/image0. API scenarios in focused integration suite verify replay and forged/stale/cross-book rejection. TT initial sandbox run encountered localhost process restrictions; rerunning with localhost access.

Additional ET: real Taiping contents expose 166 unavailable chapters as disabled buttons with the source-quality reason; keyboard Tab reaches an enabled entry with a solid focus outline. Mobile width still 390/390. All four E2E scenarios now passed (API checks via integration suite).

ET correction: exact full-width chapter query “卷一（” exposed asymmetric NFKC normalization. Shared matchingBookContents now normalizes both fields and query; focused suite 4/4 includes the failed query and both punctuation widths. IAB recheck now shows the exact chapter (still disabled for its source-quality reason). Typecheck/lint passed after the fix.

CR fixed: normalize both source fields and query for contents search; rerun result passed.
CR risk: non-low — overall source provenance and persistent-intake boundaries remain in scope.
CR review round: 2; reviewer: reused.
Prior provenance/intake/replay conclusions remain valid.

TT unrestricted default-concurrency result: 717 tests, 716 passed, one existing 80-frame production case hit its 15-second deadline during concurrent full-catalog parsing. The exact case passes alone in 4.49 seconds. Final full suite now running with --test-concurrency=2 to reduce resource contention; no production logic or timeout was changed.

Search-fix milestone: d240e9f; independent affected CR2 passed. Provisional independent VR1 found every REQ criterion evidenced and no other gaps; only final full TT was pending. Temporary IAB viewport reset, verification tabs closed, controlled preview stopped. User's existing browser/server session was preserved.

Final TT: Node24.22.1 / pnpm11.25.0, pnpm exec node --experimental-strip-types --test --test-concurrency=2 tests/*.test.mjs: 718/718 passed, 0 failed (exit0). Typecheck, lint and diff check passed. Full log: .data/evidence/story-chapter-picker/full-tests.log. All AP tasks complete. User guide now describes the default contents path and current shared confirmation controls.

VR passed: all acceptance criteria complete.
VR risk: non-low — source provenance, persistent intake identity and production confirmation gates.
VR review round: 2; reviewer: reused.
Full independent final acceptance mapping is preserved verbatim in the delivery report.
