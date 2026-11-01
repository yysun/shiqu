# 增量故事库与主题匹配

Git base: `e51429b85b30a505e6b58873a4cccc3709170360`

入口工作区有上一故事验证文档及 tests/reader-generation.test.mjs 的提示词断言修正，均属于已完成的连续查找前置工作；本故事仅将相关断言纳入，其他既有文档保留，不归入本故事提交。

风险 non-low：持久缓存语义、付费模型调用、跨主题并发、扫描位置及原文事实边界。

## 设计决定

保留现有 provider.suggestions 接口，增加内部 catalog 扫描用途：提取 prompt/schema 不含主题，仅提取完整故事及有结局的中性摘要。旧 scan 用途仍供已有直接 provider 调用，不将旧主题扫描结果或游标迁成完整通用库。复用按章节/输入预算的阅读块和可验证 source 定位。

重构 local-story-discovery 为两段：通用库状态只存 stories、cursor、pendingEvents、exhausted；提取命名空间由原文/范围/提取契约/模型/推理档位确定，不含主题。共享扩展只负责增加通用库，不依赖任何读者的排除项或匹配结果；一次扩展有新故事即停，最后一个读者离开后当前模型调用可保存缓存，但不继续扫描。

ReaderProvider.matchStories 使用跨三个适配器的统一契约，输入一批 story id/title/summary，输出逐条 yes/no/review、reason、summary。yes 必须有匹配理由和完整拟改编摘要，no/review 不提供制作摘要；范围未变可复用通用摘要，不为主题新增事实或改变出处。id绑定源范围与通用摘要，严格核对完整ID集合；review 带原文复核。缓存存完整判断对象，契约键变化只失效主题层，不重扫通用库。丰富输出后每批最多4篇，受输入预算约束。

主题判断缓存按库命名空间、规范化主题、匹配契约及有效模型/推理配置隔离；用独立共享锁读取最新缓存并合并，不因并发丢结果。正反判断都缓存；新故事使用内容ID增量判断。匹配所需的输入超预算时拒绝付费调用并保留库进度，不截断成误判。

先检查已入库故事，匹配后返回候选。候选以可选 storyBrief={summary,matchReason} 携带拟改编摘要，通用库仍不含主题信息。选中后从服务端保存的候选取得brief，随该任务原文保存；客户端制作命令不能伪造摘要。重选已有逻辑清理原文，避免串篇。

在现有 recommend（画幅建议）调用中完成核对：有brief时动态输出契约额外要求 storySummary 与 storyMatchReason，先对照原文修正摘要和理由，防止错误理由重新引入已排除的事实；没有brief的旧流程维持count/reason契约。引擎在原文检查点保存未核对brief，调用完成后原子保存核对摘要/理由及verified标记；缺失/非法核对结果不可进入确认。确认与plan调用都有防线；升级前无标记且无brief的历史记录不受影响，新任务的无brief候选按下述规则补齐。

用户补充：主题与原典两种模式都要摘要，直接选原典故事也必须补齐。新createIntake记录内部 `briefRequired=true` 能力标记（非用户配置或世代字段），避免升级前无brief历史任务被强制重做。准备时优先取候选storyBrief；新任务无brief则用已保存候选简介作为明确未核对的起始资料，要求同一次recommend按完整原文生成/补齐摘要与理由，不声称简介已经是完整摘要。确认防线同样检查该能力标记，历史记录无标记且无brief保持旧路径；已有分镜不自动重做。两个模式都在准备后具有verified摘要，不能以计策目的代替实际过程和结果。

边界：上述“新任务”指当前选题/制作确认（intake）流程。兼容的非intake会话创建API仍保留既有调用和确认契约；它可在无选定故事时直接编排，不纳入本轮摘要保证，不将其自动迁为intake或插入额外准备调用。

原文payload仍只有原文和章节上下文；核对摘要通过独立 storyBrief 字段进入短篇plan、outline、batch及review/repair等共同payload。复用现有 editorialContext 的 mode=source/theme 判定，将它从仅标题/结语扩展为全篇编排与审核上下文，不再另造一套模式。主题模式同时核对主题与摘要是否通过原文有据的事件、行动和关系呈现；原典/忠于原文模式不额外套主题。两个模式都继续遵守既有开场、节奏、完整因果、静态画面和连续性，摘要冲突以原文为准。移除现行“选定后主题不进入分镜”“editorialContext只用于标题/结语”的冲突指令，保留禁止为主题虚构事实的约束。

