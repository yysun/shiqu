# Story or chapter picker

Git base: 024fc44
Risk: non-low — new source-selection API and durable intake preparation affect source provenance and generation gates.

Use the existing deterministic local book parser and resolver. A metadata-only contents endpoint returns bounded entries with original titles, snippets and verified receipts; blocked ranges remain visible with a reason. Split Liaozhai using the same named-heading rule as legacy lookup, and Shishuo at its established one-anecdote unit boundary. Other books offer chapter ranges. Direct intake creation validates membership in that book's contents, derives title server-side and seeds one selected batch in preparing/idle-search state. No schema migration or additional queue step. Existing recommendation and final-confirmation gates remain authoritative.

- [ ] Add contents types/indexing, read endpoint and canonical direct-intake validation in server/local-book-contents.ts, server/app.ts, lib/services.ts, lib/reader-api.ts and server/reader-intake.ts.
- [ ] Add searchable picker and mode controls to client/ui/Reader.tsx with stale-response protection and matching reader styles.
- [ ] Add focused API/index/intake regression coverage; verify provenance, replay and absence of pre-confirmation discovery/storyboard/images.
- [ ] Run pnpm typecheck, pnpm lint and full pnpm test under Node 24.22.1; execute .docs/tests/test-story-chapter-picker.md in the in-app browser using isolated data.

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
