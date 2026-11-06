# Responsive redesign: small, medium and large

Requirement: [req-desktop-responsive-layout.md](../../../reqs/2026/11/05/req-desktop-responsive-layout.md) · Plan: [plan-desktop-responsive-layout.md](../../../plans/2026/11/05/plan-desktop-responsive-layout.md) · E2E spec: [test-desktop-responsive-layout.md](../../../tests/test-desktop-responsive-layout.md)

## Summary

- **Small (under 768px wide or under 560px tall):**
  - 320–540px is unchanged.
  - Wider phones and short windows show the phone UI full-bleed, with a centered 600px column instead of the floating 480px card. Books show in a grid.
  - The old `max-width:540px` conditions were widened to the exact complement of the desktop switch, and `compact.css` loads last.
- **Medium and large (768×560 and up):** a shell with a sticky top bar (发现 · 书架 · 我的 · 新建故事) and four redesigned layouts. They reflow at 1024px and 1280px, and content is capped at 1440px.
  - **Library:** a grid with a story detail panel, docked from 1024px and a drawer below that, with every story action.
  - **Story workspace:** one page instead of stacked sheets, with section tabs, a frame list, the editor, and the selected frame's artwork, caption and review issues. Three panes from 1280px; a strip plus a preview drawer below that.
  - **Create page:** book and mood choices beside an inline discovery form.
  - **Reader:** the artwork fills the window, with a non-modal 分镜列表 or 原文 side panel.
  - **Dialogs and 我的:** dialogs are centered, and 我的 uses two columns from 1024px.
- **One state owner:** `Reader.tsx` keeps every piece of state and every handler. The desktop view is derived from its flags (`lib/desktop-view.ts`). Drafts survive layout switches through `useRetainedState`, and open dialogs stay on top across the switch.

**Commits on `main`:**
- `2bf2b42` foundation;
- `f44b6c3` library;
- `3f3331b` workspace;
- `1ffc294` create;
- `41fe84b` reader;
- `5a9acff` E2E and fixes;
- `76bf9de` review fixes;
- `2e62c2e` phone-tier viewport for the existing browser E2Es;
- `2780875` remaining E2E checks.

## Verification

- `tests/desktop-responsive-layout.playwright.e2e.mjs`: 13/13 pass, including a sweep every 16px from 320 to 2560 and a height sweep with zero failures.
- `tests/phone-readability.playwright.e2e.mjs` passes 2/2. `story-lifecycle` passes 10/10, and `story-discovery-modes`, `reader-startup` and `story-storage-consolidation` pass.
- `pnpm test` passes 667/667; `pnpm typecheck` and `pnpm lint` are clean.
- At 360, 390 and 430px the phone UI is pixel-identical to the base, and the stylesheets are byte-identical once the widened condition is normalized back.
- In-app browser with isolated readonly data, at 390–1920px: the correct tier at every width and no sideways scroll.

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

## Notes

- **Bugs found and fixed during the work:**
  - Nested sheets and surviving shared dialogs were covered after a layout switch. The cause is effect ordering, which `StrictMode`'s re-run makes worse. `Sheet` now re-raises sheets nested inside it, and Reader re-raises shared dialogs on the next frame.
  - A stale `inert` dropped focus when narrowing.
  - Leaving a workspace opened from the library landed in the reader.
  - On the desktop create page reached through 返回修改书籍, picks in the left-hand choices started a new story instead of editing the existing one. The code review caught this.
- **Existing browser E2Es moved to 767px.** `storyBrowser` now defaults to 767×1000, and `story-discovery-modes` uses 767 where it used 1280. These tests verify the phone sheet flows, which the old 1280px window showed in a card. The desktop layouts have their own E2E.
- **Seed realism:** a finished story only shows review issues while its review is blocked. The workspace E2E therefore seeds a caption revision whose re-review blocks, keeping its artwork.
- **Accepted limitations:**
  - **Phone setup drafts:** on phones, the creation setup can keep unsaved edits across a brief session hiccup.
  - **Focus after a nested re-raise:** after a layout switch, the cursor lands on the nested sheet rather than in its field. The field's text is kept.
  - **Untested browsers:** Firefox and Samsung Internet behavior with the on-screen keyboard near the 560px height gate was not checked; only Chromium is available.
- **Readability E2E:** its layout checks now stay on the phone tier (320–767px), because desktop widths are covered here.
- **Next story:** phone navigation (back behavior and sheet depth) builds on this state model.
- **Not yet committed:** the story docs (REQ, plan, E2E spec and this note). Final delivery (GC) was not run, and nothing is pushed.
