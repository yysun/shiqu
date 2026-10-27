# Node and React local migration

Story base: 578ab9e. Worktree: /Users/esun/.codex/worktrees/node-react-migration/shiqu-docker. Branch: feat/node-react-local.

## Architecture
Keep UI components, shared models and generation engine. client/ owns the React entry, styles and reader UI; lib/ retains application logic; db/ retains schema; server/ owns config, Node HTTP, SQLite and media adapters. Application routes receive explicit services instead of importing runtime globals. Preserve Fetch Request/Response handlers through a bounded Node HTTP bridge rather than rewriting API behavior.

Use built-in node:sqlite with the pinned Drizzle sqlite-proxy driver callback (in-process, no HTTP SQL endpoint). ReaderRepository already accepts a small SQL interface. WAL, busy timeout and transactional migration tracking support persisted local data. Filesystem media uses validated relative keys and atomic writes with content metadata. Node serves static public assets plus the compiled SPA; /api and missing files do not fall through to HTML.

Bind ./data:/data by default, configured by SHIQU_HOST_DATA_DIR, with container UID/GID configurable for Linux and non-root default. Legacy import reads copied SQLite databases and Miniflare R2 metadata/blob files offline, remaps into normal media keys, and stages output before atomic publication. No dependency on Wrangler is retained.

## Tasks
- [x] First SS feasibility probe: verify Node 24 sqlite array-return support, pinned Drizzle proxy result semantics, Vite client build dependencies, and the actual legacy D1/R2 disk schema read-only. If the adapters cannot preserve queries or legacy keys, revise this plan before continuing.
- [x] Implement explicit application services, local SQLite migrations/seeding and media storage; preserve route contracts and local-owner enforcement. Add focused persistence, security-boundary and paid-call concurrency regression coverage.
- [x] Replace the Next/Vinext shell with client React/Vite; add Node API/static server, dev proxy startup, and production build/start scripts. Remove unused hosted/Sites scaffolding and Cloudflare dependencies/types/configs.
- [x] Implement tested legacy importer with source preservation, complete output validation, failure cleanup and existing-target refusal.
- [x] Replace Docker runtime and Compose volumes with configurable host bind mount. Document directory layout, UID/GID, backup/restore and legacy import.
- [x] Run applicable tests, typecheck, lint and production build; run API integration scenarios, real Docker bind/restart scenarios, and browser reader checks. Fix relevant failures.

## Verification and risks
Use .docs/tests/test-node-react-local.md. Unit/integration coverage includes atomic migrations, JSON SQL/checkpoint locks, filesystem traversal/metadata, request identity and origin protections, SPA fallback, multipart/media, error boundaries, import records/blobs and restart retention. Browser checks cover sample reading, deep-link refresh, settings/source/PDF and deletion/restore. No live provider charge.

Storage conversion and host permissions are the main rollout risks. Preserve the source volume; import only into an empty new target and switch mounts after successful verification. Keep existing owner ID docker-local-owner so existing progress remains visible. Server and frontend must never serve environment or SQLite files.

## Review and evidence
AR passed: no blocking architecture flaws. AR risk: non-low — runtime, persistence, identity and Docker deployment. AR review round: 1; reviewer: new (migration_review). SS milestone commits recorded here after completion. Verification evidence is recorded below.

First SS probe: Node 24.22.1 DatabaseSync.setReturnArrays and Drizzle 0.45.2 sqlite-proxy run/values succeeded. Existing Vite/React packages support the client shell. Read-only legacy inspection confirmed D1 d1_migrations and R2 _mf_objects plus named-bucket blobs. Import must reject multipart until implemented and record imported migration history.

Implementation evidence: 61 tests pass, typecheck and lint pass; frontend/server build passes. Docker image shiqu:node-migration built and started as UID/GID 1000:1000 using a host bind path containing spaces. Sample and media requests pass; progress persists across docker compose down/up. In-app browser verified reading, next-page navigation, original text, settings, PDF download, deep-link reload and loaded images. Phone viewport DOM width390 has no horizontal overflow. Browser errors/warnings empty. Final rebuild completed; CR passed; VR passed.


SS milestone: 32b764d — application, importer, Docker, frontend and documentation implementation. Source base remains 578ab9e.

CR passed: no major findings.
CR risk: non-low — runtime, persistence, local identity and Docker deployment.
CR review round: 1; reviewer: reused (migration_review).

