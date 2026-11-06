# Responsive redesign E2E

Command: `node --experimental-strip-types --test tests/desktop-responsive-layout.playwright.e2e.mjs`. It also runs in `pnpm test:e2e`.

Setup: an isolated production fixture and library with no credentials (`storyBrowser` via `tests/fixtures/desktop-layout.mjs`). It is served through a Vite proxy and checked in headless Chromium. Stories are seeded through the production API, never through UI clicks: create, title search, choose, confirm. The library holds, per scenario:

- **Readable stories,** 3 frames each. Scenario 2 uses 6; the others use fewer.
- **A story with artwork and a saved review issue on frame 1.** A finished story's session exposes `reviewIssues` only while its review is blocked. So this is the real equivalent: a caption revision of a finished story, made through the revision API, whose re-review blocks on frame 1 and which keeps all of its images (`seedReviewedStory`).
- **An unfinished production in intake:** a local book in the story-choosing phase with no candidate picked (`seedStory({pick:false})`), so 输入标题 and 返回修改书籍 are enabled.

The provider settings dialog is only open to the local dev proxy's private proof. Case `08b` therefore checks it with the disposable checkout and the real dev server, as `browser-provider-settings.e2e.mjs` does. Evidence (screenshots and geometry JSON per width) goes to `.data/e2e/<run>/desktop-responsive-layout`.

1. **Small tier.**
   - **Initial:** 360, 390, 430, 600 and 767 × 820, plus 844 × 390 and 932 × 430 (landscape phones).
   - **Actions:** open 发现, 书架 and 我的; open the creation sheet; open 故事设置 and 修改故事; open a reading page.
   - **Expected:**
     - There is no `.yu-desktop`.
     - The tab bar is at the bottom and the sheets are bottom sheets.
     - There is no horizontal scroll.
     - At 600, 767 and the landscape sizes:
       - `.yu-app` spans the viewport with no radius and no grey margins, and `data-layout="phone"`;
       - the 发现 content column is at most 600px, centered;
       - every book is visible without horizontal scrolling, with more books per row than are visible at 430;
       - at 600 and 767 × 820, the intro heading and caption font sizes equal those at 430 × 820; the landscape sizes are compared with a 430 × 390 viewport (same height rules), and their captions are at most 30em wide.
   - The baseline comparison against `READABILITY_BASE` (the phone-readability delivery commit) is SS evidence recorded in the plan, not part of this repeatable test.
2. **Shell and top bar.**
   - **Initial:** 1280 × 800.
   - **Actions:**
     - Use the top bar to go to 发现, 书架, 我的 and 新建故事.
     - Scroll 书架 to the bottom.
     - Shift+Tab back to the first card.
     - With the completed story's workspace open, click 书架, then reopen the workspace and click 发现.
     - From the create page, click 我的.
     - In the intake workspace, click 返回修改书籍, then 书架.
     - While reading, open 故事设置, click 新建故事, then 发现.
   - **Expected:**
     - The bar is a horizontal row at the top. It stays visible after scrolling and never overlaps the first row of content.
     - The focused card's rect is fully below the bar.
     - Each click leaves the create page, workspace or reader and shows the chosen section, with `aria-current` on it. 返回修改书籍 → 书架 lands on the library, not the workspace. The reader path ends on 发现 with the URL `/`.
     - On the create page, 新建故事 is the active item.
3. **Library.**
   - **Initial:** 1280 × 800, 书架.
   - **Actions:** click a readable card; press Tab to reach the next card and press Enter; search for text that excludes the selected story.
   - **Expected:**
     - The detail panel shows the selected story's title and its actions (阅读, 制作流程, the downloads, rename, 署名与转载, delete).
     - Enter selects without opening the reader.
     - The selection clears when the story is filtered out.
     - Clicking 继续阅读 on a card opens the reader.
     - Clicking a production row opens its workspace.
   - **Medium (900 × 800):**
     - Selecting a card opens the details as a drawer with focus inside.
     - Escape closes it, clears the selection and returns focus to the card.
     - Resizing to 1100 with a story selected turns the drawer into the docked panel with the same story, without a reload.
     - Back at 1100: select a card with the keyboard so focus stays on it, then resize to 900. No drawer opens, the grid is not inert, focus is still on the card, and the selection is kept. Pressing Enter opens the drawer.
     - With a touch context at 900: top-bar items and drawer controls are at least 44px, and form inputs compute 16px.
