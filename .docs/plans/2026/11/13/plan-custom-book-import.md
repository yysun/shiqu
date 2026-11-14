# 自备书籍导入为本地书 · 实现计划

需求见 [req-custom-book-import](../../../../reqs/2026/11/13/req-custom-book-import.md)，验收用例见 [test-custom-book-import](../../../../tests/test-custom-book-import.md)。Git 基点：`c0866de`（main，2026-11-14 已 rebase）。

## 目标与边界

导入书在加载后得到与内置书相同的 `LocalBook`（章节、段落、版次、整书输入）。之后的目录、原文核对、按章节提取、故事卡检索、向量建库和制作全部走现有生产实现。新增代码只做四件事：导入快照、确定结构、生成并保存故事卡、管理导入书目录。

```mermaid
flowchart LR
  A[文件 / URL] -->|快照+回执| B[books/&lt;id&gt;/originals]
  B -->|解析+自动切分| C[待确认结构]
  C -->|用户调整并确认| D[manifest: structure + edition]
  D -->|LocalBooks.book| E[LocalBook]
  E --> F[按章节 / 原文核对 / 制作]
  E -->|逐章抽取，可续跑| G[books/&lt;id&gt;/cards.json]
  G -->|LocalStorySearch| H[按故事 / 按主题]
  G -->|可选| I[story-card-vectors.sqlite]
```

## 关键决定

1. **存储：放在书库目录下的文件里，不改数据库结构。** 每本书一个目录 `<书库>/books/<bookId>/`，内容如下：
   - `originals/001.<ext>`…：原始字节，权限 0600，只写一次。
   - `manifest.json`（`version:1`，zod 校验）：书名、作者、年代、来源说明、授权说明、版权确认时间；每个原件的 `{file,sha256,size,originalName|sourceUrl,contentType,encoding,fetchedAt}`；另有 `snapshotHash`、`parserVersion`、`structure`（章节起点、标题、排除标记）、`structureHash`、`edition`、`status`（`structuring|ready`）和质量标记摘要。
   - `cards.json`：沿用内置故事卡的 `storyCardsSchema`（`version:1,bookId,edition,cards`）。
   - `card-progress.json`：包含当前 `edition`；每章状态（`done|failed|pending`）和失败原因、生成器身份（提供方、模型、提示版本）、累计调用次数和令牌数，以及本书生成任务写入的抽取缓存键。所有写入都先比较运行时捕获的 edition 与当前清单；不一致时拒绝写入。
   - `card-cache-keys.json`：独立于可重建的进度文件，保存本书所有由生成任务登记的缓存键。确认书目 ready 时先创建空索引，每个键必须在发出对应 provider 请求前原子登记。ready 书缺少索引或索引损坏都视为数据损坏；删除和替换从该文件读取缓存键，文件损坏或缓存删除失败时停止破坏性操作并报告错误，不把缺失进度当作空键列表。

   每本书最多 100 个来源，原始字节合计最多 64 MiB；单个文件或网页仍最多 12 MB。单本 EPUB 解压不超过 64 MiB，所有 EPUB 合计解压不超过 256 MiB。整次 URL 导入共用 5 分钟截止时间，单页 30 秒。

   暂存目录 `.book-import-<随机>`、待删目录 `.book-delete-<id>` 和替换备份 `.book-replace-<id>-<随机>` 放在**书库根目录**，不放在 `books/` 里面。原因是 `server/library-backup.ts` 的 `runtimeFile` 只在顶层排除文件。备份会递归包含 `books/`，升级不会改动它。`shiqu.sqlite` 不变，所以不需要 `drizzle/` 迁移，也不改 `db/library-format.json`。旧版应用会忽略 `books/`；用导入书做的故事已经保存了原文，旧版仍能阅读。
   *备选：* 新建 `imported_books` 表。好处是有事务，代价是要写迁移、准备回滚备份并更新 `latestMigration`。原文无论如何都得存成文件，所以不采用。

