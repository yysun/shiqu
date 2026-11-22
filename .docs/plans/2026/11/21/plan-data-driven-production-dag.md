# 计划：数据驱动的制作 DAG

需求：[req-data-driven-production-dag](../../../../reqs/2026/11/21/req-data-driven-production-dag.md) · 规范：[故事制作与编辑 DAG](../../../../story-production-dag.md) · 端到端验证与场景映射：[test-data-driven-production-dag](../../../../tests/test-data-driven-production-dag.md)

Git 基线：`52ddf58b810ff80c19f40f618ef52134ca658094`（SS 开始时的 HEAD）。工作区中已有的无关改动（其他计划与完成文档、用户指南）不属于本故事。

## 结果

- 规范的节点目录与调用契约成为 `lib/production-dag/` 中的声明式配置，一个纯函数引擎据此计算有效性、就绪、重做预估与任务身份。
- 选定来源之后的全部制作（原文核对、梗概、建议、分镜、审片、绘图、横图）经过该引擎调度；修订、故障、模型快照与升级都按规范执行；旧的逐条规则删除。
- 桌面界面、CLI 与技能文档采用「保存修改 → 已保存，等待继续 → 继续制作」。

## 边界

- 包含：引擎与配置、文档 v2 与存储投影、SQL 触发器重写与格式版本升级、按调用契约拆分的生成调用、模型快照与提供方工厂、调度切换、修订与故障规则、升级转换、界面与 CLI、相关文档。
- 不包含：候选查找（选定来源之前，保留现有 intake 代码）、图片内容审核、导出格式、新服务商、外部工作流框架、规范之外的界面改版。

## 关键决策

