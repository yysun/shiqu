# 交接：制作 DAG 的合并关口（阶段 4，使用合成旧格式书库）

写给接手的代理。读完本文件，再读 [范围收窄计划](plan-dag-scope-cut-and-ui-stability.md) 与 [上一份交接](handoff-production-dag-cutover.md)（后者记录已完成的 M4.5、评审补修、阶段 3 与已接受的行为变化）。

## 1. 现状

- 分支 `production-dag-cutover`，工作树 `.claude/worktrees/dag-cutover`，当前提交 `479f6ab`（相对 `main` 25 个提交）。**未合并、未推送。**
- 阶段 0（审计、统一修订计算、手改保护、故障延续、`--cover`）、阶段 2（界面 U1–U6）、阶段 3（正确性缺口）已完成；阶段 1（成本探测）**已决定跳过**。
- 已通过：`typecheck`、`lint`、`test:pr`（按分支相对 `main` 的改动文件，102 项）、`test:safety`、`test:startup`（后两项在阶段 3 之前跑过，之后的改动较小，合并前须重跑）。
- **没有任何界面改动被实际看过**（浏览器里），也没有对真实书库运行过本分支。

## 2. 你要做的：三个相互独立的合并关口，缺一不可

1. **升级**：旧格式书库升级到格式 2（迁移 `0025`），内容不丢、不变。
2. **回滚**：升级前的整库备份能由配套的 v0.14.0 恢复并正常打开。
3. **核心流程对等**：对照 v0.14.0 的功能逐项通过。

另有：`test:models`（手动，模型相关）与 `src-tauri` 原生测试（见 §6），以及合并前的全量影响检查。

## 3. 硬规则

- **不要在用户的真实书库上运行本分支，也不要读取真实书库。** 所有验证只用合成书库或测试夹具生成的隔离数据；不向真实提供方发请求，不产生付费调用。
- 遵守仓库 `AGENTS.md`：中文代码注释、`corepack pnpm`、新增测试登记 `tests/manifest.json`（含 `covers` 与夹具声明，见 §7）、不打包桌面应用、改命令行须同步 `skills/shiqu/SKILL.md`。
- 在工作树里用 Node 24.22.1：`export PATH="$HOME/.nvm/versions/node/v24.22.1/bin:$PATH"`，再用 `corepack pnpm …`（不要 `source ~/.nvm/nvm.sh`）。
- 只跑受影响的测试，不要整个 `tests/` 扫一遍；不要用 `pkill -f "node --test"`；长输出写文件，别经管道吞掉退出码。
- 不要提交、推送或合并，除非用户明确要求；提交信息末尾带仓库要求的署名行。
- 发现生产代码缺陷：写清文件、原因、最小复现再决定是否修；修了必须带测试。

## 4. 关口 1：升级（合成旧格式书库）

目标：证明下列每种故事升级后行为正确，并且**升级前后已保存的文字与图片字节完全一致**。

### 4.1 怎么造合成书库

- `tests/fixtures/historical-library.mjs` 的 `historicalLibrary(directory, root, through)` 用生产迁移建到指定迁移（`through`，例如 `'0024_prompt_records.sql'`），并写入种子。再用 `migrate(sqlite, root, directory)`（`server/database-migrations.ts`）升级到当前。`tests/production-dag-migration.test.mjs` 是现成范例：直接向 `stories` 插入文档、`production_jobs`、`reader_faults`、`reader_commands`，并把真实 PNG 写到 `media/reader/<storyId>/<页>.png`（用 `tests/fixtures/images.mjs` 的 `png`）。
- 文档形状参考 `tests/fixtures/production-data.mjs`（`makePlan`、`selection`）与 `tests/fixtures/story.mjs`。故事的 `document` 是旧版 v1 文档（`plan`、`images`、`visualReview`、`intake`、`revision` 等），**不含 `dag`**。
- 要走完整升级流程（备份、日志、回滚）而不只是迁移函数：用 `server/library-upgrade.ts` 的入口，参考 `tests/story-storage-consolidation.test.mjs`、`tests/desktop-runtime.test.mjs`、`tests/startup-*.test.mjs` 里造旧书库并启动的方式。

### 4.2 必须覆盖的故事类型（每种一个合成故事）