2. **书目 ID 与选择。** 导入书 ID 为 `my-` 加 16 位随机十六进制。新建故事时写入 `selection.bookId=<id>` 和 `customBook=<书名快照>`，服务端用书目里的书名覆盖 `customBook`。在 `lib/reader-books.ts` 新增 `isImportedBookId()` 和 `selectionBookTitle()`。需要改的调用点分两类：
   - **显示和提示词位置**改用 `selectionBookTitle()`：`lib/reader-gemini.ts:56`、`lib/reader-engine.ts:65`、`lib/reader-generation-contract.ts:46`、`lib/reader-source.ts:29`、`lib/reader-png.ts:22`、`server/local-story-discovery.ts:243`、`server/reader-intake.ts:38`（要求有书名）、`client/ui/Reader.tsx` 的 `bookName`、`client/ui/StoryExtractionContext.tsx`、`client/ui/StoryReselection.tsx`（书已删除时给出提示）。
   - **身份键位置保持不变**：`lib/reader-source-storage.ts:14`、`lib/reader-suggestions.ts:25`、`server/book-image-reference.ts:18`。导入书 ID 本身唯一，即使导入书与内置书同名，也不会共用缓存或参考图。

   `bookId:'other'` 的语义保持不变。

3. **加载与失败即关闭。** 新模块 `server/imported-books.ts` 管理 `books/`：列出、读取并校验清单，提供清单 stamp。`LocalBooks` 的改动如下：
   - 增加书库目录参数。
   - `localBookId()` 只要看到 `isImportedBookId()` 格式的 ID 就交给导入书目解析，**即使书不存在也不返回 `undefined`**。书已删除或不可用时，抛出 404 或 503（「这本书已删除或不可用」），避免 `server/local-generation.ts` 回退到模型或网页的未核对原文。
   - 导入书的缓存键由 `id + 清单 stamp` 组成，加载失败的 Promise 不缓存。确认结构、替换和删除时，主动清除该书的缓存，并通知 `LocalStorySearch` 清除它的卡片缓存。
   - 加载时的校验与内置书相同：`realpath` 必须在书目录内，逐个核对原件的 SHA-256，用清单记录的 `parserVersion` 和结构重新解析，得到的版次必须等于 `manifest.edition`。
   - 按文件导入的书，`LocalBook.url` 设为 `local-import:<bookId>`，`provider` 设为「用户导入 · 原文件名」；按 URL 导入的书，取第一个 URL 和其主机名。这样 `reader-source-storage.ts` 和 `StorySource.tsx` 不会拿到空值。

   所有汇总列表都**逐书捕获错误**，不让一本坏书拖垮整页，出错的书单独标为不可用。涉及的位置有：`semanticIndexBooks()`（`local-books.ts:74` 的 `Promise.all`）、嵌入设置 `lib/reader-api.ts:106-111`（含 `catalog`）、导入书目和内容 API。

4. **解析与结构（`server/book-import-parse.ts`，纯函数）。**
   - **解码。** 先用 UTF-8 严格解码（`fatal:true`），失败后依次试 GB18030 和 Big5。两种都能解出且可读汉字比例相近时，报「无法判断编码」，让用户指定。
   - **正文块。** TXT 按行；HTML 用 `htmlparser2` 取 `body`，跳过 `script/style/nav/header/footer`。EPUB 用 `fflate` 解析，限制如下：
     - 解压前读取中央目录，按 `originalSize` 判断，单本 EPUB 总解压量不超过 64 MiB，条目不超过 2,000 个，单条压缩比不超过 100，OPF/XHTML 单个不超过 8 MB；同一次导入的多个 EPUB 解压总量不超过 256 MiB；
     - `originalSize` 来自文件本身，不可信，所以解压时还要累计实际输出的字节数，一超出上限就中止；
     - 归一化包内 href，拒绝 `..`、绝对路径和反斜杠；
     - 含 `META-INF/encryption.xml` 或 `rights.xml` 的视为 DRM，拒绝导入。
   - **自动切分。** EPUB 按 spine 和导航目录切；HTML 按 `h1–h3` 切；TXT 用通用标题规则（`第…[回章卷节篇]`、`卷…`，参照 `additionalBookSpecs`）。都没切出章节时，按约 8,000 字一段切成「第 N 部分」。
   - **段落。** 复用 `localLines()`，每段用 `hasSourceAnomaly()` 设置 `unreadable` 标记。另外标出空章节、过短章节和缺文标记。
   - **编号。** 章节 ID 为 `<prefix>-NNN`（prefix 取书 ID 后 8 位），段落 ID 为 `<sectionId>-NNNN`。每章另存不含标题的原文段落指纹。`edition = sha256(snapshotHash, parserVersion, structureHash)`。解析器行为一旦变化就升级 `parserVersion`，旧版本保持可读，这是接受的维护成本。
   - **结构编辑**只记录「起点块序号、标题、排除」，正文始终从快照重新解析。确认结构时检查整书上限：不超过 300 万字、2,000 章（已定决策 4）。
   - **适用范围。** 现有的原文质量和范围规则（`local-source-quality.ts`、`local-source-ranges.ts:39` 要求中文标点）面向中文古典文本。无标点、混有假名、希腊或西里尔字母的文本会被标记，按章节提取和故事卡生成可能失败。确认页需要预先告知，任务 0 也要测量这一点。

