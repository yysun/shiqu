# Desktop editions — Standard by default

Docker is unnecessary friction for a personal reading app. Ship a Tauri 2 control panel that runs the existing Node server, retaining the browser reader and shared desktop/phone library. The user changed the delivery target to Standard with Node 24 bundled; retain Lite as an optional build variant. This is not a WASM application rewrite.

## Acceptance criteria

- [x] The default Standard package includes the pinned Node 24.22.1 executable for its platform/architecture, its license notices, the built reader/server, production dependencies, migrations, seed, and 24-book library. It contains no pnpm, environment files, credentials, or personal data. End users install neither Node nor dependencies.
- [x] Standard always selects its own bundled Node and validates the pinned version plus SQLite support; missing/corrupt bundled runtime fails clearly without falling back to system Node. Its settings show the bundled runtime status instead of requiring a Node path. Optional Lite retains system-Node detection, explicit executable selection, SQLite validation, and missing/incompatible errors, and excludes Node from its package.
- [ ] Users can choose Gemini or the existing Codex subscription integration, edit models and data directory, enter/mask/reveal/replace/delete a Gemini key that always saves to the native local database, and test configuration without a paid generation request. Codex's existing Windows limitation is explicit.
- [ ] Settings persist in a separate native desktop SQLite database. Gemini keys always persist in that database, with plaintext storage disclosed. When no saved key exists, a launch-time GEMINI_API_KEY imports and saves once per application launch; an existing database key wins. Deleting a key does not reimport the environment until a fresh app launch. No session-only mode remains. Environment import never reads shell profiles or executes shell commands. No key value returns through settings reads or reader/phone HTTP, logs, or process arguments/environment; transport to Node remains private stdin. Existing nonsecret settings.json migrates once without overwriting subsequent database edits. Keychain is no longer required or accessed.
- [ ] Start, stop, status, browser launch, tray/background behavior, port conflicts, crashes, and quit are handled; shutdown releases the server and its child processes. A second desktop instance focuses the first, and duplicate desktop ownership of one data directory is prevented.
- [x] Phone sharing is opt-in. The desktop displays actual LAN pairing URLs and QR codes; unpaired clients cannot read or mutate the API. Settings remain native-only. Restart revokes sessions. The UI explains same-network, firewall, plain-HTTP trusted-network, and host-awake requirements.
- [x] Desktop and paired browsers use the existing persistent SQLite/media library. Restart preserves stories and reading progress. `pnpm start` still runs the ordinary Node server independently, and existing Node/Docker entry points retain their behavior.
- [ ] A packaged macOS Standard app is built and exercised with its bundled Node, including a test with no system Node available on PATH, pairing, persistence, and shutdown. Linux/Windows build configuration covers both variants with validation limits stated honestly.
- [x] Meaningful security/runtime tests, existing unit/integration suites, typecheck, lint, frontend/server build, Rust checks, and the matching E2E specification are completed or their concrete blockers recorded.

## Boundaries

Standard is the default download/build; Lite remains optional. No backend rewrite, Docker image builds, remote hosting, Internet tunnels, multi-user accounts, paid AI calls, end-user runtime download, app-store publication, or signing-key provisioning. The current providers and model behavior remain unchanged. Preserve unrelated pending edits/assets.

## Decisions

Bundle the build toolchain's exact pinned Node 24.22.1 executable and its installed license notices after checking version and target architecture. Native platform builds produce matching executables; fail rather than silently shipping a mismatched runtime. Standard has no fallback to system Node. Build variants share the same application/storage identity and are alternative installations, with the existing single-instance/data locks. A small local React settings UI and Tauri supervisor manage both. Configuration is separate from `.env`. Pairing grants single-owner application access; LAN HTTP is for trusted networks only. No blocking product questions.

Latest authorized change: session-only keys, launch-environment lookup, and SQLite persistence for settings/optional keys replace the previous OS-only credential design. Old Keychain credentials are left untouched; users re-enter them. Database keys are plaintext; no custom encryption or shell-profile scraping.

Final user correction: “No more session-only. Always saved.” This supersedes the earlier session mode and source precedence. All entered keys persist to SQLite; environment import only seeds an empty credential record at app launch.
