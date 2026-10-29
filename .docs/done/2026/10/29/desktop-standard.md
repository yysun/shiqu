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
- Prior native lifecycle evidence proves close-to-background, Reopen, and Quit cleanup; direct `pnpm start` served reader/API HTTP200 independently. Earlier actual Lite package exclusion smoke remains valid for packaging boundaries; current Lite Rust tests cover the new native storage. The current Lite installer has now been rebuilt and verified from its delivery ZIP: native system-Node detection, Start, local pairing/story/image access, and Quit cleanup pass with the unchanged SQLite configuration.

## Notes

The Keychain dependency/blocker is removed. Browser-driven launch/pairing remains unverified because local browser use is disabled in Work settings. Distinct second-instance focus remains unverified; Reopen of an existing window is not that check. Physical phone scanning and Linux/Windows runtime execution are not claimed. Both-variant platform CI remains configured. No Docker image build, signing/notarization, provider generation, or new CLI login was performed. Existing unrelated workspace changes remain preserved.

## Lite delivery

`outputs/Shiqu-Lite-macOS-arm64.zip` —75.60MiB compressed,149.71MiB application, macOS13.5+ARM64, unsigned/not notarized. SHA256: `bf4698fe54d66de856efb46fb06a2cb1e08b2509f1a2fd02f58bb9b9231e17a3`. Standard download remains available. Lite requires installed Node24 (recommended24.22.1), supports detection/manual selection, and retains the same always-saved SQLite settings/key storage. It contains no Node executable/resource directory; actual payload reports nodeBundled=false.

Fresh package inspection, relocated runtime smoke,11 Lite Rust tests, and ZIP integrity pass. The initial Rust check ran after Lite staging had removed the default configuration's Node resource; restoring Standard preparation in the documented sequence resolved test setup. Default Standard staging is restored. Native verification used the actual ZIP extracted to a fresh path to avoid stale prototype registration at the reused build path. Installed nvm Node24.22.1/SQLite detection, native Start, authenticated local story/image access and native Quit/child cleanup all pass, with no configuration/credential changes or paid calls. No source/config changes were needed for this delivery. Evidence: `.data/desktop-lite-entry/lite-delivery-native.txt` and matching smoke/test/build logs.

## Final VR

VR incomplete: browser launch/pairing and distinct second-instance focus remain unverified; final E2E/acceptance tasks remain open.

VR risk: non-low — native lifecycle, persistent credentials, authenticated LAN access, and desktop packaging.
VR review round: 5; reviewer: reused (`desktop_review`, independent/read-only).

Fresh Lite GUI verification now passes from the actual delivery ZIP extracted to a new path:

- Lite/system-Node selector and saved SQLite credential indicator display correctly.
- Installed Node 24.22.1 and SQLite are detected.
- Native Start launches the installed Node with the extracted app’s runtime.
- Loopback listening, HTTP pairing, and authenticated story/image access pass.
- Native Quit removes the application, Node child, and listener.

No credentials/configuration changed or paid calls occurred. Previous package inspection, relocated smoke, Lite Rust 11-test result, and ZIP integrity evidence remain valid.

Complete criteria remain **1, 2, 3, 4, 6, 7, 9**; **5 and 8** remain open. Fresh Lite GUI is no longer a verification gap. Windows/Linux runtime execution is not claimed.

No tests were executed or files edited during this review.
