# Node and React local edition

The Docker edition should run directly on Node, without carrying a local Cloudflare emulation platform. Keep the reader experience and paid-generation safeguards while making persistent data visible in an ordinary host folder.

## Acceptance criteria
- [ ] React builds with Vite; Node serves the REST API, media, and SPA routes in one production process. Next, Vinext, Wrangler, workerd and Cloudflare packages/configuration are removed from active source and lockfile.
- [ ] SQLite and filesystem media replace D1/R2. Existing schema, API URLs, single local owner, progress, deletion, generation checkpoints, cooldowns and retries remain compatible.
- [ ] Docker Compose bind-mounts ./data by default and accepts a configurable host data directory. First run initializes safely, repeat startup keeps data, and Linux host ownership is documented and configurable.
- [ ] A Cloudflare-free import command migrates a stopped legacy local data directory into a new empty directory without modifying the source; database records, media keys and owner IDs survive. Failed imports cannot appear complete.
- [ ] Dev startup, tests, typecheck, frontend/server production build, real Docker startup/restart and in-app browser reader flows pass. Provider calls use mocks; real Gemini billing is outside verification.
- [ ] README and environment examples explain startup, host mounting, backup, legacy import, and the single-user localhost boundary.

## Constraints and non-goals
Preserve the checkpoint at 578ab9e and the original checkout. No new auth, hosting service, queue, worker-thread pool, UI redesign, provider migration or database engine change. Keep secrets outside image and frontend bundles. Do not automatically retry paid calls on restart. Existing user data is never migrated in place.
