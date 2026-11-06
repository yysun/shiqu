# Phone navigation: back behavior and sheet depth

Requirement: [req-phone-navigation.md](../../../../reqs/2026/11/05/req-phone-navigation.md) · Plan: [plan-phone-navigation.md](../../../../plans/2026/11/06/plan-phone-navigation.md) · E2E: [test-phone-navigation.md](../../../../tests/test-phone-navigation.md)

Commits on `main` since `aa5c846`: `75f69db`, `281cc62`, `9ef9db8`, `dfd10ce` (not pushed).

## Summary

- **Browser back closes exactly the topmost step** at every tier: sheets and dialogs, the reader, the desktop create page and workspace, and drawers below 1024px. Docked panels are not steps.
  - A step registry (`client/ui/historySteps.ts`) follows the steps that are already open.
  - It pushes a history entry only when there was user input since the last push, adopts released entries first, and releases entries after in-app closes.
  - Forward bounces back and never reopens anything.
- **Direct links and reloads open a pinned base step.** Back from it leaves the app.
  - Entries from before a reload are skipped in one press, before anything renders or loads. If the app is the tab's first page, back shows the start view at `/` instead.
  - Returning to the reader's list restores its scroll position.
- **Unsaved typed input asks before back discards it**, through browser back, Escape (Chrome Android's back), and a browser-forced dialog close.
  - Busy sheets stay open and keep the scroll lock.
  - Forms mark unsaved input with `data-dirty`.
- **Phone sheets stack at most two deep.**
  - 修改分镜 replaces 分镜剧本.
  - 替换选题 replaces 故事设置 while open, and its single server-side reselection session is kept.
  - A stacked sheet shows 返回「…」 above its title.
- **`#provider-settings` applied in the app is a step.** Its close button uses up the hash entry. A directly loaded dialog keeps today's close, which stays in the app.

## Verification

- Unit: `tests/history-steps.test.mjs` 24/24, `tests/history-dirty-ui.test.mjs` 3/3; `pnpm test` 692/692; `pnpm typecheck` and `pnpm lint` clean.
- E2E (headless Chromium, isolated fixture libraries): PHONE-NAV-01 to 11 pass, DESKTOP-LAYOUT 13/13, PHONE-READABILITY 2/2 and STORY-LIFECYCLE 10/10. C005 timed out once under 4× concurrency and passed alone.
- In-app browser at 375px against an empty isolated library with the read-only provider: back closes sheets, and a reload followed by back shows the start view.
- Reviews: AR passed in round 4; CR round 1 and the round 2 delta passed with no major findings. The non-blocking items taken and the accepted limits are in the plan's "Review and verification notes".

## Notes

- **Not verified on devices:** iOS Safari (edge swipe, no Navigation API) and Chrome Android (back as `cancel`, close-watcher force close). Chromium covers the same code paths through `goBack`, Escape and `dialog.close()`.
- **Behavior changes:**
  - Escape on a sheet with unsaved input now asks.
  - 分镜剧本 closes when 修改分镜 opens.
  - With `history.scrollRestoration='manual'`, a reload of a scrolled list starts at the top.
  - Coming back to the app from another site, when the browser can't restore the page, skips through the app's old entries, as the REQ specifies.
- **Navigation API entries are same-origin only.** So the earlier-entry check is three-way: leave; try to leave with a 1s or 2s fallback; or show the start view.
- **E2E setup:** the E2E leaves to a static page on another origin, because the fixture's init script throws on `about:blank`. Case 7b opens the app with `window.open`, so the app is the tab's first entry.

## Final VR result

VR incomplete: real-device verification on iOS Safari and Chrome Android is outstanding; every acceptance criterion and AP task is otherwise complete with evidence.

- Every acceptance criterion is complete. The evidence for each is in the REQ's "Verification (VR, 2026-11-06)" table: PHONE-NAV-01 to 11, unit tests, the full suite, and the DESKTOP-LAYOUT, PHONE-READABILITY and STORY-LIFECYCLE E2Es.
- **Constraint not met here:** "Verify … on iOS Safari, Chrome Android and a desktop browser." Only desktop Chromium (headless and in-app) was available. Not verified on devices:
  - the iOS edge swipe;
  - Safari without the Navigation API (the `history.length` fallback and the forward-into-first-entry ambiguity);
  - Chrome Android's back delivered as `cancel`, and its close-watcher force close.
- The same code paths are exercised in Chromium via Escape, `dialog.close()` and `goBack`.
