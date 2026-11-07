# 启动技能集成实施计划

Git base: `7d28fbd`（main，进入时工作区干净）。

从工作树移植 startup helper 与技能生命周期扩展，保留 main 的离线 CLI。普通启动成功后执行，无网络技能准备失败可报告但不破坏服务；桌面 helper 仅在原生 start 路由开启，测试 API 默认关闭以隔离用户目录。

## 决策与边界

- 安装到当前用户 `~/.agents/skills/shiqu`。自动安装默认开启，独立偏好与单次关闭可用；不把安装同意当作更新同意。
- 使用小型 TOML 解析库只读识别 Codex 的技能停用与插件选择，解析失败保守跳过，不修改配置。
- 共用 `cli-skill.ts` 的锁、哈希、版本和原 autoUpdate；运行时记录也受哈希保护，竞争时不得覆盖较新安装。普通启动不查 npm registry。
- 桌面用独立 `agent-cli.ts` 包装正式 `runCli`，资源复制收集桌面与 CLI 入口的外部依赖并补齐字体、技能与版本元数据。通过生产资源 helper 的隔离临时打包验证，不运行 desktop prepare/build。
- 技能优先校验并调用受管绝对 runtime 命令；失效时报告，不静默安装 Node/npm。记录 `command` 用参数数组执行。直接 CLI 仍不能与服务同时持有书库。

## 实施

- [x] P1 移植 `server/agent-skill.ts` 与 `cli-skill.ts` 生命周期扩展；增加 TOML 依赖、独立偏好路由和 CLI 成功启动接入。
- [x] P2 增加生产 `agent-cli.ts` 与桌面 start 集成、资源依赖/资产 helper、原生环境白名单及可见安装状态。
- [x] P3 同步 `skills/shiqu/SKILL.md`、README、npm/桌面说明及 `.docs/use-as-skill.md`，只描述 main 能力。
- [x] P4 添加隔离生命周期/真实 CLI/桌面 start/搬迁 CLI 回归，登记 manifest 及 covers。包含启动失败、非启动命令、已有授权和 runtime 保护。
- [x] P5 先预览 `pnpm test:changed --plan`，执行影响测试、`pnpm typecheck`、`pnpm lint`；native=true 时沿用 CI 的 source cargo test 与 fmt。按场景执行并记录证据，不打包或发布，不使用真实书库。

风险：资源依赖或字体漏装导致独立 CLI 失败；用户修改与安装竞争导致不当覆盖；启动集成误污染帮助/测试路径。通过搬迁运行、保护回归和入口隔离验证。新依赖触发全量覆盖，不规避。

## AR

AR risk: non-low — 用户级安装、更新同意与桌面运行资源。
AR review round: 1; reviewer: new

独立评审确认离线所有权、更新授权与非启动入口隔离可行；实现检查运行时锁内版本/哈希及 CLI 独有可选依赖和字体。

AR passed: no blocking architecture flaws

## 实施证据

隔离聚焦测试 24/24 通过（`/tmp/shiqu-startup-skill-focused.log`），包括真实 CLI 更新、桌面 start/test/upgrade 协议、PATH 无 npm 的搬迁 Node/CLI 与离线锁。typecheck 通过。依赖变更使自身影响预览选择 full=true、native=true，185 JS 文件；不规避全量。

工作区出现并行 reader/UI 改动及 `.claude/`，属于其他工作；本故事不修改、不纳入提交，验证以明确自身文件列表生成计划。

实现里程碑：`5f3c0f6`，仅提交本故事 26 个文件。其父提交包含并行 shelf 工作，本故事的 diff/评审范围以该里程碑的路径与内容为准，进入时 base 保留不变。

## CR

CR risk: non-low — 用户级写入、更新授权与运行资源。
CR review round: 1; reviewer: reused

独立评审覆盖启动路由、锁内版本/哈希复查、受管副本保护、CLI 依赖/字体与离线契约，无主要发现。

CR passed: no major findings

## 验证进行中

- typecheck、lint、cargo fmt 通过；native source cargo test 按 CI 资源排除执行，25 passed，1 filtered（未准备安装包资源）。
- 共享目录首次全量遇到并行删除 ShelfStoryDetail.tsx 后、相关测试仍导入该文件的错误；停止该次运行，未修改并行代码以消除失败。
- 在仓库外临时 detached worktree `5f3c0f6` 安装冻结依赖后执行 full source coverage，隔离并行变更。完成后复制证据并删除临时 worktree。
- `pnpm desktop:preview` 已启动；CUA 返回 Browser is not available: iab，open_in_codex 返回 queued，无法观察当前线程内嵌预览。ServiceCard 状态文案以组件渲染测试核对；不声称视觉验收通过，不切换用户浏览器。

CR 第二轮（reused）确认 packaged smoke 使用临时 HOME/USERPROFILE/APPDATA/LOCALAPPDATA 隔离，避免未来 smoke 写入用户技能；`CR passed: no major findings`。使用指南中所有相关 Node/npm 前置说明已区分桌面与 NPX。

后续里程碑：`5372ca7`，隔离 smoke 用户目录及统一桌面/NPX 前置说明。lint 与 `node --check scripts/desktop-smoke.mjs` 通过。真实搬迁测试和组件状态渲染在 full 标志下再次通过；最终聚合结果尚在等待。

用户另行要求删除 MCP worktree、保留分支：已将其未提交修改（含 untracked）保存为 stash `75a1d02e5d0f1f07cf130702e1104e5007a043db` 后移除目录；`codex/mcp-story-workflow` 保留在 `a73ffbe`，未将 MCP 改动带入本故事。

隔离全量第一轮完成 185 文件、1537 项：1536 passed，1 failed。失败为本故事 manifest 漏登记 `lib/system-settings.ts`（新测试直接导入），不是生产失败。补齐 covers，不改变测试/生产行为，先回归 test-tiers，再对最终提交重跑全量；保留首轮失败证据。

## 最终验证

冻结 `ebf47fec30bee911d79f8aa94a18847c58fc61cf` 的全量 185 文件、1537 项全部通过，fail/skipped/cancelled=0，退出码 0。证据已复制到主目录 `.data/test-plans/2026-11-06T23-50-22-469Z-3f1536aa/`（run.json、test.log）。同目录保存冻结 typecheck/lint、Node 24 原生 25 passed / 1 filtered、metadata 3/3 回归记录。Node 24.22.1、pnpm 11.25.0；cargo fmt 通过。

该冻结运行包含生产 CLI/桌面实际启动、更新同意、运行时哈希/竞争、无 npm 的搬迁 Node/CLI/导出和组件状态文案场景。未做桌面 prepare/build 或发布；内嵌浏览器不可用仅记录尝试与限制，不称为视觉验收通过。共享目录并行 UI 代码未改动或纳入本故事提交。

CR risk: non-low — 启动集成与影响元数据。
CR review round: 3; reviewer: reused
CR passed: no major findings

## VR

VR risk: non-low — 用户级自动安装、既有更新授权与桌面运行时分发。
VR review round: 1; reviewer: reused

独立验收确认 AC1–AC5 complete；完整逐项证据与边界见 `.docs/done/2026/11/06/startup-agent-skill.md`。

VR passed: all acceptance criteria complete
