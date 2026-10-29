# Reader UI audit fixes: in-app scenarios

Use the existing paired in-app browser at `http://127.0.0.1:3001`. No paid generation, export download, install prompt or permanent deletion is needed.

1. Home: return to the top. Resume and new-story actions are visible above fixed navigation at the existing viewport and 390×844. Open and close the new-story chooser without requesting suggestions.
2. Shelf: show all stories. Verify truthful totals, compact cover/book/tools/footer order, matching 44px icons and unchanged full-width structure. Search for an existing title; matched/total count and reset are visible. Search an impossible title; reset recovers the list. Toggle favorites, then reset to all stories.
3. Recovery: record the selected story's saved/page/checkpoint fields. Delete through confirmation; the count decreases and Undo appears. Undo restores the story. Delete again, reload, navigate to Me → deleted stories and restore it. Original progress/favorite/content fields match; no generation is dispatched. Leave all original deletion markers unchanged.
4. Me: library/favorite counts agree with Shelf; deleted stories opens a titled list with dates and Restore controls. Preferences and normal navigation remain usable.
5. Reader: open a fully generated story. Theme precedes style, metadata is legible, narration and source/settings/navigation remain usable. Open the ending; next-story, export and source remain, and disabled sharing controls are absent. Do not start generation.
6. Finish: clear test filters, restore viewport overrides, retain the relevant preview tab and save screenshots for Home, Shelf, Reader and Me/recovery.

Integration fixtures cover owner isolation, generated and published recovery, malformed/cross-origin requests, failed restoration, idempotence and unchanged production/checkpoints. Live checks verify successful UI behavior; no failure injection into personal data.

## Execution evidence — 2026-10-29

Scenarios 1–6 passed in the existing in-app browser. Original viewport: 649×853; phone override: 390×844. The override is reset and test filters are cleared.

- Home: explicit resume control and new-story button fit above fixed navigation. At the original size the new-story button ends at y=616.22; phone screenshot shows both actions. Chooser opens/closes without requesting suggestions.
- Shelf: all 20 stories return after reset. Title search reports 1/20; impossible search 0/20; favorite filter 1/20. Favorite/delete targets measure 44×44 with matching `rgb(82,103,71)` color. Book name and tools share the compact row below the image; progress and Continue share the bottom row. Full-width cards retain their original structure.
- Recovery: pending《裴度还带》was deleted and restored via Undo, then deleted/reloaded and restored through Me. Counts move 20→19→20. Its complete raw SQLite session row, page/saved flags, zero job rows and the original deletion-marker list exactly match the pre-check snapshot. The historical《种梨》deletion remains untouched. Recovery list shows titles/dates and usable Restore buttons.
- Me: 20「书架故事」and 1「已收藏」agree with the unfiltered shelf. Recovery entry opens and closes normally.
- Reader: fully generated《霜刃与鸳鸯》opens at 10/10; footer shows theme then style. Source and preferences sheets open/close. Ending shows next-story, restart, export and source actions, with no unavailable sharing controls.
- Checkpoint failures, owner isolation, rejected cross-origin restores, idempotence and the 80-session list boundary are covered by real-SQLite fixtures; no live provider or generation request was made by this verification.

Screenshots: `/Users/esun/.codex/visualizations/2026/10/29/01a187ff-2868-7570-999c-d29df8f6d8bb/fixed-{home-desktop,home-phone,shelf-phone,shelf-filter-phone,shelf-compact-phone,shelf-undo-phone,recovery-phone,me-phone,reader-phone,ending-phone}.jpg`.

Node tests: 228/228 pass across 31 named files; log `.data/evidence/reader-ui-audit-fixes/node-tests.log`. The whole `desktop-lite.test.mjs` file (7 unrelated native-runtime scenarios, including a bundling scenario) was excluded to honor the no-bundling request and automatic approval review. Typecheck, lint and PostCSS parse pass. No physical-phone, packaged-app or complete accessibility-conformance claim is made.

Viewer refinement after initial CR: the current reading tab shows normal 22px text with 36.3px line height on desktop and 21px with 34.65px line height at 390×844. Both were measured through the rendered DOM; the phone screenshot was refreshed from the actual reading tab. The normal viewport was restored. Optional large-text rules remain 28px desktop/26px phone; the user's stored preference was not changed. PostCSS parsing passes. This CSS-only refinement does not invalidate the Node behavior tests.
