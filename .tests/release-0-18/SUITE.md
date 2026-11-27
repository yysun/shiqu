---
schema: test-manager/suite/v1
suite: release-0-18
title: 0.18 签核
risk: MEDIUM
state: ACTIVE
owner: Yiyi Sun
planned_start: UNPLANNED
planned_end: UNPLANNED
---

# 0.18 签核

## Purpose and decision

- Purpose: 汇总 0.18.0 候选构建、结果、放行与结论。Test Manager 发布范围见 [RELEASES.md](../RELEASES.md#0180)，读者可见改动用例见 [changes](../changes/SUITE.md)。
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

候选准备中。下方结论由决定人填写。

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
| smoke | SMOKE-C001 – SMOKE-C010 | macOS 安装包和核心路径每版必跑。SMOKE-C010（Windows）暂列入，等待决定人确认 |
| regression | REGRESSION-C001 – REGRESSION-C005 | 本版改动提示词、模型调用和制作流程，纳入模型回归 |
| upgrade | UPGRADE-C001 | 每版必跑 |
| upgrade | UPGRADE-C002、C003 不列入 | 截至目前，`db/library-format.json` 与 `drizzle/` 未改动（格式 4，最新迁移 `0028`） |
| changes | CHANGES-C001 – CHANGES-C007 | 桌面更新、修订保存、成图预览、草稿保护、制作确认、按条修订和自动修订派发 |
| story-lifecycle | STORY-LIFECYCLE-C044、C045、C046、C049、C055、C057、C061、C066、C069 | 并发保存、继续授权、手改保护、成图复用、定向修订与制作确认 |

计算候选结果时使用 Test Manager 的发布范围。

```bash
node ~/.agents/skills/test-manager/scripts/test-manager.mjs status --release 0.18.0
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
- 候选比当前正式版新，签核期间无法在正式渠道观察发现新版后定位下载入口的分支。

### 待决定事项

- Windows 安装包（SMOKE-C010）是否为必须：未定。

### 结论

| 项目 | 值 |
| --- | --- |
| 结论 | 未定（发布 / 不发布） |
| 决定人 | Yiyi Sun |
| 日期 | — |
| 标签 | — |
