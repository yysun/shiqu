# Codex provider acceptance flows

1. Default Gemini: with no SHIQU_AI_PROVIDER, status and no-key sample behavior stay unchanged; existing mocked Gemini suggestions/planning/images and retry/concurrency tests pass.
2. Codex status: missing CLI or signed-out/API-key login returns unconfigured status and safe actionable explanation. ChatGPT-only executable readiness enables generation without GEMINI_API_KEY. Invalid provider config cannot silently choose Gemini.
3. Codex generation: fake subprocess produces structured suggestions and a valid eight-page plan, then image bytes; first image persists and is attached on subsequent scene jobs. Production prompt, requested style and source metadata remain present. Custom webpage URL sources return a clear Gemini-mode requirement; book-name original passages use existing checked retrieval. Restart continues existing saved steps.
4. Failure boundaries: invalid JSON/page count, path-only image results, invalid image signatures/bytes, timeout, oversized output and nonzero CLI exit cannot save fabricated content or leak stdout/stderr/credentials. No alternate provider request. Temporary job files/processes are removed.
5. CLI isolation: argv contains no user prompt; stdin contains only intended story data/instructions; child environment excludes all API/provider credentials. ChatGPT-only login restriction, bounded execution and unrelated tool disabling are verified. Duplicate REST advances acquire only one generation job.
6. Local actual CLI probe: short structured text and one image only when needed to establish feasibility, using the existing ChatGPT sign-in. Record capability/network/permission failures honestly. No OpenAI API or Gemini billing fallback.
7. Docker: default data bind remains unchanged. Optional Codex login mount is distinct from /data and uses non-root identity, missing mount is actionable, CLI exists in selected image, login/status commands work without exposing auth contents. Keys/auth are absent from image/source/frontend.

## Executed evidence

All seven scenarios are covered by the 74-test suite plus the bounded native CLI and Docker checks recorded in the plan. Full story generation and failure paths use fake subprocesses/transports; actual ChatGPT auth, structured text and a native image were verified separately. Docker used a fresh signed-out login folder; user device login and authenticated Docker inference were not executed. Local pnpm login/status home and flag forwarding were exercised with a fake executable; actual local `pnpm run codex:status` reported ChatGPT sign-in.
