# Story flow: nothing lost, nothing stuck, nothing misreported

## Summary

Fixes the findings from the single-owner review of story creation, editing and the queue. There is no billing or multi-user assumption left in this flow's design; model calls still use the owner's own quota.

- **Search stands apart from the chosen story.** Search has its own state beside the selection and holds no story lock. Finding more stories no longer cancels preparation, a failed search stays with the search, and a prepared story can be confirmed or a found candidate chosen while a search runs. Confirming ends the search.
- **Searches can be stopped.** Pause, delete and service stop end a search between calls and free the only text slot. A clean stop spends no attempt; a call killed by a stop counts as an interruption under the existing replay cap, and restart reads on from the saved position.
- **Drafts survive.** Only changes to the requirements, style, storyboard, characters, reflection or version family conflict with a draft; images and progress never do. On a real conflict the draft stays until the reader discards it, and the first image arriving does not clear it.
- **Blocked reviews have a way out.** Any blocked version lists every open issue and can be viewed, edited or drawn anyway, including a revision that reused its first image. "仍然绘制" is the reader's explicit override and is safe to repeat.
- **Honest redraws, no confirmation gates.** Lost images are redrawn in the new version. The preview text says review can add redraws; when the real count exceeds the preview, the new version says how many and why, and pause stays available. A temporarily unreadable image still stops the submission.
- **Setup keeps what the reader did.** Manual settings save as a draft that survives search, leaving and refresh without interrupting preparation. Clicking the selected story only closes the sheet. Art recommendations apply until the style is really changed by hand. Old records get a "准备这篇" action.
- **Phone and desktop on one shelf.** A page waiting on a choice follows the other device, offers keep or adopt instead of overwriting, and recovers from a rejected action without a reload.
- **Queue tidy-up.** Manual retry restores only the current selection, superseded jobs leave the queue on every story, and an expired lock on a paused story no longer blocks setup.

The stored schema is unchanged. `drizzle/0006_intake_search.sql` is a data migration only: saved searches in progress move to the new state, saved search failures stop being story failures, and unfinished old search jobs are removed. Invalid documents are left untouched, and the desktop summary still reads a library the service has not migrated.

## Verification

Node 24.22.1, pnpm 11.25.0.

- `pnpm exec tsc --noEmit`, ESLint on the changed source and test files, and `git diff --check` pass.
- Every test file run on its own with a timeout: 52 files, 522 tests, 0 failures. This includes `tests/development-access.test.mjs`, which hung a combined `node --test tests/*.test.mjs` run earlier today before it was stopped, and which passes on its own. The combined `pnpm test` command was not rerun on the final code.
- New `tests/story-flow-control.test.mjs` (real SQLite and FileMedia, controlled provider) covers call counts for each criterion, the migration matrix (queued, dead lock, failed with and without a selection, paused, invalid JSON), and the summary SQL on a library older than the service's migrations. `tests/story-discovery-cache.test.mjs` adds the drain and read-on cases.
- Tests that pinned the old behaviour were changed on purpose: `tests/reader-intake.test.mjs`, `tests/reader-revisions.test.mjs` (a lost image is now redrawn) and `tests/queue-interruption.test.mjs` (the save statement it targets changed).
- In-app browser, isolated library, controlled provider: every scenario in `.docs/tests/test-story-flow-reader-control.md`, a 375px layout check, and the desktop preview queue.
- Architecture review: blocked in round 1, `AR passed: no blocking architecture flaws` in round 2. Code review: blocked in round 1, `CR passed: no major findings` in round 2. All by an independent reviewer.
- No real model calls, no Docker build, no desktop packaging, and `cargo test` was not run; a Node test covers the summary SQL's old-library case instead.

### Final VR result

Reported by the independent reviewer in VR round 2, and its pending condition has since been met by the run above.

> **Result:** the three open items are now complete, apart from the final test run on req line 33, which you said you will confirm. In this round I changed no repo files and deleted my scratch probe afterwards. `tsc --noEmit` is clean, and `story-flow-control`, `production-queue`, `queue-interruption` and `reader-intake` passed 80/80 on the current code.
>
> **Req line 28: complete.** `pruneSuperseded` (`server/reader-production.ts:354`, called from `cycle` at `:455`) runs every cycle and joins on `reader_sessions` directly. It isn't limited to stories with demand, so it covers completed, paused and deleted ones. The old `if(!doc.plan)` prune is gone. The test `superseded jobs leave the queue on finished, paused and deleted stories too` covers queued and interrupted-failed rows, and checks that current work stays. Non-intake stories are never touched, a current-round search survives while paused, the only non-discover jobs it deletes are ones `currentJob` already rejects, a restored story loses only superseded rows, and a running old-generation job is left alone and pruned if requeued. A story with `{not json` as its document did not make the tick throw, another story still completed, and the broken story's job was left in place. Manual retry restoring only the current generation is unchanged.
>
> **Req line 38: complete, on your reported browser evidence.** The reviewer did not observe these runs. 准备这篇: rewritten old record showed only "准备这篇"; a failed preparation showed only "重试生成"; retry reached confirming. 两台设备: "采用最新内容" reset the edit from 3 to 7; confirm succeeded against the other device's story with no alerts; keep-mine came from the earlier run. 超出预览的重绘: showed "实际需重绘 7 幅（预览 0 幅）：审片修改了首幅…" after a preview of 0 redraws, and the notice text says the reader can pause; the pause control itself was not part of this report. 丢图后修改幅数: created with no alert and completed. The other nine scenarios were covered in the earlier run, and the call-count half of the criterion was already complete.
>
> **Req line 33: pending only on the final run.** The code still shows no regression to old flows.
>
> The other 20 criteria stay complete as reported in VR round 1. The new changes don't affect that evidence.
>
> **Pending condition:** this verdict holds only if your full per-file test run on the final code passes.
>
> VR passed: all acceptance criteria complete

## Notes

- **Migration already applied to the real development library.** The running dev server rebuilt on the in-progress code and applied `0006` to `~/Library/Application Support/com.shiqu.desktop/library` at 2026-10-30 19:03 UTC. No story was mid-search, so no document changed, and it has been running this code since. Reverting this change without restoring the library would leave `0006` recorded as applied; the migration's effect on that library was nil, and an older build tolerates the data.
- **Dev server restarted** at the owner's request, on Node 24.22.1 in a Terminal panel tab. It had been running on Node 22.23.4, not the project's `.nvmrc` version.
- **Known small gaps, left as they are:** a search stopped by pause shows "等待生成" in the desktop queue while the web shows paused, the same as paused image jobs, because the summary SQL must not read `generation_control` on old libraries. The two-device logic and draft refresh have no automated behavioural test, only the browser scenarios above. If a draft is saved with values identical to what is already stored, the next remote change can be treated as the reader's own.
- **Not committed.** Everything is in the working tree on `main` against base `14b5ac7`. `CHANGELOG.md`, `package.json` and `src-tauri/*` hold unrelated uncommitted changes that are not part of this story.
