# Phone navigation: back behavior and sheet depth

This is the second of two phone stories split from the phone UI review. It lands **after** the responsive redesign ([req-desktop-responsive-layout.md](req-desktop-responsive-layout.md)) and builds on that redesign's state model: one state owner in `Reader.tsx`, derived views, drawers and the story workspace. The first phone story, [req-phone-readability.md](req-phone-readability.md), lands before the redesign.

1. **Back does not reliably go back.**
   - The app never adds browser history entries: it only replaces the current URL (`/`, `/read?id=…`).
   - On iOS Safari and in desktop browsers, back therefore leaves the app, or jumps to whatever page came before it, instead of closing the open sheet or returning from the reader.
   - Chrome on Android (120 and later) does deliver the back gesture to an open modal sheet as a cancel, so there back closes the top sheet. Back from the reader still leaves the app.
   - While a sheet is busy, a second Android back closes the dialog even though the app still treats it as open, and the page scroll lock stays on.
2. **Sheets stack too deep.** Story work reaches three stacked sheets:
   - 故事设置 → 分镜剧本 → 修改故事 (via 修改分镜);
   - 故事设置 → 替换选题 → the setup's 故事原文, 修改故事 or 重新选择故事.

   Many others stack two levels over 故事设置: 审核记录, 故事从哪里来, rename, 署名与转载, 作品还未署名, and the setup's sub-sheets before confirmation. Nothing shows which sheet a close returns to.

## Outcome

Back always takes people exactly one step back inside the app, in every browser and at every tier, without losing typed input or triggering work. Story work on phones never stacks more than two sheets, and a stacked sheet says where closing it leads.

## Definitions

- **Step:** one thing opened inside the app, at the current tier:

  | Tier | Steps |
  |---|---|
  | Phone | a sheet or dialog; the reader opened from 发现 or 书架 |
  | Medium and large | a dialog; a drawer (library details, reader side panel, workspace preview); the create page; a story workspace; the reader |

  Tab switches (发现 / 书架 / 我的) are not steps. This is the iOS-style choice: Android's Material bottom navigation instead returns to the start tab before exiting.
- **Typed input:** unsaved user-entered text or choices in:
  - the creation form or create page;
  - the creation setup's title search;
  - rename and 署名与转载;
  - the provider settings key and model fields.

  Excluded:
  - revision drafts in 修改故事, which already survive closing;
  - the creation setup editor, whose close already saves its draft. Back on it does exactly what its close does.
- **Docked panels are not steps.** At 1024px and wider, the library details and the reader side panel are docked parts of the view, not steps. They are steps only in drawer form, below 1024px.

## Acceptance criteria

### Back
- [x] Back closes the topmost open step and nothing else, from the Android back gesture, the iOS edge swipe or the browser back button:

  | Open | Back goes to |
  |---|---|
  | A sheet or dialog | The view under it. |
  | A sheet stacked on another | The sheet under it. |
  | The reader | Where it was opened from (发现 or 书架). The list's scroll position from before opening is restored (today it is reset, so this is new). |
  | A drawer, create page or workspace (medium and large) | The view under it, consistent with the responsive redesign's exit rules. |

  At the medium and large tiers the nesting order is dialog, then drawer, then create page or workspace, then reader.