5. **上传与 URL 抓取。**
   - **上传。** `server/http.ts` 在路由前缓冲请求体，上限 13 MiB。因此**每次请求只传一个文件，单文件不超过 12 MB**。先建导入草稿，再逐个追加原件，不改 `http.ts`。上传路由单独读取原始字节，不经过 4 KB 的 `body()`。
   - **URL 抓取（`server/book-import-fetch.ts`）。**
     - 只允许 `http/https`。
     - 用 `node:https/http` 的 `lookup` 钩子做解析，拒绝回环、私网、链路本地、CGNAT、组播、IPv4 映射的 IPv6 和 `host.docker.internal`；连接时固定使用检查过的 IP，并设置 `servername`，防止 DNS 重绑定。
     - 最多手动跟随 5 次重定向，每一跳都重新检查。
     - 单页上限 12 MB，超时 30 秒，只接受 HTML、纯文本和 EPUB。
     - 一次导入最多 100 个来源、合计原始字节 64 MiB。所有 URL 共用 5 分钟截止时间，每跳也受单页 30 秒上限约束。
     - User-Agent 用通用名称。
   - **远程访问。** 导入和故事卡生成与故事制作一样，对已授权的局域网或远程访问开放。地址检查在服务端完成，与请求从哪里发起无关。