| 类型 | 升级后应成立 |
| --- | --- |
| 仍在准备阶段（`intake.phase` 为 `discovering`/`choosing`/`preparing`/`confirming`） | **没有 dag**，保留 `prepare`/`discover` 任务，确认时由 `adopt()` 建立 dag（已有测试，见 `production-dag-migration.test.mjs`） |
| **等待幅数确认**（`awaitingFrameCount`：无 intake、数字幅数、有 `frameRecommendation` 但 `frameCountConfirmed` 为空） | **升级后仍等待读者确认**，不被自动采用开始制作。**这是已知风险**：`DagProduction.adopt()` 对无 intake 的故事直接建立 dag，绕过旧的幅数确认门槛。必须先写失败的测试，再决定修法（例如 `adopt()` 在 `awaitingFrameCount` 为真时不采用，并保留旧确认路由 `/frame-count` 可达）。这也是删除 `awaitingFrameCount` 旧路径的前提 |
| 修订等待（旧版 `revision.handoff`） | 转换为 `dag.continuation`，且为暂停；「继续制作」可启动 |
| 部分绘制（有若干幅图） | 已有图片按可读性采用，其余由引擎补画；不重复绘制已有图 |
| 只存了部分分镜（提纲 24 节点、已存 20 幅） | 24 个幅位全部保留（已修，有测试），待生成的幅位不丢 |
| 已完成且手改过 | **保存的文字与图片字节逐字节不变**；注意升级前的手改**无法识别**（转换器不记录谁写的），按普通产物处理——这是已记录的限制，演练里要明确断言「不变」而不是「受保护」 |
| 带未结故障（图片丢失、任务失败、恢复中） | 故障按节点归属；恢复中回到待处理；旧任务作废；恢复回执标为失败 |
| 已付费但未发布的图片结果（旧 `image` 任务 `succeeded`、文档里没有该图） | 版本一致且文件是真实图片才采用；否则不采用（已修，有测试） |
| 横图 | 仅当旧横图任务的输入版本与当前内容一致且文件符合横图比例才采用（已修，有测试） |
| 不可读文档 | 原样保留，升级不中断，记录诊断 |

### 4.3 每个故事都要核对

1. 升级前后 `stories.document` 中的**文字内容**（`plan`、`original`、人物、结语等）与**图片文件字节**（逐文件 sha256）一致。
2. `PRAGMA user_version` 为 2；触发器只剩 7 个（见 `production-dag-migration.test.mjs`）。
3. 升级中断后重做结果相同（转换是确定性的，不调用模型）。
4. 升级期间没有任何模型调用、没有网络请求。
5. 升级后用 `productionFixture`（`tests/fixtures/production.mjs`）的受控提供方继续制作，能走到完成，**且不重复付费**（按 `f.control.calls` 与调用名计数）。

### 4.4 要跑的检查

`test:safety`、`test:startup`（含升级、格式拒绝、版本 1 日志、转换可重做）、`production-dag-migration`、`story-storage-consolidation`、`desktop-runtime`。新增的升级演练测试按 §7 登记。

## 5. 关口 2：回滚

- 升级前备份由 `server/library-backup.ts`（`createLibraryBackup`/`verifyLibraryBackup`/`restoreLibraryBackup`）生成并校验；升级入口 `server/library-upgrade.ts` 在访问前完成。
- **回滚的定义**：用备份恢复出的目录，必须能被配套的 **v0.14.0** 打开并读取故事（`PRAGMA user_version` 为旧值、没有 `dag` 字段）。AGENTS.md 已写明：格式 2 需要 0.15.0 及以上；旧应用不得打开升级后的书库，也不得把备份直接恢复到使用中的目录。
- 怎么验证（不碰真实数据）：
  1. 用本分支升级一份合成书库，保存其「升级前备份」目录；
  2. 取 v0.14.0 的代码（见 §8 的 v0.14.0 工作树），用同一个合成书库（备份恢复出的副本）启动它的 `createApplication`/`ensureLibraryReady`，读取全部故事，断言文字与图片字节一致；
  3. 反向：用 v0.14.0 打开**已升级**的书库，必须被拒绝并给出 `BACKUP_APP_TOO_OLD` 类提示（见 `db/library-format.json` 的 `minimumAppVersion` 与 `tests/startup-*`）。
- 回滚演练要写成可重复的测试（可用 `git worktree` 的 v0.14.0 路径作为输入，放在 `tests/` 下并登记；若依赖本机路径，标为手动并在手册里写明）。

