# Desktop Standard — always-saved SQLite configuration

## Summary

The Standard desktop app bundles Node24.22.1 and now saves settings and Gemini keys in its own native `desktop.sqlite`. Keychain is removed. Keys always persist; there is no session-only mode. Key material is disclosed plaintext protected by local file permissions (Unix directory0700/file0600; Windows user-profile ACL inheritance), separate from the reader's stories database. Configuration and credential changes commit in one transaction. The settings webview gets only presence, never the stored key. Node receives its configuration over private stdin, with no API secret in child arguments/environment or reader HTTP responses.

On the first native access per application launch, `GEMINI_API_KEY` seeds an empty database record. An existing saved key wins. Deletion does not immediately import again; a new complete launch can seed it again. Invalid environment input is a value-free warning that leaves settings usable. No shell profiles or `.env` are read. Existing nonsecret settings.json migrates once; old Keychain credentials are untouched and must be re-entered. Start and connection checks both read committed database configuration; Check saves pending edits first.

Codex subscription integration stays CLI-managed. The database stores its executable/model/login-directory configuration, not ChatGPT credentials. The runner requires account type `chatgpt` and forces ChatGPT authentication; Gemini credentials are excluded from Codex configuration. Codex CLI remains separately installed/logged in. Existing native Windows limitation remains explicit. Ordinary `pnpm start` is unchanged.

Source milestone: `ed8e1bc` (native SQLite configuration). Prior desktop milestones `e06b1d3`, `65c5c4b`; concurrent reader commit `0dce9c3` is unrelated and excluded from desktop changes/review.

Artifact: `outputs/Shiqu-Standard-macOS-arm64.zip`, about113MiB compressed, containing `Shiqu.app` (266.73MiB). macOS13.5+, ARM64, unsigned/not notarized. SHA256: `9bb37bba49c250408fb8dfdd21fded7dc85e9080ec04bfcf12dd6a802e53f014`.

## Verification

- Full current Node suite:176/176 pass. Standard Rust13 pass; LiteRust11 pass, no ignored credential-store test. Lint/typecheck/Rustfmt and final macOS Standard build pass. Independent CR5 passed after fixing connection checks to save first and use only database configuration.
- Native database tests verify durable key/settings save/reopen/delete, permissions, atomic rollback, one-time legacy migration, corrupt/future/unknown-schema preservation, symlink rejection, valid/invalid environment seeding, saved-key priority, and deletion without immediate reimport. Shared Start/Test configuration coverage includes Codex ignoring Gemini credentials.
- Final packaged native UI passes masked/reveal synthetic key input, real SQLite save, quit/relaunch persistence, replacement, deletion through Check connection's auto-save path, safe local no-key error, environment import/priority, settings persistence, bundledNode start/stop and HTTP configured state without key leakage. Original configuration was restored exactly afterward, the private backup removed, and the app left stopped. No actual key value was printed or sent to a provider.
- Actual packaged runtime relocated outside the checkout passes with no systemNode on PATH: exact runtime/license hashes,24books, samplemedia, pairing/LAN, progress persistence/restart/session revocation and clean shutdown. The package scan rejects desktop database/journal files and private configuration. Zero paid/provider generation calls. ZIP integrity passes.
- Prior native lifecycle evidence proves close-to-background, Reopen, and Quit cleanup; direct `pnpm start` served reader/API HTTP200 independently. Earlier actual Lite package exclusion smoke remains valid for packaging boundaries; current Lite Rust tests cover the new native storage. A fresh Lite installer was not rebuilt in this amendment.

## Notes

The Keychain dependency/blocker is removed. Browser-driven launch/pairing remains unverified because local browser use is disabled in Work settings. Distinct second-instance focus remains unverified; Reopen of an existing window is not that check. Physical phone scanning and Linux/Windows runtime execution are not claimed. Both-variant platform CI remains configured. No Docker image build, signing/notarization, provider generation, or new CLI login was performed. Existing unrelated workspace changes remain preserved.

## Final VR

