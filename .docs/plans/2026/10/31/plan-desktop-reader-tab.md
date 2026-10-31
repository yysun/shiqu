# Desktop reader tab

Story base: `6cb7e7708229f67ad3eb39845f6ea25d7de5008d`. Working tree clean at entry.

## Design

Embed the existing local reader in a cross-origin sandboxed iframe, rather than import its React tree into the privileged settings document. Preserve same-origin reader requests and local storage with `allow-scripts allow-same-origin`; permit downloads for existing export links. Do not permit top navigation, popups, or native IPC. Keep Tauri capabilities local to the bundled main document; add only `frame-src http://127.0.0.1:*` to the shell CSP. Validate frame URLs as HTTP, exact 127.0.0.1 host, root path, no credentials/query/fragment, and a different origin from the preview shell. No network/proxy or native command changes.

Native URL comes solely from running `server_status`. Development uses optional `VITE_DESKTOP_READER_URL` only under `import.meta.env.DEV`, validated identically. With no preview URL show setup instructions; preview does not start the service. Native stopped state points to the existing start control. Make the reader panel persistent after first selection and hide it on other tabs; remove its frame whenever the service stops. Reload changes the frame key. Add an explicit iframe title and visible recovery instructions because cross-origin iframe load events cannot prove application readiness.

The reader tab expands the shell's maximum width and gives the frame at least a phone-width viewport beside existing service controls. Narrow layouts stack controls; other tabs keep current layout. Initial tab and first-use settings behavior remain unchanged.

## Tasks

AR passed: no blocking architecture flaws

AR risk: non-low — embeds server content inside the privileged native shell and changes CSP, origin isolation, and lifecycle presentation.
AR review round: 1; reviewer: new (`reader_review`).

AR constraints: reject preview shell origin; stop must destroy hidden frames; never treat iframe onLoad as application readiness. Pinned Tauri 2.12.5 remote-origin ACL denies custom commands without remote capabilities, although injected bridge globals may exist in Windows subframes. Browser fallback is required because in-app browser access is disabled in Work settings; report its evidence separately.

- [x] Bounded feasibility probe: inspect pinned Tauri remote-origin ACL behavior and reader export/API assumptions; run actual reader + desktop Vite previews with a disposable read-only library and check frame rendering/same-origin writes before relying on the design. If blocked by CSP/origin/native ACL, revisit architecture before dependent work.
- [x] Add URL validation, persistent reader panel, loading/reload guidance, tab wiring and responsive styles in `desktop/`; scope `src-tauri/tauri.conf.json` frame CSP and update capability description without remote permissions.
- [x] Add focused URL/security and rendered-frame regression checks; update `desktop/README.md` with user behavior and explicit preview environment setup.
- [x] Run full JS tests, typecheck/lint, and applicable native tests/format checks; execute `.docs/tests/test-desktop-reader-tab.md` in the in-app browser or the permitted separate Playwright fallback when unavailable. Record packaged native verification as unrun.

## Verification and risks

Cross-origin writes must originate inside the frame, not the shell. Test rejecting external/credentialed/relative/same-origin frame URLs and HTTP gate foreign writes. Browser preview is not proof of native compositor, download, or mixed-content behavior. No native preparation/build is authorized; native acceptance is supported by scoped config and pinned Tauri ACL implementation plus available local tests, with manual platform smoke left explicit. Hidden readers retain their existing generation observation semantics; switching tabs does not cancel or restart work. Stop destroys the document and existing server shutdown cancels owned generation. Cross-origin errors use explicit reload/service help, not a misleading “ready” claim from iframe onLoad.

## Implementation evidence

Feasibility passed with the real reader at 127.0.0.1:3010 and a separate loopback shell: reader rendered, progress POST returned 200, frame origin remained the reader origin, and parent DOM access was denied. Initial mocked-route probe was rejected by Chromium local-network address-space checks; replacing the synthetic intercepted response with a real loopback HTTP shell passed without weakening browser protections. The fixture used `/tmp/shiqu-reader-tab-check/library` with readonly provider and one synthetic story. No personal library writes or generation calls.

