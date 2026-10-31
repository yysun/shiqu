# Desktop overview — revised direction

Story base remains `6cb7e7708229f67ad3eb39845f6ea25d7de5008d`. Prior embed milestones: `c1ee435`, `47b2025`. Revision entry HEAD: `47b2025e844f23fce2bcac75bc377ffce0eed0ae`. Existing uncommitted tab/header/refresh/height/open-browser changes are authorized follow-ups in this story's scope; pre-revision diff saved at `/tmp/shiqu-reader-tab-check/pre-overview.patch`. Preserve other work if discovered. The embed plan and prior CR/VR passes are superseded.

## Design

Replace the embedded-reader-first experience with an operational overview. Keep the existing top brand and three-tab keyboard navigation; change tabs to 概览 / 生成队列 / 设置. Build a forest-green launch hero, warm-paper library metrics, actionable work and recent records, with compact runtime/service and phone access controls alongside. Use existing system/Chinese serif fonts, restrained gold/green accents, clear empty states and responsive stacking. Keep settings controls and sharing explanations; avoid a duplicate giant service CTA beside the main hero.

The primary native action reuses get_settings/detect_node/save_settings/start_server/open_reader and the existing action/error state. Unconfigured users go to settings. Running users invoke open_reader. Stopped users save pending form changes, verify the bundled runtime, await start_server and set returned status, then invoke open_reader only after successful running status. A failed opener does not stop a newly started server. Native controls remain disabled in browser preview. Preview uses the established VITE_DESKTOP_READER_URL solely as a validated HTTP 127.0.0.1 root link with no credentials/query/fragment; it is not an embedded page or a simulated native running status.

Reuse the current library_summary command and /__desktop/library preview reads. Extract a shared summary read hook/types used by overview and queue to avoid duplicated polling. Keep the SQL/HTTP/native read contract unchanged, including latest-revision/deletion/owner filtering. Metrics classify existing summary rows; action-needed includes failed jobs/stories, pending choices/confirmations/frame count and idle incomplete records. Status categories are disjoint; completed counts exclude active/failed work. Saved count covers the same generated records. Unknown data shows dashes and error/retry, not empty-library zeroes. Clear captions identify generated-record scope. Recent records show book/theme/art style and saved progress; open actions launch the browser root, not unsupported deep links. Saved provider/model is labelled as saved configuration because environment overrides can differ at runtime.

Remove ReaderPane.tsx, reader-frame.ts and embed-only tests/styles; replace their relevant URL and capability checks with overview/launch tests. Remove frame-src loopback CSP, preserve existing local-only capabilities and open_reader URL validation. No new native command or public control endpoint. Keep published/demo frontend and server files unchanged.

## Ordered implementation tasks

- [x] Bounded first probe: inspect summary category data and native start/open error behavior; render the actual overview preview with a temporary library and verify it needs no backend/schema changes. Stop dependent work and revisit AR if existing contracts cannot supply the requirements.
- [x] Add shared summary types/read hook and pure overview classification, plus a polished OverviewPane with honest loading/error/empty/record states and actionable launch/queue/settings entry points.
- [x] Wire native start-and-open sequencing, native/preview browser launch, default tabs, compact runtime context and retained phone/queue/settings controls. Remove embedded reader, iframe styles and CSP allowance.
- [x] Replace embed tests with overview classification/render/config/launch coverage, update README and E2E scenarios, and verify all source changes as one batch.
- [x] Run focused and complete JS TT, typecheck/lint, applicable Rust tests/format with explicit prepared-resource exclusions, and the revised E2E scenarios. Capture/inspect actual rendered screenshots and resolve visible issues.

## Verification and risks

Meaningful tests cover active vs failed/choice/completed counts, no fake zeros, safe preview URL rejection, no iframe/CSP allowance, and start/open ordering/errors/duplicate gating. Browser E2E uses real Vite summary reads in a disposable generated library and a separately disclosed native-IPC simulation to assert command order and error recovery. No paid provider calls. Existing integration suites retain actual local server lifecycle and data protocol coverage.