## 6. 关口 3：核心流程对等

对照 v0.14.0 逐项通过（每项一条受控场景或现有测试的引用）：

| 流程 | 参照 |
| --- | --- |
| 创建、选题、确认、制作到完成 | `production-dag-scenarios`、`reader-intake`、`story-generation-state-machine-*` |
| 暂停 / 恢复 / 停止 | `story-flow-control`、`background-generation` |
| 修订：改配文、改设置、删幅、换画风、重绘、**指定首幅原图（`--cover`）** | `production-dag-scenarios`、`reader-revisions`、`paused-editing-versions` |
| 复制（文字 / 图片 / 草稿）| `production-dag-scenarios`（复制）、`headless-cli` |
| 导出、预览 | `story-export` 相关、`headless-cli` |
| 命令行：`run --until`、`stories edit/continue/resume/retry/override`、`copy` | `headless-cli`、`cli-skill`；技能文本在 `skills/shiqu/SKILL.md` |
| 恢复：图片丢失、任务失败、放行 | `story-generation-state-machine-flow`、`queue-image-recovery` |

对每一项写明：对等 / 已接受的差异（见上一份交接的「行为变化」，**全部已被用户接受**）/ 缺失。缺失的才需要处理。

另外：`corepack pnpm test:models`（手动，会调用受控或真实模型，先读 `scripts/test-providers.mjs` 与 `AGENTS.md`，**不要用真实凭据**），以及 §7 的影响检查。

### 原生测试（`src-tauri`）

`src-tauri/src/library.rs` 的日志版本范围已改（`{"version":1}` 的不完整日志仍须被拒）。`cargo test --lib library` 在本机无法构建，因为缺少 `desktop/resources/node`，它只由桌面准备生成，而 AGENTS.md 规定不把桌面准备当常规验证。需要用户决定是否授权做桌面准备；未授权前，在报告里写明「未运行」，不要伪造结果。

## 7. 登记与检查清单（每个新增测试）

- 新测试文件登记到 `tests/manifest.json`：`groups`、`level`、`cost`、`platforms`、`suite`、`pr`、`gates`、`covers`；`covers` 要列出它导入的源码**以及它经 `tests/` 导入链到达的所有 `tests/fixtures/*`**。
- 用 `node -e "import('./scripts/test-metadata.mjs').then(m=>{m.loadMetadata();console.log('ok')})"` 校验清单；`tests/test-tiers.test.mjs` 会提示缺失的夹具声明（反复运行直到通过）。
- 完成后：`corepack pnpm typecheck`、`corepack pnpm lint`、`corepack pnpm test:pr --files <相对 main 的改动文件…>`、`test:safety`、`test:startup`；再重跑 `release-pre-push`、`test-assurance`、`test-tiers`、`ci-scope` 四个元测试。

## 8. 取 v0.14.0 的方法

`v0.14.0` 是本仓库的标签（提交 `aef8282`）。在会话临时目录里建独立工作树，并复用本分支的 `node_modules`：

```bash
git worktree add --detach <临时目录>/v014 v0.14.0
ln -s "$(pwd)/node_modules" <临时目录>/v014/node_modules
```

用完用 `git worktree remove --force <临时目录>/v014` 删除（本会话留下的一个在会话草稿目录里，随会话清理，但请确认 `git worktree list` 里没有残留）。

## 9. 关口之后

全部三个关口通过、用户确认后才合并回 `main`；合并前报告里要列：每个关口的证据（命令与结果）、未运行项及原因、已接受的行为变化清单、仍存在的已知缺口（见上一份交接）。合并后删除暂存分支 `wip/production-dag-0025` 与本工作树。**不要在用户未明确同意时合并或推送。**

## 10. 其他仍待办（不阻塞关口，供排期）

- 阶段 5（可选）：验收条目拆分简化为一个全篇验收结论；删除确认无用的兼容代码（`awaitingFrameCount` 旧路径依赖 §4.2 的演练；`revision.handoff` 分支）。
- 在种子化的隔离服务上实际走一遍 U1–U6 的界面（目前没有任何界面改动被看过）。
- 仓库规则新增：任务清单里的主要操作用文字链接（`AGENTS.md`）。
- 真实令牌 / 费用复测（已决定跳过，若以后需要需用户授权付费调用）。
