# Selected-chapter extraction E2E

Use isolated SQLite/media and controlled providers, with real bundled originals.
1. Select Three Kingdoms, search 黄忠 定军山, select chapters 70/71. Search another term and verify both selections remain counted and are checked when the search is cleared; deselect/reselect and verify count/CTA. Book or mode changes clear all selections. Check mobile width and keyboard controls.
2. Submit extraction. Observe discovery and story candidates before count/style preparation. Inspect controlled provider payload: only chapters 70/71, correct original order and edition; no recommendation, plan or images before candidate choice. Select one result, await count confirmation, and verify source/scope preserved. Reload and continue search/retry without widening scope.
3. Named Liaozhai/Shishuo choices still enter direct preparation. Theme discovery remains whole-book. API regression covers restart, replay/reordered scope, forged/stale/duplicate/cross-book/empty/over-limit scopes and out-of-scope model receipts/cache isolation.

4. Create another extraction task for the same selected chapters in reverse click order after restart. It receives cached stories with no additional LLM calls. Continue-find-more retains scope and does not repeat previously offered stories (covered by controlled integration/provider tests).
