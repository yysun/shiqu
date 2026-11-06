# 拾趣桌面版

书库备份恢复与诊断由[共用维护命令](../.docs/user-guide.md#书库维护命令)提供：源码目录运行 `pnpm library:maintain --help`，安装后的拾趣 CLI 使用相同参数。备份前停止本机服务；诊断可以运行中导出。桌面服务直接保存安全诊断事件，原始 stderr 和凭据不进入诊断包。已有书库升级前会自动生成并验证快照；恢复到新目录后需在设置中明确选择，不自动切换或启动。

桌面版是现有 Node 应用的 Tauri 2 控制台：无需预先配置即可启动服务，在默认浏览器中阅读与创作，或让手机通过局域网 / 免费互联网隧道扫码加入。故事、图片和阅读进度仍存放在电脑上的同一份 SQLite/媒体目录。**桌面版统一内置 Node 24.22.1，安装后直接运行。**

日常创作步骤见[使用指南](../.docs/user-guide.md#制作与阅读故事)：浏览器中选择故事、画风与叙事详略，设置制作和验收要求；文字审片通过后绘图。提示词查看、故事改名、每书星标参考图及 PDF / PNG / ZIP 导出也在同一浏览器界面完成，与 CLI 启动的界面一致。

0.6.5 的[署名与转载设置](../.docs/user-guide.md#署名与转载)、12–48 px WebP 签名字号及[带提示词的 ZIP 分享](../.docs/user-guide.md#zip-内容与提示词分享)同样在浏览器中完成。升级前停服备份，CLI 与桌面版保持同版；分享前检查 ZIP 内原文与自定义要求。

## 0.8.0 书库格式

桌面端和 CLI 均须升级到 0.8.0。唯一故事表为 `stories`，格式版本为 1。启动服务时先用内置 Node 完成升级或恢复，再开放监听；升级期间显示进度且不被启动超时中断。升级前已校验的完整备份路径显示在控制台，失败时也保留可用备份路径。新书库为空，不含样篇。一次性升级约需额外两倍书库大小的可用磁盘空间，用于备份和暂存副本；后续普通迁移在完整备份后原地执行。

0.7.x 及更旧程序不兼容合并后的书库；0.2–0.7 的 CLI／浏览器服务会被种子写入保护拒绝并提示 `BACKUP_APP_TOO_OLD`，0.7.x 桌面版可能只显示通用启动错误。回退需停止所有应用，使用升级前备份与对应旧版本恢复到新目录，不可覆盖活动书库。旧版 Codex 技能还需用 0.8.0 显式更新；完整步骤见[升级说明](../.docs/user-guide.md#升级到-080)。

## 用户运行要求

桌面版不要求电脑安装 Node。应用在执行内置运行时前校验 SHA-256，再检查实际版本、平台/架构和 SQLite 功能；资源缺失或损坏时要求重新安装，不会偷偷改用系统 Node。控制台只显示内置运行时状态。

安装包包含编译后的前端、服务器、生产依赖、迁移、24 本原文及 Node 与其许可证/第三方声明。用户无需安装 pnpm 或运行依赖安装。项目原有的 tiktoken 分词器包含 WASM，用于 AI 输入预算估算；这不是将应用改为 WASM，普通 Node 后端仍然保留。

macOS 最低版本为 **13.5**，与当前捆绑 Node 的实际最低系统版本一致。Windows 安装包面向 **Windows 10/11 x64**，使用 NSIS EXE 安装到当前用户；需要 WebView2，缺失时安装程序联网下载。Linux 需要 WebKitGTK、托盘支持。现有 Codex 运行器不支持原生 Windows，Windows 桌面版可使用 OpenAI API、Gemini 或只读。API 生成需联网及有效的模型权限/配额。

## 设置与凭据

CLI 和桌面版使用同一份 `com.shiqu.desktop/desktop.sqlite`。桌面窗口是一页服务控制台，负责启动、停止、重启、打开浏览器、故事数据目录、端口、手机访问、cloudflared 路径、Codex 可执行文件与登录目录，以及退出。没有书架统计、生成队列、故事删除或生成配置表单。未配置提供方也能启动并阅读；生成操作会提示先配置，不会留下半启动的制作记录。

通过本机 `http://127.0.0.1:端口` 或可信局域网地址打开「我的 → 生成服务与模型」，或点击控制台中的同名入口。这里配置 Codex / OpenAI API / Gemini / 只读、独立图片服务、模型、推理档位和 API 密钥；本机路径仍只能在控制台停止服务后修改。控制台运行时显示新任务使用的生成配置，停止时显示标为「已保存」的配置。

**API 密钥以明文存储，由本机文件权限保护，并非加密存储。** Unix 配置目录/数据库权限为 0700/0600，Windows 使用用户配置目录 ACL。新输入的密钥通过本机或可信局域网 HTTP 提交，保存后只返回存在状态，永不返回原文。可保留、替换或移除密钥，切换提供方保留其他配置。可信 LAN 地址与手机可读取和修改生成设置，互联网隧道和跨站页面仍被拒绝。LAN 设备共享配置、阅读与生成权限，仅限可信网络；不要把设置入口通过自建反代或端口转发暴露到公网。

浏览器保存后新生产步骤读取共享配置，无需重启服务；已经开始的步骤保留原提供方、密钥、推理与超时，继续完成。切为只读或移除有效密钥后不再派发新的付费步骤，本地图片发布仍可完成。控制台的重启按钮仍用于一般运维，生成配置不需要它。生成服务未就绪时显示「测试连接」，只检查已保存配置加覆盖的模型元数据或 Codex 登录，不提交未保存草稿、不生成内容，也不证明配额充足。设置页不提供一键重置入口。CLI 的既有 `--reset-providers` 行为不变。

环境变量覆盖本次启动与连接检查，不自动保存。支持 `SHIQU_AI_PROVIDER`、`SHIQU_IMAGE_PROVIDER`、对应密钥与模型、Codex 路径/模型/登录目录及推理设置；浏览器只列覆盖项名称，不列值。Finder/Dock 通常不继承终端环境，普通使用在浏览器保存即可；桌面版不执行 shell 或读取 `.zshrc`、项目 `.env`。原生进程将精确的设置库位置通过私有 stdin 交给子进程，不由 Node 重新推断平台目录；HTTP 遇到库缺失或不可读会拒绝，不创建替代库。

数据库协议版本 2 继续使用 `desktop_settings`（非密钥 JSON 与 `revision`）和 `desktop_credentials`（按 gemini/openai 分开存密钥）。版本 1 在事务中迁移，保留旧 Gemini 密钥与书库；更旧非密钥 `settings.json` 在新库建立时迁入，原文件保留。损坏、未知或未来版本拒绝启动而不重建。桌面保存通过 revision 比较拒绝过期快照；CLI 在事务内修改最新行。另一入口修改后可用「重新读取设置」刷新再保存。旧版程序可能拒绝版本 2，回退需恢复对应备份。

默认书库位置：macOS 为 `~/Library/Application Support/com.shiqu.desktop/library`，Windows 为 `%APPDATA%\com.shiqu.desktop\library`，Linux 数据目录通常为 `~/.local/share/com.shiqu.desktop/library`。Linux 设置数据库则在 `~/.config/com.shiqu.desktop/`，可由 XDG 路径覆盖。API 密钥与全局设置不在故事目录里；共享故事不会自动携带设置，备份 `desktop.sqlite` 则包含密钥。更换数据目录只切换书架，不搬移或合并。

OpenAI 默认文本模型 `gpt-6.1-sol`、图片模型 `gpt-image-2.5-sunburst`，可分别调整。API 生成使用独立提供方，不回退到 Codex/Gemini。文本任务推荐档位仍为选题 medium、画风 low、幅数 medium、提纲/分镜/审核/修订 high；Gemini 仅支持 low/medium/high，OpenAI API / Codex 的更高档位依模型权限。选择 Gemini 时会把不支持的更高任务档位恢复为该任务推荐值，之后可手动修改并保存。

## 启动技能集成

「启动服务」成功后会安装缺失的用户级技能，并在已有自动更新同意时同步随包版本。控制台显示准备结果；定制、未知来源、较新副本、宿主停用和已启用插件均保留，不修改宿主配置。失败不阻止服务；连接检查和书库升级不安装技能。

桌面资源携带同版本 `skills/shiqu`、生产 `dist/server/agent-cli.js`、字体及平台依赖。技能目录的受管 `.shiqu-runtime.json` 登记绝对 Node/CLI 命令，助手校验版本与哈希后执行，无需系统 npm。移动桌面应用后重启服务以核对路径；无系统 npm 时通过更新桌面应用、按原同意在下次启动同步技能。直接 CLI 仍需先安全停止占用同一书库的服务，不支持 `--url`。

`skill auto-install [on|off]` 查询/保存启动集成偏好，`SHIQU_SKILL_AUTO_INSTALL=off` 跳过本次；可通过登记的 CLI 命令执行，不要求 npx。它们独立于 auto-update，不删除已有技能。原生只透传集成所需的 `CODEX_HOME`、`SHIQU_SKILL_AUTO_INSTALL`，继续拒绝任意 Node 注入及密钥环境继承。

## 浏览器与手机

桌面只负责本机服务。点击「启动服务」后再「在浏览器打开」，故事浏览、队列和制作均在浏览器中进行。关闭窗口继续托盘运行，退出停止服务。手机访问保留局域网二维码与可选私密互联网链接；生成设置只允许真实回环或私有网络来源、实际本机接口 Host 和同源提交，隧道即使转发到回环套接字也不能访问。

## 开发与构建

桌面 UI 开发默认运行 `pnpm desktop:preview`，在应用内浏览器打开 `http://127.0.0.1:1420`，支持热更新，无需准备资源或打包。单页显示服务、本机设置和手机访问，预览不读取书库、不模拟服务运行。浏览器预览不能启停原生服务或修改本机路径。验证使用隔离设置、书库和合成密钥。

队列与阅读端统一展示「确认原文 → 确定画幅数 → 分批分镜 → 全篇审片 → 定向修订 → 复核 → 绘图」。初审通过时修订与复核标记为无需执行；复核未通过时明确阻止绘图。旧故事没有审片检查点时显示未启用，不补做审核。只在用户明确要求时运行桌面准备、构建或打包命令。

使用 `.nvmrc` 固定的 Node、`package.json` 固定的 pnpm，及仓库根目录 `rust-toolchain.toml` 固定的 Rust 1.93.0。Rust 固定文件须在根目录，让 Tauri 启动时的目标检测与 `src-tauri` 内的 Cargo 编译使用同一工具链；无需修改全局 Rust 默认版本。安装对应平台的 [Tauri 系统构建依赖](https://v2.tauri.app/start/prerequisites/)。

预览控制台的浏览器入口时，另外启动现有阅读端开发服务，并为桌面预览显式指定地址。以下两条命令在两个终端运行，`/tmp/shiqu-reader-preview` 是独立测试书库；不要用个人书库验证写操作。只读提供方不会调用生成服务：

```bash
SHIQU_DATA_DIR=/tmp/shiqu-reader-preview SHIQU_AI_PROVIDER=readonly pnpm dev
SHIQU_DATA_DIR=/tmp/shiqu-reader-preview VITE_DESKTOP_READER_URL=http://127.0.0.1:3000 pnpm desktop:preview
```

仅接受 `http://127.0.0.1:端口` 的根地址，不允许凭据、查询参数或 fragment，且不能指向桌面预览本身。地址仅供开发预览的浏览器入口使用，正式桌面版仍由原生 `open_reader` 命令验证并打开运行中服务的本机地址。不提供预览地址时显示连接说明。浏览器测试不能证明原生系统浏览器唤起、托盘和运行时打包行为；发布前仍需对应平台的原生运行检查。

```bash
nvm use
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm desktop:dev
pnpm desktop:build
```

Windows 本地构建需安装 Microsoft C++ Build Tools 的「使用 C++ 的桌面开发」、WebView2 和 Rust MSVC x64 工具链，并使用官方 Node **24.22.1 x64** 发行版（保留 LICENSE）。PowerShell 中无需执行 `nvm use`；先安装固定版本 Node 和 pnpm，再运行上面的 `pnpm install`、`desktop:dev` / `desktop:build` 命令。Tauri 自动合并 `src-tauri/tauri.windows.conf.json`，桌面版默认输出 NSIS 安装程序，无需 MSI / WiX。详见 [Tauri Windows 构建前置条件](https://v2.tauri.app/start/prerequisites/#windows)及 [Windows 安装程序说明](https://v2.tauri.app/distribute/windows-installer/)。

桌面构建会运行现有 `pnpm build`、单独编译设置 UI，将应用运行资源复制到 `desktop/resources/runtime`，再将构建所用的 **精确 Node 24.22.1 可执行文件和原发行版 LICENSE** 复制到 `desktop/resources/node`，记录版本、平台、架构、来源及 SHA-256。构建环境必须使用完整官方 Node 发行版及同架构的 Rust 工具链；不支持跨平台/跨架构、universal 或 musl 打包，遇到不匹配会停止。安装桌面版时不下载 Node；Windows 缺失 WebView2 时仍需联网安装它。

`desktop:dev` 也会先完成这些准备步骤，再编译和启动原生应用；准备钩子必须设置 `wait: true`，避免原生应用提前读取旧资源或尚未复制完成的运行时。仅修改界面时使用 `desktop:preview`，无需等待资源准备。

安装包使用 `shiqu-standard-*` 文件名，产物在 `src-tauri/target/release/bundle/`；macOS 可用 `pnpm desktop:build --bundles app` 只生成 `.app`。

本地检查（不准备或打包桌面资源；缺少内置 Node 时，`desktop:test` 的已准备资源用例须留待 CI 或显式准备后验证）：

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm desktop:test
# 已有准备完成的运行资源时再执行：
pnpm desktop:smoke
(cd src-tauri && cargo fmt --check)
```

`desktop:smoke` 将完整运行资源复制到仓库外的临时目录，验证新书架与阅读进度为空、阅读页面与 API 可访问、始终开启的局域网地址（互联网关闭）、重启和退出；不创建故事、不上传图片、不检查示例，也不调用付费生成。同时复制并验证内置 Node/许可证的最终字节哈希，使用无系统 Node 的 PATH 启动。可传入安装包内的 runtime 路径来验证实际打包内容。

CLI 复用共享数据库中的书库目录，没有时可导入原 `cli-library.json` 或查找已有默认书库，否则询问后存入共享数据库。CLI 不运行 `desktop.ts` 或 Tauri；只复用存储/提供方核心。CLI 与桌面服务使用共享 Node 事务锁与 owner 标记，拒绝同一目录的另一个运行服务。旧 CLI 独立书库不会自动搬移；可用 `--data-dir` 指定。历史设置中的 `nodePath` 字段继续兼容，但不能覆盖内置 Node。

`pnpm dev` 默认复用桌面/CLI 保存的书库、生成服务、对应密钥、模型和任务推理设置；`pnpm dev local` 只隔离书库，生成配置仍共享。显式 shell 变量覆盖本次运行，不改保存值；开发后端不自动加载项目 `.env`。技能通过 CLI 使用同一配置，无需再保存一套密钥。修改保存的生成配置后，运行服务的下一项生产步骤读取；CLI 下一次执行时读取。局域网 API 可直接访问，所有可连接地址的设备共享书架和生成权限；终端启动不依赖桌面 GUI 正在运行。`pnpm build` 和 `pnpm start` 入口继续独立运行，显式数据目录配置优先。

开发、CLI 和桌面服务均可在本机或可信局域网地址的「我的 → 生成服务与模型」编辑共享生成设置，页面显示新任务使用的配置、已保存值及启动覆盖。已存密钥不返回浏览器，可信局域网（包括手机）可以编辑，互联网隧道不开放；本机路径和网络设置仍由桌面控制台管理。

## GitHub macOS / Windows 发布

[版本化的 pre-push hook](../.githooks/pre-push) 在推送 `v*` 标签前执行一次共享检查；[Desktop 工作流](../.github/workflows/desktop-macos.yml) 随后并行构建 macOS 和 Windows 安装包，不再重复共享测试。PR 和手动运行仍通过 macOS 的独立 `Shared checks` 任务执行类型检查、lint、完整 JavaScript 测试与 Rust 格式检查，通过后才打包。Unix Codex CLI / helper 模拟进程测试需要 Unix 环境。

两个打包任务使用原生 runner：Apple Silicon（`macos-15` / arm64）和 Windows（`windows-2022` / x64）。每个平台只打包内置 Node 的桌面版，各产出一个未签名 DMG 或 NSIS EXE；不构建 Intel Mac、Windows ARM64 或 Linux 安装包。阅读端与桌面 UI 构建及运行资源准备仍须在各自平台执行一次，以包含对应平台的依赖与 Node。

每个平台保留一次原生 Rust 测试、打包及资源 smoke 检查，验证各自的系统行为与最终运行资源。Windows 会静默安装 EXE 到含空格的临时目录，对实际安装后的 runtime 执行 smoke，再卸载。CI 跳过 Tauri 中重复的准备钩子，本地打包命令仍自动准备资源。共享检查或任一平台失败都会阻止发布。无需 Apple / Windows 签名证书或额外发布密钥；仅发布任务拥有 `GITHUB_TOKEN` 的 `contents: write` 权限。

`pnpm run setup` 会为当前克隆启用 Git hook；已有依赖的克隆只需执行一次：

```bash
pnpm run hooks:install
```

推送 `v*` 标签时，hook 为每个不同的标签提交创建临时独立 worktree，使用该提交固定的 Node / pnpm 版本执行 `pnpm install --frozen-lockfile` 和 `pnpm run release:check`（typecheck → lint → 关键冒烟门禁 → Rust 格式检查）。冒烟门禁运行 `pnpm test:e2e --gate=release`，覆盖 8 个测试文件，包括一条完整浏览器制作与阅读流程、生产恢复与重放、无服务 CLI/导出/备份、CLI 启动、配置和发布保护；使用隔离书库，不调用真实 AI。完整回归可按需运行 `pnpm test:full`。同次推送的多个标签若指向同一提交只测一次；普通分支推送及标签删除不运行测试。任何检查失败都会阻止本次推送，临时 worktree 随后删除；本地未提交修改不会混入检查。标签所在提交必须包含 `release:check` 脚本。可单独运行 `pnpm run release:check` 检查当前目录，但发布 hook 始终重新核对实际标签提交。

hook 是每个克隆的本地配置，不能约束网页创建标签、其他未安装 hook 的克隆或 `git push --no-verify`。正式标签应从已启用 hook 的 Unix 开发环境推送；GitHub 不会补跑共享测试，仍检查两个平台的原生 Rust 测试与最终安装资源。

手动运行或匹配路径的 pull request 只上传 Actions artifacts，不创建 Release。推送 `vX.Y.Z` 正式版本标签后，两个安装包全部构建并检查成功才创建草稿、上传安装包和 `SHA256SUMS.txt`，最后自动公开发布。发布失败可重新运行并继续未发布的草稿；已公开的版本不会覆盖。暂不接受预发布标签。

发布前将 `package.json`、`src-tauri/tauri.conf.json` 和 `src-tauri/Cargo.toml` 的版本更新为同一个 `X.Y.Z`，同步 `src-tauri/Cargo.lock` 中的本应用版本，并提交源码。然后推送对应标签，例如当前版本：

```bash
git tag v0.9.0
git push origin v0.9.0
```

标签所在提交必须包含该工作流及要发布的源码；GitHub 不会打包未提交的本地修改。每个版本使用新的标签。README 的 `/releases/latest/download/` 链接依赖以下固定文件名：

```text
shiqu-standard-macos-arm64.dmg
shiqu-standard-windows-x64-setup.exe
SHA256SUMS.txt
```

Windows 下载链接在 0.4.0 或更新正式版本发布后生效。Windows 安装包未签名，SmartScreen 可能提示风险；仅对确认可信的下载选择「更多信息 → 仍要运行」。macOS 安装包未签名、未公证，首次打开可能需要在「隐私与安全性」中允许。以后若加入正式签名/公证，必须保证最终 Node 字节与清单一致；签名改变 Node 字节后需在最终应用签名前重新生成清单，并运行安装包 smoke 检查。
