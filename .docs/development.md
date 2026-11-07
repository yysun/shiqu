# 拾趣开发指南

[返回 README](../README.md) · [使用指南](user-guide.md) · [桌面开发与打包](../desktop/README.md)

- [本地启动](#本地启动)
- [服务与数据目录](#服务与数据目录)
- [生成服务配置](#生成服务配置)
- [本地检查与桌面开发](#本地检查与桌面开发)
- [故事生成机制](#故事生成机制)
- [故事创建、编辑与队列流程图](story-creation-editing-queue.md)
- [故事生成状态机](story-generation-state-machine.md)
- [图片请求与展示](#图片请求与展示)

## 本地启动

前端为 React + Vite，后端为 Node REST API，数据使用 Node 内置 SQLite 和本地媒体目录。开发只需 **Node 24.22.1** 与 **pnpm 11.25.0**，无需独立数据库。

```bash
nvm install
nvm use
corepack enable pnpm
pnpm run setup
pnpm dev
```

## 服务与数据目录

发布的 CLI 默认使用 `npx @apprun/shiqu`，无需 pnpm；源码入口使用 `pnpm cli`，用户已选择 pnpm 时也可用 `pnpm dlx @apprun/shiqu`。发布包安装的技能默认用 `npx --yes @apprun/shiqu@<技能版本>` 调用配套 CLI。入口 `server/cli.ts → server/start.ts` 不导入或启动 `server/desktop.ts` / Tauri。CLI 与桌面共用系统配置数据库 `desktop.sqlite`（协议版本 2），包含独立非密钥设置 JSON、revision 和按提供方分开的凭据；故事数据库不保存全局密钥。CLI 目录选择与服务首次问答、`--configure`、`--reset-providers` 见[使用指南](user-guide.md#cli-启动)。环境/显式配置文件仅覆盖本次调用，不自动持久化。原 CLI 的目录 JSON 只作迁移输入，之后两端使用同一个已确认书库。

打开终端打印的本机访问地址；手机使用同一终端中的局域网二维码。默认前端端口为 `3000`，API 为 `3002`。与桌面版同时运行时可用：

```bash
SHIQU_API_PORT=3003 pnpm dev --port 3001
```

`pnpm dev` 使用 Vite 默认缓存 `node_modules/.vite`；桌面预览保留独立的 `.vite-desktop` 缓存。浏览器测试和受控预览使用各自临时目录内的缓存，避免重建依赖时删掉正在使用的 React 文件。新增测试／预览服务也应使用独立缓存；升级依赖后重启开发服务，清理缓存前先停止对应服务。

独立开发书库可用：

```bash
pnpm dev local
# 与其他服务并行时
SHIQU_API_PORT=3005 pnpm dev local --port 3004
```

`local` 强制使用当前 checkout 的 `.data/dev-local`（SQLite、媒体和缓存），忽略环境变量里的 `SHIQU_DATA_DIR` 和桌面书库路径；生成配置仍复用共享设置。普通 `pnpm dev` 跟随已保存的书库目录，可用 shell 中的 `SHIQU_DATA_DIR` 显式覆盖。私有书库及备份不得放入 Vite 的 `public` 目录。

开发后端与桌面、浏览器 CLI、技能调用的 CLI 共用 `desktop.sqlite` 中保存的提供方、对应密钥、模型和任务推理档位；显式 shell 环境变量仅覆盖本次运行，不写回数据库。开发后端不自动加载项目 `.env`，避免旧配置把已选择的 Google 切回 Codex。Vite 的前端环境文件规则仍独立适用，不要把密钥放入 `VITE_` 变量。独立 `pnpm start` 的环境配置方式不变。

`pnpm run setup` 只检查运行时、安装锁定依赖并安装 hooks，不再创建提供方 `.env`。首次使用在桌面设置中保存服务，或运行 `pnpm cli --configure`；该命令保存后退出，不启动生成。修改后重启开发/桌面/浏览器 CLI 服务；技能与 CLI 的下一次 `run` 读取新配置。两端使用同一书库时先停止占用它的服务，再切换入口。

开发或 CLI 浏览器服务运行后，在本机回环地址打开「我的 → 生成服务与模型」，可编辑共享提供方、文本/图片模型、任务推理和 API 密钥。页面将已保存设置与实际运行配置分开显示；环境/配置文件覆盖只显示变量名，保存后仍需重启，覆盖仍优先。旧密钥不返回浏览器，新输入保存成功后清空；保留、替换和移除密钥均为明确动作。并发保存冲突时保留草稿，重新读取后再修改。

设置 API 仅对真实回环连接、允许的回环 Host 和同源写入开放。Vite 在代理前检查原始 socket，并为通过检查的请求附加每次启动独立的私有代理凭证；开发后端拒绝旧代理和无凭证的内部端口直连，不能把局域网请求代理成有权修改凭据的本机请求。更新入口代码后应重启整条 `pnpm dev`。读取书架的局域网权限不变。原生桌面服务及互联网阅读入口不提供此 API。测试必须使用隔离 home、设置库和故事目录，不通过此页面验证真实凭据写入。

## 生成服务配置

开发、CLI 和桌面普通运行无需预设环境变量：首次问答/设置页面保存后复用。下面变量可在 shell 中显式设置，用于本次调用覆盖；CLI 也支持 `--config /absolute/private.env`，已有 shell 变量优先。开发后端不自动读取 `.env`；复制 [.env.example](../.env.example) 仅用于明确需要该文件的独立服务。

OpenAI API 示例：

```dotenv
SHIQU_AI_PROVIDER=openai
OPENAI_API_KEY=your-key
OPENAI_TEXT_MODEL=gpt-6.1-sol
OPENAI_IMAGE_MODEL=gpt-image-2.5-sunburst
```

提供方使用固定官方域名：文本走 [Responses Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)，图片走 [Images generation/edits](https://developers.openai.com/api/docs/guides/image-generation)。文本设置 `store:false`、按任务发送推理档位；图片后续幅使用本地已保存首幅作参考，只接收校验后的 base64 图片。错误不回显提供方正文或密钥，无自动降级计费。`readonly` 阻断阅读队列及历史 admin 生成。

系统配置迁移与校验由 `server/system-settings.ts` 和 `src-tauri/src/config.rs` 共同遵循，TypeScript/Rust 测试实际互读同一数据库。版本 1 迁移保留旧设置与 Gemini 密钥；桌面保存以 revision 拒绝过期快照，CLI 事务 patch 保留其他入口的新值。真实密钥不进入 tests、打包输入或浏览器。

文本与图片可分属不同提供方：`SHIQU_IMAGE_PROVIDER`（`gemini`/`openai`/`codex`，留空时 CLI/桌面保留已保存的图片服务，否则跟随 `SHIQU_AI_PROVIDER`）只替换 `generator().image`，其余调用、队列、审核与提示词记录不变（`server/generation.ts` 的 `withImageProvider`）。图片错误按图片提供方的安全文案报告；状态中 `provider`/`models.text` 仍来自文本提供方，选题缓存身份不变。设置中的 `imageProvider` 可选，未设置时不写入 JSON；与文本相同的选择保存为未设置。

Codex 配置示例（先安装并登录 CLI）：

```bash
pnpm add -g @openai/codex@0.165.0
pnpm run codex:login
pnpm run codex:status
```

```dotenv
SHIQU_AI_PROVIDER=codex
CODEX_MODEL=gpt-6.1-sol
CODEX_REASONING_EFFORT=low
```

### 文本任务推理预算

Claude Code 文本提供方仅通过本次环境变量启用，不修改桌面保存的服务：先运行 `claude auth login` 登录订阅账号，再使用 `SHIQU_AI_PROVIDER=claude CLAUDE_MODEL=opus pnpm cli run STORY_ID --data-dir /absolute/private/library --until reviewed --timeout 3600`。`CLAUDE_BIN` 可指定可执行文件，`CLAUDE_CONFIG_DIR` 可指定已有登录目录。正式服务同样接受此提供方；图片请求明确失败，不自动切换其他提供方。为可重复比较，可将 `CLAUDE_MODEL` 固定为首个调用回执中的完整模型 ID。

适配器使用 Claude Code 2.1.318 的 safe mode、空工具集、strict 空 MCP、禁用 hooks 和会话持久化，并替换系统提示词为共享生产提示词；使用临时目录隔离项目上下文。只接受订阅登录，不继承 API 密钥、API 地址或第三方提供方环境变量。`--bare` 会忽略订阅登录，因此不使用。CLI flag 语义见 [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference)。各任务档位通过 `--effort` 请求，保存的 `reasoningEffort` 是请求值；真实模型来自 assistant/用量回执，不把档位冒充模型确认值。超时及 CLI/server/desktop 退出会结束子进程组，原始 stdout/stderr 错误不进入日志。

文本任务独立分配推理预算：`SHIQU_REASONING_SUGGEST=medium`（选题）、`SHIQU_REASONING_ART=low`（画风）、`SHIQU_REASONING_FRAMES=medium`（画幅数）、`SHIQU_REASONING_OUTLINE=high`（提纲）、`SHIQU_REASONING_PLAN=high`（分镜）、`SHIQU_REASONING_REVIEW=high`（初审/复核）、`SHIQU_REASONING_REPAIR=high`（修订）。结语撰写沿用分镜档位，结语修订沿用修订档位。这些也是缺省值，可逐项覆盖；不自动升档。Codex 支持 low/medium/high/xhigh/max，具体取决于模型和 CLI；Gemini 支持 low/medium/high，不支持值报错，不静默降档。旧 `CODEX_REASONING_EFFORT` 仍用于未分类及图片工具调用，不再覆盖已分类文本任务，也不代表图片质量。已生成步骤不因改档重做；新选题和画风缓存按对应档位隔离。生成检查点用量记录中的 `reasoningEffort` 对 Codex 是线程确认值，对 Gemini / OpenAI API 是请求值。

### 真实审核对比

未审完的文本可用 `pnpm cli stories copy SOURCE_ID --from-data-dir /absolute/source/library --data-dir /absolute/target/library --draft --request-id UUID` 保存为独立草稿。来源须已停止且保存完整分镜、原文及审核检查点；复制保留原审核状态、历史与模型记录，新故事暂停，不复制来源故障、任务或图片。它不代表审核通过，不调用模型；后续需要显式恢复制作并完成审核。草稿模式拒绝复制图片及 `copy-images`，普通 `copy` 的已通过审核要求不变。

显式真实审核对比（会使用现有 Codex 订阅；普通测试不会运行）：

```bash
pnpm exec node --env-file-if-exists=.env --experimental-strip-types scripts/compare-storyboard-reasoning.mjs --input /absolute/path/to/before-row.json --out .data/evidence/reasoning-comparison --model gpt-6.1-sol --effort medium
```

将 `--effort` 依次改为 high、xhigh，保持相同输入、模型和输出目录。输入为含 `selection`、`document` JSON 字符串的单条故事备份；脚本只审核，输出完整报告、实际档位、输入及请求哈希、用量和耗时，不生成图片、不写书库。成功结果再次运行直接复用；失败单独留档。各档一次只提供案例观察，不代表稳定优劣。

其他变量见 [.env.example](../.env.example)，修改后重启服务。无浏览器设备可用 `pnpm run codex:login -- --device-auth`。

## 本地检查与桌面开发

常用检查：

```bash
pnpm test:related        # 开发迭代：只跑直接相关测试，快速开关，不写证据
node --test tests/x.test.mjs # 直接运行单个测试文件（组件测试经 tests/fixtures/tsx.mjs 直接导入 TSX）
pnpm test:changed --plan # 预览工作区影响范围，包括已暂存、未暂存及未跟踪文件
pnpm test:changed        # 小型契约 + 受影响套件，相关文件开启完整提供方和重型开关
pnpm typecheck
pnpm lint
```

开发迭代用 `pnpm test:related`（可加 `--files <paths...>`、`--plan`），交付或提交前运行一次 `pnpm test:changed`。`test:related` 选出改动的已登记测试，以及测试文件、其 `tests/` 夹具或它们导入的 `client/`/`desktop/` 组件直接导入改动文件的测试，再并上源码中出现改动路径的测试与 `covers` 消费者；不沿 `lib/`/`server/` 传递，因此不是影响检查。路径字面量识别仓库相对路径和 `./`、`../` 相对写法，模板字符串拼出的路径（如 `desktop-css-scope` 按名称拼接的 CSS 路径）无法识别。选出 0 个文件时只提示，不代表通过。`--plan`、`--json` 等参数须放在 `--files` 之前。删除或改名导致导入分析失败的测试会被选中。测试入口在 Node 主版本与 `engines` 不符时警告，先 `nvm use`。

多人或多代理共享 checkout 时，先检查预览。只验证本任务可用 `pnpm test:pr --files server/claude-runner.ts tests/claude-provider.test.mjs`，传入本任务全部改动路径；不要替并行任务修改代码或隐藏未知影响的全量回退。无改动、Git 比较失败、未知路径、共享模型/提示词、数据库 schema、依赖或 Node/构建/测试基础设施变化会选择完整源码回归。

`tests/manifest.json` 显式声明每个 JS 文件和 Rust 测试模块的责任域、执行层、成本、平台、传统套件、PR 策略、门禁归属及 `covers` 源码消费者关系。新增测试未注册、文件不存在或元数据无效时执行器报错，不会悄悄跳过。适配器的请求/配置契约与真实启动/生产流程分文件；注册表选择不再检查源码是否含 `productionFixture()` 或 `books` 导入。`flowProviders()`、`heavy`、`books` 仅控制文件内部的矩阵。

`pnpm test` 是显式快速契约层，保留原著完整性冒烟、适配器/配置及小型队列、状态和 HTTP/SQLite 边界测试。`local-server.test.mjs` 的原著夹具用于验证 SQLite 锁，不按书籍变更跳过。`book-integrity-smoke.test.mjs` 用几 KB 的临时原著调用正式加载器，检查字节哈希、缺失文件、目录越界和失效/不可读出处。

```bash
pnpm test              # 快速契约层
pnpm test:books        # 十个真实原著文件，开启全部内容检查
pnpm test:flows        # 启动/进程/存储集成及受控制作流程，保留文件内快速矩阵
pnpm test:e2e          # 现有用户流程集合
pnpm test:e2e:extended # 六个服务/引擎 E2E，受控提供方，无浏览器
pnpm test:providers    # 全部 JS 回归，完整提供方/重型/原著开关
pnpm test:full         # 全部 JS 回归及全部 E2E，每个文件一次，完整开关
```

PR 的同一文件最多运行一次：无关小型契约使用快速开关，相关文件使用完整开关。`test:changed` 和默认 `test:pr` 只运行源码测试；Playwright 用例列在 `deferredBrowser`，全量源码回退也不会运行它们。`pnpm test:pr` 从 CI 的统一范围输入或 `BASE`/`HEAD` 比较生成计划；`--files` 可显式指定路径，`--full` 运行包括 Playwright 在内的完整资格检查，`--plan`/`--json` 只预览。实际执行将文件、快/全模式、平台排除、源码标识、时间及退出码写入 `.data/test-plans/<run>/`。按需运行 `pnpm test:e2e`，证据保存在 `.data/e2e/<run>/`。

CI 对每个 PR 报告必需检查「Shared checks」：

- 文档 PR 只运行小型完整性冒烟；代码 PR 运行类型、lint 及所选源码测试。书籍内容及相关读取/发现代码触发较大原著套件。
- 发现、准备、审核、队列及书籍参考等核心变更追加全部六个扩展服务 E2E。多个域取并集；改名保留旧/新路径；未知影响回退完整 JS，并要求原生源码检查。
- Rust、共享设置/配置、`server/desktop.ts`、存储升级及相关桌面资源脚本触发 macOS/Windows 原生源码测试和格式检查；安装 Node/JS 依赖供跨语言配置测试使用。源码检查通过 `bundle.resources: []` 与 `build.frontendDist: ["../desktop/index.html"]` 使用已提交 HTML 作为编译上下文，避免准备安装包，只排除 `runtime::tests::desktop_uses_verified_bundle_and_ignores_saved_system_path`，该测试仍在发布构建的完整 `cargo test` 中运行。JS 与选中的原生检查任一失败，聚合检查失败。
- `main` 和手动 CI 对当前提交运行完整 JS。`v*` 标签推送前在本机检查完整 JS；标签 CI 直接执行原生构建、测试和产物冒烟，两个平台都通过后才发布。手动构建仍等待本次 CI 的 Shared checks 成功。新 main/PR 推送可取消旧的同类 JS 检查。

JS/原生任务缓存 pnpm store，按系统、架构、固定 Node/pnpm 和锁文件区分；命中后仍执行 `pnpm install --frozen-lockfile`。浏览器缓存按平台/架构/锁文件区分；Rust 编译缓存按平台/架构/Rust 版本及 Cargo、JS 锁文件和 Node 区分。不缓存用户库、密钥或 `node_modules`。完整触发表和旧/新耗时对比见[测试触发与成本](testing-triggers.md)，逐场景清单见[测试盘点](testing-inventory.md)。

纯配置使用 `settingsFixture()`，进程测试使用正式迁移/种子的 `startupFixture()`。真实原著故障测试通过 `copyBookLibrary()` 只复制涉及原著和补卷，保留字节。测试和 E2E 使用隔离数据及受控适配器，不发起真实模型请求。

`pre-push` 只对推送的 `refs/tags/v*` 执行发布检查：解析标签目标提交，在隔离 checkout 中验证 Node/pnpm 固定版本，安装锁定依赖，再运行 `pnpm release:check`。同一提交的多个发布标签只检查一次；普通分支、非 v 标签和删除标签不触发。可通过 `pnpm hooks:install` 为新 checkout 启用 hook。

`release:check` 运行类型检查、lint、`pnpm test:pr --full` 和 Rust 格式检查。完整 JS 计划运行本机支持的所有测试，源码与浏览器分批执行；每个文件只运行一次。发布前安装 hook、固定 Node/pnpm、Rust/rustfmt 与 Chromium（`pnpm exec playwright install chromium --only-shell`），并通过该 hook 推送标签。GitHub 的标签任务不会重跑本地资格检查，因此发布时不要跳过 hook。任一检查失败都会阻止推送。`pnpm test:e2e --gate=release` 仍可单独运行八文件冒烟，`npm:check` 保留七文件 npm 冒烟。完整套件的 C007 在一次性源码根目录启动真正的 `pnpm dev local`，不打开人工开发书库。

维护命令无需打包：`pnpm library:maintain --help`。备份/恢复/诊断入口复用正式 CLI 与服务实现；运行锁覆盖开发、CLI 和桌面。备份是私有数据，不能放入 `public`、`dist/client` 或公开作品集，详见[维护说明](user-guide.md#书库维护命令)。

故事流程 Playwright 验证：

```bash
pnpm exec playwright install chromium --only-shell
pnpm test:e2e
```

命令运行真实 React/Vite、开发访问保护和生产 API/队列/SQLite，覆盖新建、各编辑入口、暂停/恢复、失败重试、重选与状态机协议边界；并执行 headless-cli、cli-skill、library-maintenance、diagnostics、system-settings、settings-faults 套件。模型回执受控，不加载 `.env` 或桌面凭据进行推理。浏览器数据与日志位于 `.data/e2e/<run>`，CLI/配置/维护使用隔离临时书库和 home，不触碰人工数据。手工运行保留截图、trace.zip、状态转换和结果；标签 hook 的临时 checkout 检查后清理，失败原因输出到终端，可在本地重跑此命令保留证据。可用 `pnpm exec playwright show-trace <trace.zip>` 查看独立测试浏览器的操作。浏览器测试范围和运行账本见[故事流程测试](../.tests/story-lifecycle/CASES.md)。

测试使用模拟模型响应，不发起付费生成。桌面 UI 使用 Vite 开发服务器验证；只有需要打包时才运行构建命令。桌面开发、平台依赖和打包说明见 [desktop/README.md](../desktop/README.md)。主要代码位于 `client/`（界面）、`lib/`（业务逻辑）、`server/`（HTTP 与存储）、`db/` 与 `drizzle/`（数据库）、`desktop/` 与 `src-tauri/`（桌面版）。

桌面版只保留内置 Node 的一个发行，不再提供系统 Node 版本；构建脚本与 CI 也只打包这一版本。桌面 UI 使用 `pnpm desktop:preview`，在应用内浏览器验证。桌面应用只在明确需要构建或打包时执行相应命令。

## 故事生成机制

当前界面选择简短、适中或详细，提交 `length:'auto'` 与 `narrativeDetail`，建议幅数只作估计。自动模式先制定全篇提纲，再按每批最多 20 幅细化分镜；每批完成即保存，失败或暂停后复用已保存批次。旧数值 API 保持兼容：不超过 20 幅可一次生成分镜，超过 20 幅先制定提纲。

新生成分镜全部保存后，再结合已核原文和完整分镜，一次生成三个有实际区别的结语候选；候选保存后，由全篇审核显式接收主题和制作要求，对照原文择优：原文决定是否成立，主题参与合格句之间的取舍，不为套题曲解事实或强造反转；记录所选编号与理由，并原样采用该句，不增加单独的择优请求。没有合格候选时才修订所选句，再复核。结语失败只重试结语，不重新编排已保存分镜。

之后进入文本队列全篇审片，一起检查分镜的动作、画面、递进、连续性、原文事实，以及结语的立意是否符合完整因果与最终结局、表达是否只是重复情节或人物动机。结语采用独立提示词，生成与审核共享标准：理解必须完整，表达可以简洁抽象；能用于别的生活处境不等于空泛，写入更多故事细节也不等于更有余味。审核会对照全篇尤其是末幅，要求将剧情注解重新提炼为一层认识或感受。

审核还会检查是否存在明显更好的结语：有原文依据的意味损失或表达弱化，即使不构成事实错误也可要求改善，但须说明保留什么、改进方向及具体收益；同等成立的另一种读法不触发改写。

自动模式的审核保存原文短引、叙事任务、对应幅号与判断依据；结构问题通过有界插入、删除或替换修订，按来源映射复用旧图，并原子调整阅读位置，拒绝旧分镜的迟到进度。结构变化后重新全篇审核。局部修订每批最多 20 幅；结语问题独立修订，只改结语且绘图输入不变时不重绘。审核、修复、复核最多自动修复 20 轮；无实际变化、非法结果或到上限仍未通过时保留问题与进度并停止，审片通过后才开始绘图。旧故事已有完整分镜不因打开而补做审核。

`acceptancePrompt` 与 `productionPrompt` 分开保存，每行一条、最多 20 条验收标准。生成与审修共享编号，审核严格返回逐条结果和依据；可执行的失败项进入修订，`unknown`（冲突、无依据或超出文字分镜判断范围）以 `requirements` 原因阻断绘图，须修改要求并提交新版。仅改验收要求不重新编排，后续修订仍会重新核对图片复用。

实际制作与审核请求随版本留存，按需通过提示词接口读取，不放入书架或进度轮询。系统规则预览不等于执行记录；继承记录保留来源，没有历史记录时明确标记未留存。编排与审修允许作品知识提示缺口，但事实必须回到本次已核原文，不增加自动扩章。

自动幅数稿在正式引擎中执行四步数量审核：原文独立任务→旧稿配文与画面→压缩损失或重复→具体补拆合删，再决定数量。数量门通过后另存检查点，下一任务才做全篇审核与标题、结语择优；结构变化回数量门，纯局部或结语修订留全篇复核，两阶段共用20轮修复预算。`visualReview.phase/frameCountReports`保存数量阶段和完整需求，每次成功数量调用也独立保存usage及提示词。自动稿审核及修订任务键包含阶段、全篇轮次及数量报告数，避免旧排队回执吞掉新阶段。固定幅数及已通过旧稿不补跑数量审核。显式“跳过问题并绘图”仍可由用户放弃未完成审核，须标记并显示人工放行，暂停时不恢复生成。

测试和评估复用正式引擎及队列的同一状态机，不再维护测试专用数量门适配器；`scripts/storyboard-evaluation.mjs`只负责隔离数据、来源绑定、独占目录及精确请求回执。功能改进以正式流程可用为交付，不能停在测试工具生效。

### 请求次数与缓存

本地选题分为增量原文识别与原文主题判断。catalog不接收主题，只保存title/description/source和阅读进度，不生成summary或storyBrief；跨章pendingEvents只保留id/title/source，续读通过contextText恢复真实原文。提取仍沿用SHIQU_REASONING_SUGGEST和原文本模型。新库在共享锁内按冻结指纹读取旧摘要通用库，校验并投影保留范围/进度；旧文件不删除，不沿用旧主题游标。

完整的不同事件可共享背景原文，不能仅因交叉范围拒绝。接纳时拒绝同范围、同名重叠重复；交叉须有全库及本批已接受记录覆盖并集外的新原文、明确pending续完或被既有主故事包含。结构增量不单独证明语义完整，完整事件仍由提取契约要求并在选中后准备/审核复核。continuedFrom只由服务器核验旧pending派生并校验，不是共享背景的唯一依据；已接受记录在展示/已读排除时按同范围和同名重叠去重。cache.lastRejection保存受限code/title/source诊断，不含全文、原始回执或凭证，不发给模型；成功后清除，不改变旧故事/游标。

`viewer.maxStories=1` 只控制返回卡片，不限制提取：首次冷库仍为一篇，后续按 `catalogStoryLimit` 有界扩批，当前最多 32 篇；原文按预算合块，不截断正文。catalog 输出 schema.maxItems 绑定 scan.maxStories，requestTokens 使用同一动态 schema；已完成原文判断可跨提取范围复用，仍校验原典、内容指纹、主题、匹配契约与模型身份。

主题匹配直接读取完整原文，输入 id/title/text，线上使用批内短编号，先返回 reason（一句、最多 120 字符）再给 verdict（yes/no），不生成摘要、无 review 复核分支。每批最多四篇，按完整输入预算缩批；同进程匹配最多三个并发槽，符合项完成即可返回。合法判断逐项持久化，非法、遗漏或重复条目独立保存为 unknown，不丢弃其他合法结果，也不冒充 no；缺失项可在每周期八次持久预留额度内隔离重试，单篇超预算不调用。服务级故障停止同服务活跃查找的后续派发；取消保留已完成与在途结果。

Codex/OpenAI主题匹配独立使用gpt-6-luna/low；Gemini仍用自身文本模型/low，不跨提供商或更换凭证。ProviderStatus.themeMatching报告匹配模型/档位，主题缓存按此身份及当前匹配契约隔离，匹配模型变化不影响中性提取库。Codex逐任务model覆盖、OpenAI匹配实际响应模型均校验，不静默回退。其他阶段继续现有模型和档位。


准备与审核payload将 `storyBrief` 与 `verifiedOriginal` 分开传递；短篇plan、outline、batch、标题/结语及定向修订不传storyBrief，批次outline、结语draft及修订plan/outline也投影去掉summary，不修改保存对象。显式未核对brief仍在调用前拒绝。`editorialContext` 保留选题入口；编排依据原文的言行、因果和轻重。审核先独立核对原文，再参考摘要检查完整性，theme模式另检查主题的原文依据，source模式不额外套主题。摘要或理由错误时服从原文。

新候选只有服务器保存的matchReason与原文定位，选中后prepareRecommendation才用真实原文生成/核对summary与匹配理由，复用画幅建议调用并原子保存verified检查点；简介不充当完整摘要。缺失结果不能确认或编排。旧候选storyBrief仍可核对使用，已有摘要/提纲/成品不自动重做；非intake缺摘要的首次编排保持已有兜底与确认交互。

新摘要优先2–3句、尽量80–150字，保留起因、关键行动及实际结果；旧1200字符记录不截断或强制重写。摘要用于准备、缓存、归档及审核查漏，不另设“设局”资料项。共享开场规则要求第一页直接从原文中提取必要背景、人物关系和眼前处境；不把全篇概述当开场或提前讲出后续结局。编排与审核使用同一开场规则。

故事、分镜/提纲、版本基线、studio接口及ZIP统一为 `summary`（最多1200字符），不再提供 `hook` 别名。新intake的摘要在分镜前准备并核对；开始短篇分镜或长篇提纲时仍缺摘要，则复用已有recommend准备逻辑，先保存原文和核对摘要，再编排，记录summary用量。已确认任务不退回确认、不改幅数，重试复用摘要；读取和已有成品不触发生成。新分镜元数据复用核对摘要，不另写开场引子。

升级`0009_story_summary.sql`及开库迁移会将旧字段原文迁至summary，处理任务plan/draft/outline/版本基线和媒体JSON；已有非空summary优先，原文字符串不做替换。旧引子文字迁移不代表摘要已语义补全或重新核对。图片队列派生version/ID及依赖同步迁移以复用已付费回执；发生冲突则回滚，不丢弃结果。升级需先停止旧服务并备份书库，完成后使用同一新版重启；旧客户端需刷新，旧二进制不再兼容新列名。

原文识别阶段不生成画风推荐，选中故事后按原文准备并缓存画风建议；旧候选已有推荐仍可沿用。插图数量建议会增加一次文本请求，分镜后的三个结语候选合用一次文本请求，择优并入原有全篇审核，不额外增加请求。建议会保存在书架，稍后继续无需重复推荐。详略不对应固定幅数，短故事不会强行凑页。

应用使用单一本地书架，不设用户计费、Token 扣减或生成次数配额。模型输入分块、输出长度、并发和自动重试保护用于保证生成稳定；上游服务的权限、计费和额度仍由提供方决定。

暂停、恢复、失败重试与版本修改对用户的影响见[使用指南](user-guide.md#制作与阅读故事)。

## 图片请求与展示

新生成插图按 **9:16 竖幅**构图。Codex 通过提示词请求 864 × 1536，OpenAI API 直接请求该尺寸；Gemini 请求原生 9:16 / 1K。返回图片只检查格式与尺寸元数据是否有效，不设置分辨率、比例或最低尺寸的拒收门槛，也不裁切、拉伸或补边。手机阅读页在 9:16 范围内等比完整展示原图。后台兼容图片接口的 `IMAGE_SIZE` 默认 `864x1536`；自定义请求尺寸仅按[官方支持规则](https://developers.openai.com/api/docs/guides/image-generation#size-and-quality-options)校验（9:16、宽高为 16 的倍数、最长边不超过 3840 像素、总像素为 655,360–8,294,400），不将请求尺寸用作返回图片的保存门槛。


## 书级星标参考

`0010_book_image_references.sql`新增owner/book唯一选择；API从服务器故事记录推导归属，不接受客户端book或媒体URL。`GET/POST reader/library/:id/reference`返回`reference:{storyId,page,token}|null`；设星传`{page,starred:true}`，取消带当前token。每次设星新token防止迟到取消的ABA；删除来源故事清选择。源图片严格从已拥有生成故事或已发布本地故事导出，读写受可见性及图片URL条件保护。快照按内容哈希保存，用户/书级目录隔离，校验类型/尺寸/12MB及哈希。

coordinator先解析实际参考，legacy advance调用同一解析器；将书级快照复制到目标故事不可变artifact后交给provider，保留严格同namespace校验。三个provider允许第一幅附件，星级优先、无星本篇首图fallback。生图派发时读取选择，旧调用字节固定；不把可变星标加入job版本，已有图片及成功待发布回执保持，只有后续尝试使用新选择。坏快照在付费前失败，用户可取消或重选。旧D1导入豁免本地0010，由openDatabase创建空表。

## 状态机恢复协议

[故事生成状态机](story-generation-state-machine.md)是正式行为契约。重选以不可见的reselection草稿查找；显式选择另一篇后，以统一家族epoch／内容基版CAS提交，旧结果保留历史。取消只读刷新当前家族，不用打开时快照回滚。普通修订与替换都在提交SQL中检查未被替代、未删除；提交回执不重新激活历史。

`reader_faults`独立于Document保存故障实例，`reader_commands`持久保存用户命令与结果。`POST sessions/:id/recover`要求`{requestId,faultId}`；`production-control`要求`{requestId,action}`，人工审核放行同样传故障身份。命令受理、故障领取与任务重排通过同一个SQLite事务中的触发器完成；重放只读已有回执。普通再次失败产生新实例并接替旧实例，只有新授权可恢复。其他非依赖故障不阻止已授权的局部恢复。旧`production/advance`的`retry:true`返回400；普通轮询和需求心跳不能恢复故障。

图片onError调用`image-health`，传当前幅号与保存地址；服务端核对所属版本、内容与文件格式结构及实际像素解码（本地JS/WASM，不联网，不改写原图）。初始化／资源异常不当作坏图，最多缓存128条字节hash结论。存储临时异常不当作失效；确认失效才撤销完成。重绘前重新检查，文件恢复则复用；发布失败只重试保存，如果付费结果也失效，要求新的明确重绘。首幅失效保留其他图片及在途成果，只阻止新依赖调用。

0012建立故障／命令表，0013补全状态转换，0014在开库事务中迁移含显示名的旧任务身份及其依赖、故障、回执；0015原子撤销完成、收束已恢复图片的失败检查点；0016为无法从当前显示名关联的旧失败保留legacy阻断，明确恢复后才绑定当前任务，发布失败仍携带旧的已付费结果，只重试保存。0017原子登记替换回执，并用跨表写入约束防止请求编号同时用于创建和控制／恢复。均不调用模型。保留已应用迁移，禁止编辑已部署迁移代替增量升级。升级前停服并备份；数据库升级后降级必须恢复匹配备份，不能只切回旧二进制。完整证据见[验收记录](tests/test-story-generation-state-machine.md)。
