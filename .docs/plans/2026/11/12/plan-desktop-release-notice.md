# 桌面版更新提醒实施计划

Git base: `ad13861`

- [x] 通过桌面 WebView 读取固定的 GitHub 公开 latest release API。请求超时后结束，以 Tauri 应用版本比较正式数字版本号。使用桌面 CSP 为该端点开放连接。通过原生命令在默认浏览器打开固定的官方发布页。
- [x] 控制台启动后检查一次。在页脚显示当前版本和手动检查入口。将新版提醒放在顶部，手动检查无更新或失败时在页脚反馈。
- [ ] 验证版本比较、失败重试、桌面原生命令和浏览器交互。运行仓库影响检查、类型检查、lint 和 macOS 原生源码检查。通过 `pnpm desktop:preview` 核对可见界面。

可行性依据：GitHub 公开 API 对 macOS 和 Windows 的 WebView Origin 都返回 CORS 许可，当前正式发布包含两端的安装包。Tauri 已提供应用版本 API、受限原生桥接和默认浏览器 opener。

AR passed: no blocking architecture flaws. 独立审查确认 Tauri 应用版本权限及原生固定 URL 的可行性。
