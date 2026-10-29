# Desktop editions — Standard by default

Docker is unnecessary friction for a personal reading app. Ship a Tauri 2 control panel that runs the existing Node server, retaining the browser reader and shared desktop/phone library. The user changed the delivery target to Standard with Node 24 bundled; retain Lite as an optional build variant. This is not a WASM application rewrite.

## Acceptance criteria

- [ ] The default Standard package includes the pinned Node 24.22.1 executable for its platform/architecture, its license notices, the built reader/server, production dependencies, migrations, seed, and 24-book library. It contains no pnpm, environment files, credentials, or personal data. End users install neither Node nor dependencies.
- [ ] Standard always selects its own bundled Node and validates the pinned version plus SQLite support; missing/corrupt bundled runtime fails clearly without falling back to system Node. Its settings show the bundled runtime status instead of requiring a Node path. Optional Lite retains system-Node detection, explicit executable selection, SQLite validation, and missing/incompatible errors, and excludes Node from its package.
- [ ] Users can choose Gemini or the existing Codex subscription integration, edit models and data directory, enter/mask/reveal/replace/delete a Gemini key, and test configuration without a paid generation request. Codex's existing Windows limitation is explicit.
- [ ] Gemini keys persist only in the OS credential store, are never returned by settings reads, and reach Node through private process input rather than arguments, files, browser/phone responses, or logs. Credential-store failure is visible and never falls back to plaintext.
- [ ] Start, stop, status, browser launch, tray/background behavior, port conflicts, crashes, and quit are handled; shutdown releases the server and its child processes. A second desktop instance focuses the first, and duplicate desktop ownership of one data directory is prevented.
- [ ] Phone sharing is opt-in. The desktop displays actual LAN pairing URLs and QR codes; unpaired clients cannot read or mutate the API. Settings remain native-only. Restart revokes sessions. The UI explains same-network, firewall, plain-HTTP trusted-network, and host-awake requirements.
- [ ] Desktop and paired browsers use the existing persistent SQLite/media library. Restart preserves stories and reading progress. `pnpm start` still runs the ordinary Node server independently, and existing Node/Docker entry points retain their behavior.
- [ ] A packaged macOS Standard app is built and exercised with its bundled Node, including a test with no system Node available on PATH, pairing, persistence, and shutdown. Linux/Windows build configuration covers both variants with validation limits stated honestly.
- [ ] Meaningful security/runtime tests, existing unit/integration suites, typecheck, lint, frontend/server build, Rust checks, and the matching E2E specification are completed or their concrete blockers recorded.

## Boundaries

Standard is the default download/build; Lite remains optional. No backend rewrite, Docker image builds, remote hosting, Internet tunnels, multi-user accounts, paid AI calls, end-user runtime download, app-store publication, or signing-key provisioning. The current providers and model behavior remain unchanged. Preserve unrelated pending edits/assets.

## Decisions

Bundle the build toolchain's exact pinned Node 24.22.1 executable and its installed license notices after checking version and target architecture. Native platform builds produce matching executables; fail rather than silently shipping a mismatched runtime. Standard has no fallback to system Node. Build variants share the same application/storage identity and are alternative installations, with the existing single-instance/data locks. A small local React settings UI and Tauri supervisor manage both. Configuration is separate from `.env`. Pairing grants single-owner application access; LAN HTTP is for trusted networks only. No blocking product questions.
