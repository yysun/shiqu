# Desktop reader tab

## Summary

Added “阅读与创作” to the desktop shell. It embeds the already bundled local reader with its existing discovery, creation, shelf, reading, API, media, and progress behavior. Tab switching retains the reader document; explicit reload replaces it, and stopped service status removes it even while hidden. Service, settings, browser opening and phone sharing controls remain available.

Only validated cross-origin loopback roots can load in the sandbox. The shell CSP admits loopback frames, and native capability scope remains unchanged. Preview accepts an explicit development-only reader URL; invalid or missing configuration shows instructions. Desktop README documents setup and boundaries.

## Verification

Node 24.22.1 / pnpm 11.25.0: 714 JavaScript tests passed, no failures/skips/cancellations. Typecheck, lint, Rust formatting and diff checks passed. Rust: 19 passed with test-only empty resource override, one prepared-bundle-dependent test excluded. Separate Playwright/Chromium ET passed real navigation/progress, persistent document/reload, ZIP download, failed-network recovery, keyboard tabs, responsive layouts, invalid configuration, and native-shell lifecycle simulation with mocked IPC. Detailed evidence and commands are in the plan.

## Notes

In-app browser access was disabled in Work settings; the explicitly permitted separate browser fallback was used. Native WebKit/WebView2 runtime behavior remains unverified. No native preparation/packaging, Docker build, push or paid generation. Only disposable library records were changed. Temporary preview processes started for this story were stopped; existing user previews were left running.

Implementation milestone: `c1ee435`. Story base: `6cb7e7708229f67ad3eb39845f6ea25d7de5008d`.

## Final validation result

VR passed: all acceptance criteria complete

VR risk: non-low — embeds server content inside the native shell and changes CSP, origin isolation, and reader lifecycle.

VR review round: 1; reviewer: reused (`reader_review`).

1. Complete — “阅读与创作” embeds the existing reader frontend. Real discovery, shelf, and story navigation passed; keyboard navigation covered all four desktop tabs.
2. Complete — native source selection accepts only the running supervisor’s validated loopback URL. Regression tests and real-shell IPC simulation cover stopped instructions, start, hidden-frame removal on stop, and fresh-document restart. Existing integration tests cover actual server stop/restart.
3. Complete — the reader panel remains mounted across desktop tab changes. ET confirmed exact document/current-story persistence and explicit reload creating a new document with saved progress restored. Existing desktop controls remain available.
4. Complete — frame API writes, media export, and saved state work on the reader’s origin; parent DOM access was denied. Sandbox excludes shell navigation and popups. Scoped CSP and unchanged capabilities, supported by pinned Tauri remote-origin ACL inspection, preserve native permission separation.
5. Complete — explicit loopback preview passed using a disposable read-only library without paid generation. ET covered progress/bookmark writes, persistence, reload, ZIP download, unavailable-server recovery, and 390/760/1040/1440 layouts. Missing, external, and shell-origin preview addresses created no frame.
6. Complete — JavaScript tests passed 714/714 with no failures, skips, or cancellations; typecheck, lint, Rust formatting, and diff checks passed. Applicable Rust tests passed 19/19; the prepared-bundle-dependent case was explicitly excluded. Desktop documentation explains preview setup and verification limits.

The refined E2E document and evidence do not invalidate CR; the existing “CR passed: no major findings” verdict remains valid. All plan tasks are complete.

Verification limits: browser evidence comes from the disclosed separate Playwright/Chromium fallback because the in-app browser was unavailable. Native WebKit/WebView2 runtime smoke and the prepared-bundle test remain unrun under the stated constraints; no native packaging or Docker build was performed.
