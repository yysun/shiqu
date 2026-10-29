# Desktop Standard build — acceptance pending

## Summary

Standard is now the default Tauri desktop build, with the exact Node 24.22.1 executable and its license notices bundled. The app verifies executable/license hashes before executing Node, requires the pinned version and matching platform/architecture/SQLite, and never falls back to system Node. Lite remains an optional build with no Node included. Both retain the existing server, local settings/keyring, browser launch, authenticated phone pairing, and shared SQLite/media library. `pnpm start` and its ordinary server entry point remain unchanged.

Source milestones: `e06b1d3` (Lite desktop foundation), `65c5c4b` (Standard default and verified Node bundle).

Artifact: `outputs/Shiqu-Standard-macOS-arm64.zip`, approximately 112 MiB compressed, containing `Shiqu.app` (265.10 MiB). macOS 13.5 or newer, ARM64; unsigned and not notarized. SHA-256: `b61afd6913c400b67fec099c9dddaad69fab331b95f545a46011b3a17a37caa1`.

## Verification

- Full Node suite: 169/169 pass. Standard Rust: 6 pass; Lite Rust: 4 pass. The real OS credential-store integration was attempted separately and is blocked by Keychain OSStatus -25293; its default ignored status is not counted as a successful integration.
- Lint, TypeScript, Rust formatting, ordinary frontend/server build, and both macOS package builds pass. Independent full-story CR round 3 passed with no major findings.
- The final Standard package's resources were relocated outside the checkout and exercised using only the bundled Node with no system Node on PATH. Executable/license hashes, 24 books, dependencies, sample images, pairing, LAN access, progress persistence, restart/session revocation, and shutdown pass with zero paid calls.
- Lite was built after Standard; final Lite package smoke confirms Node and stale Node resources are absent and its runtime functionality passes. Default Standard staging was restored afterward.
- A separate `pnpm start` smoke returned reader/API HTTP 200 and the sample story without Tauri or paid calls. ZIP integrity verification passed.
- Prior native Lite UI checks cover settings, runtime errors/detection, safe no-key checks, masked/revealed disposable key entry, visible credential-store failure with no plaintext persistence, QR display, actual supervised local/LAN HTTP access, progress writes, background service, and parent-termination cleanup. A Documents-folder SQLite sync stall was localized by process sampling and resolved by using app-data storage. The documentation recommends default application data and explains protected-folder authorization.

## Notes

The Mac locked before final native Standard launch; the user was asked to unlock it manually. Final Standard window/start/quit, macOS Reopen retest, second-instance focus, and browser-driven pairing remain unverified. Browser automation is disabled in Work settings. Physical-phone scanning and Linux/Windows runtime execution were not claimed; native platform CI configuration is provided for both variants.

The host's Keychain rejects writes, so successful real key save/read/delete remains unverified. The implementation fails visibly and never saves plaintext. No real provider credential or paid generation call was used. Formal signing must preserve the final Node bytes/manifest relationship; the packaged smoke catches a signing-induced checksum change. Unrelated existing edits/assets were preserved and excluded from story commits.

## Final VR

VR incomplete: successful OS credential persistence, final native Standard UI/lifecycle, and browser-driven pairing remain unverified; two plan tasks remain open.

VR risk: non-low — credentials, native process lifecycle, authenticated LAN access, and packaged runtime distribution.
VR review round: 1; reviewer: reused (`desktop_review`, independent/read-only).

| Criterion | Status | Evidence and remaining work |
|---|---|---|
| 1. Complete Standard package without user prerequisites/private files | **Complete** | Final Standard `.app` resource smoke verified bundled Node 24.22.1, executable/license hashes, dependencies, 24 books, media, and relocation without system Node on PATH. |
| 2. Standard runtime selection/settings; optional Lite behavior | **Blocked in part** | Native tests establish exact-version/SQLite checks, saved-path isolation, and missing/modified-bundle rejection. Actual Lite package excludes Node and passes smoke. Final Standard settings display and native startup await manual Mac unlock. |
| 3. Provider/model/key configuration and non-generating checks | **Blocked in part** | Existing native UI exercised settings, key entry/reveal, and safe no-key checks; metadata-only tests pass. Successful key replacement/deletion through the real credential store remains unproved. |
| 4. OS-only credential persistence and isolation | **Blocked in part** | Source/tests establish private stdin transport and no secret-return/settings-file path. Real Keychain writes fail with OSStatus `-25293`; visible failure and no plaintext fallback are proven. Successful persistence/read/delete cannot be certified. |
| 5. Full lifecycle, browser launch, second instance, cleanup | **Incomplete** | Runtime tests prove conflicts, ownership, restart, shutdown, and active detached Codex cleanup; prior Lite native checks cover background operation and parent termination. Final Standard native lifecycle and Reopen retest remain pending. Second-instance focus and final browser-launch E2E are not established by the recorded evidence. |
| 6. Opt-in phone sharing, QR, authorization, native-only settings | **Complete** | Prior native QR/settings evidence plus HTTP tests cover actual LAN URLs, pairing, denied unpaired/foreign-origin requests, native-only settings, and session revocation. Physical scanning and browser-script execution are not claimed. |
| 7. Persistent shared library and unchanged ordinary server | **Complete** | Final packaged-runtime smoke proves SQLite/media access and progress persistence across restart. `pnpm start` independently returned reader/API HTTP 200; its command and entry point are unchanged. |
| 8. Final packaged Standard application exercised end to end | **Blocked in part** | Both macOS packages build; final packaged resources pass their respective smokes. Native Standard launch is blocked by the locked Mac. Browser automation is disabled. Linux/Windows configuration exists; execution is not claimed. |
| 9. Checks completed or concrete blockers recorded | **Complete** | Node 169/169, Standard Rust 6, Lite Rust 4, lint/typecheck/fmt, frontend/server build, and both macOS builds pass. E2E/credential blockers are explicitly recorded, satisfying this criterion’s stated exception. |

The code reviews passed, but they do not replace the missing integrations. Keep the unresolved acceptance boxes and final E2E/acceptance plan tasks open. No tests were executed or files edited during this VR.
