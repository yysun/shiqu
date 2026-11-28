# 拾趣开发指南

[返回 README](../README.md) · [使用指南](user-guide.md) · [桌面开发与打包](../desktop/README.md)

- [本地启动](#本地启动)
- [服务与数据目录](#服务与数据目录)
- [生成服务配置](#生成服务配置)
- [本地检查与桌面开发](#本地检查与桌面开发)
- [故事生成机制](#故事生成机制)
- [选题、准备与确认](story-generation-state-machine.md)
- [状态机恢复协议](#状态机恢复协议)
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

发布的 CLI 默认使用 `npx @apprun/shiqu`，源码入口使用 `pnpm cli`，用户指定 pnpm 启动器时也可用 `pnpm dlx @apprun/shiqu`。CLI 与桌面共用系统配置数据库 `desktop.sqlite`（协议版本 2），包含非密钥设置 JSON、revision 和按提供方分开的凭据；故事数据库只保存书库数据。CLI 目录选择、`--configure` 和 `--reset-providers` 见[使用指南](user-guide.md#cli-启动)。环境和显式配置文件只覆盖本次调用。原 CLI 的目录 JSON 只作迁移输入。

CLI 与桌面使用每库独占锁及经实例验证的回环控制端点。桌面接入已打开的浏览器服务时沿用其地址；临时 CLI 进程先结束已接收的命令，再在原持锁进程中启用桌面阅读器，并沿用控制地址。无接入时临时服务命令完成后空闲退出。桌面 stdin 控制进程转发停止和强停；异常断连不终止已经接入的服务。

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

`pnpm run setup` 检查运行时、安装锁定依赖和 hooks。首次使用在桌面设置中保存服务，或运行 `pnpm cli --configure`。CLI 使用目标书库持有者的配置。空闲时 CLI 启动短时本机服务，并继承本次调用的环境参数。开发服务已经使用该书库时，CLI 直接连接其命令端点。

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

未审完的文本可用 `pnpm cli stories copy SOURCE_ID --from-data-dir /absolute/source/library --data-dir /absolute/target/library --draft --request-id UUID` 保存为独立草稿。从已就绪来源库读取一致快照。该故事须无在途竖版任务，并已保存完整分镜、原文及审核检查点；复制保留原审核状态、历史与模型记录，新故事暂停，不复制来源故障、任务或图片。它不代表审核通过，不调用模型；后续需要显式恢复制作并完成审核。草稿模式拒绝复制图片及 `copy-images`，普通 `copy` 的已通过审核要求不变。

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

`pnpm test` 是自动快速契约层。安全、启动保障组（包括完整性冒烟）、绑定真实本机 loopback 的测试，以及提供方和模型驱动的生成/审核/分镜流程都改为按需运行：分别使用 `pnpm test:safety`、`pnpm test:startup`、`pnpm test:loopback` 和 `pnpm test:models`；`pnpm test:assurance` 会合并安全、启动、loopback 三组并运行原生桌面测试。`pnpm test:models` 使用受控模型结果，不需要真实 API 密钥或付费推理。按需运行的 `local-server.test.mjs` 用原著夹具验证 SQLite 锁；按需执行的 `book-integrity-smoke.test.mjs` 用几 KB 临时原著调用正式加载器，检查字节哈希、缺失文件、目录越界和失效/不可读出处。

```bash
pnpm test              # 快速契约层
pnpm test:safety       # 按需运行安全保障组
pnpm test:startup      # 按需运行启动保障组
pnpm test:loopback     # 按需运行本机 loopback 监听/请求测试
pnpm test:assurance    # 三组与原生桌面测试
pnpm test:models       # 79 个模型/提供方及受控生成流程文件，按需运行
pnpm test:books        # 十个真实原著文件，开启全部内容检查
pnpm test:flows        # 自动进程/存储集成及受控制作流程，保留文件内快速矩阵
pnpm test:e2e          # 现有用户流程集合
pnpm test:e2e:extended # 六个模型相关服务/引擎 E2E，手动触发
pnpm test:providers    # test:models 的兼容别名，手动触发
pnpm test:full         # 全部自动 JS 回归，每个文件一次，完整开关；模型套件另行按需运行
```

PR 的同一文件最多运行一次：无关小型契约使用快速开关，相关文件使用完整开关。`test:changed` 和默认 `test:pr` 只运行源码测试；浏览器套件有注册时才会列入 `deferredBrowser`，当前没有此类套件。`pnpm test:pr` 从 CI 的统一范围输入或 `BASE`/`HEAD` 比较生成计划；`--files` 可显式指定路径，`--full` 运行所有已注册的非原生自动测试，`--plan`/`--json` 只预览。实际执行将文件、快/全模式、平台排除、源码标识、时间及退出码写入 `.data/test-plans/<run>/`。按需运行 `pnpm test:e2e` 执行服务流程，证据保存在 `.data/e2e/<run>/`。

CI 对每个 PR 报告必需检查「Shared checks」：

- 文档 PR 不运行测试；代码 PR 运行类型、lint 及所选源码测试。安全/启动组始终按需；书籍内容及相关读取/发现代码触发较大原著套件。
- 发现、准备、审核、队列及书籍参考等变更保留对应自动源码覆盖；六个模型相关扩展服务 E2E 仅在显式运行 `pnpm test:e2e:extended` 时执行。多个域取并集；改名保留旧/新路径；未知影响回退全部自动 JS，并要求原生源码检查。
- Rust、共享设置/配置、`server/desktop.ts`、存储升级及相关桌面资源脚本触发 macOS/Windows 原生源码检查和格式检查；安装 Node/JS 依赖供跨语言配置测试使用。自动原生检查跳过按需组 `config::tests`，完整的 `pnpm desktop:test` 通过 `pnpm test:assurance` 手动运行。源码检查通过 `bundle.resources: []` 与 `build.frontendDist: ["../desktop/index.html"]` 使用已提交 HTML 作为编译上下文，避免准备安装包，只排除 `runtime::tests::desktop_uses_verified_bundle_and_ignores_saved_system_path`，该测试仍在发布构建的完整 `cargo test` 中运行。JS 与选中的原生检查任一失败，聚合检查失败。
- `main` 和手动 CI 对当前提交运行全部自动 JS 测试，跳过安全、启动、loopback、书籍和模型手动组。`v*` 标签推送前在本机检查全部自动 JS；标签 CI 直接执行原生构建、测试和产物冒烟，两个平台都通过后才发布。手动构建仍等待本次 CI 的 Shared checks 成功。新 main/PR 推送可取消旧的同类 JS 检查。

JS/原生任务缓存 pnpm store，按系统、架构、固定 Node/pnpm 和锁文件区分；命中后仍执行 `pnpm install --frozen-lockfile`。Rust 编译缓存按平台/架构/Rust 版本及 Cargo、JS 锁文件和 Node 区分。不缓存用户库、密钥或 `node_modules`。完整触发表和旧/新耗时对比见[测试触发与成本](testing-triggers.md)。

纯配置使用 `settingsFixture()`，进程测试使用正式迁移/种子的 `startupFixture()`。真实原著故障测试通过 `copyBookLibrary()` 只复制涉及原著和补卷，保留字节。测试和 E2E 使用隔离数据及受控适配器，不发起真实模型请求。

`pre-push` 只对推送的 `refs/tags/v*` 执行发布检查：解析标签目标提交，在隔离 checkout 中验证 Node/pnpm 固定版本，安装锁定依赖，再运行 `pnpm release:check`。同一提交的多个发布标签只检查一次；普通分支、非 v 标签和删除标签不触发。可通过 `pnpm hooks:install` 为新 checkout 启用 hook。

`release:check` 运行类型检查、lint、两文件服务发布门禁和 Rust 格式检查。`pnpm test:full` 运行本机支持的 49 个自动 JS 测试文件；安全、启动、loopback、书籍和模型组均需显式执行，模型检查使用 `pnpm test:models`，当前没有浏览器 UI 套件。发布前安装 hook、固定 Node/pnpm 与 Rust/rustfmt，并通过该 hook 推送标签。GitHub 的标签任务不会重跑本地资格检查，因此发布时不要跳过 hook。任一检查失败都会阻止推送。`npm:check` 保留一文件 npm 门禁。完整 suite 的 C007 位于按需启动组中，在一次性源码根目录启动真正的 `pnpm dev local`，不打开人工开发书库。

维护命令无需打包：`pnpm library:maintain --help`。备份/恢复/诊断入口复用正式 CLI 与服务实现；运行锁覆盖开发、CLI 和桌面。备份是私有数据，不能放入 `public`、`dist/client` 或公开作品集，详见[维护说明](user-guide.md#书库维护命令)。

故事服务流程 E2E：

```bash
pnpm test:e2e
```

该命令执行已注册的服务与引擎流程，通过真实生产服务、API、队列、SQLite 和媒体存储验证协议边界；模型回执受控，不加载 `.env` 或桌面凭据进行推理。书库、日志和临时 home 均隔离，不触碰人工数据。自动化 UI 组件和浏览器流程套件已退役，`pnpm test:e2e` 当前不启动 Chromium。

测试使用模拟模型响应，不发起付费生成。桌面 UI 使用 Vite 开发服务器验证；只有需要打包时才运行构建命令。桌面开发、平台依赖和打包说明见 [desktop/README.md](../desktop/README.md)。主要代码位于 `client/`（界面）、`lib/`（业务逻辑）、`server/`（HTTP 与存储）、`db/` 与 `drizzle/`（数据库）、`desktop/` 与 `src-tauri/`（桌面版）。

桌面版只保留内置 Node 的一个发行，不再提供系统 Node 版本；构建脚本与 CI 也只打包这一版本。桌面 UI 使用 `pnpm desktop:preview`，在应用内浏览器验证。桌面应用只在明确需要构建或打包时执行相应命令。

## 制作流程界面约定

通用的界面规则在仓库根目录 `AGENTS.md` 的「界面」中。以下是具体屏幕的布局：

- 故事设置内的制作步骤共用 `ProductionTimelineRow`。首行左侧放简短的步骤标题，右侧放状态和查看、编辑链接。下一行左侧放完整说明，右侧放耗时。
- 「制作确认」的四个设置链接及其当前值靠右排列，链接之间保留 8 CSS px。空间不足时按「制作要求、验收要求」和「画风、叙事详略」成对换行，当前值和无障碍名称保持完整。
- 「制作确认」行内的「开始制作」和次要操作（重试、重新加载、查看、编辑、取消替换、恢复/暂停生成等）用文字链接。「准备故事」用按钮。首次制作的「修改故事」面板在确认阶段用实色主按钮「开始制作」，准备阶段用主按钮「保存设置」。
- 首次制作设置面板的底部操作组靠右，与上方内容组留 16 CSS px。核对间距时滚到面板底部，并查看最后一项折叠和展开时与操作组的距离。

## 故事生成机制

排查「为什么还没开始制作」时，先看故事是否已选择、原文和建议是否已保存、读者是否已确认。再看当前版本的动作与阻断原因。选题阶段和查找轮次见[故事生成状态机](story-generation-state-machine.md)，制作确认与后续授权见[生命周期事件规则](story-production-lifecycle.md#事件规则)。

排查「为什么又调了一次模型」时，先确定这次任务要补哪个产物，哪些输入与已保存结果不同。首次制作可在一次分镜调用中同时得到提纲、人物和首批画幅，后续批次读取已有结果。代码中负责选择任务、构造输入和保存结果的位置分别是[调度规则](../lib/production-dag/schedule.ts)、[请求构造](../lib/production-dag/requests.ts)和[队列执行](../server/dag-production.ts)。各调用的输入、批次及复用边界见[制作 DAG 调用契约](story-production-dag.md#调用契约)。

准备和审片的实际提示词随执行记录留存，可从故事的提示词入口按需查看。核对一次异常调用时，使用该次请求记录；系统规则预览显示当前编辑内容。审核的取材与判断依据见[分镜审核方法](storyboard-editorial-review.md)。评估使用隔离数据及同一套生产流程。[评估脚本](../scripts/storyboard-evaluation.mjs)

### 请求次数与缓存

本地选题分为增量原文识别与原文主题判断。catalog不接收主题，只保存title/description/source和阅读进度，不生成summary或storyBrief；跨章pendingEvents只保留id/title/source，续读通过contextText恢复真实原文。提取仍沿用SHIQU_REASONING_SUGGEST和原文本模型。新库在共享锁内按冻结指纹读取旧摘要通用库，校验并投影保留范围/进度；旧文件不删除，不沿用旧主题游标。

完整的不同事件可共享背景原文，不能仅因交叉范围拒绝。接纳时拒绝同范围、同名重叠重复；交叉须有全库及本批已接受记录覆盖并集外的新原文、明确pending续完或被既有主故事包含。结构增量不单独证明语义完整，完整事件仍由提取契约要求并在选中后准备/审核复核。continuedFrom只由服务器核验旧pending派生并校验，不是共享背景的唯一依据；已接受记录在展示/已读排除时按同范围和同名重叠去重。cache.lastRejection保存受限code/title/source诊断，不含全文、原始回执或凭证，不发给模型；成功后清除，不改变旧故事/游标。

`viewer.maxStories=1` 只控制返回卡片，不限制提取：首次冷库仍为一篇，后续按 `catalogStoryLimit` 有界扩批，当前最多 32 篇；原文按预算合块，不截断正文。catalog 输出 schema.maxItems 绑定 scan.maxStories，requestTokens 使用同一动态 schema；已完成原文判断可跨提取范围复用，仍校验原典、内容指纹、主题、匹配契约与模型身份。

主题匹配直接读取完整原文，输入 id/title/text，线上使用批内短编号，先返回 reason（一句、最多 120 字符）再给 verdict（yes/no），不生成摘要、无 review 复核分支。每批最多四篇，按完整输入预算缩批；同进程匹配最多三个并发槽，符合项完成即可返回。合法判断逐项持久化，非法、遗漏或重复条目独立保存为 unknown，不丢弃其他合法结果，也不冒充 no；缺失项可在每周期八次持久预留额度内隔离重试，单篇超预算不调用。服务级故障停止同服务活跃查找的后续派发；取消保留已完成与在途结果。

Codex/OpenAI主题匹配独立使用gpt-6-luna/low；Gemini仍用自身文本模型/low，不跨提供商或更换凭证。ProviderStatus.themeMatching报告匹配模型/档位，主题缓存按此身份及当前匹配契约隔离，匹配模型变化不影响中性提取库。Codex逐任务model覆盖、OpenAI匹配实际响应模型均校验，不静默回退。其他阶段继续现有模型和档位。

新候选保存来源定位与匹配理由。选择后，准备用已保存的原文核对摘要、估算幅数、提出制作与验收要求。读者明确改过或清空的字段优先于自动建议。排查摘要或建议被覆盖时，核对准备结果与两项要求各自的编辑标志。[准备结果写入](../lib/reader-preparation.ts) · [准备提示词与输出契约](../lib/reader-frame-recommendation.ts)

候选简介、事实摘要与分镜开场各有用途。摘要用起因、行动和实际结果交代全篇；首幅只交代眼前情境与必要背景。历史故事迁移自旧字段的摘要会保留原文，是否经过核对取决于该故事保存的准备记录。打开已有成品不会为它重新生成摘要。[从候选故事到文字分镜](story-creation-flow.md)

应用使用单一本地书架，不设用户计费、Token 扣减或生成次数配额。模型输入分块、输出长度、并发和自动重试保护用于保证生成稳定；上游服务的权限、计费和额度仍由提供方决定。

暂停、恢复、失败重试与版本修改对用户的影响见[使用指南](user-guide.md#制作与阅读故事)。

## 图片请求与展示

新生成插图按 **9:16 竖幅**构图。Codex 通过提示词请求 864 × 1536，OpenAI API 直接请求该尺寸；Gemini 请求原生 9:16 / 1K。返回图片只检查格式与尺寸元数据是否有效，不设置分辨率、比例或最低尺寸的拒收门槛，也不裁切、拉伸或补边。手机阅读页在 9:16 范围内等比完整展示原图。后台兼容图片接口的 `IMAGE_SIZE` 默认 `864x1536`；自定义请求尺寸仅按[官方支持规则](https://developers.openai.com/api/docs/guides/image-generation#size-and-quality-options)校验（9:16、宽高为 16 的倍数、最长边不超过 3840 像素、总像素为 655,360–8,294,400），不将请求尺寸用作返回图片的保存门槛。


## 书级星标参考

`0010_book_image_references.sql`新增owner/book唯一选择；API从服务器故事记录推导归属，不接受客户端book或媒体URL。`GET/POST reader/library/:id/reference`返回`reference:{storyId,page,token}|null`；设星传`{page,starred:true}`，取消带当前token。每次设星新token防止迟到取消的ABA；删除来源故事清选择。源图片严格从已拥有生成故事或已发布本地故事导出，读写受可见性及图片URL条件保护。快照按内容哈希保存，用户/书级目录隔离，校验类型/尺寸/12MB及哈希。

绘图派发时解析本次适用的参考图，将选中的书级快照复制到目标故事后交给图片服务。换画风或指定首幅原图的版本沿用本篇参考。修改星标会影响后续调用，已绘成的图片与已保存的付费结果仍可复用。星标快照不可读时，付费发送前就会报错，读者可以取消或重选。[参考图解析](../server/book-image-reference.ts) · [参考图与产物有效性](story-production-dag.md#产物有效性)

## 状态机恢复协议

排查恢复问题时，先在故事详情查看当前版本的 `lifecycle.faults`、`lifecycle.actions` 和图片核对状态。对当前故障使用 `POST sessions/:id/recover`，提交 `{requestId, faultId}`。同一条恢复请求响应丢失时沿用原 `requestId`，新发生的失败要用新故障标识确认重试。[生命周期事件规则](story-production-lifecycle.md#事件规则) · [恢复命令回归](../tests/story-generation-state-machine-commands.test.mjs)

| 要查的问题 | 代码和数据依据 |
| --- | --- |
| 任务已领取、已发送，还是已经收到结果？ | 书库格式 4 在 `production_attempt_events` 记录执行事件，`production_faults` 视图给出故障，`reader_commands` 保存恢复授权回执。[执行记录](../server/production-attempts.ts) · [恢复事务](../server/reader-commands.ts) |
| 付费绘图成功，但本地保存失败，会再画一次吗？ | 队列先保留付费结果，重试保存时复用仍可读的结果。需要重新绘图时须有对应授权。[队列保存与复用](../server/dag-production.ts) · [异常与继续动作](story-production-dag.md#异常与继续动作) |
| 图片加载失败，怎样判断是否丢图？ | 核对当前画幅、地址与文件，在本地解码实际像素。存储或解码器暂不可用时保持待核对。`POST sessions/:id/image-health` 接收从 0 开始的 `page` 和已保存的 `image` 地址。缓存按内容哈希存放最多 128 条解码结论。原文件恢复可读时复用。[像素核对实现](../server/reader-image-health.ts) · [解码回归](../tests/reader-image-health.test.mjs) |

复现恢复问题使用隔离书库。涉及旧库升级或回退时，按[书库升级与整库备份说明](user-guide.md#升级到-0170)操作。

## 书库存储与格式兼容

- `stories` 保存每位所有者的现行制作模型与全部版本；`production_jobs`、`books` 等支撑表各自承担原有职责。阅读器 API 路径、Session 类型与模块以及 `session_id` 列保持不变。
- 访问书库前经正式数据库初始化调用 `ensureLibraryReady()`。版本检查先于归属与诊断写入；桌面的读取与修改共用同一个简要升级关口。历史表名只出现在迁移、导入边界和显式的旧结构夹具中。
- 之后的结构变化是普通的 `drizzle/` 迁移，由 `ensureLibraryReady()` 在已校验的整库备份之后就地应用。
- 合并后的书库需要 0.8.0 及以上的桌面版与 CLI。`books_refuse_pre_consolidation_seed` 触发器让已发布的 0.2–0.7 种子以 `BACKUP_APP_TOO_OLD` 中止，因此现行 `liaozhai` 种子行的来源地址和摘录保持为空。更旧的程序不兼容；回退需要升级前的备份及其配套应用。
- 书库格式 2（迁移 `0025`，制作 DAG）需要 0.15.0 及以上。格式 3（迁移 `0026`，制作生命周期）需要 0.16.0 及以上。格式 4（迁移 `0028`，共享制作产物与执行尝试）需要 0.17.0 及以上，可从格式 1、2、3 一次升级。格式 4 只有 `0028` 一个最终结构，同一迁移在事务内把可继续采用的已付费文字回执接到现行任务身份；任何更早的书库都一次升级到最新迁移，不要求先经其他版本。
- 应用打开书库时自动校验整库备份并应用迁移。回退使用升级前的整库备份与配套应用，恢复到另一目录。旧应用会拒绝打开较新格式。
