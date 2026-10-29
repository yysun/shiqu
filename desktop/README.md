# 拾趣桌面版

桌面版是现有 Node 应用的 Tauri 2 控制台：填写生成配置，启动服务，在默认浏览器打开，或让手机通过局域网 / 免费互联网隧道扫码加入。故事、图片和阅读进度仍存放在电脑上的同一份 SQLite/媒体目录。无需 Docker。**默认 Standard 内置 Node 24.22.1，安装后直接运行。**

## 用户运行要求

Standard 不要求电脑安装 Node。应用在执行内置运行时前校验 SHA-256，再检查实际版本、平台/架构和 SQLite 功能；资源缺失或损坏时要求重新安装，不会偷偷改用系统 Node。设置页只显示内置运行时状态。

可选的 Lite 不包含 Node，需先安装 Node 24，推荐 24.22.1。Lite 支持自动检测及手动选择可执行文件。macOS 的 nvm 安装通常位于 `~/.nvm/versions/node/v24.22.1/bin/node`；GUI 应用未必继承终端 PATH。两个版本使用同一应用身份、设置和数据目录，是替代安装，不应同时运行。

两个安装包都包含编译后的前端、服务器、生产依赖、迁移和 24 本原文；Standard 另含 Node 及其许可证/第三方声明。用户无需安装 pnpm 或运行依赖安装。项目原有的 tiktoken 分词器包含 WASM，用于 AI 输入预算估算；这不是将应用改为 WASM，普通 Node 后端仍然保留。Node、书库和依赖各占一定空间；Lite 只省去 Node 的分发大小。

macOS 最低版本为 **13.5**，与当前捆绑 Node 的实际最低系统版本一致。在 Windows 上需要 WebView2；Linux 需要 WebKitGTK、托盘支持。现有 Codex 运行器不支持原生 Windows，Windows 桌面版请使用 Gemini。Gemini 生成仍需联网及有效的模型权限/配额。

## 设置与凭据

Gemini 支持密钥输入、显示/隐藏当前输入、替换和删除，以及文本/图片模型配置。**密钥和设置始终保存在本机 SQLite 数据库，退出应用或重启电脑后继续使用。没有仅本次会话模式。数据库中的密钥是明文**，由本机文件权限保护，并非加密存储。两个版本都不再依赖 Keychain / Credential Manager / Secret Service。旧版凭据存储中的密钥不会自动导入或删除，请重新输入。

设置界面只返回密钥是否已保存，不返回密钥内容。启动服务时，通过私有 stdin 管道发送给内置 Node，不通过参数、子进程环境、日志或 HTTP 配置端点发送。

已有数据库密钥优先。每次完整启动桌面应用时，若数据库没有密钥，则从启动环境中的 `GEMINI_API_KEY` 导入并保存；在本次应用运行中删除后不会立刻再次导入。下一次完整启动仍可能从环境导入。环境格式错误只显示不含密钥的提示，仍可在设置中输入有效密钥保存。

`PATH` 只用来查找程序，不存放 API 密钥。不执行 shell 或读取 `.zshrc` / `.env`。先在终端设置环境变量，再直接启动应用可执行文件：

```bash
export GEMINI_API_KEY='your-key'
/Applications/Shiqu.app/Contents/MacOS/shiqu-desktop
```

应用必须完全退出后重新启动才能导入新的环境变量；已运行的单实例不会接受另一次启动的环境。Finder/Dock 启动通常不继承终端环境，推荐直接在设置窗口输入密钥。

Codex 使用本机已登录的 CLI，可设置可执行文件、模型和登录目录。首次登录仍通过终端 `codex login` 完成；桌面连接检查可以验证登录状态。两个版本都不包含 Codex CLI。

“检查连接”仅访问 Gemini 模型元数据，或执行 Codex 登录状态检查；不生成内容，不证明实际生成配额。检查前自动保存当前配置和密钥，再从数据库读取并检查；不会保留未保存的运行配置。服务运行期间必须先停止，才能更改配置或密钥。

设置及密钥保存在系统应用配置目录的 `com.shiqu.desktop/desktop.sqlite`，独立于故事库，不读取项目 `.env`。首次使用会迁移旧版非密钥 `settings.json`，之后只读取数据库，不覆盖后续更改；旧文件保留不动。Unix 下应用配置目录/数据库权限为 0700/0600，Windows 使用用户配置目录的继承 ACL。备份数据库也会包含已保存的明文密钥。默认数据在系统应用数据目录下的 `library`。macOS 两者通常位于 `~/Library/Application Support/com.shiqu.desktop/`。更换数据目录切换书架，不会搬移文件。开发版默认跟随此处的书库路径，也可通过 SHIQU_DATA_DIR 显式指定。共享前需备份、停服并合并已有独立书库；两端都必须使用当前持久队列版本。开发版手机访问同样只需 IP 和端口；Vite 不提供私有书库文件。Docker 仍使用自己的显式挂载目录，不会自动合并。

