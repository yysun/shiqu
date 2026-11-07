# Test scenario inventory and run-policy map

Inventory date: 2026-11-05. Source base: `75a1331d3594edb140b13125d3fd278c12a164a5` plus impact-routing changes. Derived AST inventory; this does not renew historical QA results. Concurrent desktop work and its untracked specifications are excluded.

## Counts and ownership

- 172 JavaScript files: 156 regressions and 16 E2Es; six browser files, ten service/process/engine files.
- 1,128 scenario declarations/templates, including 120 matrix definitions. Runtime expansion is counted separately by Node.
- 26 native test functions across four explicitly registered Rust modules; conditional platform functions remain visible.
- 77 committed/current-story legacy acceptance specs and 7 managed lifecycle cases; these overlap automated coverage and are not added to executable totals.
- `tests/manifest.json` owns domain, execution level, cost, platform, suite, PR policy and gate membership. Missing/invalid registrations fail before execution. Test source markers do not choose suites.
- Every supported JS file belongs to full qualification, including the release browser wrapper. Release/npm gates retain eight/seven files. Unsupported platforms are listed in the PR execution receipt.

## Implemented execution policy

See [trigger rules and timing comparison](testing-triggers.md) and [developer commands](development.md). While iterating, `pnpm test:related` runs only direct importers, path-literal references and `covers` consumers of the changed paths with fast flags; it is not an impact check. A single file also runs directly with `node --test tests/<file>`. Before handoff, `pnpm test:changed` applies the CI impact planner to staged, unstaged and untracked changes; use `--plan` to preview. Shared checkouts can pass explicit task paths with `pnpm test:pr --files ...`.

| Entry | Registered files | Policy |
| --- | ---: | --- |
| `pnpm test` | 76 | Explicit suite; per-case fast/full switches remain available. |
| `pnpm test:flows` | 70 | Explicit suite; per-case fast/full switches remain available. |
| `pnpm test:books` | 10 | Explicit suite; per-case fast/full switches remain available. |
| `pnpm test:e2e` | 18 | Explicit gate membership; full flags. |
| `pnpm test:e2e:extended` | 6 | Explicit gate membership; full flags. |
| `pnpm test:e2e --gate=release` | 8 | Standalone release smoke; full flags. |
| `npm gate` | 7 | Explicit gate membership; full flags. |
| `pnpm test:full` / main and manual CI / local tag gate | All supported JS | Every file once with full flags. Tag CI runs native tests and installer smoke checks. |
| Code PR | Impact union | Small contracts and local-server/queue/state guards plus affected full-mode files. |
| Documentation PR | 1 | Integrity smoke. |

## Responsibility groups

Counts below use the first declared domain to avoid double-counting files; additional domains remain listed for each file.

| Domain | JS files | Declarations |
| --- | ---: | ---: |
| `safety` | 4 | 18 |
| `books` | 12 | 65 |
| `discovery` | 21 | 173 |
| `preparation` | 10 | 63 |
| `review` | 16 | 87 |
| `production` | 23 | 244 |
| `reader` | 26 | 178 |
| `storage` | 7 | 43 |
| `startup` | 10 | 67 |
| `providers` | 21 | 76 |
| `media` | 8 | 50 |
| `desktop` | 7 | 36 |
| `tooling` | 7 | 28 |

## Automated scenarios

### safety

#### tests/book-integrity-smoke.test.mjs

[tests/book-integrity-smoke.test.mjs](../tests/book-integrity-smoke.test.mjs) — 4 declarations.

Domains: safety; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `always`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 20 | integrity smoke: production loader preserves bytes and resolves a valid source |   |
| 25 | integrity smoke: changed bytes and missing originals fail closed |   |
| 30 | integrity smoke: an original outside the library is rejected even with the correct hash |   |
| 34 | integrity smoke: stale, missing, reversed and unreadable citations are rejected |   |

#### tests/ci-scope.test.mjs

[tests/ci-scope.test.mjs](../tests/ci-scope.test.mjs) — 7 declarations.

Domains: safety; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 15 | documentation keeps smoke; every code PR keeps contracts and local-server boundaries |   |
| 23 | affected areas include their flows, heavy flags and all six service E2Es for core changes |   |
| 36 | native and shared settings request native checks; unknown/schema/toolchain changes fail closed |   |
| 43 | mixed changes are a union; changed tests select owners and supported platforms are explicit |   |
| 51 | real merge-base diffs retain deleted rename paths and output a reusable plan input |   |
| 66 | workflow event gates qualify main/tags and aggregate selected JS/native failures |   |
| 85 | generation client helpers retain direct integration consumers and core service E2Es |   |

#### tests/test-pr.test.mjs

[tests/test-pr.test.mjs](../tests/test-pr.test.mjs) — 4 declarations.

Domains: safety, tooling; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 13 | PR executor runs files once with isolated fast/full flags and records a failing batch |   |
| 26 | local changed mode includes staged, unstaged, untracked and both rename paths |   |
| 37 | CI input parses valid scope and malformed values fail closed; full selection includes all supported JS |   |
| 45 | source identity changes for migrations, books, assets, lockfiles and unknown inputs |   |

#### tests/test-tiers.test.mjs

[tests/test-tiers.test.mjs](../tests/test-tiers.test.mjs) — 3 declarations.

Domains: safety; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 12 | metadata partitions all regressions, owns every E2E/native module and preserves safety checks |   |
| 28 | metadata ignores fixture-looking source text and rejects missing, duplicate and invalid ownership |   |
| 45 | explicit source ownership retains every direct production import consumer with full flags |   |

### books

#### tests/book-reading-plans.test.mjs

[tests/book-reading-plans.test.mjs](../tests/book-reading-plans.test.mjs) — 3 declarations.

Domains: books; level: `integration`; cost: `heavy`; platforms: darwin, linux, win32; suite: `books`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 16 | fixed books retain exhaustive bounded blocks and meet provider-neutral size targets |   |
| 23 | all 1129 Shishuo units are covered in at most 60 calls; 1072 eligible stories saved once and 57 rejects accounted |  books |
| 31 | v3 migration maps the proven frontier, rereads only its containing new block, and preserves old bytes |   |

#### tests/book-reference-star.e2e.mjs

[tests/book-reference-star.e2e.mjs](../tests/book-reference-star.e2e.mjs) — 6 declarations.

Domains: books, media, review; level: `service-e2e`; cost: `standard`; platforms: darwin, linux, win32; suite: `e2e`; PR: `affected`; gates: extended. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 11 | in-flight references stay fixed; new calls use replacement and cancellation restores own anchor without redrawing |   |
| 24 | no-star defaults and other-book isolation remain first-frame empty then own-first reference |   |
| 29 | restart keeps the selected bytes and legacy advance uses the same book reference |   |
| 34 | a valid book reference can serve a later frame without loading its unused missing first-image file |   |
| 40 | missing snapshot blocks the model but cancellation is still possible |   |
| 45 | current stories may reference previously uploaded local pictures; deleted sources cannot |   |

#### tests/book-reference-star.test.mjs

[tests/book-reference-star.test.mjs](../tests/book-reference-star.test.mjs) — 8 declarations.

