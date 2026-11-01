# Selected-chapter extraction

Git base: 6c34880. Entry includes six uncommitted search files from the prior authorized request; preserve and include them as this story's search dependency.
Risk non-low: persisted discovery scope, LLM provenance and shared caches.

Add optional discoverySources (1–24 exact chapter receipts) to Selection. Intake canonicalizes membership/order and clears the candidate/source before entering existing discovering state. Its creation hash includes canonical scope. Keep selected scope when choosing a returned candidate. No migration: old selections omit the new field. Clear restored/entry/book/mode scope state, so only current explicit chapter choices are submitted.

Contents distinguish chapter scopes from already isolated stories. Whole chapters may contain quality issues, so discovery can scan them; candidate resolution remains strict. withLocalBooks builds an immutable subset LocalBook in original order using the original edition/unit IDs. Existing reading-plan keys include input-text hash, so subset manifests remain separate. Add canonical scope-receipt hash to the discovery namespace, including when selected chapters happen to cover the full book. Explicit scoped discovery must skip whole-book legacy cache migration. Existing source resolver and visibility validation reject out-of-scope candidate receipts. No new queue kind, provider API or direct-generation bypass.

- [x] Add scope schema/validation/canonicalization, chapter metadata, scoped provider discovery and cache isolation; preserve old direct creation.
- [x] Add chapter multiselect with native row checkboxes and a count (no selected stack), search retention, book/mode reset and explicit extraction CTA. Named stories retain single direct selection.
- [x] Add real-provider-wrapper/queued integration coverage for scope-only payloads, valid/invalid candidate receipts, cache isolation, replay, invalid inputs and confirmation gates.
- [ ] Run typecheck, lint and full Node unit/integration suite; execute .docs/tests/test-selected-chapter-extraction.md in IAB with controlled providers.

First SS probe: verify selected Three Kingdoms chapters 70/71 form a bounded reading plan and preserve exact edition/IDs; ensure whole-book and selected-scope namespace keys differ before any dependent UI work.

AR passed: no blocking architecture flaws.
AR risk: non-low — persisted chapter scopes affect LLM provenance, cache isolation and production gates.
AR review round: 1; reviewer: new.

SS probe passed: Three Kingdoms chapters70/71 retain edition/IDs, form one bounded reading block and use a different reading-plan key from the whole book. Focused tests12/12 pass, including cross-chapter receipts and full-book-vs-explicit-all-chapter cache isolation. Typecheck/lint pass. User refinement: native list checkboxes, selected count only, no stack. IAB verifies two checked rows, filtering retention, uncheck and Space-key recheck.