6. **故事卡生成：复用生产提供方，使用专用卡片输出约定。** 可行性探针见任务 0：假提供方的 chapter-scoped 搜索可以收束，但 Codex 实测中 `discoverLocalStories()` 在本章多轮查找后可能返回无进展错误；现有 catalog prompt 还明确生成不剧透短简介，不满足包含起因、行动、结果的卡片梗概。不要把该交互搜索循环当作整书卡片生成器，也不另建模型调用实现。
   1. 在共享本地输入约定（`lib/reader-local-contract.ts`）增加 `purpose:'cards'`、卡片 prompt 和 JSON schema；扩展 `ReaderProvider.suggestions()` 的生产实现，让该 purpose 使用现有提供方设置、超时、日志和调用实现。输出每张卡的 `title/description/source`，其中 `description` 必须用简体中文简述起因、行动和结果，不超过 180 字。内置书的 `catalog` 和现有 discovery prompt 保持不变。扩展 `requestTokens()`、`buildReadingPlan()`、`readingPlan()` 和计划缓存键，使 cards 窗口按实际格式化的 cards prompt、payload 和 schema 计数；窗口计划及费用预估必须使用同一 `cards` 输入，不得沿用 scan 的长度或 output schema。计数仍是本地 o200k 容量估算，界面标为估算值；测试断言每个计划请求按这一 cards 预算上限。
   2. 构造 `selection={bookId,customBook:书名,theme:'原典故事',discovery:{mode:'auto'},discoverySources:[窗口章节范围]}`。章节范围从 `indexBookContents(book,true).entries` 中取。以每个章节为窗口起点，最多再带上紧邻的下一章；最后一章只带自身。**先调用 `selectedChapterScope()` 收窄到这个一至两章的窗口**，避免每轮都读整本书，也让章末故事可核对下一章的结局。
   3. 用 `readingPlan(..., purpose:'cards')` 按 `defaultReadingLimits` 建立窗口内输入计划。计划只返回一个块时生成一个输入窗；如分成多个块，对相邻块生成重叠输入窗（合并不超过 `whole` 上限时），否则逐块处理。每个输入窗调用 `ReaderProvider.suggestions()` 的 cards purpose，通过 `StoryDiscoveryCache.shared()` 缓存提供方响应；缓存键包含书 ID、edition、提供方、模型、prompt/schema 版本和窗口出处。取消后重试复用已完成的输入窗，不依赖模型宣布扫描结束。
   4. 对每张返回卡检查 schema、摘要长度、出处能在当前 `LocalBook` 定位且来源单元都落在本窗口；拒绝不完整或越界出处。重叠窗口的卡按规范化标题及出处重叠去重，再用 `source` 对应本地原文重新构造检索文本。
   5. 每章所有窗口处理完成后一次写入并校验 `cards.json` 与进度；失败窗口记明原因，可单独重试。窗口缓存键写入 `card-progress.json`，删除书时逐键清理；为此给 `StoryDiscoveryCache` 增加 `remove(key)`，同时给 `MediaStore`（`lib/services.ts`）增加 `delete`，并在文件存储中实现。
   - **跨章故事。** 每轮带入当前章及下一章，所以章末事件能在相邻窗口中补全；重叠窗口和相邻起点窗口会产生重复候选，按规范化标题及出处范围去重。超过两章才完成的故事不会作为完整卡片保存，并记入失败/未覆盖提示，不得截断后冒充完整故事。
   - **调度。** 整个书库同一时间只运行一个故事卡任务，用 `AbortController` 取消，进度通过事件流推送（同 `embedding-index`）。取消信号必须从 `ReaderProvider.suggestions()` 传入实际 provider request：Codex/Claude runner 收到 signal 后杀掉当前子进程，Gemini/OpenAI/DeepSeek transport 收到 signal 后中止 fetch；各路径等待请求 teardown 后才报告取消。调用 `StoryDiscoveryCache.shared()` 时 observer 设置 `drain:true`，保证唯一订阅者离开后仍等待共享工作结束；测试覆盖该 drain 语义。取消后不派发下个窗口、不提交当前未完成窗口缓存或卡片；替换/删除先取消并等待任务 Promise settle，再改动快照。进程退出后，下次读取时显示「已暂停」，不会自动续跑。任务固定当前 edition；更新进度或卡片前重新读取清单并比较 edition，避免过期任务覆盖新版本。
   - **预估。** 输入令牌按收窄章节及窗口输入，用与实际请求相同的 cards purpose、格式化 prompt、payload 和 schema 经 `readingTokens()` 累加；调用次数按未命中窗口缓存的数量精确估算；耗时用 `story-discovery-metrics` 的历史中位数，没有数据时用默认值。界面注明令牌数是本地 tokenizer 估算，不等同于提供方账单用量。只有提供方设置里有单价时才显示费用。

7. **检索接入。** `LocalStorySearch` 增加资源钩子 `importedCards(book)`，读取 `books/<id>/cards.json`，与内置卡一样在运行时从原文构造检索文本。`indexableCards()`、`snapshotFor()` 和 `passages()` 都把导入卡当作内置卡处理。卡片缓存按「书对象 + 文件 stamp」失效，生成到一半也能搜到已完成的卡。`installStoryIndex()` 不接受导入书的外部索引。

