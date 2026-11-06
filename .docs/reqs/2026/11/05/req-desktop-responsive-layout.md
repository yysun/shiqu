# Responsive redesign of the reader app (small, medium, large)

The reader app (`client/`) is designed for phones. Above 540px it shows the same 480px column centered on a grey background, with a bottom tab bar and bottom sheets. On tablets and desktops, everything after a tap opens another sheet: story settings, the production flow, 修改故事, 分镜剧本, 制作要求, 审核记录, 原文 and the creation form, often stacked on each other.

The computer's browser is where users create and review stories. The desktop app is only a service console that opens this browser UI, and 生成服务与模型 can only be changed from the computer. The heaviest work therefore happens through a phone-width stack of modal sheets on a large screen. Between phone and desktop widths (large phones, foldables, tablets, narrow windows) the app is a floating phone card, so there is no natural progression from small to large.

Widening the column is not enough. Larger screens need layouts in which related information stays on screen together. Those layouts should grow and shrink naturally across small, medium and large widths, rather than jumping between a phone card and a desktop page.

## Outcome

The reader app adapts naturally across three width tiers:

- **Small** screens keep today's phone experience.
- **Medium** and **large** screens get four redesigned layouts inside a shell with a top navigation bar:
  1. a **library** with a story detail view;
  2. a **story workspace** for production, review and editing;
  3. a **create** page;
  4. a **reader** that uses the window.

  The 我的 page is adapted to fit the shell.
- Moving between widths changes the layout progressively. Panes reflow, collapse into drawers or strips, or expand. Content never jumps to a narrower or unrelated arrangement.

## Definitions

- **Small:** a viewport narrower than 768px, or shorter than 560px.
  - 320–540px wide is today's phone UI.
  - Any other small viewport (541–767px wide, or a short window such as a phone in landscape) is the same phone UI shown full-bleed, instead of today's floating 480px card.
- **Medium:** at least 768px wide and 560px tall, up to 1279px wide. The redesigned layouts, condensed to fit.
- **Large:** at least 1280px wide and 560px tall. The redesigned layouts in full, with content capped and centered on very wide screens.
- **Structural switch:** a change between the phone UI and the redesigned layouts. It happens only when the viewport crosses 768px wide or 560px tall.
- **Reflow:** a change of arrangement within the redesigned layouts (for example a pane becoming a drawer). It happens at 1024px and 1280px wide, and it does not reload views or lose state.
- **Main content area:** the outermost content container of the current view: the phone content column or sheet in the phone UI, and the shell's main area in the redesigned layouts. Panes inside it may narrow when a side panel docks.

## Acceptance criteria

### Small: phone layout preserved and extended
- [x] At 320–540px, every screen, sheet and the reader look and behave as they do at `READABILITY_BASE` (the phone-readability delivery commit; see Non-goals). Verify by comparing before and after at 360, 390 and 430px for 发现, 书架, 我的, the creation sheet, the story settings and production sheet, 修改故事, and a reading page.
- [x] At every other small viewport (541–767px wide, or shorter than 560px, as on phones in landscape), the phone UI fills the window, with no floating card or grey margins and with the tab bar and sheets spanning the width. Type and spacing match the 540px phone UI. Content sits in a centered column of bounded width, and the 发现 books show without sideways scrolling, with more per row as width allows. Every phone behavior is unchanged.
- [x] Touch behavior is preserved at every tier, including tablets in the medium tier: swipe paging, controls at least 44px under coarse pointers, 16px form text on coarse pointers, and safe-area insets.

### Natural transitions across widths
- [x] Sweeping the window from 320px to 2560px in steps of 16px or less:
  - produces no horizontal scrolling, overlapping or clipped controls;
  - never makes the main content area narrower as the window gets wider (panes inside it may narrow when a panel docks);
  - changes structure only at 768px.
- [x] Spacing, type size, grid columns and pane widths scale fluidly within each tier. No text size changes by more than 2px across any width breakpoint. Today's height-based phone rules (shorter reader captions on short screens) are exempt.
- [x] Layout reflows at 1024px and 1280px, in either direction, happen without losing anything. Open views, drafts, selection, scroll position within panes and focus stay as they are. A reflow never opens a drawer by itself. A docked panel that becomes a drawer while narrowing stays closed until the user opens it, except the reader's non-modal side panel, which stays open. Focus that was inside a docked area being hidden moves to the control that reopens it.

