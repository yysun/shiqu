# 拾趣桌面版

桌面版是现有 Node 应用的 Tauri 2 控制台：填写生成配置，启动服务，在默认浏览器打开，或让同一网络的手机扫码加入。故事、图片和阅读进度仍存放在电脑上的同一份 SQLite/媒体目录。无需 Docker。**默认 Standard 内置 Node 24.22.1，安装后直接运行。**

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

设置及密钥保存在系统应用配置目录的 `com.shiqu.desktop/desktop.sqlite`，独立于故事库，不读取项目 `.env`。首次使用会迁移旧版非密钥 `settings.json`，之后只读取数据库，不覆盖后续更改；旧文件保留不动。Unix 下应用配置目录/数据库权限为 0700/0600，Windows 使用用户配置目录的继承 ACL。备份数据库也会包含已保存的明文密钥。默认数据在系统应用数据目录下的 `library`。macOS 两者通常位于 `~/Library/Application Support/com.shiqu.desktop/`。更换数据目录切换书架，不会搬移文件。不要让 Docker/Node 和桌面版同时使用同一数据目录。

Codex 模式提供“推理档位”：跟随 Codex 默认、low、medium、high、xhigh、max。Sol 建议先选 low；具体支持取决于模型和 CLI。空值及旧配置缺少该字段时继续继承 CLI 配置。保存后在下次启动服务时生效，服务运行中不能修改。该选项用于应用内所有 Codex 请求，等价于 Node/Docker 的 `CODEX_REASONING_EFFORT`，但桌面版仍只读取自己的设置数据库。显式档位未被 CLI 采用时会报错，不会静默回退。

新版本保存后的设置包含 `codexReasoningEffort`；旧版程序可能拒绝未知字段，回退前请备份设置数据库。


macOS 的“文稿”“桌面”等受保护目录可能等待系统文件访问授权；推荐使用默认应用数据目录。自定义目录请通过“选择”按钮选择，并在系统提示时由你决定是否授权。

## 浏览器与手机

1. 保存设置并启动服务。没有 Gemini 密钥也可以阅读内置示例。
2. 点击“在浏览器打开”。应用生成的配对链接会交换为 HttpOnly 会话 cookie，随后移除 URL 片段。
3. 手机使用前先启用“允许手机在同一网络访问”，再启动服务；扫描二维码或复制手机配对链接。多个网卡可切换地址。配对设备拥有当前单用户书架和生成权限，请只分享给可信设备。

默认仅监听本机。局域网访问采用 HTTP，适用于可信家庭网络；它不提供链路加密或多用户隔离，也不应暴露到互联网。电脑必须保持唤醒、应用保持运行、设备位于同一网络，防火墙允许所选端口。重启撤销旧会话及链接，需要重新配对；更换网络后重启服务刷新地址。手机扫描成功与否还受 Wi-Fi 客户端隔离和防火墙影响。

关闭窗口后应用留在托盘；从托盘打开设置、停止服务或退出。退出会停止服务器及生成子进程。端口冲突时换用其他端口。桌面崩溃时 Node 通过父进程输入关闭检测退出；Node 自身的目录所有权会阻止尚未退出的旧进程被新实例覆盖。

## 开发与构建

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

`desktop:smoke` 将完整运行资源复制到仓库外的临时目录，使用一次性数据验证配对、局域网地址、示例图片、阅读进度、重启和退出；不调用付费生成。Standard 同时复制并验证内置 Node/许可证的最终字节哈希，使用无系统 Node 的 PATH 启动；Lite 检查 Node 目录不存在。可传入安装包内的 runtime 路径来验证实际打包内容。

普通 `pnpm dev`、`pnpm build`、`pnpm start` 和 Docker 行为不变，终端启动不依赖桌面程序。`.github/workflows/desktop-lite.yml` 在对应 OS runner 上分别构建 Standard/Lite；Windows 运行桌面专项测试，现有 POSIX CLI 假程序的完整测试在 macOS/Linux 执行。未签名构建是开发产物；正式签名/公证分发时必须保证最终 Node 字节与清单一致，签名改变 Node 字节后需在最终应用签名前重新生成清单，并运行安装包 smoke 检查。
