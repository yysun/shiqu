---
schema: test-manager/suite/v1
suite: regression
title: 自动回归关卡
risk: HIGH
state: ACTIVE
owner: Yiyi Sun
planned_start: UNPLANNED
planned_end: UNPLANNED
---

# 自动回归关卡

## Purpose and decision

- Purpose: 让签核看到仓库自己的自动检查是否在候选提交上全部通过。每个关卡一条用例，测试内容由仓库测试负责，这里不重复描述。
- Quality decision supported: 每版发布签核。C001 – C003 和 C005 必在签核范围内，C004 按需。

## Scope

### In scope

- `pnpm release:check`、`pnpm test:full`、`pnpm test:assurance`、`pnpm test:models`，以及 `desktop-release` 工作流的安装包构建与冒烟。

### Out of scope

- 单个测试的设计与覆盖（见 `tests/manifest.json` 和 `scripts/test-plan.mjs`）。
- 书籍原文核查 `pnpm test:books`，只在书目原文改动时另行加入签核范围。

## Risks and traceability

| Risk / Requirement | Impact | Required evidence | Case IDs |
| ------------------ | ------ | ----------------- | -------- |
| RS4 自动检查未在候选提交上通过 | 已知回归随版本发布 | 运行输出与退出码 | REGRESSION-C001 – REGRESSION-C005 |

## Dependencies

- Product / service dependencies: 候选提交的干净检出，`pnpm install --frozen-lockfile`。
- External systems: GitHub Actions（C005）。
- Accounts / permissions assumed: 能手动运行 `desktop-release` 工作流的 GitHub 账号。

## Environment and data

- Environment: 维护者的 Mac，Node 与 pnpm 按 `.nvmrc` 和 `packageManager`；C005 在 GitHub Actions 的 macOS 与 Windows 运行器上。
- Build source: 候选提交的 8 位短哈希。在干净工作区运行，不带未提交的改动。
- Data sets and reset: 各命令自带隔离数据，不触碰日常书库。
- Time-zone or clock requirements: 运行时间记 UTC。

## Entry criteria

- `git status` 为空，HEAD 是候选提交。

## Exit criteria

- 每条范围内的用例在候选构建上都是 PASS。

## Regression obligation

- 候选换成新提交时全部重跑。

## Known limitations and residual risk

- 运行结果需要手动登记。证据存放在 `evidence/<run-id>/`，保存命令输出的末尾摘要（通过与失败数、退出码），不存完整日志。
- 测试使用受控模型，不能证明真实服务下的生成质量。
