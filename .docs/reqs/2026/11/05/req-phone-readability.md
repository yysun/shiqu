# Phone readability and touch targets

This is the first of two phone stories split from the phone UI review. It lands **before** the responsive redesign ([req-desktop-responsive-layout.md](req-desktop-responsive-layout.md)). Back navigation and sheet depth follow it, in [req-phone-navigation.md](req-phone-navigation.md), **after** the redesign.

The reader app's phone UI (`client/`) has text and controls that are too small for comfortable phone use. It also carries one piece of dead UI.

1. **Text is too small to read.**
   - The phone stylesheets have about 54 font-size declarations at 6–10px and 68 at 11px.
   - Later shared rules lift some of them to 12px (tab bar labels, reader header meta, the header note, the 不挑了 subtitle). Many still render below 12px. Examples:
     - the reader's style and theme labels: 11px, or 10px at 380px and narrower (`reader.css`);
     - production timeline stage states: 9–10px (`production-timeline.css`);
     - recovery details: 10px;
     - a large set of 11px meta lines and notes in sheets.
   - Small Chinese characters at these sizes are hard to read on a phone.
2. **Some touch controls are smaller than a comfortable thumb target:**
   - the avatar: 35px;
   - the switch: 42×24;
   - shelf card actions: 36px, and cover-overlay actions: 30px;
   - recent-story hero controls: 38×34;
   - provider segment buttons: 30px;
   - option chips: about 33px.

   The round reader buttons and the sheet close button are already 44px.
3. **Dead UI.** The standalone 制作要求 sheet can never open, because nothing sets its `requirements` flag. Its content is reached instead as the 制作要求 tab of 修改故事.

## Outcome

On phones, all informational text is comfortably readable, every control is easy to hit, and the dead 制作要求 sheet is gone. Layouts, the visual identity and every action stay as they are.

## Definitions

- **Phone widths:** viewports 320–540px wide. Verify primarily at 360, 390 and 430px. The styles also apply to wider viewports today (the 480px card at 541px and up). The criteria are checked at 320–540px, and wider viewports must not regress (no horizontal scroll, no clipped controls).
- **Readable text:** text that carries information. The exclusions are listed here and nowhere else:
  - lettering painted on the 发现 book covers (`.yu-book-cover` era, author and genre). This is a product decision: it is part of the illustrated cover art, and the title and note shown below each cover are the readable information;
  - the decorative 古意新生 stamp (`.yu-stamp`).
- **Measured size:** the browser's computed `font-size` of the text's own element.
- **Touch target:** the area that receives a tap at a point. It may be larger than the visible shape.
  - **How it is measured:** a 44×44px box centered on the control, in which every sampled `elementFromPoint` hit lands on the control or one of its descendants. Boxes of different controls must not intersect.
  - **Wrapped inputs:** for labels that wrap a visually hidden input (for example style cards and provider segments), the label is the target.
  - **Coverage:** text input fields and disabled controls are covered.

## Acceptance criteria

### Readable text
- [x] At 360, 390 and 430px wide, no readable text in any phone screen, sheet, dialog or the reader renders below 12px measured size. This applies across 发现, 书架, 我的, every sheet and dialog, the production flow and timeline, the reader, and the ending.
- [x] In particular, the reader's style and theme labels, the production timeline stage states, recovery details and the former 11px meta lines render at 12px or larger.
- [x] Larger text keeps layouts intact from 320px up:
  - no horizontal scroll;
  - no clipped or overlapping controls;
  - no text newly truncated, except the ellipsis truncation of long titles that exists today.

  Spacing and line breaks may change to fit.
- [x] Contrast:
  - Resized text on a plain background meets WCAG 2.1 AA (4.5:1) against that background.
  - Text over artwork (reader caption, header, style labels, the recent-story card on 发现, the 书架 cover badge) keeps its current text shadow. It meets 4.5:1 against its backing (scrim and any pill behind it) at the backing's lowest opacity behind the text, composited over white, which stands for the lightest possible artwork.
  - Where today's backing does not reach this, the backing is strengthened behind that text, keeping its hue. Decided after measurement: the recent-story card's label, style line and title measured 2.1–3.3:1, and the reader meta line 3.8:1 where it wraps at 390px.

### Touch targets
- [x] Every interactive control in the phone UI has a touch target of at least 44×44px. The visible shape may stay smaller.
  - **Exceptions (WCAG 2.5.8 style):** inline text links within sentences, native `select` and `textarea` controls, and `summary` disclosure rows that are already full-width.
  - **Spacing:** targets must not overlap each other. Gaps in dense rows, such as option chips and card actions, may grow to make room.
