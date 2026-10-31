# Shared provider setup E2E

1. Temporary new home/library: CLI prompts provider, hidden key input is not echoed, cancellation/EOF leaves previous provider config/keys unchanged. Confirm each provider/read-only choice, restart and verify no repeat setup.
2. Use a valid v1 desktop.sqlite with Gemini key and custom library. CLI migrates/reuses it without prompt; Rust can read the new schema and TS can read native-saved OpenAI selection/key. Neither settings views nor HTTP return key bytes.
3. CLI --configure switches provider and remembers each key/model; blank saved-key input retains only the selected provider's existing key. --reset-providers removes saved provider data but preserves stories, progress, library/network settings; interactive setup follows, noninteractive reset exits with guidance.
4. Explicit environment/config overrides win for one invocation, are never saved/imported and do not accidentally combine another provider's key. Partial/missing API setup and fresh non-TTY launch fail clearly, help/version have no side effects.
5. Mock OpenAI Responses text/schema/reasoning/store:false and image-generation/edit requests, use an existing image as the edit reference, validate returned bytes; malformed/incomplete/refused output, HTTP auth/quota/server errors and network failures remain safe and preserve saved work. No live provider calls.
6. Desktop Vite preview in the existing in-app browser: setup view, OpenAI/Codex/Gemini/read-only choices, provider-specific model/key fields, saved-key indicators and reset affordance. Native local tests verify secret-free views, private stdin, migration, metadata-only connection checks and environment override behavior.
7. Read-only startup against an unfinished story never dispatches jobs; normal provider startup and existing CLI/desktop exclusive-library lifecycle remain covered by regression suites. Native installer packaging and registry publication remain outside scope.

## Execution — 2026-10-31

All seven scenarios completed through local mocked/native/PTY/browser boundaries. Full JS regression: 597 passed. Settings/OpenAI subset after adding pending-job restart and network/timeout checks: 14 passed. Native Rust: 19 applicable cases passed, including actual TS/Rust database interoperability and stale-snapshot rejection; one prepared-bundled-Node test filtered. In-app-browser Vite preview verified first-use help, provider choices, key masking, storage/billing notices and reset controls. Native persistence and secret-free view behavior use local tests; browser preview keeps native writes disabled. PTY verifies all choices, saved reuse, hidden keys, Ctrl+C/EOF cancellation, blank retention and interactive reset using fake credentials only.

No live provider generation, native installer/Docker packaging or publication. Native/PTY/browser runtime evidence is macOS; Windows/Linux path tests are not native E2E evidence.
