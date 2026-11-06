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
- [x] 执行影响计划要求的检查、typecheck/lint/native 检查和匹配 E2E。

## 验证

场景：`.docs/tests/test-lan-provider-settings.md`。使用 Node 24.22.1 / pnpm 11.25.0。先查看 pnpm test:changed --plan；若未知路径触发全量则执行全量，不绕过。原生检查按 native 标志执行。浏览器工具上轮报告 Work 设置禁用；再次验证若仍不可用，用现有自动化测试所需的独立 Playwright 会话完成隔离回归，明确披露会话和证据范围。

## 阶段

AR passed: no blocking architecture flaws
AR risk: non-low — LAN 配置与凭据写入扩大网络信任范围，跨原始 peer 与生产监听器。
AR review round: 1; reviewer: new (`lan_settings_review`)。

实施补充：dev 后端同时要求正确证明和真实 loopback；接口 Host 规范化 IPv6，跳过 scoped 地址。私有来源无法辨认被 SNAT/自建反代伪装的公网请求，文档限定可信 LAN，不承诺任意转发场景。

SS 探针通过：隔离真实 pnpm dev，经私有网卡地址读取/保存 openaiTextModel，跨站、直接后端与 LAN 伪造回环 Host 均拒绝；既有重启及密钥持久化断言通过。`tests/browser-provider-settings.e2e.mjs` 1/1。

SS 实现完成：网络边界、Vite/正式设置 API、LAN 表单提示与使用文档同步。聚焦 API/CLI/desktop 回归 36/36，通过真实私有接口；typecheck/lint 通过。影响计划为 full，172 文件，native=true，执行及复核结果见下文。原生源码检查按 CI 无资源配置执行，24/24 通过，1 项安装包资源用例按既定规则过滤，未执行打包。

SS milestone: `75f712f`。基线与最终源文件之间的审查范围保持不变。

CR passed: no major findings
CR risk: non-low — 允许可信 LAN 修改共享配置/凭据，跨正式设置 handler 与 Vite 原始来源校验。
CR review round: 1; reviewer: reused (`lan_settings_review`)。

浏览器证据：Work 设置两次确认禁用本地浏览器，改用独立 Playwright Chromium 的既有隔离桌面 HTTP 场景；LAN Profile 入口、模型/推理与合成密钥保存、重新读取、检查/重置和失败恢复已经执行。截图 `.data/e2e/desktop-service-console/lan-provider-settings-{1040,390}.png` 已人工查看，两种宽度无横向溢出。此会话不代表用户正在查看的浏览器，也不代表第二台手机的实际网络链路；实际私有接口 HTTP 与 IPv4/IPv6 判断有独立回归。

TT 全量影响计划已执行：172 文件、1437 项，1432 通过，5 项测试注册检查失败；全部失败均为运行期间其他工作新增的未注册 `tests/phone-readability.playwright.e2e.mjs`，不是 LAN 修改。原始日志 `/tmp/shiqu-lan-settings-tests.log`，证据 `.data/test-plans/2026-11-06T03-46-03-973Z-4f90827b/run.json`。保留并行工作，不修改它的注册或夹具。随后在独立 worktree `75f712f` 复跑仅受此干扰的 `tests/test-pr.test.mjs`、`tests/test-tiers.test.mjs`；其余 1432 项通过证据复用。

TT 复核通过：独立 worktree `75f712f`，Node 24.22.1、SHIQU_TEST_TIER=full，7/7（包含全部 5 个受并行工作干扰的失败项），日志 `/tmp/shiqu-lan-settings-isolated-checks.log`。日志里的 `CONTROLLED_PLAN_FAILURE` 是执行器测试主动构造的子进程失败，父测试通过，整体退出 0。与原全量 1432 项通过证据合并，story 的 1437 项均有通过证据；不声称当前混合工作区全量命令退出成功。

ET passed：匹配 LAN 场景的实际 dev、CLI、desktop API 与 LAN Profile 表单均在全量执行中通过；UI 用独立 Chromium、1040/390px，没有真实手机设备验证。typecheck/lint 通过；cargo fmt 与原生源码 24/24 通过、1 包资源用例过滤。未改用户书库/真实配置，未推理、打包或重启用户服务。

VR passed: all acceptance criteria complete

VR risk: non-low — LAN 获得共享配置与凭据修改权限，网络访问边界需保持。

VR review round: 1; reviewer: reused

1. **完成**：真实 dev、CLI、desktop LAN 接口及 Profile 表单通过；提供方、模型、推理、合成密钥保存与重读正常。
2. **完成**：原始 peer、实际接口 Host、代理证明、同源提交、公共来源及隧道拒绝有实现和回归证据。
3. **完成**：密钥不回传、修订冲突、严格字段、共享存储及重启生效行为保持。
4. **完成**：隔离验证、文档与技能同步。全量执行的 1432 项通过可复用；另外 5 项因并行新增未注册测试失败，在稳定提交隔离复跑中全部通过。原生 24/24、fmt、typecheck、lint 通过。

证据限制：原混合工作区全量命令退出失败，不能报告为全绿。UI 使用独立 Playwright Chromium；截图已查看，1040/390px 无横向溢出。未验证第二台物理手机或实际 IPv6 链路；过滤 1 项打包资源测试，未打包。

未执行测试或修改文件。主代理可勾选四项验收标准。

首次验收时原开发进程仍加载旧 Vite guard，LAN 设置 GET 为403；用户随后授权重启，结果见下文。

DD：`.docs/done/2026/11/05/lan-provider-settings.md`。DD 已完成；用户于 2026-11-06 请求 GC，最终验收与交付记录随本次文档提交完成，未推送。

测试范围说明：本次先按影响计划预览，选择器因共享 `lib/reader-api.ts` 变更回退 full；新增网络模块与开发脚本也尚无定向规则。遵循现有回退，没有修改路由来绕过全量。以后应先控制改动范围、明确新增模块影响域，再执行受影响检查；本次不再追加检查。

用户随后明确授权中断并重启现有服务，已按原 `pnpm dev` 启动方式完成。启动环境在内存中保留，未输出或落盘密钥；重启前后 runtime 与启动覆盖名称一致。实际两个私有 LAN 地址的设置接口均 HTTP 200，表单数据存在；跨站读取仍403，reader/status为200。没有修改真实配置或追加测试套件。

后续生成配置的即时生效由 [provider-key-source](plan-provider-key-source.md) 完成；本记录中的重启步骤仅描述当时加载LAN访问修复代码，不是当前模型设置的操作要求。

最终设置页操作收敛已由 `2134f0e` 交付，详见 [交付记录](../../../../done/2026/11/06/provider-settings-actions.md)。本次 GC 仅提交本线程完成的设置故事记录，不包含独立的响应式布局和手机导航草案。
