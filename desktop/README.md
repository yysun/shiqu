# 拾趣 Lite 桌面版

Lite 是现有 Node 应用的 Tauri 2 控制台：填写生成配置，启动服务，在默认浏览器打开，或让同一网络的手机扫码加入。故事、图片和阅读进度仍存放在电脑上的同一份 SQLite/媒体目录。无需 Docker。

## 用户运行要求

先安装 **Node 24**，推荐项目固定的 **24.22.1**。Lite 不包含 Node，也不会自动下载运行时。启动时会检查实际版本和内置 SQLite 功能；找不到时可在设置中选择 Node 可执行文件。macOS 的 nvm 安装通常位于 `~/.nvm/versions/node/v24.22.1/bin/node`；GUI 应用未必继承终端 PATH。

安装包包含编译后的前端、服务器、生产依赖、tokenizer WASM、迁移和 24 本原文。用户无需安装 pnpm 或运行依赖安装。Node、书库和依赖各占一定空间；Lite 只是省去 Node 的分发大小。

在 Windows 上需要 WebView2；Linux 需要 WebKitGTK、托盘支持和可用的 Secret Service 凭据服务。现有 Codex 运行器不支持原生 Windows，Windows 桌面版请使用 Gemini。Gemini 生成仍需联网及有效的模型权限/配额。

## 设置与凭据

Gemini 支持密钥输入、显示/隐藏当前输入、替换和删除，以及文本/图片模型配置。已存密钥只显示保存状态，不会重新返回设置窗口。密钥只保存在系统凭据存储：macOS Keychain、Windows Credential Manager、Linux Secret Service。凭据服务不可用时明确报错，不会回退到明文文件。

Codex 使用本机已登录的 CLI，可设置可执行文件、模型和登录目录。首次登录仍通过终端 `codex login` 完成；桌面连接检查可以验证登录状态。Lite 不包含 Codex CLI。

“检查连接”仅访问 Gemini 模型元数据，或执行 Codex 登录状态检查；不生成内容，不证明实际生成配额。检查可以使用尚未保存的输入，但不会替用户保存。服务运行期间必须先停止，才能更改配置或密钥。

非密钥设置保存在系统应用配置目录的 `com.shiqu.desktop.lite/settings.json`，不读取项目 `.env`。默认数据在系统应用数据目录下的 `library`。macOS 两者通常位于 `~/Library/Application Support/com.shiqu.desktop.lite/`。更换数据目录切换书架，不会搬移文件。不要让 Docker/Node 和桌面版同时使用同一数据目录。

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
```

构建会运行现有 `pnpm build`、单独编译设置 UI，然后将允许的运行资源和生产依赖复制到 `desktop/resources/runtime`。产物在 `src-tauri/target/release/bundle/`；macOS 可用 `pnpm desktop:build --bundles app` 只生成 `.app`。不构建 Docker 镜像。

验证：

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm desktop:prepare
pnpm desktop:test
cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

普通 `pnpm dev`、`pnpm build`、`pnpm start` 和 Docker 行为不变。`.github/workflows/desktop-lite.yml` 在对应 OS runner 上构建 Lite；未签名构建是开发产物，正式分发前需配置平台签名/公证。未提供捆绑 Node 的 Standard 版本。