4. **Workspace from the library.**
   - **Initial:** the completed story is selected.
   - **Actions:** click 制作流程, then the 修改故事 tab, then frame 1 in the frame list, and type into 旁白.
   - **Expected:**
     - At 1280 × 800, with the top bar and workspace header counted, the frame list, the 旁白 editor, frame 1's artwork and its review issue are all inside the viewport.
     - The panes scroll independently.
     - Switching to 分镜剧本 and 审核记录 and back keeps the typed text.
     - Back returns to 书架 with the same story selected.
   - **Other tiers:**
     - At 1024 × 768: the frame strip, the 旁白 editor and frame 1's review issue are all in the viewport, and the artwork is visible at least as a thumbnail.
     - At 768 × 1024: the frame strip and editor are visible. 画面与审核 opens the preview drawer with the artwork and issue, and closing it returns to the editor with the typed text intact.
     - Resizing 1280 → 1100 → 900 → 1280 with typed text keeps the text, the selected frame and the editor's scroll position.
     - At 1100, with focus in the right pane, resizing to 900 moves focus to the 画面与审核 toggle and leaves the preview drawer closed.
5. **Workspace from the reader.**
   - **Initial:** reading the completed story at page 3, with the 原文 side panel open.
   - **Actions:** click 故事设置, open the 原文 tab, go back to 制作流程, then go back.
   - **Expected:**
     - 故事设置 opens the 制作流程 section, not 原文.
     - The 原文 tab shows the source.
     - Back returns to the reader at page 3 with the side panel closed.
6. **Create.**
   - **Initial:** 1280 × 800, 发现.
   - **Actions:**
     - Click a book, choose 其他 as the theme, and type a custom theme.
     - Click a different book, then click a mood.
     - Submit.
     - Repeat the start from 不挑了, and from the ending page's 开启下一篇.
     - Finally, open 新建故事 from a workspace and submit.
   - **Expected:**
     - A create page opens; no sheet appears.
     - The book list stays visible.
     - Switching the book re-initializes the form for the new book.
     - Submitting starts discovery as on phone (same request), and the intake continues in the workspace.
     - 新建故事 from a workspace lands on the new intake workspace, not on 正在打开制作流程….
7. **Reader.**
   - **Initial:** 1440 × 900, 书架, open the completed story.
   - **Actions:** open the 分镜列表 side panel; press ArrowRight and ArrowLeft; scroll the wheel on the stage; click frame 3 in the panel; press Escape twice.
   - **Expected:**
     - Paging works while the panel is open.
     - The artwork's box is fully inside the stage, and it is taller than at 480px width.
     - The panel click goes to page 3.
     - The first Escape closes the panel, and the second returns to 书架 (the tab the story was opened from).
     - Caption line length stays within 30em, with and without 大一点的文字.
   - **Medium (900 × 800):**
     - 分镜列表 opens as a drawer over the stage.
     - ArrowRight still pages while the drawer is open.
     - Resizing to 1100 docks the panel and shrinks the stage, keeping the page index.
     - While the drawer is open, the stage is never inert: the drawer covers the stage's right edge, so a click on the uncovered left edge turns back a page, and the arrow keys keep paging.
8. **Dialogs.**
   - **Initial:** 1280 × 800.
   - **Actions:**
     - From 我的, open 生成服务与模型, 舒服地读 and 已删除的故事.
     - From the library detail panel, open rename, 署名与转载 and delete, then cancel each.
     - In the intake workspace, open setup's 修改故事 and 故事原文.
     - Trigger a toast.
   - **Expected:**
     - Each opens as a centered dialog.
     - In the provider dialog, model and key fields are at least 280px wide, and save/check stay visible after scrolling.
     - Nothing is saved.
     - The toast is visible and does not overlap the top bar.
     - The desktop 我的 groups are laid out in two columns.
