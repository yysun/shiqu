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

After the user unlocked the Mac, final native Standard checks passed: bundled Node/SQLite status, nonsecret settings save/relaunch persistence, safe no-key provider check, start, stop, close-to-background, reopen, and Quit while running. Process inspection confirmed the packaged Node executable and verified that Quit removes both processes and the listener. Default library/port settings were restored and the app left stopped. Distinct second-instance focus and browser-driven launch/pairing remain unverified. Browser automation is disabled in Work settings. Physical-phone scanning and Linux/Windows runtime execution were not claimed; native platform CI configuration is provided for both variants.

The disposable Keychain round trip still fails with OSStatus -25293 after the user unlocked the Mac. The host's Keychain rejects writes, so successful real key save/read/delete remains unverified. The system command `security show-keychain-info` independently fails with the same authentication error, confirming a host credential-store blocker. The implementation fails visibly and never saves plaintext. No real provider credential or paid generation call was used. Formal signing must preserve the final Node bytes/manifest relationship; the packaged smoke catches a signing-induced checksum change. Unrelated existing edits/assets were preserved and excluded from story commits.

## Final VR

VR incomplete: successful OS credential persistence, browser launch/pairing, and distinct second-instance focus remain unverified; final E2E/acceptance tasks remain open.

VR risk: non-low — credentials, native process lifecycle, authenticated LAN access, and packaged runtime distribution.
VR review round: 2; reviewer: reused (`desktop_review`, independent/read-only).

Reviewed the post-unlock native evidence in `.data/desktop-lite-entry/standard-native-final.txt` and the updated plan. Source and prior CR/TT inputs are unchanged; their valid evidence is retained.

| Criterion | Status | Evidence and remaining work |
|---|---|---|
| 1. Complete Standard package without user prerequisites/private files | **Complete** | Final Standard `.app` resource smoke verified bundled Node 24.22.1, executable/license hashes, dependencies, 24 books, media, and relocation without system Node on PATH. |
| 2. Standard runtime selection/settings; optional Lite behavior | **Complete** | Final native Standard UI shows bundled Node 24.22.1 and SQLite with no system selector. Process inspection confirms execution from inside `Shiqu.app`. Native tests cover saved-path isolation and missing/modified-bundle rejection. Actual Lite package excludes Node; prior native Lite detection and validation evidence remains valid. |
| 3. Provider/model/key configuration and non-generating checks | **Blocked in part** | Native settings, nonsecret save/relaunch, key entry/reveal, and safe no-key checks are evidenced. Metadata-only tests pass. Successful key replacement/deletion through the actual credential store remains unproved. |
| 4. OS-only credential persistence and isolation | **Blocked in part** | Private stdin transport, no returned/saved plaintext secrets, visible credential errors, and no plaintext fallback are evidenced. The disposable Keychain round trip still fails with OSStatus `-25293` after unlock; successful persistence/read/delete cannot be certified. |
| 5. Full lifecycle, browser launch, second instance, cleanup | **Incomplete** | Final native Standard checks now prove Start, status, Stop, close-to-background with unchanged process/listener, Reopen of the same running window, and Quit removing both processes/listener. Existing tests cover conflicts, data ownership, restart, and detached Codex cleanup. Browser-launch E2E and distinct second-instance focus remain unverified. Reopening the existing application is not second-instance proof. |
| 6. Opt-in phone sharing, QR, authorization, native-only settings | **Complete** | Native sharing/QR evidence and HTTP tests cover LAN URLs, pairing, denied unpaired/foreign-origin access, native-only settings, and session revocation. Final Standard native evidence also confirms loopback-only listening and no QR when sharing is off. Physical scanning and browser-script execution are not claimed. |
| 7. Persistent shared library and unchanged ordinary server | **Complete** | Final packaged-runtime smoke proves SQLite/media access and progress persistence across restart. Final native Standard relaunch preserves nonsecret settings. `pnpm start` independently returned reader/API HTTP 200; its command and entry point remain unchanged. |
| 8. Final packaged Standard application exercised end to end | **Blocked in part** | Final macOS Standard native runtime/lifecycle now passes. Final packaged resources pass no-system-Node-PATH, pairing, persistence, restart, and shutdown smoke checks. Browser-driven pairing required by the matching E2E specification remains unexecuted because local browser use is disabled. Linux/Windows configuration covers both variants; execution is not claimed. |
| 9. Checks completed or concrete blockers recorded | **Complete** | Node 169/169, Standard Rust 6, Lite Rust 4, lint/typecheck/fmt, frontend/server build, and both macOS builds pass. Concrete remaining E2E/credential blockers are recorded, satisfying this criterion’s stated exception. |

Complete criteria: **1, 2, 6, 7, 9**. Keep **3, 4, 5, 8** and the final E2E/acceptance plan tasks open.

The locked-Mac blocker is resolved. Remaining work requires a functioning credential store, browser access for the specified flows, and a separate second-instance focus check. No source repair is indicated by the current evidence. This review executed no tests and edited no files.
