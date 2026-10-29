# Dongguo demo flows (historical)

> Historical record — superseded by the [empty-library delivery](../done/2026/10/29/empty-library.md).
> Bundled demos and automatic story seeding were removed in `e404837`; the remaining admin-seed fix is committed in `6ebd117`. The completed criteria and verification below describe the earlier Dongguo milestone, not the current product. Existing saved stories remain supported.

The following scenarios were executed against the earlier demo implementation. They are retained as evidence, not as the current runnable E2E specification. Current flows are in [test-empty-library.md](test-empty-library.md).

1. Fresh SQLite and admin seed: new东郭先生 story is published with30 existing captions/images, 中山狼传 author/source, exact pinned original, matching application seed and all bundled assets. Reader/admin promoted cover opens this story, never old种梨.
2. Existing library with modified种梨 and a previously edited东郭 row: reseed/reopen keeps their source, title, progress and media untouched. Missing new sample inserts without deleting historical rows. Catalog stays24.
3. Read all30demo frames and original/source explanation; the narrative includes杏树、老牛、丈人、再囊 and original狼被杀结尾; all story text and every image hash match the completed desktop story, and no blank frames occur. No generated replacement asset is referenced. PDF/PNG export readiness passes without paid generation.
4. Actual in-app desktop preview if enabled: sample card, opening, paging and end return show new identity/art. If host disables browser, record exact limitation and use router/media/seed integration plus UI-source assertions; do not substitute another browser session.

5. Save page29 through ordinary me/progress, reopen and resume it, and POST a complete event atpage29. Reject page30 for this30-frame story and page60 globally; maintain hidden-story/status checks. No generation call occurs.

Execution2026-10-29: scenarios1/2/5 pass via fresh/reopened SQLite/admin-seed/progress/event tests; content and all30image hashes match source snapshot. Scenario3 passes via content/source/asset assertions, PNG30-cell ordering/readiness and PDF source/readiness checks plus actual all30-frame in-app paging. Scenario4 passes for Reader home card, original panel, ending and reload/resume at page30; Vite desktop launcher smoke also passes (isolated shelf intentionally empty, ordinary demo is Reader content). Admin component has no mounted route, so its sample presentation is source/typecheck validated; admin seed is integration tested. Full284tests passed; focused18passed after attribution fixes; typecheck/lint passed. No paid generation or packaging invoked.