8. **删除与重新导入。**
   - **删除。** 把书目录改名移到书库根目录下的 `.book-delete-<id>`，清除 `LocalBooks` 和检索缓存，调用新增的 `StoryCardEmbeddingStore.removeBook(id)`，从 `card-cache-keys.json` 读取并删除生成器缓存键；进度文件损坏不影响键登记，索引损坏或单键清理失败时禁止报告删除成功，最后递归删除目录。若中途崩溃，下次启动列目录时会清理残留的 `.book-delete-*`，以及超过 24 小时未完成的 `.book-import-*` 草稿。孤立向量的判定条件是：书的 ID 以 `my-` 开头，并且 `books/<id>` 目录已不存在。满足条件的向量才删除；书目录存在、只是加载或校验失败时，向量保留。
   - **进行中的任务。** 删除前先取消该书的故事卡任务。已在制作中的故事继续使用已保存的原文；重选或续找时明确报「书已删除」。
   - **重新导入。** 新快照在暂存目录中完成解析和校验。替换前先取消并等待该书的卡片任务，读取独立键索引并清理旧缓存；清理失败时保留旧版书和替换草稿，不执行替换。若 `snapshotHash` 不变且沿用原结构，版次不变，故事卡和向量继续有效。版次变化时，按不含标题的原文段落指纹匹配新旧章节；仅当旧卡涉及的所有章节内容均完全相同且各自唯一时，按段落序号映射出处、更新 edition 并保留该卡。其他章节卡设为待生成；旧向量不沿用，需重建。所有卡片和进度写入仍进行 edition 检查。
   - **崩溃恢复。** 替换不能复用表示“用户已请求删除”的 `.book-delete-*`。先把旧书改名为书库根目录的 `.book-replace-<id>-<随机>`，再把已完整校验的暂存书改名为 `books/<id>`，最后重新校验新书并删除备份。启动清理必须先处理替换备份：目标书完整有效时删除旧备份；目标缺失或无效时，先验证备份，再恢复旧书；需要恢复但备份无效时，保留目录并只将该 ID 标记为不可用，不阻塞其他书的列表或读取。这样在每个 rename 边界退出都不会把唯一可用版本清掉。

9. **「其他」旧路径（已定决策 1）。** `reader-production.ts` 的保存任务搜索、`Reader.tsx` 的 `savedMaterials` 和 `StoryDiscoveryForm` 的外部结果都不改，已保存的 `other` 任务行为不变。新建故事时，「其他」芯片以「导入这本书」为主操作，「不导入，直接请模型推荐」为次操作；后者沿用现有路径，候选标注「未核对原文」。

10. **版权。**
    - 导入接口要求 `acceptRights:true`，并在清单中记录确认时间。
    - 导入书不进入 `data/library`、npm 包、官方资源或任何上传路径。
    - `story-export.ts` 的 `署名与转载.txt` 写入来源和授权说明，并注明「原文为用户导入」。
    - `pnpm export:story` 遇到没有授权说明的导入书故事时拒绝导出（已定决策 3）。

## 任务

- [x] 0. **可行性探针（已完成，决定改用专用卡片输出约定）。** 在隔离内存缓存和仓库自带公版文本上执行：
  - **假提供方。** `三国演义` 前三回经 `selectedChapterScope()` 收窄后调用 `discoverLocalStories()`，6 次 mock 提供方调用都只包含当前章节，三个章节都在第二轮空批次结束，出处全部可定位。
  - **真实提供方。** 使用已登录的 Codex CLI 订阅（`gpt-6-luna`），对《水浒传》第二回（约 13,940 字）试跑。前 5 次调用共接受 10 则候选；第 6 次返回 0 则但未标记 `blockComplete`，生产搜索循环以“未给出新故事，也未确认本段已读完”失败，未能稳定结束。单次日志的输入量约 21,948–25,832 tokens、时长约 3.9–6.5 秒。现有 `localCatalogPrompt` 明确要求不生成梗概，只生成不剧透简介，不能满足起因/行动/结果验收。

  **决定：** 拒绝原循环方案。按决定 6 改为由同一个 `ReaderProvider.suggestions()` 生产实现执行专用 cards purpose；先把当前章与下一章收窄为 chapter window，再按 reading-plan 窗口调用、缓存并核对出处。相邻窗口重叠捕获章末故事并按出处去重。超过两个章节的事件不作为完整卡片保存。真实模型候选未完成逐条质量审阅，接收标准转为自动 schema/出处核对和隔离库人工验收；不得宣称本次探针已证明卡片摘要质量。
