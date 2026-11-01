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
- [x] 运行 pnpm typecheck、pnpm lint、pnpm test；使用 Node 24.22.1、pnpm 11.25.0，受控provider无真实推理费用。
- [x] 执行修正后的服务E2E：候选理由/摘要→保存原文→摘要核对/修正→重启/确认→短/长分镜同时携带核对摘要与原文，保留跨主题复用。

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

SS follow-up milestone: `18396bf` (`fix: preserve cached tails across bounded theme matching`)；缓存尾项/并发回归与用户明确的原文开场措辞已提交，33项定向回归和最新lint通过。

CR passed: no major findings

独立完整复审覆盖Git base `e51429b` 至 `18396bf`：理由/摘要缓存与通用库隔离、两种intake模式核对检查点、直选原典/重试/重选/重启、缺结果防线、历史与非intake兼容、三provider预算及schema、各编排/审核/修订阶段摘要与原文独立输入、第一页背景规则、尾项与并发回归均无阻塞问题。已审61项准备回归、10项服务E2E和最新33项定向用例；真实模型语义准确率不由受控推理证明。

CR risk: non-low — persistent rich receipts, source-bound verification, production guidance and compatibility boundaries.
CR review round: 2; reviewer: reused

TT最终：`pnpm test` 851/851通过，约38.9秒（`/tmp/shiqu-brief-all-tests-final.log`）；Node24.22.1/pnpm11.25.0，typecheck与最新lint通过，diff检查通过。首轮6项旧预期失败已修复，未弱化缓存/并发关键检查。

ET最终：`pnpm exec node --experimental-strip-types --test tests/incremental-story-library.e2e.mjs` 10/10通过（`/tmp/shiqu-brief-e2e-final.log`）。真实REST/SQLite/队列/文件，受控provider；包括原典直选与历史兼容、主题复用、不确定性、取消、核对/纠正、重启、重选、缺字段与客户端伪造。后续18396bf仅调整等义开场措辞及测试预期/文档，所覆盖的运行行为未改变，复用该证据；最新措辞另由三provider定向用例核对。没有UI/浏览器或付费真实模型质量验证，没有打包。

VR passed: all acceptance criteria complete

独立终验10项标准均complete；逐项证据与完整最终VR原文见`.docs/done/2026/11/01/incremental-story-library.md`。所有AP任务完成；本轮按!!到DD，不执行最终GC，保留两次SS里程碑及交付文档待提交。

VR risk: non-low — persistent rich receipts, source-bound synopsis verification, production guidance and compatibility boundaries.
VR review round: 2; reviewer: reused

## hook → summary 字段统一修正

入口 `18396bf`，原故事Git base仍为`e51429b85b30a505e6b58873a4cccc3709170360`，保留此前里程碑和未提交的本故事交付记录；不纳入既有continuous-story-discovery文档。该修正改变API、持久化及展示字段，前轮验收不证明本轮完成，重新独立AR/CR/VR。用户最新指令明确只将hook改为summary，历史文字原样搬迁，不触发模型补写。风险non-low。

正式Story、Plan/StoryDraft/Outline、studio API、编辑器与ZIP均使用summary；生成摘要上限与已有storyBrief统一1200字符。新intake路径的核对摘要在engine接收outline/draft时写入summary，防止模型另生成引子；按用户最新兜底要求，legacy无摘要且尚未开始编排时也先准备摘要；复用现有recommend调用及frames档位，缺摘要才新增这一必要调用。已有摘要不重复调用。现有第一页开场规则保持。

新增`0009_story_summary.sql`，不改旧迁移：rename stories.hook列；迁移任务document的plan/draft/storyboard.outline/revision.base.plan四个已知故事快照，已有非空summary优先，删除hook。非法JSON跳过而不是破坏整库；不更改状态、锁、进度或图片。生产job不存故事元信息，但图片version哈希包含整个plan：迁移前后按同一selectionSchema/inputVersion公式计算旧新version，对当前image/image-publish作业事务性更新version和派生ID，并按映射更新依赖；保留state/result/attempts/lease及所有已付费回执，旧的过期版本保持过期。目标ID冲突则回滚，不丢弃任一回执。script版本不变。

在同一升级门内迁移媒体reader/reader-cache内JSON对象的hook键：已有summary优先，无则保留旧文字；只改命中JSON，原子替换文件、不跟随symlink、不碰图片/原文文本，失败使SQL迁移回滚，已转换文件可在重试时幂等跳过。开库迁移在启动队列之前完成，常规GET无模型调用或临时兼容别名。使用迁移历史表一次性触发；离线导入在复制媒体后也经过openDatabase，获得相同迁移。

