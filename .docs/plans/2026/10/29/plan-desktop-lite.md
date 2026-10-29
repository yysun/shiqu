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
- [x] Extend packaged smoke verification to relocate bundled Node, validate manifest/checksum, and run with no system Node PATH; preserve Lite checks. Update both-variant CI and desktop documentation.

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

Standard milestone commit: `65c5c4b`. Final unsigned macOS ARM64 Standard app built at `src-tauri/target/release/bundle/macos/Shiqu.app` (265.10 MiB uncompressed). Final app-resource smoke, not just staging, passes relocated bundled Node + checksum/license + 24 books + pairing/LAN/media/persistence/restart/shutdown with no system Node PATH and zero paid calls. Optional Lite was built after Standard using the override; final Lite app-resource smoke confirms no bundled Node or stale Node directory and the same functional checks. Default Standard staging was restored afterward.

CR passed: no major findings

CR risk: non-low — bundled runtime distribution, credential handling, process supervision, LAN authentication, and platform packaging.

CR review round: 3; reviewer: reused (`desktop_review`, independent/read-only).

TT: 169/169 Node tests pass; Standard Rust 6 pass, Lite Rust 4 pass (the separately attempted OS credential test remains environment-blocked); lint/typecheck/fmt, ordinary frontend/server build and both native macOS package builds pass. Direct `pnpm start` serves the reader and sample API independently, with zero paid calls.

ET partial: prior Lite native settings, missing/Node22 rejection, Node24 detection, no-key connection error, key entry/reveal/fail-safe storage error, actual server start/stop, QR, local/LAN HTTP pairing, progress writes, background service and parent-termination cleanup were exercised. Standard final payload and runtime-selection tests pass. Before the native Standard launch check, computer use returned: “The Mac is locked and automatic unlock could not unlock it.” The user was asked to unlock manually. Standard native window/start/quit and final Reopen UI evidence are pending that state change. Browser automation is disabled in Work settings; browser-script/physical-phone checks remain unexecuted. Successful Keychain write/read/delete remains blocked by OSStatus -25293. Linux/Windows CI is configured but not executed locally.

Delivery artifact: `outputs/Shiqu-Standard-macOS-arm64.zip` (~112 MiB compressed), containing the actual Standard `.app`. No signing or notarization was performed. Existing unrelated working-tree changes remain excluded from story commits.

ZIP integrity: `unzip -tq` passed. SHA-256: `b61afd6913c400b67fec099c9dddaad69fab331b95f545a46011b3a17a37caa1`. The saved pre-task unrelated diff and current unrelated diff have the same SHA-256; global Rust default remains `stable-x86_64-apple-darwin`.

VR incomplete: successful OS credential persistence, final native Standard UI/lifecycle, and browser-driven pairing remain unverified; two plan tasks remain open.

VR risk: non-low — credentials, native process lifecycle, authenticated LAN access, and packaged runtime distribution.

VR review round: 1; reviewer: reused (`desktop_review`, independent/read-only).

Complete criteria: 1, 6, 7, 9. Criteria 2–5 and 8 remain open to preserve the native/keyring/browser evidence gaps. Final detailed VR is recorded in `.docs/done/2026/10/29/desktop-standard.md`. No source repair is indicated by the review; progress on remaining checks requires user unlock/credential-store availability and browser automation access. Do not treat the built artifact or passing CR as full RPD acceptance.

## Post-unlock native verification

The user manually unlocked the Mac. The final Standard `.app` now passes native settings/runtime display (Node 24.22.1 and SQLite, no system selector), nonsecret settings save/relaunch persistence, safe no-key provider check, actual bundled-child startup, loopback-only listener with sharing off, Stop, close-to-background, reopening the same running window, and Quit while running. Process inspection confirms the child executable comes from `Shiqu.app/Contents/Resources/node/node`; Quit removes both processes and the port listener. Evidence: `.data/desktop-lite-entry/standard-native-final.txt`. This completes criterion 2. Reopen is proven; distinct second-instance focus is still unverified.

The disposable Keychain round trip was retried after unlock and still fails with OSStatus -25293. Browser inventory still reports local browser use disabled in Work settings. Successful credential save/read/delete and browser-driven launch/pairing remain blocked. No source change is indicated; prior CR/TT and package checks remain current. Final E2E/acceptance tasks stay open.