### Shell (medium and large)
- [x] 发现, 书架 and 我的 are always reachable from a horizontal navigation bar at the top of the window, which also offers 新建故事.
  - The bar stays visible while the page scrolls, including while the create page or a story workspace is open. The immersive reader is the one exception: it keeps its own back button.
  - Choosing a section or 新建故事 from the bar leaves the current create page or workspace and goes there.
  - The active item reflects what is shown.
  - The bar never covers content, including keyboard-focused elements.
- [x] Content uses the window width up to a bounded maximum. Text does not exceed about 45 Chinese characters per line. Covers and artwork keep their aspect ratio and never grow to fill the screen.
- [x] Dialogs that remain modal open as centered dialogs: delete confirmation, rename, 署名与转载, 已删除的故事, 舒服地读, 生成服务与模型, 替换选题, 作品还未署名, and the creation setup's 修改故事, 重新选择故事 and 故事原文. Today they are bottom sheets.
- [x] Toasts, undo notices and inline status messages stay visible, and they do not overlap the navigation or the control they refer to.

### 1. Library (书架)
- [x] Readable stories form a multi-column grid of equal-size cards. The number of columns follows the available width.
- [x] Selecting a readable card shows the story's details without leaving the shelf.
  - At 1024px and wider, the details show in a panel beside the grid. Below 1024px, they show in a drawer over the grid that can be dismissed.
  - The details show the cover, title, book, theme and style, reading progress, generation status and controls (pause/resume/retry).
  - They offer every action available for that story today: read or continue, open the story workspace, download (PDF/PNG/ZIP), favorite, rename, 署名与转载 and delete.
- [x] Selecting works with mouse and keyboard (click or Enter). Reading starts from the card's 继续阅读/重读 control or the details' read action, and it behaves as today.
- [x] Unfinished productions stay in their own region above readable stories, with today's ordering, collapse and show-all behavior. Opening one goes to its story workspace.
- [x] Search, 全部/收藏, grouping, refresh and 新建故事 work as today. The selection is cleared when the selected story is filtered out or deleted.

### 2. Story workspace
- [x] Everything that today opens from 故事设置 or the production flow is one full-page workspace for that story, not stacked sheets:
  - the production timeline and its stage actions;
  - creation setup and story choice;
  - frame count;
  - generation status with pause, resume and retry;
  - review tools;
  - 修改故事 (all editor tabs);
  - 分镜剧本, 审核记录 and 原文 (制作要求 is a tab of 修改故事);
  - title, downloads and 署名与转载.

  Focused sub-tasks started from inside a section open as centered dialogs over the workspace (see the shell criteria).
- [x] Once a story has a storyboard, its frames are listed in the workspace. Selecting a frame shows that frame's artwork (or its drawing state), caption and review issues next to the editor for that frame. How much is visible together depends on the tier:

  | Viewport | Visible together |
  |---|---|
  | 1280×800 (large) | frame list, editor, artwork and review issues |
  | 1024×768 | frame selection, editor and review issues; artwork at least as a thumbnail |
  | 768×1024 (medium portrait) | frame selection and editor; review issues and artwork one tap away without leaving the editor |
- [x] Switching between the workspace's sections keeps unsaved revision drafts, as closing the revision sheet does today.
- [x] Leaving the workspace returns to where the user came from (library, reader or 发现). The draft rules are the same as today.
- [x] Every action reachable today keeps its label and calls the same handler. No action is added or removed.

### 3. Create (新建故事)
- [x] Starting a story at medium or large width opens a create page instead of a sheet. Starting points are a book on 发现, a mood, 不挑了, 新建故事 and the ending page's 开启下一篇.
- [x] The book and mood choices stay visible with the discovery form (original scope, theme, custom theme, custom book). At 1024px and wider they sit beside the form; below 1024px, above it. Changing the book or mood updates the form without closing it.
- [x] Submitting starts the same discovery as today. The next steps (candidate stories, setup and confirmation) continue in the story workspace.
- [x] 发现 at medium and large widths shows recent stories, books, moods and 不挑了, without requiring sideways scrolling to see every book.

### 4. Reader
- [x] The artwork is shown as large as the window allows, without cropping, and on dark surroundings consistent with today's reader.
- [x] An optional side panel shows 分镜列表 or 原文.
  - At 1024px and wider it docks beside the artwork. Below 1024px it opens as a drawer over the artwork.
  - While it is open, paging with the keyboard (arrow keys), mouse clicks and the wheel keeps working.
  - Selecting a frame in the list turns to it.
