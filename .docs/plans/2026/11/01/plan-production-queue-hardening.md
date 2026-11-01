# Plan: production queue hardening

Requirements: [req-production-queue-hardening.md](../../../../reqs/2026/11/01/req-production-queue-hardening.md). Scenarios: [test-production-queue-hardening.md](../../../../tests/test-production-queue-hardening.md).

Risk: non-low. This changes scheduling, paid-work dispatch, version semantics, persisted job data and a public API response.

Git base: `1a82fd95ffaf0881034416bcaa70cebbd8a40ffe`, recorded at the start of SS. It includes `8924e5d`, whose review-failure flow this plan depends on. Per the user's instruction, implement directly on `main` in the existing checkout, without another worktree or branch. Preserve unrelated staged, unstaged and untracked work; milestone commits include only this story's changes.

## Scope

Five goals, in this order:

1. The newest version is the only source of generation eligibility, checked when work actually starts.
2. Publishing a new version and retiring the old one are one atomic write.
3. Search, text, image and local publication are four independent pools.
4. Stage checkpoints and image receipts are kept, and only missing work is done.
5. Scheduling, the shelf response and expired viewer rows are optimized last.

This covers review findings 1, 3 and 5–10. Findings 2, 4 and 11 are out of scope.

```mermaid
flowchart TD
  A[Queue claim: canRun] --> E{Newest in family?}
  B[Script step: repo.acquire] --> E
  C[Image: just before paying] --> E
  D[POST /source, POST /production, recovery] --> E
  E -->|Yes| F[Other existing checks, then start]
  E -->|No| G[Start nothing, no attempt used]
  H[Insert new version] -->|same write| I[Older versions are no longer newest]
  I --> E
  J[Old request already started] --> K[May save to the old version]
  L[Finished old image] --> M[May still publish to the old version]
```

## Review-failure flow this plan assumes

- Automatic review and repair runs up to 20 rounds (`readerMaxAutomaticRepairs`), and stops early if a repair changes nothing.
- A blocked story keeps its saved row `failed` and shows its issues, the stop reason, and the repair and audit counts.
- **继续自动修复** is an explicit retry that allows up to 20 more rounds, and is disabled while the story is paused.
- **手动修改** on an issue opens the editor at that frame or at the ending, with the review comments beside it.
- **保存并重新审核** submits a new version immediately. It runs a full review and draws automatically if the review passes, even if the story was paused. A rejected new version is blocked in turn, so repeated corrections produce v2, v3 and so on.
- **跳过问题并绘图** overrides the review on the blocked version.

Today's behaviour, checked on commit `8924e5d` with Node 24.22.1:

| Check | Result today |
|---|---|
| Two manual corrections in a row | Only v3 is active and on the shelf; v1 and v2 are paused |
| Save from a paused, blocked story | Parent stays paused, and the new version is active |
| Retry from a stale tab on v2 | 202, nothing runs |
| Skip from a stale tab on v2 | 200, v2's review reads as passed, nothing draws |
| Shelf row of a blocked story | Includes `reviewIssues`, `retryStage` and `sourceReady` |
| Blocked after 20 rounds, 20 frames, every frame flagged each round | 548,282-character document, 43 jobs |
| Manual correction flagged by review | Repair replaced the edit, and the story drew all frames without asking (finding 2) |

## Decisions

### Goal 1: newest version only

