# 计划：数据驱动的制作 DAG

需求：[req-data-driven-production-dag](../../../../reqs/2026/11/21/req-data-driven-production-dag.md) · 规范：[故事制作与编辑 DAG](../../../../story-production-dag.md) · 端到端验证与场景映射：[test-data-driven-production-dag](../../../../tests/test-data-driven-production-dag.md)

Git 基线：`52ddf58b810ff80c19f40f618ef52134ca658094`（SS 开始时的 HEAD）。工作区中已有的无关改动（其他计划与完成文档、用户指南）不属于本故事。

## 结果

- 规范的节点目录与调用契约成为 `lib/production-dag/` 中的声明式配置，一个纯函数引擎据此计算有效性、就绪、重做预估与任务身份。
- 选定来源之后的全部制作（原文核对、梗概、建议、分镜、审片、绘图、横图）经过该引擎调度；修订、故障、模型快照与升级都按规范执行；旧的逐条规则删除。
- 桌面界面、CLI 与技能文档采用「保存修改 → 已保存，等待继续 → 继续制作」。

## 边界

- 包含：引擎与配置、文档 v2 与存储投影、SQL 触发器精简与格式版本升级、按调用契约拆分的生成调用、模型快照与提供方工厂、调度切换、修订与故障规则、升级转换、界面与 CLI、相关文档。
- 不包含：候选查找（选定来源之前，保留现有 intake 代码）、图片内容审核、导出格式、新服务商、外部工作流框架、规范之外的界面改版。

## 关键决策

1. **引擎是纯函数模块，调度范围从原文核对开始。** `lib/production-dag/` 不做 I/O：输入为版本状态（产物记录、故障、授权、模型快照），输出为节点实例状态、可运行集合、预估、任务身份和完成判定。原文核对、梗概、建议及之后的全部节点由引擎调度；候选查找在 DAG 之外，沿用 `server/reader-production.ts` 现有 intake 分支。
2. **`document.dag` 是权威来源，`plan`、`images`、`visualReview` 保留为存储投影。** 每次保存在同一条 `UPDATE` 中写入 `document.dag` 与投影，投影由 `projectDocument()` 从 `dag` 生成。只读消费者（阅读、导出、复制、重选、书籍参考、历史界面、`lib/reader-api.ts` 等约 20 个文件）继续读投影；所有写入方改走 `dag` 接口。导出结构因此不变。
3. **画幅以身份为键存放。** `dag.frames` 是以画幅身份为键的对象，另存 `dag.order` 数组。图片提交用路径限定的 `json_set`，在同一条语句中写 `dag.frames.<id>.image` 和投影 `$.images[<id 在 dag.order 中的位置>]`，并以绘图硬输入指纹为保存条件；文字节点仍在会话锁下串行执行，整份文档以现有比较并交换方式保存。
4. **一个迁移直接建成最终结构，制作规则不放在触发器里。** 0.14.0 已发布到 `0024`，`0025_production_dag.sql` 尚未发布。本故事的全部结构变更只放在 `0025` 一个迁移中，开发期间就地修改，不另加 `0026`，也不先建后删任何表、列、索引或触发器。`0025` 的结果即最终结构：
   - `reader_faults` 按 SQLite 标准方式重建（新表、复制、删旧表、改名）为最终列：`node`、`node_key`、`input_hash`、`origin_fault_id`、`optional`，状态增加 `awaiting-match`，不再有 `page`。复制时有页码的旧图片故障直接写为 `node='frameImage'`、`node_key='legacy-'||(page+1)`（与 `legacyFrameId` 一致）；没有页码的旧故障 `node` 留空，由决策 6 的钩子用 `mapLegacyFaults` 补上。活跃图片故障的唯一索引在新表上直接建为 `(session_id, owner_id, node, node_key)`。
   - `production_jobs` 增加 `error_code`，队列在任务失败时写入结构化错误码（如 `CONTENT_BLOCKED`、`SERVICE_AUTH`、`TIMEOUT`）；「内容被拦截」不自动重试以它为准。M4 接入后不再使用的列在同一迁移中移除，不留空列。
   - 删除 18 个承载制作规则的触发器：`reader_job_failed`、`reader_job_queued`、`reader_job_running`、`reader_job_succeeded`、`reader_job_deleted`、`reader_control_command`、`reader_override_command`、`reader_recover_command`、`reader_recovery_adopt`、`reader_image_lost`、`reader_image_restored`、`reader_intake_command`、`reader_search_command`、`reader_replace_receipt`、`reader_intake_fault_generation`、`reader_legacy_failure`、`reader_legacy_fault_lineage`、`stories_blocked_revision_fault`。它们的作用改由 TypeScript 在同一事务中完成：任务状态变化（故障记录、恢复命令状态）在 `server/production-queue.ts`；控制、放行、恢复、采用在 `server/reader-commands.ts`；图片丢失与恢复由协调器按依赖处理并用 `complete()` 判定完成；文档写入时的命令回执与写入同一事务；三个旧格式触发器只服务于旧文档，转换后不再需要。
   - 保留 7 个与制作规则无关的完整性触发器：`books_refuse_pre_consolidation_seed`（阻止 0.2–0.7 应用写入，只有 SQL 能拦住不受本应用控制的代码）、`reader_command_id_guard`、`reader_session_id_guard`、`story_content_revision`、`story_content_revision_insert`、`book_image_reference_on_delete`、`production_disarm_deleted`。
   - 原因：书库只有 Node 服务一个写入方（桌面原生只读），`node:sqlite` 是同步接口，原先放在触发器里是因为 `Database` 接口只能逐条执行、没有事务。本地数据库增加同步事务助手（`BEGIN IMMEDIATE` 内执行、事务体不含 `await`），多表变化在一个事务中原子完成；规则只在 TypeScript 中，引擎的完成与故障判定不在 SQL 里重复一份。旧应用因决策 5 无法打开格式 2 的书库，不会有依赖这些触发器的旧代码写入。