- [x] Captions keep a readable size and line length, with and without 大一点的文字.
- [x] The reader's header actions keep their current behavior: back, favorite, the book-reference star, 故事设置 (opens the workspace), the review notice, and the ending surface with downloads and 开启下一篇.

### 我的 (profile)
- [x] The profile overview, story management and preference groups use two columns at 1024px and wider and one column below, and every entry opens the same dialog or flow as today.

### Resizing
- [x] Resizing or rotating across the structural switch keeps the following:
  - the current section and the open story;
  - the open view (a workspace section maps to the matching phone sheet and back);
  - the reading position;
  - unsaved revision drafts;
  - unsubmitted input in the creation form and creation setup, including the setup's title search, without a false 另一台设备更新了制作内容 notice;
  - any open modal dialog (for example rename) stays on top and usable after the switch.

  Exception: the 作品还未署名 download confirmation closes on the switch. It holds no user input, and the user can reopen it by clicking the download again.

### Interaction quality (medium and large)
- [x] Interactive elements have visible hover and keyboard focus states. The library, workspace frame list and reader side panel can be used with the keyboard alone, including their drawer forms.
- [x] The UI keeps the existing visual language (palette, serif headings, card radius, iconography).

## Verification

VR passed: all acceptance criteria complete. The code is on `main` from `2bf2b42` to `2780875`, with base `cb5241a`. The E2E evidence is in `.data/e2e/drl-vr` (all 13 desktop cases pass) and `.data/e2e/drl-final` (readability).

| Criterion | Status | Evidence |
|---|---|---|
| 320–540px unchanged from `READABILITY_BASE` | Complete | Every existing stylesheet is byte-identical to `cb5241a` once the widened condition is normalized back. DRL-01 screenshots at 360/390/430 are pixel-identical to the M0 baseline for 发现, 书架, 我的, creation, reader and 故事设置. The phone readability E2E passes on every state, and `story-lifecycle` passes 10/10 on the phone tier. |
| Other small viewports full-bleed | Complete | DRL-01 at 600, 767, 844×390 and 932×430: the app is full width; the column is ≤600px and centered; books form a grid with more per row than fit at 430; the heading size equals 540px at the same height; the landscape caption is ≤30em; the layout is `phone`. |
| Touch preserved at every tier | Complete | Swipe and edge paging: `reader-interaction` unit tests and the readability E2E. Coarse-pointer 44px targets and 16px form text: DRL-01 at 390 and DRL-03b at 900 (top-bar and drawer controls ≥44px, inputs 16px). Safe-area rules are unchanged (byte equality). |
| 320–2560 sweep | Complete | DRL-11 covers six views every 16px at 900 high: no sideways scroll, occlusion or clipping; the main area never narrows; structure changes only between 752 and 768. The height sweep at 1280 changes only between 544 and 560. |
| Fluid sizes, ≤2px jumps | Complete | DRL-11 measures the 发现 heading and note, the 书架 heading, the 我的 group heading, the workspace field, the create choice label and the reader caption at every step, with no jump over 2px. |
| Reflows at 1024/1280 lose nothing | Complete | DRL-03: selection and focus are kept, and the drawer never opens by itself. DRL-04: text, frame and editor scroll are kept, and focus moves to 画面与审核. DRL-07: the reader panel stays open while docking, and the page is kept. |
| Top bar | Complete | DRL-02: sticky and visible after scrolling; the first row and the Shift+Tab-focused card sit below it; every item leaves create, workspace and reader; `aria-current` is correct; 返回修改书籍 → 书架 lands on the library; reader → 故事设置 → 新建故事 → 发现 ends at `/`. |
| Bounded width, 45-character lines, covers | Complete | DRL-09: 2560px is capped at 1440 and centered. Shell paragraphs are capped at 45em. Covers keep their aspect ratio (`object-fit:cover` on fixed-ratio cards, `contain` for reader artwork). |
| Centered dialogs | Complete | DRL-08: 舒服地读, 已删除的故事, rename, 署名与转载, delete, 作品还未署名, 替换选题, and setup's 修改故事, 故事原文 and 重新选择故事, all centered. 08b: 生成服务与模型, widened, fields ≥280px, save visible after scrolling. |
| Toasts and undo | Complete | DRL-08: the favorite toast and the delete undo notice are visible and clear of the top bar. |
| Library grid, details, keyboard, productions, filters | Complete | DRL-03: a multi-column grid; details docked at 1024 and up, a drawer below, with every action; click or Enter selects; 继续阅读 opens; filtering clears the selection. DRL-02: a production row opens the workspace. Shelf unit tests: ordering, grouping and selection clearing on delete. |
| Workspace sections, frame visibility, drafts, leaving | Complete | DRL-04 at 1280×800, 1024×768 and 768×1024 checks visibility against the table. Drafts survive section switches; 返回 → 书架 with the story selected. DRL-05: from the reader into 制作流程 and back to the same page. Sections reuse the existing components and handlers (render tests, lifecycle E2E). |
| Create page | Complete | DRL-06: opened from a book, 不挑了 and 新建故事, and DRL-07 from the ending's 开启下一篇. Choices sit beside the form at 1024 and up and above it below (DRL-09). A left-side book re-initializes the form; the form's own picker doesn't remount it; a mood sets the theme. Submitting sends the same request and continues in the workspace; 返回修改书籍 edits update the same intake. 发现 needs no sideways scrolling (DRL-11). |
| Reader | Complete | DRL-07: the artwork sits inside the stage and is taller than at 480px; the side panel is docked at 1024 and up and a drawer below; keys, wheel and an edge click page with it open; a panel or keyboard selection turns the page; the caption is ≤30em with and without 大一点的文字; Escape closes the panel, then returns. The header actions are the unchanged reader markup (DRL-05 covers 故事设置). |
| 我的 | Complete | DRL-08 and DRL-09: two columns at 1024 and up, one below; entries open the same dialogs. |
| Resizing keeps state; 作品还未署名 exception | Complete | DRL-10: rename stays topmost with focus and input through 1133↔744 rotation; the workspace frame stays in step with 选择分镜; 旁白, the create custom theme and the intake title survive 1280→390→1280 with no false notice; the reading page is kept and wheel paging works after. The exception is documented in the REQ and plan. |
| Hover and focus; keyboard use of library, frames and side panel | Complete | `:focus-visible` and `(hover:hover)` rules in every desktop stylesheet. Keyboard: DRL-02 (Shift+Tab), DRL-03 (Enter-select, Escape-close with focus returned), DRL-04 (frame list Enter), DRL-07 (panel Enter). |
| Visual language kept | Complete | Same palette, serif headings, radius and icons. Screenshots at each milestone are in the plan records. |