实际书库SS第一步先读环境/进程确认唯一目录与运行情况，使用SQLite backup一致性备份及保存待改JSON原字节到书库外，才允许修改。当前观察：72条任务、60个plan、11个outline、14个版本基线hook；3条published故事；4个reader比较结果JSON有hook，缓存无hook且有9篇中性summary。执行完成核对字段消失、summary文字保留、数量/图片/原文/进度不变。同步dev可能自动热重启，应在修改前完成备份；不擅自关闭用户桌面应用。

- [x] 有界探测：确认实际目录和迁移备份可用；探测in-app浏览器。如不可用，记录边界，以React静态渲染与服务E2E覆盖字段展示契约，不宣称视觉验收。
- [x] 修改Story/Plan、provider schema/指令、engine摘要复用、版本编辑和studio读写；更新所有现行消费端、导出和fixture。
- [x] 实现SQL及媒体JSON升级迁移，覆盖共存优先、幂等、失败重试与导入；保留历史SQL与外部依赖中无关hook名称。
- [x] 补迁移/新旧读写/元信息保护/ZIP/摘要复用/React展示回归，更新现行文档。
- [x] 运行typecheck、lint、完整TT与增量故事库服务E2E；保存真实证据。
- [x] 对已备份实际书库执行升级，核对SQLite和JSON数据、原文/图片/状态/版本数量及缓存保留。

E2E追加场景11/12；本轮不打包，不调用真实模型或改浏览器设置。单纯字段替换不引入新的创作功能、数据回填队列或自动付费阶段。

AR4初审通过，但随后发现图片作业version包含plan全部元数据，字段改名会使已付费未发布回执失配。因此暂停SS，追加上述作业身份/依赖迁移设计，返回AR复核；不以运行时hook别名解决。迁移E2E须覆盖已成功绘图但待发布的旧作业，升级后只发布已有回执，不再调用image。

用户新增兜底“如果开始分镜时没有摘要则先做一个”，本轮再次扩展前置检查：保留显式准备阶段的recommend；无摘要的旧式入口在plan worker内部先运行同一个准备函数，并在首次plan/outline调用前保存摘要，保持原有advance与确认交互。recommend统一附未核对起点，输出核对summary并保存；非intake不增加新确认界面，已confirmed任务不退回confirming。原文沿用现有prepareOriginal/original查找，不凭空为未知篇目补故事；不能核对原文则失败，不先编排再找摘要。已有历史plan/draft/outline摘要复用，不自动重做成品。engine接收新outline/draft时复用已核对brief摘要。测试需补齐fake generator的recommend与count响应，以验证真实新增前置调用；paid请求次数的旧断言随新顺序明确更新，不关闭失败防线。

AR passed: no blocking architecture flaws
AR risk: non-low — persisted-field and API changes, filesystem migration, import compatibility, and live-library upgrade safety.
AR review round: 4; reviewer: reused

AR passed: no blocking architecture flaws
AR risk: non-low — derived job identities, paid image receipts, dependency remapping and live-worker coordination.
AR review round: 5; reviewer: reused

SS独立前置探测已完成：桌面App未运行；已停止唯一开发服务（frontend3000/backend3002），lsof确认库无打开者。SQLite一致性备份及4份待改JSON原字节存于`/Users/esun/Library/Application Support/com.shiqu.desktop/library-backups/hook-to-summary-20261101T231623Z`；manifest记录146个JSON哈希与1144个二进制文件大小/mtime，库72任务/3故事/2118作业。浏览器重探仍返回`Local browser use is disabled in Work settings`。新兜底架构先返回AR6，源代码仍未修改；完成后恢复原dev端口。

AR passed: no blocking architecture flaws
AR risk: non-low — new generation ordering, paid-call prerequisites, checkpoint recovery and legacy entry points.
AR review round: 6; reviewer: reused

SS：所有运行时故事字段已从hook改为summary；仅历史迁移与升级测试保留旧名，第三方React/process hook无关。分镜前兜底统一复用prepareRecommendation，保存独立summary用量，已确认任务保持确认和选定幅数。原文来源失败现发生在付费分镜之前；相关历史测试改为断言零编排，原来“先付费目录再找原文”的预期失效。95项定向（含14服务E2E）通过；完整首轮857项中25项旧适配器fixture/顺序预期失败，已补齐受控摘要响应并验证相关46/46通过；正在最终全量回归。typecheck通过。

