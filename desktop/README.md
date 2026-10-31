# 拾趣桌面版

桌面版是现有 Node 应用的 Tauri 2 控制台：填写生成配置，启动服务，在默认浏览器中阅读与创作，或让手机通过局域网 / 免费互联网隧道扫码加入。故事、图片和阅读进度仍存放在电脑上的同一份 SQLite/媒体目录。无需 Docker。**桌面版统一内置 Node 24.22.1，安装后直接运行。**

## 用户运行要求

桌面版不要求电脑安装 Node。应用在执行内置运行时前校验 SHA-256，再检查实际版本、平台/架构和 SQLite 功能；资源缺失或损坏时要求重新安装，不会偷偷改用系统 Node。设置页只显示内置运行时状态。

安装包包含编译后的前端、服务器、生产依赖、迁移、24 本原文及 Node 与其许可证/第三方声明。用户无需安装 pnpm 或运行依赖安装。项目原有的 tiktoken 分词器包含 WASM，用于 AI 输入预算估算；这不是将应用改为 WASM，普通 Node 后端仍然保留。

macOS 最低版本为 **13.5**，与当前捆绑 Node 的实际最低系统版本一致。Windows 安装包面向 **Windows 10/11 x64**，使用 NSIS EXE 安装到当前用户；需要 WebView2，缺失时安装程序联网下载。Linux 需要 WebKitGTK、托盘支持。现有 Codex 运行器不支持原生 Windows，Windows 桌面版可使用 OpenAI API、Gemini 或只读。API 生成需联网及有效的模型权限/配额。

## 设置与凭据

CLI 和桌面版使用同一份 `com.shiqu.desktop/desktop.sqlite`。桌面首次未配置时打开「设置」；选择 Codex / OpenAI API / Gemini / 只读，保存后两种入口直接复用，不再重复配置。Codex 使用另行安装并登录的 CLI；OpenAI API 与 Gemini 分别使用自己的 API 密钥，API 费用不使用 Codex 订阅额度。

**API 密钥以明文存储，由本机文件权限保护，并非加密存储。** Unix 配置目录/数据库权限为 0700/0600，Windows 使用用户配置目录的 ACL。设置页面只返回每种服务的密钥存在状态，不返回原文；输入新密钥才替换，留空保留所选服务的现有密钥。切换服务保留其他服务的模型和密钥。密钥只通过私有 stdin 发给 Node，不通过参数、日志或 HTTP 暴露。

服务运行时先停止再修改设置或「重置所有服务配置」。重置经确认后删除全部服务选择、模型与 API 密钥，保留书库目录、网络设置、故事和阅读进度；CLI 对应 `--reset-providers`。配置后启动新服务生效，已运行的另一入口保留启动快照直到重启。只读模式阻止新阅读队列和历史 admin 生成接口调用生成服务。

环境变量覆盖本次启动和连接检查，不会自动导入或保存。支持 `SHIQU_AI_PROVIDER`、对应 `OPENAI_API_KEY` / `GEMINI_API_KEY`、`OPENAI_TEXT_MODEL` / `OPENAI_IMAGE_MODEL`、Gemini 模型、Codex 可执行文件/模型/登录目录及推理设置。设置页面显示数据库保存值。Finder/Dock 启动通常不继承终端环境，普通使用直接在设置中保存即可；桌面版不执行 shell、读取 `.zshrc` 或项目 `.env`。

「检查连接」先保存界面中的更改，然后读取共享数据库并应用本次环境覆盖。OpenAI API / Gemini 只检查模型元数据，Codex 只检查登录，不生成内容，也不证明配额充足。

数据库协议版本 2 继续使用 `desktop_settings`（非密钥 JSON 与 `revision`）和 `desktop_credentials`（按 gemini/openai 分开存密钥）。版本 1 在事务中迁移，保留旧 Gemini 密钥与书库；更旧非密钥 `settings.json` 在新库建立时迁入，原文件保留。损坏、未知或未来版本拒绝启动而不重建。桌面保存通过 revision 比较拒绝过期快照；CLI 在事务内修改最新行。另一入口修改后可用「重新读取设置」刷新再保存。旧版程序可能拒绝版本 2，回退需恢复对应备份。

默认书库位置：macOS 为 `~/Library/Application Support/com.shiqu.desktop/library`，Windows 为 `%APPDATA%\com.shiqu.desktop\library`，Linux 数据目录通常为 `~/.local/share/com.shiqu.desktop/library`。Linux 设置数据库则在 `~/.config/com.shiqu.desktop/`，可由 XDG 路径覆盖。API 密钥与全局设置不在故事目录里；共享故事不会自动携带设置，备份 `desktop.sqlite` 则包含密钥。更换数据目录只切换书架，不搬移或合并。

