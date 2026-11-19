# 制作调度节拍的故事查询改由索引回答

## Summary

- 新增迁移 `0023_story_scan_indexes.sql`，只加索引、不改查询：
  - `stories_family`：用户、修订根表达式、版本号表达式、`id`、`state`、`generation_control`、`generation_mode`。所有“是否有更新版本”的判断由它直接回答，节拍的后台需求与待清理旧版本查询扫描该覆盖索引。
  - `stories_lock_scan`：过期运行锁回收。
  - `stories_landscape_scan`：横图重绘检查只读取确有待重绘修订的故事。
- `tests/production-tick-scope.test.mjs` 新增守护：捕获一个节拍实际执行的故事 SQL，逐条检查查询计划不对 `stories` 全表扫描（含非覆盖的全索引扫描），并断言版本判断使用 `stories_family`。

## Verification

- 书库快照（应用本迁移文件）：节拍 145.8 ms → 2.0 ms（重复测量约 132–136 ms → 1.9–2.8 ms）；建索引 0.28 s。
- 写入：`json_set` 不变；仅改状态的写入平均故事约 +0.35 ms、最大故事 +2.5–3.6 ms（用户确认接受并修订验收标准）。
- 守护测试在加索引前失败（过期锁查询 `SCAN stories`），之后 4/4 通过。
- `pnpm test:pr --files <本次文件>` 45/45；按需测试 12 个文件 217/217（受控提供方）；`pnpm desktop:test` 26/26；`pnpm typecheck`、`pnpm lint` 通过。
- AR 通过；CR 通过；VR 第 1 轮因仅改状态写入变慢未通过，比较其他布局（拆分、混合、部分索引，节拍 30–76 ms）后由用户选择保留当前布局，第 2 轮通过。

### VR 结果

**VR round 2: all seven acceptance criteria are complete against the amended requirement.**

Since round 1, only the requirement and plan docs changed, plus the tightened scan guard I already verified (4/4).

**Criterion 4 (amended), complete:**
- **Content (`json_set`) writes are comparable.** The largest story is 8.75/8.75 ms against a base of 9.09/8.96. The average story is 0.65/0.78 ms against 0.64/0.65; run 1 is identical, and run 2 is +0.13 ms, within the run-to-run noise.
- **State-only writes on an average-size story rose by +0.37/+0.34 ms**, which matches "约 0.35 ms".
- **State-only writes on the largest story rose by +2.52/+3.57 ms**, a mean of +3.05 ms. That is within "约 3 ms 以内" only because the bound says "about". Run 2 is above 3 ms, and the base itself varied by 0.45 ms between runs.
- **The user's decision is recorded.** The requirement line is dated and attributed. The plan's progress section records the cause and the layouts compared: the layouts that avoid the state-write cost leave the tick at 30–76 ms, against the 5 ms target.

**Criteria 1–3 and 5–7 still hold.** No code, migration, schema or manifest changed after round 1. The repeated tick measurements of 2.8/1.9 ms are still under the 5 ms target.

**Non-blocking:** to keep the requirement exact, consider stating the largest-story state-only increase as the measured range (about 2.5–3.6 ms) rather than "约 3 ms 以内".

VR passed: all acceptance criteria complete

## Notes

- 采纳 VR 的非阻塞建议：验收标准中的最大故事增量已改为实测范围 2.5–3.6 ms。
- 索引表达式须与 `familyRoot`、`familyNumber` 及横图重绘条件逐字一致；修改这些 SQL 时同步新迁移。横图表达式漂移不会使测试失败（仍走 `state`、`generation_control` 前缀），只会变慢。
- 实施时用户的 `pnpm dev` 已停止，本迁移尚未应用到本机书库；下次启动应用时会在已验证的整库备份后应用（建索引约 0.3 s）。
- 后续改进（未做）：将提示词记录（约占文档 83%）移出 `document`，可减少写入与按需读取的开销。