实际迁移：一致性备份后由同一openDatabase升级流程完成。72任务/3故事/2118作业数量不变，60份plan/11份outline/14份版本基线旧键删除；4份JSON迁移，828个图片作业派生ID/version及依赖重映射；已付费回执/状态/尝试次数保留，1144个二进制文件大小与mtime未变，9篇中性缓存摘要保留，旧文本没有标记成verified。逐表/逐文件比较报告`/tmp/shiqu-summary-live-migration.json`，开发服务3000/3002已恢复，GET书架200且可见故事只含summary，不含hook。浏览器仍禁用，不声称视觉检查。

SS milestone: `a41b0d6` (`refactor: replace story hooks with summaries and migrate saved data`)；源码、迁移和实际书库升级完成。随后补充两项既有提纲兜底E2E，16/16通过（`/tmp/shiqu-summary-e2e-final.log`）。CR3独立完整复审通过；原文、队列指纹与回执、媒体迁移重试、摘要前置和现有提纲恢复均无重大问题。

CR passed: no major findings
CR risk: non-low — persisted schema and API changes, filesystem upgrade, paid receipt identities, import compatibility and generation ordering.
CR review round: 3; reviewer: reused

TT第二轮856/857通过，唯一失败为既有development-access测试先删临时根目录、后关闭Vite导致ENOTEMPTY并遗留端口，不属于生产功能失败。已将测试清理改成先关闭后端与Vite再删除目录，断言未放宽；单独2/2通过（`/tmp/shiqu-summary-dev-access-fixed.log`），最终全量重跑中。

CR passed: no major findings
CR risk: non-low — story retains schema, migration and paid-work boundaries; this followup changes test lifecycle and recovery coverage only.
CR review round: 4; reviewer: reused

TT最终`pnpm test`857/857通过，约43.7秒（`/tmp/shiqu-summary-all-tests-complete.log`）；typecheck与最新lint通过，diff检查通过。ET最终16/16服务级用例通过（`/tmp/shiqu-summary-e2e-final.log`），含已有提纲缺摘要与未核对brief的恢复，保留前20幅、不重做提纲。迁移5项、导入旧库用例、ZIP/React静态渲染与受控provider均有直接回归。浏览器因设置禁用未做视觉验收，真实模型语义准确率未实测。

用户询问《黛玉剪香囊》时实际读取确认：其summary是旧hook迁移的两句引子，尚无verified制作摘要。本轮字段迁移保留旧文字，不声称给历史成品语义补全；未来新编排入口缺摘要时才先准备。

SS follow-up milestone: `c12499b` (`test: verify summary recovery and close development fixtures safely`)；仅新增既有提纲恢复用例与修正测试清理顺序，CR4已复核，最终TT/ET通过。

VR passed: all acceptance criteria complete

独立终验14项全部complete；完整最终VR原文保存在本故事DD。用户最新问题已明确回答：黛玉剪香囊的summary仍为迁移旧引子，未语义补全，字段迁移不冒充完成核对。本轮完成到DD，无最终GC/push，保留里程碑与交付文档待提交；既有continuous-story-discovery文档保持原状。

VR risk: non-low — persistent catalog and API contracts, source-bound synopsis preparation, filesystem migration, paid receipt identities and live-library preservation.
VR review round: 3; reviewer: reused

## 按原文编排、摘要只作审核参考

当前修正入口`c12499b`，原故事base仍为`e51429b85b30a505e6b58873a4cccc3709170360`。已有未提交交付文档属本故事，continuous-story-discovery文档不纳入。风险non-low：三个provider的内部输入契约与阶段职责协调变化，但不改持久化/schema、缓存键、配置或付费调用顺序。重新独立AR/CR/VR；此前857项及16服务E2E属于上一输入契约。

删除plan/outline/batch/reflection/candidates/repair中的storyBrief及匹配理由，保留现有未核对brief前置校验。批次传入outline时只去掉summary，保留节点、人物与其余元数据；结语传draft时、修订传plan/outline时同样去掉summary，避免嵌套回流。统一小型元数据投影函数不修改原对象。审核保留完整storyBrief、plan与outline，先原文独立核查，再借摘要发现范围/关键阶段/结局遗漏，冲突按原文裁决，不能用摘要改写分镜事实。

共享指令拆分原文编排和摘要审核；准备推荐仍负责生成/核对摘要及原文幅数估算，不套审核指令。第一页只据原文提取必要背景。元数据summary继续保留在输出schema和已保存故事中，只作归档/审核，engine现有核对摘要覆盖逻辑不改；无需新的输出schema或数据迁移。标题结语按原文、实际分镜及既有editorialContext选择有据角度。已有提纲继续使用已付费节点，不自动重新编排。