OpenAI 默认文本模型 `gpt-6.1-sol`、图片模型 `gpt-image-2.5-sunburst`，可分别调整。API 生成使用独立提供方，不回退到 Codex/Gemini。文本任务推荐档位仍为选题 medium、画风 low、幅数 medium、提纲/分镜/审核/修订 high；Gemini 仅支持 low/medium/high，OpenAI API / Codex 的更高档位依模型权限。选择 Gemini 时会把不支持的更高任务档位恢复为该任务推荐值，之后可手动修改并保存。

## 浏览器与手机

桌面版负责启动本地服务、查看运行情况和管理配置，阅读与创作统一在浏览器中完成。三个标签依次为「概览」「生成队列」「设置」；首次尚未配置时先打开设置。概览保留暖白、墨绿的书房视觉，突出「启动并打开拾趣」：保存待提交配置、检查内置运行时、启动成功后再打开默认浏览器。服务已经运行时，主按钮只打开浏览器。启动失败不会打开浏览器；浏览器打开失败会保留已启动的服务，可重试或复制地址。

概览中的「书库一瞥」只统计最新且未删除的本机生成记录，包括已完成、生成任务、待处理和收藏。它不是所有发布样篇或历史版本的总数。待处理包含失败、待选故事、待制作/画幅确认和暂停的记录；未完成且尚无后台任务的记录也能在队列中找到。最近故事保留摘要接口的阅读/创建顺序。摘要每 4 秒只读刷新；加载中或读取失败显示未知状态与重试，不把读取失败显示成空书库。概览不会新建任务或调用生成服务。

运行状态来自原生服务控制器。尚未读取或读取失败时明确显示未知状态，不冒充已停止。生成服务/模型展示已保存配置，不代表环境变量覆盖后的实际提供方，也不表示连接检查成功。故事目录、运行时与手机访问入口保留；设置和密钥仍只在原生设置入口处理。桌面不再嵌入阅读页，不需要额外的 iframe 来源权限。