**Constraints:**
- One reader app: the redesign reuses Reader's state and handlers and the existing components.
- URLs are unchanged: `open()` and `home()` are untouched, and DRL-02 checks `/`.
- Layout depends only on viewport media queries, not on any desktop-app or user-agent detection.
- Existing tests pass: `pnpm test` 667/667, and the browser E2Es pass after moving the phone-flow ones to 767px (recorded in the plan).

**Not verified:** Firefox and Samsung Internet on-screen keyboard resizing near the 560px height gate. Only Chromium is available.

## Constraints

- Keep one reader app. The redesigned layouts reuse the existing state, hooks, handlers, API calls and content components. There is no separate desktop app, build or duplicated workflow logic.
- Reader URLs (`/`, `/read?id=…`, `#provider-settings`) and their behavior stay unchanged, including links opened by the desktop console and phone QR access.
- Layout depends only on viewport size and container width. It does not depend on detecting the desktop (Tauri) app, the user agent, or local versus LAN access.
- Existing reader tests keep passing. Changes are limited to layout, presentation and where existing actions appear.

## Non-goals

- The Tauri desktop service console (`desktop/`).
- New features, new workflow steps, or changes to production/generation behavior, server APIs, storage or the CLI/skill.
- Redesigning the phone UI at 540px and below, or changing the visual identity. Phone improvements are split into two stories, as the user decided:
  - [req-phone-readability.md](req-phone-readability.md) lands **before** this story: 12px text, 44px targets, and removing the unreachable 制作要求 sheet. This story's phone baseline and byte-equality check are taken against its delivery commit, so "unchanged at 320–540px" means unchanged from that commit.
  - [req-phone-navigation.md](req-phone-navigation.md) lands **after** this story: back behavior and sheet depth.
- Native desktop conventions such as menus, multi-window or OS drag-and-drop.
- Exported formats (PDF, PNG long image, ZIP).
- Animating the structural switch. Only correctness and state preservation are required there.
