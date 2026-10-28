# Codex subscription integration

Story base: `be7bc78`. Branch: `feat/node-react-local`; worktree: `node-react-migration/shiqu-docker`. Preserve the current automatic retries and style viewer.

## Design

A server-owned provider port supplies readiness, suggestions, generators and safe errors. `SHIQU_AI_PROVIDER=gemini|codex` selects the whole provider, with Gemini the default. Shared schemas and prompts preserve page count, art direction, production requirements and source metadata. Codex accepts book names; custom webpage URL sources return an explicit error because browser/web-fetch tools are disabled. Original passages continue through the existing checked retrieval.

Codex uses the official pinned CLI 0.165.0 through its stdio app-server protocol, with ChatGPT authentication only. Check account type before applying the thread's forced login method, so API-key users are rejected without logging them out. Never fall back to Gemini or API billing. Login/status helpers read the same `.env`, executable and login home as the app. All documented commands use pnpm.

Each job has an isolated temporary cwd, stdin-only prompts, an ephemeral thread and no approval requests. Disable shell, command/file-view tools, browser/computer tools, integrations, hooks and delegation. Discover all inherited MCP server names and disable each per thread, then verify zero callable tools/resources/templates. Native image generation requires `code_mode_host`, a V8 tool dispatcher without Node/fs primitives. Accept only native `imageGeneration.result` bytes, never `savedPath`. The deny-root/read-job filesystem profile and unexpected-tool abort are additional defenses; standalone sandbox tests did not establish read denial, so they are not claimed as proof. Filter app/API/provider credentials from the child environment.

A generation job has a 120-second total deadline; suggestions 60 seconds; status 10 seconds. Process-group termination and cleanup add at most one second. Existing original retrieval is at most 40 seconds and save reserve is 10 seconds: at most 171 seconds within the existing 180-second checkpoint lease. No lease or retry-policy change. Bound output and validate schema/page count/image signatures before persistence. Windows host execution returns an actionable error; Docker provides the Linux runtime.

The optional Docker target installs the pinned CLI with pnpm, runs as non-root, and mounts login state separately from `/data`. The regular runtime remains available. No credentials enter images or story backups.

## Tasks

- [x] First SS feasibility probe: verify an installable pinned CLI, ChatGPT-only auth, structured text and native image bytes under the restricted tool configuration.
- [x] Add provider selection, shared contracts, runner, generator, safe readiness/errors, first-scene references and checked original-source retrieval.
- [x] Add subprocess/transport tests for auth, tool configuration, environment, validation, timeout/output cap, cleanup, provider routing and pnpm login helpers. Preserve checkpoint/retry regression coverage.
- [x] Add optional Docker runtime/login mount, environment examples and English pnpm setup documentation.
- [x] Finish full tests/typecheck/lint/build and Docker runtime/mount verification; independent CR.

## Architecture review and feasibility evidence

AR rounds 1–2 resolved credential/tool isolation and aggregate deadlines. AR round 3 approved the verified native image execution-host configuration.

AR passed: no blocking architecture flaws.
AR risk: non-low — execution-host access, credentials and checkpoint concurrency.
AR review round: 3; reviewer: reused (migration_review).

Official documentation: [auth](https://learn.chatgpt.com/docs/auth), [app-server](https://learn.chatgpt.com/docs/app-server), [image generation](https://learn.chatgpt.com/docs/image-generation). API-key provisioning does not apply to the requested subscription authentication.

Pinned CLI 0.165.0: ChatGPT auth and structured output passed. A minimal live image job returned a native image result with 2,729,780 base64 characters; no image bytes or credentials were printed. Six inherited MCP servers were disabled and exposed zero tools. A dummy model request to read a sibling file reported that command tools were unavailable. Standalone command positive/negative controls both exited 134: inconclusive, not read-denial evidence. A separate live smoke using the implemented runner confirmed subscription auth and structured text. Full story generation remains simulated; Docker sign-in/inference requires the user's own login.

## Implementation and verification

Milestone `f60ebec` contains the implementation, tests and setup documentation.

CR passed: no major findings.
CR risk: non-low — subprocess execution, subscription credentials, provider routing and Docker deployment.
CR review round: 1; reviewer: reused (migration_review).

TT: Node 24.22.1 / pnpm 11.25.0, all 74 tests passed. Typecheck, lint, production build and diff whitespace checks passed. Test output: ignored `.data/codex-tests.log`; build output: ignored `.data/codex-build.log`. Full tests required localhost listeners outside the sandbox; the rerun passed. The subsequent login-message wording change is covered by final typecheck/lint and the Docker production rebuild.

ET: subprocess/REST scenarios cover both providers, sign-in failure, native image/reference payloads, validation, output cap, process failure/timeout/cleanup and credential filtering. Existing retry/concurrency and source-verification suites passed. `pnpm run codex:status` found the existing ChatGPT login locally. The implemented runner live smoke passed subscription auth and structured text; earlier bounded native image capability was verified separately. No complete live story or Docker-authenticated inference was claimed.

Docker: the optional image built with CLI 0.165.0. CLI and pnpm status ran offline as UID 1000; an empty login correctly returned Not logged in (exit 1). A no-network app container with isolated `/data` and `/codex-home` mounts returned unconfigured Codex status with CHATGPT_LOGIN_REQUIRED while the seeded sample remained readable. Merged Compose config selected runtime-codex and kept both bind mounts create_host_path=false. QA container removed. Initial pnpm runtime checks exposed unreadable root-store symlinks and missing lock/workspace metadata; both were fixed and the final image passed. Docker output: ignored `.data/codex-docker-build.log`.

## Acceptance review

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