1. **引擎是纯函数模块，调度范围从原文核对开始。** `lib/production-dag/` 不做 I/O：输入为版本状态（产物记录、故障、授权、模型快照），输出为节点实例状态、可运行集合、预估、任务身份和完成判定。原文核对、梗概、建议及之后的全部节点由引擎调度；候选查找在 DAG 之外，沿用 `server/reader-production.ts` 现有 intake 分支。
2. **`document.dag` 是权威来源，`plan`、`images`、`visualReview` 保留为存储投影。** 每次保存在同一条 `UPDATE` 中写入 `document.dag` 与投影，投影由 `projectDocument()` 从 `dag` 生成。只读消费者（阅读、导出、复制、重选、书籍参考、历史界面、`lib/reader-api.ts` 等约 20 个文件）继续读投影；所有写入方改走 `dag` 接口。导出结构因此不变。
3. **画幅以身份为键存放。** `dag.frames` 是以画幅身份为键的对象，另存 `dag.order` 数组。图片提交用路径限定的 `json_set`，在同一条语句中写 `dag.frames.<id>.image` 和投影 `$.images[<id 在 dag.order 中的位置>]`，并以绘图硬输入指纹为保存条件；文字节点仍在会话锁下串行执行，整份文档以现有比较并交换方式保存。
4. **故障按节点记录，相关触发器重写。** 迁移 `0025` 为 `reader_faults` 增加 `node`、`node_key`、`input_hash`、`origin_fault_id`、`optional` 列和 `awaiting-match` 状态，为 `production_jobs` 增加 `error_code` 列，队列在任务失败时写入结构化错误码（如 `CONTENT_BLOCKED`、`SERVICE_AUTH`、`TIMEOUT`）；活跃图片故障的唯一索引改为 `(session_id, owner_id, node, node_key)`。同一迁移删除并按新语义重建：`reader_override_command`（只更新被放行的结论，不再批量删除文字任务）、`reader_image_lost` 与 `reader_image_restored`（不再整篇置失败或判定完成，完成改由协调器调用 `complete()`）、`reader_job_failed`（故障类型取自 `error_code`，节点信息取自任务载荷）、`reader_control_command`（新增 `continue` 动作）、`reader_intake_fault_generation`、`stories_blocked_revision_fault`（延续逻辑移到提交代码）。其余 `0012`–`0022` 触发器逐个核对，冲突的一并重建。「内容被拦截」不自动重试的判断以 `error_code` 为准。
5. **格式版本升到 2。** `db/library-format.json` 的 `schemaVersion` 改为 2，迁移设置 `PRAGMA user_version=2`（先例见 `drizzle/0018`），`minimumAppVersion` 设为本次发布版本。旧应用按 `server/library-schema.ts` 与 `src-tauri/src/library.rs` 现有规则拒绝打开。两处的升级日志版本检查改为接受 1 至 `schemaVersion`，避免 0.8.x 中断升级留下的版本 1 日志被误拒。回滚方式：升级前的整库备份加对应旧版应用。
6. **升级转换作为 `0025` 的迁移钩子执行。** 在 `server/database-migrations.ts` 中像 `0024` 迁移提示词记录一样，为 `0025` 挂代码钩子，使转换与迁移回执同属一次升级：受经核对的整库备份保护，崩溃后随迁移重做，所有入口（协调器、CLI、导出）只会看到已转换的书库。应用重启后没有正在运行的调用，「在途任务」是已付费待发布的图片结果、排队或中断的旧任务、未结的故障和回执。钩子内顺序：先按位置分配画幅身份并执行 v1 → v2 转换；再处理已成功的旧 `image` 结果，只采用任务版本与当前输入版本一致的结果（同 `server/reader-production.ts` 的 `currentJob` 检查），以同步的文件存在与类型检查代替异步发布核对，写入对应画幅；其余旧任务标为作废；未结故障按页码映射到画幅身份作为 `node_key`，版本记为 `legacy`；回执保留，未结的恢复回执随故障映射；尚未解除的 `revision.handoff` 映射为 `dag.continuation`。整个转换在迁移事务内执行，每篇用一个 `SAVEPOINT` 隔离，可重复执行。文件检查使用 `migrate()` 传入的 `directory`（旧版暂存升级路径中为 `work` 目录），不使用正式书库路径。
7. **模型快照与提供方工厂。** 快照含提供方类型、文字与绘图模型标识、各任务推理强度、绘图比例与尺寸，不含凭据。制作确认前的准备调用使用当前全局设置；`server/reader-intake.ts` 的确认动作记录快照。`server/generation.ts` 增加按快照加当前凭据构造生成器的工厂，覆盖 API 型与订阅运行器型提供方。快照对应的服务不可用时，故事进入「快照服务不可用」等待并提供「应用当前模型设置」。转换的旧故事以转换时的全局设置作为快照。
8. **v1 → v2 映射。** 每幅 `caption` 映射为叙事分镜正文，`prompt` 映射为画面描述；`characters` 文本成为一条旧规则人物条目，旧稿按规范视为全部人物入画；验收要求整体成为一条旧规则条目，登记为「全篇」，依据为叙事分镜与画面描述（规范所说的「两者」），第一次失效后按规范拆分并登记。投影把叙事分镜正文写回 `caption`，画面描述写回 `prompt`。
9. **调用契约在提供方层强制。** 每个 `StoryGenerator` 方法只接收契约所列输入的类型化参数，提示词由这些参数拼装。
10. **「修订待继续」存放在文档中。** 用 `document.dag.continuation`（提交的修订号与原因）表示，取代现有 `revision.handoff`；`generation_control` 不新增取值。只有 `continue` 动作清除它；`resume` 只解除读者暂停，不清除它。
11. **配置与规范核对规则。** 每项配置带 `specRow`，与规范表格行的首列文字精确对应；一行对应多个配置项时列出全部；主图中没有表格行的门槛与汇总节点（制作确认、可绘图、首幅）标为 `specRow: null` 并在测试中显式列出。
12. **逐幅与逐条调用按批执行。** P0.2 显示逐幅画面描述使调用数约为现状的 8.6 倍，因此画面描述、叙事修订、画面修订与叙事分镜一样每批最多 20 幅，换画风沿用正式流程的每批 6 幅，验收条目登记一次完成，审片每阶段一次。批次由 `lib/production-dag/schedule.ts` 的 `callGroups()` 从可运行实例按画幅顺序切分，调度器（M4）与测试替身共用；批次只含需要生成的实例，因此局部修改仍只调用受影响的画幅。每幅结果只绑定本幅输入，同批其他实例是来源（`@batch`），相邻衔接由绑定相邻画幅的逐幅审片结论负责。绘图与横图每次一幅。12 幅故事的分镜调用（人物、提纲、叙事分镜、画面描述）为 4 次，现状对应的调用（提纲、合并批次）为 2 次。

