# Startup configuration tests

Run with the Node and pnpm versions pinned by `.nvmrc` and `packageManager`:

```bash
pnpm run test:startup
pnpm run test:safety
pnpm run test:loopback
pnpm run test:assurance
```

Startup and safety assurance suites, tests that bind or connect to a real local loopback listener, and model/provider-backed tests are manual-only and never run from change plans, CI, release gates or `pnpm test:full`. `test:startup` runs the registered startup JavaScript suites; `test:safety` runs the safety contracts; `test:loopback` runs local-listener tests; `test:models` runs provider contracts and controlled generation flows; `test:assurance` runs the safety, startup and loopback groups plus native desktop tests. `test:pty` remains a focused startup check and requires Python 3.9+ on Linux/macOS. On Windows, POSIX terminal tests are explicitly skipped and the CLI startup matrix is available through `test:startup`. Tests use fixture credentials and controlled responses; they do not need real API credentials or live inference.

## Isolation

Every new fixture owns an `os.tmpdir()` / Python temporary directory. CLI children receive an allowlisted environment, with HOME, USERPROFILE, APPDATA and XDG locations redirected into that fixture. No developer `.env`, shell API key, personal settings database or library is inherited. External fetch is disabled in CLI children; Codex in PTY tests points to a fixture executable that fails if invoked. HTTP assertions use loopback only.

Fault injection, migration termination, SQL triggers, chmod and cleanup apply only to generated fixture paths. Databases and child processes close before their temporary directories are removed. Existing user databases are neither opened nor copied. Tests do not upload database artifacts or credentials.

## Matrix

| Boundary | Checked-in coverage |
| --- | --- |
| Saved versus invocation provider | Every supported saved provider × explicit/unset provider × saved/explicit/empty/unrelated key; verifies effective provider, key isolation, prompt decisions and unchanged database |
| Flags, shell, selected env file, database and defaults | Real CLI process table; port/library/provider/model precedence, ignored unselected `.env`, complete fresh overrides, explicit empty keys, invalid/incomplete providers and corrupt-settings bypass |
| Library discovery | Saved path, valid legacy `cli-library.json` import, existing default library, prompted choice and unconfirmed default; legacy JSON remains byte-for-byte unchanged |
| First terminal launch | Fresh home for OpenAI, Gemini, Codex and read-only; hidden key input, startup and restart without repeated questions |
| Configure before library selection | Provider saved first; unconfirmed default does not silently become a library choice |
| Cancellation and validation | Ctrl+C/EOF at library/key input, EOF after entering a replacement key, invalid provider choice and missing new key; no partial provider writes |
| Switching and reset | Separate keys/models, blank retention for selected provider, interactive reset, preserved story sentinel/library/port/network settings; existing process tests cover non-TTY reset |
| SQLite lock and recovery | Open/save/reset blocked by another connection; bounded failure, unchanged saved state and successful operations after unlock |
| Failed writes and migration | Trigger failure after a key write, trigger failure after migration DDL, killed migrator after real uncommitted DDL; original settings/key/schema recovered, integrity checked and clean upgrade succeeds |
| Storage unavailable | Real POSIX permission denial for a non-root user; portable file-as-directory obstruction on every OS; no sibling data overwritten |
| Native compatibility | `pnpm test:assurance` runs Cargo and covers TS/Rust interchange, v1 migration, stale-view CAS, key privacy and validation. Automatic native CI skips `config::tests`; `test:startup` exercises Node on the current OS, not the Tauri UI. |

POSIX permission assertions skip explicitly under Windows or root, where those permission semantics do not apply. A killed transaction is a process-crash test, not a simulation of a machine losing power.

## Before npm publication

Run the local release checks without building or publishing:

```bash
pnpm run npm:check
```

This runs typecheck, lint and a critical release smoke selection. Local results establish behavior on the current OS; Windows/Linux native verification and live provider permissions/quota remain separate.

`npm:check` uses the shared `test:e2e` runner to execute six non-browser release checks: production state-machine flow, headless CLI, npm CLI and publication guards, settings faults, and system settings. Browser creation-to-reading coverage has been retired with the other automated UI suites.

Desktop `release:check` runs typecheck, lint, the seven-file service release gate and Rust formatting. The full plan includes all supported registered JS tests, including provider/length matrices, all-book scans, PTY onboarding and service flows. No browser UI E2E suites remain registered.

All checks use isolated libraries and homes without live inference or real provider keys. In the full suite, C007 launches the real dev command in a disposable source root, excluding `.env` and personal libraries; it never migrates the developer's `.data/dev-local`.

The installed pre-push hook invokes `release:check` in an isolated checkout of each distinct commit targeted by a pushed `v*` tag. Any failed check rejects the tag push and cleans up the checkout. Ordinary branches, non-v tags and tag deletions bypass the checks. Install the hook with `pnpm hooks:install` and use the pinned Node/pnpm and Rust/rustfmt. Tag Actions rely on this local check and run native tests and installer smoke checks before publishing.

For publication, use `pnpm run npm:publish`: it runs `npm:check`, builds a fresh tarball, smoke-tests that exact artifact, then publishes only if every step succeeds. `pnpm run npm:publish --dry-run` performs the same checks/build/smoke and passes `--dry-run` to the final publish command. See [npm release instructions](npm-publishing.md). The release wrapper remains in the private checkout; the consumer package has no release/install hooks.