1. 保存设置并启动服务。新书架为空；阅读已有故事可选择只读而无需 API 密钥，生成新故事需配置提供方。
2. 点击“在浏览器打开”。本机与局域网直接使用 IP 和端口，无需令牌或配对 cookie。局域网始终开启，不提供关闭开关；防火墙需允许所选端口。
3. 同一网络手机在“手机接着读”中选择局域网地址并扫码；HTTP 仅限可信网络，所有可连接设备共享书架和生成权限。
4. 跨网络访问先安装 [cloudflared](https://developers.cloudflare.com/tunnel/downloads/)（macOS：`brew install cloudflared`），停止服务并开启“允许互联网访问”。桌面版使用独立安装的 helper，不自动下载或捆绑它。自动查找 PATH、Homebrew 和常见安装目录，也可填写绝对路径。
5. 保存并启动后选择互联网方式，扫描私密 HTTPS 二维码或复制完整链接。无需账户、域名、路由器转发或手机 VPN。旧配置的 lanEnabled 被忽略，internetEnabled 默认为 false；升级不会静默发布书架。

互联网使用免费 Cloudflare Quick Tunnel；每次启动地址改变，无可用性保证，200 个并发请求上限，不支持 SSE（本应用采用 NDJSON / 轮询）。流量经过 Cloudflare，本地数据仍保留在电脑。首次 DNS 生效可能稍有延迟。电脑需保持唤醒、应用保持运行；手机可以使用其他网络。

本机 / LAN 与公网入口分别处理：主 reader 始终监听 0.0.0.0，并校验已发现的本机 / LAN Host 与同源写入；隧道仅转发到第二个临时 loopback 端口，校验分配的公网 Host，并在所有 reader/API/media 路由前认证。公网响应统一 private,no-store，避免共享缓存绕过认证。原生设置 / 凭据命令不通过 HTTP 暴露。

完整私密二维码使用随机 URL fragment 配对凭据；/connect 清除 fragment，再通过同源 POST 换取独立的 Secure / HttpOnly / SameSite cookie。配对和会话有效期为 12 小时，停服即撤销，不持久化。拿到完整二维码或链接的人拥有当前书架与生成权限，请勿公开分享。重启需重新扫码；没有多用户隔离。

helper 使用隔离的空配置与最小环境，不继承 AI 凭据、Cloudflare token 或用户已有 tunnel 配置，不自动更新，不经过 shell。45 秒内没有 hostname 和已注册连接则仅互联网启动失败，撤销公网入口并清理其临时端口、helper 和配置；本机 / LAN reader、浏览器链接及数据所有权保留，供继续阅读；原生启动等待最多 60 秒。隧道进程退出会撤销公网入口并更新原生状态，LAN 保留；停服重启重试。父进程 EOF / 信号即使发生在启动途中也取消并清理 helper。

关闭窗口后应用留在托盘；停止服务或退出会终止服务器、隧道及生成子进程。Node 通过父进程输入关闭检测退出；目录所有权阻止旧进程尚未退出时新实例覆盖。退回旧版本前请备份设置数据库，新字段可能不被旧程序接受。

## 开发与构建

桌面 UI 开发默认运行 `pnpm desktop:preview`，在应用内浏览器打开 `http://127.0.0.1:1420`，支持热更新，无需准备资源或打包。左侧为概览、生成队列和设置，右侧保留本机运行与手机访问控制。概览和队列读取同一份真实生成记录；浏览器预览不能启停原生服务、修改凭据或读取密钥。界面验证应使用临时书库。

队列与阅读端统一展示「确认原文 → 确定画幅数 → 分批分镜 → 全篇审片 → 定向修订 → 复核 → 绘图」。初审通过时修订与复核标记为无需执行；复核未通过时明确阻止绘图。旧故事没有审片检查点时显示未启用，不补做审核。只在用户明确要求时运行桌面准备、构建或打包命令。

使用 `.nvmrc` 固定的 Node、`package.json` 固定的 pnpm，及 `src-tauri/rust-toolchain.toml` 固定的 Rust 1.93.0。安装对应平台的 [Tauri 系统构建依赖](https://v2.tauri.app/start/prerequisites/)。

预览概览的浏览器入口时，另外启动现有阅读端开发服务，并为桌面预览显式指定地址。以下两条命令在两个终端运行，`/tmp/shiqu-reader-preview` 是独立测试书库；不要用个人书库验证写操作。只读提供方不会调用生成服务：

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

安装包使用 `shiqu-standard-*` 文件名，产物在 `src-tauri/target/release/bundle/`；macOS 可用 `pnpm desktop:build --bundles app` 只生成 `.app`。不构建 Docker 镜像。

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

`pnpm dev` 默认跟随桌面书库设置，局域网 API 可直接访问，所有可连接地址的设备共享书架和生成权限；终端启动不依赖桌面 GUI 正在运行。`pnpm build`、`pnpm start` 和 Docker 入口继续独立运行，显式数据目录配置优先。

## GitHub macOS / Windows 发布

[Desktop 工作流](../.github/workflows/desktop-macos.yml) 使用两个原生 runner：Apple Silicon（`macos-15` / arm64）和 Windows（`windows-2022` / x64）。每个平台只打包内置 Node 的桌面版，产出一个未签名 DMG 与一个未签名 NSIS EXE；不构建 Intel Mac、Windows ARM64 或 Linux 安装包。类型检查、lint、Rust 格式检查、阅读端与桌面 UI 构建及运行资源准备在每个平台执行一次。完整 JavaScript 测试在 macOS 执行；Windows 执行桌面与书库路径测试，Unix Codex CLI / helper 模拟进程测试不在 Windows 执行。

每个平台各运行一次原生测试、打包及资源 smoke 检查。Windows 会静默安装 EXE 到含空格的临时目录，对实际安装后的 runtime 执行 smoke，再卸载。CI 跳过 Tauri 中重复的准备钩子，本地打包命令仍自动准备资源。任一平台失败都会阻止发布。无需 Apple / Windows 签名证书或额外发布密钥；仅发布任务拥有 `GITHUB_TOKEN` 的 `contents: write` 权限。

手动运行或匹配路径的 pull request 只上传 Actions artifacts，不创建 Release。推送 `vX.Y.Z` 正式版本标签后，两个安装包全部构建并检查成功才创建草稿、上传安装包和 `SHA256SUMS.txt`，最后自动公开发布。发布失败可重新运行并继续未发布的草稿；已公开的版本不会覆盖。暂不接受预发布标签。

发布前将 `package.json`、`src-tauri/tauri.conf.json` 和 `src-tauri/Cargo.toml` 的版本更新为同一个 `X.Y.Z`，同步 `src-tauri/Cargo.lock` 中的本应用版本，并提交源码。然后推送对应标签，例如当前版本：

```bash
git tag v0.4.1
git push origin v0.4.1
```

标签所在提交必须包含该工作流及要发布的源码；GitHub 不会打包未提交的本地修改。每个版本使用新的标签。README 的 `/releases/latest/download/` 链接依赖以下固定文件名：

```text
shiqu-standard-macos-arm64.dmg
shiqu-standard-windows-x64-setup.exe
SHA256SUMS.txt
```

Windows 下载链接在 0.4.0 或更新正式版本发布后生效。Windows 安装包未签名，SmartScreen 可能提示风险；仅对确认可信的下载选择「更多信息 → 仍要运行」。macOS 安装包未签名、未公证，首次打开可能需要在「隐私与安全性」中允许。以后若加入正式签名/公证，必须保证最终 Node 字节与清单一致；签名改变 Node 字节后需在最终应用签名前重新生成清单，并运行安装包 smoke 检查。
