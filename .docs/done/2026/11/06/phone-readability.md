# Phone readability and touch targets

Requirement: [req-phone-readability.md](../../../reqs/2026/11/05/req-phone-readability.md) · Plan: [plan-phone-readability.md](../../../plans/2026/11/05/plan-phone-readability.md) · E2E spec: [test-phone-readability.md](../../../tests/test-phone-readability.md)

## Summary

- **Readable text:** every phone text size below 12px now uses the shared 12px token (`--yu-meta-size`). Declarations that never rendered were deleted. Only the lettering painted on the 发现 book covers stays smaller.
- **Contrast:**
  - Raised text that fell below 4.5:1 moved to the app's readable muted tone (`--yu-meta`), or a darker shade of its own hue.
  - Text over artwork got stronger backings:
    - the reader header scrim keeps its 0.75 strength across the whole header;
    - the recent-story card's wash is anchored behind its bottom text;
    - the card's 最近阅读 pill is more opaque.
- **Touch targets:**
  - Every phone control has a 44×44 target.
  - Small round buttons, the switch and text-style buttons keep their look and get a transparent `::after` tap area.
  - Flow links, tabs, row actions and the provider dialog's controls get real 44px sizes, and dense rows get wider gaps.
- **Dead UI:** the unreachable 制作要求 sheet, its flag and its styles are gone. 制作要求 is still edited from 修改故事.
- **Tests:**
  - `tests/phone-readability.playwright.e2e.mjs` audits 43 phone states, plus the provider dialog closed and open, for text size, targets, contrast and layout.
  - `tests/phone-readability-css.test.mjs` guards declared font sizes.

Commits on `main`: `2e1ac43` (dead sheet), `d43c17a` (text, contrast, backings, targets, tests), `c76fd09` (review fixes and a stricter audit).

## Verification

- `node --experimental-strip-types --test tests/phone-readability.playwright.e2e.mjs`: both cases pass. Evidence is in `.data/e2e/phone-cr/`.
- `tests/story-lifecycle.playwright.e2e.mjs`: 10/10 pass.
- `pnpm test`: 648/648 pass, including the new guard.
- `pnpm typecheck` and `eslint` on the changed files pass.
- In-app browser at 390px with isolated data (readonly provider): taps just outside the avatar and the switch reach them.

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

## Notes

- **Shared checkout.** Another session committed five provider-settings commits on `main` (`d9005d4`…`433e2af`) between this story's recorded base `f568d0c` and its first commit. It also still has uncommitted changes in `ProviderSettings.tsx`, `ProviderSettings.css`, a desktop E2E and its docs. This story's changes are exactly `433e2af..c76fd09`. `ProviderSettings.css` was committed through a filtered patch that left the other session's diagnostics hunk out.
- **Things to know about the audit:**
  - Chromium leaves rounded corners out of hit testing, so the target audit excuses only corner points beyond the curve (with 1px of tolerance).
  - Sheets are closed with their 关闭 button, because Escape also closes 故事设置 through the reader's key handler. That double close belongs to the phone-navigation story.
  - The provider dialog is audited in a disposable checkout with the real dev server. Only the dev proxy's private proof opens it, and `storyBrowser` does not have that.
- **Not covered by the E2E:** `.yu-recovery-detail` shows only while a fault is retried automatically. The static guard covers its font size.
- **Provider pills:** their text colors are now literals (`#3c7342`, `#8a5a12`). Changing `--pv-ok` and `--pv-warn` would also have recolored the status borders and dots.
- **For the responsive redesign:**
  - `READABILITY_BASE` is `c76fd09`.
  - Fluid font sizes must keep a 12px floor to pass the guard.
  - The phone audit's 768px and 1280px layout checks will need revisiting once the shell takes over at 768px.
- **Unused CSS:** the rules for classes no component uses (`.yu-production-field`, `.yu-prompt-actions`, `.eyebrow`, `.yu-voice-option`, `.yu-lengths`, `.yu-audio`, `.yu-sample-link`) were tokenized, not deleted. Removing them is a separate cleanup.
- **Environment:** the shell ran Node 22.23.4 while the repo pins Node 24. pnpm only warned, and every run completed.
- The story docs (REQ, plan, E2E spec and this file) are not committed. Final delivery (GC) was not run.