“设局”原意是第一页交代背景，不是另一份全篇资料；统一保留摘要，不新增设局字段。复用共享storyOpeningDirection，让编排和审核结合摘要，从原文中提取必要背景、人物关系和眼前处境做开场，不照搬完整摘要或预先讲完结局。这是现有开场规则的明确化，不改变数据模型或增加模型调用。

匹配summary最多1200字符、reason最多300字符，每批上限4篇。Gemini/OpenAI匹配输出预算为max(4096, 4000×篇数)，最多16000，使用现有审核调用已有的输出预算范围；Codex沿用CLI文本响应能力。带brief的画幅建议提高至4096 token以返回核对摘要，无brief保持旧2000/2048预算。加入三provider请求契约测试，验证batch上限、输出预算和条件schema，不能保留旧3000/2000常量导致新增字段常被截断。

## 执行任务

- [x] 定义 catalog 提取与主题判断契约；三种 provider 实现 matchStories，沿用 suggest 推理设置；catalog 解析强制完整摘要，旧 scan 解析兼容。
- [x] 重构本地扫描为主题无关的增量库，维持原文验证、未完事件、主/子故事、预算、共享取消和持久化；不信任旧主题游标。
- [x] 将主题回执升级为含理由/摘要的对象；yes信息完整才返回，更新缓存schema和匹配契约，保持提取命名空间稳定与单次付费/取消规则。
- [x] 增加可选候选storyBrief及与原文绑定的核对记录；新intake标记briefRequired，使直接选原典及旧式推荐的新任务也在准备时生成完整摘要。扩展画幅建议条件契约核对/补齐并保存，缺结果阻止确认/规划，历史无标记记录兼容。
- [x] 将核对摘要作为独立指导字段传入短篇、提纲、批次、结语、审核和修订payload，复用editorialContext区分主题与原典模式；继续原有开场等规则，更新三个provider、共享指令和响应预算。
- [x] 补充缺摘要拒绝、cache只失效主题层、选中/重选/重启/失败恢复、错误摘要按原文修正、客户端伪造与短/长分镜契约回归；更新README及现行流程文档。
- [ ] 运行 pnpm typecheck、pnpm lint、pnpm test；使用 Node 24.22.1、pnpm 11.25.0，受控provider无真实推理费用。
- [ ] 执行修正后的服务E2E：候选理由/摘要→保存原文→摘要核对/修正→重启/确认→短/长分镜同时携带核对摘要与原文，保留跨主题复用。

## 验证与风险

本次不改UI或桌面壳，E2E以受控应用REST/队列/文件/SQLite贯通验证为必要证据；现有React静态渲染和观察循环测试验证候选契约不变。真实模型的边界识别与主题准确率不由mock证明，不进行未请求的付费模型基准。浏览器上轮已报 `Local browser use is disabled in Work settings`；如需要观察界面，SS首先做一次有界可行性探测，不改设置。

主要失败条件：主题渗入提取、no误丢故事、review误当no、旧cursor跳过未收录事件、并发重复付费或覆盖新缓存、取消后继续扫描、摘要被当原文。上述均须有直接回归证据；无外部依赖或数据迁移，旧缓存与历史任务不删除。

AR passed: no blocking architecture flaws

AR risk: non-low — persistent library semantics, paid matching, cross-theme concurrency, and source boundaries.
AR review round: 1; reviewer: new

实施细化：每个主题共享 flight 最多进行一次付费判断，先保存 yes/no/review 回执，下一轮才决定是否带原文复核；这样取消可在调用间停止，review 失败也不重付已完成判断。另一调用加入后重新核对自身尚缺的故事ID。命中部分已完成 yes 时立即返回，无需为了批次数量补齐。

SS 验证：Node 24.22.1 / pnpm 11.25.0，typecheck/lint 通过；核心缓存/章节/升级隔离45项、新增库与匹配20项、跨provider/档位11项、全部书籍/来源/画风回归28项通过（共104项）。服务级3项有界流程探测通过，覆盖重启换主题复用、选中制作原文、review重试及流取消共享。完整TT/最终ET仍待阶段执行。

SS milestone: `5efcd26` (`feat: build an incremental story library with cached theme matching`)；上述局部验证通过，正在独立CR，完整TT/ET尚未作为最终证据完成。