## 任务

### M0 可行性探查

- [x] P0.1 用 80 幅、3 条全篇条目的合成版本状态，测量 `evaluate()` 加重做预估的耗时、v2 文档 JSON 体积，以及 3 个并发图片提交与 1 个文字检查点交错时的写入冲突率。判据：单次评估不超过 50 ms，文档不超过 2 MB（原为 1 MB，经读者决定放宽，见下），图片提交无丢失写入；否则调整决策 2、3 并回到 AR。
  - 结果（2026-11-21，合成 80 幅、3 条全篇条目，脚本在会话暂存区）：评估加预估中位 3.2 ms、最大 5.6 ms，通过；3 个图片提交与文字检查点交错 200 轮，600 次图片提交无丢失，通过；v2 文档体积在画面描述平均 700 字时为 596 KB，在 80 幅全部取 1800 字上限时为 1.12 MB，超过原 1 MB 判据，主要来自投影重复保存画幅文字。读者决定把判据放宽到 2 MB：1 MB 是保守的预设，实测耗时与写入安全不受影响，SQLite 可正常处理此大小的行，典型故事约 0.6 MB。决策 2 不变，M2 继续。
- [ ] P0.3（移到 M3 门槛，依赖 M3 的快照工厂）在隔离数据上，为每种已配置的提供方类型用非当前全局设置的快照构造生成器，执行一次最小文字调用。判据：每种类型都按快照选择模型且不读取全局模型设置；无法做到的类型在决策 7 中列出处理方式并回到 AR。

### M1 配置与引擎（不改运行行为）

- [x] `lib/production-dag/registry.ts`：`NodeSpec`、`CallSpec`、输入选择器（`@self`、`@neighbors`、`@candidates`、`@drawn`、按条目依据）、`specRow`、必需或可选。
- [x] `lib/production-dag/fingerprint.ts`：规范化与指纹计算。
- [x] `lib/production-dag/engine.ts`：`evaluate()`、`runnable()`、`preview()`、`jobIdentity()`、`complete()`。
- [x] `lib/production-dag/review.ts`：结论失效、条目依据、两阶段与允许清单、建议、按结论放行、可绘图、调用方式阈值、修订额度。
- [x] `lib/production-dag/faults.ts`：故障延续、待匹配、放弃、按依赖阻断、可选产物隔离。
- [x] `lib/production-dag/hand-edits.ts`：保存时的手改选项、结构修订提交前的损失检查。
- [x] `lib/production-dag/frames.ts`：结构变化的画幅身份规则与按名字、别名匹配人物（SS 中补充，服务场景 34、35）。
- 证据：`pnpm test:related` 40 项通过（含测试登记契约），`pnpm typecheck` 与 eslint 通过。
- 里程碑提交：`d65c62a`（M1 配置与引擎，不改运行行为；已验证：相关测试、类型检查、lint）。
- [x] 测试：`tests/production-dag-registry.test.mjs`（按决策 10 双向核对）、`tests/production-dag-engine.test.mjs`、`tests/production-dag-review.test.mjs`、`tests/production-dag-faults.test.mjs`、`tests/production-dag-hand-edits.test.mjs`，按场景映射表覆盖；登记到 `tests/manifest.json` 并填写 `covers`；`scripts/test-plan.mjs` 新增 `lib/production-dag/*` 到 production 与 review 领域的映射。

### M2 文档 v2 与转换（纯代码，不接入启动，不含迁移）