1. **Eligibility is derived from the rows, not stored.** A version is superseded when another row for the same owner has the same `revision.rootId || id` and a higher `revision.number`. This is the rule the shelf already uses, including deleted rows, so deleting the newest version never promotes an older one. Version numbers only rise, so a superseded version stays superseded unless the newest row's document becomes invalid JSON (see Risks). `generation_control` stays the reader's pause switch, and is no longer used to retire versions.
2. **One JSON-safe definition.** [reader-repository.ts](../../../../../lib/reader-repository.ts) owns the family expressions, guarded with `json_valid`, and `list`, `familyEpoch` and every check below use them. The check now runs on every start, so an unguarded query would let one corrupt row stop all scheduling, not just revisions. Outer columns are qualified as `reader_sessions.document`, because an unqualified name binds to the inner row.
3. **Every place work starts is covered.**

   | Start point | Check | When refused |
   |---|---|---|
   | `canRun`, for text and image jobs | Query the family | The job stays queued |
   | `repo.acquire`, used by the script path and the direct `/advance` path | Not-superseded condition in the UPDATE | No lock; `script()` yields |
   | `image()`, right before the provider call | Query the family | `JobYield`, no attempt used |
   | `demand`, used by `POST /production` and managed `/advance` | Query before writing demand or retrying | Returns the snapshot, like a paused story |
   | `demands()`, both background intent and viewer rows | Superseded rows are excluded | No demand, no rebuild |
   | `resumeInterrupted`, for text and image jobs | Query the family | The job stays failed and interrupted |
   | `POST /source`, which calls the provider directly | Query before calling | 409; `GET` is unchanged |
   | `viewedPublicationPending` | Superseded rows are excluded | An old version can't make other stories wait |

   `basis` and the fork INSERT's condition, which also read stored control, treat a superseded row as paused, so an old version whose row still says `active` can be opened and edited like any other paused version.

   Publication jobs are exempt, because their image is already paid for. Search needs no check: `basis` refuses revisions before confirmation, confirming stops the search, and a revision has no intake. `/suggestions` and `/art-recommendation` aren't tied to a saved story.
4. **The unit of "already started" is one step.** A step that has acquired its lock finishes, and any follow-up call inside that same step can still run. Once a plan exists, each step is a single call. A step with several calls, such as preparing a missing source before planning, can only land on a parent with no plan, which the reader had to pause before forking. Splitting steps further isn't worth the complexity.
5. **Superseded versions are reported as paused.** `snapshot` returns `generationControl:'paused'`, `productionState:'paused'` and a new `superseded:true` for an unfinished superseded row, so `StoryRetry` and the review tools already disable or hide their actions. `StoryGenerationControl` shows a note that this is an old version in place of 恢复生成, because a button that can only return 409 would show its error beneath the modal sheet. Completed rows are unchanged.
6. **Clear refusals, not safety.** `control` returns 409 for resume and `background` on a superseded row, and `overrideReview` does too, before both of its branches and with the same condition in its UPDATE. The message points to the newest version. A paused newest version can still record a skip. Pause on an old row stays harmless.

### Goal 2: atomic publication

7. **The INSERT is the whole publication.** `forkRevision` writes the child's `generation_control` directly: `active` by default, and `paused` for `paused:true`. Inserting it makes every older version superseded in that same statement, and the existing family-epoch condition still decides competing submissions. New rows have no `revision.handoff`, and `control` no longer writes to the parent. A crash before the INSERT publishes nothing, and a crash after it leaves the new version running, which is what the reader asked for. The route calls `wake()` after a default submission, because it no longer goes through `control`, which is what wakes the scheduler today. `ReaderProduction` gains that method.
8. **Old handoff rows still work.** A paused child saved earlier with `revision.handoff` is recovered as before: the route's handoff branch and `control`'s `handoffOnly` guard stay, without the parent write.
9. **No data migration for versions.** Old rows left `active`, including any already hidden and running, become ineligible as soon as this ships. Rolling back to an earlier build would let them run again, so run this before that build starts:

   ```sql
   UPDATE reader_sessions SET generation_control='paused'
   WHERE generation_control='active' AND state!='completed' AND EXISTS(
    SELECT 1 FROM reader_sessions newer WHERE newer.user_id=reader_sessions.user_id
     AND COALESCE(json_extract(CASE WHEN json_valid(newer.document) THEN newer.document ELSE '{}' END,'$.revision.rootId'),newer.id)=COALESCE(json_extract(CASE WHEN json_valid(reader_sessions.document) THEN reader_sessions.document ELSE '{}' END,'$.revision.rootId'),reader_sessions.id)
     AND COALESCE(json_extract(CASE WHEN json_valid(newer.document) THEN newer.document ELSE '{}' END,'$.revision.number'),1)>COALESCE(json_extract(CASE WHEN json_valid(reader_sessions.document) THEN reader_sessions.document ELSE '{}' END,'$.revision.number'),1));
   ```

### Goal 3: four pools

