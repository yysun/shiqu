# Phone readability E2E

Command: `node --experimental-strip-types --test tests/phone-readability.playwright.e2e.mjs`. It also runs in `pnpm test:e2e`.

Setup:
- `storyBrowser` (the production app behind the dev proxy, controlled inference, an isolated retained library) in headless Chromium.
- Context options `{viewport:{width:390,height:844},hasTouch:true,isMobile:true}`.
- Widths change with `page.setViewportSize` at a height of 844, without reloading.
- `auditPhone(page)` from `tests/fixtures/phone-audit.mjs` measures each state. The plan defines its outputs: `text`, `targets`, `contrast` and `layout`.
- Evidence: screenshots and the audit JSON per state and width, in `.data/e2e/<run>/phone-readability`.

**Audit widths:**
- **Full audit** (`text`, `targets`, `contrast` and `layout`): 360, 390 and 430.
- **Layout only:** 320, 540, 600 and 767. These are all phone-tree widths. Since the responsive redesign, 768×560 and up is the desktop shell, which `tests/desktop-responsive-layout.playwright.e2e.mjs` covers. Staying below the switch also avoids the agreed exception that 作品还未署名 closes when the layout changes.
- Before each measurement the audit waits for finite animations to finish (for example a sheet fading in), so contrast is never measured mid-fade.

**Expected in every state, at every audit width:**
- `text` is empty.
- `targets` has no failure.
- `contrast` has no entry under 4.5:1 and no "no backing" entry. That covers raised text, plus the fixed over-artwork set wherever it is visible.
- In `layout`:
  - no horizontal scroll in the document or the open dialog;
  - no clipped control and no overlapping control pair;
  - any truncated element is on the baseline title allowlist recorded in the plan at M0.

1. **发现 and 我的 with an empty library.**
   - **States:** 发现; 我的; 舒服地读.
   - **生成服务与模型:** a second test case in the same file. It uses the disposable checkout and the real dev server, because only the local dev proxy's private proof opens this dialog. The dialog is audited closed and again with 推理档位 open.
   - **Expected:** the avatar and switch are measured as targets.
2. **Creation.**
   - **Actions:** open 新建故事; choose 庄子; choose the 其他 theme and type a custom theme; open the scope details.
   - **States:** the creation sheet before and after those choices.
   - **Expected:** option chips have non-intersecting 44×44 boxes.
3. **Intake setup.**
   - **Actions:** submit; in 故事设置 open 输入标题 and type a title; start extraction; wait for candidates; choose 乌龟报恩 to reach confirmation.
   - **States:**
     - 故事设置 idle;
     - the title input;
     - the candidate list;
     - confirming, including the style picker, frame count and the 制作要求 link;
     - the setup's 故事原文, 修改故事 and 重新选择故事 sheets, each opened and closed without saving.
4. **Generation in progress.**
   - **Actions:** set `f.control.hold=true` and click 开始制作.
   - **States:**
     - 故事设置 with the production timeline;
     - 书架 with the unfinished production row;
     - 发现 with the empty hero (`.yu-feature-empty`), because nothing has been read and no image exists yet;
     - the reader's drawing state. Its header entries are plain-backdrop entries over the stage color.
   - **Expected:** `.production-stage-state` computes at least 12px.
   - Then release the hold and wait for completion.
5. **Completed story.**
   - **States:**
     - 书架 with the readable card, its actions and its cover-overlay actions;
     - 故事设置 with downloads, review tools and 署名与转载;
     - the 作品还未署名 confirmation, from the first download click while no publication defaults exist, then cancelled;
     - the story's 署名与转载 editor, closed without saving;
     - 替换选题 opened from 故事设置, waiting at 开始提取, then cancelled with 取消替换 (as in `story-lifecycle` C005);
     - rename;
     - 分镜剧本;
     - 审核记录;
     - 修改故事, on each of its tabs (制作要求, 验收要求, 画风, 叙事详略, 分镜);
     - the delete confirmation, cancelled.
   - **Expected:**
     - The 制作要求 tab still shows the saved production prompt, so the removed sheet's content stays reachable.
     - 替换选题's unstyled 取消替换 button passes the target check.
     - The shelf cover badge has a contrast entry measured against its own backing.
6. **Reader.**
   - **Actions:** open the story; open 分镜列表 and close it; open 原文 and close it; then page to the ending.
   - **States:** a reading page; 分镜列表; 原文; the ending surface.
   - **Expected:**
     - `.yu-reader-title>.yu-style-label>span` computes at least 12px at 360, including under the `max-width:380px` rule.
     - **On the reading page:** the caption, header title and meta, style labels and scene number all have contrast entries. Each is paired with the current `.yu-scene` by rect intersection, and measured against `.yu-reader-top::before` or `.yu-scene-caption::before`.
     - **On the ending:** the caption is not rendered, and the header's entries are plain-backdrop entries.
   - **Then, back on 发现:** the recent-story hero shows the read story.
     - Its text is paired with `.yu-feature>img` and measured against its backing stack.
     - Its controls are measured as targets once two read stories with images exist. M0 records how the fixture reaches that state.
     - **Edge taps and swipes:**
       - a click at the stage's right edge at mid-height goes to the next page;
       - one at the left edge goes back;
       - a horizontal pointer drag of 120px from the stage center turns the page;
       - a center tap toggles the metadata.
     - The page index changes exactly once per action. This checks that enlarged controls do not take edge taps or swipes.
7. **Review issues.**
   - **Actions:** at test start, save the fixture's original `f.control.beforeText` once. Create a second story. Wrap that original handler so the first `review` call returns one caption issue on page 1 (as in `story-lifecycle`), and every other call goes to the original handler. Wait for the review to stop.
   - **States:**
     - 故事设置 with review tools listing the issue;
     - 审核记录 with the issue entry;
     - the reader showing the 审片还有… notice. To reach it, edit page 1's caption on the completed story (查看分镜 → 修改分镜 → 旁白 → 完成编辑 → 开始制作). The revision keeps its images, and its re-review is blocked by the issue.
8. **Failure and recovery.**
   - **Actions:** create a third story. Replace scenario 7's wrapper with a new wrapper around the saved original handler, so that `review` throws and all other calls go to the original, which also answers `recommend`. The two review behaviors never stack. Wait for the failed review.
   - **States:**
     - 故事设置 with the retry control;
     - 书架 with the shelf retry.
9. **Deletion and profile defaults.**
   - **Actions:** delete the third story from 书架 and let the undo notice expire. Open 我的 → 已删除的故事. Then open 我的 → 署名与转载 and close it without saving.
   - **States:** the undo notice; 已删除的故事; the profile 署名与转载 defaults.
   - **Expected:** the undo notice's action is measured as a target.

## Covered elsewhere

- **Declared font sizes everywhere,** including rare error variants: `tests/phone-readability-css.test.mjs`, the static guard. It finds no px font-size below 12px outside the book-cover lettering. It does not cover targets, contrast or browser-default sizes. Those are proven only in the states above, which include every dialog reachable from the phone UI.
- **`.yu-recovery-detail`:** the static guard. It renders only while a fault is being retried automatically, a passing state the fixture cannot hold. Its only control is a full-width disclosure row.
- **Swipe and edge-tap direction logic:** `tests/reader-interaction.test.mjs`.
- **Removal of the dead sheet:** M1's grep, plus `pnpm typecheck` and `pnpm lint`. The static guard rejects any `.yu-saved-prompt` rule.
- **Before/after visual comparison** at 360, 390 and 430: one-off SS evidence (plan M3), not part of this repeatable test.
