# 增量故事库与主题匹配

Git base: `e51429b85b30a505e6b58873a4cccc3709170360`

入口工作区有上一故事验证文档及 tests/reader-generation.test.mjs 的提示词断言修正，均属于已完成的连续查找前置工作；本故事仅将相关断言纳入，其他既有文档保留，不归入本故事提交。

风险 non-low：持久缓存语义、付费模型调用、跨主题并发、扫描位置及原文事实边界。

## 设计决定

保留现有 provider.suggestions 接口，增加内部 catalog 扫描用途：提取 prompt/schema 不含主题，仅提取完整故事及有结局的中性摘要。旧 scan 用途仍供已有直接 provider 调用，不将旧主题扫描结果或游标迁成完整通用库。复用按章节/输入预算的阅读块和可验证 source 定位。

重构 local-story-discovery 为两段：通用库状态只存 stories、cursor、pendingEvents、exhausted；提取命名空间由原文/范围/提取契约/模型/推理档位确定，不含主题。共享扩展只负责增加通用库，不依赖任何读者的排除项或匹配结果；一次扩展有新故事即停，最后一个读者离开后当前模型调用可保存缓存，但不继续扫描。

新增 ReaderProvider.matchStories 以及跨三个适配器的统一 JSON 契约，输入一批 story id/title/summary，输出逐条 yes/no/review。id绑定源范围与摘要内容；校验无缺项、额外项或重复项。review 再带已核对原文复核一次，仍不能确认则停止并报可重试错误，不缓存成 no。摘要判断每批最多16篇，原文复核逐篇且受输入预算限制。

主题判断缓存按库命名空间、规范化主题、匹配契约及有效模型/推理配置隔离；用独立共享锁读取最新缓存并合并，不因并发丢结果。正反判断都缓存；新故事使用内容ID增量判断。匹配所需的输入超预算时拒绝付费调用并保留库进度，不截断成误判。

先检查已入库故事，匹配后按原文识别顺序返回可见候选；不足时才扩展。保持单篇/旧批次数量契约、标题/来源去重、总故事先于小故事、真实查看者需求和选择并发栅栏。分镜链路只收到正常候选的原文引用，摘要不进入分镜事实输入。

## 执行任务

- [x] 定义 catalog 提取与主题判断契约；三种 provider 实现 matchStories，沿用 suggest 推理设置；catalog 解析强制完整摘要，旧 scan 解析兼容。
- [x] 重构本地扫描为主题无关的增量库，维持原文验证、未完事件、主/子故事、预算、共享取消和持久化；不信任旧主题游标。
- [x] 实现批量摘要匹配、原文复核、正反缓存与并发合并，优先复用库再扩展；明确错误与进度文案。
- [x] 更新已有缓存/主子故事/选章/provider契约测试，新增跨主题、未知复核、损坏缓存、失败恢复、并发与取消、原文分镜链路回归；更新README与流程说明。
- [x] 运行 pnpm typecheck、pnpm lint、pnpm test；使用 Node 24.22.1、pnpm 11.25.0，受控 provider 不使用真实凭证。
- [x] 执行 `.docs/tests/test-incremental-story-library.md` 对应的服务级端到端流程，验证新任务→两阶段发现→选中→原文准备→确认生成，及跨主题重启复用。

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
