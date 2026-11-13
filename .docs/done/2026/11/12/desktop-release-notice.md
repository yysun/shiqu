# 桌面版更新提醒

拾趣桌面控制台在启动时检查 GitHub 正式发行版。发现新版时显示版本号和「打开官方下载页」。页脚显示当前版本并支持手动检查。

`pnpm test:changed`、范围内的 `pnpm test:pr --files`、类型检查、lint、Rust 格式检查和 25 项 macOS 原生源码测试通过。新增浏览器测试和既有桌面控制台测试在独立 Chromium 中并行通过。当前会话的内置浏览器不可用。浏览器测试使用模拟 Tauri 桥接和 GitHub 响应。原生 WebView 的 CSP 和实际系统浏览器跳转留待安装包验证。

## 验收

- 启动检查和版本比较通过。正式新版出现提醒，同版和旧版不提示。
- 新版提示显示版本并调用固定下载页的原生命令。官方地址实际返回 200。
- 当前版本、手动检查、网络失败反馈和恢复后的重试通过。
- 自动检查失败时保持安静。本地服务可操作，发布请求没有书库或制作依赖。

VR passed: all acceptance criteria complete

VR risk: non-low — 访问 GitHub 并通过原生桥接打开浏览器。  
VR review round: 1; reviewer: reused