Implemented source selection, persistent hidden panel, stop-gated frame, explicit reload, scoped loopback CSP, and unchanged local-only capability permissions. Focused tests: 4/4 passed; initial typecheck passed. Actual desktop Vite preview at 127.0.0.1:1421 displays the reader with all four tabs and service/sharing controls; 1040px screenshot inspected. In-app browser unavailable (Work settings disabled), so this is separate Playwright/Chromium evidence, not the user's browser session or native Tauri verification.

Implementation milestone: `c1ee435` — reader tab, sandbox/origin restrictions, lifecycle, responsive styles, focused regression tests, and desktop README. No push.

CR passed: no major findings

CR risk: non-low — changes the native shell's embedded-content boundary, CSP, and reader lifecycle.
CR review round: 1; reviewer: reused (`reader_review`).

Typecheck/lint and Rust formatting passed. Native test default invocation could not run because prepared bundled Node resources are absent. With test-only `TAURI_CONFIG='{"bundle":{"resources":[]}}'`, 19 Rust tests passed; `desktop_uses_verified_bundle_and_ignores_saved_system_path` was explicitly filtered because it requires those resources. No native preparation or packaging ran.

## Final verification evidence

Node 24.22.1 / pnpm 11.25.0. `pnpm exec node --experimental-strip-types --test --test-concurrency=2 tests/*.test.mjs`: 714/714 passed, zero failures/skips/cancellations, 86.8 seconds. Log: `/tmp/shiqu-reader-tab-check/js-tests.log`. `pnpm typecheck`, `pnpm lint`, `cargo fmt --check`, and `git diff --check` passed. Rust command: `TAURI_CONFIG='{"bundle":{"resources":[]}}' cargo test --locked -- --skip desktop_uses_verified_bundle_and_ignores_saved_system_path` in `src-tauri`: 19 passed, one resource-dependent test filtered. Existing HTTP lifecycle tests cover real stop/restart, shared progress, and rejection of foreign-origin writes.

ET completed against actual `pnpm dev --port 3010` + `pnpm desktop:preview --port 1421`, both using the disposable library. In-app browser unavailable; all following browser evidence is from a separate Playwright 1.61.1 / installed Chromium headless session:

- Real reader discovery → shelf → synthetic story, page navigation/bookmark, server progress confirmed at page 1 and saved=1; reader origin preserved and parent DOM access denied.
- Tab visits to settings, queue and shelf retain the exact reader document/current story. Explicit reload creates a new document and resumes saved progress.
- Reading preferences export/download a real ZIP using same-origin fixture media; no generation/provider requests. Initial data-URL fixture was unsuitable for the reader's existing export origin contract; corrected the disposable fixture rather than product code.
- Keyboard End/Home/ArrowRight navigate four tabs. Widths 390/760/1040/1440 have no document overflow, reader width >=320px, controls width >=240px. Screenshots `/tmp/shiqu-reader-tab-check/reader-{width}.png`; 760px and 390px visually inspected in addition to initial 1040px view.
- Reader navigation refused in the test network: reload/service guidance remains; restoring networking + reload recovers. Service workers blocked only in this error-injection test context so cache cannot hide the simulated connection failure.
- Actual alternate Vite previews at 1422 with missing URL, `https://example.com`, and shell-origin URL each show the correct instructions/refusal without creating a frame or contacting the external URL.
- Native-shell IPC simulation using the real desktop React app: stopped placeholder, start → frame, switching away then stopping removes hidden frame, restarting creates a fresh document. IPC is mocked here; native runtime behavior is not claimed. No uncaught browser errors.

ET passed: all scenarios completed at their documented verification level. Native WebKit/WebView2 compositor/mixed-content/download/IPC runtime smoke and bundled-node resource test remain unrun, as specified in constraints. No Docker builds, desktop preparation/packaging, pushes, personal-data writes, or paid generation.

VR passed: all acceptance criteria complete

VR risk: non-low — embeds server content inside the native shell and changes CSP, origin isolation, and reader lifecycle.
VR review round: 1; reviewer: reused (`reader_review`).

Independent review confirmed all six acceptance criteria and all plan tasks complete. Refined E2E document/evidence preserve the existing CR pass. Full final VR result is preserved verbatim in `.docs/done/2026/10/31/desktop-reader-tab.md`.