9. **Tier boundaries.**
   - **Initial:** 767, 768, 1023, 1024, 1279, 1280 and 2560 wide.
   - **Expected:**
     - 767 shows the phone tree and 768 the shell with the top bar.
     - At 1023 / 1024, the library details and reader panel switch between drawer and docked, and create and 我的 between stacked and two-column.
     - At 1279 / 1280, the workspace switches between strip-plus-preview and three panes.
     - At 2560, content is capped at 1440px and centered.
     - No width scrolls horizontally, and no control is clipped on any view.
10. **Resize keeps state.** Each case below goes 1280 → 390 → 1280.
    - **Cases:**
      - Rotation: 1133 × 744 → 744 × 1133 → 1133 × 744, with the rename dialog opened from the workspace's 制作流程 section (修改故事名) and text typed into it. At 744 the 故事设置 sheet remounts underneath, and rename is still the topmost `dialog[open]`, with its focus and input. Back at 1133 it is still topmost.
      - In the workspace with 修改故事 on frame 2 at 1280: the right pane shows frame 2's issues. Changing the editor's 选择分镜 to frame 1 moves the frame list and right pane to frame 1.
      - In the workspace, with 修改故事 holding unsaved 旁白 text.
      - On the create page, with a typed custom theme.
      - In the intake workspace, with a title typed in setup's 输入标题.
      - In the reader at page 4.
    - **Expected:**
      - At 390 the matching sheet is open. At 1280 the matching workspace section or create page is open.
      - The typed text is unchanged every time.
      - No 另一台设备更新了制作内容 notice appears.
      - The page index is kept, and wheel paging works after the resize.
11. **Width sweep (natural transitions).**
    - **Initial:** 发现, 书架, 我的, the completed story's workspace (修改故事 on frame 1), the create page, and the reader with the side panel open.
    - **Action:** for each view, step the viewport from 320 to 2560 in 16px steps at 900px height.
    - **Records at each step:**
      - `scrollWidth` against `clientWidth`;
      - the main content area width: the outer container, not inner panes. This is the first `[data-main]`: the phone content column, the phone reader, the shell main area, or the shell reader layout (stage plus side panel; the stage is a pane that narrows when the panel docks). For phone sheet views it is the union width of the topmost open sheet's children (`.yu-sheet > *`);
      - the computed font size of the body text and the main heading;
      - occlusion: for each visible, non-inert interactive element, `elementFromPoint` at its center returns the element or one of its descendants. Intentional layering, such as reader controls over the full-stage swipe surface or card actions over a cover, passes because the top element is the one measured;
      - clipping by the element's scroll container.
    - **Expected:**
      - There is never horizontal scroll, occlusion or clipping.
      - Content width never decreases as the viewport increases.
      - No font size changes by more than 2px between adjacent steps. The sweep runs at 900px height, so the height-based phone rules (`max-height:720/740/800px`) do not apply.
      - The view's tree changes (detected by a `data-layout` attribute on `.yu-world`: `phone`/`shell`) only between 752 and 768.
      - A second sweep at 1280px wide steps the height from 400 to 900. `data-layout` changes only between 544 and 560.

## Covered elsewhere

These criteria are covered by tests other than the scenarios above:

- **Shelf behavior** (production-row order, collapse and show-all, 全部/收藏, grouping): existing `tests/shelf-layout-ui.test.mjs`, `shelf-retry-ui.test.mjs` and `shelf-art-style.test.mjs`. That shelf behavior is unchanged, and the desktop-only `onSelect` is covered by the new M2 render tests.
- **Phone touch:**
  - Swipe and wheel direction logic: existing `tests/reader-interaction.test.mjs`.
  - 16px coarse-pointer form text and safe-area insets: no test covered these before this story.
    - Existing stylesheets change only in their widened `max-width:540px` conditions. The plan's one-off check normalizes those conditions back and requires byte equality with `READABILITY_BASE` for `client/*.css`, excluding the four new files. Git's `*` also matches `/`, so this covers `client/styles.css`, which holds the 16px rule.
    - Scenario 1 runs a `hasTouch` context at 390, and scenario 3 one at 900. Both assert that form inputs compute `font-size:16px`.
- **Workspace sections** (frame count, generation controls, 审核记录, tabs hidden when their entry is unavailable): the M3 `StoryWorkspace` render tests.
- **Derived view and top-bar exit paths:** the `lib/desktop-view.ts` unit tests.