- [x] `lib/reader-model.ts`：v2 schema（`document.dag`、画幅对象与顺序、分条人物、验收条目与登记、结论、模型快照、绘图参数）与 `projectDocument()`。
- [x] 准备阶段输入纳入 v2：`lib/reader-intake.ts`、`lib/reader-requirements.ts`（建议、用户填写、明确留空状态）、`lib/reader-frame-recommendation.ts` 的数据映射为原文核对、梗概、建议节点的产物与输入。
- [x] `lib/production-dag/convert.ts`：按决策 8 转换，生成旧规则结论与放行，处理缺审核、部分完成、旧放行。
- [x] `tests/production-dag-convert.test.mjs`：完成、部分完成、缺审核、旧放行、重复转换结果相同、投影与原 `Plan` 一致；登记 `covers`。
- SS 记录：v2 类型、根输入、引擎状态与投影放在 `lib/production-dag/document.ts`，`lib/reader-model.ts` 的 `Document` 增加 `dag` 字段。准备阶段的原文、梗概与建议由转换映射为产物；要求字段的「建议、填写、留空」状态仍由 intake 管理，确认后的值经选择进入根输入。旧版缺少审核记录但已完成的故事，转换为带 `unreviewed` 标记的旧规则结论：计入完成判定，不授权新的绘图（规范「缺少审核记录」）。没有页码的旧文字步骤故障挂到转换后下一个可运行的节点。
- 证据：`pnpm test:related` 125 项通过，`pnpm typecheck` 与 eslint 通过。
- 里程碑提交：`1db709e`（M2 文档 v2 与转换，未接入启动；已验证：相关测试、类型检查、lint）。

### M3 按调用契约的生成调用与模型快照（新方法并存，不接入调度）

- [x] `lib/reader-engine.ts` 的 `StoryGenerator`：按调用契约新增方法（原文核对、梗概、建议、人物设定、提纲、叙事分镜批次、画面描述、换画风转换、叙事修订、画面修订、结构修订、结语修订、登记验收条目、幅数与结构核对、分阶段审片、绘图、横图），参数只含契约输入。
- [x] 提示词与结构：`lib/reader-prompts.ts`、`lib/reader-generation-contract.ts`（绘图与横图去掉配文和制作要求，人物取入画人物切片）、`lib/reader-gemini-schema.ts`。
- [x] 提供方实现：`lib/reader-gemini.ts`、`server/openai-provider.ts`、`server/generation.ts`、`server/local-generation.ts`；内容拦截返回结构化错误码；密钥、登录、额度错误映射为服务状态；按决策 7 实现快照工厂与「快照服务不可用」。
- [x] `tests/production-dag-call-contract.test.mjs`：替身提供方记录完整 `PromptRecord`（指令、输入、参考图），对每个调用用哨兵值证明契约外的输入（如画风、配文、制作要求）不出现在任何部分；`tests/production-dag-provider-snapshot.test.mjs` 覆盖工厂与不可用状态。登记 `covers`。
- SS 记录：
  - 调用契约方法集中在 `lib/production-dag/calls.ts` 的 `dagGenerator(call)`；提供方通过 `StoryGenerator.textCall` 暴露各自的文字调用，不改提供方的请求实现。
  - 正式流程的提示词文字不复制：`lib/reader-review.ts` 抽出 `frameCountReviewRequest`、`fullReviewRequest` 并导出 `reviewNotesDirection`；`lib/reader-storyboard.ts` 导出结语与换画风指令；`lib/reader-generation-contract.ts` 把逐幅要求拆为配文、画面指令、画风三段，`imagePrompt` 改为字段化的 `imagePromptFor`。旧流程拼出的提示词逐字不变。
  - 绘图沿用提供方的 `image()`，新增可选的 `promptOverride` 接收契约提示词（`framePrompt`）。
  - 结构化错误码在 `lib/production-dag/errors.ts`；模型快照工厂在 `server/provider-snapshot.ts`。
  - 叙事分镜由模型返回涉及人物名字，系统按名字与别名匹配为候选人物；画面描述与叙事分镜分开调用，按决策 12 每批最多 20 幅。