Native WebKit/WebView2 external-opener behavior and prepared bundled Node test remain separate from browser evidence. No packaging/preparation is authorized. Check in-app access again; use the established separate browser fallback only when necessary and report it. Prior screenshot/evidence proves only the previous embed UI and cannot validate this overview.

## Architecture review

AR passed: no blocking architecture flaws

AR risk: non-low — replaces the desktop’s primary experience and coordinates saved settings, native runtime startup, external browser opening, and operational summaries.
AR review round: 2; reviewer: reused (`reader_review`).

Review constraints: initial/failed supervisor reads are unknown/unavailable, not verified stopped. Use the settings snapshot returned by save for subsequent runtime checks; require running start status before opening. Opener errors leave the service running. Failed/user-choice checkpoints take precedence and generated-record categories are disjoint. Preserve SQL recent order. Failed reads show unavailable metrics (or explicitly stale data), never fabricated zeroes. Remove all embed-specific files/styles/CSP while retaining native URL validation and local-only permissions.

## Feasibility and implementation notes

The actual Vite overview rendered using `/tmp/shiqu-overview-check/library`, containing five synthetic generated records. Existing readLibrarySummary produced all required fields without SQL/schema changes; counts were 2 completed, 1 active, 2 actionable, 2 saved. Actual preview screenshot inspected at 1040px. A first inspection waited for a record outside the four-item recent list; corrected the probe expectation to a visible record, with no product change.

Queue inspection found that its old `jobs>0 || running/failed` filter hid idle choice/confirmation records before job creation. Include all incomplete generated records alongside the existing job-bearing history so overview triage can reach those records; existing grouped rendering and completed history remain intact. This is within the revised actionable-work outcome, not a new persistence contract.

Concurrent workspace note: an unrelated root README.md change appeared during implementation; preserve it and exclude it from this story's commits/review. Desktop README.md changes remain in scope.

Implementation batch complete: shared read-only polling/types, disjoint summary classification and records, overview UI, guarded save/detect/start/open sequencing, truthful supervisor states, retained queue/settings/sharing, and removal of iframe files/CSP. Focused overview+library tests 8/8 and typecheck passed. New screenshot shows the actual Vite page with fixture-derived counts and no iframe. Full TT/native-IPC and browser ET remain pending.

Implementation milestone: `849f8f1` — operational overview, native launch sequencing/state handling, shared summaries and triage, browser URL validation, and embed/CSP removal. The milestone includes authorized previous UI corrections; it excludes concurrent root README.md work. No push or packaging.

CR blocked: recent-story rows omit the approved reading context.

CR risk: non-low — replaces the primary desktop experience and coordinates native startup, saved settings, browser opening, and operational summaries.
CR review round: 2; reviewer: reused (`reader_review`).

Fix implemented for rerun: recent rows include theme/art style and an explicitly labelled saved reading position, distinct from generated-image readiness. No other review blockers were reported. Initial real-preview ET passed counts, actual browser opening, choice-to-queue, keyboard/layout and loading/error/retry/empty states without record/queue writes. Native ET harness used an overly exact directory-label selector; corrected the selector to match the existing nested label, with no product change. Native flow verification remains pending.

CR fixed: recent stories now show theme and explicitly labelled reading position separately from generated-image progress; rerun result passed.

CR risk: non-low — replaces the primary desktop experience and coordinates native startup, saved settings, browser opening, and operational summaries.
CR review round: 3; reviewer: reused (`reader_review`).

