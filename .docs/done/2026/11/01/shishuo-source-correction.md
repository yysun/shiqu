# 校订并更新故事原文

## Summary

原文有保存记录却没有本地出处，导致曹娥碑新版分镜前失败；Gutenberg底本两处漏“齏”又妨碍直接替换。保留上游字节，以明确校记补两字并生成独立版号；更新两条曹娥碑和一条尤三姐原文/出处，清除唯一旧原文校验失败队列项。已有分镜、图片和制作设置保留。

## Verification

742/742测试、typecheck、lint通过；SQLite、媒体副本和真实REST一致。修复任务暂停，未执行付费推理或绘图。

VR passed: all acceptance criteria complete

1. **Complete — evidenced correction and provenance.** The pinned Gutenberg file remains unchanged. `local-book-corrections.ts` inserts exactly two “齏” characters in `shishuo-11-003`; unit provenance identifies Wikisource revision 1500322. Regression coverage verifies the other 1,128 units remain unchanged.

2. **Complete — distinct edition and historical preservation.** The corrected edition is stable and distinct from the original hash. Tests cover historical matching receipts and rejection of mismatched receipts. Backup-to-current SQLite comparison confirms 48 records remain present and all 45 records outside the explicit repair scope are unchanged.

3. **Complete — three authorized originals updated.** Both 曹娥碑 records contain the corrected local text. 尤三姐 uses explicitly attributed 程乙本 text and complete chapter context. For all three records, `selection.source` matches `original.localSource`, media copies equal database originals, and all other document content and selection settings are preserved. The two completed records retain their completed states.

4. **Complete — safe continuation without paid calls.** The failed 12-frame revision is now `idle` / `paused` with no error. Exactly one obsolete source-validation failure job was retired and backed up. REST evidence confirms the repaired states and matching receipts. The maintenance report records successful generation-gate checks using a local stub and zero paid calls.

All plan tasks are complete. Final tests passed **742/742**; typecheck and lint passed. The post-update audit covers all 36 visible records and reports no source defects. Browser verification was unavailable because browser access is disabled; SQLite and actual REST evidence verify the saved outcome.

VR risk: non-low — three durable originals, source receipts, and generation eligibility.
VR review round: 1; reviewer: reused.

## Notes

本地实施提交`f5865e7`；完整SQLite及逐条原文备份在`.data/backups/story-original-update/2026-11-01T08-23-31-100Z/`。其余33篇可见故事及12条已删除记录未改。自选书《中山狼传》的固定外部出处为正常记录；不强制迁移。当前任务刷新后可点“恢复生成”。
