# Shared provider setup

## Summary

CLI and desktop configure and reuse OpenAI API, Gemini, Codex or read-only profiles through the same private settings database. First CLI launch guides setup with hidden API-key input; `--configure` edits profiles and `--reset-providers` clears only provider settings. OpenAI handles text/storyboard/review and reference-image generation with validated outputs and safe failures. Environment overrides are invocation-only. Desktop uses the same protocol, atomic migration and stale-view protection. Documentation covers both entry points.

## Verification

Node 24.22.1 / pnpm 11.25.0. Complete JS regression: 597 passed; focused settings/OpenAI: 14 passed. Rust: 19 applicable cases passed, one prepared-bundled-Node case filtered. Typecheck/lint, Rust formatting, 46 documentation links/anchors and diff checks passed. Local PTY setup/configure/reset/cancellation and in-app-browser desktop preview passed. No live provider calls or native installer/Docker packaging.

## Notes

Implementation milestones: `20daa33`, `bc0ebcc`, local and unpushed. Documentation remains in the working tree alongside prior documentation work; user screenshot changes are preserved. API keys remain plaintext in a separate private settings database, protected by filesystem permissions. Native/PTY/browser evidence is macOS; real API permissions/quota and Windows/Linux native runtime remain unverified.

## Final review and acceptance result (verbatim)

CR passed: no major findings

CR risk: non-low — shared credential persistence/migration, cross-entry settings concurrency, provider billing and native/CLI behavior change.
CR review round: 3; reviewer: reused (`shared_provider_review`).

The additional network/timeout assertions strengthen safe-error coverage without changing production behavior. The prior fixes and full-story review remain valid. Production is stable at `20daa33`; additional test coverage is committed in `bc0ebcc`.

1. **Complete — OpenAI API provider.** `server/openai-provider.ts` implements structured Responses text requests, all shared storyboard/review stages, image generation and saved-reference image edits. Outputs and image bytes are validated; refusal, incomplete, malformed, HTTP, network and timeout failures use safe errors. Requests use explicit API credentials and have no provider/billing fallback. Mock transport coverage and the complete regression suite pass; real API account access and quota are unverified.

2. **Complete — First CLI setup and saved reuse.** CLI resolves its library before loading effective provider settings. Complete invocation overrides or saved settings avoid setup prompts; otherwise the terminal offers Codex, OpenAI API, Gemini and read-only. PTY evidence covers first launch, hidden key input, all four choices, saved restart, Ctrl+C and EOF cancellation. Non-interactive incomplete setup fails with guidance. Provider credentials are saved only after setup completes.

3. **Complete — Configure and reset.** `--configure` edits/selects the shared profile, retains the selected provider’s existing key on blank input, saves atomically and exits. `--reset-providers` clears provider configuration and credentials while preserving library/network settings and stories. PTY tests verify interactive reset and blank-key retention; process and storage tests verify non-interactive reset and preserved data.

4. **Complete — Shared settings database and overrides.** CLI and desktop use the same separate version-2 `desktop.sqlite`, including keyed Gemini/OpenAI credentials and independent model slots. Transactional version-1 migration preserves existing settings and credentials; legacy CLI directory selection is imported without deleting the original file. Actual TS/Rust round trips verify interoperability. Invocation overrides remain unsaved. CLI patches current settings; desktop revision/CAS uses a consistent settings snapshot.

5. **Complete — Desktop parity and credential boundary.** Desktop exposes the same four provider choices, first-use setup, saved configuration and reset behavior. Empty OpenAI model names are rejected consistently in Rust and TypeScript. Native views return credential-presence flags rather than keys; runtime credentials use private stdin, and API connection checks request only model metadata. The CLI does not start or import the desktop control backend or Tauri.

6. **Complete — Read-only, switching and storage safety.** Read-only blocks reader generation and historical `admin/generate`, and the strengthened restart test confirms unfinished queued jobs remain unattempted. Provider switching preserves inactive models and keys; reset leaves story data untouched. Both stores retain private permissions and corruption/future-version/symlink rejection. Native and TS regression tests cover migration, transactional rollback and stale-view rejection.

7. **Complete — Verification, documentation and scope.** The latest complete JavaScript rerun passed **597/597**, zero failures/skips/cancellations, in 88.1 seconds (`/tmp/shiqu-provider-tests-complete.log`). Focused settings/OpenAI coverage passed **14/14**. Rust passed **19 applicable tests**; one prepared-bundled-Node test was explicitly filtered. Typecheck, lint, Rust formatting, 46 documentation links/anchors and diff checks passed. README and user/developer/npm/desktop instructions cover onboarding, shared plaintext credential storage, overrides, reset and API/subscription billing. In-app-browser preview verified the desktop setup controls.

All AP tasks and required local E2E scenarios are evidenced. Runtime, PTY and browser verification ran on macOS; Windows/Linux path coverage is not native end-to-end verification. No real API credentials were provisioned or used, and no live inference, desktop/Docker packaging, publication or push occurred. Documentation remains in the working tree; user screenshot changes remain preserved.

VR passed: all acceptance criteria complete

VR risk: non-low — shared credential persistence, cross-entry settings concurrency and provider/API behavior change.
VR review round: 1; reviewer: reused (`shared_provider_review`).
