# Shared provider setup

Story base: `f6fa9e1` (full hash recorded before source edits). Preserve current README/guide changes and user screenshot assets. Do not publish or build Docker/native installers.

## Design

Extend the existing desktop.sqlite to user_version=2 in one transaction in TS and Rust. Keep desktop_settings JSON, widen desktop_credentials CHECK to gemini/openai, add providerConfigured and separate OpenAI text/image model fields. Keep old fields for compatibility. Infer configured state for migrated Codex or saved Gemini credentials; new defaults remain unconfigured. A readonly provider is explicitly saved for skip/read-only selection. Provider-model slots and keyed credentials preserve inactive configurations. Shared schema/defaults/variable mapping live outside desktop.ts; CLI imports no desktop control backend. Rust mirrors the wire format and uses the same database transaction protocol.

Extract the existing desktop schema and defaults into lib/system-settings.ts; add Node system-settings storage with private permissions, symlink/future-version rejection and safe errors. CLI library choices now persist into the shared settings DB, importing an existing cli-library.json choice when applicable without deleting the legacy file. Explicit --data-dir remains invocation-only. Load explicit config first, resolve library, then saved profile + invocation overrides. If the effective provider is incomplete, ask interactively; save only after the provider wizard completes. Never persist environment-derived keys/settings automatically.

Add hidden terminal input and --configure/--reset-providers. A configured saved profile never prompts. Reset clears API credentials and provider fields/selection only, leaves library/network settings, and asks again only in a TTY. A read-only choice starts the reader with production dispatch stopped.

OpenAI uses fetch to fixed official endpoints, Responses structured outputs (strict schemas normalized for optional fields), GPT-6.1 Sol default text, and GPT Image default chosen from fetched official docs. Single-image generation/edit endpoints use validated base64, stored reference bytes, portrait request size and existing image validation. Reuse shared storyboard/review and local-source contracts; public URL source discovery remains Gemini-only. No added SDK dependency or automatic retry. Safe metadata-only status/key/model checks do not imply generation quota.

Desktop reads the same schema, adds OpenAI/read-only choice and reset command, selects settings on first setup, and hides saved key material. Environment overrides are merged only for runtime/check commands; get_settings returns only saved non-secret configuration and key-presence flags. Remove prior automatic environment-to-database import to honor override semantics. Preserve mutex and private stdin for native runtime.

## Implementation

- [x] Feasibility probe: pinned Node/pnpm and existing SQLite migration tests; inspect API schemas/current official model docs; validate the v1-to-v2 SQL transaction against TS/Rust fixture. Probe only mocks/local temporary data.
- [x] Implement shared settings schema/store and migration; persist library choices in DB; regression tests for migration, corruption, permissions and explicit precedence.
- [x] Add OpenAI reader provider, read-only adapter, provider status/types and transport tests across text/review/reference-image paths and safe failures.
- [x] Implement CLI setup prompts, hidden input, --configure/--reset-providers and overrides with tests for first launch, cancellation, saved reuse and noninteractive cases.
- [x] Extend native settings/protocol, provider reset and React setup UI; test TS/Rust DB interoperability, saved-profile switching, key privacy and metadata-only checks.
- [x] Update CLI, README, user/developer/desktop docs and example environment settings.
- [x] Run affected tests, full JS suite with bounded concurrency, typecheck/lint, applicable Rust tests/format and local E2E/PTY/in-app preview; record unrun native packaging/live-provider limits.

## Validation and risks

SQLite schema version migration must roll back on malformed/future data and preserve all old settings/keys. CLI and desktop can edit settings concurrently: transactional writes must not replace unrelated settings from stale views; API key changes apply only to selected provider. Shared credentials remain plaintext, protected by local permissions, never copied into stories or browser output. Reset while another service runs affects next launch, not the in-memory credentials already running; desktop requires its own service stopped. Defaults are explicit readonly/unconfigured rather than silently using invalid credentials. Environment-only overrides do not persist. Record real-API access as unverified; mocked transport validates the contract only.

Story base full hash: `f6fa9e18431287d8f7782e675c3c593a4949b85f`.

AR passed: no blocking architecture flaws

AR risk: non-low — shared credential persistence/migration, cross-entry settings concurrency, provider billing and native/CLI behavior change.
AR review round: 1; reviewer: new (`shared_provider_review`).

AR constraints: v2 also adds desktop_settings.revision for native view CAS; CLI patches the latest row in a transaction. Read-only must block the legacy admin/generate route as well as ReaderProvider and production startup. Runtime users enter their own keys; no local agent credential provisioning or live inference.

## Verification evidence

Node 24.22.1 / pnpm 11.25.0. Full JS suite with file concurrency 2: 597/597 passed (85.2 s); after strengthening read-only restart coverage, OpenAI/settings subset: 14/14 passed. Typecheck/lint, Rust formatting, 46 local documentation links/anchors and git diff checks passed. Rust: 19 applicable cases passed, one requiring prepared bundled Node resources filtered using a test-only resource override. Tests include an actual Node/Rust shared-database round trip. No live provider calls, registry publication, Docker build or native packaging.

CR fixed: native validation now rejects empty OpenAI model names, and desktop settings views read settings, revision and key-presence flags from one SQLite snapshot; rerun result passed.

CR risk: non-low — shared credential persistence/migration, cross-entry settings concurrency, provider billing and native/CLI behavior change.
CR review round: 2; reviewer: reused (`shared_provider_review`).

Implementation milestone: `20daa33` — shared settings/store, CLI setup, OpenAI/read-only provider, native/UI protocol and regression tests. Source/tests committed; README/guide updates remain in the working tree alongside existing documentation work and the user's screenshot changes. No push.

Desktop preview was verified in the in-app browser at localhost:1420: first-use help, all four provider choices, masked key field, provider billing/storage notices and reset affordance. Browser preview intentionally disables native writes/service controls; native store/command tests provide persistence evidence. Native installer behavior and live API access remain unverified.

PTY E2E passed with a disposable home/library and fake keys: all four provider choices, saved-profile restart without prompts, hidden key input, Ctrl+C and EOF cancellation without partial credential saves, blank-key retention, and interactive reset preserving the library. Early harness runs matched “已保存” inside the saved-key prompt; the harness now waits for the exact completion message. No product lifecycle change was needed. Transport regression coverage also exercises safe network and timeout failures (14/14 focused cases passed).

Final complete rerun: 597/597 passed (88.1 s), no skipped/cancelled cases. Latest additional network/timeout assertions passed in the focused 14-case subset. Regression milestone: `bc0ebcc`. Both local commits remain unpushed; final docs remain reviewable in the working tree.

CR passed: no major findings

CR risk: non-low — shared credential persistence/migration, cross-entry settings concurrency, provider billing and native/CLI behavior change.
CR review round: 3; reviewer: reused (`shared_provider_review`).

VR passed: all acceptance criteria complete

VR risk: non-low — shared credential persistence, cross-entry settings concurrency and provider/API behavior change.
VR review round: 1; reviewer: reused (`shared_provider_review`).