- [x] If the topmost step holds unsaved typed input, back keeps it open and asks whether to discard the input. Choosing to keep editing leaves everything as it was. Close buttons keep today's behavior. The discard prompt is not a sheet and does not count toward the two-sheet limit.
- [x] While a sheet is busy and cannot be closed today (for example while saving), back leaves it open. The app's state, the dialog's open state and the page scroll lock stay consistent, including on repeated Android back presses.
- [x] Forward never reopens anything and never triggers work: no reader, no workspace (which could resume generation), and no submit, save, delete or regeneration.
- [x] Back is never a dead press. Every back either closes a visible step or, with nothing open, leaves the app the way the browser normally would. This holds after forward presses, after Android's own sheet-closing, and after every in-app way of closing something, including close buttons, scrims, drawer closes, closes that follow a save (rename, 署名与转载, delete), `leaveWorkspace`, and these exits:
  - the reader's back button and Escape;
  - the ending's 书架 and 开启下一篇;
  - 返回书架 (`backToShelf`);
  - version switches and reselection completion;
  - deleting the open story;
  - a successful creation submit;
  - top-bar navigation (the redesign's `exitToShell`).
- [x] 从头再看 inside the reader is not a new step.
- [x] After any resize, rotation or reflow, including across the redesign's 768×560 switch and its 1024px drawer/docked reflow, back still closes exactly the topmost step of the current tier, with no dead presses and no skipped steps. A drawer that becomes docked stops being a step. A docked reader side panel that becomes an open drawer when the window narrows becomes a step, and the first back closes it, with no skipped step.
- [x] **Direct links.** When the page is loaded directly on a link, by typing it, a QR code, the desktop console or a reload, the step that link opens is the base step. Back from it leaves the app as today. This applies to `/read?id=…` opening the reader and `/#provider-settings` opening the provider dialog. Closing a directly loaded provider dialog with its close button keeps today's behavior: it stays in the app on the view underneath and does not leave the app.
- [x] **Hash changes while the app is open.** If `#provider-settings` is applied while the app is already open, the provider dialog is a step, and back closes it. The browser creates this history entry itself, so closing the dialog with its close button must use that entry up too. The next back must not be a dead press.
- [x] **Stale entries after a reload.** A reload makes the current step the base step, like a direct link. The history entries the app created before the reload are then outside the app:
  - **Back:** one press from the base step leaves the app. The app skips all of its own pre-reload entries in that one press and never shows one of them as a stop. A brief loading flash while skipping is acceptable, because the browser loads those entries fresh. The skip loads no data, records no reading event and resumes no story or generation.
  - **Forward:** forward onto a pre-reload entry opens the normal start view at `/`. It never opens the story or sheet that entry recorded, and never starts generation.
  - Loading `/read?id=…` directly (typed, QR, console or reload) still opens the story as today.
  - The same rules apply to any fresh back or forward load of an entry the app created. That includes coming back after leaving the app when the browser could not restore the page from its cache, and after the tab was evicted. This is the one exception to "what URLs open stays unchanged".
  - A browser restore of the page exactly as it was left, from its back/forward cache, is not a reopen and is allowed.
- [x] Reader URLs (`/`, `/read?id=…`, `#provider-settings`) and what they open stay unchanged. URLs open the same views after a reload (the reload rules above govern back and forward), and behavior under React StrictMode in development matches production.

### Sheet depth
- [x] On phones, no more than two sheets are open at once, counted as open `dialog` elements. The one exception is the provider dialog when it is opened by URL hash over existing sheets.
- [x] When a sheet is open on top of another, its header shows the name of the sheet it returns to. Closing it, by button or by back, returns there.
- [x] Every action reachable today from the sheets involved stays reachable, with the same label and effect.
- [x] The reselection flow (替换选题) keeps its single server-side reselection session while its setup steps are shown. Reducing depth must not cancel, reopen or duplicate that session.

### Preservation
- [x] Every existing action, label and flow works as before, apart from the improvements above. That includes generation, review, revision, export, favorites, deletion with undo, and reselection.
- [x] The responsive redesign's layouts and its resize-state guarantees are unaffected.

## Constraints

- Builds on the landed responsive redesign. Back behavior is derived from its single state owner and derived views. There is no separate navigation state that could disagree with them.
- One reader app, with no URL changes and no server, API, storage, CLI or skill changes.
- Verify only with isolated data, and on iOS Safari, Chrome Android and a desktop browser.

## Notes for the plan

These came from architecture review. They describe constraints, not required designs.
- **Skip-through needs entry stamps.** Every entry the app owns, including the first one, needs a load id and an absolute depth, with the last known depth kept in `sessionStorage`, because Safari has no Navigation API. The skip decision must happen before the app renders and starts loading data.
- **Push history only during a user gesture.** Chrome's back button skips entries that a page added without user activation. Steps that open asynchronously, such as the workflow panel opening from an effect after a create submit, must reuse or replace an entry rather than push a new one, or back would skip a step.

## Review

AR passed after three rounds: no blocking architecture flaws. The review settled direct links, reload and stale entries (skip-through), the typed-input definition, docked versus drawer steps, and the hash-opened provider dialog.

## Verification (VR, 2026-11-06)

Evidence is from headless Chromium against isolated fixture libraries (`tests/phone-navigation.playwright.e2e.mjs`, cases PHONE-NAV-01 to 11), unit tests (`tests/history-steps.test.mjs` 24/24, `tests/history-dirty-ui.test.mjs` 3/3), the full suite (`pnpm test` 692/692) and the in-app browser at 375px.

| Criterion | Status | Evidence |
|---|---|---|
| Back closes the topmost step | complete | PHONE-NAV-01 (审核记录 → 故事设置 → reader, list scroll restored), 10 (drawer, workspace with selection kept, create page, reader drawer), 11 |
| Unsaved input asks | complete | PHONE-NAV-04 (back, Escape, forced close, rename; close buttons unchanged); render tests for the marks |
| Busy sheets stay consistent | complete | PHONE-NAV-05 (two backs and a forced close while saving; lock released after) |
| Forward reopens nothing | complete | PHONE-NAV-01/03 and 07 (no POST, no reader); unit test for live and stale forward |
| No dead press after in-app closes and exits | complete | PHONE-NAV-02, 04 (after save), 06 (creation submit), 09 (reselection cancel), 10 (leaveWorkspace); DESKTOP-LAYOUT-02 (exitToShell); unit tests for batch release and URL carry |
| 从头再看 is not a step | complete | `open()` keeps `story` set, so the reader's `useHistoryStep` stays registered; no push without a new step |
| Resize and reflow | complete | PHONE-NAV-11 (390 → 1280 → 390; rename across 900; nested 故事原文), 10 (docked panel becoming a drawer) |
| Direct links | complete | PHONE-NAV-07a (direct `/read?id=` and after a reload), 08 (direct `/#provider-settings` close stays on 我的) |
| Hash while open | complete | PHONE-NAV-08 (back closes it; the close button leaves no dead entry) |
| Stale entries after a reload | complete | PHONE-NAV-07 (one back leaves, no POST; forward shows `/`), 07b (app as first page); unit tests for page-load back, forward, restart and bfcache |
| URLs unchanged; StrictMode | complete | E2Es run on the development server (StrictMode); `/read?id=` reopens after reload |
| At most two sheets on phones | complete | PHONE-NAV-09 (修改分镜 leaves 故事设置 + 修改故事; 替换选题 alone), 11 (nested setup sheet) |
| Return labels | complete | PHONE-NAV-09 (返回「故事设置」), 11 (label after a layout switch) |
| Actions stay reachable | complete | STORY-LIFECYCLE C001–C008, PHONE-READABILITY (修改分镜 path updated to expect 分镜剧本 closed) |
| Single reselection session | complete | PHONE-NAV-09 (one request id), STORY-LIFECYCLE-C005 |
| Existing flows preserved | complete | `pnpm test` 692/692; STORY-LIFECYCLE 10/10; PHONE-READABILITY 2/2 |
| Responsive redesign unaffected | complete | DESKTOP-LAYOUT 13/13 |

**Constraint not met here:** "Verify … on iOS Safari, Chrome Android and a desktop browser." Only desktop Chromium (headless and in-app) was available. Not verified on devices: the iOS edge swipe, Safari without the Navigation API (the `history.length` fallback and the forward-into-first-entry ambiguity), and Chrome Android's back delivered as `cancel` and its close-watcher force close. The same code paths are exercised in Chromium via Escape, `dialog.close()` and `goBack`.

VR incomplete: real-device verification on iOS Safari and Chrome Android is outstanding; every acceptance criterion and AP task is otherwise complete with evidence.

## Non-goals

- Tab history (see the definition of a step).
- Swipe-to-dismiss on sheets or other gestures beyond back and forward.
- Readability and touch targets, which are in the phone-readability story.
- Offline or PWA behavior changes.
