# npm CLI release

Story base: `cc662b282652b4fc1d8c3d0938eaaaf62e832461`.

## Design

Keep the development checkout private. `pnpm build:npm` builds the reader, bundles a separate CLI server entry, stages an allowlisted package in `outputs/npm/package`, and creates its tarball in `outputs/npm`. Derive the release version and Node requirement from the root manifest; derive runtime dependencies from esbuild's external imports and reject undeclared imports. The staged manifest exposes `bin/shiqu.mjs`, public registry metadata, and no installation/build lifecycle scripts.

The executable checks Node before dynamically importing the backend. A shared server startup module takes an explicit immutable asset root, leaving the existing source/Docker entry at `process.cwd()`. The CLI resolves its root from its installed module URL, parses arguments and explicit env files, resolves relative user paths from the caller's working directory, and chooses a dedicated OS user-data path when absent. It applies the existing `desktopAccess` Host/Origin boundary to its local/LAN listener. It prints the local URL and keeps serving until interrupted. It does not automatically open another application.

No new dependencies. Keep original-book bytes and source/license notices. Do not copy `.env`, writable libraries, desktop resources, repository metadata, tests, or source code into the release. Runtime dependency WASM remains in its installed dependency package. Existing desktop build/resource scripts are unchanged.

## Implementation and validation

- [x] First SS probe: use pinned Node/pnpm to confirm build tooling and that the CLI bundle's external runtime imports can all be resolved to declared production dependencies. A missing runtime asset or dependency stops packaging until repaired.
- [x] Add the version-checked executable, argument/default configuration, explicit installed asset root, and shared server lifecycle without changing existing startup defaults.
- [x] Add release manifest metadata, build/pack scripts, fixed payload allowlist, and npm README/publishing documentation.
- [x] Add focused CLI behavior tests and an isolated tarball installation smoke command that does not use the checkout's dependencies.
- [x] Run applicable JavaScript tests, typecheck, lint, release build, pack inspection, and installed-package E2E scenarios in `.docs/tests/test-npm-cli.md`.

Tradeoffs: the complete book library makes the download larger, but keeps first-run behavior and source verification independent of a download service. npm package-name ownership and registry authentication are checked by the publisher at release time; preparation does not claim either. Native Windows Codex support remains outside this change; Gemini works without that runner. The smoke install may require registry access; report offline installation separately if it cannot be obtained.

## Review and delivery evidence

AR passed: no blocking architecture flaws

AR risk: non-low — introduces a published executable, relocated runtime assets, and a persistent-data contract.
AR review round: 1; reviewer: new (`npm_review`).

Reviewer guidance accepted: reuse the existing Host/Origin middleware for the CLI and test foreign Host/Origin rejection. Consumer startup must invoke only Node/the installed executable, never pnpm or install hooks.

SS probe passed on Node 24.22.1/pnpm 11.25.0. External imports resolve to six declared runtime dependencies: drizzle-orm, htmlparser2, opencc-js, qrcode-terminal, tiktoken, zod. The first packed release built successfully. Focused CLI tests pass (4); initial typecheck and lint pass. Node 22.23.4 rejects the executable with a clear Node 24 requirement. Installed-package verification is in progress; the isolated install and real tiktoken WASM invocation have passed. Full tests require local-network permission because sandboxed HTTP listeners fail with EPERM.

Implementation milestone: `f6f6250` (verification in progress). Runtime probing showed that Node 24.22.1 intercepts `--env-file` even after a script filename; the application option is therefore `--config <env-file>`, parsed with `node:util.parseEnv`. This preserves explicit loading, caller-relative paths, environment precedence, and controllable errors. CR round 1 identified wildcard binds printing a disallowed Host; the shared server now prints loopback for wildcard binds, and the installed smoke scenario checks that URL.

CR fixed: wildcard binds now print allowed loopback URLs; rerun result passed.

CR risk: non-low — published executable, runtime packaging, and persistent-data behavior.
CR review round: 2; reviewer: reused (`npm_review`).

Installed-tarball ET passed on macOS with Node 24.22.1: 1,968 allowlisted files, all 24 books byte-matched, runtime dependencies installed outside the checkout, tokenizer WASM exercised, installed command shim verified, HTML/JS/API served, foreign Hosts/Origins rejected, drafts persisted after SIGTERM/restart, env/flag/default paths checked, wildcard printed URL accepted, and runtime files stayed unchanged. No paid generation. Typecheck/lint pass after runtime changes. Full test rerun pending: the previous unrestricted run passed 570/571, with one existing 80-frame timing test timing out while release compression competed for CPU. The final run has no concurrent build.

Fix milestone: `6b0f25e`. CR round 3 covered the final smoke-test repairs (real raw Host header, actual tarball inspection vs installer shims, Windows termination evidence limits) and passed.

CR passed: no major findings

CR risk: non-low — published executable, runtime packaging, and persistent-data behavior.
CR review round: 3; reviewer: reused (`npm_review`).

TT passed: final `pnpm test` run passed all 571 tests with 0 failures, skips, or cancellations in 37.7 seconds (`/tmp/shiqu-npm-tests-final.log`). No concurrent build was running. Previous HTTP sandbox restrictions and the concurrent-build timing failure did not recur. `pnpm typecheck` and final `pnpm lint` passed. ET passed via `pnpm npm:smoke --offline` outside the restricted sandbox (local HTTP listener and cached dependency installation), using the final tarball. Output: `outputs/npm/apprun-shiqu-0.3.2.tgz`, 31,859,686 bytes. Publication command syntax checked with pinned `pnpm publish --help`; no registry publication or authentication was attempted.

VR passed: all acceptance criteria complete

VR risk: non-low — published executable, runtime packaging, and persistent-data behavior.
VR review round: 1; reviewer: reused (`npm_review`).

All six acceptance criteria are complete; full criterion evidence and platform limitations are preserved in `.docs/done/2026/10/31/npm-cli.md`. Installed ET ran on macOS; Windows/Linux data paths have unit coverage, not claimed native ET. npm scope ownership, authentication, and version availability remain publisher checks. DD complete. The user subsequently requested the final delivery commit; preserve the implementation commits and commit only npm release evidence.
