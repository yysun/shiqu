# 制作调度节拍只读取有变化的故事

## Summary

- 新增迁移 `0022_story_content_revisions.sql`：独立小表 `story_revisions` 由更新和插入触发器维护故事内容修订号；覆盖索引 `stories_production_scan(id,user_id,state)`。`stories` 表的列不变，`latestMigration` 更新，`schemaVersion` 不变。
- `server/reader-production.ts`：完成检查、过期任务清理、按需求重建任务图三处先用 `INDEXED BY` 轻量查询修订号，只对上次检查后有变化的故事读取全文；完成检查每行只解析一次。
- 新测试 `tests/production-tick-scope.test.mjs`（自动运行）覆盖触发器语义、三处查询计划和节拍读取范围。

## Verification

- 书库副本（只读 `.backup` 快照）上每个节拍三处查询：

  | 步骤 | 原整行读取 | 新轻量查询 |
  |---|---|---|
  | 完成检查 | 60.86 ms，30 行，9,026,247 字符 | 0.03 ms，52 行，2,808 字符 |
  | 过期任务清理 | 11.81 ms，21 行，2,799,118 字符 | 0.10 ms，21 行，1,134 字符 |
  | 重建任务图 | 4.80 ms，3 行，921,931 字符 | 0.00 ms，3 行，180 字符 |

  原数值未计 JavaScript 侧的 JSON 解析；内容未变时新方案不再解析。
- `pnpm test:pr --files <本次文件>`：87/87；按需制作流程测试（受控提供方）9 个文件 163/163；`pnpm desktop:test`（cargo test）26/26；`pnpm typecheck`、`pnpm lint` 通过。
- AR 两轮（第 1 轮因重建循环回表阻塞，改为独立修订表后通过）；CR 两轮（第 1 轮因 `db/schema.ts` 文件头为英文阻塞，修正后通过）。

### VR 结果

**VR result: all ten acceptance criteria are complete, and every plan task is checked off.**

Scope: `069dd93..HEAD` plus the uncommitted CR fixes in `db/schema.ts`, `server/reader-production.ts`, the plan and the new test. I re-ran `production-tick-scope` (3/3), `story-storage-consolidation` (29/29) and `blocked-revision-recovery` (3/3). The plan has no unchecked boxes left.

**Acceptance criteria**

1. **Complete: each story keeps a content revision that any write changes.** The update and insert triggers are in `drizzle/0022_story_content_revisions.sql:3-15`. The first test in `production-tick-scope` shows that a partial `json_set` write that leaves `updated_at` alone, and a selection write, both bump the revision. A new story starts at 1, and a state-only or same-content write leaves it unchanged.
2. **Complete: the completion check and job cleanup skip unchanged stories.** The skips are at `server/reader-production.ts:871` and `:725`. The third test asserts that the second tick reads no full story.
3. **Complete: full reads track changed stories, not the number of paused stories.** In the third test, each step re-reads only the story that changed (a, b, b, c).
4. **Complete: the light queries are answered from the index alone.** All three `productionRevisionSql` queries use `INDEXED BY stories_production_scan`. The second test checks their `EXPLAIN QUERY PLAN` shows `USING COVERING INDEX`.
5. **Complete: a paused story that becomes complete is marked on the next tick.** The third test covers this for story a. An incomplete story's revision is recorded at `:877-878`, so it is not parsed again.
6. **Complete: the first tick after a restart checks everything.** The checked revisions live only in memory, and the restart part of the third test asserts a full read on the first tick, then none on the second.
7. **Complete: job cleanup still runs on content or count changes, and when forced.** The key at `:724-725` covers revision, queued and failed counts, plus the forced case. The third test covers queued-only, failed-only and forced cleanup.
8. **Complete: the completion check reuses the parsed story.** `readable()` fills the parse memo and `parsed()` returns it, so each row is parsed once (`:877`).
9. **Complete: the upgrade uses the normal backup and migration path, and older apps still open the library.**
   - The migration runs through the normal runner, and `latestMigration` is updated.
   - Both upgrade tests assert 0022 is applied and call `verifyLibraryBackup`.
   - `schemaVersion` stays at 1, and the version gate (`server/library-upgrade.ts:253`) checks only that.
   - Older Node apps tolerate a migration they do not know (`library-upgrade.ts:169` filters only their own pending names). The native check (`src-tauri/src/library.rs:89-95`) only asks whether its own latest migration exists.
10. **Complete: the reader API, session types, `stories` columns and export are unchanged.** `stories` gains only an index, and no API, type or exporter file changed. The revision lives in its own `WITHOUT ROWID` table, so a story write never rewrites the story row to record it.

**Evidence I could not check myself**

- **TT totals and the native `cargo test` run.** I accept 26/26 for `cargo test`, since no Rust, library-format or migration file changed after it ran.
- **Real-library measurement.** It is consistent with the requirement's baseline (30 rows, about 9.03M characters, versus 9.07M stated), but I did not touch the real library.

**Incident note (not a criterion failure, but tell the user)**

- **Bad SQL reached the real library briefly.** The user's own `pnpm dev` watcher applied 0022 to the real library before the prune join-order fix, which caused one `production_tick_failed` error. The upgrade went through `ensureLibraryReady` and took a verified backup, and the fixed code has run without failures since.
- **The library is now on 0022.** Because the migration only adds a table, triggers and an index, older apps can still open it, but the user should know the upgrade already happened outside the release flow.

VR passed: all acceptance criteria complete

## Notes

- 运行中的 `pnpm dev`（`node --watch`）在实现期间重新加载，已通过 `ensureLibraryReady()` 把 0022 应用到本机书库，升级前备份为 `library-backups/pre-upgrade-2026-11-19T17-26-08-659Z-0239e27c`。修正清理查询连接顺序前约 70 秒内有一次 `production_tick_failed`（失败节拍不派发任务），此后无失败。
- 后续改进（未做）：`supersededSql` 每个节拍在 SQLite 中解析所有故事的 JSON，可用修订根与版本号的表达式索引替代；提示词记录（约占文档 83%）可移出 `document`。
- 未单独测试：标记完成未生效后的重试，以及轻量查询与整行读取之间发生写入；两者依据计划中的论证（不记录修订号，下个节拍重试）。
