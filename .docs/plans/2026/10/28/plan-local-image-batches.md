# Local image batches

Story base: `8664547`.

Implement three-page demand in the React hook and one bounded parallel batch per Node engine advance. Keep the existing lock token until all calls settle. Record each success in the in-memory document and enqueue an immutable document snapshot for sequential persistence under that token. A failed checkpoint stops later checkpoint writes; after all calls settle, the existing final save persists all paid results and marks failure. Deletion must not invalidate paid-result persistence, while visible reads remain owner scoped. No schema changes. Both provider image calls already use a 120-second deadline, within the existing 180-second session lock.

Use a progress fingerprint containing stage and ready-image count for the client timeout, so a later image finishing before the first missing image still counts as progress. Retain existing retry budgets and provider selection.

- [x] Add the shared batch size and target calculation; update the React hook and client inactivity tracking.
- [x] Add token-guarded intermediate snapshots and bounded provider-independent image concurrency, with first-image anchoring and settled-result recovery.
- [x] Test real local SQLite and both selected providers at the REST/client boundary, covering batch sizes, overlaps, reference use, partial failures, retries, deletion, cancellation, checkpoint failures, and progress timeout.
- [x] Document the behavior and run focused tests, full tests, typecheck, and production build on Node 24.22.1 / pnpm 11.25.0.

Integration scenarios: `.docs/tests/test-local-image-batches.md`. Provider completions are controlled promises; no live paid generation. Rollback is code-only. Preserve existing original-source storage, Codex isolation and provider routing, file media, deletion restoration, and single-scene API requests.

AR passed: no blocking architecture flaws.
AR risk: non-low — changes paid-call concurrency and durable checkpoints.
AR review round: 1; reviewer: new.

Implementation milestone: `cce60cf` (parent/story base `8664547`), independently implemented; no commit from main was cherry-picked. Focused validation at the milestone: 11 feature tests, 35 existing generation tests, typecheck and lint passed.

CR passed: no major findings.
CR risk: non-low — paid-call concurrency and durable checkpoints.
CR review round: 1; reviewer: reused.
Independent review covered the entire story diff, both provider adapters, token ownership, queued snapshots, final save, deletion, retries and client progress.

Final verification: Node 24.22.1, pnpm 11.25.0. `pnpm test`: 85/85 passed. `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`, and diff whitespace checks passed. All five `.docs/tests/test-local-image-batches.md` flows are covered by the 11 deterministic integration tests. Gemini transport and Codex runner return controlled results; real SQLite and file media are used. No paid provider generation or browser UI verification was performed.

VR passed: all acceptance criteria complete.