- [x] 1. `lib/reader-books.ts`：实现 `isImportedBookId` 和 `selectionBookTitle`，按决定 2 只替换显示和提示词位置。
- [x] 2. `server/book-import-parse.ts`：解码、三种格式的正文块（含 EPUB 限制）、自动切分、结构应用、编号、质量标记、版次。
- [x] 3. `server/book-import-fetch.ts`：按决定 5 实现安全抓取，返回原始字节和回执。
- [x] 4. `server/imported-books.ts`：草稿创建与追加原件、清单、列出与读取、确认结构、替换、删除、启动时清理残留，所有写入原子完成，暂存目录放在书库根目录。启动时先恢复 `.book-replace-<id>-<随机>`：目标书完整有效则清除旧备份；目标缺失或无效则验证并恢复旧书；需要恢复但备份损坏时保留目录，将该 ID 单独标为不可用，不阻塞其他书。`server/library-backup.ts` 的 `runtimeFile` 排除 `.book-import-`、`.book-delete-` 和 `.book-replace-`。
- [x] 5. `server/local-books.ts`：增加书库目录参数，导入书失败即关闭（决定 3），缓存键与清除，`semanticIndexBooks()` 包含导入书并逐书捕获错误。更新 `server/app.ts` 的构造。
- [x] 6. `server/local-story-search.ts`：`importedCards` 钩子、按 stamp 失效的缓存、对外的缓存清除接口；`applicationStorySearch()` 接入；`installStoryIndex()` 拒绝导入书。`server/story-card-embeddings.ts`：增加 `removeBook()`。`server/story-discovery-cache.ts`：增加 `remove(key)`。`lib/services.ts` 的 `MediaStore` 和文件存储：增加 `delete`。
- [x] 7. `server/imported-book-cards.ts`：预估、按决定 6 逐章生成、取消、暂停状态、失败章节重试、原子写入 `cards.json` 和 `card-progress.json`；在首次异步预检前同步占用唯一任务槽，取消等待整个预检和任务 Promise 收束，替换/删除期间拒绝启动新任务；每个 cache key 在请求前写入独立的 `card-cache-keys.json`，提供校验后的清理键读取和索引清除。
- [x] 8. `lib/reader-api.ts`，沿用现有书库鉴权：
  - 替换和删除使用独立缓存键索引；缓存清理失败时保留当前书目或不报告完成，不吞掉错误。删除和替换都测试索引损坏、单键缓存删除失败；损坏的进度文件不能把有效缓存键隐藏。
  - 新增路由：`GET books/imported`；`POST books/imports`（建草稿，可附 `{urls}`）；`POST books/imports/:id/files`（单文件原始字节，最大 12 MB）；`GET|PUT books/imported/:id/structure`；`POST …/confirm`；`GET …/cards/estimate`；`POST …/cards`（事件流）；`POST …/cards/cancel`；`POST …/replace`；`DELETE books/imported/:id`。
  - 修改：`embedding-index` 的白名单（`:126`）和嵌入设置的 `catalog`（`:111`）改为「内置书加已确认的导入书」；所有汇总列表逐书捕获错误。
- [x] 9. 客户端：
  - 新增 `client/ui/BookImport.tsx`：来源、版权确认、结构检查与调整、故事卡预估与进度。
  - `Reader.tsx`：书目合并导入书并显示状态，`StoryCardSearch books=` 包含导入书（`:664,690`）。
  - `StoryDiscoveryForm.tsx`：把导入书当作本地书处理，「其他」芯片按决定 9 改。
  - `StoryEmbeddingSettings.tsx`：列出导入书。
  - 删除和重新导入前显示确认。
  - 在 `pnpm desktop:preview` 中走查桌面和手机宽度。
- [x] 10. `server/story-export.ts` 和导出脚本：附来源与授权说明，按已定决策 3 处理：应用内导出始终附说明，`pnpm export:story` 在没有授权说明时拒绝导出。
- [x] 11. CLI（`server/headless-cli.ts`）：
  - **分派。** 把 `:103-104` 的 `books` 兜底分支改为只处理无动作或未知动作；`catalog`、`books` 的列表经应用 API 合并导入书。
  - **新增命令**，全部经 `createApplication`/`api()` 执行，先完成 `ensureLibraryReady()`：
    - `books imported`
    - `books import <文件|URL>... --title … [--author --era --source-note --license] --accept-rights`
    - `books structure <id> [--input <json>]`
    - `books confirm <id>`
    - `books cards <id> --estimate`
    - `books cards <id> [--retry-failed]`（前台运行，Ctrl-C 取消，可续跑）
    - `books index <id>`
    - `books reimport <id> <文件|URL>...`
    - `books remove <id> --yes`
  - **免初始化的搜索路径**（`:133-147` 的 `books search` 和 `index-import`）保持不打开书库，遇到导入书 ID 时报错，提示改用应用内搜索或先打开书库。
  - **同步**帮助、`skills/shiqu/SKILL.md` 和 `.docs/use-as-skill.md` 的示例。
