# CLI shared libraries and one desktop edition

CLI now reuses saved desktop libraries, creates missing saved paths, and asks only when no saved or existing library can be found. Confirmed choices persist independently of desktop credentials. CLI runs its own HTTP service; it does not start Tauri or the desktop control backend. A shared SQLite transaction lock prevents simultaneous CLI/desktop generation against the same library.

Desktop now always bundles Node. Lite runtime/UI/build/release branches are removed; the existing standard-named macOS/Windows downloads remain stable. README, user/development guides and npm/desktop publishing documentation describe both remaining entry points. User screenshot changes are preserved.

## Verification

Node 24.22.1 / pnpm 11.25.0. Final complete JavaScript suite: 582 passed with file concurrency 2, no weakened assertions; the prior default-concurrency 80-frame timeout passed individually and in the final complete run. Typecheck/lint, Rust formatting, 46 local links/anchors and CI YAML/Bash syntax passed. Rust: 18 passed, one test requiring prepared bundled Node resources filtered using a test-only resource override. PTY confirmation/cancellation/EOF and in-app browser desktop preview were verified on macOS with temporary data. No paid inference, desktop resource preparation, installer/Docker build or publication.

Implementation milestones: `c234a84`, `df357c8`, `f6fa9e1`. Final source review fixed shutdown ordering so active HTTP connections and Codex groups stop before the business DB closes and ownership is released. Documentation remains in the working tree for review; no final delivery commit or push was requested.

## Final VR

1. **Complete — Directory selection and initialization.** CLI honors explicit flags/environment, then saved desktop directory, remembered CLI choice, and an existing desktop default library. Otherwise it asks. A saved missing directory is created without prompting. Covered by `tests/cli-library.test.mjs`, CLI configuration tests and real process initialization.

2. **Complete — Safe first use and settings access.** Fresh non-interactive runs fail with `--data-dir` guidance. PTY confirmation, Ctrl+C and EOF were verified; cancellation creates neither configuration nor a library. Malformed settings fail clearly; desktop settings are read-only and credentials are not queried. Help/version remain side-effect-free.

3. **Complete — Reuse and existing data.** Confirmed paths persist in separate `cli-library.json`; desktop settings retain priority. Platform suggestions match desktop paths. Existing independent CLI libraries remain untouched and can be selected explicitly. Behavior and legacy paths are documented.

4. **Complete — Shared-library lifecycle.** CLI and desktop share a transaction ownership lock plus the legacy owner marker. Real process tests verify overlap rejection, stale-owner serialization, startup-failure release, and SQLite/media/progress reuse. Commit `f6fa9e1` fixes active-request shutdown; its regression verifies graceful exit, Codex descendant cleanup and subsequent lock acquisition.

5. **Complete — Lite retirement.** Lite configuration, commands, system-Node detection/UI and release branches are removed. Desktop always verifies bundled Node. Old `nodePath` settings remain readable but cannot override the runtime. Generic desktop lifecycle tests were preserved by renaming the suite. CI retains exactly the two standard-named platform installers.

6. **Complete — Documentation.** README, user/development guides, desktop/npm documentation and publishing instructions describe both remaining entry points, lookup/prompt behavior, separate credentials and phone-access differences. CLI is correctly documented as an independent HTTP service, without `desktop.ts` or Tauri. User screenshot changes remain preserved.

7. **Complete — Verification and authorized scope.** Final full JavaScript run passed **582/582**, with zero failures, skips or cancellations, in 85.5 seconds. Typecheck, lint, Rust formatting, 46 local links/anchors and CI YAML/Bash checks passed. Rust ran 18 applicable cases; one prepared-Node-resource case was explicitly filtered. The default-concurrency 80-frame timeout was retained in the record and passed both individually and in the complete lower-concurrency run without weakened assertions.

All AP tasks and specified local E2E scenarios are evidenced. Runtime, PTY and browser verification were on macOS; Windows/Linux paths have unit coverage, not native runtime verification. No desktop resources/installers, Docker images or registry publication were produced.

VR passed: all acceptance criteria complete

VR risk: non-low — CLI persistence, cross-entry concurrency and desktop distribution behavior change.
VR review round: 1; reviewer: reused (`review_cli_desktop`).