10. **Search gets its own pool, with a limit of 1.** Text keeps its limit of 1, and the image and local limits don't change. Search already writes through targeted, fenced updates, and workers keep the saved intake and change only its phase, so it can run beside a script step. The `snapshot` and `recoverLostImages` pool checks need no change, because `currentJob` already excludes search jobs for intake documents. Within one story, the lock and publication backpressure still order text, image and publication steps. Independent pools don't remove those rules.
11. **Saved search jobs are moved by migration.** Job ids don't include the pool, so a saved `pool='text'` search would never be updated by re-enqueueing, and the pump would skip it forever because its handler pool no longer matches. `drizzle/0008_search_pool.sql` updates every `kind='discover'` row. Rolling back also requires `UPDATE production_jobs SET pool='text' WHERE kind='discover'`.

### Goal 4: checkpoints and receipts

12. **Existing guarantees are protected, not redesigned.** Step-key checks, completed receipts on enqueue, separate image and publication jobs, and copied images in revisions stay as they are. New tests pin the combinations this story changes.
13. **Style-only edits before the plan keep the script.** This narrows the earlier decision in `plan-paused-editing-latest-version` to clear partial storyboards. It applies when the parent has no plan, the requirements and frame count are unchanged, and the saved work's frame count (`draft.pages.length`, otherwise `storyboard.outline.beats.length`) matches the selection. One shared predicate in `lib/reader-revision.ts` decides this. `revisionImpact.replan` stays true for existing callers, and a separate flag drives the message. Shot prompts are independent of art style by contract, and review still checks the result against the new style. A batch the parent finishes after the fork may be paid for again.

### Failure containment

14. **One bad job can't stop the pass.** The pump and `recoverExpired` catch non-persistence errors per job, log once per job id, and continue. Persistence errors still abort the tick and retry, as they do today. Orphaned jobs are not deleted.
15. **A deleted story is not a job failure.** `repo.save` and its 404 are unchanged, because direct `advanceStory` callers must keep getting a 404 for a deleted story. In `script()`, a 404 from `advanceStory` becomes `JobYield` when no lock was acquired, or when `raw` shows the row no longer holds the lock this attempt acquired, so the step's checkpoint was saved. Any other case fails as it does today, so a 404 can't cause a silent paid replay. If the step itself failed while the story was being deleted, the recorded `failure` is handled the way `script()` handles it today: a real failure stays visible and retryable, and a call killed by a stop is reset instead of being reported. The waiting job stays queued until the story is restored and resumed. It then settles through the existing step-key check or moves on to the next step.

### Goal 5: optimization

16. **The pump skips stories that can't run.** The queue gets an optional SQL filter for candidates. It is written as a refusal, so a job with no session row still reaches `canRun` and Decision 14:

    ```sql
    j.kind='image-publish' OR NOT EXISTS(
      SELECT 1 FROM reader_sessions s
      WHERE s.id=j.session_id AND s.user_id=j.owner_id
        AND (
          s.generation_control!='active'
          OR EXISTS(
            SELECT 1 FROM library_deletions d
            WHERE d.story_id=s.id AND d.user_id=s.user_id)
          OR (j.kind!='discover' AND s.state='failed')
        )
    )
    ```

    Deletion is checked by its marker, independently of generation mode or stored control. The existing deletion trigger only stops background stories, so a deleted reader-mode row can still say `active`. Its text, image and search jobs must be filtered before `canRun`; the outer publication exemption still lets already-paid images publish. An orphaned job has no matching session and still reaches Decision 14.

    Superseded rows may still be `active`, so the coordinator also reads the superseded ids that have queued jobs once per cycle, starting from `generation_control='active'` rows so paused stories cost no family scan, and skips their non-publication jobs in the pump. That set is only a shortcut: a stale set can only miss a row, and the checks in Decision 3 stay the authority.
17. **Rebuilding and pruning are skipped when nothing changed.**
    - Job rebuilds use a key of document, selection, row state and that story's demands, excluding `expires_at`, or each viewer renewal would force a rebuild. Row state is required because completion is recorded when a row returns to idle with the same document.
    - The rebuild key is recorded only after `graph` succeeds. Entries for stories no longer scheduled are dropped, so a resume always rebuilds once.
    - Pruning uses a key of document, selection and the story's queued and failed job counts. The counts are required because a job that was running when its story changed can fail after the prune has passed.
    - Both prune steps, including today's global DELETE, are bound per story, and run only for stories whose key changed.
    - Direct calls from a reader's request or retry skip neither step. The keys live in memory, so a restart performs one full pass.
    - With 20 repair rounds, a document's review history can reach hundreds of thousands of characters. Parsed results are reused only while the row's strings are unchanged.
