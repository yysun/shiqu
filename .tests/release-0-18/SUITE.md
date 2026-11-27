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

候选已冻结。下方结论由决定人填写。

### 候选构建

| 项目 | 值 |
| --- | --- |
| 版本 | 0.18.0 |
| 候选提交 | `676a5335`，通过 [Main CI](https://github.com/yysun/shiqu/actions/runs/46072271501) |
| 安装包构建 | [Desktop release 46072460303](https://github.com/yysun/shiqu/actions/runs/46072460303) 两平台通过 |
| macOS 安装包 SHA-256 | `b5db6fa9720c522a69e1b6c38482c2659e54e15e7a32ab604d4c67526f8c5a45` |
| Windows 安装包 SHA-256 | `2008281094797deee865501f7f73a776f1136be4cbabf96a4f57f6025c8035eb` |

### 签核范围

| 套件 | 用例 | 理由 |
| --- | --- | --- |
| smoke | SMOKE-C001 – SMOKE-C009 | macOS 安装包和核心路径每版必跑。维护者指定 Windows x64 在 GitHub Actions 验证，由 REGRESSION-C005 记录 |
| regression | REGRESSION-C001 – REGRESSION-C005 | 本版改动提示词、模型调用和制作流程，纳入模型回归 |
| upgrade | UPGRADE-C001 | 每版必跑 |
| upgrade | UPGRADE-C002、C003 不列入 | 截至目前，`db/library-format.json` 与 `drizzle/` 未改动（格式 4，最新迁移 `0028`） |
| changes | CHANGES-C001 – CHANGES-C007 | 桌面更新、修订保存、成图预览、草稿保护、制作确认、按条修订和自动修订派发 |
| story-lifecycle | STORY-LIFECYCLE-C044、C045、C049、C055、C057、C061、C066、C069 | 并发保存、继续授权、手改保护、成图复用、定向修订与制作确认 |
| story-lifecycle | STORY-LIFECYCLE-C046 不列入 | 现行界面没有草案的配文联动画面选项。单改配文后保留原图由 SMOKE-C006 覆盖 |

计算候选结果时使用 Test Manager 的发布范围。

```bash
node ~/.agents/skills/test-manager/scripts/test-manager.mjs status --release 0.18.0
```

### 结果快照

2026-11-27 22:33 UTC。Test Manager 对当前候选 `676a5335` 的 30 项用例计算结果为 29 项 PASS、1 项 FAIL，未运行 0 项，INVALID 0 项，关卡 `REVIEW`。各用例的运行号和证据可用上方命令查询。

### 失败与待放行

| 用例 | 结果 | 处理 | 影响 | 到期版本 | 决定人 |
| --- | --- | --- | --- | --- | --- |
| [CHANGES-C001](../changes/evidence/20261127-676a5335/update-check-offline.md) | FAIL | 维护者断网复核显示「已是最新版本」。受控实验复现默认 HTTP 缓存可导致误报。修复后用新候选先联网检查，再断网复核 | 用户会把缓存评估当成刚完成的更新检查 | — | Yiyi Sun |

上一候选 `41f60106` 的原生目录锁和模型结构审查断言各失败一次。当前候选已重跑通过，见 [回归运行记录](../regression/RUNS.md)。

### 残余风险

- smoke 只做一篇简短故事，长篇和故障恢复依赖 story-lifecycle 与自动测试。
- 候选比当前正式版新，签核期间无法在正式渠道观察发现新版后定位下载入口的分支。
- Windows GitHub Actions 验证安装与运行时。Windows 控制台与书架的人工交互不在本版签核范围内。

### 待维护者确认

- 原计划列入的 STORY-LIFECYCLE-C046 仍是草案。其配文与画面联动的复选框缺少现行入口。当前范围按实际入口用 SMOKE-C006 验证单改配文和原图保留，请在签核时确认这处范围调整。

### P0 抽样复核

- 请复核随机抽中的 SMOKE-C009（运行号 `20261127T222434Z-SMOKE-C009-R1`）。[证据](../smoke/evidence/20261127-676a5335/delete-restart.md)

### 通过项与证据

- 安装包与回归关卡通过，见 [自动回归记录](../regression/RUNS.md)。旧 0.17.0 书库可打开，见 [升级运行记录](../upgrade/RUNS.md)。
- macOS 安装包冒烟 9 项通过，见 [冒烟运行记录](../smoke/RUNS.md)。
- 本版改动 6 项与制作流程 8 项通过，见 [改动运行记录](../changes/RUNS.md)和 [制作流程运行记录](../story-lifecycle/RUNS.md)。

### 结论

| 项目 | 值 |
| --- | --- |
| 结论 | 未定（发布 / 不发布） |
| 决定人 | Yiyi Sun |
| 日期 | — |
| 标签 | — |
