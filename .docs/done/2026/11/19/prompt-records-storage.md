# 提示词记录移出故事文档

需求：`.docs/reqs/2026/11/19/req-prompt-records-storage.md`
计划：`.docs/plans/2026/11/19/plan-prompt-records-storage.md`
提交：`ff233c4`、`4005a62`，以及本完成说明所在的交付提交

## Summary

- 新表 `prompt_records(id, record)` 按内容存放提示词全文，`id` 为记录 JSON 的 SHA-256，相同内容只存一份。故事文档的调用记录项把 `promptRecord` 原位替换为 `promptRecordId`。
- 写入点在序列化前存记录并替换为引用：`save`、`saveImageProgress`、`create` 和发布图片 SQL。读取点 `/prompts`、`/review-history` 按引用批量还原。仍内嵌记录的旧文档照常可读；引用的记录行缺失时列入 `missingRecords`。
- 跨书库复制先在来源库把引用还原为内嵌记录，再由目标库的 `create` 存表。`contentHash` 保持原有输入形状，升级前创建的文字副本仍可补复制图片。
- 迁移 `0024_prompt_records.sql` 由代码钩子 `server/prompt-record-migration.ts` 在升级事务中逐篇移出记录，并核对还原后与原文档逐字相同、全库无残留内嵌记录、无悬空引用。任何不一致都会整次回滚。迁移不改 `updated_at`，跳过非对象和非法 JSON 的项。

## Verification

- `pnpm test:pr`（本次文件）428/428；`tests/prompt-records-storage.test.mjs` 4/4；跨书库复制 3/3；原生 26/26；typecheck、lint 通过。
- 按需套件（审校历史、提示词导出、制作流程、发布、意向、书架、状态机等）通过。
- 书库快照副本：
  - 迁移耗时 1.03 s，185 篇的提示词输出 0 差异；`reader_commands`、`reader_faults` 行数不变；`integrity_check` 通过。
  - 故事文档 4355 万 → 782 万字符（−82%）；记录 1623 行、2190 万字符（去重 39%）。
  - 重启首个节拍 105 ms / 1220 万字符 → 34 ms / 250 万字符。

### VR 结果

```
**VR result: all eight acceptance criteria for prompt-records-storage are complete.**

Scope: `fbf3a17..HEAD`, which is ff233c4 plus 4005a62; the working tree is clean. Since my CR, the only changes are the fixes you listed, and I reviewed them. I re-ran `prompt-records-storage` and it passes 4/4. The plan has no unchecked tasks.

**Acceptance criteria**

1. **Complete: new calls store only a reference.**
   - `save` and `saveImageProgress` store records first (`lib/reader-repository.ts`), and so does the image publish path (`server/reader-production.ts:848`).
   - The test "制作流程保存的文档只含提示词引用…" asserts that no `promptRecord` is left after a full flow. It also checks that each id is the content hash and that `/prompts` returns the stored records.
2. **Complete: identical prompts are stored once, and revisions and copies reuse references.**
   - Inserts use content ids with `ON CONFLICT DO NOTHING`, and the migration test asserts 3 rows for 5 inline records.
   - Revisions copy the `usage` entries unchanged, references included (`server/reader-revisions.ts:93`).
   - The cross-library copy test in `headless-cli` (manual) asserts the target has only references, all readable from its own table.
   - Neither new test creates an actual revision after migration; the evidence for that path is the code plus the migration's revision-copy fixture (child).
3. **Complete: the migration moves every record and rolls back on any mismatch.**
   - The hook checks each document by restoring it from references, then checks that no inline records remain and no reference dangles (`server/prompt-record-migration.ts`).
   - The test "迁移核对失败时整次回滚" confirms rollback.
   - Non-object entries no longer stop the migration: the CASE guard is exercised by the `'legacy-text'` fixture entry.
4. **Complete: prompt, review-history and export output is unchanged.** The migration test asserts `/prompts` and `/review-history` are deep-equal before and after, along with `updated_at` and the command and fault counts. On the snapshot, all 185 stories compared with 0 differences. Export reads the same `/prompts` history, and the on-demand prompt-export suites passed.
5. **Complete: documents that still embed prompts display and export normally.** `usageRecord` prefers the embedded record. The mixed-and-missing test asserts an embedded record is still output and that a missing reference is listed as missing at the right index.
6. **Complete: the size targets are met.** Story documents went from 43.55M to 7.82M characters (−82%), and the average per story from 235k to 42k. The records take 21.9M characters against 35.9M when embedded, 39% less through deduplication.
7. **Complete: the upgrade path.** `db/library-format.json` has `latestMigration` set to 0024 and `schemaVersion` still 1. Both upgrade tests list 0024 and call `verifyLibraryBackup`. The migration runs inside the `BEGIN IMMEDIATE` transaction.
8. **Complete: other API responses, session types and the public export format are unchanged.**
   - Only the internal `Document` usage type gains an optional `promptRecordId`; `view()` and the session types are unchanged.
   - The public archive format is untouched, and the 428/428 `test:pr` run covers the API.

**Pre-existing failure, not counted against this story:** `storyboard-review` "codex: review is a separate queued job and gates all drawing" also fails on fbf3a17 and on 069dd93.

VR passed: all acceptance criteria complete

STAGE risk: low. A data-moving migration, but it checks itself inside one transaction, runs after a verified backup, and was proven on the real-library snapshot (0 differences, integrity_check ok). As documented, older apps show migrated prompts as missing.

STAGE review round: VR round 1 (passed); CR round 1 passed, with non-blocking fixes applied in 4005a62.
```

## Notes

- 旧版应用仍能打开和写入升级后的书库（未提升 `schemaVersion`）。对已移出的记录，提示词页面显示为缺失。
- 迁移改写含记录的文档会提升修订号，首个节拍会一次性重新检查这些故事。数据库文件不会自动缩小（未 VACUUM）。
- 跨书库补复制图片时，若来源文档文本不是 `JSON.stringify` 的规范形式，会返回 409，重新复制即可。
- 已有问题：`tests/storyboard-review.test.mjs` 的 `codex: review is a separate queued job and gates all drawing` 在本会话改动之前就失败。不设超时时会一直等待，导致按需批次长时间挂起。
- 用户书库将在下次启动应用、完成整库备份后应用 0023 与 0024。