18. **The shelf list drops source text.** `GET /sessions` omits `story.original` and blanks `story.sourceText`. `GET /sessions/:id` is unchanged, and the source sheet already falls back to `/source`. `reviewIssues`, `retryStage` and `generationProgress` stay in the list. `StoryReviewTools` is the main recovery surface for a blocked story, and its `story.original` guard would hide it when a blocked story with a first frame is opened in the reader and its full session fails to load. The guard becomes exactly:

    ```ts
    if(!session.story||!(session.story.original||session.generationProgress?.sourceReady)||session.story.pages[0]?.image&&!issues.length)return null;
    ```

    `session.story` stays required, so stories with no plan keep rendering nothing during planning. A blocked story with no images shows only a toast if its load fails, and tapping its card retries. That is today's behaviour, and it doesn't change.
19. **Expired viewer rows are deleted by expiry alone.** `cycle` runs `DELETE FROM production_demand WHERE expires_at<=?`. It doesn't filter by runtime, so another live process's rows are safe, and rows from past runs are gone within one lease.

## Tasks

### Baseline

- [x] Confirm the recorded Git base and implement directly on `main`. Keep the three story documents here, use existing dependencies and restore missing dependencies with `pnpm install --frozen-lockfile` only when required. Select Node 24.22.1 explicitly because the default shell runs 22.23.4.
- [x] Replace unavailable prior scratch reproductions with equivalent isolated controlled regressions and `tests/queue-hardening-cost.mjs`, whose source-root parameter measures either extracted recorded-base code or the checkout. Measure 20 paused, 20 unchanged active (pump stubbed), one blocked active among 20 paused stories (unstubbed), and 20 blocked stories with 20-round history. Record numerical costs below without claiming the missing scratch scripts were rerun. Runtime probes must stop dependent work if they reveal a materially different flow or architecture.

### Milestone 1: newest version only (AC1–AC6)

- [x] Add the JSON-safe family expressions and a superseded check in `lib/reader-repository.ts`, and use them in `list` and in `familyEpoch` in [reader-revisions.ts](../../../../../server/reader-revisions.ts).
- [x] Add the check to each start point in Decision 3, in `lib/reader-repository.ts`, [reader-production.ts](../../../../../server/reader-production.ts) and [reader-api.ts](../../../../../lib/reader-api.ts).
- [x] Apply Decisions 5 and 6 in `snapshot`, `control`, `overrideReview` and [StoryGenerationControl.tsx](../../../../../client/ui/StoryGenerationControl.tsx), and treat a superseded row as paused in `basis` and the fork INSERT.
- [x] Add regression tests that start each route on an old version whose row still says `active`, including the `repo.acquire` condition through a direct `/advance` on a row with no jobs. Add a fork landing between `canRun` and `image()`, a deleted newest version, a corrupt row, an interrupted old job, and an old version holding a viewer row while other stories wait to draw. Assert zero provider calls and unused attempts.

### Milestone 2: atomic publication (AC7–AC11, AC20)

- [x] Write the child's control directly in `forkRevision`, stop writing `revision.handoff` on new rows, remove the parent writes from `control`, and call `wake()` after a default submission. Keep the handoff branch for rows saved earlier.
- [x] Rewrite the tests that pin the old two-step design, keeping what they protect:
  - `tests/reader-revisions.test.mjs:124`: restart, deleted parent and replay
  - `tests/reader-revisions.test.mjs:133`: crash recovery, now a failed INSERT publishes nothing, and a crash after it leaves one running version
  - `tests/paused-editing-versions.test.mjs:109-126`: replays must not override a later pause or resume
  - `tests/reader-revisions.test.mjs:58`: still passes, but its title describes the old handoff, so rename it
- [x] Add tests for an old in-flight request saving to the old version only, a finished old image publishing, a seeded old handoff row recovering, two corrections in a row, saving from a paused and blocked story, and a stale-tab retry and skip.

### Milestone 3: four pools (AC12–AC14)

- [x] Add `drizzle/0008_search_pool.sql`. In `reader-production.ts`, add `search:1` to the limits, move the `discover` handler and its enqueue call to it, and update the header comment.
- [x] Add regression tests for AC12–AC14, covering queued and interrupted jobs saved with `pool='text'`. Update the tests that enqueue `discover` with `pool:'text'`, and the now-stale assertion message at `tests/story-flow-control.test.mjs:146`.

