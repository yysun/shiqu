# Desktop Lite

Docker is unnecessary friction for a personal reading app. Ship a Tauri 2 control panel that runs the existing server using a user-installed Node runtime, while retaining the browser reader and shared desktop/phone library.

## Acceptance criteria

- [ ] Lite packages the built reader, server, production dependencies, migrations, seed, and 24-book library without Node, pnpm, environment files, credentials, or personal data. End users do not install dependencies.
- [ ] The settings window detects Node 24, supports an explicit executable path, validates SQLite support, and reports missing/incompatible runtime errors without starting the server.
- [ ] Users can choose Gemini or the existing Codex subscription integration, edit models and data directory, enter/mask/reveal/replace/delete a Gemini key, and test configuration without a paid generation request. Codex's existing Windows limitation is explicit.
- [ ] Gemini keys persist only in the OS credential store, are never returned by settings reads, and reach Node through private process input rather than arguments, files, browser/phone responses, or logs. Credential-store failure is visible and never falls back to plaintext.
- [ ] Start, stop, status, browser launch, tray/background behavior, port conflicts, crashes, and quit are handled; shutdown releases the server and its child processes. A second desktop instance focuses the first, and duplicate desktop ownership of one data directory is prevented.
- [ ] Phone sharing is opt-in. The desktop displays actual LAN pairing URLs and QR codes; unpaired clients cannot read or mutate the API. Settings remain native-only. Restart revokes sessions. The UI explains same-network, firewall, plain-HTTP trusted-network, and host-awake requirements.
- [ ] Desktop and paired browsers use the existing persistent SQLite/media library. Restart preserves stories and reading progress. Existing Node/Docker entry points retain their behavior.
- [ ] A packaged macOS Lite app is built and exercised, including real system Node launch, browser pairing, persistence, and shutdown. Linux/Windows build configuration is provided with validation limits stated honestly.
- [ ] Meaningful security/runtime tests, existing unit/integration suites, typecheck, lint, frontend/server build, Rust checks, and the matching E2E specification are completed or their concrete blockers recorded.

## Boundaries

Build Lite only. No bundled-Node edition, backend rewrite, Docker image builds, remote hosting, Internet tunnels, multi-user accounts, paid AI calls, automatic runtime download, app-store publication, or signing-key provisioning. The current providers and model behavior remain unchanged. Preserve unrelated pending edits/assets.

## Decisions

Use system Node 24 (project pins 24.22.1; validate actual SQLite APIs), a small local React settings UI, and a Tauri-owned supervisor. The desktop configuration is separate from `.env`. Phone pairing grants the existing single-owner application access; it is not multi-user isolation. LAN HTTP is for trusted networks only. No blocking product questions.
