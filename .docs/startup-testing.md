# Startup configuration tests

Run with the Node and pnpm versions pinned by `.nvmrc` and `packageManager`:

```bash
pnpm run test:startup
pnpm run test:pty
```

`test:pty` requires Python 3.9+ on Linux/macOS and uses only the standard library. Windows runs the real CLI startup and database matrix; POSIX terminal tests are explicitly skipped there. `pnpm test` includes both suites. Tests never need API credentials or an installed Codex CLI.

## Isolation

Every new fixture owns an `os.tmpdir()` / Python temporary directory. CLI children receive an allowlisted environment, with HOME, USERPROFILE, APPDATA and XDG locations redirected into that fixture. No developer `.env`, shell API key, personal settings database or library is inherited. External fetch is disabled in CLI children; Codex in PTY tests points to a fixture executable that fails if invoked. HTTP assertions use loopback only.

Fault injection, migration termination, SQL triggers, chmod and cleanup apply only to generated fixture paths. Databases and child processes close before their temporary directories are removed. Existing user databases are neither opened nor copied. No database artifacts or credentials are uploaded by CI.

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
| Native compatibility | Existing Rust tests cover TS/Rust interchange, v1 migration, stale-view CAS, key privacy and validation. `test:startup` itself exercises Node on each native OS, not the Tauri UI. |

POSIX permission assertions skip explicitly under Windows or root, where those permission semantics do not apply. They run on normal Linux/macOS CI users. A killed transaction is a process-crash test, not a simulation of a machine losing power.

## CI

[Startup configuration](../.github/workflows/startup-tests.yml) runs the same `pnpm run test:startup` command on Ubuntu, macOS and Windows, and `pnpm run test:pty` on Ubuntu/macOS with an explicitly installed Python version. It also runs typecheck/lint. It triggers for relevant pull requests, pushes to `main` or `codex/**`, and manual dispatch. It does not build Docker images, package installers, publish releases or use repository secrets.

Native desktop packaging checks remain in the separate existing desktop workflow. Local macOS results alone do not establish a Windows/Linux CI pass; use the actual workflow run for those outcomes. Live provider account permissions and generation quota are outside these startup tests.
