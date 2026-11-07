# Test triggers and cost

The registry is `tests/manifest.json`; `scripts/test-plan.mjs` owns responsibility matching and unions. PR CI and local agents use the same planner. Explicit `covers` paths add direct consumers across domains; a maintainer AST check rejects undeclared production imports. Routine change checks and PRs run source checks. Playwright runs through explicit E2E or full qualification.

## Commands for agents

```bash
pnpm test:changed --plan
pnpm test:changed
pnpm typecheck
pnpm lint
```

`test:changed` includes staged, unstaged and untracked paths relative to HEAD. It tests the current working tree. For a shared checkout, inspect the preview and pass every path belonging to the task with `pnpm test:pr --files <paths...>`; concurrent changes remain outside that task. A clean/failed comparison conservatively selects full source coverage. `pnpm test:pr` without explicit paths reads CI scope or a `BASE...HEAD` diff; it does not assume an arbitrary default branch.

Plan output lists files, execution levels, `fast`/`full` modes, deferred Playwright files (`deferredBrowser`) and unsupported-platform exclusions. Full source fallback also defers Playwright. Use `pnpm test:e2e` for browser journeys or `pnpm test:pr --full` for qualification with every supported JS test. Actual runs retain source identity, batch duration, selected files and exits under `.data/test-plans/`. `native: true` means native source checks are also required; the JS runner does not execute Cargo. `AGENTS.md` documents these rules.

Within each mode, source tests run first with at most two files in parallel, then browser E2E files run one at a time in a separate Node process. Vite/Chromium therefore cannot consume the controlled production tests' deadline budget. Every selected file still runs once with its original provider/heavy flags and assertions; a failed batch stops the run. Evidence records each batch's runtime class and concurrency.

## Trigger table

Every PR runs the small integrity smoke. Production changes with domain coverage also run fast contracts and the local-server/queue/state safety set. Registered JS tests select themselves. Stylesheets, test fixtures and test selection inputs with declared consumers select those tests. Direct selections join any domain coverage required by the same change. Selected tests run once with the full flags for affected files; native consumers request native checks.

| Change responsibility | Additional coverage | Native source checks |
| --- | --- | --- |
| Documentation outside runtime/data/test directories | Integrity smoke only | No |
| Registered JS test or explicitly owned stylesheet/test input | Changed tests and declared consumers, plus integrity smoke | Only for declared native consumers |
| Client/public assets and reader helpers | Reader contracts and integration | No |
| Desktop UI and remote/network runtime | Desktop integration | `server/desktop.ts` native consumer and Rust changes: yes |
| CLI startup and invocation | Startup/CLI integration; production entry points also select production/tooling | Shared configuration: yes |
| Saved/shared provider settings and configuration | Startup/provider/desktop integration | macOS + Windows |
| Provider adapter or wire schema/reasoning | Provider contracts and controlled provider production flows | No |
| Bundled books, local source readers/parsers and reading inputs | Full ten-file book suite plus discovery consumers | No |
| Discovery/cache/theme matching | Discovery integration, full book group via reading-plan consumers, and all six extended service E2Es | No |
| Preparation, storyboard review, frame count, queue, generation or book references | Affected responsibility groups; all six extended service E2Es | Storage upgrade boundaries separately |
| Images, publication and export | Media integration and reference consumers | No |
| Library backup/recovery/maintenance/upgrade | Storage/startup integration | macOS + Windows |
| Rust source/configuration and desktop resource/runtime scripts | Native module consumers plus applicable desktop/storage JS | macOS + Windows |
| Shared models/API schemas/prompts, DB schema/migrations, dependencies/Node, unclassified test/build/CI infrastructure, unknown paths or failed/empty comparison | All registered source tests, full flags | macOS + Windows |

Known component path patterns are listed in `scripts/test-plan.mjs`. Direct selection requires exact `covers` entries. For example, `phone-audit.mjs` runs smoke and lists phone readability and desktop layout as deferred. Unclassified runtime files, deleted/unregistered tests and fixtures without declared consumers still broaden to full source coverage. Rename detection uses both old and new paths. Documentation inside `data/`, `tests/`, `skills/` and runtime directories is not automatically exempt.

Core changes retain service E2Es; schema/dependency changes deliberately run full source coverage. Browser journeys remain available at the explicit E2E and full qualification gates.

## Initial rollout comparison

These historical counts are files, not runtime test instances. They compare commit `75a1331d3594edb140b13125d3fd278c12a164a5` with the initial registry rollout, before file-level selection was added. Use the current plan command for current counts. Static checks remain on code PRs.

