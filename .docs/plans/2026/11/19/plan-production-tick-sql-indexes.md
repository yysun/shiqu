# 计划：为制作节拍的故事查询补充索引

需求：`.docs/reqs/2026/11/19/req-production-tick-sql-indexes.md`
Git 基线：`b3a8010`

## 方案

只新增迁移 `drizzle/0023_story_scan_indexes.sql`，不改查询语句。SQLite 会把查询中与索引定义一致的表达式（含别名列）匹配到表达式索引，并直接使用索引中存好的值。

| 索引 | 列 | 服务的查询 |
|---|---|---|
| `stories_family` | `user_id`、修订根表达式、版本号表达式、`id`、`state`、`generation_control`、`generation_mode` | `supersededSql` 内层的同家族更新版本查找；以及外层只需这些列的节拍查询（后台需求、待清理的旧版本）可扫描该覆盖索引，不读故事行，也不重新解析外层故事的 JSON |
| `stories_lock_scan` | `state`、`lock_until`、`generation_mode` | 过期运行锁回收 |
| `stories_landscape_scan` | `state`、`generation_control`、横图重绘表达式 | 横图重绘检查只对匹配的行读取故事 |

表达式与 `lib/reader-repository.ts` 的 `familyRoot`、`familyNumber` 及 `scheduleLandscapeRedraws` 中的条件逐字一致（列名不带别名）。

## 预研结果（书库副本，未改代码）

| 方案 | 节拍平均耗时 |
|---|---|
| 现状 | 164.3 ms |
| 仅 `(user_id, 根, 版本号)` 表达式索引 | 95.6 ms（待清理查询反而变慢：规划器先算版本条件并解析外层 JSON） |
| 加宽为覆盖索引 | 50.5 ms |
| 三个索引 | 1.9 ms |

局部 `json_set` 写入：平均大小故事 0.66 ms → 0.66 ms，最大故事（279 万字符）11.65 ms → 10.75 ms；按用户列出故事不变。

## 决策

- 用表达式索引而非新增生成列或改写查询：零查询改动，所有使用 `supersededSql`、`familyRoot`、`familyNumber` 的路径（包括 API 与版本分叉）自动受益。
- 表达式与代码字符串的一致性由测试守护：测试捕获节拍实际执行的 SQL 并检查查询计划，表达式漂移会出现全表扫描或不用 `stories_family` 而失败。
- 不提升 `schemaVersion`：只新增索引；JSON 函数为确定性函数，Node 24 与原生端内置的 SQLite 均支持。

## 任务

- [x] 新增 `drizzle/0023_story_scan_indexes.sql`（三个索引，中文说明）；登记 `drizzle/meta/_journal.json`；更新 `db/library-format.json` 的 `latestMigration`；`db/schema.ts` 对表达式索引用注释说明由迁移维护（drizzle 定义只放普通列索引 `stories_lock_scan`，如表达式不便表达则全部只在迁移中定义并注明）。
- [x] `tests/production-tick-scope.test.mjs` 增加：
  - 捕获一个节拍（含需求、后台、排队任务、运行锁、已完成故事）实际执行的全部 SQL，逐条 `EXPLAIN QUERY PLAN`，断言没有对 `stories` 的全表扫描。
  - `supersededSql` 的查询计划使用 `stories_family` 查找更新版本。
- [x] 更新迁移列表断言：`tests/blocked-revision-recovery.test.mjs`、`tests/story-storage-consolidation.test.mjs`；登记的 `covers` 增加新迁移。

## 验证

- `node --test tests/production-tick-scope.test.mjs`
- `pnpm test:pr --files <本次文件>`；按需制作流程测试（受控提供方）：`background-generation`、`blocked-revision-recovery`、`production-queue-hardening`、`queue-image-recovery`、`queue-image-versions`、`queue-interruption`、`reader-production`、`reader-revisions`、`story-revision-flow`，以及使用版本分叉的 `story-generation-state-machine-reselection`。
- `pnpm typecheck`、`pnpm lint`；计划报告 `native: true` 时运行 `pnpm desktop:test`。
- 书库副本上重测节拍耗时与写入耗时。

## 风险

- 运行中的 `pnpm dev` 监视进程会在迁移文件写入后重新加载并对本机书库应用迁移（上一项已发生）。本迁移只加索引；建索引需逐篇解析一次 JSON，在当前书库上为一次性开销。实施前提醒用户，或接受由其开发服务器在备份后应用。
- 规划器在新索引下可能改变其他查询的计划：用制作、版本和书架相关测试覆盖结果正确性，并在副本上对比按用户列出故事的耗时。

## 进度

- AR 第 1 轮通过（无阻塞）。采纳：测量仅改状态的写入开销；先写测试并确认无索引时失败，最后才写 `drizzle/` 文件（实施时用户开发服务器已停止，未自动应用）；全表扫描匹配所有别名；`stories_lock_scan` 在 `db/schema.ts` 声明，表达式索引注明只在迁移中定义。
- 确认本机书库的 0022 为最终版本（有插入触发器，无删除触发器）。
- 实测（书库快照，应用本迁移文件）：节拍 145.8 ms → 2.0 ms；建索引 0.28 s；仅改状态的写入：平均故事 0.89 → 1.19 ms，最大故事 9.48 → 11.11 ms；`json_set` 写入不变（0.72 → 0.67 ms，10.89 → 9.46 ms）。
- 新增守护测试在加索引前失败（过期锁查询 `SCAN stories`），加索引后 4/4 通过；typecheck、lint 通过。
- 里程碑提交：见 git 日志（TT 尚未运行）。
