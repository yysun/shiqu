# UI/UX audit: 拾趣修订流程-按钮与实测截图.pdf

Audited 2026-11-27 with `audit-ui-design` 1.2.0. The baseline PDF was the version at `7d60bd5e`. Start with the [verified captures](#retaken-screenshot-set) or the [rebuilt guide](拾趣修订流程-按钮与实测截图.pdf). The [original standalone screenshots](#screenshot-evidence) are available for comparison.

This is a dated review record. The [fix requirements](../../../../reqs/2026/11/27/req-revision-ui-review-fixes.md) govern the changes and the next capture.

There are two layers here, and each gets its own verdict:

- **D: the PDF as a document**, meaning its layout, annotations, captions and how trustworthy it is.
- **A: the app UI shown in the screenshots**, meaning the revision editor and the production timeline.

## Retaken screenshot set

The 23 views below show the fixed app at `e4fbed88`. They were captured in the ChatGPT in-app browser at 1280 × 900 CSS px and device pixel ratio 1, using an isolated book library and controlled model responses. Before each capture, focus and hover were cleared and the workflow state was checked. The earlier pre-fix recaptures are in [screenshots-retaken](screenshots-retaken/).

| Page | First state | Second state | Third state |
|---|---|---|---|
| 1 · Overview | [Save disabled](screenshots-verified/01-save-disabled.jpg) | [Save enabled](screenshots-verified/01-save-enabled.jpg) | |
| 2 · Production requirements | [Edit](screenshots-verified/02-01-production-requirements-edit.jpg) | [Storyboard waiting](screenshots-verified/02-02-storyboard-awaiting-continue.jpg) | [Storyboard running](screenshots-verified/02-03-storyboard-running.jpg) |
| 3 · Acceptance requirements | [Edit](screenshots-verified/03-01-acceptance-requirements-edit.jpg) | [Review waiting](screenshots-verified/03-02-review-awaiting-continue.jpg) | [Review running](screenshots-verified/03-03-review-running.jpg) |
| 4 · Narrative detail | [Edit](screenshots-verified/04-01-narrative-detail-edit.jpg) | [Replan waiting](screenshots-verified/04-02-replan-awaiting-continue.jpg) | [Frame-count review](screenshots-verified/04-03-frame-count-review-running.jpg) |
| 5 · Art style | [Edit](screenshots-verified/05-01-art-style-edit.jpg) | [Conversion waiting](screenshots-verified/05-02-style-conversion-awaiting-continue.jpg) | [Conversion running](screenshots-verified/05-03-style-conversion-running.jpg) |
| 6 · Delete a frame | [Delete preview](screenshots-verified/06-01-delete-frame-preview.jpg) | [Ending update waiting](screenshots-verified/06-02-ending-awaiting-continue.jpg) | [Ending update running](screenshots-verified/06-03-ending-running.jpg) |
| 7 · Production after continuing | [Targeted revision](screenshots-verified/07-01-targeted-revision-running.jpg) | [Recheck](screenshots-verified/07-02-recheck-running.jpg) | [Drawing](screenshots-verified/07-03-drawing-running.jpg) |
| 8 · Pause and review notes | [Review paused](screenshots-verified/08-01-review-paused.jpg) | [Edit review notes](screenshots-verified/08-02-review-notes-edit.jpg) | [Revised review waiting](screenshots-verified/08-03-revised-review-awaiting-continue.jpg) |

## Post-fix verification

| Check | Result |
|---|---|
| Editor hierarchy · VH01, CS03 | The two Save states each measure 132 × 48 CSS px with 14 px text. Cancel remains available. The guide uses equal 227 × 63 pt image slots for the same crop. |
| Step actions · VH01, VH05, CS02 | Continue, Pause and Resume are underlined links with transparent backgrounds, zero border and no outline in default and hover. Tab gives Continue a visible focus outline. [Keyboard focus](screenshots-verified/keyboard-focus.jpg) |
| Waiting and pause · IC06 | The waiting review shows an arrow, the paused review shows the pause glyph, and Resume restarts the same review. The distinct actions stay in the active row. |
| Impact text · SI01, TY05 | The six-frame watercolor edit shows the selected card and one redraw total. The automated service-backed preview check retains the frame number for partial redraw. The detail editor distinguishes existing image loss from the future frame count without stranding 「准。」. |
| App layout · PX01, AL01, AL03, WS01–WS03, IC09 | Desktop controls remain inside their related editor or step. At 320 × 900, the review navigation group wraps together below the heading, its two links share a baseline, and all row actions end at x=287. The editor footer fits within the viewport. The document width stays 320 CSS px. [Narrow timeline](screenshots-verified/narrow-timeline.jpg) · [Narrow editor](screenshots-verified/narrow-editor.jpg) |
| PDF layout and accuracy · PX01, AL03, WS01, WS03, LY02, CS03 | Eight rendered pages were inspected. Screenshot tops match within each row and every timeline image is 234.33 pt wide. On page 1 the heading gaps above and below are 20.9 / 9.1 pt and 18.9 / 11.1 pt. The table note starts 12.5 pt below the table. Each current caption extracts once. The PDF contains 23 image objects from the verified captures. [Rebuilt guide](拾趣修订流程-按钮与实测截图.pdf) |

## Retaken hierarchy screenshots

Captured against `e43742b0` in the ChatGPT in-app browser at 1280 × 900 CSS px and device pixel ratio 1. The two editor captures show the same fixture before and after entering an acceptance requirement. The timeline shows the same review waiting, running and paused. Captures used the regular app with an isolated book library and controlled model replies.

| State | Capture | Verification |
|---|---|---|
| Save disabled | [01 · 尚未修改](screenshots-retaken/01-save-disabled.jpg) | Save measures 132 × 48 CSS px with 14 px text. It is greyed out and Cancel is available. |
| Save enabled | [02 · 修改有效](screenshots-retaken/02-save-enabled.jpg) | Save measures the same 132 × 48 CSS px with 14 px text. It has a solid fill and Cancel has an outline. |
| Saved revision waiting | [03 · 待继续](screenshots-retaken/03-awaiting-continue.jpg) | 「继续制作」 is an underlined link with a transparent background, a 0 px border and no outline. |
| Review running | [04 · 进行中](screenshots-retaken/04-running.jpg) | 「暂停生成」 has the same unfocused treatment inside the active row. |
| Review paused | [05 · 已暂停](screenshots-retaken/05-paused.jpg) | 「恢复生成」 has the same unfocused treatment inside the paused row. |
| Keyboard focus | [06 · 继续制作](screenshots-retaken/06-keyboard-focus.jpg) | Tab focus adds a visible outline around the same link shown in capture 03. |

The three default-state actions were unfocused and unhovered when captured. Keyboard focus reproduces a box around 「继续制作」. The source of the boxes in the older images remains unverified.

## Screenshot evidence

These are the 23 visible app images extracted from the audited revision before fixes. The numbers match the original page and card references. The images retain the source crops, resolutions and any outlines already present in the pixels.

| Page | First state | Second state | Third state |
|---|---|---|---|
| 1 · Overview | [Save disabled](screenshots/01-01-save-disabled.jpg) | [Save enabled](screenshots/01-02-save-enabled.png) | |
| 2 · Production requirements | [Edit](screenshots/02-01-production-requirements-edit.png) | [Storyboard waiting](screenshots/02-02-storyboard-awaiting-continue.jpg) | [Storyboard running](screenshots/02-03-storyboard-running.jpg) |
| 3 · Acceptance requirements | [Edit](screenshots/03-01-acceptance-requirements-edit.jpg) | [Review waiting](screenshots/03-02-review-awaiting-continue.jpg) | [Review running](screenshots/03-03-review-running.jpg) |
| 4 · Narrative detail | [Edit](screenshots/04-01-narrative-detail-edit.png) | [Replan waiting](screenshots/04-02-replan-awaiting-continue.jpg) | [Frame-count review](screenshots/04-03-frame-count-review-running.jpg) |
| 5 · Art style | [Edit](screenshots/05-01-art-style-edit.jpg) | [Conversion waiting](screenshots/05-02-style-conversion-awaiting-continue.png) | [Conversion running](screenshots/05-03-style-conversion-running.png) |
| 6 · Delete a frame | [Delete preview](screenshots/06-01-delete-frame-preview.png) | [Ending update waiting](screenshots/06-02-ending-awaiting-continue.jpg) | [Ending update running](screenshots/06-03-ending-running.jpg) |
| 7 · Production after continuing | [Targeted revision](screenshots/07-01-targeted-revision-running.jpg) | [Recheck](screenshots/07-02-recheck-running.jpg) | [Drawing](screenshots/07-03-drawing-running.jpg) |
| 8 · Pause and review notes | [Review paused](screenshots/08-01-review-paused.jpg) | [Edit review notes](screenshots/08-02-review-notes-edit.jpg) | [Revised review waiting](screenshots/08-03-revised-review-awaiting-continue.jpg) |

Manual review found that the rectangles around 「继续制作」 and 「暂停生成」 are already in some of the app images. Their source remains unverified. The shared link style draws an outline for keyboard focus. Check the live default, hover and keyboard-focus states before attributing the boxes to app styling. Capture the default, unfocused state for the guide. The fix requirements supersede F3’s proposal to add boxes. [Boxed link](screenshots/05-02-style-conversion-awaiting-continue.png) · [Unboxed link](screenshots/08-03-revised-review-awaiting-continue.jpg)

## Overall verdict

**D, the document: Needs revision.** The structure works and should stay: one change type per page, three steps in order, a caption under each, and a summary band at the bottom. Two things need fixing:

- **Stale text hidden under the patches (F1).** Five pages carry both the old and the new caption in the text layer. The old sentence on page 1 describes the cancel/close behaviour this commit fixed. Any agent or reader who copies or searches the PDF gets both versions.
- **Inconsistent screenshot scale, cropping and highlighting (F2, F3).** The same timeline appears at different sizes on different pages. The key action is boxed on some pages and not on others. The selected style is cropped out on page 5.

**A, the app UI: Meets expectations, with minor fixes.**

- The editor's primary and secondary buttons rank correctly: 保存修改 is solid dark green, 取消 is an outlined button, and 保存修改 is greyed out before any change.
- The timeline marks the current row with a tinted surface and a state icon, and each row's single action is placed inside that row.
- The main issue (F4): "paused" and "waiting to continue" share the same ‖ icon.

**Scope and limits.**

- This is a static review of the rendered PDF on screen. Keyboard behaviour, focus states and narrow widths could not be checked from screenshots.
- Rule citations come from the Playbook catalog (`references/ui-design-rules.md`). I did not open the original Playbook pages, because no finding depends on a threshold or a figure there.
- Every screenshot uses isolated-library fixture data. Strings such as "已保存 0 批候选" and "controlled" are fixture values, not production copy.

## Prioritized fixes

### F1. Major: hidden stale captions contradict the visible text (D)

- **Checks:** D-C1, D-C2.
- **Where:** the text layer of pages 1, 2, 4, 5 and 6.
- **Evidence (interface observation):** extracting the text with PDFKit returns the old caption and the new caption one after the other:
  - Page 1 contains both "取消或关闭编辑窗口会放弃未保存的修改" and "「取消」直接放弃…有修改时…会先询问".
  - Page 6 contains both "取消会放弃这次删幅" and "「取消」只放弃这次删幅，分镜剧本保持打开".
  - Pages 2 and 4 also keep the broken-line versions of their old captions.
- **Cause:** the patch painted new captions and images over the old ones instead of removing the old ones. The file grew from 1.1 MB to 1.5 MB, which fits old images also still being present, but I haven't verified that.
- **Principle:** CL01 (p. 13), since the document must not hold two contradicting states. This also falls under your rule that agents read every document as truth, and story-production-dag.md now links this PDF as a reference.
- **Impact:** search, copy-paste, screen readers and agents that read the PDF as text get the pre-fix behaviour next to the fix. Seeing someone actually misled by this is a hypothesis. The contradicting text itself is directly observed.
- **Scope / confidence:** Systemic / High.
- **Fix:** rebuild the 5 patched pages without the covered content. Better still, commit an HTML source and a build script for the PDF, so later updates regenerate it instead of overlaying.
- **Verify:** extract each page's text. Each caption should appear exactly once, and no pre-fix sentence should remain. The file size should drop back toward 1.1 MB.

### F2. Minor: screenshot scale, crop and frame vary across equivalent slots (D)

- **Checks:** D-C5, D-C6, D-C7, D-C8.
- **Where:**
  - **Page 1:** the two button-state crops (尚未修改 and 修改有效) are at different scales.
  - **Timelines:** page 5 uses a larger scale. In #02, the gap between successive stage numbers is about 15% larger than in the corresponding crops on pages 2–4 and 6.
  - **Editors:** the page 4 #01 editor is wider than the page 2 #01 editor and starts lower than its neighbours.
  - **Page 8:** the #02 dialog is vertically centred while the screenshots beside it are top-aligned.
  - **Frames:** pages 3 #01 and 5 #01 use a dark grey frame, page 6 #01 has a frame open at the bottom, and the rest have no frame.
- **Evidence (interface observation):**
  - On page 1, the left crop is upscaled and soft, while the right crop is small and sharp. The one comparison the section exists for, 保存修改 grey vs solid, ends up at two scales.
  - The tops of the screenshots sit at different heights in the page 4 and page 8 rows.
- **Principle:** AL03 (pp. 18–19), CS03 (pp. 41–42), CS01 (pp. 37–39).
- **Impact:** comparing states side by side is harder, and the patched pages look visibly different from the original ones. This weakens trust in "实测". The trust effect is a hypothesis.
- **Scope / confidence:** Repeated / High.
- **Fix:** capture every timeline at one viewport and one device scale factor. Place every screenshot top-aligned at the same width inside its slot, with one frame treatment (none, or a hairline). Crop both page 1 state images from the same region at the same scale.
- **Verify:** on each page, the screenshot tops share one line. The timeline type size matches across pages 2–6. Both page 1 crops show their buttons at the same pixel size.

### F3. Minor: annotations and crops don't always show the step's point (D)

- **Checks:** D-C9, D-C10, D-C11.
- **Where:**
  - **Page 5 #01 「确认新画风并保存」:** the crop starts below the style grid, so the selected 水彩绘本 card isn't visible.
  - **Page 3 #01:** the crop cuts the tab row in half.
  - **Pages 7 #01 and #02:** the crops cut a row at the top, and a row at the bottom ("返回书架").
  - **Highlight boxes:** 保存修改 is boxed only on page 3. 恢复生成 and 继续制作 on page 8 are unboxed, while every other step action on pages 2–7 is boxed.
- **Principle:** CL01 (p. 13), CS02 (pp. 39–40).
- **Impact:** a reader can't confirm what was chosen on page 5. The uneven boxing implies that the boxed actions differ in kind from the unboxed ones, which they don't.
- **Scope / confidence:** Repeated / High.
- **Fix:**
  - Recapture page 5 #01 so the selected style card and the impact text are both in frame. Shrinking the prompt textarea area would make room.
  - Crop the other screenshots on row boundaries.
  - Box exactly one action per screenshot, the one the caption names. That means adding boxes on page 8 and either removing the box on page 3 #01 or adding one to every #01.
- **Verify:** each screenshot shows the selection or the action its caption names, inside a box, and no row is cut.

### F4. Minor: "paused" and "waiting to continue" share one state icon (A)

- **Checks:** A-C6, A-C7.
- **Where:**
  - The timeline row's state icon.
  - Page 2 #02 (分批分镜 · 待继续), page 5 #02 (画风转换 · 待继续) and page 8 #03 (全篇审片 · 待继续) use the same ‖ glyph as page 8 #01 (全篇审片 · 已暂停).
- **Evidence (interface observation):**
  - The two states mean different things. 待继续 means a new version is waiting for authorisation. 已暂停 means the user stopped a run.
  - The two states also offer different actions: 继续制作 for 待继续, 恢复生成 for 已暂停.
  - Only the small status word and the link label tell them apart.
- **Principle:** IC06 (p. 103), since the current state must be visible. CO04 (p. 69), since state meaning should be carried by a distinct cue. Text is present here, so CO04 passes on colour alone, but the icon actively suggests the wrong state.
- **Impact:** after saving a revision, a user may read the step as paused. Whether users actually do is a hypothesis to check in one test session.
- **Scope / confidence:** Systemic (one component) / Medium.
- **Fix:** give 待继续 its own glyph in `ProductionTimelineRow`, for example a hollow ring or a "ready" marker. Keep ‖ only for 已暂停.
- **Verify:** at the same desktop width, page 2 #02 and page 8 #01 show different icons.

### F5. Minor: step names drift between captions and the UI (D)

- **Checks:** D-C12.
- **Where:** page 6. The UI row says 「拟定标题与结语」, the #02 caption says 「更新标题与结语」, and the #03 card title says 「更新结语和标题」. That is three wordings, in two orders.
- **Principle:** IC06 (p. 103), which favours consistent phrasing.
- **Fix:** use the UI's wording 「拟定标题与结语」 in both places.
- **Verify:** page 6 text uses one phrase.

### F6. Minor: sample content doesn't match the story shown (D)

- **Checks:** D-C13.
- **Where:**
  - The text typed on page 2 #01 and page 3 #01 is about 庄周梦蝶.
  - The page 8 #02 review note mentions 梦醒后的反应.
  - The stories shown in the timelines and on page 6 are 管鲍之交, and page 8 #01 is titled 「测试二 | 验收要求」.
- **Principle:** CL01 (p. 13), since the example should identify the object being edited.
- **Impact:** a reader may assume the requirement belongs to a different story. This is a hypothesis.
- **Fix:** on the next recapture, use requirement text that fits the fixture story, or caption it as placeholder text.

### F7. Polish: page 1 section headings sit closer to the block above than to their own content (D)

- **Checks:** D-C3, D-C4.
- **Where:** page 1, the headings 「编辑窗口里的主次按钮」 and 「继续制作出现的位置」. The gap above each heading is visibly smaller than the gap below it. The footnote also sits flush under the table.
- **Principle:** PX01 (p. 12), WS03 (pp. 27–28).
- **Fix:** increase the space above both headings so it exceeds the heading-to-content gap, and add space between the table and the footnote.

### F8. Polish: the impact note restates itself (A)

- **Checks:** A-C4.
- **Where:**
  - **Page 5 #01:** the note reads 「预计复用 0 幅，需绘制 6 幅。继续后将重绘第 1、2、3、4、5、6 幅。」 The second sentence repeats the first by listing every frame.
  - **Page 4 #01:** the last line wraps so that 「准。」 sits alone on its own line.
- **Principle:** SI01 (pp. 22–23), TY05 (pp. 80–81).
- **Fix:**
  - In `StoryRevisionEditor`, skip the frame list when every frame is redrawn, or say 「全部 6 幅」.
  - Shorten the 详略 sentence so it doesn't leave a two-character line.
- **Effort:** small (copy only).

### Out of scope for fixes

- The footer still says 「应用内浏览器实测」, although the replaced screenshots came from headless Chrome. This is a document accuracy note, not a UI rule. Either reword the footer to 「浏览器实测」 or recapture in the in-app browser.

## Component verification

### Layout and spacing recheck

Measurements use the existing PDF rendered at 2× and its image positions in PDF points. App results cover the captured desktop states.

| Component and location | Design rule | Result and evidence |
|---|---|---|
| PDF page 1 section headings | PX01 (p. 12), WS03 (pp. 27–28) | **Fail.** The first heading has about 11 pt above and 20 pt below. The second has about 11 pt above and 19 pt below. Both gaps visually attach the heading to the preceding block. |
| PDF page 1 table and note | WS01 (pp. 24–25), WS03 (pp. 27–28) | **Concern.** The note begins about 5 pt below the last table row. Give the note room to read as a related but distinct block. |
| PDF screenshot grid, pages 4 and 8 | AL03 (pp. 18–19), CS03 (pp. 41–42) | **Fail.** Page 4 #01 starts 17 pt below the other images in its row. Page 8 #02 starts about 77 pt below its neighbors. Align screenshot tops while keeping each caption with its image. |
| PDF workflow cards and summary bands, pages 2–8 | LY02 (p. 31) | **Pass.** Each row reads from steps 01 through 03, with the same card columns and a separate result band below them. |
| App editor footer, pages 2, 4 and 5 | PX01 (p. 12), IC09 (pp. 106–107) | **Pass.** The impact text and save controls share a footer below the input area. The buttons share a right edge. [Production requirements](screenshots/02-01-production-requirements-edit.png) · [Narrative detail](screenshots/04-01-narrative-detail-edit.png) |
| App timeline, pages 5 and 8 | AL01 (pp. 16–17), IC09 (pp. 106–107), project row layout | **Pass at captured widths.** State icons share a left axis, and each active action sits at the right inside its own row, next to its explanation. [Conversion waiting](screenshots/05-02-style-conversion-awaiting-continue.png) · [Review paused](screenshots/08-01-review-paused.jpg) |
| App editor and timeline at reduced width | AL03 (pp. 18–19), WS02 (p. 26), project wrapping rules | **Not assessable.** The post-fix capture must show that action groups wrap as a unit and stay right-aligned within the relevant step. |

### D: the document

| Check | Location | Rule (pp.) | Evidence | Result | Disposition |
|---|---|---|---|---|---|
| D-C1 | Page 1 footnote text layer | CL01 (13) | Old and new cancel sentences both present | Fail | F1 |
| D-C2 | Pages 2, 4, 5, 6 caption text layers | CL01 (13) | Old captions extractable under the new ones | Fail | F1 |
| D-C3 | Page 1 section headings | PX01 (12) | Gap above each heading < gap below it | Fail | F7 |
| D-C4 | Page 1 table → footnote | WS03 (27–28) | Footnote flush under the table | Concern | F7 |
| D-C5 | Page 1 state crops | CS03 (41–42) | Different scale and sharpness for the compared pair | Fail | F2 |
| D-C6 | Page 5 timelines vs pages 2–4, 6 | CS03 (41–42) | About 15% more vertical distance between successive stage numbers in #02 | Fail | F2 |
| D-C7 | Page 4 #01, page 8 #02 slots | AL03 (18–19) | Screenshot tops off the shared line | Fail | F2 |
| D-C8 | Frames on pages 3 #01, 5 #01, 6 #01 | CS01 (37–39) | Three frame treatments for one role | Fail | F2 |
| D-C9 | Page 5 #01 crop | CL01 (13) | Selected style not visible | Fail | F3 |
| D-C10 | Pages 3 #01, 7 #01, 7 #02 crops | AL03 (18–19) | Rows cut at the edges | Concern | F3 |
| D-C11 | Action highlight boxes on all pages | CS02 (39–40) | Boxes missing on page 8; only page 3 boxes 保存修改 | Fail | F3 |
| D-C12 | Page 6 step naming | IC06 (103) | Three wordings for one step | Fail | F5 |
| D-C13 | Sample text on pages 2, 3, 8 | CL01 (13) | 庄周 requirements on a 管鲍 story | Concern | F6 |
| D-C14 | Page template: title, subtitle, three cards, band | VH03 (9), TY13 (94–96) | Serif display title > card title > caption, with clear steps from size and weight | Pass | — |
| D-C15 | Reading order on every page | LY02 (31) | Numbered 01→03 left to right, summary band last | Pass | — |
| D-C16 | Colour roles in the document | CO01 (65–66), CO02 (66–68) | One dark green accent for titles and the band, neutral canvas | Pass | — |
| D-C17 | Caption measure | TY04 (75–79) | Captions about 20–30 CJK characters per line inside the cards | Pass | — |
| D-C18 | Text inside screenshots at print size | TY08 (87–89) | Timeline text is about 7 pt on a 1080 pt-wide page, so smaller on paper | Concern | Readable on screen with zoom. Lower priority unless the PDF is printed. |
| D-C19 | Page 1 table | AL02 (17), VH05 (11) | Left-aligned text columns, but the third column starts far from the second | Concern | Lower priority |

### A: the app UI in the screenshots

| Check | Location | Rule (pp.) | Evidence | Result | Disposition |
|---|---|---|---|---|---|
| A-C1 | Editor buttons (pages 1, 2, 4, 5, 6, 8) | VH01 (6–7) | 保存修改 solid dark green vs 取消 outlined. Greyed 保存修改 before any change. | Pass | — |
| A-C2 | Editor button order | BP07–BP08 (120–121) | 取消 left, 保存修改 right, right-aligned under the impact note | Pass | — |
| A-C3 | Impact note placement (pages 2, 4, 5, 6) | IC09 (106–107) | The consequence sits directly above the button that commits it | Pass | — |
| A-C4 | Impact note copy (pages 4, 5) | SI01 (22–23), TY05 (80–81) | Repeated frame list; orphaned 「准。」 | Concern | F8 |
| A-C5 | Timeline current row | VH05 (11), DT05 (55–57) | Tinted surface and state icon set the active row apart from pending ones | Pass | — |
| A-C6 | State icons for 待继续 vs 已暂停 | IC06 (103) | Same ‖ glyph | Fail | F4 |
| A-C7 | Status meaning without colour | CO04 (69) | Text labels 待进行, 进行中, 已暂停 and 待继续 next to the icons | Pass | The icon itself is covered by F4 |
| A-C8 | Row action placement | IC09 (106–107), IC02 (99) | 继续制作, 暂停生成 and 恢复生成 sit inside their own row, bottom-right | Pass | — |
| A-C9 | Prominence of the next action | VH01 (6–7) | A small text link carries the flow's key action | Concern | Justified exception: the project rule requires text links. The document compensates with boxes (F3). |
| A-C10 | Tabs vs option cards (page 4 #01) | CS02 (39–40) | Selected tab and selected 详细 card share the same tint and border; the selected tab is only subtly darker than unselected tabs | Concern | Polish. Validate before changing. |
| A-C11 | Delete-frame notice (page 6 #01) | BP17 (137), CL01 (13) | 「已删除 1 幅，待保存。」 sits directly above the impact note and buttons | Pass | — |
| A-C12 | Restyle row position (page 5) | LY02 (31) | 画风转换 sits before 全篇审片, matching execution order | Pass | — |
| A-C13 | Running row timer (pages 2, 3, 5, 7) | IC01 (97–98) | 距超时 countdown next to 暂停生成 shows the time cost | Pass | — |
| A-C14 | Disabled 保存修改 legibility (page 1) | TY11 (92) | Light text on grey-green; the state is clear, but the ratio wasn't measured | Not assessable | Needs a measured contrast check |
| A-C15 | Fixture strings: 「0 批候选」, 「（0 次）」, 「controlled」 | CL01 (13) | Visible zero counts and raw model id | Not assessable | Fixture data; check against a real library |
| A-C16 | Keyboard, focus, Esc guard | — | Not visible in static screenshots | Not assessable | Covered by tests, not by this audit |

**Catalog sections not applicable here:**

- Images, glass, overlap and shadows (CT02, DT01–DT04, DT08, BP14): no such patterns appear.
- Forms, passwords and codes (BP02–BP05): the PDF has no such fields.
- Marketing patterns (BP01, BP09–BP12, BP18): not present.
- Dark theme (CO03): no dark screenshots were supplied.
- Mobile reach (BP15): the screenshots are desktop only.
- Dropdowns (BP19–BP20): none are shown.

## What is working

- **One page per change type, three numbered steps.** A reader can find the change type they made and follow the page in order without cross-referencing (D-C14, D-C15).
- **The editor's impact note sits just above 保存修改.** The consequence (which frames will be redrawn) is read before committing (A-C3).
- **The row-local action model is clear.** The page 7 band summarises it as 继续制作 while waiting and 暂停生成 while running (A-C8).

## Recommended sequence

1. **F1.** Fix the stale text layer first: it is the only finding that puts wrong behaviour into the document's text. Moving the PDF to a committed HTML source fixes F1 and makes F2 and F3 cheap.
2. **F2 and F3 together.** Do them in one recapture pass with one viewport, one scale and one boxing rule. Fold F5 and F6 into the same pass.
3. **F4 in the app.** Treat it as a separate small UI change, with a test that 待继续 and 已暂停 render different icons.
4. **F7 and F8 as polish.**