CR passed: no major findings

CR risk: non-low — persistent library semantics, paid matching, concurrent readers, and source boundaries.
CR review round: 1; reviewer: reused

TT：`pnpm test` 846/846 通过，约38.6秒，日志 `/tmp/shiqu-library-all-tests.log`。已通过 typecheck 与全局lint；新增最后两项JS回归另经定向eslint核对，无生产代码变更。未运行不相关的桌面原生测试或打包。

ET：复用当前最终实现已通过的 `pnpm exec node --experimental-strip-types --test tests/incremental-story-library.e2e.mjs`，3/3服务级用例，日志 `/tmp/shiqu-library-e2e-probe.log`。同一已验证实现未发生后续生产代码变更，无需重复执行。范围包括真实REST、SQLite、队列、FileMedia与受控provider；不声称浏览器或真实模型准确率验证。

VR passed: all acceptance criteria complete

独立验收逐项核对8项标准全部complete；完整终审原文见 `.docs/done/2026/11/01/incremental-story-library.md`。

VR risk: non-low — persistent catalog semantics, paid judgments, concurrent readers, and source integrity.
VR review round: 1; reviewer: reused

## !! 修正与当前状态

修正入口 `bed7af8`；原故事Git base继续保持 `e51429b85b30a505e6b58873a4cccc3709170360`，复审覆盖原故事与本轮修正。上文通过的AR/CR/VR和846项测试属于前一实现；摘要进入制作构成契约和持久化边界变化，相关AR已失效，须重新独立完整审查。只完成REQ/AP/E2E文档同步后进入AR，本轮按 `!!` 走至DD、不执行最终GC。

AR fixed: bounded matching batches and conditional output budgets resolve the capacity issue; rerun result passed.

AR risk: non-low — richer persistent receipts, source-bound verification checkpoints, provider output contracts, and production guidance.
AR review round: 2; reviewer: reused

AR passed: no blocking architecture flaws

两种模式摘要与历史兼容扩展已独立审查：新任务用内部briefRequired标记要求完整核对摘要；历史无标记且无brief记录维持旧流程。直接原典即使已保存original也须附上明确未核对的起始资料，source模式不另造主题理由；确认/规划采用标记与brief存在的叠加防线，重选保持来源绑定。随后用户明确“设局”是第一页背景，本轮仅明确已有共享开场规则，不改变已审架构。

AR risk: non-low — new-task checkpoint requirements and historical compatibility across direct and matched selection.
AR review round: 3; reviewer: reused


SS 修正验证：主题回执、候选brief、两种模式摘要检查点、生产与审核输入已实现；统一摘要并保留第一页背景规则。定向开场回归发现修订阶段缺少完整开场指令，补齐后8/8通过（`/tmp/shiqu-brief-opening.log`）。准备/确认及历史兼容61/61通过（`/tmp/shiqu-brief-intake.log`）；生产阶段先前定向57/57通过，后续共享开场补充另有8项覆盖。三provider schema/预算与缓存回归包含于新增5项。Node 24.22.1 / pnpm 11.25.0；typecheck、lint、diff检查通过。当前服务E2E10/10通过，覆盖直接原典、历史记录、摘要及理由核对/修正、重启、重选、缺结果防线、短篇与长篇；日志`/tmp/shiqu-brief-e2e.log`。完整TT与独立CR/VR待完成。

SS milestone: `83f87cb` (`fix: verify story synopses before storyboard production`)；修正源代码与测试已提交，独立CR及完整TT/最终ET进行中。

TT首次全量845/851通过，6项失败均来自旧缓存测试假定主题一批判断5篇；AR2已批准丰富摘要后每批4篇，实际及时返回4篇并保留第5篇未判断项。修订测试继续断言一次收录5篇，已匹配4篇逐次消费，第5篇从库内判断、不重扫，耗尽后才新提取1篇；完整缓存页并发用例先消费尾项再启动新扩展，仍验证读缓存不被模型调用阻塞。缓存/三provider/提示词33/33通过（`/tmp/shiqu-brief-cache-fix.log`）；不为填满旧5篇预期增加付费调用或等待。独立CR明确当前intake两种模式摘要保证与兼容非intake API边界，已在REQ/AP/development写明。用户开场原话同步为“第一页结合摘要，从原文中提取必要背景做开场”。完整TT重跑中。