- 里程碑提交：`0075093`（M3 按契约的生成调用与模型快照，未接入调度；已验证：变更影响测试 475 项通过、类型检查、lint）。
- [x] P0.3（M3 门槛）快照工厂探查，2026-11-21，全局设置指向不存在的模型，快照指向真实模型：
  - Claude：通过，调用按快照模型完成。
  - Gemini：请求发往快照模型 `gemini-3.8-flash`，路由正确；项目返回 402（计费余额不足），无法完成调用。
  - Codex：通过（图片生成结束后重测），调用按快照模型 `gpt-6.1-sol` 完成。首次探查失败的原因是探查未传入应用设置中的 `CODEX_MODEL`，Codex 命令行默认模型 `gpt-6.2-sol` 在本账号不可用；应用设置始终提供 `codexModel`（默认 `gpt-6.1-sol`），因此正式快照会记录实际模型。
  - 探查发现并修正一处缺陷：Codex 未配置模型时运行配置给出的显示名 `codex-default` 被当作模型名写入快照；快照改为记录 `null` 表示沿用服务默认模型，并加测试。
- [x] P0.2 门槛探查（在 M3 方法上执行，接入调度前）：同一会话、同一模型，用 2 个故事（12 幅与 24 幅）各跑 3 次，比较拆分调用与现有合并批次。指标：结构校验一次通过率与修订轮次；成本上限为 12 次完整编排。判据：通过率不低于现状减 5 个百分点；否则修正提示词后重测，仍不达标则停止并回到 AR。结果记入本计划。
  - 第一次运行（2026-11-21，Claude）无结论，需重跑：对照组全部因探查脚本缺少 `selection.theme`（`normalizeProductionPrompt` 读取 undefined）而在调用前失败；拆分组前两次完整编排（劳山道士 12 幅，各 15 次调用）全部一次通过，之后的运行触发 Claude 限流（RATE_LIMITED）。重跑时为对照组补上 theme，并错开时间避开限流。
  - 重跑（2026-11-22，Claude，对照组补上 theme，限流时等待重试、不计失败；本次未触发限流），通过：
    | 组别 | 一次通过的完整编排 | 调用一次通过率 | 调用数 | 耗时 |
    | --- | --- | --- | --- | --- |
    | 现有合并批次 | 6/6 | 100% | 15 | 20.2 分钟 |
    | 按契约拆分 | 6/6 | 100% | 129 | 26.5 分钟 |
  - 结论：结构校验一次通过率不低于现状，达到判据。拆分后调用数约为 8.6 倍（12 幅每次 15 次、24 幅每次 28 次，主要是逐幅画面描述），总耗时约多 31%；单次调用更小，本探查未计量令牌与费用。修订轮次需完整审片循环，留待 M4 后用 `pnpm test:models` 观察。
  - 后续（2026-11-22，提交 `2426b57`，已验证：变更影响测试 282 项通过、类型检查、lint）：按决策 12 改为按批调用，同样两个故事的调用数降为 12 幅 4 次、24 幅 6 次（现状 2 次、3 次）。按批画面描述的一次通过率与令牌用量尚未实测：令牌计量探查在读者要求下中止，未产生结果。按批画面描述与现有合并批次（每批 20 幅同时产出配文与画面指令，P0.2 中 100% 一次通过）的输出规模相同，M4 接入后用 `pnpm test:models` 复核。

### M4 切换：迁移、触发器、调度与服务端修订