Read-only host diagnosis: default credential store is login.keychain-db; the system command `security show-keychain-info` itself fails with SecKeychainCopySettings authentication error (exit 51), independently of Shiqu. No unlock command or credential change was attempted.

Final VR round 2 supersedes the prior locked-Mac verdict: successful OS credential persistence, browser launch/pairing, and distinct second-instance focus remain unverified; final E2E/acceptance tasks remain open. Complete criteria: 1, 2, 6, 7, 9. Remaining criteria: 3, 4, 5, 8. Independent reviewer desktop_review; full verdict preserved verbatim in the delivery report.

## Session and SQLite credentials amendment

Current amendment starts from `e4a1106fe27337fa3a586acca7f9feb3be1b570c`; preserve original story base above. User authorized session-only keys, asked about PATH (resolve as launch GEMINI_API_KEY, not executable search), then requested keys/settings in a database. The credential design above is superseded: remove Keychain dependency entirely. Keep current native-only bridge and private stdin transport. Use pinned rusqlite with bundled native SQLite; no SQLite plugin exposed to webviews. Store native configuration in app-config `desktop.sqlite`, separate from the reader library. Unix directory/file permissions 0700/0600; Windows uses profile ACL inheritance. Keep SQLite rollback journal inside that directory, secure_delete on, memory temp storage, bounded busy timeout, explicit schema version, and parameterized statements. Save settings and optional persistent key in one transaction. Reject unsupported/corrupt databases with safe actionable errors; never overwrite them. Import legacy nonsecret settings.json only when no settings row exists; leave its file and existing Keychain credentials untouched.

Credential resolution is explicit in-memory override > launch GEMINI_API_KEY > database key. A clear/delete action suppresses fallback until app quit. Explicit database save overrides environment during the current session; on fresh launch environment takes precedence. Session input defaults to no persistence; the optional local save control explicitly discloses plaintext storage. Remembering to database and deleting it must round-trip on this host, without Keychain. Settings reads return only active key presence/source and safe errors. Capture the environment only once, validate without echoing values, never run shell profiles, and don't pass the variable into Node's environment. Runtime stop/restart does not discard the native session override. Plaintext file/database backups are the stated persistence tradeoff.

- [x] Implement native SQLite settings/credential store and one-time JSON migration, removing Keychain. Add transactional rollback, persistence, deletion, permission, corrupt/version/migration coverage.
- [x] Wire get/save/start/test to the always-saved SQLite key, add once-per-launch environment seeding with database priority and safe invalid-input warnings, remove session/Keychain code and UI, and document persistent plaintext storage. Both Start and connection checks use committed configuration; the UI saves before checking.
- [x] Rebuild Standard, run full relevant Node/Rust suites, lint/typecheck/fmt and packaged smoke. Exercise packaged native database save/start/stop/quit/relaunch/replacement/deletion and automatic-save connection checks with disposable values. Record limits and repeat independent CR/VR. Preserve unrelated work.

AR reopened for this credential/persistence change. Keychain integration is superseded by database round-trip evidence; existing browser/second-instance evidence gaps remain independent.

AR passed: no blocking architecture flaws.

AR risk: non-low — native credential source precedence, plaintext persistence, migration and secret transport.
AR review round: 3; reviewer: reused (`desktop_review`, independent/read-only).

Implementation must validate existing schema/version before mutating setup, apply the session override only after the transaction commits, keep invalid environment errors recoverable through explicit input, and distinguish clearing active credentials from deleting the stored database key. First SS probe compiles pinned rusqlite and proves transactions before dependent UI wiring.

## Always-saved correction (supersedes session amendment)

User removed session-only entirely. Retain the SQLite store, transaction/migration/permissions/error protection and Keychain removal. Remove the new session state/module and UI persistence selector; typed keys always persist. Native Control tracks only whether launch-environment import has been attempted and a safe import error, never a session credential override. On first native settings/start/test access per app launch, import GEMINI_API_KEY only if no saved database key exists; validate then commit it. Existing database keys win. Deletion cannot reimport until app relaunch. Invalid import is a value-free warning and does not block loading settings or saving a valid key. Do not execute shell profiles. Stored key is the only runtime source after initialization and still travels over private stdin. No memory-only credential mode remains.

Replace the second amendment task with: wire get/save/start/test to the SQLite key, add bounded once-per-launch environment import and tests for database priority, invalid values and deletion/relaunch import behavior; remove session controls and document always-saved plaintext policy. E2E now verifies save/relaunch/delete and automatic environment seeding, without session lifetime scenarios. Reopen AR before dependent wiring. Prior bounded SQLite commit/rollback probe passed on pinned rusqlite 0.41.1. Early unit tests passed before this correction; they do not certify the corrected implementation.