### Milestone 4: checkpoints and receipts (AC15–AC17)

- [x] Add the Decision 13 predicate and flag. Copy `storyboard` and `draft` into the child in `forkRevision`, and report the saved frame count in `revisionSnapshot`.
- [x] Update the replan branch of the impact message in [StoryRevisionEditor.tsx](../../../../../client/ui/StoryRevisionEditor.tsx) so it doesn't promise a replan in this case. The `reviewOnSave` wording stays as it is, because that path always has a plan.
- [x] Add regression tests for AC16 with a storyboard and with a draft-only short story, for AC17, and for AC15 across retry, restart and revision reuse with the new eligibility rule. Check the message in the in-app browser with `pnpm desktop:preview` or the reader preview, against an isolated data directory with no paid calls.

### Milestone 5: failure containment (AC18, AC19)

- [x] Add per-job containment to `pump` and `recoverExpired`, and make the coordinator's prune and lease loops tolerate a missing row.
- [x] Apply Decision 15 in `script()`.
- [x] Add regression tests for AC18 using ready orphaned `script`, `discover`, `image` and publication jobs, because a job with an unfinished parent never reaches `canRun`. Add tests for AC19, including a step that fails during deletion. Keep `tests/reader-generation.test.mjs:372` and `tests/local-image-batches.test.mjs:174` passing unchanged.

### Milestone 6: optimization (AC21–AC25)

- [x] Add the candidate filter and superseded shortcut to the pump in [production-queue.ts](../../../../../server/production-queue.ts), and supply them from the coordinator. Check deletion markers for both background and reader modes, including rows still marked `active`, while exempting publication jobs.
- [x] Apply Decision 17 in `cycle` and `pruneSuperseded`. Reuse the parsed result for `readable` and `imageInputs` while a row's strings are unchanged.
- [x] Replace the repeated `JSON.parse` of job dependencies with one helper at the three call sites. Replace the full job load in `canRun` with a query for failed and running-publication rows.
- [x] Add a shelf-only view in `lib/reader-api.ts`, and change the guard in [StoryReviewTools.tsx](../../../../../client/ui/StoryReviewTools.tsx) to the exact form in Decision 18.
- [x] In [Reader.tsx](../../../../../client/ui/Reader.tsx), catch a rejected `retrySession` from the settings sheet's `onRetry` and show it through `StoryReviewTools`' `error` prop, clearing it on the next attempt. **继续自动修复** otherwise does nothing visible when the session can't load, and `notify` won't do: its toast renders beneath the modal sheet.
- [x] Add the expired-demand delete to `cycle`.
- [x] Add deterministic tests: no `canRun` calls for paused, deleted or superseded stories, including an `active` reader-mode row with a deletion marker and ready queued text, image and search jobs. Assert no provider calls or attempts used, while an already-paid image still publishes to that deleted story. Keep the orphaned-job coverage from AC18.
- [x] Add the remaining deterministic tests: at most 60 statements in a warm pass over 20 paused 80-frame stories, no job upserts on an unchanged tick, viewer renewal causes no rebuild, publication still runs while paused, a job that fails after its story changed is pruned, the shelf has no source text while the opened story does, a live viewer survives the cleanup, a trimmed shelf row with issues and a story shows the tools, and a `story:null, sourceReady:true` session renders nothing. Timing stays out of the test suite.
- [x] Rerun R9 against the AC21 and AC22 targets and record the results below. If a blocked active story is still a main cost, add a per-pump cache of refusals. If the shelf's version query is, record it as a follow-up.

### Verification and documentation

- [x] SS focused checks: `pnpm typecheck`, `pnpm lint`, and the 11 named regression files recorded in Evidence on Node 24.22.1.
- [x] VR round 1 correction: fence `resume` and `background` control writes with the newest-version SQL predicate; a newer child inserted immediately before the UPDATE must produce 409 and preserve the parent row. Both HTTP interleavings reproduced 200 before the fix and now pass.
- [x] Persist the trimmed-review and null-story rendering regressions in `tests/storyboard-ui.test.mjs`.
- [x] TT: all unit/integration files on Node 24.22.1. Final run uses `pnpm exec node --experimental-strip-types --test --test-concurrency=2 --test-timeout=60000 tests/*.test.mjs`; see resumed evidence for the default-concurrency Vite hang.
- [x] Run [test-production-queue-hardening.md](../../../../tests/test-production-queue-hardening.md).
- [x] Update `.docs/story-creation-editing-queue.md`: pool table, atomic publication flow, checkpoint reuse, stale-version rules and affected implementation links. Preserve unrelated development/user-guide edits.

