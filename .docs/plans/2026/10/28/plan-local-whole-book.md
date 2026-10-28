# 本地整书选题实施计划

Git base: `3fa23facd2df35e940c939dcc7bbc45b47519f12`。入口已有的 24 本目录改动属于本故事范围。用户授权将整理后的资料加入 Git；只作本地提交，不推送。

## 决策与边界

1. `data/library/` 是随代码发布的只读资料：24 本首选原始件、逐书来源和质量信息。按用户最新决定，模型直接读取原文字形并输出简体；不需要 OpenCC 输入转换。只在服务端去掉 Markdown 元数据/排版和 Gutenberg 包装、非正文序跋，保持正文用字。原始下载件 SHA-256 作为引用的 edition，原始字节先校验。稳定单元编号继续沿用，但旧派生文本版本引用失效，升级前端候选缓存。`data/` 其他内容继续忽略。现有 `data/book-sources/` 完整移到 `.data/book-source-research/2026-10-28/` 作可恢复研究档案，仅复制首选文件。重复简体 TXT、脚本中间件、对照 HTML 不提交。
2. 仅在 Node 服务端读取正文；不把整书打进客户端包。运行时书库路径由应用 root 确定，与 SQLite/media 的 `SHIQU_DATA_DIR` 分开。Docker 显式复制 `data/library` 至 `/app/data/library`。
3. 确定性解析《庄子》33 篇及空行段落、《世说新语》36 门及各则，去除序跋/制作人员等非正文。为每个正文单元提供稳定 ID。模型一次看到整书所有单元，无检索或截断。
4. 选题模型返回篇章及首末单元编号，服务端从本地正文解析连续范围并签入内容版本 SHA-256；客户端只提交引用，不能提供原文。范围限制在同一篇章、最多 12,000 字符，含私用区字符的范围拒绝。
5. 在现有 ReaderProvider 的文本方法增加可选整书上下文/已核对原文参数；本地书库包装器负责本地校验、原文保存和兼容性。Gemini 与 Codex 使用同一数据约束与提示词，两者都不能自行查外网或替代来源。
6. StoryGenerator 增加可选 prepareOriginal。在 plan 步骤先核对并保存原文，才请求分镜，失败时原文留在 checkpoint。已有 plan 的旧故事不重做分镜；缺原文时仅按可确定的本地章节补全，无法匹配则明确拒绝。其他书保持原流程。
7. 候选引用进入 Selection 与 sessionStorage，前端显示可读出处；旧候选缓存升级失效，任何选择变化清除引用。模型返回的错误候选过滤并明确说明；缺书、版本不符和无引用不能回退到远程或模型记忆。

## 任务

- [x] 首个 SS 可行性探针：读取两本现有文本，确定 33/36 篇章及单元解析，构造完整请求，检查大小与 Codex stdin 无截断路径；若不能完整输入，停止相关实现并修订计划。
- [x] 整理 `data/library` 与清单，保留原件、补卷出处和哈希；调整 `.gitignore`、`.dockerignore`、Dockerfile 和 README。独立本地提交资料里程碑。
- [x] 新增共享引用 schema、服务端本地书库解析/核对及整书请求契约；包装现有生成提供方，调整选题、计划、原文补全与检查点顺序。
- [x] 调整前端候选选择/缓存及可读出处，保持非本地书和已有故事行为。
- [x] 新增自动化验证：全文首尾覆盖、两本分篇/则数、引用和跨书/旧版本拒绝、无效候选过滤、规划前保存、失败重试复用、两个 provider 数据传递、HTTP 及 Docker 打包边界。
- [x] 执行 `pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm build`；构建会清理 `dist/dev`，验证后恢复开发 bundle 以保持现有本地服务可用。
- [x] 执行 `.docs/tests/test-local-whole-book.md`，尽量做一次真实选题和分镜文本验证，不触发插画；不可用时明确说明失败原因及证据边界。

