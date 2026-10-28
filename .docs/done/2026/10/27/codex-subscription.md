# Codex subscription provider

## Summary

Shiqu can use a ChatGPT-authenticated Codex CLI for suggestions, story plans and scene images by setting `SHIQU_AI_PROVIDER=codex`. Gemini remains the default. pnpm login/status helpers use the same executable and login home as the app. An optional Docker target packages the pinned CLI and keeps login state separate from story data.

Implementation milestone: `f60ebec`. No push performed.

## Verification

74 tests, typecheck, lint and production build passed. Independent CR passed. Docker non-root CLI/pnpm execution, signed-out readiness, sample access and distinct mounts passed. Live text/image primitives were verified separately; full story execution uses simulations.

1. **Provider selection — complete.** `SHIQU_AI_PROVIDER` selects Gemini or Codex for suggestions, planning, and images. Gemini remains the default; invalid values fail explicitly. Routing tests verify no Gemini fallback.

2. **Subscription generation — complete.** The official pinned CLI requires ChatGPT authentication. Shared schemas/prompts and validation preserve page count, styles, production requirements, and first-scene attachments. Native image bytes are accepted; returned paths are ignored. Checked original retrieval remains intact. Custom webpage URLs are explicitly unsupported in Codex mode.

3. **Readiness and safe failures — complete.** Missing CLI, signed-out/API-key authentication, and unsafe configuration produce unconfigured status without credential disclosure. Real signed-out Docker checks returned `CHATGPT_LOGIN_REQUIRED`, while sample reading remained available.

4. **Execution boundary — complete.** Prompts travel through stdin in temporary jobs. Environment filtering excludes API/provider credentials; shell/file tools and dynamically discovered MCP integrations are disabled. Tests cover output limits, timeout/process failure, cleanup, invalid outputs, and path-only image rejection. Standalone sandbox exit `134` remains correctly classified as inconclusive.

5. **Local and Docker setup — complete.** pnpm helpers share executable/login-home settings. The optional image contains CLI `0.165.0`, runs non-root, and uses distinct data/login mounts. Offline Docker status and merged Compose checks passed. Credentials were not copied into the image.

6. **Retries, concurrency, and verification — complete.** Existing retry/checkpoint safeguards remain unchanged; bounded generation fits the lease budget. All 74 tests, typecheck, lint, and production build passed. CR passed with no major findings.

Live evidence establishes local ChatGPT authentication, structured text, and native image capability separately. Full story generation remains simulated; authenticated Docker inference was not tested.

VR risk: non-low — subprocess execution, credentials, provider routing, and Docker deployment.
VR review round: 1; reviewer: reused.

VR passed: all acceptance criteria complete.

## Notes

Codex custom webpage URL sources are rejected explicitly; use book names or Gemini for those URLs. Native Windows host execution is unsupported; use Docker or Gemini. The CLI app-server interface and image access depend on the supported CLI version and subscription/workspace capabilities. Docker device sign-in and authenticated inference require the user's login and were not performed. Existing `.env` was not changed.
