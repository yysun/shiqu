# Selected-chapter extraction

Git base: 6c34880. Entry includes six uncommitted search files from the prior authorized request; preserve and include them as this story's search dependency.
Risk non-low: persisted discovery scope, LLM provenance and shared caches.

Add optional discoverySources (1–24 exact chapter receipts) to Selection. Intake canonicalizes membership/order and clears the candidate/source before entering existing discovering state. Its creation hash includes canonical scope. Keep selected scope when choosing a returned candidate. No migration: old selections omit the new field. Clear restored/entry/book/mode scope state, so only current explicit chapter choices are submitted.

Contents distinguish chapter scopes from already isolated stories. Whole chapters may contain quality issues, so discovery can scan them; candidate resolution remains strict. withLocalBooks builds an immutable subset LocalBook in original order using the original edition/unit IDs. Existing reading-plan keys include input-text hash, so subset manifests remain separate. Add canonical scope-receipt hash to the discovery namespace, including when selected chapters happen to cover the full book. Explicit scoped discovery must skip whole-book legacy cache migration. Existing source resolver and visibility validation reject out-of-scope candidate receipts. No new queue kind, provider API or direct-generation bypass.

- [x] Add scope schema/validation/canonicalization, chapter metadata, scoped provider discovery and cache isolation; preserve old direct creation.
- [x] Add chapter multiselect with native row checkboxes and a count (no selected stack), search retention, book/mode reset and explicit extraction CTA. Named stories retain single direct selection.
- [x] Add real-provider-wrapper/queued integration coverage for scope-only payloads, valid/invalid candidate receipts, cache isolation, replay, invalid inputs and confirmation gates.
- [x] Run typecheck, lint and full Node unit/integration suite; execute .docs/tests/test-selected-chapter-extraction.md in IAB with controlled providers.

First SS probe: verify selected Three Kingdoms chapters 70/71 form a bounded reading plan and preserve exact edition/IDs; ensure whole-book and selected-scope namespace keys differ before any dependent UI work.

AR passed: no blocking architecture flaws.
AR risk: non-low — persisted chapter scopes affect LLM provenance, cache isolation and production gates.
AR review round: 1; reviewer: new.

SS probe passed: Three Kingdoms chapters70/71 retain edition/IDs, form one bounded reading block and use a different reading-plan key from the whole book. Focused tests12/12 pass, including cross-chapter receipts and full-book-vs-explicit-all-chapter cache isolation. Typecheck/lint pass. User refinement: native list checkboxes, selected count only, no stack. IAB verifies two checked rows, filtering retention, uncheck and Space-key recheck.

User cache requirement: existing disk-backed StoryDiscoveryCache must reuse results across fresh tasks/wrappers/restarts and reversed chapter click order. Add explicit regression for this. Independent CR1 found the legacy non-intake create route could persist unvalidated discoverySources; reject this new field unless intake:true, preserving legacy requests without scope. Add omitted/false-intake fail-before-insert coverage.

SS milestone:16d4575. First full TT passed727/727; cache-restart test and non-intake guard were added while that run was active, so run final full TT again against stable final inputs. Current focused13/13, typecheck/lint pass.

AR passed: no blocking architecture flaws.
AR risk: non-low — persisted scopes and shared extraction caches.
AR review round: 2; reviewer: reused.

CR fixed: reject scoped creation outside the intake flow; rerun result passed.
CR risk: non-low — persisted scope validation, provenance and production gates.
CR review round: 2; reviewer: reused.

IAB ET: selected Three Kingdoms chapters70/71 through native checkboxes; filtering retains count, uncheck and keyboard Space toggle correctly. Submission reaches candidate list with no preparation: controlled counters discovery1/recommendation0/plan0/image0, request includes only sanguo-070/071 and original edition. Choosing candidate reaches confirmation; reload and find-more retain exact scope. A new task with reversed checkbox order receives cached candidates with discovery count still2 (the second prior call was explicit find-more), recommendation1/plan0/image0. No paid providers called.

Remaining IAB ET passed: mode switch clears selections (checked0, CTA disabled), book switch clears chapter state, Liaozhai named story prepares directly and still waits at final confirmation. At390×844 document scrollWidth=390, native checkbox visible, selected-stack nodes0; screenshot visually inspected. Temporary viewport reset and verification tab closed; user's3000 tab preserved. Cache reuse also confirmed through second fresh IAB task with reversed selection order and unchanged LLM call counter.

Final TT: Node24.22.1 / pnpm11.25.0 full suite with --test-concurrency=2 passed728/728, zero failures/cancellations/skips,87.9s,exit0. Log:.data/evidence/selected-chapter-extraction/full-tests.log. Typecheck/lint/diff-check passed; all4 E2E scenarios passed. Fix milestone6b0ed83 preserves source validation and confirms on-disk cache reuse. All AP tasks complete.

VR passed: all acceptance criteria complete.
VR risk: non-low — persisted discovery scopes, source provenance, shared caching and production gates.
VR review round: 2; reviewer: reused.
Full independent final mapping is preserved verbatim in the delivery report.

DD finalized: .docs/done/2026/10/31/selected-chapter-extraction.md preserves the complete independent final VR. GC scope contains only this story’s completed requirements, plan evidence and delivery report; source milestones16d4575/6b0ed83 and their current verification remain unchanged.
