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
- [ ] Run applicable tests, typecheck, lint and production build; run API integration scenarios, real Docker bind/restart scenarios, and browser reader checks. Fix relevant failures.

## Verification and risks
Use .docs/tests/test-node-react-local.md. Unit/integration coverage includes atomic migrations, JSON SQL/checkpoint locks, filesystem traversal/metadata, request identity and origin protections, SPA fallback, multipart/media, error boundaries, import records/blobs and restart retention. Browser checks cover sample reading, deep-link refresh, settings/source/PDF and deletion/restore. No live provider charge.

Storage conversion and host permissions are the main rollout risks. Preserve the source volume; import only into an empty new target and switch mounts after successful verification. Keep existing owner ID docker-local-owner so existing progress remains visible. Server and frontend must never serve environment or SQLite files.

## Review and evidence
AR passed: no blocking architecture flaws. AR risk: non-low — runtime, persistence, identity and Docker deployment. AR review round: 1; reviewer: new (migration_review). SS milestone commits recorded here after completion. Tests/builds have not yet run in this worktree.

First SS probe: Node 24.22.1 DatabaseSync.setReturnArrays and Drizzle 0.45.2 sqlite-proxy run/values succeeded. Existing Vite/React packages support the client shell. Read-only legacy inspection confirmed D1 d1_migrations and R2 _mf_objects plus named-bucket blobs. Import must reject multipart until implemented and record imported migration history.

Implementation evidence: 61 tests pass, typecheck and lint pass; frontend/server build passes. Docker image shiqu:node-migration built and started as UID/GID 1000:1000 using a host bind path containing spaces. Sample and media requests pass; progress persists across docker compose down/up. In-app browser verified reading, next-page navigation, original text, settings, PDF download, deep-link reload and loaded images. Phone viewport DOM width390 has no horizontal overflow. Browser errors/warnings empty. Final image rebuild and independent CR/VR pending.
