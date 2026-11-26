# 自动回归关卡 Test Cases

Case IDs use `REGRESSION-C001`, `REGRESSION-C002`, and so on. Keep retired IDs; never reuse them.

## REGRESSION-C001 — 发布检查

- State: READY
- Priority: P0
- Type: INTEGRATION
- Requirement / Risk: RS4
- Automation: AUTOMATED
- Owner: Yiyi Sun

### Objective

候选提交通过发布标签推送前要求的同一组检查：类型检查、lint、发布关卡测试与 Rust 格式检查。

### Preconditions

- 干净工作区，HEAD 是候选提交，已执行 `nvm use` 和 `pnpm install --frozen-lockfile`。

### Test Data

- 不适用：命令自带隔离数据。

### Runner Instructions

- 运行 `pnpm release:check`。推送标签时 pre-push 钩子会在隔离检出中再跑一次，这里提前跑，以便在打标签前看到结果。

### Expected Outcome

- 命令退出码为 0。

### Negative Assertions

- 没有被跳过的必跑测试，也没有在工作区留下新文件。

### Evidence Required

- 输出末尾的通过与失败数、退出码、提交哈希。

## REGRESSION-C002 — 全部自动测试

- State: READY
- Priority: P0
- Type: INTEGRATION
- Requirement / Risk: RS4
- Automation: AUTOMATED
- Owner: Yiyi Sun

### Objective

所有登记的自动 JavaScript 测试在候选提交上通过。

### Preconditions

- 同 REGRESSION-C001。

### Test Data

- 不适用：命令自带隔离数据。

### Runner Instructions

- 运行 `pnpm test:full`。

### Expected Outcome

- 命令退出码为 0。

### Negative Assertions

- 没有失败或被取消的测试文件。

### Evidence Required

- 输出末尾的通过与失败数、退出码、提交哈希。

## REGRESSION-C003 — 安全、启动、本机端口与原生测试

- State: READY
- Priority: P0
- Type: INTEGRATION
- Requirement / Risk: RS1, RS4
- Automation: AUTOMATED
- Owner: Yiyi Sun

### Objective

平时只按需运行的安全、启动、loopback 与原生桌面测试在候选提交上通过。

### Preconditions

- 同 REGRESSION-C001，本机已安装 Rust 工具链。

### Test Data

- 不适用：命令自带隔离数据。

### Runner Instructions

- 运行 `pnpm test:assurance`。

### Expected Outcome

- 命令退出码为 0。

### Negative Assertions

- 测试没有读写日常书库或用户设置目录。

### Evidence Required

- 输出末尾的通过与失败数、退出码、提交哈希。

## REGRESSION-C004 — 模型与生成流程测试

- State: READY
- Priority: P1
- Type: CONTRACT
- Requirement / Risk: RS2, RS4
- Automation: AUTOMATED
- Owner: Yiyi Sun

### Objective

提供方契约和需要模型的生成、审片、分镜流程测试在候选提交上通过。

### Preconditions

- 同 REGRESSION-C001。本版改动了提示词、模型调用、提供方或制作流程时列入签核范围。

### Test Data

- 不适用：命令自带隔离数据。

### Runner Instructions

- 运行前确认所选测试不会调用付费服务，再运行 `pnpm test:models`。

### Expected Outcome

- 命令退出码为 0。

### Negative Assertions

- 没有调用未经同意的付费服务。

### Evidence Required

- 输出末尾的通过与失败数、退出码、提交哈希，以及是否使用真实服务。

## REGRESSION-C005 — 安装包构建与冒烟

- State: READY
- Priority: P0
- Type: INTEGRATION
- Requirement / Risk: RS1, RS4
- Automation: AUTOMATED
- Owner: Yiyi Sun

### Objective

对候选提交手动运行 `desktop-release` 工作流，macOS 与 Windows 安装包都能构建并通过 `desktop:smoke`，得到供 smoke 使用的安装包。

### Preconditions

- 候选提交已推送到 GitHub，尚未打标签。

### Test Data

- 不适用。

### Runner Instructions

- 在 GitHub Actions 对候选提交手动运行 `desktop-release`（workflow_dispatch）。下载两个构件并计算 SHA-256。

### Expected Outcome

- 共享检查、两个平台的构建与 `desktop:smoke` 都成功，构件里有 DMG 和 `-setup.exe`。

### Negative Assertions

- 这次运行没有创建或发布 GitHub Release。

### Evidence Required

- Actions 运行链接、两个安装包的 SHA-256。