VR incomplete: browser launch/pairing and distinct second-instance focus remain unverified; final E2E/acceptance tasks remain open.

VR risk: non-low — persistent plaintext credentials, native process lifecycle, authenticated LAN access, and packaged runtime distribution.
VR review round: 3; reviewer: reused (`desktop_review`, independent/read-only).

Reviewed the always-saved SQLite requirements, milestone `ed8e1bc`, current plan, matching E2E specification, passing CR round 5, and `.data/desktop-lite-entry/sqlite-native-e2e.txt`. The unrelated reader commit `0dce9c3` was excluded from desktop review.

| Criterion | Status | Evidence and remaining work |
|---|---|---|
| 1. Complete Standard package without user prerequisites/private files | **Complete** | Final rebuilt Standard `.app` resource smoke verifies bundled Node 24.22.1, executable/license hashes, dependencies, 24 books, media, and relocation without system Node on PATH. Private native database files are excluded from packaged resources. |
| 2. Standard runtime selection/settings; optional Lite behavior | **Complete** | Native Standard UI and process inspection establish bundled Node/SQLite use without a system selector. Tests cover exact-version validation, saved-path isolation, and missing/modified-bundle rejection. Valid prior Lite detection and packaged Node-exclusion evidence remains applicable. |
| 3. Provider/model/key configuration and non-generating checks | **Complete** | Final native UI exercises masked/revealed synthetic input, persisted settings/key replacement, relaunch, and deletion. Connection checks now save edits first and read committed database configuration. Native no-key checks and provider tests establish non-generating behavior. Codex’s Windows limitation remains explicit. |
| 4. Native SQLite persistence, environment import, migration, and isolation | **Complete** | Actual SQLite save/relaunch/replacement/deletion succeeds with disclosed plaintext storage and 0700/0600 permissions. Native evidence demonstrates legacy JSON migration, environment seeding, database priority, and no immediate reimport after deletion. Tests cover rollback, invalid input, relaunch import, schema/corruption protection, and migration precedence. No session-only or Keychain path remains. Stored keys reach Node through private stdin and are not returned by settings/reader HTTP. Original configuration was restored and the temporary backup removed. |
| 5. Full lifecycle, browser launch, second instance, cleanup | **Incomplete** | Native Standard Start/status/Stop, background operation, same-window Reopen, and Quit cleanup are evidenced. Existing tests cover conflicts, directory ownership, restart, parent termination, and detached Codex cleanup. Browser-launch E2E and distinct second-instance focus remain unverified. |
| 6. Opt-in phone sharing, QR, authorization, native-only settings | **Complete** | Native sharing/QR evidence and HTTP tests cover LAN URLs, pairing, denied unpaired/foreign-origin access, native-only settings, loopback-only operation when sharing is off, and restart revocation. Physical scanning and browser-script execution are not claimed. |
| 7. Persistent shared library and unchanged ordinary server | **Complete** | Final packaged-runtime smoke verifies SQLite/media access and reading-progress persistence across restart. `pnpm start` independently served reader/API HTTP 200; its command and entry point remain unchanged. |
| 8. Final packaged Standard application exercised end to end | **Blocked in part** | Final Standard native configuration/runtime checks and actual packaged-resource smoke pass. Browser-driven launch/pairing required by the matching E2E specification remains unexecuted because browser automation is disabled. Linux/Windows build configurations cover both variants; their runtime execution is not claimed. |
| 9. Checks completed or concrete blockers recorded | **Complete** | Final Node suite: 176 passing; Standard Rust: 13 passing; Lite Rust: 11 passing. Lint, typecheck, formatting, Standard build, and final package smoke pass. Remaining E2E blockers are recorded, satisfying this criterion’s stated exception. |

Complete criteria: **1, 2, 3, 4, 6, 7, 9**. Keep **5 and 8**, plus the final E2E/acceptance plan tasks, open.

The credential-storage blocker is resolved through the user-authorized SQLite design and successful native round trips. Remaining acceptance work is browser launch/pairing and a distinct second-instance focus check. No additional source repair is indicated by the current review.

This VR executed no tests and edited no files.