5. **格式版本升到 2。** `db/library-format.json` 的 `schemaVersion` 改为 2，迁移设置 `PRAGMA user_version=2`（先例见 `drizzle/0018`），`minimumAppVersion` 设为本次发布版本。旧应用按 `server/library-schema.ts` 与 `src-tauri/src/library.rs` 现有规则拒绝打开。两处的升级日志版本检查改为接受 1 至 `schemaVersion`，避免 0.8.x 中断升级留下的版本 1 日志被误拒。回滚方式：升级前的整库备份加对应旧版应用。
6. **升级转换作为 `0025` 的迁移钩子执行。** 在 `server/database-migrations.ts` 中像 `0024` 迁移提示词记录一样，为 `0025` 挂代码钩子，在 `0025` 的 SQL 之后、同一事务内执行，使转换与迁移回执同属一次升级：受经核对的整库备份保护，崩溃后随迁移重做，所有入口（协调器、CLI、导出）只会看到已转换的书库。应用重启后没有正在运行的调用，「在途任务」是已付费待发布的图片结果、排队或中断的旧任务、未结的故障和回执。钩子内顺序：先按位置分配画幅身份并执行 v1 → v2 转换；再处理已成功的旧 `image` 结果，只采用任务版本与当前输入版本一致的结果（同 `server/reader-production.ts` 的 `currentJob` 检查），以同步的文件存在与类型检查代替异步发布核对，写入对应画幅；其余旧任务标为作废；未结故障的页码已由 `0025` 的 SQL 映射为画幅身份，钩子为没有页码的旧故障补上节点，版本记为 `legacy`；回执保留，未结的恢复回执随故障映射；尚未解除的 `revision.handoff` 映射为 `dag.continuation`。整个转换在迁移事务内执行，每篇用一个 `SAVEPOINT` 隔离，可重复执行。文件检查使用 `migrate()` 传入的 `directory`（旧版暂存升级路径中为 `work` 目录），不使用正式书库路径。
7. **模型快照与提供方工厂。** 快照含提供方类型、文字与绘图模型标识、各任务推理强度、绘图比例与尺寸，不含凭据。制作确认前的准备调用使用当前全局设置；`server/reader-intake.ts` 的确认动作记录快照。`server/generation.ts` 增加按快照加当前凭据构造生成器的工厂，覆盖 API 型与订阅运行器型提供方。快照对应的服务不可用时，故事进入「快照服务不可用」等待并提供「应用当前模型设置」。转换的旧故事以转换时的全局设置作为快照。
8. **v1 → v2 映射。** 每幅 `caption` 映射为叙事分镜正文，`prompt` 映射为画面描述；`characters` 文本成为一条旧规则人物条目，旧稿按规范视为全部人物入画；验收要求整体成为一条旧规则条目，登记为「全篇」，依据为叙事分镜与画面描述（规范所说的「两者」），第一次失效后按规范拆分并登记。投影把叙事分镜正文写回 `caption`，画面描述写回 `prompt`。
9. **调用契约在提供方层强制。** 每个 `StoryGenerator` 方法只接收契约所列输入的类型化参数，提示词由这些参数拼装。
10. **「修订待继续」存放在文档中。** 用 `document.dag.continuation`（提交的修订号与原因）表示，取代现有 `revision.handoff`；`generation_control` 不新增取值。只有 `continue` 动作清除它；`resume` 只解除读者暂停，不清除它。
11. **配置与规范核对规则。** 每项配置带 `specRow`，与规范表格行的首列文字精确对应；一行对应多个配置项时列出全部；主图中没有表格行的门槛与汇总节点（制作确认、可绘图、首幅）标为 `specRow: null` 并在测试中显式列出。
12. **逐幅与逐条调用按批执行。** P0.2 显示逐幅画面描述使调用数约为现状的 8.6 倍，因此画面描述、叙事修订、画面修订与叙事分镜一样每批最多 20 幅，换画风沿用正式流程的每批 6 幅，验收条目登记一次完成，审片每阶段一次。批次由 `lib/production-dag/schedule.ts` 的 `callGroups()` 从可运行实例按画幅顺序切分，调度器（M4）与测试替身共用；批次只含需要生成的实例，因此局部修改仍只调用受影响的画幅。每幅结果只绑定本幅输入，同批其他实例是来源（`@batch`），相邻衔接由绑定相邻画幅的逐幅审片结论负责。绘图与横图每次一幅。12 幅故事的分镜调用（人物、提纲、叙事分镜、画面描述）为 4 次，现状对应的调用（提纲、合并批次）为 2 次。
13. **调用请求只由声明的输入构建（审查意见第 1 条）。** 登记表 `calls` 是调用输入的唯一定义：引擎按它计算并记录指纹，`lib/production-dag/requests.ts` 的读取器只交出它声明的输入（绑定、核对、来源、上下文），读取未声明的输入抛错；审片声明的输入是本次允许结论各自硬输入之并，因此只审叙事结论时不发送画风与人物设定，只审逐幅结论时不发送提纲、梗概与结语。模型返回人物名字，保存时按人物设定匹配条目；制作要求指纹按规范化后实际发送的文字计算。审片不再发送详略设置，幅数与详略由幅数与结构核对负责。
14. **只有一个审片计划（审查意见第 2 条）。** `schedule.ts` 的 `callGroups()` 是唯一的审片分组，测试替身与正式调度共用；规范中「超过三分之一按全篇调用」的调用方式已删除，因为每次审片都读取全篇作为上下文，两种方式没有可观察的差别。
15. **先在隔离书库证明一条完整路径，再退役旧写入与触发器（审查意见第 3 条）。** 有 `document.dag` 的故事走 `server/dag-production.ts`，其余故事仍走旧流程，直到切换；第一条证明的场景是「改一幅配文、保存、重启、继续」。迁移 `0025`、事务替代触发器与旧规则删除放在最后一步，进行中的迁移工作暂存于分支 `wip/production-dag-0025`（提交 `7940281`，未测试），切换时再并入。

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

