# @apprun/shiqu npm CLI

## Summary

Ship the existing browser application as a publishable npm CLI, so Node users can run it without cloning or building the project. `pnpm build:npm` produces `outputs/npm/apprun-shiqu-0.3.2.tgz` with the compiled reader/server, all 24 book sources and notices, and only six runtime dependencies. The executable checks Node 24, resolves assets from the installation, keeps persistent data outside the package cache, supports explicit `--config` env files and caller-relative data paths, and defaults to loopback with the existing Host/Origin boundary. A shared server lifecycle preserves the source/Docker entry points.

The checkout remains private. Publish the generated tarball using the commands in `.docs/npm-publishing.md`; nothing was uploaded. Implementation commits: `f6f6250` and `6b0f25e`.

## Verification

- Node 24.22.1 and pnpm 11.25.0.
- `pnpm test`: 571 passed, zero failed/skipped/cancelled, 37.7 seconds.
- `pnpm typecheck` and `pnpm lint`: passed.
- `pnpm build:npm`: passed; tarball 31,859,686 bytes.
- `pnpm npm:smoke --offline`: passed against the actual tarball installed outside the checkout. Verified 1,968 payload files, all 24 book sources byte-for-byte, required notices/migrations, executable shim, real tokenizer WASM, reader assets/API, invalid inputs, configuration precedence, OS data defaults, immutable package files, Host/Origin rejection, wildcard local URL, persistence and clean macOS SIGTERM/restart.
- Node 22.23.4 explicitly rejects the executable with a Node 24 requirement.
- Independent AR and CR passed; final CR round 3 reused the same reviewer.

Initial restricted-sandbox HTTP tests could not bind loopback; verification ran with local listeners enabled. One existing 80-frame timing test timed out during an intermediate concurrent-build run; the final standalone full suite passed unchanged. No Docker/native desktop packaging or paid provider calls were used.

## Final verification review

1. **Complete — Publishable package.** `pnpm build:npm` produced `@apprun/shiqu@0.3.2` as `outputs/npm/apprun-shiqu-0.3.2.tgz` (31,859,686 bytes). Installed-tarball inspection verified the executable, compiled app, 24 book sources, migrations, seed SQL, and notices.
2. **Complete — Independent installed runtime.** ET installed the tarball outside the checkout and ran the installed command with Node 24 from an unrelated directory. No consumer build hooks, development dependencies, or pnpm invocation are required. Tokenizer WASM executed successfully.
3. **Complete — Persistent configuration/data.** Unit tests and ET verified OS user-data defaults, caller-relative explicit paths, `--config` loading, shell precedence, and flag precedence. Package files remained immutable.
4. **Complete — CLI contract.** Help/README document version, port, host, data directory, and explicit env-file loading via `--config`. Invalid inputs fail before library creation; Node 22.23.4 produces the explicit Node 24 requirement.
5. **Complete — Packed runtime verification.** ET verified 1,968 allowlisted files, book-byte integrity, HTTP assets/API, Host/Origin rejection, persisted drafts after clean SIGTERM and same-port restart, wildcard URLs, and absence of private/development payloads.
6. **Complete — Release instructions and scope.** Publishing and consumer commands are documented. Registry publication/authentication, Docker/desktop packaging, paid generation, and unrelated changes were excluded.

Final tests: **571/571 passed**, zero failures/skips/cancellations, confirmed in `/tmp/shiqu-npm-tests-final.log`. Typecheck passed; prior lint evidence remains valid because runtime inputs are unchanged. CR round 3 passed. All plan tasks are complete.

**VR passed: all acceptance criteria complete**

VR risk: non-low — published executable, runtime packaging, and persistent-data behavior.  
VR review round: 1; reviewer: reused (`npm_review`).

Evidence limits: installed-runtime ET ran on macOS. Windows/Linux default paths have unit coverage; native end-to-end execution there was not claimed. npm scope ownership, credentials, and registry-version availability remain publisher checks.

## Notes

`--config <env-file>` deliberately avoids collision with Node 24.22.1's own `--env-file` processing. No `.env` is auto-loaded by the CLI. The npm README includes consumer startup/configuration commands and data/backup paths. Codex requires a separately installed logged-in CLI on supported platforms; Gemini uses an API key. The package does not include the desktop window or internet tunnel.

Concurrent desktop/README/assets changes were preserved and excluded from the npm commits. The user requested the final delivery commit after verification; it includes the completed requirement/plan/delivery evidence. No push or npm publication was performed.
