# Replace uncertain book editions

## Summary

Replace 15 殆知阁 editions, 识典《酉阳杂俎》 and 漢川草廬《二刻拍案惊奇》 with independently fetched Wikisource/Kanripo editions. Keep 24 book IDs and the seven retained editions' exact original hashes. Pin 1,928 original files; remove 120 superseded files from the current tree. Preserve narrative appendices and the nine-act finale. Replace the seed《种梨》excerpt with revision7908703 from Wikisource, without rewriting existing stories or media.

Code remains Apache-2.0. Catalog/NOTICE/source notices credit 16 Wikisource, 6 Kanripo and 2 Gutenberg editions and include CC BY-SA 4.0 terms. Retain and disclose transcription anomalies; block affected source ranges instead of guessing characters.

Implementation commits: b2becd0, b5a2e38, fb08252. Unrelated concurrent reader/shelf/discovery changes were excluded.

## Verification

Node 24.22.1 / pnpm 11.25.0: `pnpm test` 270/270 passed; `pnpm typecheck` and `pnpm lint` passed. All 24 HTTP router+SQLite/media flows save the original before planning; corruption/path escapes/stale receipts/anomalous ranges fail closed. Seed parity, existing-row reopening and historical source/media checkpoints pass. Current-tree audit found no unreferenced or superseded originals. All 579 new Kanripo files match upstream Git blobs byte-for-byte. Independent raw-DOM glyph comparisons cover山海/酉阳/史记; other Wiki coverage pins original bytes/identities, parses each body and exhaustively covers units; Erke adds body/finale checks.

## Notes

No Docker/desktop builds or paid generation were needed. Existing Git history still contains prior sources; current-tree replacement does not remove them. Network transcriptions retain known defects and are not verified scholarly editions. 《酉阳杂俎》 has 160 PUA characters and 6 missing-character markers, retained and blocked by source qualification. Source notices/catalog record other known anomalies.

## Final acceptance review

VR passed: all acceptance criteria complete

VR risk: non-low — replaces published data editions and citation identities while preserving historical user evidence.
VR review round: 1; reviewer: reused

1. **Complete — 17 replacements; seven retained editions unchanged.** Catalog, source baseline and passing replacement tests establish 24 books, changed replacement hashes, absent old paths and unchanged retained hashes.
2. **Complete — provenance, licenses, scope and defects recorded.** Catalog records fixed revisions/commits and per-file hashes; notices describe attribution, parsing changes and known anomalies. Source families match 16 Wikisource, 6 Kanripo and 2 Gutenberg entries. No fabricated glyph repairs are introduced.
3. **Complete — offline reading and citation behavior.** Passing whole-library tests cover chapter scope, appendices, final bodies, exhaustive bounded inputs and all 24 HTTP selection flows. Corruption, missing/extra/escaped files, stale receipts and anomalous ranges fail closed. Originals persist before planning.
4. **Complete — independently sourced demo and historical preservation.** The Wikisource excerpt matches application and fresh SQLite seeds. Tests cover ten demo pages, unchanged existing rows and readable historical source/media checkpoints.
5. **Complete — publication tree and documentation.** The recorded audit identifies 1,928 declared originals without unreferenced or superseded files. README, NOTICE and source notices distinguish Apache code from text licenses and disclose remaining Git history. Docker and desktop resource paths include the book notices and license.
6. **Complete — verification and reviews.** Current evidence reports 270/270 tests passing, plus successful typecheck and lint under Node 24.22.1 / pnpm 11.25.0. CR rounds 1–2 passed; ET scenarios 1–4 are covered by the executed router, SQLite, media and offline integration checks. All AP tasks are complete.

No Docker/desktop builds, paid generation, push or history rewrite are claimed. This verifies the specified replacement work; it does not establish error-free scholarly editions or universal legal clearance.

Read-only review; no tests executed or files edited.