AR passed: no blocking architecture flaws
AR risk: non-low — persistent plaintext credentials, native SQLite migration, environment import, and secret transport.
AR review round: 4; reviewer: reused (`desktop_review`, independent/read-only).

Native mutex serializes once-per-launch import with settings/start/test. Existing database wins; mark import attempted even when already stored, so deletion cannot restore it. Invalid environment must remain a safe warning, and explicit valid save clears it. Remove superseded session code/tests/UI.

Always-saved implementation: bounded native rusqlite 0.41.1 commit/rollback probe passed. Corrected Standard Rust suite: 13 pass, no ignored credential integration. Lite suite: 11 pass. Node suite: 169 pass; lint/typecheck/fmt pass. Native/package checks follow. Concurrent story-frame-count changes under client/lib/server generation/tests and its docs are unrelated and excluded from desktop commits.

CR fixed: connection checks now save pending edits first and read only committed SQLite configuration; rerun result passed.
CR risk: non-low — persistent credentials, native configuration, and secret transport.
CR review round: 5; reviewer: reused (`desktop_review`, independent/read-only).

SQLite milestone commit: `ed8e1bc`. Concurrent reader story commit `0dce9c3` is unrelated and was excluded from desktop review/changes. Final all-Node suite after that concurrent change: 176/176 pass. Corrected Standard Rust13 and LiteRust11 pass; lint/typecheck/fmt pass. Standard rebuilt unsigned (266.73 MiB). Actual package resource smoke passes relocation/no-system-Node, checksums/license,24books,pairing/LAN/media/progress/restart/shutdown, zero paid calls.

Native always-saved E2E passes in the final app: one-time JSON settings migration; automatic environment key seeding; masked/reveal synthetic input; key/settings save to real SQLite with0700/0600 permissions; quit/relaunch persistence; saved DB key wins over environment; actual bundled server sees configured=true with no key in HTTP; Stop; connection-check auto-saves deletion before safe local no-key error; no environment reimport during same launch. Original configuration restored exactly afterward; temporary credential backup removed. No real key values were printed or sent to providers. Evidence `.data/desktop-lite-entry/sqlite-native-e2e.txt`. Database credential blocker resolved; browser/second-instance evidence gaps remain.

Final VR round3 supersedes the earlier Keychain/session verdicts: criteria1,2,3,4,6,7,9 complete;5 and8 remain open for browser-driven launch/pairing and distinct second-instance focus. Independent reviewer desktop_review, non-low risk. Full final result preserved verbatim in delivery report. Credential storage is resolved. ZIP113.20MiB, SHA256 9bb37bba49c250408fb8dfdd21fded7dc85e9080ec04bfcf12dd6a802e53f014; integrity check passed. No source repair indicated.

## Fresh Lite delivery

User requested Lite without Node. Existing approved override/scripts suffice; no source change. Built current always-saved SQLite version into unsigned macOS ARM64 Shiqu Lite.app149.71MiB; ZIP75.60MiB at outputs/Shiqu-Lite-macOS-arm64.zip, hashbf4698fe54d66de856efb46fb06a2cb1e08b2509f1a2fd02f58bb9b9231e17a3, integritypass. Actual package excludes Node binaries/resources and declares nodeBundled=false. Relocated final package smoke with systemNode24 passes24books,media,pairing/LAN,progress,restart/shutdown,zero paidcalls. LiteRust11pass after restoring documented Standard staging before cargo checks; initial missing-resource setup failure is resolved. Default Standard staging restored and Standard archive retained.

Actual ZIP extracted to fresh path bypassed stale prototype launch registration. Fresh native Lite UI shows systemNodepicker, detects nvm24.22.1SQLite, preserves existing SQLite settings/keyindicator, launches installed Node against extracted runtime, serves paired stories/images, and Quit removes app/child/listener. No config/credential edits or paidcalls. Evidence .data/desktop-lite-entry/lite-delivery-native.txt. Source CR5 remains valid; no new source inputs. Independent VR5 confirms freshLiteGUI gap closed; remaining acceptance only browserlaunch/pairing and distinctsecondinstance focus. Full finalVR in delivery report; broader E2E/acceptance tasks stayopen.