TT: all 61 Node unit/integration tests passed, no skips; typecheck and lint passed. Production build passed with Node 24.22.1 / pnpm 11.25.0. Drizzle retains optional Cloudflare type peer declarations in package metadata, but no Cloudflare package is resolved or installed.

ET: .docs/tests/test-node-react-local.md completed with combined integration, actual Docker and in-app browser evidence:
1. Fresh SQLite initialization/sample reading and no-key status pass in tests and actual Docker; sample static PNG has correct MIME.
2. Progress, soft deletion/restore, generated checkpoint/source and filesystem bytes persist in real SQLite restart tests; sample progress and uploaded PNG survive Docker restart and container removal/recreation.
3. Mocked Gemini requests through real REST handlers/SQLite acquire one checkpoint under concurrent advances; existing paid retry/cooldown/stale recovery suite passes. No real provider call.
4. Origin/owner, path privacy, missing API/assets, multipart uploads, MIME, 14 MiB payload rejection and SPA deep links pass HTTP integration; same-origin writes also pass through Vite dev proxy.
5. Legacy real-layout fixtures import without source-byte changes; migration replay prevented; existing target/live WAL/missing blob/multipart fail with no successful output. No user volume changed.
6. Default Compose resolves to checkout ./data bind. Actual final image sha256:1e4ba9284373139945a56e3f9d774d7c9a671eba04da59ac7ff2e315690f8c13 runs as 1000:1000 with host path .data/docker bind check, reports healthy, and has no cloudflare/workerd/wrangler/vinext package directories. Stop/copy/start of a second restored folder retained progress and media; restore QA container removed. Docker Desktop on macOS with Linux arm64 containers; Linux-host UID/GID instructions are documented rather than claimed as separately host-tested.
7. In-app browser at http://localhost:3217 verified sample, turn page, original sheet, settings, PDF download to Downloads, home/deep-link refresh and loaded images. Browser error/warning logs empty. At explicit 390x844 viewport document width remained390; restored normal viewport. Screenshot: .data/reader-qa.png.

Dev evidence: pnpm dev --port3218 started Vite3218/API3002 with separate .data/dev directory, returned sample and accepted same-origin progress writes. SIGTERM to the dev supervisor stopped both ports; no orphan API server. The original checkout/port3000 were not changed.

Verification limitations: no real Gemini billing call, no Sites deployment, no Windows or Linux-host UI run. The product remains a local single-user edition. Runtime QA container at3217 retained for the preview; test data is isolated under this worktree .data.

CLI import also passed via pnpm import:legacy and via final Docker image with /legacy mounted read-only and an output path containing spaces.

VR passed: all acceptance criteria complete.

VR risk: non-low — runtime, persistence, local identity, and Docker deployment change.

VR review round: 1; reviewer: reused.

1. **React/Vite and Node runtime — complete.** The client and server build separately; one Node process serves REST, media, and SPA routes. Next/Vinext/Workers entry points and resolved Cloudflare runtime dependencies are removed. Final image inspection confirms no Cloudflare runtime packages. Drizzle’s optional peer declarations do not install a dependency.

2. **Storage and behavior compatibility — complete.** SQLite schema and filesystem adapters preserve API URLs, `docker-local-owner`, progress, deletion/restore, generation checkpoints, lock acquisition, retry cooldowns, and manual recovery. The 61 passing tests include real SQLite restart and concurrent REST generation coverage.

3. **Docker bind mounting — complete.** Compose defaults to `./data`, supports `SHIQU_HOST_DATA_DIR`, and exposes UID/GID configuration. The final image ran non-root with a host path containing spaces; progress and media survived container removal/recreation and backup/restore.

4. **Legacy import — complete.** The importer snapshots source databases without opening them in place, reconciles migration history, copies media by original key, validates references, and publishes staged output atomically. Tests establish unchanged source bytes, retained records/identity/media, prevention of migration replay, and failed-import cleanup.

5. **Verification — complete.** Tests, typecheck, lint, production build, final Docker image, dev startup/same-origin writes/shutdown, and in-app browser reading/source/settings/PDF/deep-link flows passed. Verification used simulated provider responses.

6. **Operating documentation — complete.** README and environment examples cover startup, host mounts, directory layout, permissions, backup/restore, legacy import, and the localhost single-user boundary.

All plan tasks have supporting evidence. No concrete unmet requirement remains. Recorded limitations are appropriate: no paid Gemini verification and no separate Windows or Linux-host UI run.