## Risks

- **Rollback needs two statements.** Old rows stay `active`, so an earlier build would let hidden versions run again. Before rolling back, run the statements in Decisions 9 and 11.
- **A corrupt newest row can revive an older version.** Default forks leave the parent's row `active`, so if the newest row's document became invalid JSON, the older version would look newest and could start drawing with no reader action. The shelf rule already promotes it in that case, and today its stored pause would prevent drawing. App writes go through `JSON.stringify` and `json_set`, so this needs hand-edited data. Accepted, because a second write to pause the parent would bring back the separate step this design removes.
- **A step that already started can still pay once more.** See Decision 4. This is bounded to one step per fork.
- **The family query now runs on every start.** Until Milestone 6, each start costs one more query that parses documents. It only reads rows belonging to one owner, and libraries are small.
- **Two text-class calls now run at once.** Codex or Gemini quotas may be hit sooner while a search overlaps a script step. Images already run three calls at once, and a failure is reported the same way as today.
- **A skipped rebuild could hide a missing job.** A job deleted by hand while the service runs won't be recreated until its story changes, the story stops being scheduled, or the service restarts. App code only deletes jobs that are superseded or whose story has changed.
- **Refusing to resume or skip on an old version changes the API.** The only UI routes are an old link or a stale tab. The resume button is replaced by a note, and a refused skip appears in the review tools' error area.
- **Repair rounds can be costly after a style-only edit.** If review flags kept pages, a new version can run up to 20 paid repair rounds. Shot prompts are style-independent by contract, so this should be rare.
- **Review history grows with the repair cap.** The largest document measured was 548,282 characters. The shelf's version query parses documents for every pair of rows, so it may become the main shelf cost, and the in-memory keys hold full document strings. The R9 run with review history measures both. If the query is the main cost, record it as a follow-up.
- **The desktop shelf SQL is not hardened here.** `desktop/library.sql` still has unguarded `json_extract` calls on document contents. AC6 covers the reader API only.
- **Finding 2 stays open, and this plan does not reduce it.** A manual correction can be replaced by automatic repair, then drawn without asking.

## Cost results

Synthetic stories: 80 frames, 20k-character source. Targets are in AC21 and AC22.

| Scenario | Stage | Cycle ms | Statements | Shelf bytes |
|---|---|---|---|---|
| 20 paused | Review (Node 22) | 860 | 2,848 | 1,915,141 |
| 20 active, pump stubbed | Review (Node 22) | 276 | 3,327 | 1,915,201 |
| 20 paused | Baseline (Node 24, stable earlier run) | 80.622 | 88 | 2,711,181 |
| 20 active, pump stubbed | Baseline (Node 24, stable earlier run) | 108.698 | 3,327 | 2,711,181 |
| 1 blocked active + 20 paused, unstubbed | Baseline (Node 24) | 82.122 | 96 | 2,846,922 |
| 20 blocked, 20-round history | Baseline (Node 24) | 37.671 | 168 | 2,715,181 |
| 20 paused | After fix | 5.263 | 9 | 308,121 |
| 20 active, pump stubbed | After fix | 26.367 | 28 | 308,121 |
| 1 blocked active + 20 paused, unstubbed | After fix | 7.091 | 10 | 323,709 |
| 20 blocked, 20-round history | After fix | 62.877 | 29 | 312,121 |

## Evidence

SS runtime: existing `/Users/esun/.nvm/versions/node/v24.22.1/bin/node`, Node 24.22.1, pnpm 11.25.0. Main HEAD matched the preserved base; dependencies were present and no install ran. Missing prior scratch reproductions were replaced by `tests/queue-hardening-cost.mjs`, an isolated in-memory SQLite measurement against an extracted copy of the recorded Git base (not a branch/worktree). Equivalent fixtures are not claimed to rerun the missing scratch files. Baseline results: paused 74.966 ms / 88 statements; active (pump stubbed) 104.519 ms / 3,327 statements; blocked active 0.743 ms / 16 statements; 20 blocked with history 36.474 ms / 168 statements. Shelf bytes respectively 2,711,181 / 2,711,181 / 135,740 / 2,715,181. Dependent runtime probes passed.

