# Dongguo demo

> Historical record — superseded by the [empty-library delivery](../../../../done/2026/10/29/empty-library.md).
> Bundled demos and automatic story seeding were removed in `e404837`; the remaining admin-seed fix is committed in `6ebd117`. The completed criteria and verification below describe the earlier Dongguo milestone, not the current product. Existing saved stories remain supported.

## Summary

Replace the promoted pear sample with the existing completed《东郭先生：袋中与袋外》and its30 original images. Preserve story/source text and image bytes, pin source provenance, and support final-page progress with correct reader/export labels. Existing user stories and24book choices remain intact.

## Verification

Full284tests, focused18post-fix tests, typecheck and lint passed using Node24.22.1/pnpm11.25.0. In-app Reader verified all30frames, final-page reload/resume, source and ending; desktop Vite smoke passed. Independent CR passed in round2.

## Notes

Current implementation references: `b6eca68` (originally `dc18f74`) and `acedfa7` (originally `a819f2d`). Subsequent cleanup rewrote local history and removed the demo payload/artwork. No demo push or packaging occurred. The earlier bundle added about 131 MB; those images are no longer shipped. An unused image-generation preview made before the user's correction remains outside the project; it is not included or referenced. User library was read-only; browser verification used isolated SQLite/media. These tracking records are finalized separately from the later empty-library delivery. The original VR below is preserved verbatim as historical evidence.

## Final VR result

VR passed: all acceptance criteria complete

VR risk: non-low — changes persisted sample content, attribution, reader/export consumers and ordinary-story page bounds.
VR review round: 1; reviewer: reused

1. **Complete — consistent demo identity.** Canonical application data, SQL and admin seeding identify《东郭先生：袋中与袋外》. Reader promotion, artwork and source labels use the new demo metadata.
2. **Complete — existing content and art preserved.** Snapshot comparison confirms unchanged title, hook, captions, prompts, reflection, source and rendered adaptation note. All 30 bundled PNGs match recorded original hashes; no replacement artwork is referenced.
3. **Complete — late-page persistence.** Integration tests save/resume page index 29 and record completion there. Indices 30 and 60 are rejected appropriately. Browser verification confirms page-30 reload/resume.
4. **Complete — source and provenance.** Archived Wikisource《中山狼傳》revision 2578885 has recorded identity, SHA and CC BY-SA attribution. Source glyphs match the archived body, with existing story formatting preserved. Notices distinguish source text from adapted text/art.
5. **Complete — historical compatibility.** Insert-only seeding and reopen tests preserve edited Dongguo and historical 种梨 rows. Pear assets and source fallback remain. The selectable whole-book catalog remains 24.
6. **Complete — verification and reviews.** Full suite passed 284/284; targeted post-fix tests passed 18/18; final typecheck/lint passed. CR round 2 passed. In-app Reader checks cover the card, source panel, all 30 frames, ending and reload/resume. Export readiness, source labels and PNG ordering are covered.

All AP tasks are complete. Desktop launcher received a smoke check; the unmounted Admin component was source/typecheck reviewed and its seed API integration tested. No Admin browser verification or completed export artifact is claimed. No packaging or remote push was performed for this demo task.

Read-only acceptance review; no application execution or file edits.