Fix milestone: `c42c06c`. Final responsive screenshots confirm the extra metadata fits. ET completed all revised scenarios in a separate Playwright/Chromium session because in-app access remained disabled. Actual Vite reads and reader popup used the same disposable library; before/after generated-record/job snapshots were identical. Native-IPC simulation passed configured/unconfigured and unknown/unavailable states, dirty-save snapshot precedence, detect/start/open order, save/runtime/start failures, non-running start responses, retained service after opener failure and retry, synchronous duplicate-click gating, stopping, and LAN/private internet QR selection/copy. Missing, external, credentialed, query-bearing and self-targeted preview URLs were refused. No uncaught browser errors. Log: `/tmp/shiqu-overview-check/e2e.log`.

Typecheck, lint and Rust formatting passed. Native tests: 19 passed using test-only `TAURI_CONFIG='{"bundle":{"resources":[]}}'`; prepared-bundle-dependent `desktop_uses_verified_bundle_and_ignores_saved_system_path` was filtered because bundled resources are absent. Native platform opener/tray/package smoke remains unrun. Full JS TT still running.

Final metadata edge case: when environment-only setup enables launch but no saved provider profile is configured, show “本次启动使用环境配置” instead of describing default model fields as a saved configured provider. Added focused render coverage and a native-IPC scenario; this changes only configuration labelling, not launch/control behavior.

## Final verification

Milestones: `849f8f1` overview replacement, `c42c06c` recent-story context, `618c9a6` environment-only configuration label. Final CR:

CR passed: no major findings

CR risk: non-low — replaces the primary desktop experience and coordinates native startup, saved settings, browser opening, and operational summaries.
CR review round: 4; reviewer: reused (`reader_review`).

Full JavaScript suite: Node 24.22.1/pnpm 11.25.0, `pnpm exec node --experimental-strip-types --test --test-concurrency=2 tests/*.test.mjs`, 714/714 passed with zero failures/skips/cancellations in 86.6 seconds. Log `/tmp/shiqu-overview-check/js-tests.log`. After the final label-only correction, all four focused overview tests passed again including the added environment-only assertion; all unaffected full-suite evidence is reused. Final typecheck/lint and diff checks passed.

Native checks: Rust 1.93.0, formatting passed; Node24 PATH plus `TAURI_CONFIG='{"bundle":{"resources":[]}}' cargo test --locked -- --skip desktop_uses_verified_bundle_and_ignores_saved_system_path` in src-tauri passed 19 tests, with only the prepared-bundle case filtered. No native preparation/package build was performed. System browser/tray/package smoke remains unrun under the stated constraints.

Final ET rerun passed all scenarios, including the added environment-only setup case: real preview counts/order and labelled reading position; actual reader popup with isolated opener; waiting choice reachable in queue; keyboard navigation; 760×640, 1040×820, 1440×1000, 390×820 screenshots; loading/dashes, failure/retry and successful empty/zero states; identical generated-record/job snapshots before/after. Native-IPC simulation verifies saved canonical snapshot precedence and command order, runtime/save/start/non-running-result failures, service retained after opener failure and retry, duplicate gating, first-use settings, unknown/unavailable status, environment-only launch eligibility, stop and private/LAN QR selection/copy. Alternate real previews reject absent/external/credentialed/query/self URLs. No uncaught browser errors, paid calls, personal writes or new generation. `/tmp/shiqu-overview-check/e2e.log` records the completed run.

Final actual Vite preview screenshot is `outputs/desktop-overview.png` (temporary data, separate fallback browser). Populated 1040px and 390px images and native-simulation stopped layout were visually inspected; reading-position metadata fits. In-app browser still reported disabled in Work settings. No broad claim of native OS verification is made.

VR passed: all acceptance criteria complete

VR risk: non-low — replaces the primary desktop experience and coordinates native startup, saved settings, browser opening, and operational summaries.
VR review round: 2; reviewer: reused (`reader_review`).

Independent final validation confirms all six criteria and all plan tasks complete. Full final VR result is preserved verbatim in `.docs/done/2026/10/31/desktop-reader-tab.md`. Stops before GC; source milestones are local and unpushed, revised story documentation remains reviewable in the working tree alongside the preserved unrelated root README change.
