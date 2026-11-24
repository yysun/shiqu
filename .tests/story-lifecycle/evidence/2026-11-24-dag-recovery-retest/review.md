# Story recovery and first-open migration retest

The candidate is `3eb2d6ae` plus the recovery changes in the working tree. The code and test diff SHA-256 is `ce02aafed6c01f3194d46df6dc9f80d33b400bfa5ce6cbe3fc05c21c9d372f2d`. Local macOS, pinned Node 24.22.1 and pnpm 11.25.0, production HTTP routes, SQLite, and controlled providers. Each library was disposable and isolated from the user's library.

## Prior regressions

| Case | Result | Verified behavior |
| --- | --- | --- |
| C011 | PASS | Page 5 was the only claimed drawing. The shelf and session reported it running while page 2 remained blocked. |
| C013 | PASS | Saved the display name in story settings in the in-app browser during the held page 2 redraw. The shelf and settings showed page 2 running before save, when the name first changed, and after a poll. The GET, save response, and next GET retained the same attempt, start time, 5/6 counters, and one drawing call. |
| C014 | PASS | Exhausted repair showed the page 2 issue. The current fault granted one bounded repair allowance, replay was idempotent, and a stale fault was rejected. |
| C015 | PASS | The true image-loss fault followed equal drawing inputs across a frame-key change and prevented any drawing. A changed page 2 description invalidated the old binding and dispatched only page 2. A duplicate-target case also recovered after restart with one drawing. |
| C017 | PASS | Clicked Skip Review in the paused draft with all four frames prepared. HTTP 200 recorded the override and kept the draft paused. The only drawing in the browser fixture was the unrelated held C013 redraw. Automated checks cover missing draft content, the current/stale fault IDs, replay, and explicitly resuming drawing. |

[Automated retest](ledger-tests.txt) · [Browser HTTP trace](browser-http.json)

## Four release retests

- **C022 passed.** Changing narrative detail preserved the original target when its five drawing inputs matched. Changing length from 4 to 5 replaced every old key. The identical input was held on page 1 and, in a second run, on page 2 after moving the drawing description. Continue and restart made zero calls for the held input. The current fault retained its ID, and explicit Retry drew the target once. A third run held identical inputs on pages 2 and 3, then recovered both from one paid portrait while offline, with zero extra draws and one usage entry. The art-style control completed with new inputs. [Exit regressions](reader-exits.txt)
- **C023 passed.** The original paid portrait was applied in the child when readable at authorization and when it became readable before dispatch. Both produced zero extra calls for that frame, copied the exact bytes into the child namespace, and preserved the parent fault and receipt. [Exit regressions](reader-exits.txt)
- **C024 passed.** After a synopsis revision, the complete paused draft retained four review targets and offered Skip Review. The current fault ID was accepted with HTTP 200, and the override remained paused. [Exit regressions](reader-exits.txt)
- **C025 passed.** Created each historical library by running the actual `v0.15.0` source at `46809ae07c64d343f65ad4bde348e92d6e5f8483`, then closed it and made a disposable copy for first open with the candidate application. Verified both whole-library backups using the production backup verifier and inspected the backed-up databases read-only. Before migration, the visual child had one empty key and the registration child had no fault row. First open applied `0026` and `0027` and restored four visual targets and two registration targets. Continue made zero calls to either failed stage. The targeted Retry and its replay both returned 202 and produced one call per case. Both stories reopened at 4/4 complete with zero faults. Repeated the procedure with libraries created by the pre-fix build `69495ab833f2a9befa197d640c2592f88913b520`, which also passed. The backup paths are in the two result files. Registered tests additionally verify chain repair, stale fault cleanup, authorized outputs, and separate recoverability of legacy batches with identical messages. [0.15.0 results](from-v0.15.0.json) · [Pre-fix results](from-69495ab8.json) · [Exit regressions](reader-exits.txt)

## Three new recovery findings

- **C026 passed.** After an acceptance-only revision and restart, the optional landscape set was 3/4 with page 3 failed, zero active landscape jobs, and a Retry token. All four portraits exported. The targeted landscape route drew only page 3 and finished at 4/4. [Original reproduction rerun](reproductions.json) · [Permanent assertions](new-recovery-tests.txt)
- **C027 passed.** A readable receipt passed signature, pixel, and aspect-ratio validation and recovered with zero extra calls. This also worked when a previously published file returned between token authorization and dispatch. Reuse preserved the bytes and the usage count, including when publication succeeded and the queue acknowledgement was lost. An invalid-aspect file required one authorized redraw of page 3. [Original reproduction rerun](reproductions.json) · [Permanent assertions](new-recovery-tests.txt)
- **C028 passed.** The offline shelf and story settings both offered Retry at 1/2. Clicking Retry in settings restored a readable second portrait, and the provider call count stayed at two. The focused test let the local file go missing and confirmed HTTP 503 preserved the same fault. With the original file available it verified the final recovery response was already complete at 2/2, with a succeeded receipt and zero new calls. [Browser HTTP trace](browser-http.json) · [Permanent assertions](new-recovery-tests.txt)

## Verification

The changed-source gate passed 623 tests. Its two optional `v0.14.0` rollback assertions ran and passed separately using the actual tag. The 80-frame intake test passed with exactly 80 controlled draws. Typecheck, lint, all 27 native library tests, and QA ledger validation passed. The ledger now records 28 current case passes. [QA status](../../../STATUS.md)
