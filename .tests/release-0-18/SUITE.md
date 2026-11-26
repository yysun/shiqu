---
schema: test-manager/suite/v1
suite: release-0-18
title: 0.18 签核
risk: MEDIUM
state: PLANNED
owner: Yiyi Sun
planned_start: UNPLANNED
planned_end: UNPLANNED
---

# 0.18 签核

## Purpose and decision

- Purpose: 0.18 尚未开发完成。本套件只放 0.18 的签核记录，不放用例；改动用例在 [changes](../changes/SUITE.md) 中登记。候选冻结时填写签核记录，汇总签核范围、结果、放行与结论。
- Quality decision supported: 0.18.0 能否打标签发布。

## Scope

### In scope

- changes 中 `Target Release` 为 `0.18.0` 的用例，以及下方签核范围列出的 smoke、regression、upgrade、story-lifecycle 用例。

### Out of scope

- 只改文档、测试或内部重构、读者看不到的提交。它们由 regression 覆盖。

## Risks and traceability

| Risk / Requirement | Impact | Required evidence | Case IDs |
| ------------------ | ------ | ----------------- | -------- |
| RS5 · 0.18 的改动没有按承诺工作 | 读者遇到未验证的新行为 | 见 changes 中各用例 | changes 中 `Target Release: 0.18.0` 的用例 |

## Dependencies

- Product / service dependencies: 候选安装包（见 smoke）。
- External systems: 视列入的改动而定。
- Accounts / permissions assumed: 无。

## Environment and data

- Environment: 同 smoke。
- Build source: 候选提交的 8 位短哈希。
- Data sets and reset: 同 smoke 的签核书库。
- Time-zone or clock requirements: 运行时间记 UTC。

## Entry criteria

- 列入范围的改动已合入候选提交，对应用例为 READY。

## Exit criteria

- 见下方签核记录。

## Regression obligation

- 0.18.0 发布后，签核记录保留为该版的发布依据。

## Known limitations and residual risk

- 见签核记录的残余风险。

## 签核记录

> 状态：计划中。候选提交冻结后才填写本节；在此之前，下面的范围只是按已合入改动给出的草案。本节由决定人确认，gate 指示和通过数都不是批准，结论一栏才是。

### 候选构建

| 项目 | 值 |
| --- | --- |
| 版本 | 0.18.0 |
| 候选提交 | 未定 |
| 安装包构建 | 未运行（REGRESSION-C005 的 Actions 链接） |
| macOS 安装包 SHA-256 | — |
| Windows 安装包 SHA-256 | — |

### 签核范围

| 套件 | 用例 | 理由 |
| --- | --- | --- |
| smoke | SMOKE-C001 – SMOKE-C010 | 每版必跑。SMOKE-C010（Windows）是否必须，由决定人在下方「待决定事项」中确定 |
| regression | REGRESSION-C001、C002、C003、C005 | 每版必跑 |
| regression | REGRESSION-C004 不列入 | 截至目前，v0.17.0 之后没有改动提示词、模型调用或制作流程 |
| upgrade | UPGRADE-C001 | 每版必跑 |
| upgrade | UPGRADE-C002、C003 不列入 | 截至目前，`db/library-format.json` 与 `drizzle/` 未改动（格式 4，最新迁移 `0028`） |
| changes | 暂无 | `Target Release` 为 `0.18.0` 的用例。CHANGES-C001（`76106876`）目前为 `UNPLANNED`，尚未决定随 0.17.1 还是 0.18.0 发布 |
| story-lifecycle | 不列入 | 截至目前，本版改动未涉及制作、修订、恢复或阅读 |

准备签核时，按 [changes 的整理步骤](../changes/SUITE.md#整理改动清单) 补齐本版的改动用例；决定随 0.18 发布的用例，把 `Target Release` 改为 `0.18.0` 并加进上表和下面的命令。候选冻结时最后核对一次各行理由。

计算候选构建的结果（只读，`<build>` 换成候选提交的 8 位短哈希）：

```bash
node ~/.agents/skills/test-manager/scripts/test-manager.mjs status --build <build> \
  --case SMOKE-C001 --case SMOKE-C002 --case SMOKE-C003 --case SMOKE-C004 --case SMOKE-C005 \
  --case SMOKE-C006 --case SMOKE-C007 --case SMOKE-C008 --case SMOKE-C009 --case SMOKE-C010 \
  --case REGRESSION-C001 --case REGRESSION-C002 --case REGRESSION-C003 --case REGRESSION-C005 \
  --case UPGRADE-C001
```

### 结果快照

签核时把上述命令的输出粘贴在这里，并注明生成时间。

```text
尚未运行
```

### 失败与放行

| 用例 | 结果 | 处理 | 影响 | 到期版本 | 决定人 |
| --- | --- | --- | --- | --- | --- |

### 残余风险

- smoke 只做一篇简短故事，长篇和故障恢复依赖 story-lifecycle 与自动测试。

### 待决定事项

- Windows 安装包（SMOKE-C010）是否为必须：未定。

### 结论

| 项目 | 值 |
| --- | --- |
| 结论 | 未定（发布 / 不发布） |
| 决定人 | Yiyi Sun |
| 日期 | — |
| 标签 | — |