### M4 切换：迁移、调度、事务与服务端修订

- SS 记录：M4 按决策 15 分步，每步可单独回退；切换前新旧路径并存（新路径只服务有 `document.dag` 的故事）。
  - M4.1 执行层 `lib/production-dag/runner.ts`（纯函数）：`settle()` 采用已有原文与准备结果、同步验收条目、按绘图输入复用旧图；`work()` 由引擎可运行实例按调用合批（叙事分镜逐批顺序进行），再加自动修订；`inputsFor()` 按契约组装 `dagGenerator` 参数；`apply()` 先核对派发时的硬输入，迟到结果丢弃，再写回 dag。提纲改变时全部画幅取得新身份；结构修订替换段的第一幅沿用原身份、其余新身份，会改写手改画幅时不提交；修订无变化、手改、额度用尽或要求无法判断时由 `attention()` 报告「需读者处理」。文档 v2 增加梗概、提纲、幅数核对报告、结论说明、问题、建议、修订额度与画风映射。`tests/production-dag-runner.test.mjs` 用替身生成器驱动完整故事。
  - M4.2 服务端执行器 `server/dag-executor.ts`：文字工作经 `dagGenerator` 按契约方法调用 `textCall`，绘图与横图经提供方 `image()`，提示词取 `framePrompt`，参考图取首幅书籍参考或首幅成图；投影 `projectDocument()` 改为由 dag 生成 plan（旧故事沿用原 plan 其余字段）。保存由 M4.3 的协调器在会话锁下完成。
  - M4.3 一条完整路径：`server/dag-production.ts` 为 DAG 故事安排与执行工作（任务身份由调用、阶段与派发时的硬输入决定，结果以文档内容比较并交换保存，完成用 `finished()`）；`server/dag-revisions.ts` 保存修订（复制图片、手改按当前输入记录、需要重做时进入「已保存，等待继续」）；新增「继续制作」命令。`tests/production-dag-scenarios.test.mjs` 在隔离书库与受控提供方上经正式协调器验证：改一幅配文、保存、重启、继续后只调用一次审片（被改画幅与相邻画幅的逐幅结论及叙事结论），绘图调用为零。本步只支持不改变幅数的修改；增删重排、换图与重绘说明在修订中明确拒绝。
  - M4.4 逐个场景扩展 DAG 路径，均在隔离书库与受控提供方上经正式协调器验证（`tests/production-dag-scenarios.test.mjs`）：
    - 完整制作：已确认的故事从提纲制作到最后一幅图，每个文字步骤一次调用、每幅一次绘图，后续画幅以首幅为参考（`1c25b52`）。
    - 修订：删除画幅（其余图片与身份保留、绘图为零；标题与结语候选绑定画幅身份序列，因此重新拟定）、仅换图带重绘说明、换画风（一批转换后重绘）、改变幅数策略；保存会使手改失效时须对每处手改选择「以手改为基础」或「放弃」，修订接口新增 `handEdits`（`765e1a5`）。
    - 故障：失败任务记录的工作把故障归属到节点实例，只阻断该节点及其下游，不依赖它的结语与幅数核对照常完成；恢复命令重跑同一工作（`765e1a5`）。暂用现有 `reader_faults` 表经任务关联，按节点的列在 M4.5 的迁移中建立。
    - 横图：读者请求后为已完成故事安排横图，不需要阅读需求；失败记在画幅上，不形成阻断完成的故障，可重试失败的幅（`695e1d5`）。
    - 准备结果的采用：已对照原文核对的梗概、已核原文与准备建议直接采用为产物，不付费重做。准备阶段本身仍是现有的合并建议调用（梗概读取的输入多于规范的「只读原文」）；把梗概与建议拆成按契约的两个调用需要同时改制作确认界面的草稿与重新建议流程，移到 M5 与界面一起完成。
    - 审查意见第 2 轮（生产边界），均有从正式入口出发的场景或单元测试：
      1. DAG 任务带准备流程的世代（`setupGeneration`），与旧任务同样受世代核对；「审片后停止」的绘图门槛加入 DAG 绘图任务。场景从选题、准备、确认的正式接口进入 DAG 路径。
      2. 任务身份覆盖请求实际读取的全部输入（含修订读取的当前配文与问题），同一问题第二次出现时得到新的修订任务；产物有效性仍只按硬输入。执行前核对任务仍属当前工作，正在执行的实例不再重复派发，当前需要的工作与已完成任务同身份时重新排队。
      3. 「继续制作」在一个同步事务中核对操作编号（同一编号只能是本版的继续）、清除等待并写入回执；用于其他操作的编号被拒绝，同编号重放直接返回。事务助手（`server/database.ts` 的 `transaction()`）先行并入，迁移 0025 仍在暂存分支。
      4. 修订复制图片时原图丢失：成图产物标为不可读，并记录该幅的图片丢失故障，读者明确恢复后才重绘；队列不再因整篇的失败状态停下 DAG 任务。
      5. 依据「标题与结语」的条目绑定标题与选定结语这一对值，第二阶段审片同时收到标题；审片报告的逐幅条目未通过或无法判断时落到对应画幅的逐幅结论，无法判断记为需读者处理；缺少条目结果时调用失败重试。
    - 首幅参考规则（读者决定，已写入规范「就绪与失效」）：首幅成图正在重做时，其余需要重绘的画幅等新首幅完成后再以它为参考；登记表以 `rerunWaitsForCheck` 标在画幅图片节点上，引擎通用处理。
    - 审查意见第 3 轮，均有测试：
      1. 命令行 `--until reviewed` 对 DAG 故事改由引擎判断：全部结论通过或被放行才返回 `reviewed`，停在需读者处理时返回 `blocked`（`skills/shiqu/SKILL.md` 同步说明）。
      2. 「继续制作」的已接受编号先于替换、停止与服务配置核对重放。
      3. 修订的新版与图片丢失故障在一个事务中写入；读者端图片核对对 DAG 故事在一个事务中标记丢失与故障、文件恢复时一并解除，整篇状态以引擎判定为准（旧触发器会按旧规则标为完成，切换时删除，此前由 `settleState()` 更正）；恢复后该幅按引擎重绘。
      4. 审片说明只列出确实未提供的输入；每个阶段只要求本阶段允许的条目（及有逐幅结论时的逐幅条目）给出结果，其余条目可省略。
    - 转换故事的接续（审查意见）：转换时把提纲与梗概写入 dag（没有提纲记录的旧故事以各幅配文作节点），修订、结语、幅数核对与审片可读取；整体旧验收条目在验收要求文字不变时保留其登记与结论，部分绘制的故事直接补画剩余画幅，不重复登记与审片，文字改变后才拆分重审。
    - 新确认的故事仍走旧流程：DAG 路径尚缺「需读者处理」等界面状态（M5），在 M4.5 切换时与界面一起启用。
  - M4.5 切换：并入并完成迁移 `0025`、事务替代 18 个触发器、旧故事转换、删除旧规则与旧测试。
