# Dongguo demo

Base:94b38b1
Risk: non-low — changes seed identities, persisted new-library content, source attribution and consumer UI references across components.

Use a distinct dongguo sample ID and 中山狼传 excerpt book metadata (not a25th whole-library choice). Preserve old stories/images and avoid overwriting existing rows. Retain the independently licensed种梨 source fallback for historical reads, moving it out of demo ownership if needed. Derive SQL seed from the canonical story/book data and assert parity. Update all promoted-sample selectors/cover logic/admin text to the new demo.

- [x] First SS probe: load the completed story from the desktop library (same session01a1877d-261b-7282-aa6c-21027db03277), verify all30 existing images and source against Wiki2578885. Snapshot only the selected story content/assets read-only; user database/media stay untouched.
- [x] Archive source HTML/metadata and bundle the existing30-page story unchanged. Preserve title/hook/captions/prompts/reflection/adaptation note/source exactly, with only canonical seed identifiers and asset URLs changed. Copy all30 existing PNGs byte-for-byte; no newly generated art or writing. Preserve old pear assets for historical saved stories. Record content and image hashes/provenance.
- [x] Update lib/content.ts, SQL seeding, source fallback ownership, reader home/demo discovery and admin sample UI. New sample inserts safely on existing libraries and never rewrites old user rows. Catalog choices remain24.
- [x] Adapt meaningful source/seed/home/export tests; cover fresh/reopened SQLite, old rows, all30 PNGs and source identity/glyph fidelity. Update active README/NOTICE/source notices for new demo; historical delivery docs remain historical.
- [x] Run applicable pnpm test/typecheck/lint with pinned runtime. Verify desktop preview in the in-app browser when available; if unavailable, report limitation and exercise real route/SQLite/media and UI source contracts. No desktop/Docker build.

SS milestone commits include only this story; current history-cleanup verification records are separately owned. Independent CR/VR required; no remote publishing.

AR passed: no blocking architecture flaws. AR risk: non-low; round1; independent reviewer reused. Include lib/reader-pdf.ts source attribution: new and historical demos need correct export labels. Preserve recent-reading priority. Superseded asset-generation approach: user explicitly requires the existing story unchanged. Completed desktop library contains all30images (development copy only10). One external imagegen preview was produced before correction; it remains outside the project and is not used. Revised plan copies the full existing desktop story/assets with exact hashes and no new writing or art. This material correction invalidates prior AR; affected AR rerun required. Independently fetched Wiki2578885 HTML has seven narrative paragraphs andCC BY-SA4footer.

AR round2 blocked on legacy ordinary-story page15 limits. Resolve by deriving storySchema maxpages and me/progress/events page bounds from existing readerMaxFrames (60), retaining actual story-length/status validation. Provider/admin generation endpoints remain unchanged. Add route tests for save/resume page29, final-page complete event, and page30/60 rejection for a30-frame story. This required boundary fix is part of using the existing30-frame sample, not new story generation.

AR fixed: plan now covers30-frame progress, completion events and validation bounds; rerun result passed. AR risk: non-low — persisted sample and consumer routes; AR review round:3; reviewer:reused.

SS: exact existing content and30 PNGs bundled;28 focused tests passed. Browser ET found stale pear text in RecentStories; card now derives title/source from its story. All30 frames, page30 reload/resume and ending verified in isolated in-app Reader preview (3317/3318); no user library writes. Full TT passed before this presentation-only correction; final typecheck/lint pending. Milestone commit pending.

SS milestone:dc18f74. TT:284/284 passed, Node24.22.1/pnpm11.25.0. Final pnpm typecheck and pnpm lint passed after RecentStories correction; git diff --check passed. ET: in-app Reader preview3317 backed by isolated SQLite3318 verified initial demo title/source/art, all30frames, final-page reload/resume, exact ending reflection, original/source panel and final image rendered. Desktop Vite preview1420 also opened successfully against isolated library (desktop shelf lists generated sessions, so ordinary seeded demo is verified in Reader). No desktop/Docker package/build or paid generation used. Admin component currently has no mount in client/main.tsx; its corrected text/selector is typechecked and ordinary admin seed is API/integration tested, not claimed as a browser route.

CR round1 blocked: source panel and PNG subtitle still used only the24-book choices and omitted demo metadata. Resolve with bookName(story) in Reader and DEMO_BOOK fallback in PNG layout, with export subtitle assertion; rerun focused export tests, browser source panel, typecheck/lint and affected independent CR.

CR fixed: Dongguo source-panel and PNG attribution now use the demo-book fallback; rerun result passed. CR risk: non-low — shared reader/export consumers and persisted sample content. CR review round:2; reviewer:reused. Focused18/18 passed, final pnpm typecheck/lint passed. Browser source headings explicitly show中山狼传. Prior284/284 TT remains valid; targeted rerun covers changed export behavior, UI correction is browser verified.
