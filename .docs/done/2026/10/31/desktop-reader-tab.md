# Desktop overview

## Summary

Replaced the embedded reader with an operational overview: 概览 / 生成队列 / 设置. The launch action saves pending settings, checks the bundled runtime, starts the service and opens the browser. The overview shows real generated-record metrics, actionable tasks, recent themes and reading positions, runtime context and phone access; queue triage includes incomplete records before jobs exist. Native privileges and credentials remain local-only, and iframe-specific files and CSP permissions are removed.

Follow-up polish removes developer-preview labels and implementation hints, fixes the book-art caption position, and makes “启动服务” a forest-green primary button with a distinct stop state. README includes the real installed-app screenshot at `.docs/assets/desktop-overview.jpg`, the condensed book/theme/style and entry-point guidance, and current desktop wording without Lite references. Desktop documentation preserves working download filenames and compatibility facts.

## Verification

- Node 24.22.1 / pnpm 11.25.0: the overview implementation passed the full JavaScript suite, 714/714 with zero failures/skips/cancellations (86.6s). After the later presentation changes, focused overview tests passed again, 4/4; current typecheck, lint and diff checks passed. The unaffected full-suite evidence is reused.
- Rust 1.93.0: formatting and 19 applicable tests passed during overview validation with the disclosed test-only resource override; one prepared-bundle-dependent test was filtered and has not been rerun. Prior independent CR round 4 and VR round 2 cover the overview behavior; subsequent localized copy/style/documentation changes received low-risk self-review with no major findings.
- Separate Playwright/Chromium ET previously passed real disposable-library summaries and reader popup, queue/keyboard/responsive navigation, safe URL refusal, loading/error/retry/empty states and unchanged record/job snapshots. Native-IPC simulation covered launch ordering and failure recovery, duplicate gating, first use, environment-only setup, stopping and phone QR/copy behavior. This evidence is distinct from native OS verification.
- At the user's explicit request, `PATH=/Users/esun/.nvm/versions/node/v24.22.1/bin:$PATH RUSTUP_TOOLCHAIN=1.93.0-aarch64-apple-darwin pnpm desktop:build --bundles app` passed for the final source. The default Intel Rust toolchain initially failed the native-architecture guard; using the pinned ARM toolchain resolved it without a source change. The installed app at `~/Applications/Shiqu.app` matches the final bundled executable byte-for-byte. It opened successfully, read 26 existing generated records, reported bundled Node 24.22.1 ready, and displayed the enabled green “启动服务” button. The README screenshot is an inspected 2080×1640 JPEG of this native window.
- Final installed-resource check: `pnpm desktop:smoke '/Users/esun/Applications/Shiqu.app/Contents/Resources/runtime'` passed with bundled Node, no system Node on PATH, all 24 books, empty relocated library, HTTP and LAN access, restart/shutdown and zero paid calls. README image references, JPEG signature and absence of Lite wording were checked.

## Notes

Story base remains `6cb7e7708229f67ad3eb39845f6ea25d7de5008d`. Existing local milestones are `c1ee435` and `47b2025` for the superseded embed, then `849f8f1`, `c42c06c` and `618c9a6` for the overview. The current user instruction authorizes final GC including all pending root README edits and the screenshot, which were previously excluded from overview milestone commits. No push is authorized or performed.

The user subsequently authorized native packaging/install/run and removal of the installed Lite app. That app was moved to Trash; the shared library and settings were retained. These later native checks supersede the original preview-only packaging restriction and the earlier package-smoke limitation below. No Docker image or paid generation was run. Native OS reader-opener and tray lifecycle checks remain unrun; the earlier prepared-bundle unit test remains filtered in the recorded Rust result. Installed-resource smoke used disposable data, and the native screenshot shows the existing library with its service stopped.

## Original independent overview validation (verbatim)

The original final VR result is preserved below, including its then-current scope and limits. Later copy/style/README follow-ups are covered by the current checks above; its historical “no packaging” and README-exclusion statements do not describe the final delivery scope.

VR passed: all acceptance criteria complete

VR risk: non-low — replaces the primary desktop experience and coordinates native startup, saved settings, browser opening, and operational summaries.

VR review round: 2; reviewer: reused (`reader_review`).

1. Complete — the desktop exposes exactly 概览 / 生成队列 / 设置, defaults to overview, and directs unconfigured native first use to settings. Code and ET confirm removal of the embedded reader, frame controls, and permanent preview banner.
2. Complete — native launch sequencing saves pending settings, uses the returned snapshot for runtime detection, starts the service, checks running status, and then opens the browser. IPC simulation covers running-service reuse, save/runtime/start failures, non-running responses, opener failure with service retained, retry, and duplicate-action prevention. Preview launch accepts only validated explicit loopback roots and exposes no native service controls.
3. Complete — unknown/unavailable supervisor states are explicit. Configuration distinguishes saved profiles from environment-only startup eligibility without claiming connection health or exposing keys. Real disposable-library summaries substantiate completed/active/actionable/saved counts, recent ordering, theme, generated readiness, and reading position. Loading/error states show unavailable metrics; browser/queue entry points create no new generation.
4. Complete — the final rendered overview has a clear launch hero, useful metrics, actionable records, recent stories, runtime context, and phone access. Final screenshots and ET cover 760×640, 1040×820, 1440×1000, and 390×820 layouts, keyboard navigation, and populated/empty/loading/error/running/stopped states. The final screenshot was independently inspected; added reading metadata fits.
5. Complete — queue rendering and triage retain incomplete records, including choices without jobs. Existing native settings, credential, lifecycle, sharing, and ownership contracts remain in place. Read-only summary checks produced identical generated-record/job snapshots before and after overview use. LAN/private internet QR selection, copy behavior, and privacy notices passed IPC simulation. Embed files/tests/styles and iframe-only CSP allowance are removed; capabilities remain local-only.
6. Complete — the full JavaScript suite passed 714/714 with zero failures, skips, or cancellations in 86.6 seconds. All four focused overview tests passed after the final label correction; final typecheck, lint, formatting, and diff checks passed. Nineteen applicable Rust tests passed with the disclosed resource override; one prepared-bundle-dependent case was filtered. Final ET passed, including environment-only metadata, unsafe URL refusal, launch/error flows, and no uncaught browser errors. Documentation describes the final product boundary and verification limits.

All plan tasks are complete. Source is unchanged since CR round 4, whose “CR passed: no major findings” verdict remains valid. The unrelated root README working diff is excluded.

Verification limits: browser evidence comes from the disclosed separate Playwright/Chromium fallback because the in-app browser was unavailable. Native OS browser-opening, tray/package smoke, and the prepared-bundle test remain unrun under the stated constraints. No desktop preparation/packaging, Docker builds, paid generation, or personal-data writes were performed.