| Example | Existing PR | New PR JS files | Added behavior |
| --- | --- | ---: | --- |
| README | 1 smoke | 1 | Same smoke policy |
| Client CSS | 86 fast | 82 | Reader browser journeys; skips unrelated process/startup suites |
| `server/claude-runner.ts` | 86 fast + 10 books | 82 | Provider contracts and flows; no full-book scan |
| `server/local-story-discovery.ts` | 86 fast + 10 books | 106 | Discovery consumers and all six extended E2Es |
| `src-tauri/src/runtime.rs` | 86 fast | 82 | Native source tests on macOS/Windows; relevant console journey |
| `lib/system-settings.ts` | 86 fast + 10 books | 97 | Configuration consumers plus macOS/Windows native checks |
| `lib/reader-model.ts` / lockfile / unknown path | 86 fast + 10 books | 172 | Full source qualification and native checks |

Real Git tag-push checks now follow tooling changes, release gates and full qualification; the heavy storage consolidation file follows storage changes. Small local-server refusal/isolation checks remain unconditional for code PRs.

Five adapter contract files were separated from their queued flows. The startup file keeps its pure provider/library precedence matrices; twelve real CLI launch rows now live in `startup-cli-flow.test.mjs`. Original top-level test/matrix statements were compared against the immutable baseline and preserved structurally, with assertions unchanged; a moved comment was translated to Chinese.

## Timing evidence

Local comparisons use disposable snapshots, Node 24.22.1, the same installed dependencies and sequential execution. No desktop preparation, packaging, live models or user libraries are involved. Snapshot source excludes concurrent desktop work. Dependency installation and hosted scheduling are not included. Final source projection matched the candidate for 34 test/CI/agent source files. [Machine-readable measurements](testing-trigger-measurements.json) retain commands/log references and evidence limits.

| Local workload | Before | After | Test-time change |
| --- | ---: | ---: | ---: |
| Fast command | 22.50s, 86 files | 15.71s, 76 files | 30.2% less |
| Provider-adapter PR | 59.47s = fast + 10 books | 26.09s, 82 files | 56.1% less |

The new provider plan adds provider flow coverage while skipping unrelated book and process suites. Fast-command count is now 627 passing runtime cases; the old fast command had 739 passing and one skipped. Cases moved to affected/full suites remain registered, and full qualification retains all 172 JS files.

Illustrative hosted scaling of the fast command alone is roughly **120s → 84s**, or **178s → 142s** including the reported 58s overhead, before extra aggregator-job startup and scheduling. This is an estimate, not a measured new PR duration. Reader/core plans gain browser/service coverage and native changes gain cross-platform checks, so these PRs can take longer.

Full-source execution exercised 1,422 cases in 287.13s: 1,419 passed, with three existing lifecycle fixture/synchronization failures. Those were corrected without production/UI changes; both affected browser files then passed all 11 cases, including the release wrapper and all failed branches. The 24 final routing/ownership/runner guards, 627 fast cases, final provider plan, typecheck/lint and 24 native source tests passed. The sole native filtered test still requires prepared bundle resources and remains in release qualification. A late Vite test collision also reproduced on baseline; its fixture now requests and verifies an isolated port, retaining its API/security assertions. Passing unaffected full-run coverage was reused, rather than repeating all long matrices after fixture-only corrections.

The reported hosted baseline is 7s scope + 12s setup + 18s install + 15s typecheck + 6s lint + 120s fast tests, about **178s before any separately selected book suite**. This implementation does not claim to reduce the first 58s. Local elapsed times cannot be substituted directly into hosted estimates; compare test-phase ratios only as a provisional estimate, then verify a hosted run.

## CI qualification

`Shared checks` aggregates JavaScript and selected native jobs for PRs, main and manual runs. Missing PR scope defaults to full JS and native checks. Main and manual runs qualify the exact current commit with all JS tests. A version tag runs the full JS plan, typecheck and lint in the installed local pre-push hook; tag Actions start at native packaging. Both platforms retain complete Cargo testing and installer smoke before release publication. Manual packaging still requires successful Shared checks. The native PR matrix uses pinned Node/JS dependencies and Rust 1.93.0, disables bundle resources and uses the checked-in desktop HTML entry as compile-time frontend context, excluding only `runtime::tests::desktop_uses_verified_bundle_and_ignores_saved_system_path`. The explicit release smoke and npm gate retain their focused eight/seven files.

Pnpm store caching is retained. Selected browser jobs cache Chromium; native jobs cache Cargo registry/git/build outputs with OS, architecture, Rust version, lockfiles and Node in the key. These caches do not contain user libraries or credentials. Windows behavior and GitHub scheduling require hosted validation; local macOS evidence does not claim otherwise.