- SS 记录：按全部迁移建出的临时书库中现有 25 个触发器（0018 改名后触发器正文引用 `stories`，以实际库为准，不以迁移文件为准）。与新语义冲突、须在 0025 重建的：`reader_override_command`、`reader_image_lost`、`reader_image_restored`、`reader_job_failed`、`reader_control_command`、`reader_intake_fault_generation`、`stories_blocked_revision_fault`；须逐个核对后决定的：`reader_job_queued`、`reader_job_running`、`reader_job_succeeded`、`reader_recover_command`、`reader_recovery_adopt`、`reader_legacy_failure`、`reader_legacy_fault_lineage`、`reader_replace_receipt`；与本故事无关、保持不变的：`book_image_reference_on_delete`、`books_refuse_pre_consolidation_seed`、`production_disarm_deleted`、`reader_command_id_guard`、`reader_session_id_guard`、`reader_intake_command`、`reader_search_command`、`reader_job_deleted`、`story_content_revision`、`story_content_revision_insert`。
- [ ] `drizzle/0025_production_dag.sql`、`db/schema.ts`、`db/library-format.json`：按决策 4、5 新增列与状态、重建索引与触发器、`schemaVersion` 2、`latestMigration`。
- [ ] `server/library-upgrade.ts` 及启动路径：按决策 6 在调度前转换；沿用升级前经核对的整库备份；核对待处理日志检查（`server/library-schema.ts`）仍在访问前完成。
- [ ] `server/reader-production.ts`：`graph()` 改为由 `runnable()` 与 `jobIdentity()` 生成任务（intake 查找分支保留）；执行器按节点调用 M3 方法并按决策 3 保存；`settle` 与重建候选查询、`canRun`、`snapshotView` 改为按依赖判断故障，不再因任一故障冻结整篇；会话可由不依赖故障的普通任务从 `failed` 进入 `running`；完成判定用 `complete()`。
- [ ] `server/production-queue.ts`：按池设置调用超时，超时按中断处理；失败时写入 `error_code`。
- [ ] 准备阶段切换：`server/reader-intake.ts`（确认记录快照）、`server/reader-reselection.ts`、`server/reader-production.ts` 的 `prepare` 任务与执行器改由引擎调度原文核对、梗概、建议；查找分支保留。
- [ ] `server/reader-revisions.ts`、`server/reader-commands.ts`：保存修改提交新版并进入「修订待继续」暂停；无需重做时保持原状态；提交时执行故障延续与待匹配；新增「继续制作」「应用当前模型设置」命令，沿用请求幂等；提供 `preview()` 接口供客户端使用；删除 `canEditReviewNotes` 的旧门槛。
- [ ] 删除并替换旧规则：`lib/reader-model.ts` 中 `nextStep()` 的制作步骤推导与 `productionComplete()`；`lib/reader-revision.ts` 的 `revisionImpact`、`preserveRevisionScript`、`revisionReviewNotesChanged`、`revisionStorySummaryChanged`、`redrawImagePlan`、`syncRevisionImages`，`checkedRevision` 只保留输入校验；`lib/reader-revision-images.ts` 的复用规则；`lib/reader-story-brief.ts` 的 `invalidateStoryBrief` 与 `staleRevisionStoryBrief`；`lib/reader-review.ts` 的 `pendingRepairs`；`lib/generation-progress.ts`、`lib/production-stages.ts` 改读引擎状态。
- [ ] `client/ui/useStoryRevision.ts`：改用服务端 `preview()`，移除对 `revisionImpact` 的引用，使 M4 通过类型检查。
- [ ] 写入方迁移：`lib/reader-repository.ts` 与 `lib/reader-api.ts` 中读写 `revision.handoff` 的代码改用 `dag.continuation`；审计读写 `doc.plan`、`doc.images`、`doc.visualReview` 的文件（`server/reader-copy.ts`、`server/book-image-reference.ts`、`server/reader-reselection.ts`、`server/import-legacy.ts`、`lib/reader-api.ts` 等），写入方改走 `dag` 接口，只读方保留投影。
- [ ] `tests/production-dag-scenarios.test.mjs`：用替身提供方驱动 `ReaderProductionCoordinator`，含重启与调用计数，按场景映射表覆盖协调器场景；登记 `covers`。
- [ ] 更新受影响的现有测试，断言改为规范行为且不放宽安全约束：`reader-production`、`reader-revisions`、`story-generation-state-machine-*`、`blocked-revision-recovery`、`frame-count-review`、`adaptive-storyboard-review`、`character-continuity-edits`、`frame-count-gate`、`paused-editing-versions`、`production-queue-hardening`、`story-requirements`，以及 `pnpm test:changed --plan` 列出的其他受影响测试。
- [ ] 安全与启动：`pnpm test:safety`、`pnpm test:startup` 增加用例：旧格式应用拒绝打开 v2 书库；版本 1 的升级日志仍被接受；升级转换在临时书库上执行；转换中断后重做结果相同；`resume` 不解除「修订待继续」。
- [ ] 原生检查：`src-tauri/src/library.rs` 的日志版本范围修改，并运行受影响的 `src-tauri` 原生测试（计划报告 `native: true` 时）。