- [x] The reader's swipe paging and edge clicks behave as today. Enlarged targets near the reader's edges must not steal swipes or edge clicks.

### Dead UI
- [x] The standalone 制作要求 sheet, its `requirements` flag and its now-unused styles (`.yu-saved-prompt`) are removed. 制作要求 stays reachable from 修改故事 as today, and nothing else changes.

### Preservation
- [x] Every action, label and flow works as before.
- [x] The phone UI keeps its visual identity (palette, serif headings, card radius, iconography). Changes are limited to font sizes, target sizes, spacing needed to fit them, text colors and over-artwork backings needed for contrast, and the dead sheet.
- [x] Existing reader tests keep passing.

## Verification

VR passed: all acceptance criteria complete. The story's code is `2e1ac43`, `d43c17a` and `c76fd09` on `main`.

| Criterion | Status | Evidence |
|---|---|---|
| No readable text under 12px at 360/390/430 | Complete | The phone E2E `text` audit is empty in all 43 main states and both provider-dialog states (`.data/e2e/phone-cr/phone-readability/audit/report.json`, `…/phone-readability-provider/report.json`). `tests/phone-readability-css.test.mjs` finds no declared size under 12px outside the book-cover lettering. |
| Style and theme labels, stage states, recovery details and former 11px meta lines at 12px or more | Complete | The E2E named check covers `.production-stage-state`. The `text` audit covers the reader style labels at 360, under the ≤380px rule, and the former meta lines. `.yu-recovery-detail` only renders while a fault is being retried automatically, which the fixture cannot hold, so the static guard covers its size. |
| Layout intact from 320px | Complete | E2E `layout` at 320/360/390/430/540/768/1280: no overflow, no clipped control and no overlapping controls. Every truncation is on the baseline allowlist recorded at M0. Production titles now wrap rather than truncate. |
| Contrast, plain backgrounds | Complete | E2E `contrast`, raised set (element opacity counted): nothing below 4.5:1. The color changes are listed in the plan's M2 record. |
| Contrast, over artwork; backings strengthened | Complete | On the pale fixture artwork, composited over white: card label 5.32, style line 5.97, title 7.50; reader header 6.66 or more (the wrapped meta line was 3.83); caption 7.02 or more; shelf badge 7.78. The backing changes are in the plan's M2 record. |
| 44×44 targets, exceptions, no overlap | Complete | E2E `targets`, which hit-tests 25 points per control (only rounded corners are excused), plus `layout` overlaps of each control's border box and `::after` area. Nothing fails. Limit: points outside the viewport are not sampled, because the screen edge bounds the tap there. |
| Reader swipe and edge taps unchanged | Complete | The E2E reader step: a right edge tap, a left edge tap and a 120px drag each turn exactly one page, and a center tap toggles metadata without turning. `tests/reader-interaction.test.mjs` passes. |
| Dead sheet removed, 制作要求 still reachable | Complete | `2e1ac43`. The grep for `setRequirements` and `yu-saved-prompt` is empty, the static guard rejects `.yu-saved-prompt`, and the E2E checks that the 修改故事 制作要求 tab shows the saved prompt. |
| Every action, label and flow works as before | Complete | The CSS changes no markup apart from the dead sheet. `tests/story-lifecycle.playwright.e2e.mjs` passes 10/10, covering creation, edit paths, pause and resume, failure and retry, reselection, review decisions and shelf entries. The phone E2E drives every phone dialog. |
| Visual identity kept; changes limited | Complete | M3 side-by-side screenshots at 390px against the M0 baseline: only sizes, targets, spacing, line breaks, contrast colors and the two backings changed. |
| Existing reader tests pass | Complete | `pnpm test` passes 648/648 after the final changes. |

**Constraints:**
- Only CSS and tests changed, apart from removing the dead sheet from `Reader.tsx`.
- Verification used isolated data only: the E2E fixtures' retained `.data/e2e` libraries, a disposable checkout for the provider case, and `SHIQU_DATA_DIR=/tmp/shiqu-phone-readability SHIQU_AI_PROVIDER=readonly` for the browser check.
- The responsive redesign plan now records `c76fd09` as `READABILITY_BASE`.

## Constraints

- One reader app. No server, API, storage, URL, CLI or skill changes.
- The responsive redesign's plan starts from this story's delivery commit. Its phone baseline and stylesheet byte-equality check are taken against that commit, and its derived-view model has no 制作要求 section.
- Verify only with isolated data (`SHIQU_DATA_DIR` plus `SHIQU_AI_PROVIDER=readonly`), never the personal library.

## Non-goals

- Back navigation and sheet depth, which are in the phone-navigation story.
- Layout redesign, new features or branding changes.
- Medium and large tier layouts, which belong to the responsive redesign.