- [x] 12. 在 `tests/manifest.json` 登记测试，包括 `covers` 和 `tests/fixtures/imported-books/*` 的归属：
  - 新增：
    - `tests/book-import-parse.test.mjs`：编码（含 Big5 和编码难以判断的情况）、三种格式、DRM、单本及全书 EPUB 解压上限、越界路径、自动切分、结构调整、编号可复现、质量标记、版次。
    - `tests/book-import-fetch.test.mjs`：私网地址、重定向、DNS 重绑定、单页与整次导入大小和时限、内容类型（模拟 DNS 和 fetch）。
    - `tests/imported-books.test.mjs`：创建、确认、加载、篡改与清单版本、来源数量/总字节/EPUB 总展开字节上限、删除后失败即关闭不回退网页原文、缓存失效、重新导入时版次保留与变化、唯一未变章节卡及出处重绑、替换崩溃恢复的每个 rename 边界、残留清理、`LocalBooks.resolve/storyOriginal`。
    - `tests/imported-book-cards.test.mjs`：预估使用 cards purpose、实际格式化 prompt/payload/schema，且任何窗口都不超过预算；假提供方通过生产 `ReaderProvider.suggestions()` 的 cards purpose 逐窗口生成，确认只送入当前章及其紧邻下一章；summary 输出包含起因/行动/结果，出处定位正确；相邻窗口重复去重；取消会 abort 当前 Codex/Claude 子进程或 provider fetch、等待 teardown、不提交未完成窗口，`StoryDiscoveryCache.shared()` 使用 `drain:true` 等待共享工作结束，续跑复用已完成窗口；重启后显示暂停；失败重试；edition 过期写入被拒绝；替换前取消并等待；版次变化后仅保留唯一未变章节的卡、旧向量失效；`LocalStorySearch` 的按故事和按主题检索；删除时清理缓存键。
    - `tests/imported-books-api.test.mjs`：路由、单文件上限、鉴权、事件流、一本坏书不影响汇总列表；进度损坏时从独立缓存键索引清理；索引损坏或缓存删除失败时，删除和替换均保留旧书并返回失败。
  - 扩展：
    - `tests/headless-cli.test.mjs`、`tests/cli-skill.test.mjs`；
    - `tests/story-card-embeddings.test.mjs`：`removeBook`；
    - `tests/story-discovery-cache.test.mjs`：`remove`；
    - `tests/local-story-search.test.mjs`；
    - `tests/library-maintenance.test.mjs`：备份恢复包含 `books/`，排除根目录的暂存目录；
    - 表单测试：导入书视为本地书，「其他」提供两种操作。
- [x] 13. 验证：先执行 `nvm use`。迭代时运行 `pnpm test:related`；交付前运行 `pnpm test:changed`、`pnpm typecheck` 和 `pnpm lint`。在隔离书库中按验收用例经 CLI 和浏览器各走一遍。不碰用户的真实书库，不打包桌面应用。

## 风险

- **抽取质量与费用。** 主题无关抽取原本为交互查找设计，整本书使用时，长书的调用次数和费用较高。缓解措施：预估、用户确认、可取消可续跑、任务 0 的探针。
- **跨章故事。** 按章抽取会丢失跨章事件，由任务 0 测量并决定是否改为相邻章范围。
- **非古典文本。** 现有质量规则会拒绝部分现代或无标点文本，已作为适用范围写入需求。
- **解析器演进。** 由 `parserVersion` 固定，旧版本须长期保持可读。
- **交互查找的残留缓存。** 用户自己做按主题查找时留下的缓存（标题、梗概、出处，不含原文）不在运行器的记录中，删除书后无法再访问，但仍会进入备份。需求中已注明。
- **与制作队列争用提供方。** 库内同时只运行一个故事卡任务，失败章节可以单独重试。
- **缓存键索引损坏。** 进度文件和缓存键索引分开保存；破坏性清理校验独立索引并在损坏时失败关闭，避免静默遗留中间结果。