Milestone 1 verification: 47 existing production/revision/paused-version tests plus 3 new eligibility regressions passed; `pnpm typecheck` passed. Local milestone hash recorded after commit below.

Milestone 1 commit: `25ed11a`. Milestone 2: atomic active/paused child insertion, immutable parent control, legacy handoff recovery and replay fencing implemented. Focused revision/paused-version/hardening tests: 30 passed; typecheck passed.

Milestone 2 commit: `a2f8d2d`. Milestone 3 implements independent search:1/text:1 pools and migration 0008; focused intake/flow/queue checks passed 54 tests before the two additional pool/migration pins.

Milestone 3 commit: `28bbec9`; all 10 generic queue tests (including both new pins) passed. Milestone 4: shared saved-frame predicate and preview flag preserve storyboard/draft for style-only pre-plan revisions, with next-step checkpoint regression pins. Focused tests: 32 passed; typecheck passed. In-app browser rendered the actual `StoryRevisionActions` component on the reader Vite preview with an isolated 60-frame fixture: “保留已保存的分镜与草稿，只完成剩余编排并审片；需绘制 60 幅。” Desktop preview cannot resolve reader-only `@/lib` aliases; reader preview was used as allowed, without a backend or provider.

Milestone 4 commit: `a06a628`. Milestone 5: pump/recovery contain non-persistence failures per job and log once; pruning and lease release tolerate absent rows; deleted script checkpoints yield without an attempt, while recorded genuine failures remain retryable. Focused hardening/queue/generation/local-image tests: 90 passed, including the unchanged direct-generation and local-image deletion cases; typecheck passed.

Milestone 5 commit: `6ea16fd`. Milestone 6 implements grouped per-story pruning keys, row parsing and rebuild caches, candidate SQL filtering, queued superseded shortcuts, targeted failure/publication queries, dependency parsing reuse, shelf source trimming and expiry-only viewer cleanup. The settings review retry catches load failures in the visible sheet. In-app browser verified actual trimmed-row review tools (one visible review surface, retry button and error), a null-story/sourceReady fixture rendered zero children, and an old version showed its note instead of resume.

Final focused command: `node --experimental-strip-types --test tests/production-queue-hardening.test.mjs tests/production-queue.test.mjs tests/reader-production.test.mjs tests/reader-revisions.test.mjs tests/paused-editing-versions.test.mjs tests/story-flow-control.test.mjs tests/storyboard-review.test.mjs tests/queue-interruption.test.mjs tests/reader-generation.test.mjs tests/local-image-batches.test.mjs tests/reader-intake.test.mjs`: **246 passed, 0 failed**. `pnpm typecheck` and `pnpm lint` passed. No full TT or scenario ET was executed.

Costs are medians of five warm passes, with SQLite in memory, 80-frame controlled plans and 20k-character source text. The single blocked run includes 20 paused stories. The final paused baseline was noisy (median 245.980 ms, range 216.951–500.455), so the table conservatively uses the earlier stable 80.622 ms measurement of the identical fixture/base; final active baseline was 130.207 ms and the table similarly retains its earlier stable 108.698 ms. After paused range: 5.070–5.573 ms. **AC21: 9 <= 60 statements; 5.263 / 80.622 = 6.53% <= 10%. AC22: 28 / 3,327 = 0.84% <= 25%.** No `canRun` refusal cache was added because blocked non-search generation is already rejected by SQL before evaluation.

