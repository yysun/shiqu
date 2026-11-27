# Shiqu revision flow · visual design re-audit

27 November 2026 · `audit-ui-design` 1.3.0 · application captures at `e4fbed88`

## Overall verdict · Needs revision

**Layout and spacing.** The step grid and action alignment hold. At 320 × 900, the review links wrap together, share the right edge with Continue at x = 287, and stay inside the active row. The review-notes editor keeps Cancel and Save on screen. The main remaining layout defect appears in the scrolled desktop views. The panel title and Close can leave view in the dock and the long art-style editor. The dock also loses the story name. In the acceptance editor, the Save button moves down 16.3 CSS px when the impact line appears. [Narrow timeline](screenshots-verified/narrow-timeline.jpg) · [Narrow editor](screenshots-verified/narrow-editor.jpg) · [Running review](screenshots-verified/03-03-review-running.jpg) · [Art-style editor](screenshots-verified/05-01-art-style-edit.jpg)

**Visual hierarchy.** Save leads Cancel throughout the editor. The active row, state label and distinct wait/pause icons make the next action identifiable. The selected narrative-detail card relies on a pale fill and a border, and the deletion summary gives only a count where the reader needs to verify the selected frame. [Enabled Save](screenshots-verified/01-save-enabled.jpg) · [Revised review waiting](screenshots-verified/08-03-revised-review-awaiting-continue.jpg) · [Paused review](screenshots-verified/08-01-review-paused.jpg) · [Narrative detail](screenshots-verified/04-01-narrative-detail-edit.jpg) · [Delete preview](screenshots-verified/06-01-delete-frame-preview.jpg)

