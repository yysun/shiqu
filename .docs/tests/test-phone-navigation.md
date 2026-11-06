# Phone navigation E2E

Command: `node --experimental-strip-types --test tests/phone-navigation.playwright.e2e.mjs`. It also runs in `pnpm test:e2e`.

Setup:
- `seededBrowser` from `tests/fixtures/desktop-layout.mjs`: an isolated production fixture, stories seeded through the production API, and headless Chromium.
- **Phone cases** use 390×844 with touch; **medium and large cases** use 900×800 and 1280×800.
- Every case except 7b starts from the context's initial blank page, then goes to the app, so "leaving the app" has a page to land on. The fixture's init script cannot run on an explicitly navigated `about:blank`.
- Back and forward use `page.goBack()` / `page.goForward()`.
- `window.confirm` is handled with `page.on('dialog')`.

1. **Phone sheets close one at a time.**
   - **Actions:** 书架 → open a story → 故事设置 → 审核记录. Press back three times.
   - **Expected:**
     - first back: 审核记录 closes and 故事设置 is still open;
     - second back: 故事设置 closes and the reader is still open;
     - third back: the reader closes, back on 书架 at the scroll position from before opening.
2. **In-app closes consume entries.** Open 故事设置 and close it with its 关闭 button. Then open the reader and leave with its 返回 button. Then back: it leaves the app (`about:blank`), never a dead press.
3. **Forward never reopens.** After scenario 1's backs, press forward twice. Nothing opens, no `POST` is sent, and the page stays on 书架.
4. **Typed input asks, through both back and cancel.**
   - **Actions:** in the creation sheet, type a custom theme, then press back.
   - **Expected:**
     - choosing keep (dismiss) leaves the sheet open with the text;
     - pressing back again and choosing discard closes it;
     - with rename open and edited, back asks too;
     - after saving, back doesn't ask;
     - Escape on a dirty creation sheet (the `cancel` path that Chrome Android's back also takes) asks too, and keep leaves the text;
     - `dialog.close()` forced on a dirty sheet re-opens it and asks.
5. **Busy sheet.** Hold a rename save in flight (a delayed route), then press back twice. The dialog stays open, `body` keeps its scroll lock, and closing after the save releases everything. Also covered: forcing `dialog.close()` while busy re-opens it.
6. **Creation submit reuses the entry, and swaps add none.**
   - **Actions:** submit the creation sheet, which opens the workflow panel on its own. Press back.
   - **Expected:** the panel closes. A second back leaves the app, so no step was skipped and no extra entry was added.
   - **Late async open:** with `reader/publication-defaults` delayed by 2s, 作品还未署名 opens after the click that asked for it. Back closes it and stays in the app; the next back closes the step below. This also holds for a direct-link reader, where the dialog must not become a base step.
7. **Reload and stale entries.**
   - **Actions:** open the reader and 故事设置, then reload.
   - **Expected:**
     - after the reload, the reader opens from `/read?id=…` as before;
     - one back leaves the app, past every old app entry, with no `POST` and no reading event;
     - forward from `about:blank` returns to the app;
     - forward again onto a stale entry opens the start view at `/`, not the story.
   - **7a, direct link plus a sheet:** load `/read?id=…` directly, open 故事设置, then press back twice. The first press closes the sheet and the reader stays; the second leaves the app. The same holds after a reload of `/read?id=…`.
   - **7b, the app as the tab's first page:** open a new page directly at the app (no blank entry before it), open the reader and 故事设置, reload, then press back. The start view shows at `/` instead of a blank or unchanged page. A further back changes nothing in the app (the browser's own first-entry behavior), and forward presses bounce without reopening anything. No reading event or resume `POST` is sent during the stale-back handling.
8. **Hash provider dialog.** This case runs on the disposable checkout, because only the dev proxy opens provider settings.
   - **While the app is open:** set `#provider-settings`. The dialog opens. Back closes it, and the next back leaves the app. Close by the button removes the hash and doesn't leave a dead entry.
   - **Loaded directly** at `/#provider-settings`: the 关闭 button stays in the app on 我的.
9. **Sheet depth and return labels.**
   - **修改分镜:** from 分镜剧本, 修改分镜 leaves exactly two open dialogs (故事设置, 修改故事), and 修改故事's header says 返回「故事设置」.
   - **替换选题:** from 故事设置, 替换选题 shows without 故事设置 underneath. In today's flow, choosing a candidate inside 替换选题 submits the replacement, so no setup sub-sheet can open there before it; the two-level limit for nested setup sheets is covered by case 11's 故事原文. 取消替换 brings 故事设置 back, and the server holds one reselection session throughout. Counting back presses afterwards: one closes 故事设置, the next closes the reader, the next leaves the app, and none is dead.
   - **修改分镜 back count:** after 修改分镜, back closes 修改故事, the next closes 故事设置, and none is dead.
10. **Medium and large steps.**
    - **At 900:** 书架 has no side panel, so a card opens the reader → back closes the reader and returns to 书架.
    - **At 1280:** workspace → back returns to 书架 with the selection kept. Create page → back returns to 发现.
    - **Reader at 1280 with the docked 分镜列表**, resized to 900 (it becomes a drawer): back closes the drawer, and the next back returns to 书架.
11. **Resize keeps the history consistent.** Open 故事设置 and 修改故事 at 390, resize to 1280 (the workspace), then back to 390. Press back until the app is left. Each press closes exactly one step, and none is dead. Repeat with a nested setup sub-sheet open (an intake's 故事原文) across the switch: the first back closes the sub-sheet, not its parent. Repeat with rename open over 故事设置 across 390 → 900 → 390: the first back closes rename, and 故事设置 stays.
