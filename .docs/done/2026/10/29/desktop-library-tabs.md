# Desktop library tabs and reader shelf

## Summary

The desktop left pane now opens generated stories in「书架」, with「生成队列」and「设置」tabs. Shelf and queue show source book, theme and art style from the shared SQLite library. The shelf supports search, favorite filtering, source-book grouping and confirmed deletion with undo. Summaries do not dispatch generation; deletion uses existing reader tombstones and preserves stories, media and checkpoints.

The reader shelf supports the same search and grouping. Groups containing one story use a full-width card. Favorite/unfavorite and delete actions sit in the card's top-right corner, outside the reading button. Favorites work for unfinished and readable stories without moving reading progress or starting production. Server favorite flags replace stale browser cache flags while retaining newer reading positions.

Desktop UI development uses `pnpm desktop:preview` in the in-app browser. The reader uses `pnpm dev`. Independent Vite caches allow both previews to run together. Desktop preparation, bundling and Docker builds remain on demand.

## Verification

- Node 24.22.1, pnpm 11.25.0: 19/19 focused tests passed across `desktop-library`, `shelf-browser`, `shelf-favorites` and `reader-interaction`.
- `TAURI_CONFIG='{"bundle":{"resources":[]}}' cargo test --locked library --lib`: 1/1 passed. The override omits packaged resources for this source-level test; no desktop package was built.
- `pnpm typecheck`, `pnpm lint` and `git diff --check` passed.
- In-app browser verification covered desktop tabs, real summaries, temporary-library delete/undo, search/grouping and reader single-story layout. Reader favorite/unfavorite was checked for a readable and an unfinished story, including refresh persistence and favorite filtering. Test favorites were restored; reading positions and last-read timestamps were unchanged.
- Latest reader layout screenshot: [shelf-card-actions.jpg](/Users/esun/.codex/visualizations/2026/10/29/01a187ff-2868-7570-999c-d29df8f6d8bb/shelf-card-actions.jpg).
- Existing CR conclusions remain valid: `CR passed: no major findings`. Delivery documentation adds no runtime changes.

## Final acceptance review

VR passed: all acceptance criteria complete

| Criterion | Status | Evidence |
|---|---|---|
| Desktop left-pane Library, Queue and Settings tabs | Complete | Desktop frontend and in-app preview expose all three tabs; native settings and right-pane service controls remain connected. |
| Shared generated-story shelf and queue show theme and art style | Complete | Shared SQL feeds Vite and native summaries; owner/deletion filtering and task counts pass fixture tests. Browsing does not start production. |
| Search, source-book grouping and single-story full-width reader cards | Complete | Shared search/grouping tests pass; in-app browser confirms filtered source-book groups and the horizontal single-story card. |
| Reversible shelf deletion and explicit card favorites | Complete | Native and Node delete/undo tests preserve checkpoints. Favorite API tests cover unfinished, generated and published stories, ownership, deleted entries, malformed bodies and foreign origins. Browser confirms persistent toggles and compact corner actions without changing reading progress. |
| Clear historical favorites and prevent stale cache restoration | Complete | Requested reset cleared 15 historical favorites with a full pre-reset backup. Reconciliation regression tests pass. A later intentional favorite is preserved. |
| Develop in-app and package only on demand | Complete | AGENTS.md and desktop documentation record the workflow. Verification used previews, local checks and source tests; no desktop or Docker package was built for this change. |

VR risk: low — localized, reversible shelf controls using existing persistence and deletion contracts.
VR review round: 1; reviewer: not applicable

## Notes

- The favorite reset is local runtime data, not a migration. Backup: `.data/backups/favorites-reset/2026-10-29T14-25-22-331Z/before.sqlite`. Import scripts were left unchanged at the user's request.
- Browser preview runs on loopback, rejects foreign-origin writes and denies private files. Preview deletion affects the selected real library; use a temporary library for destructive UI checks. Settings and service controls require the native application.
- Native library logic passed its source test. Packaged-application behavior and physical-phone testing were not repeated in this delivery.
- The separate root README rewrite remains in the working tree; delivery includes only the shelf usage paragraph from this work.
