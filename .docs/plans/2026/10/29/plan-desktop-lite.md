# Desktop Lite implementation

Story base: `baa0ee774841374d18a120264d20593e33a8ee97`.

Existing unrelated work: `.env.example`, README provider-model edits, home icons/manifest/service-worker/index edits, and `.docs/assets/`. Preserve it and exclude it from commits. Desktop documentation will live in a separate document to avoid mixing README edits.

## Architecture

The Tauri window loads only bundled settings assets. Narrow native commands validate configuration, use OS keyring credentials, supervise a system-Node child, choose paths, and open only generated application URLs. It never loads a remote page into a privileged webview. Keep secrets out of persisted JSON and command responses. Node receives configuration over stdin, serves the existing reader behind a desktop-only pairing gate, emits bounded status over stdout, and stops when stdin closes. The normal server entry point remains unchanged.

Bundle production dependency closure (including tiktoken WASM), not a developer checkout or Node binary. Discover Node from PATH and common install locations, allow an explicit path, then probe the actual runtime. Use Rust process management without shell interpolation, a single-instance plugin, and an exclusive per-data-directory lock. Store nonsecret configuration atomically. Keyring failure is an error, not permission to save plaintext.

Phone sharing binds LAN only when enabled. Pairing URLs carry a random per-run bearer in a fragment, exchange it for an HttpOnly SameSite session cookie, then remove the fragment. Verify Host/Origin, protect every application route, and leave no desktop settings HTTP endpoint. LAN links are trusted-network HTTP; sharing and sleep requirements are explicit in UI/docs. Closing the window hides it; explicit Quit stops the server.

## Ordered work

- [x] First SS probe: select installed Node 24.22.1, install a separate supported Rust toolchain without changing defaults, verify native Tauri compilation prerequisites, and prove production dependency packaging resolves SQLite/tokenizer/library assets from a standalone directory. Stop dependent work and revisit AR if the packaging/runtime premise fails.
- [x] Add a desktop runtime entry and pairing gate with bounded stdin/stdout protocol, safe provider metadata tests, startup/shutdown/error handling, and HTTP security/runtime tests; preserve ordinary server contracts.
- [x] Add Tauri Lite supervisor/configuration/keyring, explicit Node detection/probe, file/folder selection, generated-URL browser launch, data lock, single-instance/tray lifecycle, and meaningful Rust tests.
- [x] Add accessible React settings/status/QR UI, separate Vite configuration, and pinned pnpm tooling. Credential editing never reads a saved secret into the webview.
- [x] Add standalone resource staging, Lite package scripts, platform build CI, desktop documentation, and icon assets without bundling Node or personal data.
- [ ] Build and exercise the packaged macOS app and browser pairing using the matching E2E specification. Capture outcome/evidence and explicitly separate simulated network clients from a physical phone and macOS proof from other platforms.
- [ ] Run full applicable tests, typecheck, lint, build, Rust formatting/checks/tests, and security review; fix blocking failures and verify acceptance criteria.

## Verification

`pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, desktop resource/UI build and macOS Lite packaging; Rust tests/checks/fmt using the separate pinned toolchain. Tests cover credential isolation, configuration validation, pairing cookie and origin/host boundaries, Node mismatch/missing executable, ready/error/EOF/stop lifecycle, duplicate locks, persisted progress, dependency closure, and no Node/secret/user-data in payload. E2E: `.docs/tests/test-desktop-lite.md`.

Cross-platform release builds require their respective OS runners; do not claim local macOS tests prove them. Keyring integration is verified with a disposable non-provider credential; no existing personal secret is inspected. Provider generation tests remain mocked; metadata checks never generate content.

## Risks

GUI applications may not inherit nvm PATH; explicit selection and known-location discovery are required. Rust/native SDK build prerequisites and OS keyring availability differ by platform. Linux WebKit/Secret Service and Windows WebView2 remain system prerequisites. The installer includes books and dependencies, so Lite is not a tiny download. Existing Codex mode does not support native Windows. Port conflicts and network-interface changes must surface/recompute rather than advertise an unreachable URL.

## Review and evidence

AR passed: no blocking architecture flaws.

AR risk: non-low — new desktop deployment, credential storage, process supervision, and LAN access boundaries.

AR review round: 1; reviewer: new (`desktop_review`, independent/read-only).

Review requires active-request/descendant termination evidence, including detached Codex process groups, before releasing ownership. Browser automation is disabled in Work settings; native UI and HTTP checks remain available. Browser interaction evidence must not be claimed without execution.

SS evidence so far: Node 24.22.1; pnpm 11.25.0; separately installed Rust 1.93.0 aarch64; Tauri 2.12.5 (CLI/API 2.12.4). Standalone runtime successfully served the SQLite seed after relocation to a temporary directory outside the checkout. macOS unsigned `.app` built (148.07 MiB) and native UI opened. Native UI rejects missing Node and Node 22, detects Node 24 + SQLite, saves nonsecret settings, launches/stops the real packaged server, and shows a safe no-key metadata-check error. Six focused Node tests pass, including parent EOF with active fake Codex process-group descendants. Full Node suite: 168 passing. Rust: four passing unit tests; credential integration is separate.

Credential integration limit: this host rejects new Keychain entries with OSStatus -25293. A disposable Rust integration attempt and a disposable value entered in the packaged UI both failed. The UI displayed the safe storage error; the test value was cleared, and the actual settings JSON was checked to contain no credential. No real provider key or paid call was used. Successful native credential-store writes cannot be claimed on this host.

One initial packaged startup timed out; retry and direct execution of the packaged runtime succeeded. Retest final packaged startup/lifecycle before acceptance. Pending: independent CR, final native/packaged HTTP E2E, final evidence reconciliation.