- [x] 修改共享编排/开场/审核指令，删除“先参照摘要再细化”和摘要指导主题分幅的冲突规则。
- [x] 在三个短篇provider及共享outline/batch/reflection/repair输入边界去掉独立和嵌套摘要；保持审核可读摘要及未核对brief拒绝规则，不修改保存记录。
- [x] 更新三provider与服务E2E回归：编排请求不含唯一摘要/理由标记，批次/结语/修订无嵌套summary；审核有完整摘要，原文和保存元数据保持，短篇/长篇及主题/原典均覆盖。
- [x] 更新README、开发/使用指南和流程说明，明确当前阶段分工；历史里程碑保留。
- [x] 运行typecheck、lint、完整TT与现有增量故事库服务E2E，记录实际证据；不额外付费重跑模型或打包。

本轮无UI改动，无需重开禁用的浏览器；原《黛玉剪香囊》和暂停的实跑对照版保持原数据。

AR passed: no blocking architecture flaws

独立AR7核查阶段隔离、不可变去summary投影及三provider前置拒绝防线；准备/保存/缓存/schema/付费顺序与已有故事保持，无迁移或额外付费重跑。输出summary只作归档，审核先原文再摘要查漏；原文优先。

AR risk: non-low — coordinated provider input contracts, production/review responsibilities and paid-call validation boundaries.
AR review round: 7; reviewer: reused

SS：原文编排/摘要审核职责及输入投影已落实；三provider短长篇、原典/主题、审核保留、前置拒绝和不可变保存共69项定向（含16服务E2E）通过，日志`/tmp/shiqu-source-focused.log`。typecheck和lint通过；首轮发现准备提示词残留单元素section，已修正并重新验证。尚待完整TT和独立CR/VR。

SS milestone: `3b4c6e9` (`fix: plan storyboards from originals and reserve synopses for review`)。本轮只改生成/审核职责和请求投影，69项定向、typecheck/lint通过，不修改数据或真实故事。

CR passed: no major findings

独立CR5完整覆盖`e51429b..3b4c6e9`及本故事工作区，排除continuous-story-discovery文档。三provider与共享阶段无摘要回流、原对象不变、原文和其余元数据保留；审核原文优先，未核对guard和engine摘要保存保持，已有缓存/迁移/回执审查仍有效。完整TT待执行，不声明真实模型质量提升或浏览器验证。

CR risk: non-low — coordinated provider contracts, production/review isolation, source-bound checkpoints and the story’s persistent-data and paid-receipt boundaries.
CR review round: 5; reviewer: reused

TT最终：`pnpm test` 857/857通过，约38.7秒（`/tmp/shiqu-source-all-tests.log`）。ET：`pnpm exec node --experimental-strip-types --test tests/incremental-story-library.e2e.mjs` 16/16通过（`/tmp/shiqu-source-e2e.log`）。typecheck/lint通过（`/tmp/shiqu-source-typecheck.log`、`/tmp/shiqu-source-lint.log`），diff检查通过。三provider捕获受控请求证实编排无独立/嵌套摘要，审核保留，原文/保存对象不变；不证明真实模型质量提升，无额外付费推理/浏览器/打包。

VR passed: all acceptance criteria complete

独立VR4逐项确认14项验收全部complete，最新编排/开场/验证标准已勾选。完整原文保存于本故事DD；CR5、最终TT857/857和ET16/16有效。按本轮修正完成到DD，无最终GC或push，保留SS里程碑`3b4c6e9`及本故事待提交收尾文档，无关continuous-story-discovery文档未纳入。

VR risk: non-low — coordinated provider contracts, production/review isolation, source-bound preparation, persistent migrations and paid-receipt preservation.
VR review round: 4; reviewer: reused


用户后续授权《黛玉剪香囊》再次比较：源码未变，在隔离检查点复用原文/章节、制作设置及同一355字符核对摘要，以gpt-6.1-sol执行3次文字调用（plan/reflection/review），16幅、审核一次通过、0修订；编排请求不含摘要，审核有摘要，三版对照共48条配文。原版和上一份对照版不变，新副本暂停且无图片/语音、未增加生产作业。验证存于本地备份目录`daiyu-source-comparison-20261101T235102Z`，不纳入Git。该实测为单篇观察，不改变最终VR或宣称普遍质量提升。

用户“DD GC”收尾：DD保留完整VR4原文并注明后续实测的时序；沿用源码`3b4c6e9`的完整TT/ET/typecheck/lint及CR/VR证据，仅提交本故事DD、AP、REQ和E2E执行记录四文档。既有continuous-story-discovery改动保持，不打包或push。
