# 计划：提示词记录移出故事文档

需求：`.docs/reqs/2026/11/19/req-prompt-records-storage.md`
Git 基线：`fbf3a17`

## 方案

```mermaid
flowchart LR
  G[模型调用结果<br/>Generated.promptRecord] --> W{写入点}
  W -->|repository.save / saveImageProgress| X[存记录：id = sha256 内容<br/>INSERT ON CONFLICT DO NOTHING]
  W -->|发布图片 SQL| X
  X --> D[document.usage 项只存 promptRecordId]
  D --> R{读取点}
  R -->|/prompts、审校历史| L[按 id 批量读取并还原]
  M[迁移 0024 + 代码钩子] -->|已有内嵌记录| X
```

- 新表 `prompt_records(id text PRIMARY KEY, record text NOT NULL)`。`id` 为记录 JSON 的 SHA-256；相同内容只存一份。
- 调用记录项新增 `promptRecordId`；`promptRecord` 仍可出现（内存中的新结果、旧版应用写入的文档），读取时优先用内嵌，否则按 id 读取。
- 同库修订照常复制调用记录项，引用随之复制。跨书库复制先在来源库把引用还原为内嵌记录，再由目标库的 `create` 写入点存表。

## 现状（已核对）

- 写入内嵌记录的位置有三处：`ReaderRepository.save`、`ReaderRepository.saveImageProgress`（引擎的检查点，`lib/reader-engine.ts` 三处 `doc.usage.push`）以及 `server/reader-production.ts` 发布图片时的 `json_insert` SQL。意向、重选和同库修订只复制或清空 `usage`。
- 跨书库复制（`server/reader-copy.ts`）把来源故事的 `usage` 原样写入另一个书库（`destination.create`），引用在目标库中不存在（AR 第 1 轮阻塞项）。其 `copiedFrom.contentHash` 按来源 `row.document` 原文计算。
- 读取记录的位置只有 `lib/reader-api.ts` 的 `/prompts`（导出 `server/story-export.ts` 和浏览器导出都经此接口）和 `lib/reader-review-history.ts`（经 `/review-history`）。
- 迁移框架支持按迁移名执行的代码钩子（`server/database-migrations.ts`），在同一事务内执行。

## 决策

- 内容寻址（SHA-256）而非“故事:序号”：新写入与迁移共用一种 id，修订家族的重复记录自然去重（实测约 40%）。
- 迁移用代码钩子：SQL 无法计算 SHA-256。钩子逐行读取故事，解析、替换、写回，并在事务内核对每个引用可读且内容与原文一致；任何不一致即抛错回滚。
- 写入点（`save`、`saveImageProgress`、`create`、发布图片 SQL）在序列化前把新记录存表并替换为引用（返回副本，不改调用方对象）；记录先于文档写入，文档写入失败只留下无引用的记录，无害。
- 引用与内嵌互换保持键的位置：迁移把 `promptRecord` 原位替换为 `promptRecordId`，还原时原位换回，得到与迁移前相同的 JSON 结构。跨书库复制的 `contentHash` 保持原输入形状 `JSON.stringify([sourceSelection, 文档文本])`，第二项改为还原后文档的 `JSON.stringify` 文本（字符串，而非对象）：迁移前由 `JSON.stringify` 写出的来源文档得到相同哈希，升级前创建的副本仍可补复制图片；来源文本若非 `JSON.stringify` 规范形式（例如经 SQLite 改写的数字格式），补复制会报 409，重新复制即可（记录在完成说明中）。
- 引用的记录行缺失时按缺失项输出（`missingRecords`），审校历史按无输入处理。
- 读取点用一个辅助函数批量取记录（`json_each` 传 id 列表），审校历史函数接收已取得的记录映射，保持纯函数。
- 不提升 `schemaVersion`：旧版应用仍能打开和写入，只是提示词页面对已移出的记录显示缺失（需求中记录）。

## 任务