### M5 界面与 CLI

所有界面改动遵守 AGENTS.md「Desktop Development」规则，逐条核对：

- 制作流程的操作按钮和链接放在所属流程框内，靠右对齐；修改制作内容后的确认（「已保存，等待继续」与「继续制作」）放在对应流程步骤内。
- 制作步骤共用 `ProductionTimelineRow`：首行左侧简短步骤标题，右侧状态和查看、编辑链接；下一行左侧完整说明，右侧耗时；空间不足时链接整组靠右换行；缺少内容的行不占位；确认、重试及错误提示紧跟本步骤内容。
- 「制作确认」的四个设置及当前值保持同一行；窄屏可缩短可见字段名，链接的无障碍名称保留完整字段名与当前值。
- 「开始制作」「继续制作」及次要操作（重试、重新加载、查看、编辑、取消、放行、重绘、应用当前模型设置等）用 `StoryFlowAction`（`story-flow-link`，深色画面加 `tone="dark"`），不另写链接样式；其他主操作、对话框里与确认并列的取消、切换类控件、图标按钮，以及设置表单自身的保存和测试控件仍用按钮。
- 只在 `pnpm desktop:preview` 的内置浏览器中开发与核对，复用已有标签页；不打包桌面应用。


- [ ] `client/ui/StoryRevisionEditor.tsx`、`client/ui/useStoryRevision.ts`：统一「保存修改」，显示接续点与预估；手改处理选项；「同时更新画面描述」；候选与入画人物、验收条目登记、标题与结语确认的编辑。
- [ ] `client/ui/StoryProductionTimeline.tsx`、`client/ui/StoryReviewTools.tsx`、`client/ui/StoryGenerationControl.tsx`、`client/ui/StoryRetry.tsx`：「已保存，等待继续」与「继续制作」放在所属步骤；需读者处理、建议、按结论放行、使用旧参考、待匹配与延续故障、服务故障、快照服务不可用的显示；遵守 `ProductionTimelineRow` 与 `StoryFlowAction` 约定。
- [ ] `server/headless-cli.ts` 与 `skills/shiqu/SKILL.md`：`stories edit` 改为保存并等待，去掉 `paused:true` 输入；新增 `stories continue`（授权当前修订，同时解除修订待继续与读者暂停），`stories resume` 保留为解除读者暂停；生成仍只在 `run` 时执行；更新帮助、示例及 SKILL.md 中修订、梗概重算和运行的说明。

### M6 文档

- [ ] `.docs/story-generation-state-machine.md`：第 3、8 节改为引用 DAG 规范；同步第 4 节（审片子状态与按结论放行）、第 6 节（暂停、恢复与故障按依赖阻断）、第 9 节（验收场景）、第 10 节（代码索引，加入 `lib/production-dag/`）。
- [ ] `.docs/user-guide.md`、`.docs/story-creation-editing-queue.md`：同步新流程与按钮。
- [ ] `AGENTS.md` 的「Canonical Story Storage」：写明 v2 书库需要的最低应用版本及回滚方式。

## 验证

- 迭代：`pnpm test:related`、`pnpm typecheck`、`pnpm lint`。
- 交付前：`pnpm test:changed`；M4 起另跑 `pnpm test:safety`、`pnpm test:startup`，以及计划报告的原生检查。
- 模型：`pnpm test:models` 手动运行映射表中标为手动的项目，结果记入本计划。
- 界面：`pnpm desktop:preview` 在内置浏览器按端到端验证文档执行。

## 风险

- **范围大。** 里程碑本地提交；M0–M3 不改变运行行为，M4 一次切换；全部完成前不发布。
- **生成质量与成本。** 拆分调用、条目登记与第二阶段审片增加调用；P0.2 设定门槛。
- **用户书库升级。** 格式版本升级阻止旧应用写入；转换不调用模型、可重复；只在临时书库验证。
- **触发器语义。** 触发器与引擎各管一部分状态，重建后由协调器测试与安全测试覆盖。
