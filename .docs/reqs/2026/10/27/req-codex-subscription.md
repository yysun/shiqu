# Codex subscription provider

Allow the local single-user edition to use a ChatGPT-authenticated Codex installation instead of Gemini, selected through environment configuration. Switching must cover suggestions, story plans and scene images, without converting subscription credentials into an API key or silently making Gemini/API-billed calls.

## Acceptance criteria
- [x] SHIQU_AI_PROVIDER=gemini|codex selects the complete generation provider; Gemini stays the default and retains existing behavior.
- [x] Codex uses the official CLI with ChatGPT sign-in only, validated structured text and real validated generated images, preserving style, page count, production requirements, first-scene reference and original-source checks.
- [x] Provider status distinguishes unconfigured/missing CLI/sign-in from readiness without leaking credentials. Invalid config fails clearly. No automatic paid-provider fallback.
- [x] CLI prompts use stdin, isolated temporary job directories, bounded timeout/output and explicit restricted execution. App/provider keys are not inherited by child agents, and no shell interpolation or auth-token extraction is used. Generated outputs are checked before media persistence and temporary jobs are cleaned up.
- [x] Local and Docker setup document/install the CLI and allow separate persistent Codex login storage. Login artifacts remain outside the image, frontend, repository and story-data backups.
- [x] Existing current auto-retry behavior and story checkpoint concurrency protections remain valid for Codex request durations. Tests cover both providers, failure modes and no-fallback; typecheck/lint/build pass. Report actual live-provider verification separately from simulated tests.

No public service, new API key, private endpoint proxy, authentication bypass, or UI redesign. Existing commits including current automatic retry changes remain intact.
