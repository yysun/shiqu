# Reader UI audit fixes: in-app scenarios

Use the existing paired in-app browser at `http://127.0.0.1:3001`. No paid generation, export download, install prompt or permanent deletion is needed.

1. Home: return to the top. Resume and new-story actions are visible above fixed navigation at the existing viewport and 390×844. Open and close the new-story chooser without requesting suggestions.
2. Shelf: show all stories. Verify truthful totals, compact cover/book/tools/footer order, matching 44px icons and unchanged full-width structure. Search for an existing title; matched/total count and reset are visible. Search an impossible title; reset recovers the list. Toggle favorites, then reset to all stories.
3. Recovery: record the selected story's saved/page/checkpoint fields. Delete through confirmation; the count decreases and Undo appears. Undo restores the story. Delete again, reload, navigate to Me → deleted stories and restore it. Original progress/favorite/content fields match; no generation is dispatched. Leave all original deletion markers unchanged.
4. Me: library/favorite counts agree with Shelf; deleted stories opens a titled list with dates and Restore controls. Preferences and normal navigation remain usable.
5. Reader: open a fully generated story. Theme precedes style, metadata is legible, narration and source/settings/navigation remain usable. Open the ending; next-story, export and source remain, and disabled sharing controls are absent. Do not start generation.
6. Finish: clear test filters, restore viewport overrides, retain the relevant preview tab and save screenshots for Home, Shelf, Reader and Me/recovery.

Integration fixtures cover owner isolation, generated and published recovery, malformed/cross-origin requests, failed restoration, idempotence and unchanged production/checkpoints. Live checks verify successful UI behavior; no failure injection into personal data.
