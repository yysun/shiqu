# Desktop editions implementation — Standard by default

Story base: `baa0ee774841374d18a120264d20593e33a8ee97`.

Existing unrelated work: `.env.example`, README provider-model edits, home icons/manifest/service-worker/index edits, and `.docs/assets/`. Preserve it and exclude it from commits. Desktop documentation will live in a separate document to avoid mixing README edits.

## Architecture

The Tauri window loads only bundled settings assets. Narrow native commands validate configuration, use OS keyring credentials, supervise a Node child, choose paths, and open only generated application URLs. Standard uses a compiled-in bundled-node feature and always launches the packaged pinned runtime. Lite disables that feature and uses the existing system-Node path logic. Neither loads a remote page into a privileged webview. Keep secrets out of persisted JSON and command responses. Node receives configuration over stdin, serves the existing reader behind a desktop-only pairing gate, emits bounded status over stdout, and stops when stdin closes. The normal server entry point and `pnpm start` remain unchanged.

Bundle production dependency closure (including the repository's preexisting tokenizer WASM), not a developer checkout. Standard additionally copies the exact running Node 24.22.1 executable and installed license notices into a separate resource directory, checking build version/platform/architecture and writing provenance/checksums. Native runtime selection validates the bundled executable and never falls back. Lite omits that resource through an explicit configuration override and retains discovery/manual selection. Both use the same app identity/data format and are alternative installations. Use Rust process management without shell interpolation, a single-instance plugin, and an exclusive per-data-directory lock. Store nonsecret configuration atomically. Keyring failure is an error, not permission to save plaintext.

Phone sharing binds LAN only when enabled. Pairing URLs carry a random per-run bearer in a fragment, exchange it for an HttpOnly SameSite session cookie, then remove the fragment. Verify Host/Origin, protect every application route, and leave no desktop settings HTTP endpoint. LAN links are trusted-network HTTP; sharing and sleep requirements are explicit in UI/docs. Closing the window hides it; explicit Quit stops the server.

## Ordered work

The user's Standard request supersedes Lite-only delivery. Prior implementation and valid evidence are retained; architecture review is reopened for bundling and edition selection.

- [x] First revised SS probe: verify the installed pinned Node executable, matching native architecture, and license notices can be staged independently and execute SQLite without a system Node PATH. Revisit AR if unavailable/mismatched.
- [x] Make Standard the default Tauri/package build using `build.features: ["bundled-node"]` and bundled Node resources; retain a Lite override that clears the feature/resources and ensure Lite excludes the runtime. Exercise Rust tests in both feature modes. Add runtime-selection/missing-bundle tests and edition-aware settings.
- [ ] Extend packaged smoke verification to relocate bundled Node, validate manifest/checksum, and run with no system Node PATH; preserve Lite checks. Update both-variant CI and desktop documentation.

- [x] First SS probe: select installed Node 24.22.1, install a separate supported Rust toolchain without changing defaults, verify native Tauri compilation prerequisites, and prove production dependency packaging resolves SQLite/tokenizer/library assets from a standalone directory. Stop dependent work and revisit AR if the packaging/runtime premise fails.
- [x] Add a desktop runtime entry and pairing gate with bounded stdin/stdout protocol, safe provider metadata tests, startup/shutdown/error handling, and HTTP security/runtime tests; preserve ordinary server contracts.
- [x] Add Tauri Lite supervisor/configuration/keyring, explicit Node detection/probe, file/folder selection, generated-URL browser launch, data lock, single-instance/tray lifecycle, and meaningful Rust tests.
- [x] Add accessible React settings/status/QR UI, separate Vite configuration, and pinned pnpm tooling. Credential editing never reads a saved secret into the webview.
- [x] Add standalone resource staging, Lite package scripts, platform build CI, desktop documentation, and icon assets without bundling Node or personal data.
- [ ] Build and exercise the packaged macOS app and browser pairing using the matching E2E specification. Capture outcome/evidence and explicitly separate simulated network clients from a physical phone and macOS proof from other platforms.
- [ ] Run full applicable tests, typecheck, lint, build, Rust formatting/checks/tests, and security review; fix blocking failures and verify acceptance criteria.

## Verification

`pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, both desktop resource/UI builds, macOS Standard packaging, and Lite exclusion validation; Rust checks/tests/fmt using the separate pinned toolchain. Add Standard no-system-Node execution and exact-version/checksum/license/architecture checks to prior credential, pairing, ownership, persistence, and lifecycle evidence. E2E: `.docs/tests/test-desktop-lite.md`.

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

Lite milestone commit: `e06b1d3`; subsequent lifecycle/CI verification fixes are pending the next milestone. CR round 1 fixed CI resource preparation and Windows POSIX-fixture routing; round 2 passed affected lifecycle/smoke changes. Later native HTTP tests proved pairing, LAN access and progress writes with unprotected app-data storage. A prior hang/startup timeout was localized by process sampling to SQLite filesystem sync under macOS-protected Documents; app-data and relocated temporary directories resolve it. Window close kept the service alive; a macOS Reopen handler was added and awaits final UI retest. Native parent termination closes the supervised listener. Direct `pnpm start` smoke served reader/API with HTTP 200 and the sample, independently of Tauri.

AR passed: no blocking architecture flaws.

AR risk: non-low — bundled executable distribution, target compatibility, runtime integrity, and edition selection.

AR review round: 2; reviewer: reused (`desktop_review`, independent/read-only).

Standard review requires native target matching (reject cross/universal staging), checksum verification before execution, exact version/SQLite validation, explicit Lite resource exclusion after Standard staging, final packaged-byte verification, and license/provenance metadata. Existing keychain/browser/platform evidence limits remain; do not claim they were solved by changing packaging.

Standard implementation evidence: staged Node 24.22.1 darwin/arm64 plus installed LICENSE and provenance/checksum manifest. Standalone executable SQLite probe succeeds with PATH containing no system Node. Standard Rust tests: six pass, one host-keyring integration test ignored separately; Lite Rust tests: four pass, same integration ignored. New native tests verify a saved system path is ignored and a missing/modified bundle fails before execution. Staged Standard smoke relocates Node and application resources and passes pairing/LAN/media/persistence/restart/shutdown with no system Node PATH and zero paid calls. Full Node suite now 169 passing; lint/typecheck/fmt pass. The copied macOS Node binary declares minimum OS 13.5, so the desktop bundle minimum was updated accordingly.