## AR 记录

AR 判定为非低风险，原因是涉及持久化、网络抓取、对外 CLI 与技能、费用控制。由独立审阅者复核了两轮。第一轮有 8 项阻塞问题，均已修正：上传受 13 MiB 请求体上限约束；EPUB 缺少解压限制；`LocalBooks` 缓存不失效，书被删除后会回退到未核对原文；身份键被误改为书名；按章抽取未先收窄范围；`embedding-index` 和 CLI 的书目白名单被遗漏；一本坏书会拖垮汇总列表；CLI 绕过 `ensureLibraryReady`。第二轮复核通过，另有 5 项非阻塞建议，均已并入本计划：`MediaStore.delete`、孤立向量的判定、实际解压字节计数、章节范围来源、草稿清理。

本次 RPD 开始后的 AR 第三轮发现：缺少单次导入的文件数、原始字节和抓取总时限；版次变化时未定义未变章节卡复用；替换可能与运行中的故事卡任务竞争。以上已在 REQ、AP 和验收用例中解决。第四轮发现多本 EPUB 可累积过大解压量，已增加单本 64 MiB、全书 256 MiB 解压上限并补验收。第五轮通过：`AR passed: no blocking architecture flaws`。任务 0 实际 Codex 探针推翻 discovery loop 方案后，第六轮先发现 cards 计划仍按 scan prompt/schema 估算，且取消信号未进入 provider request；已改为按 cards 实际请求计数，并要求取消/替换/删除 abort request 后等待 teardown。第六轮通过；另补 `StoryDiscoveryCache.shared()` 的 `drain:true`，防止共享工作尚未结束时过早替换或删除。


## 本次 RPD 执行记录（2026-11-14）

REQ risk: non-low — 导入会保存用户原文，并涉及公网抓取、提供方费用、版权回执与可恢复的书库维护。
AP risk: non-low — 方案覆盖持久化、网络抓取、CLI 与技能同步、费用边界和崩溃恢复。
AR risk: non-low — 由独立审阅者检查存储、解析、安全抓取、生命周期和任务收束。
AR review round: 6; reviewer: reused.
SS risk: non-low — 生产链路跨客户端、CLI、书库、检索与模型提供方。
CR review round: 3; reviewer: reused.
SS implementation commit: `6abe554` (`feat(books): import custom books into local library`).
TT risk: non-low — full mapped change-plan plus native coverage required.
TT result: `pnpm test:changed` passed (187 changed paths; 1,570 tests passed, 0 failed); `pnpm typecheck` and `pnpm lint` passed. Native: 25 Rust library tests passed, 1 release-bundle-only test filtered under the CI-compatible resource override; `cargo fmt --check` passed. Focused import/preparation/metrics/registry tests passed 26/26.
TT review round: not applicable; reviewer: not applicable.
ET risk: non-low — UI/CLI create and persist imported-book data in an isolated library.
ET result: browser file import detected two chapters, saved structure, confirmed the book and displayed a 2-call / 2,116-token estimate. CLI import, structure inspection, confirmation, listing and a 1-call / 983-token estimate passed in a separate isolated library. No provider inference was sent in these manual walks; production provider behavior is covered by controlled integration tests. Both test libraries and the preview server were removed/stopped.
ET review round: not applicable; reviewer: not applicable.
VR risk: non-low — acceptance spans parser/fetch limits, lifecycle, cache safety, export, CLI and UI.
VR passed: 1,570/1,570 mapped tests passed; typecheck, lint, native Rust checks, focused regressions, and isolated CLI/browser import journeys passed.
VR review round: 3; reviewer: reused.
DD risk: non-low — local delivery only; the branch is rebased on main and has not been pushed.
DD: approved for local branch delivery after the implementation milestone and this report commit.
VR passed: 1,570/1,570 mapped tests passed; typecheck, lint, native Rust checks, focused regressions, and isolated CLI/browser import journeys passed.
DD review round: not applicable; reviewer: not applicable.
GC: local implementation and RPD evidence commits recorded on `claude/frosty-hermann-7f7c8a`; no push.
