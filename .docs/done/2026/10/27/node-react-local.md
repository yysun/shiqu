# Node and React local edition

The local Docker edition now runs React/Vite and a Node REST server directly. SQLite and media live in a normal host-mounted directory. Cloudflare runtime dependencies and hosted-template scaffolding are removed. The offline importer preserves old data without requiring the old runtime.

Implementation commit: 32b764d on feat/node-react-local. Original checkpoint: 578ab9e on main.

Verification: 61 tests, typecheck, lint and production build pass. Final Docker image ran non-root with a bind path containing spaces; restart/recreate and copied-folder restore retained progress and uploads. In-app browser reading, source, settings, deep links and PDF passed. Provider calls were mocked. Sites requires a separate deployment adapter.

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