Codex 模式提供“推理档位”：跟随 Codex 默认、low、medium、high、xhigh、max。Sol 建议先选 low；具体支持取决于模型和 CLI。空值及旧配置缺少该字段时继续继承 CLI 配置。保存后在下次启动服务时生效，服务运行中不能修改。该选项用于应用内所有 Codex 请求，等价于 Node/Docker 的 `CODEX_REASONING_EFFORT`，但桌面版仍只读取自己的设置数据库。显式档位未被 CLI 采用时会报错，不会静默回退。

新版本保存后的设置包含 `codexReasoningEffort`；旧版程序可能拒绝未知字段，回退前请备份设置数据库。


macOS 的“文稿”“桌面”等受保护目录可能等待系统文件访问授权；推荐使用默认应用数据目录。自定义目录请通过“选择”按钮选择，并在系统提示时由你决定是否授权。

## 浏览器与手机

1. 保存设置并启动服务。没有 Gemini 密钥也可以阅读内置示例。
2. 点击“在浏览器打开”。本机与局域网直接使用 IP 和端口，无需令牌或配对 cookie。局域网始终开启，不提供关闭开关；防火墙需允许所选端口。
3. 同一网络手机在“手机接着读”中选择局域网地址并扫码；HTTP 仅限可信网络，所有可连接设备共享书架和生成权限。
4. 跨网络访问先安装 [cloudflared](https://developers.cloudflare.com/tunnel/downloads/)（macOS：`brew install cloudflared`），停止服务并开启“允许互联网访问”。Standard 与 Lite 均使用独立安装的 helper，不自动下载或捆绑它。自动查找 PATH、Homebrew 和常见安装目录，也可填写绝对路径。
5. 保存并启动后选择互联网方式，扫描私密 HTTPS 二维码或复制完整链接。无需账户、域名、路由器转发或手机 VPN。旧配置的 lanEnabled 被忽略，internetEnabled 默认为 false；升级不会静默发布书架。

互联网使用免费 Cloudflare Quick Tunnel；每次启动地址改变，无可用性保证，200 个并发请求上限，不支持 SSE（本应用采用 NDJSON / 轮询）。流量经过 Cloudflare，本地数据仍保留在电脑。首次 DNS 生效可能稍有延迟。电脑需保持唤醒、应用保持运行；手机可以使用其他网络。

本机 / LAN 与公网入口分别处理：主 reader 始终监听 0.0.0.0，并校验已发现的本机 / LAN Host 与同源写入；隧道仅转发到第二个临时 loopback 端口，校验分配的公网 Host，并在所有 reader/API/media 路由前认证。公网响应统一 private,no-store，避免共享缓存绕过认证。原生设置 / 凭据命令不通过 HTTP 暴露。

完整私密二维码使用随机 URL fragment 配对凭据；/connect 清除 fragment，再通过同源 POST 换取独立的 Secure / HttpOnly / SameSite cookie。配对和会话有效期为 12 小时，停服即撤销，不持久化。拿到完整二维码或链接的人拥有当前书架与生成权限，请勿公开分享。重启需重新扫码；没有多用户隔离。

helper 使用隔离的空配置与最小环境，不继承 AI 凭据、Cloudflare token 或用户已有 tunnel 配置，不自动更新，不经过 shell。45 秒内没有 hostname 和已注册连接则仅互联网启动失败，撤销公网入口并清理其临时端口、helper 和配置；本机 / LAN reader、浏览器链接及数据所有权保留，供继续阅读；原生启动等待最多 60 秒。隧道进程退出会撤销公网入口并更新原生状态，LAN 保留；停服重启重试。父进程 EOF / 信号即使发生在启动途中也取消并清理 helper。

关闭窗口后应用留在托盘；停止服务或退出会终止服务器、隧道及生成子进程。Node 通过父进程输入关闭检测退出；目录所有权阻止旧进程尚未退出时新实例覆盖。退回旧版本前请备份设置数据库，新字段可能不被旧程序接受。

## 开发与构建

桌面 UI 开发默认运行 `pnpm desktop:preview`，在应用内浏览器打开 `http://127.0.0.1:1420`，支持热更新，无需准备资源或打包。左侧包含「书架」「生成队列」「设置」，右侧保留服务与手机访问控制。书架及队列每 4 秒刷新桌面已保存目录中的真实数据，显示主题与画风，不启动生成。书架默认按原典书名分组，可切换不分组；支持搜索及收藏筛选。删除前确认，随后可撤销；删除沿用阅读端的隐藏记录机制，不删除故事、媒体或生成检查点，并同步影响阅读端。开发预览中的删除也写入当前书架，写操作仅接受同源请求；界面验证应在临时书架完成。浏览器中的设置仅为只读预览，不读取密钥，也不能启停原生服务。原生应用使用已保存的目录读取同一份摘要。只在用户明确要求时运行桌面准备、构建或打包命令。

使用 `.nvmrc` 固定的 Node、`package.json` 固定的 pnpm，及 `src-tauri/rust-toolchain.toml` 固定的 Rust 1.93.0。安装对应平台的 [Tauri 系统构建依赖](https://v2.tauri.app/start/prerequisites/)。

```bash
nvm use
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm desktop:dev
pnpm desktop:build
# 可选 Lite：
pnpm desktop:build:lite
```

Standard 构建会运行现有 `pnpm build`、单独编译设置 UI，将应用运行资源复制到 `desktop/resources/runtime`，再将构建所用的 **精确 Node 24.22.1 可执行文件和原发行版 LICENSE** 复制到 `desktop/resources/node`，记录版本、平台、架构、来源及 SHA-256。构建环境必须使用完整官方 Node 发行版及同架构的 Rust 工具链；不支持跨平台/跨架构、universal 或 musl 打包，遇到不匹配会停止。用户安装应用时不下载运行时。

Lite 配置清除 bundled-node 功能及 Node 资源映射，准备阶段也移除旧 Node 暂存目录，避免从 Standard 构建中带入运行时。产物在 `src-tauri/target/release/bundle/`；macOS 可用 `pnpm desktop:build --bundles app` 只生成 `.app`。不构建 Docker 镜像。

验证：

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm desktop:prepare
pnpm desktop:test
pnpm desktop:test:lite
pnpm desktop:smoke
(cd src-tauri && cargo fmt --check)
```

`desktop:smoke` 将完整运行资源复制到仓库外的临时目录，使用一次性数据验证直接访问、始终开启的局域网地址（互联网关闭）、示例图片、阅读进度、重启和退出；不调用付费生成。Standard 同时复制并验证内置 Node/许可证的最终字节哈希，使用无系统 Node 的 PATH 启动；Lite 检查 Node 目录不存在。可传入安装包内的 runtime 路径来验证实际打包内容。

`pnpm dev` 默认跟随桌面书库设置，局域网 API 可直接访问，所有可连接地址的设备共享书架和生成权限；终端启动不依赖桌面 GUI 正在运行。`pnpm build`、`pnpm start` 和 Docker 入口继续独立运行，显式数据目录配置优先。

## GitHub macOS 发布

[Desktop macOS 工作流](../.github/workflows/desktop-macos.yml) 仅在 Apple Silicon（`macos-15`）原生 runner 上打包 Standard/Lite，共两个未签名 DMG，不构建 Intel、Windows 或 Linux 版本。每个构建运行本地检查、原生测试及打包后资源的 smoke 检查。无需 Apple 证书、开发者账户或额外发布密钥；发布使用 GitHub 提供的 `GITHUB_TOKEN`，仅发布任务拥有 `contents: write` 权限。

手动运行或匹配路径的 pull request 只上传 Actions artifacts，不创建 Release。推送 `vX.Y.Z` 正式版本标签后，两个构建全部成功才创建草稿、上传安装包和 `SHA256SUMS.txt`，最后自动公开发布。发布失败可重新运行并继续未发布的草稿；已公开的版本不会覆盖。暂不接受预发布标签。

发布前将 `package.json`、`src-tauri/tauri.conf.json` 和 `src-tauri/Cargo.toml` 的版本更新为同一个 `X.Y.Z`，同步 `src-tauri/Cargo.lock` 中的本应用版本，并提交源码。然后推送对应标签，例如当前版本：

```bash
git tag v0.1.0
git push origin v0.1.0
```

标签所在提交必须包含该工作流及要发布的源码；GitHub 不会打包未提交的本地修改。每个版本使用新的标签。README 的 `/releases/latest/download/` 链接依赖以下固定文件名：

```text
shiqu-standard-macos-arm64.dmg
shiqu-lite-macos-arm64.dmg
SHA256SUMS.txt
```

安装包未签名、未公证，首次打开可能需要在 macOS「隐私与安全性」中允许。以后若加入正式签名/公证，必须保证最终 Node 字节与清单一致；签名改变 Node 字节后需在最终应用签名前重新生成清单，并运行安装包 smoke 检查。