The existing editor and timeline structure supports the task. The next changes are localized to panel chrome, contrast, selection and preview copy. The user task is to change a saved story, understand the impact, save it, and continue or resume from the correct step. The evidence is 23 desktop states plus one focus and two narrow captures, previously recorded in the in-app browser with an isolated library and controlled replies. I reinspected the images and compared saved geometry and source. The captured UI files match the current checkout. Review-guide pages 1–8 were checked for the earlier document findings. [Evidence index](revision-pdf-ui-audit.md#retaken-screenshot-set) · [Original verification](../../../../tests/test-revision-ui-review-fixes.md#执行结果)

## Prioritized fixes

### F1. Minor · Keep the title and Close visible in long panels

In the unscrolled waiting view, the dock begins with “故事设置”, the story name and Close. In the same review’s running capture, the top of the dock begins with the story summary. During drawing and recheck it begins in the timeline itself. The scrolled art-style editor starts at the selection summary, with its title and Close above the visible area. Both panel bodies scroll and the relevant scrollbars are hidden. This makes the scope and exit harder to locate after reading down the panel. Preserve a compact visible title and Close while the body scrolls. Keep the story name in the dock header when the body’s name is out of view. Verify in running review, drawing and long art-style views at desktop and at narrow or short heights. Confirm that the fixed header leaves room for focused controls and nearby content. **Checks L03, L05, H05.** Repeated, high confidence in the visible state. User frequency unknown. [Waiting dock](screenshots-verified/03-02-review-awaiting-continue.jpg) · [Running dock](screenshots-verified/03-03-review-running.jpg) · [Drawing dock](screenshots-verified/07-03-drawing-running.jpg) · [Scrolled art editor](screenshots-verified/05-01-art-style-edit.jpg) · [Dock CSS](../../../../../client/ui/DesktopLibrary.css#L19-L21) · [Hidden scrollbars](../../../../../client/ui/reader.css#L279-L285)

### F2. Minor · Increase contrast on supporting labels and control cues

The default and skipped or unavailable 12 px timeline titles measure **3.86:1** and **3.82:1** against their panel. The explicit state text reaches **5.40:1** on that surface. The dark Save label reaches **7.20:1**. The keyboard focus ring is visible but measures **2.68:1** against the waiting row and **2.85:1** against the surrounding timeline. The textarea border reaches **1.40:1** on the sheet and its fill differs from the sheet by **1.02:1**. These figures use declared colors and the sRGB luminance formula. Raise normal-size step titles to 4.5:1. Give the focus marker and the cue that defines the editable field at least 3:1 against adjacent surfaces, using the Modern Web Guidance threshold for non-text contrast. Preserve the default underlined text appearance of timeline actions. Verify normal, waiting and focus states and both empty and filled textareas. **Checks V01–V03, V05.** Repeated, high confidence in the color pairs. User frequency unknown. [Pending and unavailable steps](screenshots-verified/04-03-frame-count-review-running.jpg) · [Keyboard focus](screenshots-verified/keyboard-focus.jpg) · [Review notes](screenshots-verified/08-02-review-notes-edit.jpg) · [Before-and-after contrast measurements](拾趣修订流程-按钮与实测截图.pdf#page=27)

### F3. Minor · Show which frame will be removed next to Save

The delete preview says “已删除 1 幅，待保存” and gives the reuse count. The removed frame is gone from the list. The list numbers the surviving frames in their new order, so the top-of-panel preview does not identify the original frame 6 before the reader commits. Show the original frame number for a single deletion. For a batch, show original numbers or a compact range and retain the total. Verify deleting a middle frame, the final frame, and several frames, then cancel and confirm the draft is cleared. **Checks H08, C08.** Isolated in the evidence, high confidence in the presentation. User frequency unknown. [Delete preview](screenshots-verified/06-01-delete-frame-preview.jpg) · [Deletion notice and original IDs](../../../../../client/ui/StoryScript.tsx#L95-L115) · [Surviving frame numbering](../../../../../client/ui/StoryScript.tsx#L149-L153)

### F4. Minor · Make the selected narrative-detail card clear without color

“详细” is selected. Its fill and border change, but its label, shape and icon treatment stay the same. The border is **2.20:1** against the selected card fill. The art-style editor already demonstrates a check next to the chosen card. Give the selected narrative card a visible check or explicit selection marker and retain the shared card dimensions. Verify one unambiguous selection in the three-column desktop state and in the stacked narrow layout. **Checks H06–H07.** Isolated component, high confidence. User frequency unknown. [Narrative detail](screenshots-verified/04-01-narrative-detail-edit.jpg) · [Art-style selection](screenshots-verified/05-01-art-style-edit.jpg) · [Narrative selection CSS](../../../../../client/ui/story-revision.css#L2-L11)

### F5. Polish · Stabilize the Save position when the impact line appears

Both Save states are **132 × 48 CSS px** with 14 px type and the same left edge at x = 719. In the matched desktop acceptance capture the top edge changes from y = 717.5 to y = 733.8 when the impact line is present. The pair shows a positional shift, with no observed misclick or task failure. If the short editor is adjusted, keep the footer stable across the empty-to-dirty transition while letting a long preview scroll. Verify by editing and clearing a single requirement at the same viewport. **Check L07.** Isolated in the measured pair, high confidence in the geometry. [Disabled](screenshots-verified/01-save-disabled.jpg) · [Enabled](screenshots-verified/01-save-enabled.jpg)

## Layout and spacing by captured screen

Desktop captures are 1280 × 900 at DPR 1. Each observation below names the local group or edge that determines the outcome.

| Screen group | Evidence and result |
|---|---|
| Save states | [Unchanged](screenshots-verified/01-save-disabled.jpg) and [edited](screenshots-verified/01-save-enabled.jpg) keep one footer at the right. Save moves down 16.3 px with the preview line. L07, F5. |
| Production requirements | [Edit](screenshots-verified/02-01-production-requirements-edit.jpg) keeps the effect text next to Save. [Waiting](screenshots-verified/02-02-storyboard-awaiting-continue.jpg) and [running](screenshots-verified/02-03-storyboard-running.jpg) keep controls within the storyboard row. L01–L02. |
| Acceptance requirements | [Edit](screenshots-verified/03-01-acceptance-requirements-edit.jpg) keeps the previous audit and collapsible prompts above the save group. [Waiting](screenshots-verified/03-02-review-awaiting-continue.jpg) and [running](screenshots-verified/03-03-review-running.jpg) preserve the timeline axis. The dock header is outside the scrolled running view. L01–L03, F1. |
| Narrative detail | [Edit](screenshots-verified/04-01-narrative-detail-edit.jpg) uses an even three-card row and a compact impact group. [Waiting](screenshots-verified/04-02-replan-awaiting-continue.jpg) and [count review](screenshots-verified/04-03-frame-count-review-running.jpg) keep the action with the correct checkpoint. The scrolled count-review dock loses its header. L02–L04, F1. |
| Art style | [Edit](screenshots-verified/05-01-art-style-edit.jpg) groups styles, prompt and impact in order. Close is above the visible scroll position. [Conversion waiting](screenshots-verified/05-02-style-conversion-awaiting-continue.jpg) and [conversion running](screenshots-verified/05-03-style-conversion-running.jpg) keep actions in the conversion row. The running dock also loses its header. L02–L05, F1. |
| Delete preview and ending work | [Delete preview](screenshots-verified/06-01-delete-frame-preview.jpg) keeps the draft notice, effect summary and Save just before the frame list. [Waiting](screenshots-verified/06-02-ending-awaiting-continue.jpg) and [running](screenshots-verified/06-03-ending-running.jpg) keep ending work with the storyboard row. The running header is clipped at the top. L02–L03, L08, F1. |
| Downstream stages | [Targeted revision](screenshots-verified/07-01-targeted-revision-running.jpg), [recheck](screenshots-verified/07-02-recheck-running.jpg) and [drawing](screenshots-verified/07-03-drawing-running.jpg) retain the same left icon axis and right action edge. Dock title and Close are above the visible scroll position. L02–L03, F1. |
| Pause and review notes | [Paused](screenshots-verified/08-01-review-paused.jpg) keeps Resume in the active review row. The [review-notes editor](screenshots-verified/08-02-review-notes-edit.jpg) groups the field, helper text and footer. [Waiting on the revised review](screenshots-verified/08-03-revised-review-awaiting-continue.jpg) retains that row’s axes and puts Continue at the right. L01–L02. |
| Focus and 320 × 900 | [Tab focus](screenshots-verified/keyboard-focus.jpg) is visible around the action in its own row. The [narrow timeline](screenshots-verified/narrow-timeline.jpg) keeps the review links together and the document width at 320 px. In the [narrow editor](screenshots-verified/narrow-editor.jpg), Save ends at y = 876. L06, L09, V02. |

## Component verification against the Playbook

Basis: UXPeak’s *UI/UX Playbook* and the skill’s rule catalog. Printed references use the book’s own numbering. I inspected original pages 6–7, 12, 16–19, 24–28, 30–31, 39–40, 69, 89, 92, 103 and 106–107, including the proximity, alignment, spacing, hierarchy and contrast figures. The table uses the catalog for additional applicable checks. The screen inventory above identifies repeated components and visible state samples.

| ID | Component and state | Rule, printed pages | Evidence and result | Disposition |
|---|---|---|---|---|
| L01 | Desktop requirements, acceptance and notes editors | PX01, p. 12 | **Pass.** Labels sit with their fields. Helper and impact copy lead into the local footer. | Retain. |
| L02 | Desktop waiting, running and paused timeline | AL01, pp. 16–17 | **Pass.** Icons share the left axis. The action ends on the right edge inside the owning step. | Retain. |
| L03 | Desktop dock, scrolled review, conversion, ending and drawing | LY02, p. 31 | **Fail.** The viewport begins partway through the dock content, with its heading and full Close affordance outside or clipped. | F1. |
| L04 | Desktop narrative and style choices | AL03, pp. 18–19 | **Pass.** The narrative cards share top and bottom edges. The style cards use regular column alignment. | Retain. |
| L05 | Art-style editor at its save-ready scroll position | WS02, p. 26 | **Concern.** The chosen style and Save fit together, but title and Close are outside the visible scroll position. | F1. Recheck short-height fit. |
| L06 | Narrow review timeline | AL03, pp. 18–19 | **Pass.** Two links wrap as a group and end at x = 287, aligned with Continue. | Retain. |
| L07 | Matched acceptance editor, unchanged and edited | WS03, pp. 27–28 | **Concern.** Footer x and button dimensions hold. The saved preview and state change coincide with 16.3 px of vertical movement. | F5, optional polish. |
| L08 | Delete preview, notice and local footer | PX01, p. 12 | **Pass.** Notice, impact and Save stay together above the surviving frame list. | Retain the grouping when addressing F3. |
| L09 | Narrow review-notes editor | BP15, pp. 133–135 | **Pass on fit.** Cancel and Save are visible and the larger action ends at y = 876. One-handed reach remains unverified. | Preserve fit. |
| L10 | Other editors and running rows at narrow and short heights | WS02, p. 26 | **Not assessable.** Only the notes editor and waiting review timeline have narrow evidence. | Capture long style, dense running and delete states at these sizes before declaring broader coverage. |
| L11 | PDF overview headings | PX01, p. 12 | **Pass.** The rebuilt guide places both headings nearer the content they introduce. | Retain the comparison on PDF pp. 11–12. |
| L12 | PDF overview table and note | WS01, pp. 24–25 | **Pass.** The visible gap grows from about 5 to 12 points and the note has its own reading space. | Retain. |
| L13 | PDF screenshot grid, pp. 2–8 | AL03, pp. 18–19 | **Pass.** Image tops were independently verified at 202 pt from the top on every row. | Retain. |
| L14 | PDF repeated screenshot scale | CS03, pp. 41–42 | **Pass.** Timeline slots are 234.33 pt wide and the Save crops are both 227 × 63 pt. | Retain. |
| L15 | PDF steps, captions and result bands | LY02, p. 31 | **Pass.** The three steps and captions read in sequence before the lower outcome band. | Retain. |
| L16 | Desktop and narrow active rows | PX01, p. 12 | **Pass.** State, detail and action share a bounded row. At 320 px the review navigation group wraps before the explanatory line and stays within the same row. | Retain. |
| L17 | Desktop editor fields, notes and card sections | WS01, pp. 24–25 | **Pass.** Requirements fields have reduced label-to-field gaps. Section divisions and extra padding separate audit results, disclosures and footer from the entry field. | Retain. |
| H01 | Editor Save and Cancel | VH01, pp. 6–7 | **Pass.** Enabled Save alone uses the solid accent. Disabled Save recedes and Cancel remains available. | Retain. |
| H02 | Timeline actions, default states | CS02, pp. 39–40 | **Pass.** Continue, Pause and Resume use underlined text with no static outline in the captures. | Retain the visual treatment. Web semantics are tracked separately. |
| H03 | Current row, waiting/running/paused | VH05, p. 11 | **Pass.** The tinted row, written state and icon reinforce emphasis without a large filled action. | Retain. |
| H04 | Waiting compared with paused | IC06, p. 103 | **Pass.** Arrow and “待继续” differ from pause bars and “已暂停”. | Retain. |
| H05 | Scrolled stable orientation | CL01, p. 13 | **Concern.** A long visible panel can omit the story or editor identity and its exit at the moment of reading. | F1. |
| H06 | Narrative card selection | CO04, p. 69 | **Fail.** “详细” has a color-based selected treatment without a visible marker. | F4. |
| H07 | Narrative selection comparison | LY03, p. 32 | **Concern.** The cards explain three meaningful choices. The weak selected cue makes the current preference harder to identify. | F4. |
| H08 | Delete preview and save decision | CL01, p. 13 | **Fail.** The warning names a count and a future consequence. It omits the original frame identifier. | F3. |
| H09 | Art-style choice cards | IC09, pp. 106–107 | **Pass.** The chosen watercolor card and check are visible with the redraw estimate and Save. | Retain. |
| H10 | Story settings and editor headings | VH04, p. 10 | **Pass at top.** The dark titles lead the lighter labels and copy. | F1 covers the scrolled state. |
| V01 | Timeline pending and unavailable titles | TY11, p. 92 | **Fail.** The normal-size title colors measure 3.86:1 and 3.82:1. | F2. |
| V02 | Continue in the focus capture | CT01, pp. 20–21 | **Concern.** A continuous ring is visible. Its contrast against adjacent surfaces measures below 3:1 in the separate web check. | F2. |
| V03 | Textarea against light sheet | DT06, pp. 58–60 | **Concern.** The light border carries most of the field boundary and differs little from the fill or sheet. | F2. |
| V04 | Enabled Save and textarea text | TY11, p. 92 | **Pass on measured pairs.** Ratios are 7.20:1 and 8.44:1 respectively. | Retain. |
| V05 | Default action, current and waiting rows | CT01, pp. 20–21 | **Pass on text.** Link text measures 4.95:1 and 5.09:1. Focus is assessed in V02. | Retain text contrast when adjusting focus. |
| V06 | Long narrative and artwork impact notes | TY05, pp. 80–81 | **Pass in desktop captures.** The old-image and future-count message stays together. The full redraw count appears once. | Retain. Verify longer content at narrow widths. |
| V07 | Editor label, field and help text at enlarged sizes | TY08, pp. 87–89 | **Not assessable at enlarged sizes.** The desktop captures show distinct roles. The only narrow editor is review notes and zoom was untested. | Check at 200%. |
| V08 | Repeated story text and timeline descriptions | TY12, pp. 93, 96 | **Pass.** Titles and descriptions share left edges, with action labels aligned separately at the right. | Retain. |
| V09 | Active stage icon family | CS05, pp. 44–45 | **Pass.** Arrow, pause, check and running marks fit the same circular slot and have distinct shapes. | Retain. |
| V10 | Editor surface versus story shelf | DT01, pp. 49–50 | **Pass.** The opaque editor and dimmed background make the active layer clear. | Retain. |
| V11 | Art-style tab, narrative tab and regular editor tabs | CS01, pp. 37–39 | **Pass in sampled desktop states.** Section controls share their shape and align within the same row. The selected tab uses the same treatment across editors. | Retain. |
| V12 | Save, Cancel and timeline link surfaces | CO01, pp. 65–66 | **Pass.** Strong green is reserved for the modal commit. The timeline uses a softer action treatment alongside a state surface. | Retain. |
| C01 | Full redraw and automatic replan summaries | SI01, pp. 22–23 | **Pass.** Full redraw shows one total. Auto replan distinguishes existing image loss and an undecided new count. | Retain. |
| C02 | Delete preview, Cancel versus Save | BP07, p. 120 | **Pass in the preview.** Cancel remains visible at the safe exit. | Retain. |
| C03 | Delete preview, action order | BP08, pp. 120–121 | **Pass.** Cancel is left of Save in the LTR editor. | Retain. |
| C04 | Delete menu or destructive-only confirmation | BP06, pp. 119–120 | **Not assessable.** The saved state is the post-selection preview with a commit button. No destructive menu state is in the set. | Verify menu label and treatment in a future capture. |
| C05 | Desktop requirements and notes editors | BP13, pp. 129–130 | **Pass.** The task fields stay within focused modal columns, with surrounding shelf content visually subdued. | Retain. |
| C06 | Acceptance results and optional prompt disclosures | IC04, pp. 100–101 | **Pass.** The last result has its own heading. Optional prompt evidence sits under labeled disclosures. | Retain. |
| C07 | Downstream review and drawing controls | IC09, pp. 106–107 | **Pass.** Pause and the countdown stay beside the running review, recheck or drawing details. | Retain. |
| C08 | Deletion preview confirmation context | CL03, p. 15 | **Concern.** The aggregate feedback confirms removal. The moved frame list cannot confirm which original frame was removed. | F3. |
| C09 | Error and interrupted-task recovery | BP17, p. 137 | **Not assessable for errors.** Paused is pictured, but no failed step, invalid field or retry error state appears. | Retain the existing data scope and capture a controlled error if auditing recovery. |
| C10 | Legibility and fit outside default appearance | CO03, pp. 68–69 | **Not assessable.** Captures show the light application treatment only. | Avoid claiming other themes or system contrast modes were reviewed. |

The catalog’s product imagery, avatars, shadows on standalone cards, ranking of prices, authentication, marketing, checkout, dropdown and 404 patterns are outside this revision surface. Background shelf imagery uses fixture placeholders and is outside the audit’s task scope. The temporary modal backdrop was checked for layer separation. The report carries no general accessibility-conformance or production sign-off verdict.

## Earlier findings rechecked

IDs refer to the [original review](revision-pdf-ui-audit.md#prioritized-fixes). These statuses record the interface or document correction. The prior isolated run supplies workflow evidence. No representative-user outcome was measured in this re-audit.

| Earlier finding | Result and evidence |
|---|---|
| F1 · Hidden stale text | **Resolved.** Extracted current overview and delete captions once each. The contradictory old Cancel sentence and old heading terms are absent from the guide pages. [Guide p. 15](拾趣修订流程-按钮与实测截图.pdf#page=15) |
| F2 · Unequal screenshot geometry | **Resolved.** The original eight guide pages have 23 current image objects, consistent timeline width, same-size Save crops and shared screenshot tops. [Guide pp. 10–12](拾趣修订流程-按钮与实测截图.pdf#page=10) |
| F3 · Crops and apparent link boxes | **Resolved under the accepted requirement.** The chosen watercolor card and Save are visible in the documented image. The default links read as text, and the Tab ring remains visible in its own capture. The historical source of the boxes remains unverified. [Guide pp. 13–14](拾趣修订流程-按钮与实测截图.pdf#page=13) |
| F4 · Paused and waiting share an icon | **Resolved.** Saved waiting uses an arrow, and paused uses two bars. The action labels also differ. [Waiting](screenshots-verified/08-03-revised-review-awaiting-continue.jpg) · [Paused](screenshots-verified/08-01-review-paused.jpg) |
| F5 · Step wording drifts | **Resolved.** The current guide uses “拟定标题与结语” for the two affected captions. [Guide p. 6](拾趣修订流程-按钮与实测截图.pdf#page=6) |
| F6 · Sample story mismatch | **Resolved for the captured examples.** Requirements and review notes refer to 管仲 and 鲍叔牙, the story shown in their workflow. [Production requirements](screenshots-verified/02-01-production-requirements-edit.jpg) · [Acceptance requirements](screenshots-verified/03-01-acceptance-requirements-edit.jpg) · [Review notes](screenshots-verified/08-02-review-notes-edit.jpg) |
| F7 · Headings and table note too close to neighboring blocks | **Resolved.** Both overview headings are closer to their own sections. The note gap increased by about 7 pt. [Guide pp. 11–12](拾趣修订流程-按钮与实测截图.pdf#page=11) |
| F8 · Redraw copy repeats and wraps poorly | **Resolved in the captured viewport.** Full redraw gives one total. The narrative preview explains existing image loss and the pending frame count without an orphaned final line. Partial redraw numbering is supported by the prior service-backed test. [Art style](screenshots-verified/05-01-art-style-edit.jpg) · [Narrative detail](screenshots-verified/04-01-narrative-detail-edit.jpg) · [Verification record](../../../../tests/test-revision-ui-review-fixes.md#执行结果) |

## Validation gaps

The prior isolated run recorded the paths from save to waiting, Continue, pause, resume and saving revised review notes. This re-audit used the saved captures and recorded layout geometry. A targeted follow-up should start with a short viewport and desktop dock at the bottom of a long stage. Verify that the story and Close remain visible, that focus stays in view, and that the compact header leaves the stage controls and notes readable. Inspect 200% zoom and screen-reader behavior through the live flow when validating the accessibility follow-ups. [Prior workflow test record](../../../../tests/test-revision-ui-review-fixes.md#执行结果)