- [x] `lib/reader-prompt-records.ts`：记录 id 计算；从文档提取新记录并返回替换后的副本；按 id 批量读取、还原调用记录的辅助函数（依赖 `Database` 接口）。`Document.usage` 类型增加 `promptRecordId`。
- [x] `lib/reader-repository.ts`：`save`、`saveImageProgress`、`create` 序列化前存记录并替换引用。
- [x] `server/reader-copy.ts`：复制前从来源库还原记录为内嵌；`contentHash` 对还原后的文档计算。
- [x] `server/reader-production.ts`：发布图片时存记录，调用记录项写引用。
- [x] `lib/reader-api.ts` `/prompts` 与 `/review-history`、`lib/reader-review-history.ts`：按引用读取记录，输出与之前一致。
- [x] `drizzle/0024_prompt_records.sql` 建表；`server/prompt-record-migration.ts` 钩子逐行迁移（迭代读取，不改 `updated_at`）并核对；在 `server/database-migrations.ts` 注册；登记 `drizzle/meta/_journal.json`、`db/library-format.json`、`db/schema.ts`；`scripts/test-plan.mjs` 映射新源文件；`CHANGELOG.md` 说明旧版应用显示缺失。
- [x] 测试（新文件 `tests/prompt-records-storage.test.mjs`，登记 manifest）：
  - 引擎保存后文档无内嵌全文、引用可读；相同记录只存一份；修订沿用引用。
  - 迁移：含内嵌记录、重复记录、修订复制、无记录项、非法 JSON 文档的旧书库，迁移后 `/prompts` 与审校历史输出与迁移前逐项相同；记录数等于去重后数量；人为制造核对失败时整次迁移回滚。
  - 内嵌记录与引用混合的文档照常输出；引用的记录行缺失时按缺失项输出。
  - 跨书库复制：目标库能读到全部提示词与审校历史；迁移前创建的文字副本在来源迁移后仍可 `copy-images --existing` 补复制图片。
  - 迁移不改变 `reader_commands`、`reader_faults` 行数和 `updated_at`。
  - 更新 `tests/review-history.test.mjs` 等依赖内嵌记录的测试夹具（如需）。
  - 更新迁移列表断言（`blocked-revision-recovery`、`story-storage-consolidation`）及其他依赖内嵌记录的测试。

## 验证

- `node --test tests/prompt-records-storage.test.mjs`、受影响的直接消费者。
- `pnpm test:pr --files <本次文件>`；按需测试：审校历史、提示词、导出、制作流程相关（受控提供方）。
- `pnpm typecheck`、`pnpm lint`；计划报告 `native: true` 时运行 `pnpm desktop:test`。
- 书库快照副本上运行迁移：耗时、文档与记录大小、迁移前后 `/prompts` 输出逐篇比对。

## 风险

- 迁移搬运真实数据：依赖事务内核对与升级前备份；只在副本上验证，不触碰用户书库。用户开发服务器目前已停止；迁移文件最后写入。
- 迁移耗时：需在快照上实测（约 185 篇、3600 万字符的解析与写回）。
- 迁移改写全部含记录的文档会提升修订号，首个节拍重新检查这些故事（一次性）。

## 进度

- AR 第 1 轮阻塞：跨书库复制丢失记录。已改为复制前还原、`create` 存表，`contentHash` 对还原后的规范 JSON 计算；补充迭代迁移、触发器行数、缺失记录、复制测试与 CHANGELOG 说明。AR 第 2 轮通过（明确哈希输入形状）。
- 实现：新增 `lib/reader-prompt-store.ts`（存取与原位互换）、`server/prompt-record-migration.ts`（迁移钩子与核对）、`drizzle/0024_prompt_records.sql`；`usageRecord` 放在无 Node 依赖的 `lib/reader-prompt-records.ts`，供客户端引用的审校历史模块使用。
- 快照实测（应用 0023 后的副本运行 0024 钩子）：迁移 1.05 s；故事文档 4355 万 → 782 万字符（单篇平均 23.5 万 → 4.2 万）；记录 1623 行、2190 万字符（较内嵌 3590 万去重 39%）；185 篇逐篇比对提示词 0 差异；`reader_commands`、`reader_faults` 行数不变；`integrity_check` 通过；活动文件仍 117 MB（不 VACUUM），`VACUUM INTO` 备份 86 MB。重启首个节拍 105 ms / 1220 万字符 → 34 ms / 250 万字符。
- 新测试 4/4；跨书库复制相关 3 项通过；typecheck、lint 通过。里程碑提交见 git 日志（TT 尚未运行）。
- CR：迁移在非对象调用记录项上调用 `json_type` 会报错并阻止升级，改用 `CASE` 先判断类型；写入点容忍 `null` 项；补齐文件头。复核通过。
- TT：`pnpm test:pr` 428/428；按需套件（审校历史、提示词导出、跨书库复制、制作流程、发布、意向、书架、状态机等）381 项通过、0 项因本次改动失败；原生 26/26；typecheck、lint 通过。`tests/storyboard-review.test.mjs` 的 `codex: review is a separate queued job and gates all drawing` 在本故事基线 `fbf3a17` 和本会话首个改动之前的 `069dd93` 上同样失败（无超时时会一直等待），为已有问题，不在本故事范围。