## 风险与验证

引用核对证明文本确实存在于所选本地版本，不等于全书已校勘或模型的主题判断必然正确。不得让模型猜补坏字。保留所有原始件、质量问题与来源；运行时对实际用于改编的原文范围做检查。

最终全书选题输入含编号约 8.4 万／9.9 万字符，文本请求与时限需实测；不通过静默截断或检索降低输入。用户选题引用可能被篡改，必须在服务端重复校验。已存在的完成故事按持久化原文回看，不受书库更新影响。

## 里程碑

AR passed: no blocking architecture flaws。
AR risk: non-low — source persistence/order, provider data contracts and Docker packaging。
AR review round: 1; reviewer: new (`local_books_review`)。
首个可行性探针：两本各约 8 万字符，现有 Codex 走 stdin 完整写入，不受命令行长度限制；庄子/世说篇章标题可确定性解析。
资料里程碑：`62b8ac4`，24 本原件/TXT 的 48 个 SHA-256 已核对；运行数据及研究档案的忽略规则已核对。增加 `.gitattributes` 保留原始 CRLF 字节，避免跨平台检出破坏哈希。
字节保护提交：`8d984cf`。实现提交：`6786b8d`。93/93 测试及 typecheck/lint/build 通过，CR round 1 passed (`local_books_review`)。真实 Gemini 已完成两本各一次整书选题和分镜：各 5 个核对成功候选、各 8 页计划，0 图片调用，证据在 `.data/local-whole-book-live/evidence.json`。

用户选择只保留原件，并进一步明确 LLM 可读繁体生成简体，原 AR/CR 的资料加载部分失效。修订为校验原始字节后，在内存中剔除包装但保留原文字形，原始 SHA-256 作为 edition；提示词约束输出简体。需重复 AR 和受影响 CR、原字保留/哈希及运行路径测试；真实两本选题/分镜需按最终原文字形重新验证。
AR passed: no blocking architecture flaws (revised originals-only design)。AR risk: non-low — receipt edition and source-loader change。AR review round: 2; reviewer: reused。已覆盖审查指出的传统字形跋文标记，以及旧故事简体篇名与原件繁体篇名的元数据匹配，正文不作转换。


最终原件方案实施提交：`9d5b1a5`。最终验证：93/93 自动化测试通过，typecheck、lint、build 通过，开发 bundle 已恢复。CR passed: no major findings。CR risk: non-low — receipt edition/source loading and packaging contracts。CR review round: 2; reviewer: reused (`local_books_review`)。

最终原文字形实测：Gemini 两本各完成整书选题（各 5 个本地核对候选）及 8 页分镜；原文分别为《庄子》浑沌凿窍 84 字、《世说新语》道旁苦李 62 字，0 图片调用。证据 `.data/local-whole-book-live/evidence.json`。Codex 的整书与已核对片段传递由自动化模拟 runner 验证，未作真实 Codex 调用。

内置浏览器当前 localhost 页面验证《世说新语》“聪明与糊涂”真实候选：5 篇均显示本地篇章/则数，选择“王戎识苦李”后显示生成设置。截图 `/Users/esun/.codex/visualizations/2026/10/28/01a183af-85d1-7e92-9d75-31b17b3c0a66/local-book-candidates.png`。

Docker runtime 镜像 `shiqu:local-book-check` 构建通过，镜像 ID `68f12c0cabdb03d38b222ef46d451afab9e4838c73b8b9c5b4e834c45f78ac2e`。以 `--network none`、独立 `/tmp/shiqu-runtime-check` 运行，模型响应模拟，实际生产 HTTP 选题路径验证两本完整输入（268/1129 单元，84177/98993 字符），并核对 24 原件哈希、无 texts、无 .env/.data；仅挂载验证脚本，未挂载宿主书库。验证脚本在 `.data/verify-container-local-books.mjs`。