Follow-up (outside this story's version-query scope): with 20 history-heavy blocked stories the shelf family query takes 62.902 ms and the cycle 62.877 ms; family eligibility scans, not provider dispatch, dominate this fixture, whose cycle is slower than its 37.671 ms baseline despite fewer statements. Shelf bytes fall from 2,715,181 to 312,121, but this work does not claim universal elapsed-time improvement.

Milestone 6 commit: `080b61a`. All six implementation milestones are locally committed on `main`; the recorded base is unchanged. Both preview helpers were stopped and isolated browser fixtures removed. Owned scratch logs and the extracted baseline were removed. No branch/worktree, merge, push, paid call, real-library write, Docker build or desktop package was performed.

Independent read-only CR covered the entire story scope since the recorded base, including persistence, migrations, cache invalidation, concurrency, eligibility, paid-work containment, compatibility, tests and evidence:

CR passed: no major findings

CR risk: non-low — changes affect paid-work eligibility, concurrent scheduling, persistence and migration behavior. Recorded verification evidence was reviewed; no tests or paid calls were executed. Full TT and ET remain pending.

CR review round: 1; reviewer: new

Standalone SS stops here. TT, ET and acceptance/VR checkboxes remain downstream, not silently marked complete. Unrelated entry edits to `.docs/development.md` and `.docs/user-guide.md`, and concurrent `.gitignore`, `lib/reader-zip.ts`, `tests/reader-zip.test.mjs` changes were left unstaged and untouched.

RPD resumed after the user's explicit continuation. Initial full TT passed 802 tests on Node 24.22.1 / pnpm 11.25.0. Independent VR round 1 found a control-write race: publication between the supersession lookup and resume/background UPDATE returned 200 and changed the old row. The paid-start guards still prevented old generation. Both real HTTP interleavings reproduced the defect; the UPDATE now includes the authoritative latest-version predicate, and a superseded refused write returns 409 without changing the old row. Focused revision/control verification passed 44 tests, typecheck and lint. Final TT, ET and independent review follow this correction; earlier TT does not certify the changed code.

Correction commit: `482d016`. An additional controlled HTTP/queue scenario in `tests/story-flow-control.test.mjs` proves a held search lets its own preparation and another story finish while a second search waits; it passed in isolation and in the final suites.

Final TT: **805 passed, 0 failed, 0 skipped**, all unit/integration files, concurrency 2 with a 60-second per-file timeout (91.413 seconds overall). Before the extra scenario, default `pnpm test` passed 804 tests; a later default-concurrency run stalled in the unrelated Vite `development-access.test.mjs` file and was stopped. That file then passed both tests in isolation and in the final bounded-concurrency suite. No test assertions or application code were changed to bypass the hang.

Final ET harness command: `pnpm exec node --experimental-strip-types --test tests/production-queue-hardening.test.mjs tests/production-queue.test.mjs tests/reader-production.test.mjs tests/reader-revisions.test.mjs tests/paused-editing-versions.test.mjs tests/story-flow-control.test.mjs tests/storyboard-review.test.mjs tests/queue-interruption.test.mjs tests/reader-generation.test.mjs tests/local-image-batches.test.mjs tests/reader-intake.test.mjs tests/storyboard-ui.test.mjs`: **250 passed, 0 failed, 0 skipped**. Final `pnpm typecheck` and `pnpm lint` passed.

Actual Reader browser ET used an isolated SQLite/media fixture and controlled provider adapters on the reader Vite preview, not a real library. On a fresh visible in-app tab, normal Playwright clicks verified trimmed-shelf first-image fallback under full-session GET 503, review issues/actions, retry error inside the sheet, and the no-image error/card retry. Opened source displayed 73 saved characters; ZIP unpacked to two WebP images, Markdown and story JSON (12,416 bytes); PDF had the `%PDF-` signature (187,029 bytes). Initial hidden-tab synthetic clicks were not the final browser evidence. Fixture-only proxy-origin refusals affected ancillary production/progress writes; mutating endpoint contracts were instead verified by the real HTTP harnesses. Scenario mapping and observed outcomes are recorded in the ET specification.

Final independent CR: `CR passed: no major findings`; CR risk: non-low — paid-work eligibility, concurrency, persistence and public API contracts; CR review round: 3; reviewer: reused.

Final independent VR: `VR passed: all acceptance criteria complete`; VR risk: non-low — changes affect paid-work eligibility, concurrent scheduling, persistence, migration and public-reader behavior; VR review round: 4; reviewer: reused. All 25 ACs and all executable AP tasks are complete; the full final review is preserved verbatim in [DD](../../../../done/2026/11/01/production-queue-hardening.md#final-vr). Preview helpers stopped, browser routes removed and the explicitly owned temporary fixture/script cleaned up. No paid-provider request, real-library write, build/package or push.

AR passed: no blocking architecture flaws (round 5, full review of this design by the reused independent reviewer). Its non-blocking corrections were applied afterward without another review round. They are the eligibility wording, the extra `demands`, `viewedPublicationPending` and `basis` checks, the old-version note, `wake()`, rollback SQL, test line numbers and scenario setups.

The rollback statement in Decision 9 was run on an in-memory SQLite database with a corrupt row, a completed family and another owner's row. It paused only the unfinished superseded versions.
