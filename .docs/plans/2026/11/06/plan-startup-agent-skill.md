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
- [ ] P5 先预览 `pnpm test:changed --plan`，执行影响测试、`pnpm typecheck`、`pnpm lint`；native=true 时沿用 CI 的 source cargo test 与 fmt。按场景执行并记录证据，不打包或发布，不使用真实书库。

风险：资源依赖或字体漏装导致独立 CLI 失败；用户修改与安装竞争导致不当覆盖；启动集成误污染帮助/测试路径。通过搬迁运行、保护回归和入口隔离验证。新依赖触发全量覆盖，不规避。

## AR

AR risk: non-low — 用户级安装、更新同意与桌面运行资源。
AR review round: 1; reviewer: new

独立评审确认离线所有权、更新授权与非启动入口隔离可行；实现检查运行时锁内版本/哈希及 CLI 独有可选依赖和字体。

AR passed: no blocking architecture flaws

## 实施证据

隔离聚焦测试 24/24 通过（`/tmp/shiqu-startup-skill-focused.log`），包括真实 CLI 更新、桌面 start/test/upgrade 协议、PATH 无 npm 的搬迁 Node/CLI 与离线锁。typecheck 通过。依赖变更使自身影响预览选择 full=true、native=true，185 JS 文件；不规避全量。

工作区出现并行 reader/UI 改动及 `.claude/`，属于其他工作；本故事不修改、不纳入提交，验证以明确自身文件列表生成计划。
