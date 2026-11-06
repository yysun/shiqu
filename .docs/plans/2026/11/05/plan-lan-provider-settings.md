# LAN 生成设置实施计划

Base: `d9005d413928184f15de1f5b20876f92fff0d57e`（起始工作区干净）。
Risk: non-low — 扩大设置与凭据修改的网络访问范围，涉及 dev 代理及 CLI/desktop 正式 HTTP 入口。

## 决策

用户明确要求 LAN 完整编辑。以真实套接字、服务实际私有接口地址/端口和同源请求约束允许范围，不信任转发头，不开放任意域名。使用 Node BlockList 校验 RFC1918、IPv4 链路本地、IPv6 ULA/链路本地及 IPv4 映射地址；实际接口从 networkInterfaces 取得。保留既有回环 Host，LAN peer 必须使用实际私有接口 Host。Vite 在代理前使用同一规则检查原始套接字/Host，通过后覆盖私有证明头；后端依然要求证明和真实回环代理连接。保留规范化路径拒绝、同源 JSON、修订和密钥规则。桌面独立隧道先拒绝设置，不经该处理器。

复用当前表单：接口允许后入口自然恢复。仅更新本机限定文案；失败文案区分可用本机/局域网与不支持的互联网入口。不加入认证系统或热切换。

## 任务

- [x] SS 首项有界探针：隔离真实 dev 服务通过真实私有网卡 Host/peer 读写设置；验证公网/伪造 Host 拒绝。若 Node/Vite 不支持该方案，停止依赖实现并返回 AR。
- [x] 实现共享服务端网络判断并接入 Vite guard 与生产 settings handler，维持 CLI/desktop 正式工作流。
- [x] 更新界面提示、现有 API/实际 dev/CLI/desktop 回归及覆盖清单，验证密钥保密、冲突、跨站、隧道和代理证明。
- [x] 同步 README、desktop/npm/user-guide、内置技能及 changelog 的 LAN 配置规则。
- [ ] 执行影响计划要求的检查、typecheck/lint/native 检查和匹配 E2E，完成独立 CR、VR 与 DD。

## 验证

场景：`.docs/tests/test-lan-provider-settings.md`。使用 Node 24.22.1 / pnpm 11.25.0。先查看 pnpm test:changed --plan；若未知路径触发全量则执行全量，不绕过。原生检查按 native 标志执行。浏览器工具上轮报告 Work 设置禁用；再次验证若仍不可用，用现有自动化测试所需的独立 Playwright 会话完成隔离回归，明确披露会话和证据范围。

## 阶段

AR passed: no blocking architecture flaws
AR risk: non-low — LAN 配置与凭据写入扩大网络信任范围，跨原始 peer 与生产监听器。
AR review round: 1; reviewer: new (`lan_settings_review`)。

实施补充：dev 后端同时要求正确证明和真实 loopback；接口 Host 规范化 IPv6，跳过 scoped 地址。私有来源无法辨认被 SNAT/自建反代伪装的公网请求，文档限定可信 LAN，不承诺任意转发场景。

SS 探针通过：隔离真实 pnpm dev，经私有网卡地址读取/保存 openaiTextModel，跨站、直接后端与 LAN 伪造回环 Host 均拒绝；既有重启及密钥持久化断言通过。`tests/browser-provider-settings.e2e.mjs` 1/1。

SS 实现完成：网络边界、Vite/正式设置 API、LAN 表单提示与使用文档同步。聚焦 API/CLI/desktop 回归 36/36，通过真实私有接口；typecheck/lint 通过。影响计划为 full，172 文件，native=true，正在执行。原生源码检查按 CI 无资源配置执行，24/24 通过，1 项安装包资源用例按既定规则过滤，未执行打包。