- SS 记录：按全部迁移建出的临时书库中现有 25 个触发器（0018 改名后触发器正文引用 `stories`，以实际库为准，不以迁移文件为准）。按决策 4 删除 18 个、保留 7 个；逐个的去向见决策 4。
- [ ] `drizzle/0025_production_dag.sql`、`drizzle/meta/_journal.json`、`db/schema.ts`、`db/library-format.json`：按决策 4、5 一次建成最终结构（重建 `reader_faults`、`production_jobs.error_code`、删除 18 个触发器、`user_version` 2），`schemaVersion` 2、`latestMigration`。之后发现的结构变更就地改 `0025`。
- [ ] 本地数据库事务助手（`server/database.ts` 及 `Database` 接口）：同步执行、事务体不含 `await`；迁移测试断言 `0025` 之后只剩 7 个触发器。
- [ ] 删除的触发器逐个改写为事务代码：`server/production-queue.ts`（任务失败、排队、运行、成功、删除时的故障与恢复命令状态）、`server/reader-commands.ts`（控制含 `continue`、放行只更新被放行的结论、恢复、采用）、文档写入路径（准备与查找回执、替换回执、准备阶段换代时作废故障）、协调器（图片丢失与恢复）。每项有单元测试，原触发器覆盖的现有测试保持通过或按规范改写。
- [ ] `server/library-upgrade.ts` 及启动路径：按决策 6 在调度前转换；沿用升级前经核对的整库备份；核对待处理日志检查（`server/library-schema.ts`）仍在访问前完成。
- [ ] `server/reader-production.ts`：`graph()` 改为由 `runnable()` 与 `jobIdentity()` 生成任务（intake 查找分支保留）；执行器按节点调用 M3 方法并按决策 3 保存；`settle` 与重建候选查询、`canRun`、`snapshotView` 改为按依赖判断故障，不再因任一故障冻结整篇；会话可由不依赖故障的普通任务从 `failed` 进入 `running`；完成判定用 `complete()`。
- [ ] `server/production-queue.ts`：按池设置调用超时，超时按中断处理；失败时写入 `error_code`。
- [ ] 准备阶段切换：`server/reader-intake.ts`（确认记录快照）、`server/reader-reselection.ts`、`server/reader-production.ts` 的 `prepare` 任务与执行器改由引擎调度原文核对、梗概、建议；查找分支保留。
- [ ] `server/reader-revisions.ts`、`server/reader-commands.ts`：保存修改提交新版并进入「修订待继续」暂停；无需重做时保持原状态；提交时执行故障延续与待匹配；新增「继续制作」「应用当前模型设置」命令，沿用请求幂等；提供 `preview()` 接口供客户端使用；删除 `canEditReviewNotes` 的旧门槛。
- [ ] 删除并替换旧规则：`lib/reader-model.ts` 中 `nextStep()` 的制作步骤推导与 `productionComplete()`；`lib/reader-revision.ts` 的 `revisionImpact`、`preserveRevisionScript`、`revisionReviewNotesChanged`、`revisionStorySummaryChanged`、`redrawImagePlan`、`syncRevisionImages`，`checkedRevision` 只保留输入校验；`lib/reader-revision-images.ts` 的复用规则；`lib/reader-story-brief.ts` 的 `invalidateStoryBrief` 与 `staleRevisionStoryBrief`；`lib/reader-review.ts` 的 `pendingRepairs`；`lib/generation-progress.ts`、`lib/production-stages.ts` 改读引擎状态。
- [ ] `client/ui/useStoryRevision.ts`：改用服务端 `preview()`，移除对 `revisionImpact` 的引用，使 M4 通过类型检查。
- [ ] 写入方迁移：`lib/reader-repository.ts` 与 `lib/reader-api.ts` 中读写 `revision.handoff` 的代码改用 `dag.continuation`；审计读写 `doc.plan`、`doc.images`、`doc.visualReview` 的文件（`server/reader-copy.ts`、`server/book-image-reference.ts`、`server/reader-reselection.ts`、`server/import-legacy.ts`、`lib/reader-api.ts` 等），写入方改走 `dag` 接口，只读方保留投影。
- [ ] `tests/production-dag-scenarios.test.mjs`：用替身提供方驱动 `ReaderProductionCoordinator`，含重启与调用计数，按场景映射表覆盖协调器场景；登记 `covers`。
- [ ] 更新受影响的现有测试，断言改为规范行为且不放宽安全约束：`reader-production`、`reader-revisions`、`story-generation-state-machine-*`、`blocked-revision-recovery`、`frame-count-review`、`adaptive-storyboard-review`、`character-continuity-edits`、`frame-count-gate`、`paused-editing-versions`、`production-queue-hardening`、`story-requirements`、`desktop-service-console`（第 108 行删除 `stories_blocked_revision_fault` 模拟未迁移书库，0025 后该触发器不存在，改用其他方式构造），以及 `pnpm test:changed --plan` 列出的其他受影响测试。
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
- **触发器移出。** 18 个触发器的作用改为事务代码，任一写入路径漏掉对应步骤会造成状态不一致；逐个改写并测试，事务助手是这些写入的唯一入口。
