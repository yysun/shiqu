# Desktop overview — revised direction

The desktop shell should make the local reader easy to start and manage. Embedding the mobile-oriented frontend duplicated navigation and introduced a second reading surface. Replace it with an attractive operational overview; reading and creation open in the browser.

## Acceptance criteria

- [x] The desktop has exactly 概览 / 生成队列 / 设置, with overview selected by default and first-time unconfigured native installs still opening settings. No embedded reader, frame toolbar, or permanent informational banner remains.
- [x] A prominent native action opens the running reader, or saves pending settings, verifies the bundled runtime, starts the service, then opens the browser in that order. Start/save/runtime failure never opens a browser; opener failure leaves the running service available and reports the error. Repeated clicks are disabled while pending. Unconfigured users are directed to settings. Preview can open only an explicitly configured validated loopback reader and cannot start/stop native services.
- [x] The overview shows honest operational information: actual supervisor state, saved provider/model and library path (not a claim of effective environment overrides or connection health), and real generated-library summaries for completed/active/actionable/saved records. Missing/error/loading data never appears as fabricated zero counts. Recent records and actionable work offer browser/queue entry points without starting generation.
- [x] The page is polished and responsive: a distinctive primary launch area, useful metrics, recent stories, actionable work, runtime context and phone access; clear hierarchy, keyboard controls and readable states at 760×640, 1040×820, wide and narrow layouts. Empty, loading, error, readonly and running/stopped states are usable. No decorative charts or invented activity.
- [x] Existing queue, saved settings/credential handling, server lifecycle, external browser opening, local/LAN/internet sharing and data ownership retain their contracts. Summary reads remain read-only; phone links retain their privacy notices and native-only service controls. Remove iframe-only CSP allowances and obsolete embed files/tests.
- [x] Focused and full applicable checks pass, overview and browser-launch flows are verified using disposable data and no paid generation, docs describe the new product boundary, and native runtime limits are reported accurately.

## Constraints and non-goals

Node 24.22.1 / pnpm 11.25.0. Use existing native commands and library-summary contract; no database migration, new HTTP service-control routes, new dependencies, automatic generation, Docker builds, desktop preparation or native packaging. Preview through pnpm desktop:preview; prefer the in-app browser, using the user-permitted separate Playwright fallback only if unavailable. Keep credentials out of HTTP and overview payloads. Existing summary covers latest visible generated-session records, not published/demo stories; labels must reflect that scope.

This revision supersedes the prior embed acceptance criteria and their pass claims.