Domains: books, media, review; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 11 | stars replace across stories, cancel with tokens, survive restart, and never alter story checkpoints |   |
| 23 | concurrent selection stays unique and source deletion clears it without restore resurrection |   |
| 31 | strict local-media and owner validation leaves an existing star unchanged |   |
| 39 | a deletion during media loading cannot resurrect a source selection |   |
| 46 | snapshots stay immutable, normalize known custom book names, and fail before paid use if lost |   |
| 57 | `${provider}: first and later frames attach the resolved reference and reject another story namespace` | for(const provider of ['codex','gemini','openai'])test(`${provider}: first and later frames attach the resolved reference and reject another story namespace`,async()=&gt;{  |
| 69 | star control renders distinct accessible states |   |
| 76 | page changes ignore late reads/saves and keep the write lock until authoritative reload |   |

#### tests/clean-three-originals.test.mjs

[tests/clean-three-originals.test.mjs](../tests/clean-three-originals.test.mjs) — 7 declarations.

Domains: books; level: `integration`; cost: `heavy`; platforms: darwin, linux, win32; suite: `books`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 12 | three collections pin every original byte and cover all sections with declared anomaly handling |  books |
| 25 | all Wiki reading glyphs and small annotations survive packaging in source order |  books |
| 42 | Youyang replacement contains main20 and continuation10 with independent immutable Wiki citations |  books |
| 49 | Shiji ten tables retain every empty cell and its source text, all row/column anchors and span relationships |  books |
| 75 | table layout labels and empty rows cannot independently authorize a storyboard |   |
| 82 | Wiki headings cannot independently authorize a narrative receipt |   |
| 87 | missing, swapped, tampered or escaped originals fail closed |   |

#### tests/erke-unified.test.mjs

[tests/erke-unified.test.mjs](../tests/erke-unified.test.mjs) — 3 declarations.

Domains: books; level: `integration`; cost: `heavy`; platforms: darwin, linux, win32; suite: `books`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 16 | forty Wiki volumes retain every parsed body glyph and the complete nine-act finale |  books |
| 31 | final-play receipts resolve exact Wiki glyphs and reject old editions or invalid ranges |   |
| 38 | missing, damaged, reordered or escaped original collections fail closed |   |

#### tests/licensed-books.test.mjs

[tests/licensed-books.test.mjs](../tests/licensed-books.test.mjs) — 5 declarations.

Domains: books; level: `integration`; cost: `heavy`; platforms: darwin, linux, win32; suite: `books`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 10 | all17 uncertain editions are replaced and seven retained collections keep original bytes with explicit errata versions |  books |
| 25 | Kanripo edition and chapter identities reject mismatches, and first/final chapters keep actual prose |   |
| 40 | same-source narrative appendices preserve coverage and numbered chapter identities |  books |
| 45 | replacement collections reject changed identities, extra files and a truncated final play even with refreshed manifest hashes |   |
| 56 | the former demo source uses the selected library edition without a hardcoded fallback |   |

#### tests/local-book-corrections.test.mjs

[tests/local-book-corrections.test.mjs](../tests/local-book-corrections.test.mjs) — 2 declarations.

Domains: books; level: `integration`; cost: `heavy`; platforms: darwin, linux, win32; suite: `books`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 12 | only two missing characters change, with unit-level provenance and a stable derived edition |  books |
| 35 | corrected and historical matching originals pass the production gate, mismatched ones fail |   |

#### tests/local-books.test.mjs

[tests/local-books.test.mjs](../tests/local-books.test.mjs) — 13 declarations.

Domains: books; level: `integration`; cost: `heavy`; platforms: darwin, linux, win32; suite: `books`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 31 | only original downloads are versioned, preserve their bytes and have matching receipts |   |
| 43 | the two whole-book inputs contain every parsed body unit, including the final passages |  books |
| 54 | range verification rejects stale, cross-book, reversed, multi-anecdote and unreadable refs |   |
| 63 | direct whole-book choices preserve labels and reject duplicate and invalid receipts |   |
| 73 | both providers directly select from the full original and only verified passages reach planning |   |
| 87 | token-based chapter manifests cover all shipped units without splitting small chapters |  books |
| 94 | cross-chapter references preserve both original ranges, reject tampering, and allow complete long stories |   |
| 102 | verified original reaches SQLite and media before a paid plan, and survives plan failure/retry |   |
| 110 | storage failures or missing local receipts cannot issue paid storyboard requests |   |
| 118 | storyboard directory and batch calls both verify local source receipts before inference |   |
| 130 | ending, review, structural and local repair require the same verified local original as planning |   |
| 140 | explicit legacy backfill uses a local chapter and does not plan, draw, or fetch a public source |   |
| 147 | local recommendation persists the exact original before inference and rejects tampered receipts or source anomalies |   |

#### tests/local-library-all-books.test.mjs

[tests/local-library-all-books.test.mjs](../tests/local-library-all-books.test.mjs) — 4 declarations.

Domains: books; level: `integration`; cost: `heavy`; platforms: darwin, linux, win32; suite: `books`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 30 | all 24 catalogs load verified originals with complete chapters and exhaustive bounded inputs |  books |
| 49 | all catalogs use originals without cross-source supplements; Erke final play has a pinned Wiki source |  books |
| 55 | original corruption and unreadable source ranges fail closed |   |
| 60 | all 24 books complete HTTP selection and persist original glyphs before storyboard generation |  books |

#### tests/local-source-quality.test.mjs

[tests/local-source-quality.test.mjs](../tests/local-source-quality.test.mjs) — 6 declarations.

Domains: books; level: `integration`; cost: `heavy`; platforms: darwin, linux, win32; suite: `books`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 9 | known unresolved source encodings and explicit omissions are rejected without normalizing text |   |
| 15 | saved cross-chapter evidence applies reviewed exceptions to its own chapter and rejects tampered parts |   |
| 27 | retained historical source leaks and current omissions fail closed |   |
| 34 | every shipped book applies the same text and chapter-title rules, preserving rare real glyphs |  books |
| 44 | candidates, direct preparation and legacy backfill share qualification and never persist a rejected source |   |
| 52 | damaged saved originals cannot call a new plan; readable historical receipts retry without reloading new editions |   |

#### tests/priority-wiki-originals.test.mjs

[tests/priority-wiki-originals.test.mjs](../tests/priority-wiki-originals.test.mjs) — 5 declarations.

Domains: books; level: `integration`; cost: `heavy`; platforms: darwin, linux, win32; suite: `books`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 10 | legacy numeric chapter labels still locate the pinned original, and every reading path carries the same exception policy |   |
| 16 | all 120/40 chapters preserve every reading glyph, source heading and final verse from pinned originals |  books |
| 30 | only the two reviewed edition/chapter/context combinations authorize unchanged anomalous source text |   |
| 41 | page identities, chapter sequence, index order and pinned revision cannot drift |   |
| 50 | missing, altered, extra and escaped original members fail before a book is exposed |   |

#### tests/taiping-wyg.test.mjs

[tests/taiping-wyg.test.mjs](../tests/taiping-wyg.test.mjs) — 3 declarations.

Domains: books; level: `integration`; cost: `heavy`; platforms: darwin, linux, win32; suite: `books`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 17 | 500 original WYG volumes preserve all narrative lines, glyphs and final volume in bounded reading |  books |
| 37 | unpunctuated originals resolve exactly; titles, stale editions and invalid ranges fail |   |
| 46 | missing, damaged, extra and escaped collection members cannot load |   |

### discovery

#### tests/chapter-main-stories.test.mjs

[tests/chapter-main-stories.test.mjs](../tests/chapter-main-stories.test.mjs) — 5 declarations.

Domains: discovery; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 21 | `${name}: three selected Gaotaiwei chapters offer the whole campaign before individual defeats` | for(const name of ['codex','gemini'])test(`${name}: three selected Gaotaiwei chapters offer the whole campaign before individual defeats`,async()=&gt;{  |
| 52 | `${name}: chapter thirty offers Guandu before Xuyou and Wuchao, retaining both after restart` | for(const name of ['codex','gemini'])test(`${name}: chapter thirty offers Guandu before Xuyou and Wuchao, retaining both after restart`,async()=&gt;{  |
| 102 | nested complete events may share background while renamed exact ranges remain rejected |   |
| 110 | a main event spanning reading blocks keeps its earlier original available for episodes |   |
| 128 | chapter scopes do not reuse old flat or block-local main-story caches |   |

#### tests/continuous-story-discovery.test.mjs

[tests/continuous-story-discovery.test.mjs](../tests/continuous-story-discovery.test.mjs) — 5 declarations.

Domains: discovery; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 11 | Codex, Gemini and OpenAI custom-book adapters receive a one-story request and bound the returned batch |   |
| 33 | each saved story appears before the next completes; choosing fences the late result and automatic restart |   |
| 53 | leaving stops continuation; reopening retains stories and finds the next one; empty results stop automatically |   |
| 67 | one viewer leaving preserves another; the last viewer and expired leases stop paid discovery |   |
| 81 | automatic more cannot race past a chosen story at the SQL write fence |   |

#### tests/discovery-conditions.test.mjs

[tests/discovery-conditions.test.mjs](../tests/discovery-conditions.test.mjs) — 5 declarations.

Domains: discovery; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 17 | discovery edits keep the task identity, shelf count and settings while validating source receipts |   |
| 29 | discovery edits reject forged source receipts without altering the saved task |   |
| 35 | discovery edit replay and competing updates cannot create duplicates or overwrite a newer edit |   |
| 45 | late extraction results and stale candidate choices cannot reappear after discovery conditions change |   |
| 55 | conditions cannot replace a story that has already been selected |   |

#### tests/editable-extraction-title.test.mjs

[tests/editable-extraction-title.test.mjs](../tests/editable-extraction-title.test.mjs) — 5 declarations.

Domains: discovery; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 8 | changing the extraction title fences a late old result and persists the new query exactly once |   |
| 35 | query changes preserve canonical source scope, theme and paused control without buying work |   |
| 49 | selected, preparing and confirmed stories reject a direct title reset |   |
| 63 | reselection drafts share title search and cancellation leaves the original version unchanged |   |
| 76 | title search rejects malformed titles and unsupported source books without mutating the query |   |

#### tests/fast-first-story.test.mjs

[tests/fast-first-story.test.mjs](../tests/fast-first-story.test.mjs) — 8 declarations.

Domains: discovery; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 29 | small reading plans cap chapters and preserve every unit, even when a whole book fits the old budget |   |
| 42 | theme-filtered legacy coverage never skips uncatalogued original, and old files remain intact |   |
| 60 | a legacy cache without manifest cannot supply the neutral catalog cursor or records |   |
| 70 | a delayed library cache miss cannot overwrite newly catalogued stories or progress |   |
| 86 | active chapters and checking stages validate without pretending an unfinished block is complete |   |
| 94 | selected-source recommendations validate before inference and share durable results independently of manual style |   |
| 108 | both providers recommend from the selected verified excerpt with no discovery or image call |   |
| 120 | art endpoint validates selection/origin, rejects stale receipts and safely isolates recommendation failure |   |

#### tests/incremental-story-library.e2e.mjs

[tests/incremental-story-library.e2e.mjs](../tests/incremental-story-library.e2e.mjs) — 16 declarations.

Domains: discovery; level: `service-e2e`; cost: `standard`; platforms: darwin, linux, win32; suite: `e2e`; PR: `affected`; gates: extended. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 29 | cold theme discovery retains rejected stories; restart and new themes reuse them; production receives originals |   |
| 50 | REST preserves obsolete review as unknown and retries after exhaustive discovery without rescanning |   |
| 58 | two streaming theme requests share extraction; one reader can leave while another receives its story |   |
| 69 | `${theme}: synopsis is created only after selection and an unsupported reason is corrected before ${length}-frame production and survive restart` | for(const [theme,length] of [['勇气',2],['原典故事',21]])test(`${theme}: synopsis is created only after selection and an unsupported reason is corrected before ${length}-frame production  |
| 90 | `missing ${omitted} fails preparation, blocks confirmation, and retries with the same original` | for(const omitted of ['storySummary','storyMatchReason'])test(`missing ${omitted} fails preparation, blocks confirmation, and retries with the same original`,async t=&gt;{  |
| 105 | reselection binds a new synopsis to its new original, and clients cannot inject a replacement brief |   |
| 116 | direct original selection skips matching but still prepares a complete source-mode synopsis |   |
| 131 | historical direct selections without a synopsis prepare one before any new storyboard |   |
| 140 | `missing synopsis is saved before a ${length}-frame plan and a planning retry does not regenerate it` | for(const length of [2,21])test(`missing synopsis is saved before a ${length}-frame plan and a planning retry does not regenerate it`,async t=&gt;{  |
| 158 | invalid missing-summary preparation blocks planning and retries with the saved original |   |
| 168 | a confirmed legacy intake stays confirmed and keeps its selected frame count while a missing synopsis is prepared |   |
| 176 | `saved outline batches resume after synopsis preparation without repeating the outline (${unverified?'unverified brief':'missing summary'})` | for(const unverified of [false,true])test(`saved outline batches resume after synopsis preparation without repeating the outline (${unverified?'unverified brief':'missing summary'}  |
| 189 | REST resumes an old summary catalog from real media without rescanning and persists new binary receipts across restart |   |
| 200 | REST accepts a captured pending completion with shared old evidence and preserves it across restart |   |
| 216 | one-card intake fills four after a cold miss and shows the remaining batch without extraction |   |
| 225 | REST reports a source-specific extraction failure and clears its private diagnostic after retry |   |

#### tests/incremental-story-library.test.mjs

[tests/incremental-story-library.test.mjs](../tests/incremental-story-library.test.mjs) — 24 declarations.

Domains: discovery; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 18 | an irrelevant story is retained and another theme reuses it without extracting the original again |   |
| 28 | new cache/provider wrappers reuse both neutral records and positive/negative theme decisions |   |
| 34 | newly extracted stories receive incremental verdicts without judging old negatives again |   |
| 40 | every matching request reads the exact original on its first and only pass |   |
| 46 | obsolete review remains unknown, permits later originals, and can be retried manually after exhaustion |   |
| 54 | a later provider failure preserves completed positive and negative receipts |   |
| 62 | `invalid ${kind} matching IDs preserve legal decisions and the catalog` | for(const kind of ['unknown','duplicate','missing'])test(`invalid ${kind} matching IDs preserve legal decisions and the catalog`,async()=&gt;{  |
| 69 | catalog and candidates contain no synopsis or production brief |   |
| 74 | different themes share extraction and persist separate matching results |   |
| 82 | joining a matching flight for other IDs rechecks its own missing stories without dropping them |   |
| 91 | a completed binary receipt survives cancellation and no next batch is dispatched |   |
| 99 | one departing matching reader leaves another active and neither repeats the paid judgment |   |
| 106 | matching budget rejects paid work before dispatch and leaves already catalogued stories intact |   |
| 112 | a single oversized original fails before inference and never truncates or writes no |   |
| 117 | input budget shrinks a batch while preserving every full original |   |
| 126 | an all-negative theme stops at exhausted coverage, caches its negatives, and leaves stories for later themes |   |
| 133 | a corrupt theme cache is rejudged without extracting the original again |   |
| 139 | a failed verdict write surfaces failure, preserving the catalog for an explicit retry |   |
| 146 | a changed extraction model or effort starts an isolated library while themes alone do not |   |
| 153 | old summary catalog resumes ranges and coverage without extraction or old theme verdicts |   |
| 161 | matching model and effort invalidate verdicts without invalidating extraction |   |
| 167 | six originals are matched in bounded batches with reordered IDs and durable negative receipts |   |
| 175 | legacy pending ranges lose synopsis metadata and a failed upgrade write remains retryable |   |
| 185 | one-at-a-time presentation extracts a bounded larger batch after a cold miss and consumes the batch without re-reading |   |

#### tests/manual-extraction-start.test.mjs

[tests/manual-extraction-start.test.mjs](../tests/manual-extraction-start.test.mjs) — 2 declarations.

Domains: discovery; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 7 | creation, demand and restart stay idle until the user starts extraction |   |
| 28 | opening and cancelling a replacement draft does not extract or change the original |   |

#### tests/reader-suggestion-request.test.mjs

[tests/reader-suggestion-request.test.mjs](../tests/reader-suggestion-request.test.mjs) — 6 declarations.

Domains: discovery; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 18 | reading percentage uses character totals, withholds 100% until complete, and validates bounds |   |
| 27 | fragmented UTF-8 progress reaches the caller before the final batch |   |
| 36 | offline API, interrupted streams and provider failures reject instead of returning partial success |   |
| 43 | both a stalled connection and a stalled body time out; explicit cancellation aborts the request |   |
| 53 | HTTP keeps JSON clients working, streams progress early, safely reports errors and signals cancellation |   |
| 75 | Node HTTP flushes progress without waiting for completion and cancels work on disconnect |   |

#### tests/selected-chapter-extraction.test.mjs

[tests/selected-chapter-extraction.test.mjs](../tests/selected-chapter-extraction.test.mjs) — 7 declarations.

Domains: discovery; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 22 | multiple selected chapters extract scoped stories before preparation, replay canonically and survive restart |   |
| 39 | forged, duplicate, empty, excessive, nonchapter and mixed scopes fail before insertion |   |
| 48 | out-of-scope model receipts fail closed; changing selected scope never reuses another scope cache |   |
| 55 | chapter scopes retain canonical ranges even when the chapter contains an isolated unreadable unit |   |
| 62 | a story may span selected neighboring chapters and prepares their original parts intact |   |
| 72 | an explicit all-chapter scope has a distinct cache from whole-book discovery |   |
| 84 | a fresh task and fresh discovery wrapper reuse persisted stories for the same chapter set without LLM calls |   |

#### tests/story-chapter-context.test.mjs

[tests/story-chapter-context.test.mjs](../tests/story-chapter-context.test.mjs) — 6 declarations.

Domains: discovery; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 18 | the short gold-lock anchor retains its citation and saves all of chapter eight, including the departure |   |
| 29 | discontinuous and cross-chapter anchors expand each involved chapter once in book order |   |
| 39 | the reader exposes saved full chapters and citations while historical passage-only stories stay readable |   |
| 50 | isolated Liaozhai and Shishuo stories keep their exact source without neighboring stories |   |
| 60 | `${provider}: complete chapters survive persistence and reach pacing, outline, scenes, ending, review and repair` | for(const provider of flowProviders(['codex','gemini']))test(`${provider}: complete chapters survive persistence and reach pacing, outline, scenes, ending, review and repair`,async  |
| 89 | full context preserves unreadable markers outside the qualified story and rejects an oversized chapter without truncation |   |

#### tests/story-chapter-picker.test.mjs

[tests/story-chapter-picker.test.mjs](../tests/story-chapter-picker.test.mjs) — 6 declarations.

Domains: discovery; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 12 | contents preserve named stories, single anecdotes and chapter receipts with quality gates |   |
| 25 | metadata browsing needs no configured provider; direct intake derives title and keeps production gated across replay/restart |   |
| 43 | forged, stale, cross-book and non-catalog ranges fail before a task is saved |   |
| 52 | contents search matches traditional text and full-width chapter punctuation |   |
| 58 | multiword search matches every normalized term in any order across fields |   |
| 64 | Three Kingdoms search finds Huang Zhong at Dingjun Mountain beyond the preview without exposing full chapters |   |

#### tests/story-continuation-overlap.test.mjs

[tests/story-continuation-overlap.test.mjs](../tests/story-continuation-overlap.test.mjs) — 6 declarations.

Domains: discovery; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 19 | a captured completion sharing only old pending evidence survives acceptance, display, exclusion and restart |   |
| 30 | `continuation evidence cannot bypass ${mode}` | for(const mode of ['duplicate-range','unknown-resolved'])test(`continuation evidence cannot bypass ${mode}`,async()=&gt;{  |
| 41 | invalid cached continuation evidence cannot be reused as an accepted story |   |
| 47 | a different complete third-chapter event may share background without an old pending event |   |
| 56 | fresh complete events do not trust model-supplied pending completion metadata |   |
| 63 | `rejection diagnostics preserve state for ${mode} and clear on a valid retry` | for(const mode of ['covered-union','same-title','invalid-source','no-progress'])test(`rejection diagnostics preserve state for ${mode} and clear on a valid retry`,async()=&gt;{  |

#### tests/story-discovery-cache.test.mjs

[tests/story-discovery-cache.test.mjs](../tests/story-discovery-cache.test.mjs) — 25 declarations.

Domains: discovery; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 36 | continuous discovery consumes a larger extracted catalog one story at a time |   |
| 41 | suggestion effort isolates cached progress and unrelated review effort preserves cache hits |   |
| 50 | old caches without effort are not migrated into a newly configured effort namespace |   |
| 56 | whole book first selects one, then catalogs four and returns four matches promptly; hot hits do not extract again |   |
| 65 | chapter mode returns one first and resumes the same block before advancing |   |
| 73 | a partial chapter batch returns immediately, survives restart, and continues only after its sources are excluded |   |
| 84 | a single story ends scanning without marking an unfinished block exhausted |   |
| 95 | reading manifests contain references only, persist across themes and reject corrupt coverage |   |
| 107 | cross-chapter pending survives omission, accumulates evidence, and only a covering complete story consumes it |   |
| 131 | a zero-result explicitly complete block advances; an unfinished no-progress response fails without skipping |   |
| 139 | fake event consumption and merged pending overflow keep the previous cursor and events |   |
| 152 | another theme reuses the neutral library while presentation changes reuse its matching cache |   |
| 160 | a consumed event cannot be resurrected by returning the same source as a new empty-id pending |   |
| 170 | concurrent requests share one expansion; one reader cancelling does not cancel the other |   |
| 177 | all readers cancelling still saves the finished call and does not dispatch another block |   |
| 184 | a second reader gets unseen stories from a shared expansion without waiting to fill a presentation page |   |
| 194 | a waiting reader whose exclusions cover the shared batch continues scanning |   |
| 204 | a partial cached batch does not wait behind another readers model call |   |
| 212 | a complete cached page does not wait behind another readers model call |   |
| 221 | cache write errors and malformed model state do not pretend success |   |
| 225 | distinct sources sharing a display title remain available when excluding by source |   |
| 231 | invalid and overlapping receipts are removed and cannot advance the current block |   |
| 237 | FileMedia restart and authenticated JSON/streaming routes preserve partial batches and per-reader exclusions |   |
| 251 | a draining reader waits for the call it ended, surfaces its failure, and leaves shared readers alone |   |
| 270 | stopping and resuming a search reads on from its saved position |   |

#### tests/story-discovery-eval.test.mjs

[tests/story-discovery-eval.test.mjs](../tests/story-discovery-eval.test.mjs) — 5 declarations.

Domains: discovery; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 6 | end-to-end recall counts unknown positives while coverage exposes missing judgments |   |
| 12 | empty denominators are not zero accuracy |   |
| 13 | range matching is one-to-one and deterministic; merge/split/endpoints are diagnostics |   |
| 18 | shipped annotations cover 44 pairs, four books and three complete chapters, with controlled provenance |   |
| 26 | shipped distinct complete events share verified background without sharing their outcomes |   |

#### tests/story-discovery-metrics.test.mjs

[tests/story-discovery-metrics.test.mjs](../tests/story-discovery-metrics.test.mjs) — 6 declarations.

Domains: discovery; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 7 | `${provider}: wire IDs, partial parsing, capacity, prefix order and safe metrics` | for(const provider of ['codex','gemini','openai'])test(`${provider}: wire IDs, partial parsing, capacity, prefix order and safe metrics`,async()=&gt;{  |
| 20 | unknown usage stays unknown; only recognized content failures are isolatable |   |
| 23 | `${provider}: ${fault} transport failure stays a service error` | for(const fault of ['timeout','envelope'])test(`${provider}: ${fault} transport failure stays a service error`,async()=&gt;{; for(const provider of ['openai','gemini'])for(const fault of ['timeout','envelope'])test(`${provider}: ${fault} transport failure stays a service error`,async()=&gt;{  |
| 28 | `${provider}: valid catalog siblings survive malformed pending metadata` | for(const provider of ['codex','openai','gemini'])test(`${provider}: valid catalog siblings survive malformed pending metadata`,async()=&gt;{  |
| 40 | shutdown drain includes queued measurement updates that have not entered the cache yet |   |
| 49 | cancelled extraction still attributes its completed paid receipt to the original cycle |   |

#### tests/story-discovery-modes.e2e.mjs

[tests/story-discovery-modes.e2e.mjs](../tests/story-discovery-modes.e2e.mjs) — 1 declarations.

Domains: discovery; level: `browser-e2e`; cost: `heavy`; platforms: darwin, linux, win32; suite: `e2e`; PR: `affected`; gates: user-flows. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 17 | title, theme and original scope are independently optional in the creation UI |  {timeout:120000} |

#### tests/story-discovery-modes.test.mjs

[tests/story-discovery-modes.test.mjs](../tests/story-discovery-modes.test.mjs) — 6 declarations.

Domains: discovery; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 15 | `${name}: title queries keep full scope, ignore theme filtering and never fall back to episodes` | for(const name of ['codex','gemini'])test(`${name}: title queries keep full scope, ignore theme filtering and never fall back to episodes`,async()=&gt;{  |
| 55 | automatic discovery with a chapter scope keeps extraction neutral and applies the selected theme |   |
| 67 | verified title results and their cached replay never depend on an available theme matcher |   |
| 76 | title plus a catalog story scopes inference to its exact passage and rejects mixed or forged excerpts |   |
| 93 | title intent, scope and theme survive creation, replay, restart and choosing in the production API |   |
| 110 | invalid title intents and unsupported books are rejected before saving a task |   |

#### tests/story-discovery-speed-accuracy.e2e.mjs

[tests/story-discovery-speed-accuracy.e2e.mjs](../tests/story-discovery-speed-accuracy.e2e.mjs) — 6 declarations.

Domains: discovery; level: `service-e2e`; cost: `standard`; platforms: darwin, linux, win32; suite: `e2e`; PR: `affected`; gates: extended. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 15 | persistent bad stories do not block later originals; exhausted results disclose unknown judgments |   |
| 21 | eight isolation calls span automatic rounds, viewer departures and a restart; manual retry starts a new cycle |   |
| 29 | a service outage stops without splitting and keeps already-paid catalog entries |   |
| 33 | later matching batch returns while two pending calls save after selection |   |
| 40 | partial pending failure saves independent stories; corrected receipt resolves without reinsertion after restart |   |
| 46 | single invalid cached entries are removed without rereading a completed original |   |

#### tests/story-discovery-speed-accuracy.test.mjs

[tests/story-discovery-speed-accuracy.test.mjs](../tests/story-discovery-speed-accuracy.test.mjs) — 20 declarations.

Domains: discovery; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 10 | a bad cached story or pending does not clear good stories or completed coverage |   |
| 15 | partial pending failure retains independent story and corrected receipt closes from cached evidence |   |
| 22 | all queued cache updates execute and merge latest state |   |
| 35 | one persistent story failure is isolated once and later matching stories remain reachable |   |
| 41 | isolation budget survives repeated requests and cache recreation in the same cycle |   |
| 47 | a later matching batch returns before two pending batches, then both pending receipts save |   |
| 52 | service failures stop dispatch instead of being isolated or cached as no |   |
| 57 | matching cache is shared across scope and extraction identity but checks original content |   |
| 67 | arbitrary old theme receipts migrate from frozen keys without repeating paid judgments |   |
| 73 | invalid extraction ranges never advance even when a model claims block completion |   |
| 76 | high overlap is diagnostic; a distinct complete event with new evidence remains usable |   |
| 82 | nine stories need two actual extraction calls; a full receipt cannot falsely complete its block |   |
| 87 | an isolation service failure prevents queued batches from starting |   |
| 91 | changed matching identity cannot reuse an isolation budget charge in the same cycle |   |
| 95 | invalid pending syntax retains independent stories and the prior cursor and pending event |   |
| 99 | a known service outage closes other active queries using the same matching service |   |
| 107 | joined matching cycles each retain one receipt after the initiating reader leaves |   |
| 114 | a cycle starting with an unshown cached yes cannot retry old unknowns after that yes is shown |   |
| 120 | only cycles with reserved isolation credit receive a shared isolation cost receipt |   |
| 126 | valid old neutral records survive a missing manifest without claiming old coverage |   |

#### tests/story-matching-models.test.mjs

[tests/story-matching-models.test.mjs](../tests/story-matching-models.test.mjs) — 3 declarations.

Domains: discovery; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 6 | `${provider}: matching uses its dedicated model and low effort while extraction retains its configuration` | for(const provider of ['codex','openai','gemini'])test(`${provider}: matching uses its dedicated model and low effort while extraction retains its configuration`,async()=&gt;{  |
| 22 | OpenAI rejects a mismatched actual matching model and accepts an omitted model as the explicit request identity |   |
| 28 | `${provider}: catalog output limits follow the extraction request, independently of display` | for(const provider of ['codex','openai','gemini'])test(`${provider}: catalog output limits follow the extraction request, independently of display`,async()=&gt;{  |

### preparation

#### tests/art-recommendation.test.mjs

[tests/art-recommendation.test.mjs](../tests/art-recommendation.test.mjs) — 5 declarations.

Domains: preparation; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 18 | recommendations validate real style IDs and bounded nonempty reasons, while old history still loads |   |
| 28 | new stories adopt their recommendation, reselect preserves manual choice, and another story replaces it |   |
| 40 | discovery defers art while existing recommendation contracts and receipts stay compatible |   |
| 62 | Gemini and Codex omit art work during scans and preserve recommendations in other modes |   |
| 83 | direct whole-book selection preserves the original content-based art recommendation |   |

#### tests/reader-intake.test.mjs

[tests/reader-intake.test.mjs](../tests/reader-intake.test.mjs) — 14 declarations.

Domains: preparation; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 14 | intent is saved before discovery; restart and waiting for story choice never commission scripts/images |   |
| 22 | choosing prepares saved source and count; only full production confirmation starts generation |   |
| 34 | creation/action replay are independent of progress; competing choices conflict atomically |   |
| 45 | a failed search stays with the search; obsolete jobs do not block the next one |   |
| 54 | failed preparation can be replaced, manual preferences survive reselect, and old receipts are fenced |   |
| 69 | empty batches stay selectable, cap at forty, and pause never dispatches discovery |   |
| 80 | display states distinguish queued extraction, waiting choice and full setup without false completion |   |
| 87 | choosing a new candidate can carry unsaved manual preferences in the same atomic choice |   |
| 94 | reselecting remote candidates prepares distinct originals through the real source cache, while returning to one reuses its text |   |
| 115 | finding another batch leaves the prepared story in place and observes until the search ends |   |
| 126 | confirmed intake draws eighty frames once across four storyboard batches |  heavy |
| 137 | legacy prepared choice receipts read as confirming without writes or paid work, and can confirm directly |   |
| 150 | phase recovery compares local source ranges canonically and rejects partial or mismatched checkpoints |   |
| 172 | a paused source-and-summary story can be renamed without changing preparation or starting generation |   |

#### tests/story-brief.test.mjs

[tests/story-brief.test.mjs](../tests/story-brief.test.mjs) — 3 declarations.

Domains: preparation; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 18 | binary matching requires a reason and rejects review or summary fields |   |
| 25 | binary matching survives cache reuse and an old receipt is rejudged without rescanning |   |
| 33 | `${provider}: brief verification, bounded output, theme/source guidance and original facts remain separate` | for(const provider of ['codex','gemini','openai'])test(`${provider}: brief verification, bounded output, theme/source guidance and original facts remain separate`,async()=&gt;{  |

#### tests/story-editorial.test.mjs

[tests/story-editorial.test.mjs](../tests/story-editorial.test.mjs) — 3 declarations.

Domains: preparation; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 10 | `${provider}: ${theme} edits title and ending after saved scenes, then independently audits both` | for(const theme of ['放下执念','原典故事'])test(`${provider}: ${theme} edits title and ending after saved scenes, then independently audits both`,async t=&gt;{; for(const provider of flowProviders(['codex','gemini']))for(const theme of ['放下执念','原典故事'])test(`${provider}: ${theme} edits title and ending after saved scenes, then independently  |
| 38 | `invalid title audit ${JSON.stringify(invalid)} cannot change the plan or authorize drawing` | for(const invalid of [{title:'',reason:'标题不准确。'},{title:'   ',reason:'标题不准确。'},{title:'字'.repeat(41),reason:'标题太长。'},{title:'庄周梦蝶',reason:''}])test(`invalid title audit ${JSON.stri  |
| 47 | source editorial context never treats its display label as a theme to satisfy |   |

#### tests/story-reflection-candidates.test.mjs

[tests/story-reflection-candidates.test.mjs](../tests/story-reflection-candidates.test.mjs) — 7 declarations.

Domains: preparation; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 13 | `${provider}: audit selects candidate ${index} exactly and persists its evidence before drawing` | for(const index of [2,3])test(`${provider}: audit selects candidate ${index} exactly and persists its evidence before drawing`,async t=&gt;{; for(const provider of flowProviders(['codex','gemini']))for(const index of [2,3])test(`${provider}: audit selects candidate ${index} exactly and persists its evidence before drawin  |
| 34 | failed choice audit resumes after restart without regenerating candidates or frames |   |
| 44 | `invalid ${invalid} choice cannot mutate the saved plan or discard candidates` | for(const invalid of ['missing','range','reason'])test(`invalid ${invalid} choice cannot mutate the saved plan or discard candidates`,async t=&gt;{  |
| 53 | `invalid candidates ${JSON.stringify(values)} preserve the saved storyboard` | for(const values of [candidates.slice(0,2),[candidates[0],candidates[0],candidates[2]],[' ',candidates[1],candidates[2]]])test(`invalid candidates ${JSON.stringify(values)} preserv  |
| 62 | all-rejected selection repairs only the selected sentence, then audits without stale candidates |   |
| 80 | candidate and choice schemas preserve the old single-ending report contract |   |
| 89 | `${provider}: editorial theme guides review and scene repair, with original facts and authored requirements intact` | for(const provider of flowProviders(['codex','gemini']))test(`${provider}: editorial theme guides review and scene repair, with original facts and authored requirements intact`,asy  |

#### tests/story-reflection.test.mjs

[tests/story-reflection.test.mjs](../tests/story-reflection.test.mjs) — 8 declarations.

Domains: preparation; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 16 | `${provider}: ${length} saved frames precede the separate ending and whole-story audit` | for(const length of [8,25])test(`${provider}: ${length} saved frames precede the separate ending and whole-story audit`,async t=&gt;{; for(const provider of flowProviders(['codex','gemini']))for(const length of [8,25])test(`${provider}: ${length} saved frames precede the separate ending and whole-story audit`,asyn  |
| 44 | `${provider}: failed ending resumes after restart without re-planning saved scenes` | for(const provider of flowProviders(['codex','gemini']))test(`${provider}: failed ending resumes after restart without re-planning saved scenes`,async t=&gt;{  |
| 56 | `${provider}: ending-only repair is audited again and preserves every scene` | for(const provider of flowProviders(['codex','gemini']))test(`${provider}: ending-only repair is audited again and preserves every scene`,async t=&gt;{  |
| 78 | mixed issues repair all scene batches before rewriting the ending from the corrected whole |   |
| 95 | unchanged ending blocks drawing and manual continuation uses the saved ending issue |   |
| 106 | saved ending receipts and concurrent advances cannot repeat a paid ending |   |
| 119 | review validation keeps ending issues separate from real frame numbers |   |
| 125 | repairing an ending in a revision retains all existing images |   |

#### tests/story-requirements.test.mjs

[tests/story-requirements.test.mjs](../tests/story-requirements.test.mjs) — 8 declarations.

Domains: preparation; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 13 | criteria are bounded and legacy stories remain unmodified; acceptance-only revisions preserve images and script |   |
| 21 | missing, duplicate, out-of-range and unactionable failed criterion results cannot pass review validation |   |
| 27 | `${provider}: saved per-story requirements, actual prompts and acceptance-only revisions survive restart without redrawing` | for(const provider of flowProviders(['codex','gemini']))test(`${provider}: saved per-story requirements, actual prompts and acceptance-only revisions survive restart without redraw  |
| 49 | failed criteria enter existing targeted repair and must pass a fresh audit before drawing |   |
| 55 | unknown/conflicting criteria stop immediately with evidence, no fabricated repair or drawing |   |
| 63 | historical rows have no invented capture history, and previews do not commission inference |   |
| 70 | prompt export metadata identifies partially retained and inherited calls without leaking raw receipts |   |
| 86 | confirmation drafts retain both requirements through restart and apply them only on explicit confirmation |   |

#### tests/story-specific-requirements.test.mjs

[tests/story-specific-requirements.test.mjs](../tests/story-specific-requirements.test.mjs) — 7 declarations.

Domains: preparation; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 20 | generic defaults are system rules; blank and historical automatic fields remain empty |   |
| 29 | `${provider}: source-specific setup suggestions survive restart, edits and confirmation, then route to their own stages` | for(const provider of flowProviders(['codex','gemini']))test(`${provider}: source-specific setup suggestions survive restart, edits and confirmation, then route to their own stages  |
| 47 | a paused draft saved during inference wins through progress and final checkpoints, including intentional blanks |   |
| 65 | reselection replaces unchanged automatic guidance and preserves authored draft fields even without settings |   |
| 76 | ordinary revisions retain provenance so a new selection version clears inherited automatic requirements |   |
| 92 | completed stories retain deliberately blank requirements through open and committed reselection |   |
| 100 | edits after failed replacement preparation supersede inherited authored overrides |   |

#### tests/story-summary.test.mjs

[tests/story-summary.test.mjs](../tests/story-summary.test.mjs) — 5 declarations.

Domains: preparation; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 40 | upgrade removes old fields from stories, drafts, outlines, revision bases and media without changing content |   |
| 61 | an unsafe media backup blocks migration before writes and a repaired source retries safely |   |
| 70 | derived image IDs and anchors migrate and a paid unpublished image is published without another image request |   |
| 93 | target job identity collisions abort the upgrade without discarding either receipt |   |
| 100 | script disclosure renders the summary with the existing storyboard |   |

#### tests/story-title.test.mjs

[tests/story-title.test.mjs](../tests/story-title.test.mjs) — 3 declarations.

Domains: preparation; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 10 | renaming persists across restart without changing source, script, media, progress, versions or jobs; no provider required |   |
| 34 | a running image checkpoint cannot revert the name; later revisions inherit it while fresh stories do not |   |
| 50 | invalid, cross-origin and other-owner renames leave stored data intact |   |

### review

#### tests/adaptive-storyboard-review.e2e.mjs

[tests/adaptive-storyboard-review.e2e.mjs](../tests/adaptive-storyboard-review.e2e.mjs) — 8 declarations.

Domains: review; level: `service-e2e`; cost: `standard`; platforms: darwin, linux, win32; suite: `e2e`; PR: `affected`; gates: extended. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 12 | `${provider}: automatic counts differ from the estimate; structural insertion/deletion rechecks before images` | for(const provider of ['codex','gemini'])test(`${provider}: automatic counts differ from the estimate; structural insertion/deletion rechecks before images`,async t=&gt;{  |
| 30 | structural edits remap existing duplicate pictures and concurrent reading progress atomically |   |
| 49 | deleting a duplicate transition reduces count and keeps reading positions valid |   |
| 56 | `${invalid?'invalid':'unchanged'} structural output stops without images or automatic replay` | for(const invalid of [true,false])test(`${invalid?'invalid':'unchanged'} structural output stops without images or automatic replay`,async t=&gt;{  |
| 64 | saved structural edits survive restart without being charged a second time |   |
| 78 | automatic structural repairs share the twenty-pass stop and never draw through it |   |
| 85 | `${missing?'missing coverage':'invented source quote'} cannot approve an automatic script` | for(const missing of [true,false])test(`${missing?'missing coverage':'invented source quote'} cannot approve an automatic script`,async t=&gt;{  |
| 92 | `late reading progress ${structural?'cannot cross a structural save':'survives an unrelated image checkpoint'}` | for(const structural of [true,false])test(`late reading progress ${structural?'cannot cross a structural save':'survives an unrelated image checkpoint'}`,async t=&gt;{  |

#### tests/adaptive-storyboard-review.test.mjs

[tests/adaptive-storyboard-review.test.mjs](../tests/adaptive-storyboard-review.test.mjs) — 6 declarations.

Domains: review; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 19 | ordered insertion and deletion preserve explicit identities, including duplicate prompts |   |
| 28 | caption-only replacement reuses its explicit source; first-frame or global identity changes invalidate artwork |   |
| 36 | invalid edits fail before mutating a saved plan and execution bounds cannot be exceeded |   |
| 43 | coverage validates source references, frame bounds and a concrete matching issue |   |
| 52 | old numeric caption/style edits preserve their mode; explicit narrative replanning selects auto |   |
| 58 | `${provider} editorial/structure wire schemas and bounded output budgets` | for(const provider of ['codex','gemini','openai'])test(`${provider} editorial/structure wire schemas and bounded output budgets`,async()=&gt;{  |

#### tests/character-continuity-edits.e2e.mjs

[tests/character-continuity-edits.e2e.mjs](../tests/character-continuity-edits.e2e.mjs) — 4 declarations.

Domains: review; level: `service-e2e`; cost: `standard`; platforms: darwin, linux, win32; suite: `e2e`; PR: `affected`; gates: extended. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 8 | characters-only repair preserves frames, records old/new metadata and rechecks before drawing |   |
| 17 | an unchanged global repair is blocked without drawing |   |
| 22 | legacy numeric scripts retain their global-replan stop rather than silently changing mode |   |
| 27 | global continuity repairs share the existing twenty-repair ceiling |   |

#### tests/character-continuity-edits.test.mjs

[tests/character-continuity-edits.test.mjs](../tests/character-continuity-edits.test.mjs) — 2 declarations.

Domains: review; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 11 | character-only edits keep frame and progress identities, invalidate global drawing inputs and retain other metadata |   |
| 20 | `${provider}: global characters-only repair keeps the existing text-stage budget` | for(const provider of ['codex','gemini','openai'])test(`${provider}: global characters-only repair keeps the existing text-stage budget`,async()=&gt;{  |

#### tests/frame-count-continuation.test.mjs

[tests/frame-count-continuation.test.mjs](../tests/frame-count-continuation.test.mjs) — 4 declarations.

Domains: review; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 12 | legal system drafts retain text, usage, history and repair count but lose old approval |   |
| 15 | changed source/settings or illegal frame output cannot seed a continuation |   |
| 20 | a version change never resets the twenty-repair ceiling |   |
| 25 | restart without new inference retains receipts and failures for the next continuation |   |

#### tests/frame-count-gate.e2e.mjs

[tests/frame-count-gate.e2e.mjs](../tests/frame-count-gate.e2e.mjs) — 4 declarations.

Domains: review; level: `service-e2e`; cost: `standard`; platforms: darwin, linux, win32; suite: `e2e`; PR: `affected`; gates: extended. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 16 | old script expands, rechecks count, then completes the original audit with zero media calls |   |
| 35 | two restarting processes cannot both reclaim a dead evaluation owner |   |
| 46 | a rejected new binding or concurrent process leaves frozen provenance untouched |   |
| 58 | an inherited exhausted repair budget blocks before restructuring or media |   |

#### tests/frame-count-gate.test.mjs

[tests/frame-count-gate.test.mjs](../tests/frame-count-gate.test.mjs) — 6 declarations.

Domains: review; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 22 | production engine reduces, preserves images, saves every count receipt, then selects ending in full audit |   |
| 35 | a saved count-keep survives restart and failed full retry without paying the count gate again |   |
| 41 | `invalid count ${invalid} stops before full review or media` | for(const invalid of ['direction','quote','capability'])test(`invalid count ${invalid} stops before full review or media`,async t=&gt;{  |
| 47 | count repairs share the global limit; no-op repair blocks and manual retry has a distinct job key |   |
| 53 | raw receipt reuse requires the resolved model |   |
| 58 | a count structure repair consumes the same allowance as a subsequent full repair |   |

#### tests/frame-count-replay.test.mjs

[tests/frame-count-replay.test.mjs](../tests/frame-count-replay.test.mjs) — 6 declarations.

Domains: review; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 14 | replay freezes every pair and requires the complete job and resolved model |   |
| 22 | replay rejects requested or actual model mismatches |   |
| 26 | different receipts for one exact request are ambiguous regardless of editorial verdict |   |
| 30 | only the receipt linked to an explicit output failure is excluded, not its job or a timeout predecessor |   |
| 39 | explicit failure identity stays tied to its recorded call even after later calls |   |
| 44 | persisted exact entry proof permits restart into structure and full jobs, while forged proof does not |   |

#### tests/frame-count-review.test.mjs

[tests/frame-count-review.test.mjs](../tests/frame-count-review.test.mjs) — 7 declarations.

Domains: review; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 14 | the dedicated gate derives unambiguous issues and keeps full requirements when one frame has multiple losses |   |
| 23 | count verdicts respect the current count, direction, bounds and corresponding structural issues |   |
| 34 | the original audit remains intact and the appended count audit follows the requested four-step order |   |
| 39 | `${provider}: automatic audit requires count decision without changing review effort or budget` | for(const provider of ['codex','gemini','openai'])test(`${provider}: automatic audit requires count decision without changing review effort or budget`,async()=&gt;{  |
| 48 | local count audits reject mismatched saved source before invoking the provider |   |
| 55 | structure revision receives every complete requirement, while the recommendation remains advisory |   |
| 62 | count and full audits reuse the same story scope instead of divergent title-based boundaries |   |

#### tests/review-history-api.test.mjs

[tests/review-history-api.test.mjs](../tests/review-history-api.test.mjs) — 2 declarations.

Domains: review; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 14 | history is demand-loaded, read-only, owner scoped, and deleted stories stay hidden |   |
| 22 | a fresh revision shows its own records and links its parent without inheriting parent verdicts |   |

#### tests/review-history-flow.test.mjs

[tests/review-history-flow.test.mjs](../tests/review-history-flow.test.mjs) — 1 declarations.

Domains: review; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 8 | formal review flow persists ordered history and before text without affecting generation on read |   |

#### tests/review-history.test.mjs

[tests/review-history.test.mjs](../tests/review-history.test.mjs) — 8 declarations.

Domains: review; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 13 | mixed count/full/repair order uses only this version and preserves unknown verdict |   |
| 19 | stored before wins, absent before stays absent, and ambiguous calls are not assigned a position |   |
| 26 | old structure calls with equal full round are matched by saved original ranges and requested issues |   |
| 33 | structure insertion/deletion numbers refer to the historical drafts, not the current plan |   |
| 38 | first full report is an audit even after manual continuation; prior reports become rechecks |   |
| 41 | reflection/global character changes and no-op attempts retain their actual evidence |   |
| 45 | empty legacy documents return no invented events or times |   |
| 48 | legacy character-only repairs without prior text do not claim no change |   |

#### tests/story-completeness.test.mjs

[tests/story-completeness.test.mjs](../tests/story-completeness.test.mjs) — 3 declarations.

Domains: review; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 14 | `${provider}: structural omissions block before any repair or image and survive retries and restart` | for(const provider of flowProviders(['codex','gemini']))test(`${provider}: structural omissions block before any repair or image and survive retries and restart`,async t=&gt;{  |
| 47 | a missing opening introduction is repaired in frame one without replanning or adding frames |   |
| 61 | historical issues stay compatible; a replan marker cannot masquerade as an ending or local caption issue |   |

#### tests/storyboard-batches.test.mjs

[tests/storyboard-batches.test.mjs](../tests/storyboard-batches.test.mjs) — 7 declarations.

Domains: review; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 12 | `${provider}: outline and 20/20/5 checkpoints precede every image` | for(const provider of flowProviders(['codex','gemini']))test(`${provider}: outline and 20/20/5 checkpoints precede every image`,async t=&gt;{  |
| 37 | `${provider}: 80 frames complete four batches and background drawing reaches frame 80` | for(const provider of flowProviders(['codex','gemini']))test(`${provider}: 80 frames complete four batches and background drawing reaches frame 80`,heavy,async t=&gt;{ heavy |
| 50 | `${length} frames use a single short plan or bounded batches` | for(const length of [1,20,21,40,60])test(`${length} frames use a single short plan or bounded batches`,async t=&gt;{  |
| 57 | `${provider}: ${failure} in the second batch keeps the first batch and retries only missing work` | for(const failure of ['outage','short','long','invalid'])test(`${provider}: ${failure} in the second batch keeps the first batch and retries only missing work`,async t=&gt;{; for(const provider of flowProviders(['codex','gemini']))for(const failure of ['outage','short','long','invalid'])test(`${provider}: ${failure} in the second batch keeps the first b  |
| 75 | `${action} between batches retains 20 saved frames across restart` | for(const action of ['pause','stop','leave'])test(`${action} between batches retains 20 saved frames across restart`,async t=&gt;{  |
| 90 | concurrent batch advances and replayed queue receipts do not repeat saved paid work |   |
| 109 | `${provider}: selected-story stages retain theme context without restoring legacy automatic scene prescriptions` | for(const provider of flowProviders(['codex','gemini']))test(`${provider}: selected-story stages retain theme context without restoring legacy automatic scene prescriptions`,async   |

#### tests/storyboard-review.test.mjs

[tests/storyboard-review.test.mjs](../tests/storyboard-review.test.mjs) — 14 declarations.

Domains: review; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 13 | `${provider}: review is a separate queued job and gates all drawing` | for(const provider of flowProviders(['codex','gemini']))test(`${provider}: review is a separate queued job and gates all drawing`,async t=&gt;{  |
| 25 | `${provider}: twenty automatic repair rounds then block; concurrent manual continue reuses saved issues` | for(const provider of flowProviders(['codex','gemini']))test(`${provider}: twenty automatic repair rounds then block; concurrent manual continue reuses saved issues`,async t=&gt;{  |
| 38 | legacy client does not automatically retry a quality blockage |   |
| 44 | 21 requested repairs are saved as 20+1 and only then reviewed again |   |
| 52 | `review ${malformed} pages fail validation without image requests` | for(const malformed of ['duplicate','out-of-range'])test(`review ${malformed} pages fail validation without image requests`,async t=&gt;{  |
| 60 | `repair ${malformed} output cannot mutate the saved plan` | for(const malformed of ['missing','duplicate','extra','bad-caption'])test(`repair ${malformed} output cannot mutate the saved plan`,async t=&gt;{  |
| 73 | `${phase} in flight drains on ${action} and resumes from saved checkpoints after restart` | for(const action of ['pause','stop','leave'])test(`${phase} in flight drains on ${action} and resumes from saved checkpoints after restart`,async t=&gt;{; for(const phase of ['review','repair'])for(const action of ['pause','stop','leave'])test(`${phase} in flight drains on ${action} and resumes from saved checkpoints after restart`,a  |
| 89 | old complete plans remain readable without a retroactive audit |   |
| 96 | a saved review whose queue receipt was lost is not paid twice |   |
| 105 | `${provider}: targeted repair checkpoints precede a fresh whole-plan review` | for(const provider of flowProviders(['codex','gemini']))test(`${provider}: targeted repair checkpoints precede a fresh whole-plan review`,async t=&gt;{  |
| 121 | `${provider}: caption-only issues across batches gate drawing and preserve scene prompts` | for(const provider of flowProviders(['codex','gemini']))test(`${provider}: caption-only issues across batches gate drawing and preserve scene prompts`,async t=&gt;{  |
| 144 | `${provider}: a new issue after the third repair is fixed automatically before drawing` | for(const provider of flowProviders(['codex','gemini']))test(`${provider}: a new issue after the third repair is fixed automatically before drawing`,async t=&gt;{  |
| 152 | no-op repair blocks immediately, saves the paid attempt and never draws |   |
| 159 | manual continuation after a no-op second batch preserves the first twenty repaired pages |   |

#### tests/unified-story-review.e2e.mjs

[tests/unified-story-review.e2e.mjs](../tests/unified-story-review.e2e.mjs) — 5 declarations.

Domains: review; level: `service-e2e`; cost: `standard`; platforms: darwin, linux, win32; suite: `e2e`; PR: `affected`; gates: user-flows. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 24 | production queue survives old review keys, reduces with full requirements, and reuses bytes before missing-image dispatch |   |
| 46 | count in flight drains on pause; restart/full failure retries do not repeat saved count |   |
| 56 | full structure edits return to count, while caption repair stays in full |   |
| 67 | explicit draw-anyway remains marked, paused and idempotent when bypassing an unfinished count gate |   |
| 74 | `opening an old automatic plan with ${legacyReview} review does not add either audit` | for(const legacyReview of ['passed','absent'])test(`opening an old automatic plan with ${legacyReview} review does not add either audit`,async t=&gt;{  |

### production

#### tests/background-generation.test.mjs

[tests/background-generation.test.mjs](../tests/background-generation.test.mjs) — 18 declarations.

Domains: production; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 16 | `${provider}: new stories generate every page without a viewer or a mode request` | for(const provider of flowProviders(['codex','gemini']))test(`${provider}: new stories generate every page without a viewer or a mode request`,async t=&gt;{  |
| 26 | `${action} overrides viewers and legacy calls, survives restart and resumes in the saved mode` | for(const action of ['pause','stop'])test(`${action} overrides viewers and legacy calls, survives restart and resumes in the saved mode`,async t=&gt;{  |
| 41 | manual pause also fences an unmanaged legacy session and direct engine acquisition |   |
| 50 | resume upgrades a paused reader story to whole-story work and reuses every saved image |   |
| 62 | leaving a new story keeps it generating; a manual pause still survives restart |   |
| 72 | `${provider}: shutdown drains saved images; startup resumes only the missing background pages` | for(const provider of flowProviders(['codex','gemini']))test(`${provider}: shutdown drains saved images; startup resumes only the missing background pages`,async t=&gt;{  |
| 82 | `expired background attempts recover with saved control (${paused?'paused':'active'}) and never steal live claims` | for(const paused of [false,true])test(`expired background attempts recover with saved control (${paused?'paused':'active'}) and never steal live claims`,async t=&gt;{  |
| 98 | expired background script locks restart planning without viewers |   |
| 105 | background provider failures stay failed after restart until explicit retry |   |
| 114 | reader deletion disarms background work; restore cannot restart it |   |
| 122 | legacy numeric background preparation retains count confirmation and does not plan or draw early |   |
| 129 | background and foreground stories share the global image cap across coordinators |   |
| 138 | controls validate owner, origin, body and completed sessions; pause does not require provider access |   |
| 149 | `${provider}: an expired missing remote result resumes automatically but saved images do not repeat` | for(const provider of flowProviders(['codex','gemini']))test(`${provider}: an expired missing remote result resumes automatically but saved images do not repeat`,async t=&gt;{  |
| 160 | startup reconciles a fully published background story whose final session save was interrupted |   |
| 167 | a concurrent mode change cannot overwrite another window’s manual pause |   |
| 176 | upgrading a pre-background library preserves checkpoints and pauses old stories |   |
| 193 | single-control upgrade preserves background intent, manual controls, failures, leases and receipts |   |

#### tests/blocked-revision-recovery.test.mjs

[tests/blocked-revision-recovery.test.mjs](../tests/blocked-revision-recovery.test.mjs) — 3 declarations.

Domains: production; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 13 | upgrade backs up and repairs stranded blocked revisions without replacing authorizations or healthy checkpoints |   |
| 46 | a fault storage failure rolls back the blocked child instead of publishing an unrecoverable revision |   |
| 58 | a paused blocked revision requires resume before an explicit retry repairs and completes it once |   |

#### tests/generation-progress.test.mjs

[tests/generation-progress.test.mjs](../tests/generation-progress.test.mjs) — 7 declarations.

Domains: production; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 8 | planning reports saved source, chosen count and elapsed attempt time without a percentage |   |
| 17 | drawing progress counts saved images and completed steps |   |
| 25 | failure, pause and queueing do not keep a running elapsed clock |   |
| 33 | unknown counts and timestamps stay unknown and durations include minutes |   |
| 40 | review and repair are distinct saved stages and drawing only becomes current after approval |   |
| 48 | step clocks survive reopening and count down to the saved deadline |   |
| 62 | completed durations merge parallel work, accumulate batches and exclude waiting gaps |   |

#### tests/paused-editing-versions.test.mjs

[tests/paused-editing-versions.test.mjs](../tests/paused-editing-versions.test.mjs) — 7 declarations.

Domains: production; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 11 | a paused unfinished storyboard can be revised; late work, replay and restart do not resume or overwrite it |   |
| 39 | saving pauses the old version, keeps favorites and valid progress; replay respects later resume and pause |   |
| 53 | latest means submitted version, independent of status, reads, deletion and owner; independent same-title stories stay separate |   |
| 73 | pre-confirmation drafts cannot bypass intake; empty-plan impact does not invent changes or reusable artwork |   |
| 84 | client snapshots cannot replace the latest card with a historical direct read |   |
| 90 | paused preparation saves settings beside a live call, then allows a different candidate without resuming |   |
| 109 | `concurrent ${paused?'paused':'running'} submission replay cannot overwrite a later user control` | for(const paused of [true,false])test(`concurrent ${paused?'paused':'running'} submission replay cannot overwrite a later user control`,async t=&gt;{  |

#### tests/production-queue-hardening.test.mjs

[tests/production-queue-hardening.test.mjs](../tests/production-queue-hardening.test.mjs) — 17 declarations.

Domains: production; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 19 | derived eligibility includes deleted children and ignores corrupt unrelated rows |   |
| 33 | `concurrent publication fences ${action} control without changing the old version` | for(const action of ['resume','background'])test(`concurrent publication fences ${action} control without changing the old version`,async t=&gt;{  |
| 63 | every old-version start point refuses without changing attempts or documents |   |
| 82 | image start rechecks newest version after its first dispatch check |   |
| 92 | `atomic fork publishes ${paused?'paused':'active'} child without parent writes; replay preserves later control` | for(const paused of [true,false])test(`atomic fork publishes ${paused?'paused':'active'} child without parent writes; replay preserves later control`,async t=&gt;{  |
| 104 | `style-only fork preserves ${status\|\|'legacy'} review checkpoint` | for(const status of ['pending','repair','passed','blocked',undefined])test(`style-only fork preserves ${status\|\|'legacy'} review checkpoint`,async t=&gt;{  |
| 113 | seeded legacy paused handoff still resumes and clears its flag without touching parent |   |
| 120 | `style-only pre-plan edit preserves ${kind}; requirements and counts discard it` | for(const kind of ['storyboard','draft'])test(`style-only pre-plan edit preserves ${kind}; requirements and counts discard it`,async t=&gt;{  |
| 138 | ready orphaned jobs in all four pools are contained and logged once while a valid job runs |   |
| 152 | `delete during script ${fails?'failure stays retryable':'checkpoint yields and restore does not replay'}` | for(const fails of [false,true])test(`delete during script ${fails?'failure stays retryable':'checkpoint yields and restore does not replay'}`,async t=&gt;{  |
| 166 | SQL candidates exclude paused, failed, superseded and active reader-mode deleted jobs, but retain publication and orphans |   |
| 190 | warm paused pass uses at most 60 statements; unchanged active state and viewer renewals perform no upserts |   |
| 209 | pruning catches a job failing after the earlier changed-story pass, and expires only expired viewers |   |
| 222 | shelf trimming keeps recovery metadata and never changes the opened session source |   |
| 230 | already-paid image publishes to a deleted active reader-mode story without another draw |   |
| 243 | an old viewer cannot hold back another story after a newer version is published |   |
| 255 | two blocked manual corrections leave only newest eligible; stale retry/skip and old paid lock stay isolated |   |

#### tests/production-queue.test.mjs

[tests/production-queue.test.mjs](../tests/production-queue.test.mjs) — 12 declarations.

Domains: production; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 13 | search and text each have one independent worker beside image and local pools |   |
| 25 | search pool migration upgrades queued and interrupted rows with stable ids and receipts |   |
| 35 | recovery contains an orphan callback failure once and still recovers another lease |   |
| 44 | voice/images branch after script; motion/processing feed video; assembly retry reuses every artifact |   |
| 60 | two schedulers share the SQL pool cap and never claim the same paid job |   |
| 69 | leases renew only their own token; stale completion cannot overwrite a replacement result |   |
| 76 | expired work fails explicitly; enqueue and pump never silently replay it; retry is owner scoped |   |
| 84 | a live attempt survives a clock jump; a second scheduler that recovers it fences the late result |   |
| 95 | a stop-time failure is an interruption unless the handler says it is terminal or it drains |   |
| 104 | a claim released before its handler starts does not count as an attempt |   |
| 111 | a database error before the handler starts makes no paid call and is not a job failure |   |
| 119 | completed timing is saved with the receipt and retained across queue instances and retries |   |

#### tests/production-stages.test.mjs

[tests/production-stages.test.mjs](../tests/production-stages.test.mjs) — 2 declarations.

Domains: production; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 7 | seven steps distinguish initial review, targeted repair, recheck, skipped work and legacy stories |   |
| 30 | acceptance blockers mark the audit that produced them without erasing completed repairs |   |

#### tests/queue-image-recovery.test.mjs

[tests/queue-image-recovery.test.mjs](../tests/queue-image-recovery.test.mjs) — 19 declarations.

Domains: production; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 46 | `a ${name} file at publication asks first, then redraws only on explicit retry` | for(const [name,outcome] of Object.entries(unreadable))test(`a ${name} file at publication asks first, then redraws only on explicit retry`,async t=&gt;{  |
| 62 | `a ${damage} first image fails the next page before paying, and retry redraws only it` | for(const damage of ['missing','corrupt'])test(`a ${damage} first image fails the next page before paying, and retry redraws only it`,async t=&gt;{  |
| 78 | an invalid saved image result is treated as lost, and redraws only on explicit retry |   |
| 87 | publication requires the bytes to match the file type; a reference only needs a usable image |   |
| 100 | a file that comes back before the retry is published without paying again |   |
| 108 | a read that throws stays transient without redrawing, even at retry |   |
| 122 | mixed lost and transient failures prioritize the redraw action |   |
| 132 | an open story draws its first image, current page and read-ahead ahead of other work |   |
| 140 | a viewed first image goes ahead of an older story's waiting first image |   |
| 148 | only the current page and six after it go ahead of unread stories |   |
| 159 | moving to another page changes what comes next without cancelling the running page |   |
| 167 | closing the story returns it to page order, and it keeps generating |   |
| 178 | a lost connection returns the story to background order, and it keeps generating |   |
| 188 | without a reader, order stays by page across stories |   |
| 196 | the legacy client never retries a lost image automatically |   |
| 203 | `a non-retry request against a ${state} story starts nothing` | for(const state of ['failed','paused','stopped'])test(`a non-retry request against a ${state} story starts nothing`,async t=&gt;{  |
| 235 | `${name} ends the hold on other stories` | for(const [name,act] of [  |
| 242 | a viewed first image still drawing leaves spare workers free for other stories |   |
| 253 | two viewed stories both finish |   |

#### tests/queue-image-versions.test.mjs

[tests/queue-image-versions.test.mjs](../tests/queue-image-versions.test.mjs) — 8 declarations.

Domains: production; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 14 | explicit retry publishes the current paid result over a stale slot once, without redrawing |   |
| 44 | an old in-flight image cannot publish late or start its queued siblings after inputs change |   |
| 64 | publication rechecks its version after an awaited file read |   |
| 81 | a reference read cannot start paid drawing after the image inputs become obsolete |   |
| 98 | sibling publications that read the same document both save without duplicate usage |   |
| 118 | publication CAS rejects a plan change after its final read |   |
| 142 | obsolete cleanup preserves a real current failure and never retries it |   |
| 158 | `obsolete failed jobs release their saved error while retaining ${generationControl} control` | for(const generationControl of ['active','paused','stopped'])test(`obsolete failed jobs release their saved error while retaining ${generationControl} control`,async t=&gt;{  |

#### tests/queue-interruption.test.mjs

[tests/queue-interruption.test.mjs](../tests/queue-interruption.test.mjs) — 22 declarations.

Domains: production; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 45 | quitting during an image resumes after restart without a retry or provider error |   |
| 52 | quitting during script work resumes planning without a retry |   |
| 63 | `quitting after ${action} keeps the control, and Resume continues without a retry` | for(const action of ['pause','stop'])test(`quitting after ${action} keeps the control, and Resume continues without a retry`,async t=&gt;{  |
| 73 | quitting during frame-count preparation resumes it without a retry |   |
| 84 | quitting with saved pages redraws only the interrupted pages |   |
| 93 | `quitting after ${action} during script work keeps the control, and Resume plans again` | for(const action of ['pause','stop'])test(`quitting after ${action} during script work keeps the control, and Resume plans again`,async t=&gt;{  |
| 104 | a deterministic 4xx in script work during a stop stays failed without replaying |   |
| 116 | a blocked review during a stop stays failed and never repairs automatically |   |
| 130 | a real provider failure while running is not treated as an interruption |   |
| 138 | a transient tick error stops one cycle only and logs once |   |
| 151 | no paid work starts while the claim cannot be written, and work resumes when it can |   |
| 160 | a tick error during shutdown still closes the database, and work resumes next start |   |
| 174 | one failed tick during shutdown does not stop the drain: finished work is still published |   |
| 191 | `a story with ${name} parks alone: other stories finish and the shelf loads` | for(const [name,corrupt] of [  |
| 207 | a queued text job for an unreadable document makes no paid plan call |   |
| 220 | a failed success write is not a provider failure and recovers as an interruption |   |
| 233 | a failed failure write does not stop the queue or report a provider failure |   |
| 245 | a failed checkpoint save during script work is not a provider failure and recovers |   |
| 257 | a publication write error recovers without paying for the image again |   |
| 269 | a clock jump during a live call keeps its claims, saves its result and pays once |   |
| 284 | results arriving after a clock jump, before any tick renews the claims, are still saved |   |
| 300 | automatic recovery stops at three attempts, and a retry restores the allowance |   |

#### tests/reader-production.test.mjs

[tests/reader-production.test.mjs](../tests/reader-production.test.mjs) — 21 declarations.

Domains: production; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 17 | `${provider}: early demand, single anchor, rolling refill, individual visibility and moving lookahead` | for(const provider of flowProviders(['codex','gemini']))test(`${provider}: early demand, single anchor, rolling refill, individual visibility and moving lookahead`,async t=&gt;{  |
| 34 | image concurrency is configurable and global across stories; text/source are not repeated |   |
| 43 | one viewer leaving preserves another; all leaving drains paid results and pauses new generation |   |
| 52 | expired viewer demand stops dispatch even if the browser never sends leave |   |
| 60 | deletion hides a story immediately while retaining every in-flight image and receipt |   |
| 69 | local publication failure and legacy retry reuse the paid receipt and record usage once |   |
| 82 | paid failure stops refill, keeps sibling successes and retry only draws missing scenes |   |
| 91 | restart before viewer expiry never resumes paid work until a fresh viewer request |   |
| 98 | session and job heartbeats fence legacy advances while slow images are still running |   |
| 107 | `${provider}: step timing uses the persisted production claim across reads and renewals` | for(const [provider,timeout] of [['codex',900000],['gemini',900000]])test(`${provider}: step timing uses the persisted production claim across reads and renewals`,async t=&gt;{  |
| 133 | shutdown stops dispatch before draining in-flight outputs and closes SQLite after publication |   |
| 139 | queue routes validate input/origin and use server owner identity |   |
| 147 | reference validation accepts reordered same-story assets and rejects malformed or out-of-range paths |   |
| 158 | `${provider}: reordered story resumes at page 11 after restart without regenerating ten saved images` | for(const provider of flowProviders(['codex','gemini']))test(`${provider}: reordered story resumes at page 11 after restart without regenerating ten saved images`,async t=&gt;{  |
| 183 | `${provider}: immutable attempts and exact same-story anchor validation protect replacement bytes` | for(const provider of flowProviders(['codex','gemini']))test(`${provider}: immutable attempts and exact same-story anchor validation protect replacement bytes`,async t=&gt;{  |
| 210 | publication must own its job token as well as the session token |   |
| 221 | `${provider}: legacy numeric confirmation gates paid script/images before planning` | for(const provider of flowProviders(['codex','gemini']))test(`${provider}: legacy numeric confirmation gates paid script/images before planning`,async t=&gt;{  |
| 236 | slow script preparation renews its session lease and excludes a legacy planner |   |
| 248 | deleted pending publication with an expired pre-restart lease cannot poison another story |   |
| 261 | shrinking lookahead after backtracking reports a full buffer idle despite outstanding later jobs |   |
| 270 | completed step durations survive the next stage, fresh reads and service restart |   |

#### tests/reader-revisions.test.mjs

[tests/reader-revisions.test.mjs](../tests/reader-revisions.test.mjs) — 16 declarations.

Domains: production; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 18 | image dependencies exclude narration, include scene/anchor/global inputs, and reject ambiguous edit scopes |   |
| 37 | image-only redraw validates page selection and cannot conceal content edits |   |
| 46 | `${provider}: image-only redraw replaces selected pages including anchor without review or touching other images` | for(const provider of flowProviders(['codex','gemini']))test(`${provider}: image-only redraw replaces selected pages including anchor without review or touching other images`,async  |
| 72 | image-only redraw refuses an unreviewed story and missing unselected media without starting work |   |
| 84 | `${provider}: caption-only revision reuses every copied image, original and deleted-parent independence` | for(const provider of flowProviders(['codex','gemini']))test(`${provider}: caption-only revision reuses every copied image, original and deleted-parent independence`,async t=&gt;{  |
| 101 | one scene change redraws only that image, with copied anchor; first scene change redraws all |   |
| 110 | late parent image writes remain isolated and derived eligibility blocks additional old dispatch |   |
| 119 | family epoch serializes concurrent drafts; identical request replay is stable, changed replay is rejected |   |
| 132 | invalid inputs, unchanged drafts, stale parent, and cross-owner IDs never create a child or write copied media |   |
| 147 | `reusable ${kind} asset ${kind==='transient'?'stops the submission':'is redrawn in the new version'}` | for(const kind of ['missing','corrupt','transient'])test(`reusable ${kind} asset ${kind==='transient'?'stops the submission':'is redrawn in the new version'}`,async t=&gt;{  |
| 159 | `${provider}: style changes preserve planning and review; requirements and counts re-audit` | for(const provider of flowProviders(['codex','gemini']))test(`${provider}: style changes preserve planning and review; requirements and counts re-audit`,async t=&gt;{  |
| 174 | review repair invalidates newly changed staging but preserves caption-only repair images |   |
| 183 | atomic active child survives restart and deleted parent; lost response replays without duplicate copy or generation |   |
| 192 | failed publication INSERT leaves no child and replay publishes one active version |   |
| 200 | new queue: copied anchor loss warns without paying, explicit retry redraws only anchor and edited scene |   |
| 214 | new queue: lost revision publication only redraws its own edited page after retry |   |

#### tests/release-smoke.playwright.e2e.mjs

[tests/release-smoke.playwright.e2e.mjs](../tests/release-smoke.playwright.e2e.mjs) — 1 declarations.

Domains: production, reader, preparation, review, media, discovery; level: `browser-e2e`; cost: `heavy`; platforms: darwin, linux, win32; suite: `e2e`; PR: `affected`; gates: release, npm. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 4 | STORY-LIFECYCLE-C001: create, wait, extract, edit preparation, confirm and read |  {timeout:180000} |

#### tests/shared-library.test.mjs

[tests/shared-library.test.mjs](../tests/shared-library.test.mjs) — 1 declarations.

Domains: production; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 8 | direct desktop and development share stories/media/progress and exclude duplicate generation |   |

#### tests/story-flow-control.test.mjs

[tests/story-flow-control.test.mjs](../tests/story-flow-control.test.mjs) — 32 declarations.

Domains: production; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: user-flows. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 33 | images and progress never invalidate a draft on a story still drawing |   |
| 43 | a real change conflicts, and the same submission stays idempotent |   |
| 52 | a blocked story shows every issue, can be edited, and draws on the reader's word exactly once |   |
| 71 | a paused failed review can be explicitly accepted without rerunning or changing the script |   |
| 92 | a blocked revision that reused its first image can still be drawn past |   |
| 105 | repeating draw anyway cannot redraw a failed image or clear its marker |   |
| 116 | a lost image is redrawn in the new version rather than blocking it |   |
| 133 | a lost first image redraws everything, and an unreadable one creates nothing |   |
| 145 | review changing the first frame reports the real redraw count; no preview, no notice |   |
| 156 | searching leaves preparation alone, and neither loses the other's saved state |   |
| 170 | a queued preparation survives a search requested before it starts |   |
| 179 | a held search allows another story and its own preparation to finish while a second search waits |   |
| 200 | observing a choice survives a dropped connection |   |
| 211 | a failed search leaves a prepared story confirmable without repeating any work |   |
| 222 | a candidate can be chosen while a search runs, and the late result is refused |   |
| 230 | confirming ends the search: nothing queued starts and nothing late is added |   |
| 246 | clicking the selected story redoes nothing; a stale device can retry from what is saved |   |
| 257 | queued preparation fills missing art before confirmation without duplicating work after a style update |   |
| 276 | art recommendations apply until the reader really changes the style |   |
| 285 | saved settings survive search, restart and re-preparation, and confirmation applies the draft |   |
| 298 | `${name} stops a search between calls and frees the text slot` | for(const [name,stop] of [['pause',(f,id)=&gt;f.json(`sessions/${id}/production-control`,'POST',{action:'pause'})],['delete',(f,id)=&gt;f.json(`library/${id}`,'DELETE')]])test(`${name} s  |
| 311 | a paused search reads as waiting, not running |   |
| 318 | a clean stop between calls resumes after restart without spending an attempt |   |
| 326 | a call killed by a stop counts as an interruption, resumes after restart and is capped |   |
| 347 | an interrupted search on a paused story waits instead of failing |   |
| 355 | retry restores only the current selection; superseded jobs leave the queue |   |
| 367 | superseded jobs leave the queue on finished, paused and deleted stories too |   |
| 381 | a dead lock on a paused story blocks nothing and does not resume it; confirming still starts it |   |
| 393 | a preparation whose receipt was lost after saving settles instead of cycling |   |
| 400 | a story without intake never gains one from a worker save |   |
| 405 | a discovering record an older release wrote still finds its stories |   |
| 422 | the migration carries saved searches over without new work or lost choices |   |

#### tests/story-generation-membership.test.mjs

[tests/story-generation-membership.test.mjs](../tests/story-generation-membership.test.mjs) — 7 declarations.

Domains: production; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 30 | an initial history deep link does not invalidate the authoritative latest list |   |
| 37 | reading history after deleting the latest card cannot resurrect the family |   |
| 42 | restoring a historical snapshot only admits members returned by the latest list |   |
| 48 | a blocked address update does not reject a saved story or invite another creation |   |
| 61 | a lost creation response retries the same saved story even when address updates are blocked |   |
| 77 | renaming updates the shelf and active story without replaying reading progress or starting production |   |
| 94 | separate successful creation actions can still create independent stories |   |

#### tests/story-generation-state-machine-client.test.mjs

[tests/story-generation-state-machine-client.test.mjs](../tests/story-generation-state-machine-client.test.mjs) — 1 declarations.

Domains: production; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 9 | an explicit first-image retry renews reader demand after restart without another authorization |   |

#### tests/story-generation-state-machine-commands.test.mjs

[tests/story-generation-state-machine-commands.test.mjs](../tests/story-generation-state-machine-commands.test.mjs) — 8 declarations.

Domains: production; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 17 | one durable recovery command cannot pay again after its response is lost and work fails again |   |
| 31 | two different commands cannot claim the same failure, and mismatched replay is rejected |   |
| 42 | migration removes display title from existing identities without resetting paid receipts or failures |   |
| 61 | restarting an accepted recovery shares its three interrupted attempts; replay cannot reset the cap |   |
| 73 | an image-loss insert revokes completed atomically without a second application write |   |
| 79 | an already-upgraded library keeps an older display-name failure as an independent legacy block |   |
| 91 | restored complete checkpoints settle atomically even while paused and without a subsequent request |   |
| 97 | cross-table request ID guards close the race after two connections have both read no receipt |   |

#### tests/story-generation-state-machine-flow.test.mjs

[tests/story-generation-state-machine-flow.test.mjs](../tests/story-generation-state-machine-flow.test.mjs) — 16 declarations.

Domains: production; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: user-flows. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 14 | renaming a running image preserves task identity and does not buy a duplicate anchor |   |
| 20 | real failed work needs a current fault authorization; replay after another failure never spends again |   |
| 33 | two images lost after completion can recover separately without clearing or blocking the other fault |   |
| 43 | restored files are reused by both health checks and a durable redraw command without inference |   |
| 51 | temporary storage errors and stale image reports cannot create redraw permission; truncated images do |   |
| 59 | first-image loss preserves in-flight work, blocks new dependent calls and survives pause/restart |   |
| 68 | independent publication recovery does not draw or clear an unrelated missing image |   |
| 76 | a lost paid publication file requires a new explicit redraw rather than upgrading save authorization |   |
| 86 | independent recoveries can run together; first-image loss fences nonfirst redraws |   |
| 94 | control request replay cannot undo a later pause; concurrent fault grants spend only once across restart |   |
| 105 | checking a restored anchor settles only its pre-inference dependent failure and completes without a retry |   |
| 112 | restoring a file after a new ordinary redraw failure preserves its fault until an explicit free reuse |   |
| 119 | creation binds immutable parameters and request IDs cannot be reused across actions |   |
| 126 | `healthy restored files complete locally with ${action} and no viewers` | for(const action of ['pause','stop','reader'])test(`healthy restored files complete locally with ${action} and no viewers`,async t=&gt;{  |
| 133 | a display-title change during publication cannot fail the already-paid image |   |
| 139 | an uncertain reference read cannot reach a provider that has a separately readable media handle |   |

#### tests/story-generation-state-machine-reselection.test.mjs

[tests/story-generation-state-machine-reselection.test.mjs](../tests/story-generation-state-machine-reselection.test.mjs) — 10 declarations.

Domains: production; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: user-flows. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 22 | opening and cancelling selection drafts never adds a shelf card; cancellation returns the current saved state |   |
| 30 | another story replaces one family card, leaves history intact, rejects old editing and replays without reactivation |   |
| 44 | a pause arriving after the picker opens is inherited at commit, and only explicit resume prepares |   |
| 55 | same source selection is a durable no-op, including replay after the draft is discarded |   |
| 63 | concurrent ordinary edit and replacement share one family CAS; stale choice remains inspectable |   |
| 70 | cancel follows another window current version and never revives a deleted latest version |   |
| 76 | `replacement of a ${stopped?'stopped':'failed active'} story inherits current control but clears only the new work` | for(const stopped of [false,true])test(`replacement of a ${stopped?'stopped':'failed active'} story inherits current control but clears only the new work`,async t=&gt;{  |
| 84 | cancel after old in-flight completion returns its new saved checkpoint without resetting it |   |
| 89 | a matching title without verifiable source identity is not silently discarded as the current story |   |
| 93 | a committed replacement occupies its request ID across families and command kinds |   |

#### tests/story-generation-state-machine.e2e.mjs

[tests/story-generation-state-machine.e2e.mjs](../tests/story-generation-state-machine.e2e.mjs) — 1 declarations.

Domains: production; level: `service-e2e`; cost: `standard`; platforms: darwin, linux, win32; suite: `e2e`; PR: `affected`; gates: user-flows, release, npm. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 8 | lost HTTP recovery reply, restart and old replay cannot buy another attempt or revive a paused version |   |

#### tests/story-lifecycle.playwright.e2e.mjs

[tests/story-lifecycle.playwright.e2e.mjs](../tests/story-lifecycle.playwright.e2e.mjs) — 9 declarations.

Domains: production, reader, preparation, review, media, discovery; level: `browser-e2e`; cost: `heavy`; platforms: darwin, linux, win32; suite: `e2e`; PR: `affected`; gates: user-flows. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 14 | STORY-LIFECYCLE-C001: create, wait, extract, edit preparation, confirm and read |  options |
| 15 | STORY-LIFECYCLE-C002: all edit paths preserve one family, history and eligible images |  options |
| 50 | STORY-LIFECYCLE-C003: pause drains in-flight work, refresh stays paused, explicit resume completes |  options |
| 58 | STORY-LIFECYCLE-C004: failure survives observation and only a retry link authorizes a new attempt |  options |
| 66 | STORY-LIFECYCLE-C005: replacement waits, cancel conserves parent, choosing commits one new version |  options |
| 77 | `STORY-LIFECYCLE-C004-${manual?'review-edit':'review-override'}: blocked audit requires an explicit user decision before drawing` | for(const manual of [true,false])test(`STORY-LIFECYCLE-C004-${manual?'review-edit':'review-override'}: blocked audit requires an explicit user decision before drawing`,options,asyn options |
| 96 | STORY-LIFECYCLE-C006: one workflow panel survives first artwork and is shared with reading while shelf stays a reader entry |  options |
| 135 | STORY-LIFECYCLE-C007: shelf cards keep reading and the reader gear opens the workflow without generating |  options |
| 154 | STORY-LIFECYCLE-C008: all shelf and reader entries share one settings layout through generation |  options |

#### tests/story-revision-flow.test.mjs

[tests/story-revision-flow.test.mjs](../tests/story-revision-flow.test.mjs) — 6 declarations.

Domains: production; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 44 | `saving manual review corrections re-audits first and ${passes?'continues drawing on approval':'keeps drawing blocked on rejection'}` | for(const passes of [true,false])test(`saving manual review corrections re-audits first and ${passes?'continues drawing on approval':'keeps drawing blocked on rejection'}`,async t=  |
| 65 | review edit targets survive initial loading, reopening and ending selection without submitting |   |
| 78 | style-only blocked revisions retain one recoverable fault through replay and restart, then explicit acceptance completes once |   |
| 102 | completed story count edits remain a draft until confirmation starts the new version |   |
| 119 | retrying explicit production after a lost response uses the same version |   |
| 132 | paused edits stay stopped until resume applies them and continues generation |   |

### reader

#### tests/empty-library.test.mjs

[tests/empty-library.test.mjs](../tests/empty-library.test.mjs) — 2 declarations.

Domains: reader; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 21 | fresh/reopened libraries contain no stories or demo artwork and expose no studio endpoints |   |
| 37 | saved stories, progress and uploaded media survive reopen through the standard media API |   |

#### tests/reader-generation.test.mjs

[tests/reader-generation.test.mjs](../tests/reader-generation.test.mjs) — 43 declarations.

Domains: reader; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 23 | client automatically recovers planning, source and each image without delays or repeating completed work |   |
| 34 | persistent failure exhausts two automatic retries and page changes cannot reset its budget |   |
| 44 | lost advance responses re-read the saved checkpoint and do not regenerate completed images |   |
| 51 | transport outages are bounded and leaving a story stops automatic recovery |   |
| 60 | running checkpoints are polled and leaving during a poll issues no further requests |   |
| 67 | sessions are owner-scoped and client retries reuse a single session |   |
| 68 | new stories have no rolling daily cap, including concurrent starts |   |
| 81 | concurrent advances cannot duplicate a paid planning request |   |
| 82 | only requested scenes are generated; completed scenes are reused and progress is separate |   |
| 83 | paid image retries resume immediately when requested and reuse saved work |   |
| 100 | planning can recover after the former cap and only one concurrent retry acquires the checkpoint |   |
| 115 | stale requests become explicit failures instead of silently issuing another call |   |
| 116 | an outdated checkpoint cannot acquire the same completed step again |   |
| 119 | generation saves the original before drawing and keeps it on later checkpoints and reads |   |
| 132 | unavailable original blocks summary and planning, and recovery saves each paid result once |   |
| 143 | legacy backfill preserves images and progress and rejects an outdated document or active generation |   |
| 154 | saving a recovered original clears source failure while preserving an image failure for manual retry |   |
| 165 | source recovery remains explicit after repeated outages and never repeats the paid plan |   |
| 188 | `legacy URL ${length} prepares source and summary before its directory and reuses them` | for(const length of ['auto',45])test(`legacy URL ${length} prepares source and summary before its directory and reuses them`,async()=&gt;{  |
| 204 | a URL without a verifiable original cannot start summary or directory inference |   |
| 210 | Gemini allows fifteen minutes for both storyboard and image generation |   |
| 219 | Gemini plans structured scenes and Nano Banana carries the first picture into subsequent scenes |   |
| 235 | Gemini failures are redacted, not retried, and never fall back to a different paid provider |   |
| 244 | book suggestions preserve selected book and custom theme; stale URL fields are ignored |   |
| 249 | URL suggestions and plans fail closed when source retrieval is absent or failed |   |
| 259 | Nano Banana stores the actual MIME type and refuses missing anchors or invalid images |   |
| 268 | blocked, truncated and malformed output never becomes a ready page or plan |   |
| 277 | narration stays off even when an old client or saved session requests it |   |
| 289 | chosen art direction persists across resume and reaches every image call |   |
| 303 | new art styles pass validation and reach planning and image generation without pencil fallback |   |
| 316 | five story choices are requested and accepted without inventing a missing source |   |
| 328 | production requirements persist on the story and reach planning and each picture |   |
| 347 | new batches pass exclusions to Gemini and remove repeated or renamed titles |   |
| 354 | soft deletion is owner-scoped, durable and does not erase content or block new stories |   |
| 370 | deleting during a paid step retains its result but cannot resume or resurrect the story |   |
| 379 | unknown retired identities cannot enter current reader library actions |   |
| 388 | restoring preserves content and progress without reactivating deleted generation |   |
| 400 | restoring a current story leaves the other owner’s deletion markers untouched |   |
| 424 | preparation recommends each chosen story and durably reuses its art on reselection |   |
| 436 | an in-flight art result preserves a manual draft and concurrently appended search results |   |
| 451 | a saved manual style survives later story recommendations |   |
| 459 | frame recommendation retries reuse saved art and art failures never pretend a default was recommended |   |
| 471 | a replaced generation rejects an in-flight art result |   |

#### tests/reader-image-health.test.mjs

[tests/reader-image-health.test.mjs](../tests/reader-image-health.test.mjs) — 2 declarations.

Domains: reader; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 7 | `offline image health decodes ${name}` | for(const name of ['portrait.png','portrait.jpg','portrait-progressive.jpg','portrait.webp','portrait-lossy.webp','alpha.webp'])test(`offline image health decodes ${name}`,async()=  |
| 8 | `${format}: valid dimensions cannot hide corrupt pixel data or reuse a healthy cache entry` | for(const [name,format] of [['portrait.png','png'],['portrait.jpg','jpeg'],['portrait-lossy.webp','webp']])test(`${format}: valid dimensions cannot hide corrupt pixel data or reuse  |

#### tests/reader-interaction.test.mjs

[tests/reader-interaction.test.mjs](../tests/reader-interaction.test.mjs) — 12 declarations.

Domains: reader; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 6 | scene edge clicks use the outer quarters of the reader, not the viewport |   |
| 22 | trackpad rebound cannot reverse or skip a page within the same gesture |   |
| 29 | mouse wheel units, small movements and cross-axis jitter are handled consistently |   |
| 36 | themes share source-faithful production defaults while reader-written requirements remain intact |   |
| 56 | batch history isolates book, custom source and theme without splitting on style or length |   |
| 63 | PDF refuses incomplete stories and wraps Chinese, newlines and long links without losing content |   |
| 75 | home hero resumes the last viewed story and stays empty for new or missing history |   |
| 86 | touch swipes support four directions while ignoring taps and ambiguous diagonals |   |
| 93 | recent carousel keeps ten distinct readable stories, newest reading first, and resumes each page |   |
| 105 | server favorite resets replace newer browser flags without discarding the latest reading position |   |
| 113 | published and generated progress hydration reconcile favorite flags regardless of response order |   |
| 125 | direct source selection drops inherited theme directions and preserves authored production requirements |   |

#### tests/reader-production-client.test.mjs

[tests/reader-production-client.test.mjs](../tests/reader-production-client.test.mjs) — 20 declarations.

Domains: reader; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 6 | LAN HTTP without crypto.randomUUID still automatically requests the next story with a valid UUID |   |
| 15 | automatic discovery stops on an uncertain POST response and releases its viewer without repeating it |   |
| 22 | empty, failed, paused, capped and selected pickers never automatically request another story |   |
| 30 | a full buffer keeps its viewer alive, page changes update demand, and leaving releases only that viewer |   |
| 39 | ordinary failure observation never automatically retries paid work |   |
| 43 | review continuation sends one explicit immutable fault authorization |   |
| 51 | accepted but lost recovery responses replay the same grant after a new failure |   |
| 58 | connection failure after starting demand still sends leave; lost leave falls back to server lease expiry |   |
| 64 | awaiting count confirmation releases demand without issuing storyboard or image requests |   |
| 70 | inspecting stopped and failed checkpoints only polls snapshots and reflects external changes |   |
| 80 | inspection connection errors never dispatch work and late snapshots cannot update a closed dialog |   |
| 87 | inspecting a count confirmation releases the observation so the user can choose a frame count |   |
| 92 | explicit recovery retains its request ID across transport loss and reads progress |   |
| 98 | `viewer loop stops dispatch and automatic retries for ${JSON.stringify(fields)}` | for(const fields of [{generationControl:'paused'},{generationControl:'stopped'},{generationMode:'background'}])test(`viewer loop stops dispatch and automatic retries for ${JSON.str  |
| 106 | mode changes and manual resume preserve failed stories as observations until explicit Retry |   |
| 123 | an open active story reports its page for priority, follows page changes and leaves on exit |   |
| 134 | priority reports clamp a stale page and use page 0 before the first image exists |   |
| 142 | a story that is not actively generating never reports a page |   |
| 150 | a failed or hung priority report never interrupts status updates or exit |   |
| 158 | a lost image is read only until an explicit scoped recovery |   |

#### tests/reader-prompt-format.test.mjs

[tests/reader-prompt-format.test.mjs](../tests/reader-prompt-format.test.mjs) — 7 declarations.

Domains: reader; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 21 | task, numbered rule groups and boundary/output labels use readable paragraphs and lists |   |
| 28 | existing step numbering, quoted phrases, numeric limits and JSON field identifiers retain wording |   |
| 33 | all active system rule text and section order remain identical after removing layout markers |   |
| 37 | plain native instructions and empty sections need no invented content |   |
| 42 | new previews/captures share the dispatch layout while historical records and arbitrary inputs stay exact |   |
| 48 | archives share only byte-identical historical system rules and preserve every actual input and receipt origin |   |
| 71 | deduplicating repeated system rules avoids the 1 MiB metadata limit without dropping call inputs |   |

#### tests/reader-request.test.mjs

[tests/reader-request.test.mjs](../tests/reader-request.test.mjs) — 8 declarations.

Domains: reader; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 7 | a read recovers from a disconnected server and a restarting proxy |   |
| 19 | an interrupted JSON body is retried before displaying a loading error |   |
| 24 | persistent read failures stop after a bounded number of attempts |   |
| 29 | `a stalled ${body?'JSON body':'connection'} times out and the next refresh can succeed` | for(const body of [false,true])test(`a stalled ${body?'JSON body':'connection'} times out and the next refresh can succeed`,async t=&gt;{  |
| 48 | read retries share a deadline instead of extending a stalled refresh indefinitely |   |
| 62 | missing or unauthorized stories are not retried |   |
| 69 | generation, deletion and progress writes are never replayed after failures |   |
| 76 | writes retain multipart bodies and server error messages |   |

#### tests/reader-snapshots.test.mjs

[tests/reader-snapshots.test.mjs](../tests/reader-snapshots.test.mjs) — 4 declarations.

Domains: reader; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 6 | identical poll rows return the previous array |   |
| 12 | changed rows are replaced while unchanged rows keep their identity |   |
| 21 | reordered, added and removed rows produce a new array |   |
| 29 | single snapshots keep the previous value only when equal |   |

#### tests/reader-source-runtime.test.mjs

[tests/reader-source-runtime.test.mjs](../tests/reader-source-runtime.test.mjs) — 2 declarations.

Domains: reader; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 13 | uncached lookup uses native Node fetch and reads the selected chapter |   |
| 20 | native fetch does not follow upstream redirects to another endpoint |   |

#### tests/reader-source.test.mjs

[tests/reader-source.test.mjs](../tests/reader-source.test.mjs) — 11 declarations.

Domains: reader; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 9 | numbered citations resolve to the edition chapter title instead of prose page names |   |
| 19 | the two deployed failures have revision-linked originals during a complete source outage |   |
| 28 | numbered chapters can be fetched and accepted without invoking search |   |
| 37 | generation persists source text and future calls reuse the story cache without external retrieval |   |
| 46 | existing generated Cao E story gains verified original without regenerating or relying on the inaccurate item number |   |
| 55 | original chapter is retrieved as text from a matching book and traditional titles are recognized |   |
| 62 | all existing story topics can read checked excerpts even while the remote API is unavailable |   |
| 69 | search fallback requires the same book and a matching chapter heading |   |
| 74 | unavailable or mismatched source stays explicit and never becomes invented original text |   |
| 82 | source failures distinguish network, timeout and invalid response without exposing upstream details |   |
| 88 | custom URLs cannot turn original lookup into arbitrary server-side fetches |   |

#### tests/reader-startup.e2e.mjs

[tests/reader-startup.e2e.mjs](../tests/reader-startup.e2e.mjs) — 1 declarations.

Domains: reader; level: `browser-e2e`; cost: `heavy`; platforms: darwin, linux, win32; suite: `e2e`; PR: `affected`; gates: user-flows. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 9 | `startup waits for ${delayed}, reads the library once, and ignores cached studio history` | for(const delayed of ['sessions','deletions'])test(`startup waits for ${delayed}, reads the library once, and ignores cached studio history`,async t=&gt;{  |

#### tests/reading-cache.test.mjs

[tests/reading-cache.test.mjs](../tests/reading-cache.test.mjs) — 3 declarations.

Domains: reader; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 12 | valid inventory keeps every current revision/trash payload and shared media, removes retired/foreign payloads |   |
| 18 | 'incomplete or invalid metadata never changes caches: '+JSON.stringify(inventory) | for(const inventory of [null,[],{currentStoryIds:[],deletions:[]},{complete:false,currentStoryIds:[],deletions:[]},{complete:true,currentStoryIds:[3],deletions:[]}])test('incomplet  |
| 21 | a valid empty inventory clears retired payloads while keeping shared media |   |

#### tests/recent-stories-ui.test.mjs

[tests/recent-stories-ui.test.mjs](../tests/recent-stories-ui.test.mjs) — 3 declarations.

Domains: reader; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 18 | loading hides both cached story cards and the first-use empty state |   |
| 27 | settled history shows the resume card or the first-use empty state |   |
| 37 | a story read to its last frame offers a restart instead of resuming |   |

#### tests/review-history-ui.test.mjs

[tests/review-history-ui.test.mjs](../tests/review-history-ui.test.mjs) — 4 declarations.

Domains: reader; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 12 | unknown acceptance results are visible and do not look like an approved audit |   |
| 17 | old missing text and unordered entries are explicit; overrides never become made-up events |   |
| 22 | structural history shows old and new frame numbers, captions and expandable prompts |   |
| 26 | empty current versions explain the parent option and report text remains escaped |   |

#### tests/shelf-art-style.test.mjs

[tests/shelf-art-style.test.mjs](../tests/shelf-art-style.test.mjs) — 2 declarations.

Domains: reader; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 17 | saved setup art style drives shelf tags, search and grouping before confirmation |   |
| 42 | shelf falls back to the production style without a draft and ignores obsolete confirmed drafts |   |

#### tests/shelf-browser.test.mjs

[tests/shelf-browser.test.mjs](../tests/shelf-browser.test.mjs) — 3 declarations.

Domains: reader; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 10 | search matches title, source book, theme and art style, including combined keywords |   |
| 17 | book groups collect matching stories in original reading order and omit empty search groups |   |
| 24 | theme, art style and processing groups preserve each story and its reading order |   |

#### tests/shelf-favorites.test.mjs

[tests/shelf-favorites.test.mjs](../tests/shelf-favorites.test.mjs) — 2 declarations.

Domains: reader; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 10 | pending and readable generated stories can be favorited without changing progress or starting generation |   |
| 34 | current favorites preserve existing reading progress and reject cross-origin, deleted and malformed requests |   |

#### tests/shelf-generation.test.mjs

[tests/shelf-generation.test.mjs](../tests/shelf-generation.test.mjs) — 5 declarations.

Domains: reader; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 9 | shelf actions distinguish execution, queueing, user decisions, failure and pause |   |
| 34 | shelf refresh reports running and queued work without dispatch or viewer renewal |   |
| 62 | shelf refresh exposes choice and failure states without retrying |   |
| 76 | viewing a saved failure preserves its attempt count until an explicit retry resumes generation |   |
| 95 | production rows list user decisions and failures before running, queued and paused work, keeping order within a status |   |

#### tests/shelf-layout-ui.test.mjs

[tests/shelf-layout-ui.test.mjs](../tests/shelf-layout-ui.test.mjs) — 4 declarations.

Domains: reader; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 20 | unfinished productions come first as rows, ordered by what needs the user, each with at most one control |   |
| 40 | a long production list shows needs-you rows plus up to five in total, and a search shows every match |   |
| 51 | readable cards are the same size in single-story groups and show finished reading |   |
| 67 | filters apply to both regions; production-only shelves explain where stories will appear |   |

#### tests/shelf-retry-ui.test.mjs

[tests/shelf-retry-ui.test.mjs](../tests/shelf-retry-ui.test.mjs) — 5 declarations.

Domains: reader; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 25 | failed compact, full-width and pending cards show one retry action instead of pause |   |
| 34 | retry dispatches the existing session and is disabled during conflicting shelf operations |   |
| 43 | manual pause and stop retain resume; running cards retain pause; completed cards have neither |   |
| 54 | a failure with no retryable step does not offer pause or dispatch recovery |   |
| 60 | cover overlay actions are independent while the cover and title keep reading |   |

#### tests/story-publication-ui.test.mjs

[tests/story-publication-ui.test.mjs](../tests/story-publication-ui.test.mjs) — 10 declarations.

Domains: reader; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 45 | settings show the resolved default author, refresh on return and keep explicit work credits |   |
| 62 | settings distinguish a failed lookup from an unsigned work and allow retry |   |
| 71 | late default reads cannot replace a newer name or flash the previous story author |   |
| 83 | restore fetches current defaults, locks duplicate requests and changes all draft fields without saving |   |
| 99 | a failed restore keeps local edits and retry reads latest defaults; missing defaults restore to blank |   |
| 114 | watermark sizing shows a 24px default and saves an independent single-story value |   |
| 125 | `${format}: every output attempt rechecks defaults before unsigned consent` | for(const format of ['pdf','png','zip'])test(`${format}: every output attempt rechecks defaults before unsigned consent`,async()=&gt;{  |
| 145 | `${format}: live defaults fill blank work fields, refresh on repeated download and preserve explicit overrides` | for(const format of ['pdf','png','zip'])test(`${format}: live defaults fill blank work fields, refresh on repeated download and preserve explicit overrides`,async()=&gt;{  |
| 159 | preflight blocks duplicate clicks, fails without exporting on read errors and can retry |   |
| 171 | continuing from unsigned confirmation rechecks a default name saved while the dialog was open |   |

#### tests/story-requirements-ui.test.mjs

[tests/story-requirements-ui.test.mjs](../tests/story-requirements-ui.test.mjs) — 4 declarations.

Domains: reader; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 13 | production and acceptance are sibling links/tabs; acceptance editing is an independent local patch |   |
| 20 | prompt history distinguishes inherited/current records, previews and missing history; model data is escaped |   |
| 26 | an unknown criterion without fabricated frame issues still exposes the acceptance repair route |   |
| 39 | flow recovery and exits are links while controls outside the flow retain their presentation |   |

#### tests/story-stage-feedback.test.mjs

[tests/story-stage-feedback.test.mjs](../tests/story-stage-feedback.test.mjs) — 16 declarations.

Domains: reader; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 21 | the prominent heading names the story and progress shares the navigation row below |   |
| 36 | embedded flows omit the repeated story name while retaining progress and failure recovery |   |
| 47 | a planning failure and retry are inside the planning step, once |   |
| 55 | failed work replaces pause with one retry in the checkpoint footer after inspection links |   |
| 71 | shared production components place controls in the image card and history in the completed recheck |   |
| 89 | independent faults keep their own stage, saved-image recovery and paused explanations |   |
| 105 | review issue details and next actions live in the failed repair checkpoint |   |
| 115 | recovering image errors remain visible beneath images while work continues |   |
| 123 | confirmation puts its start action directly under the confirmation step |   |
| 135 | confirmation owns all four settings while extraction and preparation retain their real timing |   |
| 171 | active steps show only their timeout countdown below the current step |   |
| 188 | completed steps retain their own final duration as the current step changes or finishes |   |
| 204 | active recovery is concise, retains the old error in a closed disclosure and has no retry button |   |
| 215 | finished steps contain only their name, result and final time, and flow operations are links |   |
| 228 | flow links prevent fragment navigation and respect both local and fieldset locks |   |
| 236 | running countdown and final duration occupy the same right-side metadata slot |   |

#### tests/story-title-ui.test.mjs

[tests/story-title-ui.test.mjs](../tests/story-title-ui.test.mjs) — 2 declarations.

Domains: reader; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 26 | cancel never saves; whitespace is rejected; a failed save keeps the draft and can be retried once |   |
| 51 | source-only sessions can open naming and their saved display names appear in shelf search |   |

#### tests/storyboard-ui.test.mjs

[tests/storyboard-ui.test.mjs](../tests/storyboard-ui.test.mjs) — 2 declarations.

Domains: reader; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 12 | style-only revision UI preserves review progress and offers drawing without a fresh audit |   |
| 27 | reader renders saved directory, batch range, honest progress and automatic frame controls |   |

#### tests/unified-story-setup-ui.test.mjs

[tests/unified-story-setup-ui.test.mjs](../tests/unified-story-setup-ui.test.mjs) — 1 declarations.

Domains: reader; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 9 | discovery stays in the picker and selection opens one continuous story flow |   |

### storage

#### tests/diagnostics.test.mjs

[tests/diagnostics.test.mjs](../tests/diagnostics.test.mjs) — 6 declarations.

Domains: storage; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: user-flows. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 13 | whitelist strips secrets, arbitrary messages/paths and hostile stored records; rotation stays bounded |   |
| 24 | logging failures never throw and symlinks cannot write or leak outside the library |   |
| 32 | known console events are saved safely and capture is removed on shutdown |   |
| 38 | production Gemini failures persist safe rejection details and survive diagnostic export |   |
| 61 | real CLI saves lifecycle events and exports a new metadata-only report, including corrupt libraries |   |
| 71 | desktop lifecycle persists diagnostics without forwarding raw stderr or using credentials |   |

#### tests/library-directory.test.mjs

[tests/library-directory.test.mjs](../tests/library-directory.test.mjs) — 3 declarations.

Domains: storage; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 10 | native platform defaults share the desktop app-data library |   |
| 17 | saved desktop library is read without a credentials table and an explicit override wins |   |
| 25 | malformed saved settings fail without silently switching libraries or echoing private values |   |

#### tests/library-maintenance.test.mjs

[tests/library-maintenance.test.mjs](../tests/library-maintenance.test.mjs) — 4 declarations.

Domains: storage; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: user-flows. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 22 | backup hashes complete SQLite/media and restore is exact without replacing any target |   |
| 31 | 'verification/restore reject '+kind+' without publishing a partial library' | for(const kind of ['tampered','missing','extra','path','duplicate','symlink'])test('verification/restore reject '+kind+' without publishing a partial library',async t=&gt;{  |
| 43 | pending migration creates verified old-schema backup once; failed snapshots do not change the source |   |
| 55 | CLI maintenance refuses busy library and works without provider setup, preserving full production checkpoints |   |

#### tests/library-recovery.test.mjs

[tests/library-recovery.test.mjs](../tests/library-recovery.test.mjs) — 3 declarations.

Domains: storage; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 9 | deleted generated stories retain titles, favorite flags and exact checkpoints through passive restoration |   |
| 30 | recovery metadata does not expose foreign generated titles and supports unfinished stories while excluding retired studio records |   |
| 50 | an older restored story remains listed beyond 80 entries without starting production |   |

#### tests/local-server.test.mjs

[tests/local-server.test.mjs](../tests/local-server.test.mjs) — 10 declarations.

Domains: storage, production, media; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 31 | SQLite reopen preserves current reader checkpoints, media, owner identity and recovery |   |
| 48 | failed migrations roll back DDL and can retry after the migration is corrected |   |
| 55 | HTTP serves SPA deep links and binary uploads, blocks origin writes, and never serves private data |   |
| 70 | media validates keys, MIME and symlinks; replacing files is atomic and leaves no temporary file |   |
| 80 | real SQLite locks prevent duplicate paid requests through concurrent REST advances and survive restart |   |
| 110 | offline importer preserves records, identities, media keys and source bytes and prevents migration replay |   |
| 119 | offline importer upgrades a pre-summary legacy database without requiring the local-only migration |   |
| 125 | import failure keeps destination absent and rejects live WAL, missing blobs and unsupported multipart objects |   |
| 136 | retired studio rows are discarded before reopen and have no runtime API |   |
| 143 | single-owner shelf returns more than 80 stories and keeps hidden stories excluded |   |

#### tests/story-storage-consolidation.e2e.mjs

[tests/story-storage-consolidation.e2e.mjs](../tests/story-storage-consolidation.e2e.mjs) — 1 declarations.

Domains: storage; level: `browser-e2e`; cost: `heavy`; platforms: darwin, linux, win32; suite: `e2e`; PR: `affected`; gates: user-flows. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 8 | startup inventory removes retired offline payloads and retains hidden current versions, trash and shared media |   |

#### tests/story-storage-consolidation.test.mjs

[tests/story-storage-consolidation.test.mjs](../tests/story-storage-consolidation.test.mjs) — 16 declarations.

Domains: storage; level: `integration`; cost: `heavy`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 39 | fresh and mixed upgrades converge; all owners/revisions/states and current/shared/unknown bytes survive |   |
| 65 | 'exception at '+point+' restores original DB and media, then retries once' | for(const point of ['journal','staged','quarantined','database-retired','database-published','files-published','cleanup'])test('exception at '+point+' restores original DB and medi  |
| 70 | 'process death at '+point+' recovers before access, including missing live DB' | for(const point of ['journal','quarantined','database-retired','database-published','cleanup'])test('process death at '+point+' recovers before access, including missing live DB',a  |
| 80 | future schema and recovery formats refuse before runtime files or backups are written |   |
| 85 | a separate process cannot enter the brief gate during publication |   |
| 92 | normal restore upgrades before publication and current-use legacy art reads through HTTP and Node export |   |
| 108 | a library containing only current stories preserves all raw row values and creates one verified backup |   |
| 113 | mode+' blocks purge and restores original state with a backup path' | for(const mode of ['missing image','missing receipt','corrupt original','corrupt revision'])test(mode+' blocks purge and restores original state with a backup path',t=&gt;{  |
| 120 | a current saved original follows absolute library media references and protects their bytes |   |
| 125 | titles, prompts and original prose that look like filenames do not become missing-media requirements |   |
| 131 | relocated restore protects absolute saved-original references without consulting the original path |   |
| 138 | the format declaration names the newest bundled migration for native readers |   |
| 142 | a consolidated library applies a later migration in place after a verified backup |   |
| 155 | a failed restore publishes nothing and leaves no staging snapshot |   |
| 168 | fresh and upgraded libraries refuse pre-0.8 seeding while current opens keep seeding |   |
| 173 | a library consolidated before the refusal guard receives it in place |   |

### startup

#### tests/browser-provider-settings.e2e.mjs

[tests/browser-provider-settings.e2e.mjs](../tests/browser-provider-settings.e2e.mjs) — 1 declarations.

Domains: startup, providers, desktop; level: `service-e2e`; cost: `standard`; platforms: darwin, linux, win32; suite: `e2e`; PR: `affected`; gates: user-flows. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 11 | browser settings save through actual Vite/backend, preserve overrides and adopt changes only after restart |  {timeout:60000} |

#### tests/browser-provider-settings.test.mjs

[tests/browser-provider-settings.test.mjs](../tests/browser-provider-settings.test.mjs) — 14 declarations.

Domains: startup, providers, desktop; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 35 | local view and revision-checked save preserve unrelated shared settings and immutable running models |   |
| 45 | provider profiles and explicit key keep/replace/remove never return credentials |   |
| 56 | partial provider, model, per-task and key updates preserve omitted custom profiles and reasoning |   |
| 69 | invocation overrides report names only and drift follows the effective active provider |   |
| 77 | stale, malformed, invalid effort and unrelated-field writes fail without partial settings or key updates |   |
| 91 | real peer, exact loopback hosts, origins and fetch-site guard settings without trusting forwarded headers |   |
| 106 | Vite guard rejects original LAN peers even through normalized proxy path variants |   |
| 117 | development settings fail closed behind legacy proxies or missing proof, while CLI stays direct |   |
| 132 | HTTP adapter supplies socket metadata; forwarded headers cannot change the actual peer |   |
| 139 | browser CLI edits share the production store and leave runtime unchanged until restart |   |
| 148 | Codex settings load and save without launching a slow or unavailable CLI readiness probe |  {skip:process.platform==='win32'} |
| 159 | fully explicit CLI startup survives a corrupt saved store; settings failures stay safe |   |
| 165 | generic reader and native desktop listeners do not expose browser credential settings |   |
| 173 | separate image provider saves its own key, clears with null and reports both runtime sides |   |

#### tests/cli-library.test.mjs

[tests/cli-library.test.mjs](../tests/cli-library.test.mjs) — 12 declarations.

Domains: startup; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 31 | saved desktop directory wins without prompting even before it exists, with settings read-only |   |
| 41 | first-run confirmation is remembered, but desktop settings take priority later |   |
| 51 | accepting suggested directory stores only the directory in the shared settings database |   |
| 56 | an existing default desktop library is found without a question or CLI settings write |   |
| 62 | cancelled prompt and non-interactive first use have no library or configuration side effects |   |
| 68 | malformed saved configuration fails clearly; explicit CLI/env directory bypasses it |   |
| 78 | legacy independent CLI shelf is retained rather than moved or silently selected |   |
| 84 | new ownership lock serializes simultaneous stale-owner recovery and releases on process exit |   |
| 131 | CLI creates the saved desktop shelf, shares media/progress, rejects overlap, and releases failed startup |  {timeout:30000} |
| 168 | non-interactive fresh CLI fails without creating configuration or business data |  {timeout:10000} |
| 186 | CLI signal stops a hanging Codex request before draining HTTP and releasing the library |  {skip:process.platform==='win32',timeout:15000} |
| 205 | CLI reuses saved API configuration without prompts and reset clears only provider state |  {timeout:15000} |

#### tests/headless-cli.test.mjs

[tests/headless-cli.test.mjs](../tests/headless-cli.test.mjs) — 15 declarations.

Domains: startup; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: user-flows, release, npm. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 33 | `explicit draft copy preserves ${status} review, source text and provenance without inference` | for(const status of ['pending','repair'])test(`explicit draft copy preserves ${status} review, source text and provenance without inference`,{timeout:30000},async t=&gt;{ {timeout:30000} |
| 56 | draft copies reject images and invalid checkpoints and retain explicit mode in replay identity |  {timeout:30000} |
| 73 | copy preserves a passed storyboard and evidence; only images run in the destination |  {timeout:30000} |
| 105 | CLI image-only edit redraws selected pages after explicit resume/run and preserves text, review and other images |  {timeout:30000} |
| 133 | Skill can copy text, wait for a user decision, then attach independent images to the same story |   |
| 155 | copy defaults to text only and accepts explicit image choices without reusing another art style |   |
| 169 | `${failure} copy image keeps saved text and decision; retry finishes the same story without another question` | for(const failure of ['missing','corrupt'])test(`${failure} copy image keeps saved text and decision; retry finishes the same story without another question`,async t=&gt;{  |
| 182 | image continuation rejects a changed source after the Skill checkpoint and preserves the text copy |   |
| 190 | copy retains partial image positions and later production draws only the missing page without review |   |
| 201 | real CLI copy never asks for terminal input, with or without JSON mode or image flags |  { skip:process.platform==='win32'?'POSIX terminal test; command contracts run on every platform':false,timeout:30000, } |
| 213 | in-process CLI saves intent without inference, runs bounded discovery/preparation/review and completes one story |  {timeout:60000} |
| 239 | targeted run cannot dispatch another active story and direct-inference API routes never execute |  {timeout:30000} |
| 252 | timeout and explicit fault recovery retain checkpoints and request identities |  {timeout:30000} |
| 267 | same native/browser export core produces credited public ZIP, PDF, PNG and escaped offline preview |  {timeout:60000} |
| 282 | real CLI subcommands initialize/inspect/export diagnostics with one JSON stdout and no network listener |  {...heavy,timeout:30000} |

#### tests/npm-cli.test.mjs

[tests/npm-cli.test.mjs](../tests/npm-cli.test.mjs) — 6 declarations.

Domains: startup; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: release, npm. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 13 | CLI accepts named options, equals syntax, and help/version aliases |   |
| 24 | CLI flags override environment and relative data paths use the launch directory |   |
| 34 | CLI defaults to LAN access and respects an explicit loopback environment |   |
| 40 | `CLI startup serves the reader and prints phone QR codes only for LAN access (localOnly=${localOnly})` | for (const localOnly of [false, true]) test(`CLI startup serves the reader and prints phone QR codes only for LAN access (localOnly=${localOnly})`, {timeout:20000}, async t =&gt; { {timeout:20000} |
| 58 | CLI suggestions use the desktop app-data paths on every platform |   |
| 68 | help and version do not load an env file, initialize SQLite, or create a library |   |

#### tests/settings-faults.test.mjs

[tests/settings-faults.test.mjs](../tests/settings-faults.test.mjs) — 6 declarations.

Domains: startup, providers, desktop; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: user-flows, release, npm. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 13 | settings lock timeouts preserve state and allow subsequent save/reset/open |  {timeout:20000} |
| 36 | a failed settings write rolls back an already-written replacement key |   |
| 47 | unwritable settings parent is rejected without changing sibling data |  { skip:process.platform==='win32'\|\|process.getuid?.()===0?'requires POSIX permissions and a non-root user':false, } |
| 58 | a file blocking the settings directory fails without overwriting it on every platform |   |
| 80 | late migration failure rolls back DDL, settings, credentials and schema version |   |
| 88 | killing migration after real DDL recovers the original v1 database and permits a clean upgrade |  {timeout:20000} |

#### tests/startup-cli-flow.test.mjs

[tests/startup-cli-flow.test.mjs](../tests/startup-cli-flow.test.mjs) — 1 declarations.

Domains: startup; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 27 | 'CLI startup matrix: '+row.name | for(const row of launches)test('CLI startup matrix: '+row.name,{timeout:30000},async t=&gt;{ {timeout:30000} |

#### tests/startup-matrix.test.mjs

[tests/startup-matrix.test.mjs](../tests/startup-matrix.test.mjs) — 2 declarations.

Domains: startup; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 21 | `provider matrix: saved=${saved}, override=${override\|\|'none'}, key=${keySource}` | for(const keySource of ['saved','explicit','empty','unrelated']){; for(const override of [undefined,...providers])for(const keySource of ['saved','explicit','empty','unrelated']){; for(const saved of providers)for(const override of [undefined,...providers])for(const keySource of ['saved','explicit','empty','unrelated']){  |
| 36 | 'library discovery matrix: '+source | for(const source of ['saved','legacy','default','prompt','unconfirmed'])test('library discovery matrix: '+source,async t=&gt;{  |

#### tests/startup-pty.test.mjs

[tests/startup-pty.test.mjs](../tests/startup-pty.test.mjs) — 1 declarations.

Domains: startup; level: `integration`; cost: `standard`; platforms: darwin, linux; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 12 | real CLI PTY onboarding, cancellation, configure and reset |  { skip:process.platform==='win32'?'POSIX PTYs run on Linux/macOS; Windows runs the non-TTY startup matrix':heavy.skip\|\|false,timeout:120000, } |

#### tests/system-settings.test.mjs

[tests/system-settings.test.mjs](../tests/system-settings.test.mjs) — 9 declarations.

Domains: startup, providers, desktop; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: user-flows, release, npm. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 15 | v1 migrates atomically, preserves settings/key and supports independent API profiles |   |
| 27 | legacy JSON import retains the confirmed library without inventing API credentials |   |
| 34 | patches preserve concurrent unrelated updates, stale revisions and key failures roll back |   |
| 42 | configure prompts only required fields, retains keys on blank input, and cancels without partial saves |   |
| 53 | invocation overrides choose only the effective provider key and never save environment values |   |
| 63 | development and CLI share saved provider models, credentials and per-task reasoning defaults |   |
| 79 | reset clears only provider settings, keeping library/network state and no API key in story data |   |
| 85 | DeepSeek invocation needs its own key and leaves shared provider settings and credentials unchanged |   |
| 93 | unknown/corrupt/future databases and symlinks are not silently replaced |   |

### providers

#### tests/claude-provider-flow.test.mjs

[tests/claude-provider-flow.test.mjs](../tests/claude-provider-flow.test.mjs) — 1 declarations.

Domains: providers, production; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 14 | Claude uses public production CLI, scene batches, count review and targeted repairs and stops before images |  {timeout:30000} |

#### tests/claude-provider.test.mjs

[tests/claude-provider.test.mjs](../tests/claude-provider.test.mjs) — 7 declarations.

Domains: providers; level: `contract`; cost: `fast`; platforms: darwin, linux; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 51 | Claude failures survive production diagnostic export without raw data or arbitrary error codes |   |
| 61 | Claude subprocess preserves structured result, actual model and usage with no inherited billing or tools |   |
| 73 | Claude auth rejects missing subscription or API credentials before inference |   |
| 81 | Claude validates models, efforts and text-only jobs before spawning |   |
| 88 | Claude rejects invalid protocol, unsafe tools, model changes and failed results |   |
| 95 | Claude timeout and explicit shutdown kill outstanding children and preserve safe inference state |   |
| 104 | Claude invocation-only configuration preserves desktop profile and matches using its own model |   |

#### tests/codex-provider.test.mjs

[tests/codex-provider.test.mjs](../tests/codex-provider.test.mjs) — 16 declarations.

Domains: providers; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 50 | runner uses ChatGPT auth, isolated stdin jobs, effective tool restrictions and dynamically disabled MCP |   |
| 59 | signed-out and API-key Codex logins never start inference or fall back to an API key |   |
| 67 | explicit effort reaches CLI config and thread; omitted or blank effort keeps inherited high |   |
| 78 | invalid effort fails before spawn and ignored config/thread fail before inference |   |
| 89 | per-job effort isolates parallel requests and does not change the runner fallback |   |
| 102 | status exposes the configured text model for cache identity without starting inference |   |
| 112 | text and image jobs wait fifteen minutes without the old five-minute cap; status and shorter limits remain |   |
| 129 | runner rejects unsafe tools, oversized output, process failure, missing image bytes and timeout, then removes jobs |   |
| 136 | stopping Codex processes rejects the in-flight call, which is how a desktop quit reaches the queue |   |
| 143 | a real desktop quit during Codex work is recorded as an interruption, not a provider failure |   |
| 160 | runner accepts native image bytes and attaches the first scene without reading returned paths |   |
| 165 | provider defaults to Gemini, rejects invalid config and uses Codex for all generation with no Gemini calls |   |
| 180 | invalid Codex JSON, wrong page count and non-image results never reach storage or another provider |   |
| 189 | REST reports Codex readiness without a Gemini key and routes checkpoints through the selected provider |   |
| 204 | pnpm login helper shares the configured home, strips API keys and rejects API-key login flags |   |
| 212 | per-job model routing uses Luna only for matching and rejects ignored overrides before inference |   |

#### tests/deepseek-provider-flow.test.mjs

[tests/deepseek-provider-flow.test.mjs](../tests/deepseek-provider-flow.test.mjs) — 1 declarations.

Domains: providers, production; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 16 | DeepSeek runs the public production CLI through 20/20/1 scene batches and both review gates without images |  {timeout:30000} |

#### tests/deepseek-provider.test.mjs

[tests/deepseek-provider.test.mjs](../tests/deepseek-provider.test.mjs) — 4 declarations.

Domains: providers; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 20 | DeepSeek cannot use OpenAI/Gemini keys or invoke image generation |   |
| 30 | DeepSeek sends strict JSON to its fixed endpoint with effective effort, thinking headroom and a fifteen-minute deadline |   |
| 53 | DeepSeek keeps incomplete outputs, oversized scenes and bad evidence behind the shared validators |   |
| 65 | DeepSeek reports safe failures without leaking keys, provider bodies or falling back |   |

#### tests/deepseek-response-diagnostics.test.mjs

[tests/deepseek-response-diagnostics.test.mjs](../tests/deepseek-response-diagnostics.test.mjs) — 2 declarations.

Domains: providers; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 9 | DeepSeek records incomplete reason and thinking usage before rejecting an answer, then reprojects hostile logs |   |
| 23 | Responses diagnostics preserve zero counts and ignore arbitrary fields |   |

#### tests/gemini-argon-budget.test.mjs

[tests/gemini-argon-budget.test.mjs](../tests/gemini-argon-budget.test.mjs) — 2 declarations.

Domains: providers; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 15 | Argon high thinking has answer room while Flash, lower effort and larger task budgets stay unchanged |   |
| 34 | Argon still rejects incomplete answers and oversized outlines after increasing its token budget |   |

#### tests/gemini-discovery-schema.test.mjs

[tests/gemini-discovery-schema.test.mjs](../tests/gemini-discovery-schema.test.mjs) — 2 declarations.

Domains: providers; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 15 | Gemini catalog and legacy scan avoid counted story and continuation grammars without changing shared contracts |   |
| 42 | Gemini catalog still rejects excessive story counts and invalid source continuations locally |   |

#### tests/gemini-response-diagnostics.test.mjs

[tests/gemini-response-diagnostics.test.mjs](../tests/gemini-response-diagnostics.test.mjs) — 2 declarations.

Domains: providers; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 12 | MAX_TOKENS retains finish reason and thinking/output usage before rejecting the paid result |   |
| 27 | response metadata keeps zero counters and distinguishes absent candidates without storing arbitrary fields |   |

#### tests/gemini-review-evidence.test.mjs

[tests/gemini-review-evidence.test.mjs](../tests/gemini-review-evidence.test.mjs) — 5 declarations.

Domains: providers; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 20 | Gemini full reviews cite exact saved excerpts and retain canonical validated reports |   |
| 35 | Gemini frame-count requirements use the same exact-source reference path |   |
| 40 | Gemini never falls back to authored quotes or accepts invalid reference IDs |   |
| 44 | source excerpts cover long Unicode text and chapter-only evidence without changing the source |   |
| 53 | Codex retains its prompts, canonical quote schemas, local validation and repair limits |   |

#### tests/gemini-review-schema.test.mjs

[tests/gemini-review-schema.test.mjs](../tests/gemini-review-schema.test.mjs) — 3 declarations.

Domains: providers; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 21 | Gemini full review flattens nested array counts and records the actual wire schema |   |
| 37 | `${model}: 41-scene issue grammar stays compact and the 42-issue local limit remains strict` | for(const model of ['gemini-3.8-flash','gemini-4-argon'])test(`${model}: 41-scene issue grammar stays compact and the 42-issue local limit remains strict`,async()=&gt;{  |
| 44 | Gemini review still validates coverage counts, page references, source quotes and acceptance evidence locally |   |

#### tests/gemini-stage-schema-flow.test.mjs

[tests/gemini-stage-schema-flow.test.mjs](../tests/gemini-stage-schema-flow.test.mjs) — 1 declarations.

Domains: providers, production, discovery, preparation, review, media; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 16 | Gemini production completes discovery after the 1-to-32 transition, preparation, reviews and images |  {timeout:30000} |

#### tests/gemini-stage-schema.test.mjs

[tests/gemini-stage-schema.test.mjs](../tests/gemini-stage-schema.test.mjs) — 3 declarations.

Domains: providers; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 40 | `${model}: all ${length} production stages avoid counted grammar and preserve request contracts` | for(const length of ['auto',80])test(`${model}: all ${length} production stages avoid counted grammar and preserve request contracts`,async()=&gt;{; for(const model of ['gemini-3.8-flash','gemini-4-argon'])for(const length of ['auto',80])test(`${model}: all ${length} production stages avoid counted grammar and preserve request   |
| 68 | `all production stages report ${code} safely without automatic retries` | for(const [message,code] of [  |
| 85 | relaxed wire counts never relax production counts, exact page sets or saved prompt records |   |

#### tests/gemini-structure-schema.test.mjs

[tests/gemini-structure-schema.test.mjs](../tests/gemini-structure-schema.test.mjs) — 2 declarations.

Domains: providers; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 20 | Gemini keeps structural repair counts in guidance and preserves the shared schema |   |
| 33 | Gemini repairs still reject excessive edit counts, per-edit frames and combined frames locally |   |

#### tests/gemini-timeouts.test.mjs

[tests/gemini-timeouts.test.mjs](../tests/gemini-timeouts.test.mjs) — 1 declarations.

Domains: providers; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 9 | all Gemini inference entry points use fifteen minutes, including discovery, review and images |   |

#### tests/openai-provider.test.mjs

[tests/openai-provider.test.mjs](../tests/openai-provider.test.mjs) — 7 declarations.

Domains: providers; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 24 | OpenAI covers suggestions, artwork advice, counts, drafts, outlines, batches, reflections and review |   |
| 59 | image generation saves validated bytes and later frames send the saved anchor as multipart edits |   |
| 70 | refusals, incomplete or malformed outputs and invalid image bytes fail without fallback or remote image fetching |   |
| 77 | API errors never expose response bodies, credentials or prompts |   |
| 93 | OpenAI metadata-only connection check checks selected models with no generation or key disclosure |   |
| 98 | strict schemas preserve optional-property nullability instead of requiring invented field values |   |
| 103 | read-only mode never starts queued work and rejects historical generation even with API environment credentials |   |

#### tests/prompt-contracts.test.mjs

[tests/prompt-contracts.test.mjs](../tests/prompt-contracts.test.mjs) — 3 declarations.

Domains: providers; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 17 | pre-cleanup v2 fingerprints and automatic presets remain byte-compatible |   |
| 109 | all providers send the same stage-specific instructions, data and strict output contracts |   |
| 176 | `${provider}: story-specific acceptance criteria reach only full validation with exact prompt captures` | for(const provider of ['codex','gemini','openai'])test(`${provider}: story-specific acceptance criteria reach only full validation with exact prompt captures`,async()=&gt;{  |

#### tests/separate-providers-flow.test.mjs

[tests/separate-providers-flow.test.mjs](../tests/separate-providers-flow.test.mjs) — 1 declarations.

Domains: providers, production; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 8 | production queue draws every frame through the separate image provider and keeps text on the text provider |   |

#### tests/separate-providers.test.mjs

[tests/separate-providers.test.mjs](../tests/separate-providers.test.mjs) — 8 declarations.

Domains: providers; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 51 | Codex text with Gemini images: drawing, timeouts and status come from the image provider only |   |
| 65 | image failures keep image-provider safe messages through the local-book wrapper; text failures keep text messages |   |
| 74 | status requires both sides and names the unready image service; read-only ignores the image setting |   |
| 89 | settings keep the image provider optional, scoped to active credentials and cleared by reset |   |
| 109 | invocation overrides select the image provider and its key for one run without saving |   |
| 124 | configure asks the image provider, saves its own key/model and Enter keeps saved choices |   |
| 140 | desktop checks each side with its own key and model, without generating content |   |
| 153 | invocation-only Claude text draws only through an explicit image provider with that provider key |   |

#### tests/task-reasoning-flow.test.mjs

[tests/task-reasoning-flow.test.mjs](../tests/task-reasoning-flow.test.mjs) — 1 declarations.

Domains: providers, production; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 8 | Gemini task effort survives real queued review checkpoints alongside existing usage |   |

#### tests/task-reasoning.test.mjs

[tests/task-reasoning.test.mjs](../tests/task-reasoning.test.mjs) — 4 declarations.

Domains: providers; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 41 | `${name}: all text tasks use ${custom?'explicit overrides':'recommended defaults'}, not the old global effort` | for(const custom of [false,true])test(`${name}: all text tasks use ${custom?'explicit overrides':'recommended defaults'}, not the old global effort`,async()=&gt;{; for(const name of ['codex','gemini'])for(const custom of [false,true])test(`${name}: all text tasks use ${custom?'explicit overrides':'recommended defaults'}, not the old global ef  |
| 63 | invalid task config fails before inference, and Gemini never downgrades xhigh |   |
| 70 | old desktop settings acquire defaults, partial overrides persist, and Gemini rejects incompatible settings |   |
| 80 | art effort isolates recommendations while review effort changes reuse the same recommendation |   |

### media

#### tests/export-story.test.mjs

[tests/export-story.test.mjs](../tests/export-story.test.mjs) — 7 declarations.

Domains: media; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 53 | named Node export reads the complete story, applies default credits and encodes every frame without a browser |   |
| 72 | named Node export leaves the existing archive intact when media is missing, credits are unsigned or the current revision changes |   |
| 86 | public ZIP matches the Guandu field/layout contract and retains original signed WebPs byte for byte |   |
| 101 | named export rejects ambiguous names and incomplete current versions instead of choosing older complete drafts |   |
| 112 | named export preserves the original sharing filename across a new revision ID and renamed title |   |
| 127 | missing frames, corrupt images, bad hashes and missing/mismatched signatures stop the export |   |
| 142 | export keeps an existing filename after a title change, supports in-place conversion and leaves targets intact on failure |   |

#### tests/image-dimensions.test.mjs

[tests/image-dimensions.test.mjs](../tests/image-dimensions.test.mjs) — 4 declarations.

Domains: media; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 12 | image metadata reads formats and EXIF rotation without imposing resolution or ratio limits |   |
| 24 | outbound sizes follow official custom-size constraints without a default-size minimum |   |
| 44 | `${name}: request 9:16 but save every valid native size and ratio without transforming bytes` | for(const name of ['codex','gemini']){  |
| 58 | `${name}: only corrupt media fails the queue; explicit retry preserves completed work` | for(const name of ['codex','gemini']){ flowProvider(name) |

#### tests/local-image-batches.test.mjs

[tests/local-image-batches.test.mjs](../tests/local-image-batches.test.mjs) — 10 declarations.

Domains: media; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 14 | auto is the count default; invalid counts never create a production story |   |
| 22 | `${provider}: auto count 1/30 and exact ${lengths.filter(length=&gt;length!=='auto').join('/')} use durable production checkpoints` | for(const provider of flowProviders(['gemini','codex'])){  |
| 36 | `${provider}: invalid exact outline fails before images; only explicit fault recovery proceeds` | for(const provider of flowProviders(['gemini','codex'])){  |
| 43 | `${provider}: anchor runs alone, later scenes publish out of order under one session lease` | for(const provider of flowProviders(['gemini','codex'])){  |
| 51 | `${provider}: numeric detail prepares once and waits for durable explicit count confirmation` | for(const provider of flowProviders(['gemini','codex'])){  |
| 62 | `${provider}: invalid recommendations preserve the original and require an authorized retry` | for(const provider of flowProviders(['gemini','codex'])){  |
| 72 | frame 80 media, events and saved progress remain owner scoped and survive restart |  heavy |
| 83 | reader lease exit drains started calls and dispatches no additional images |   |
| 87 | frame count validation, owner, running lock and concurrent conflicting confirmation are fenced |   |
| 95 | unverifiable originals stop before recommendation, plan or images |   |

#### tests/reader-png.test.mjs

[tests/reader-png.test.mjs](../tests/reader-png.test.mjs) — 3 declarations.

Domains: media; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 8 | PNG export requires every image and produces a safe PNG filename |   |
| 15 | contact sheets retain all frames in reading order for 4, 8, 10, 12, 16 and 30 pages |   |
| 29 | long titles, narration and reflections expand the layout without overlapping later rows |   |

#### tests/reader-zip.test.mjs

[tests/reader-zip.test.mjs](../tests/reader-zip.test.mjs) — 12 declarations.

Domains: media; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 49 | ZIP requires every image and sanitizes the archive filename |   |
| 56 | ZIP preserves images and public metadata while exporting requirements, page prompts and actual history |   |
| 110 | ZIP exports stories without generation metadata with an empty model list |   |
| 126 | ZIP rejects failed decoding, missing canvas, empty encoding and PNG fallbacks |   |
| 139 | ZIP rejects incomplete, foreign, failed, empty and non-image responses |   |
| 157 | ZIP credits remain consistent and image metadata does not inherit prompt contents |   |
| 174 | ZIP labels genuinely missing history without inventing system rules or treating empty requirements as missing |   |
| 187 | ZIP uses working internal references and keeps repeated large system rules below the existing 1 MiB text limit |   |
| 207 | download loads actual prompt history on demand and excludes API previews and raw receipts |   |
| 227 | download fails explicitly before creating an incomplete archive if prompt history cannot be read |   |
| 238 | ZIP applies the saved watermark size to WebP canvases and retains it in story metadata |   |
| 248 | collection export consumes the browser ZIP with its signed WebPs and shared public serialization |   |

#### tests/story-publication-defaults.test.mjs

[tests/story-publication-defaults.test.mjs](../tests/story-publication-defaults.test.mjs) — 5 declarations.

Domains: media; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 19 | live export defaults preserve work overrides and invalidate unsigned or outdated cached files |   |
| 30 | defaults survive restart and are copied once for both creation paths, without changing existing stories or generating |   |
| 55 | a per-story override stays independent of defaults and sibling stories, including revision inheritance |   |
| 74 | default settings require valid same-owner CAS writes and remain editable without a generation provider |   |
| 88 | the additive defaults migration preserves an existing library and is safe on repeated startup |   |

#### tests/story-publication.test.mjs

[tests/story-publication.test.mjs](../tests/story-publication.test.mjs) — 3 declarations.

Domains: media; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 13 | metadata survives late full checkpoints, queue completion, restart and revision inheritance without extra generation |   |
| 42 | stale, invalid, cross-origin, other-owner and deleted writes leave saved metadata intact |   |
| 59 | export identity changes with content/metadata and missing credits never impersonate the platform |   |

#### tests/story-webp-metadata.test.mjs

[tests/story-webp-metadata.test.mjs](../tests/story-webp-metadata.test.mjs) — 6 declarations.

Domains: media; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 15 | XMP replacement preserves encoded pixels, padding/dimensions and independently verifiable payload/file hashes |   |
| 29 | public XMP escapes text, removes invalid XML controls and carries full bounded public attribution only |   |
| 41 | WebP watermark size defaults to 24px, honors saved sizes and stays within the image width |   |
| 55 | invalid/truncated/animated containers fail closed |   |
| 60 | hashing works with no secure-context WebCrypto |   |
| 65 | lossless alpha and odd-length ICCP survive XMP addition with correct feature flags |   |

### desktop

#### tests/desktop-console.test.mjs

[tests/desktop-console.test.mjs](../tests/desktop-console.test.mjs) — 4 declarations.

Domains: desktop; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 13 | preview browser opens only a distinct local reader root without credentials, query or fragment |   |
| 19 | native console no longer grants loopback frame access or remote capabilities |   |
| 27 | console renders lifecycle controls, saved/runtime summaries and safe upgrade backup without story controls |   |
| 40 | stopped provider summary requires both active API keys even when providerConfigured remains true |   |

#### tests/desktop-internet.test.mjs

[tests/desktop-internet.test.mjs](../tests/desktop-internet.test.mjs) — 11 declarations.

Domains: desktop; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 25 | public URLs gate every reader route; private fragment pairs into a distinct secure session |   |
| 55 | pairing and remote sessions expire after twelve hours |   |
| 61 | paired NDJSON responses preserve incremental reader output |   |
| 71 | legacy LAN settings never silently enable Internet access |   |
| 88 | helper receives isolated config/environment, handles split output and stops without leaks |  nativeOnly |
| 98 | helper missing, timeout and startup cancellation leave no process or config |  nativeOnly |
| 127 | tunnel entry pairs safely and helper exit clears public access while LAN survives |  nativeOnly |
| 143 | missing helper leaves direct local/LAN access running without pairing |  nativeOnly |
| 161 | helper exiting before readiness closes only the remote entry and retains LAN |  nativeOnly |
| 169 | parent EOF during tunnel startup cancels helper before native forced-stop deadline |  {...nativeOnly,timeout:15000} |
| 181 | native JSON protocol reports tunnel disconnect and EOF stops the remaining LAN service |  {...nativeOnly,timeout:15000} |

#### tests/desktop-node.test.mjs

[tests/desktop-node.test.mjs](../tests/desktop-node.test.mjs) — 1 declarations.

Domains: desktop; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 6 | bundled Node staging requires the exact pinned version and native target |   |

#### tests/desktop-runtime.test.mjs

[tests/desktop-runtime.test.mjs](../tests/desktop-runtime.test.mjs) — 8 declarations.

Domains: desktop; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 28 | direct access needs no cookies and rejects foreign origins/hosts and native routes |   |
| 43 | desktop settings reject unknown secrets/invalid models and isolate environment variables |   |
| 49 | desktop effort defaults for old settings and maps explicit choices to the runner environment |   |
| 58 | connection test uses only model metadata, does not echo credentials, and no-key checks never make requests |   |
| 66 | desktop lifecycle preserves progress and direct access across restarts, detects busy data, and recovers after port conflicts |   |
| 90 | data ownership rejects a live Node owner and reclaims a demonstrably dead owner |   |
| 101 | parent EOF kills active detached Codex groups before releasing the data directory |  {skip:process.platform==='win32',timeout:20000} |
| 124 | one-shot desktop upgrade returns the verified backup without listeners, credentials or worker jobs |   |

#### tests/desktop-service-console.playwright.e2e.mjs

[tests/desktop-service-console.playwright.e2e.mjs](../tests/desktop-service-console.playwright.e2e.mjs) — 1 declarations.

Domains: desktop; level: `browser-e2e`; cost: `heavy`; platforms: darwin, linux, win32; suite: `e2e`; PR: `affected`; gates: user-flows. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 15 | console-only desktop, lifecycle IPC and actual desktop browser settings |  {timeout:120000} |

#### tests/desktop-service-console.test.mjs

[tests/desktop-service-console.test.mjs](../tests/desktop-service-console.test.mjs) — 10 declarations.

Domains: desktop; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 28 | fresh desktop starts without generation setup; reader works and generation cannot create a partial production |   |
| 36 | desktop uses the exact native store and invocation overrides; browser drift and supervisor summary agree |   |
| 44 | missing/corrupt desktop store fails safely for read/save/check/reset without replacement |   |
| 52 | saved connection check ignores drafts, checks metadata only; reset preserves native fields and rejects stale revisions |   |
| 62 | real desktop HTTP denies foreign origin, LAN address, raw normalized paths and native-only fields |   |
| 73 | tunnel refuses generation settings before forwarding even with a loopback-looking request |   |
| 78 | desktop startup upgrades an isolated legacy library before serving and reports its verified backup |   |
| 85 | failed pending-journal recovery reports its backup safely before any service listener opens |   |
| 94 | in-place migration reports its new verified backup rather than an older consolidation report |   |
| 103 | metadata check uses the model-list route for a DeepSeek invocation override without generation |   |

#### tests/desktop-vite.test.mjs

[tests/desktop-vite.test.mjs](../tests/desktop-vite.test.mjs) — 1 declarations.

Domains: desktop; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 7 | desktop Vite transforms the shared production timeline and resolves its library imports |   |

### tooling

#### tests/cli-skill.test.mjs

[tests/cli-skill.test.mjs](../tests/cli-skill.test.mjs) — 9 declarations.

Domains: tooling; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: user-flows. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 10 | bundled skill copies independently, is idempotent, and refuses different instructions and symlink paths |   |
| 37 | check reports pinned update without replacing files; cache is outside project and policy is opt-in |   |
| 53 | local edits, unknown legacy content and corrupt state are preserved; matching legacy copies can be adopted |   |
| 66 | registry failures are non-blocking, bounded, cached briefly, and refreshable |   |
| 77 | auto discovery respects Git roots, ancestor projects, global fallback and correct update cwd |   |
| 85 | state symlinks and active operation locks reject mutations without changing their targets |   |
| 94 | CLI process emits one JSON receipt for check, help and managed update refusal |   |
| 104 | user cache location can be created independently; unsafe cache paths cannot overwrite external files |   |
| 112 | failed or malformed cache entries cannot authorize any automatic update or version range |   |

#### tests/development-access.test.mjs

[tests/development-access.test.mjs](../tests/development-access.test.mjs) — 2 declarations.

Domains: tooling; level: `contract`; cost: `fast`; platforms: darwin, linux, win32; suite: `unit`; PR: `code`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 15 | development LAN proxy allows direct access and protects preserved/private workspace stores |   |
| 48 | Vite refuses libraries and private aliases inside its public directory |   |

#### tests/development-cache.test.mjs

[tests/development-cache.test.mjs](../tests/development-cache.test.mjs) — 1 declarations.

Domains: tooling; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 16 | concurrent development optimizers retain each reader dependency URL |  {timeout:30000} |

#### tests/development-local.e2e.mjs

[tests/development-local.e2e.mjs](../tests/development-local.e2e.mjs) — 3 declarations.

Domains: tooling; level: `service-e2e`; cost: `standard`; platforms: darwin, linux, win32; suite: `e2e`; PR: `affected`; gates: user-flows. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 12 | dev uses saved Google settings and ignores conflicting project .env without changing the saved profile |  {timeout:45000} |
| 21 | dev shell overrides saved Google configuration only for the current invocation |  {timeout:45000} |
| 28 | STORY-LIFECYCLE-C007: pnpm dev local ignores shared data settings and denies private database downloads |  {timeout:45000} |

#### tests/development-local.test.mjs

[tests/development-local.test.mjs](../tests/development-local.test.mjs) — 2 declarations.

Domains: tooling; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: full only. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 10 | local mode selects only the checkout development shelf and preserves ordinary dev defaults |   |
| 16 | setup leaves provider configuration in the shared store and preserves an existing standalone env file |   |

#### tests/npm-publish.test.mjs

[tests/npm-publish.test.mjs](../tests/npm-publish.test.mjs) — 3 declarations.

Domains: tooling; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: release, npm. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 15 | `release checks precede build, exact-artifact smoke and publish (dryRun=${dryRun})` | for(const dryRun of [false,true])test(`release checks precede build, exact-artifact smoke and publish (dryRun=${dryRun})`,async t=&gt;{  |
| 20 | 'release never publishes after failure at '+failed | for(const failed of ['npm:check','build:npm','npm:smoke'])test('release never publishes after failure at '+failed,async t=&gt;{  |
| 25 | release rejects a missing tarball before smoke or publication |   |

#### tests/release-pre-push.test.mjs

[tests/release-pre-push.test.mjs](../tests/release-pre-push.test.mjs) — 8 declarations.

Domains: tooling; level: `integration`; cost: `standard`; platforms: darwin, linux, win32; suite: `flows`; PR: `affected`; gates: release. Whole-file full qualification always applies on supported platforms.

| Line | Scenario/template | Matrix/options |
| ---: | --- | --- |
| 11 | both local publication gates require the production-backed lifecycle E2E |   |
| 24 | smoke gates stay focused while the explicit full selection preserves all regression coverage |   |
| 43 | all E2E files have an aggregate runner and the six extended service files have a dedicated command |   |
| 99 | extended runner executes all six files under inherited test context and records a failing exit |   |
| 109 | release pushes check the tagged snapshot once for lightweight and annotated tags; branches and deletions bypass |  {skip:process.platform==='win32'} |
| 125 | 'critical flow failure rejects a real v* tag push: '+failedFlow | for(const failedFlow of ['tests/headless-cli.test.mjs','tests/release-smoke.playwright.e2e.mjs','tests/story-generation-state-machine.e2e.mjs'])test('critical flow failure rejects  {skip:process.platform==='win32'} |
| 135 | passing critical flows execute under an inherited test environment before a v* tag is accepted |  {skip:process.platform==='win32'} |
| 143 | failed checks reject the actual tag push and clean up the isolated worktree |  {skip:process.platform==='win32'} |

## Native scenarios

Source-only PR checks omit only the verified prepared-bundle probe; release artifact checks retain it. Native config tests require Node and installed JS dependencies.

| Module | Function | Line |
| --- | --- | ---: |
| [src-tauri/src/config.rs](../src-tauri/src/config.rs) | `native_patch_preserves_browser_fields_and_stale_saves_fail` | 572 |
| [src-tauri/src/config.rs](../src-tauri/src/config.rs) | `legacy_lan_never_enables_internet_and_new_settings_round_trip` | 613 |
| [src-tauri/src/config.rs](../src-tauri/src/config.rs) | `database_round_trip_delete_and_private_permissions` | 655 |
| [src-tauri/src/config.rs](../src-tauri/src/config.rs) | `migration_is_once_and_never_overwrites_database` | 689 |
| [src-tauri/src/config.rs](../src-tauri/src/config.rs) | `task_efforts_migrate_old_settings_and_reject_invalid_saves_atomically` | 710 |
| [src-tauri/src/config.rs](../src-tauri/src/config.rs) | `reasoning_effort_reads_old_settings_and_persists_without_changing_keys` | 767 |
| [src-tauri/src/config.rs](../src-tauri/src/config.rs) | `failed_key_write_rolls_back_settings_and_key` | 811 |
| [src-tauri/src/config.rs](../src-tauri/src/config.rs) | `corrupt_future_and_unknown_schema_are_preserved` | 825 |
| [src-tauri/src/config.rs](../src-tauri/src/config.rs) | `settings_cannot_contain_secret_fields_or_invalid_values` | 847 |
| [src-tauri/src/config.rs](../src-tauri/src/config.rs) | `windows_rejects_codex_without_changing_saved_gemini_settings` | 866 |
| [src-tauri/src/config.rs](../src-tauri/src/config.rs) | `symlink_database_is_rejected` | 882 |
| [src-tauri/src/config.rs](../src-tauri/src/config.rs) | `version_one_migrates_preserving_keys_and_revision_rejects_stale_saves` | 894 |
| [src-tauri/src/config.rs](../src-tauri/src/config.rs) | `typescript_and_native_share_the_actual_database_protocol` | 961 |
| [src-tauri/src/lib.rs](../src-tauri/src/lib.rs) | `stop_and_exit_wait_for_startup_without_holding_the_controller_lock` | 425 |
| [src-tauri/src/lib.rs](../src-tauri/src/lib.rs) | `browser_opener_accepts_only_root_and_fixed_settings_fragment` | 443 |
| [src-tauri/src/lib.rs](../src-tauri/src/lib.rs) | `provider_commands_only_use_committed_database_configuration` | 468 |
| [src-tauri/src/lib.rs](../src-tauri/src/lib.rs) | `provider_environment_is_invocation_only_and_does_not_import_credentials` | 501 |
| [src-tauri/src/lib.rs](../src-tauri/src/lib.rs) | `separate_image_provider_uses_its_own_credential_and_readiness` | 536 |
| [src-tauri/src/library.rs](../src-tauri/src/library.rs) | `refusal_precedes_ownership_writes` | 108 |
| [src-tauri/src/runtime.rs](../src-tauri/src/runtime.rs) | `upgrade_wait_outlives_startup_timeout_and_preserves_backup` | 382 |
| [src-tauri/src/runtime.rs](../src-tauri/src/runtime.rs) | `desktop_uses_verified_bundle_and_ignores_saved_system_path` | 399 |
| [src-tauri/src/runtime.rs](../src-tauri/src/runtime.rs) | `desktop_rejects_missing_or_modified_bundle_without_fallback` | 414 |
| [src-tauri/src/runtime.rs](../src-tauri/src/runtime.rs) | `status_stream_keeps_disconnect_updates_after_large_readiness_frame` | 437 |
| [src-tauri/src/runtime.rs](../src-tauri/src/runtime.rs) | `status_stream_normalizes_fatal_diagnostics_during_cleanup` | 456 |
| [src-tauri/src/runtime.rs](../src-tauri/src/runtime.rs) | `rejects_wrong_node_and_sqlite_capabilities` | 471 |
| [src-tauri/src/runtime.rs](../src-tauri/src/runtime.rs) | `exclusive_directory_lock_releases_with_owner` | 496 |

## Managed QA cases

Historical records under `.tests` remain unchanged.

| ID | Case |
| --- | --- |
| STORY-LIFECYCLE-C001 | 新建、提取、准备与确认制作 |
| STORY-LIFECYCLE-C002 | 已生成故事的各编辑入口 |
| STORY-LIFECYCLE-C003 | 暂停、恢复与检查点 |
| STORY-LIFECYCLE-C004 | 失败与显式恢复 |
| STORY-LIFECYCLE-C005 | 重选取消与提交 |
| STORY-LIFECYCLE-C006 | 状态机协议及媒体恢复 |
| STORY-LIFECYCLE-C007 | 开发入口与库隔离 |

## Acceptance specifications

Historical specs may describe retired Docker/studio/API behavior. Review applicability before using them as a release oracle.

| Spec | Title |
| --- | --- |
| [.docs/tests/test-adaptive-storyboard-review.md](../.docs/tests/test-adaptive-storyboard-review.md) | 自动幅数与原文审核的受控验收 |
| [.docs/tests/test-background-generation.md](../.docs/tests/test-background-generation.md) | Background generation flows |
| [.docs/tests/test-book-reference-star.md](../.docs/tests/test-book-reference-star.md) | 每本书星标参考服务端到端 |
| [.docs/tests/test-book-theme-story-cache.md](../.docs/tests/test-book-theme-story-cache.md) | 按需全文／章回选题与缓存：可执行流程 |
| [.docs/tests/test-browser-provider-settings.md](../.docs/tests/test-browser-provider-settings.md) | Browser provider settings E2E |
| [.docs/tests/test-claude-cli-comparison.md](../.docs/tests/test-claude-cli-comparison.md) | Claude CLI integration scenarios |
| [.docs/tests/test-clean-priority-originals.md](../.docs/tests/test-clean-priority-originals.md) | 优先三书原文与统一异常范围验证 |
| [.docs/tests/test-clean-three-originals.md](../.docs/tests/test-clean-three-originals.md) | 三书本地原件验证 |
| [.docs/tests/test-cli-shared-library-no-lite.md](../.docs/tests/test-cli-shared-library-no-lite.md) | CLI 共享书库与桌面单版验证 |
| [.docs/tests/test-codex-reasoning-effort.md](../.docs/tests/test-codex-reasoning-effort.md) | Codex effort verification |
| [.docs/tests/test-codex-subscription.md](../.docs/tests/test-codex-subscription.md) | Codex provider acceptance flows |
| [.docs/tests/test-consolidate-story-storage.md](../.docs/tests/test-consolidate-story-storage.md) | Consolidate story storage — executable verification contract |
| [.docs/tests/test-continuous-production-queue.md](../.docs/tests/test-continuous-production-queue.md) | Continuous production queue E2E |
| [.docs/tests/test-continuous-story-discovery.md](../.docs/tests/test-continuous-story-discovery.md) | 连续选题 E2E |
| [.docs/tests/test-copy-comparison-drafts.md](../.docs/tests/test-copy-comparison-drafts.md) | Draft-copy verification |
| [.docs/tests/test-desktop-internet-access.md](../.docs/tests/test-desktop-internet-access.md) | Desktop internet access E2E |
| [.docs/tests/test-desktop-lite.md](../.docs/tests/test-desktop-lite.md) | Desktop editions E2E |
| [.docs/tests/test-desktop-reader-tab.md](../.docs/tests/test-desktop-reader-tab.md) | Desktop overview E2E |
| [.docs/tests/test-desktop-service-console.md](../.docs/tests/test-desktop-service-console.md) | Desktop service console E2E |
| [.docs/tests/test-dev-local-playwright.md](../.docs/tests/test-dev-local-playwright.md) | 开发数据库 E2E |
| [.docs/tests/test-direct-reader-access.md](../.docs/tests/test-direct-reader-access.md) | Direct reader access E2E |
| [.docs/tests/test-dongguo-demo.md](../.docs/tests/test-dongguo-demo.md) | Dongguo demo flows (historical) |
| [.docs/tests/test-editable-extraction-title.md](../.docs/tests/test-editable-extraction-title.md) | 提取窗口标题编辑 |
| [.docs/tests/test-empty-library.md](../.docs/tests/test-empty-library.md) | Empty first run and existing library compatibility |
| [.docs/tests/test-erke-unified.md](../.docs/tests/test-erke-unified.md) | 二刻统一原件验证 |
| [.docs/tests/test-explicit-extraction-start.md](../.docs/tests/test-explicit-extraction-start.md) | 手动启动提取 |
| [.docs/tests/test-fast-first-story-discovery.md](../.docs/tests/test-fast-first-story-discovery.md) | E2E: fast-first-story-discovery |
| [.docs/tests/test-image-dimensions.md](../.docs/tests/test-image-dimensions.md) | Image dimension boundary scenarios |
| [.docs/tests/test-image-publication-recovery.md](../.docs/tests/test-image-publication-recovery.md) | 图片保存冲突后的恢复场景 |
| [.docs/tests/test-impact-based-test-routing.md](../.docs/tests/test-impact-based-test-routing.md) | Impact-based routing verification |
| [.docs/tests/test-incremental-story-library.md](../.docs/tests/test-incremental-story-library.md) | 增量故事库服务级端到端 |
| [.docs/tests/test-lan-independent-startup.md](../.docs/tests/test-lan-independent-startup.md) | LAN-independent startup E2E |
| [.docs/tests/test-library-recovery-diagnostics-release.md](../.docs/tests/test-library-recovery-diagnostics-release.md) | 书库维护与发布检查验收 |
| [.docs/tests/test-local-image-batches.md](../.docs/tests/test-local-image-batches.md) | Local batch feature verification |
| [.docs/tests/test-local-library-all-books.md](../.docs/tests/test-local-library-all-books.md) | 全书库本地流程验证 |
| [.docs/tests/test-local-whole-book.md](../.docs/tests/test-local-whole-book.md) | 本地整书选题流程验证 |
| [.docs/tests/test-node-react-local.md](../.docs/tests/test-node-react-local.md) | Node React migration E2E |
| [.docs/tests/test-npm-cli.md](../.docs/tests/test-npm-cli.md) | Installed npm CLI scenarios |
| [.docs/tests/test-paused-editing-latest-version.md](../.docs/tests/test-paused-editing-latest-version.md) | 暂停编辑与最新版书架 E2E |
| [.docs/tests/test-production-queue-hardening.md](../.docs/tests/test-production-queue-hardening.md) | Test: production queue hardening |
| [.docs/tests/test-prompt-contract-cleanup.md](../.docs/tests/test-prompt-contract-cleanup.md) | 提示词清理验收场景 |
| [.docs/tests/test-publication-book-sources.md](../.docs/tests/test-publication-book-sources.md) | Replacement source flows |
| [.docs/tests/test-purge-old-book-history.md](../.docs/tests/test-purge-old-book-history.md) | Git history cleanup flows |
| [.docs/tests/test-queue-image-recovery-priority.md](../.docs/tests/test-queue-image-recovery-priority.md) | Queue image recovery and reading priority flows |
| [.docs/tests/test-queue-interruption-resilience.md](../.docs/tests/test-queue-interruption-resilience.md) | Queue interruption resilience flows |
| [.docs/tests/test-queued-story-setup.md](../.docs/tests/test-queued-story-setup.md) | 排队选题端到端 |
| [.docs/tests/test-reader-ui-audit-fixes.md](../.docs/tests/test-reader-ui-audit-fixes.md) | Reader UI audit fixes: in-app scenarios |
| [.docs/tests/test-release-086-recovery.md](../.docs/tests/test-release-086-recovery.md) | Release 0.8.6 recovery scenarios |
| [.docs/tests/test-remove-docker-support.md](../.docs/tests/test-remove-docker-support.md) | Remove Docker container support verification |
| [.docs/tests/test-retire-legacy-studio.md](../.docs/tests/test-retire-legacy-studio.md) | Retire legacy studio: focused regression |
| [.docs/tests/test-selected-chapter-extraction.md](../.docs/tests/test-selected-chapter-extraction.md) | Selected-chapter extraction E2E |
| [.docs/tests/test-separate-text-image-providers.md](../.docs/tests/test-separate-text-image-providers.md) | Separate text and image providers scenarios |
| [.docs/tests/test-shared-development-settings.md](../.docs/tests/test-shared-development-settings.md) | Shared development settings E2E |
| [.docs/tests/test-shared-provider-setup.md](../.docs/tests/test-shared-provider-setup.md) | Shared provider setup E2E |
| [.docs/tests/test-shared-story-library.md](../.docs/tests/test-shared-story-library.md) | Shared story library E2E |
| [.docs/tests/test-shishuo-source-correction.md](../.docs/tests/test-shishuo-source-correction.md) | 校订原文验证 |
| [.docs/tests/test-single-generation-control.md](../.docs/tests/test-single-generation-control.md) | Single generation control flows |
| [.docs/tests/test-skill-updates.md](../.docs/tests/test-skill-updates.md) | 技能更新验收流程 |
| [.docs/tests/test-source-first-storyboard-regression.md](../.docs/tests/test-source-first-storyboard-regression.md) | 分镜v1→测试v2：数量审核先行 |
| [.docs/tests/test-story-chapter-picker.md](../.docs/tests/test-story-chapter-picker.md) | Story/chapter picker E2E |
| [.docs/tests/test-story-discovery-modes.md](../.docs/tests/test-story-discovery-modes.md) | 选题条件界面验证 |
| [.docs/tests/test-story-discovery-speed-accuracy.md](../.docs/tests/test-story-discovery-speed-accuracy.md) | 故事发现速度、准确度与失败恢复：服务验收 |
| [.docs/tests/test-story-flow-reader-control.md](../.docs/tests/test-story-flow-reader-control.md) | 故事制作流程 E2E 场景 |
| [.docs/tests/test-story-frame-count.md](../.docs/tests/test-story-frame-count.md) | Story frame count E2E — revised detail → recommendation → count → storyboard |
| [.docs/tests/test-story-generation-state-machine.md](../.docs/tests/test-story-generation-state-machine.md) | 故事生成状态机验收 |
| [.docs/tests/test-story-prompt-requirements.md](../.docs/tests/test-story-prompt-requirements.md) | Story prompt requirements E2E |
| [.docs/tests/test-story-publication-protection.md](../.docs/tests/test-story-publication-protection.md) | Story publication protection E2E |
| [.docs/tests/test-story-review-history.md](../.docs/tests/test-story-review-history.md) | 审核记录ET |
| [.docs/tests/test-story-revisions.md](../.docs/tests/test-story-revisions.md) | 故事修订端到端 |
| [.docs/tests/test-story-specific-requirements.md](../.docs/tests/test-story-specific-requirements.md) | Story-specific requirements scenarios |
| [.docs/tests/test-storyboard-batches.md](../.docs/tests/test-storyboard-batches.md) | Storyboard batches verification |
| [.docs/tests/test-storyboard-review.md](../.docs/tests/test-storyboard-review.md) | Storyboard review verification |
| [.docs/tests/test-taiping-wyg.md](../.docs/tests/test-taiping-wyg.md) | 太平文渊阁验证 |
| [.docs/tests/test-task-reasoning-effort.md](../.docs/tests/test-task-reasoning-effort.md) | 按任务推理验收 |
| [.docs/tests/test-unified-story-review.md](../.docs/tests/test-unified-story-review.md) | 正式审核流程ET |
| [.docs/tests/test-unified-story-setup.md](../.docs/tests/test-unified-story-setup.md) | 新建/修订共用流程与编辑 |
| [.docs/tests/test-windows-desktop.md](../.docs/tests/test-windows-desktop.md) | Windows desktop verification |
