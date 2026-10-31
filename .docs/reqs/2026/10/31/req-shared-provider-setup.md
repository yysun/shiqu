# Shared provider setup

Users must be able to configure generation once in CLI or desktop and reuse it in either entry, including OpenAI API billing separately from Codex subscriptions. Real API credentials are entered by end users at runtime; this implementation uses mocked provider tests and does not create, configure or call a live API key.

## Acceptance

- [x] SHIQU_AI_PROVIDER=openai supports all existing text/storyboard/review tasks and reference-consistent image generation via the official API, with independent model/key settings, validated results and safe errors. No fallback to other providers or billing; existing Codex/Gemini work unchanged.
- [x] CLI first resolves the library, then uses complete explicit environment/config or shared saved provider settings without asking. Otherwise an interactive menu offers Codex, OpenAI API, Gemini and read-only. API key input is hidden; cancellation/EOF does not partially save provider credentials. Noninteractive missing setup fails clearly.
- [x] CLI --configure edits/selects a provider, reuses an existing selected-provider key on blank input and saves atomically; --reset-providers clears saved provider configuration/keys and reopens setup interactively, preserving library and non-provider settings. Noninteractive reset clears and exits with guidance.
- [x] CLI and desktop read/write the same separate private desktop.sqlite settings/credentials schema. Old version-1 desktop settings/key and prior CLI directory selections migrate without data loss. Explicit environment overrides are invocation-only and never imported/persisted automatically.
- [x] Desktop offers the same provider choices, first-run configuration, saved-config reuse and provider reset. Keys never appear in settings views, HTTP, arguments or logs; API connection checks use metadata only. No desktop backend/Tauri requirement for CLI.
- [x] Read-only mode never dispatches generation. Provider switching preserves each provider's own models/keys; resets never touch story data. Filesystem permissions and corruption/future-version/symlink protections remain in both implementations.
- [x] Regression tests cover API payload/error validation, real SQLite migration and TS/Rust interoperability, CLI initial/configure/reset/cancel/overrides and both-entry persistence. Typecheck/lint/appropriate Rust checks and in-app-browser desktop preview pass. Docs describe onboarding, overrides, plaintext local key storage, reset and separate API/subscription billing. No Docker/desktop package or publication.
