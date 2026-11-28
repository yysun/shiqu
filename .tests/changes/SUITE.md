---
schema: test-manager/suite/v1
suite: changes
title: 版本改动
risk: MEDIUM
state: ACTIVE
owner: Yiyi Sun
planned_start: UNPLANNED
planned_end: UNPLANNED
---

# 版本改动

## Purpose and decision

- Purpose: 每项读者看得到的改动在这里有一条用例，写明它承诺的结果。用例在准备签核时整理，开发过程不需要在这里登记。用例的 `Target Release` 记录它随哪个版本发布，未决定时写 `UNPLANNED`。
- Quality decision supported: 各版签核。`release-<版本>` 套件的签核范围列入 `Target Release` 为该版本的用例。

## Scope

### In scope

- v0.17.0（`3e823670`）之后合入、面向读者的改动，以及以后每一版的改动。

### Out of scope

- 只改文档、测试或内部重构、读者看不到的提交。它们由 regression 覆盖。

## 整理改动清单

本套件独立于开发流程：开发工具和开发文档不写入 `.tests`，这里也不改动开发文档。准备某版签核时，从原始记录整理改动：

1. `git log <上一标签>..<候选或当前主分支>`：找出读者看得到的提交。
2. `git diff <上一标签>..<候选或当前主分支> -- .docs/user-guide.md`：用户指南的改动通常意味着读者可见的行为变化，用来补齐提交说明不清楚的改动。
3. 每项读者可见的改动若还没有用例，就新增一条，在 `Requirement / Risk` 中引用提交哈希，需要时也引用需求文档路径。只改文档、测试或内部实现的提交不建用例。
4. 签核时如果在发布说明或读者反馈里发现没有用例的行为变化，说明清单漏了，在签核记录中注明，并为该改动补建用例。

## 版本归属

- 新用例的 `Target Release` 默认是 `UNPLANNED`。
- 决定发布版本后，只改 `Target Release`（例如 `0.17.1`、`0.18.0`），并把用例 ID 加进该版签核记录的范围。用例留在本套件，不搬到其他套件，ID 不变，已有运行仍然有效。
- 计划改变时，把 `Target Release` 改为新版本，并从原版本的签核范围中移除。
- 版本发布后，`Target Release` 保留为该版本，作为发布事实。

| Case ID | 改动 | Target Release |
| --- | --- | --- |
| CHANGES-C001 | 手动检查更新后的结果提示 | 0.18.0 |
| CHANGES-C002 | 保存为新版后从所属步骤继续 | 0.18.0 |
| CHANGES-C003 | 成图影响预览与画风转换 | 0.18.0 |
| CHANGES-C004 | 未保存分镜与合并草稿保护 | 0.18.0 |
| CHANGES-C005 | 首次预计幅数、实际幅数与刷新边界 | 0.18.0 |
| CHANGES-C006 | 按条自动修改和向草稿应用建议 | 0.18.0 |
| CHANGES-C007 | 局部事实问题按出错字段修订 | 0.18.0 |
| CHANGES-C008 | 手动清理无法使用的旧备份并保护回退备份 | 0.18.0 |
| CHANGES-C009 | CLI 共享书库服务与继续制作授权 | 0.18.0 |
| CHANGES-C010 | 桌面接入与共享服务停服 | 0.18.0 |
| CHANGES-C011 | 横图套图与横版、Letter PDF 试印 | 0.18.0 |
| CHANGES-C012 | 服务在线时创建一致的书库快照 | 0.18.0 |

## Risks and traceability

| Risk / Requirement | Impact | Required evidence | Case IDs |
| ------------------ | ------ | ----------------- | -------- |
| RS5 · `76106876` 手动检查更新后的结果提示 | 读者不知道是否已是最新 | 控制台截图 | CHANGES-C001 |
| `1fb7a75a`、`9f0e9383` 旧备份清理 | 残留占用空间，或误删仍用于回退的备份 | 隔离样本的确认、回退保护与清理结果 | CHANGES-C008 |
| `2be95ef3`、`dedc1aaf`、`6a3cdc21` 共享书库服务 | 重复启动、丢失已领取步骤、重复调用或空闲书库无法备份 | 独立运行的 CLI、桌面控制、原生及备份证据 | CHANGES-C009、CHANGES-C010、CHANGES-C012 |
| `b8337d5d` 至 `ff3f9a9a` 横图交付 | 误删成图、串用画风、打印错套图或配文 | 正式制作和导出路径，既有隔离浏览器及试印证据 | CHANGES-C011 |

## Dependencies

- Product / service dependencies: 候选安装包（见 smoke）。
- External systems: 视改动而定，写在各用例中。
- Accounts / permissions assumed: 无。

## Environment and data

- Environment: 同 smoke。
- Build source: 目标版本候选提交的 8 位短哈希。
- Data sets and reset: 同 smoke 的签核书库。
- Time-zone or clock requirements: 运行时间记 UTC。

## Entry criteria

- 改动已合入候选提交，对应用例为 READY。

## Exit criteria

- 目标版本签核范围内的用例在候选构建上为 PASS，或在该版签核记录中有放行。

## Regression obligation

- 版本发布后，用例仍是该承诺的依据。后续改动影响同一承诺时，在相应版本的签核范围中再列入。

## Known limitations and residual risk

- CHANGES-C001：发现新版后定位下载入口，只有在比候选版本更新的正式版存在时才能看到，签核前无法观察。`tests/desktop-release-update.test.mjs` 只验证版本比较，没有覆盖焦点定位。列入某版签核时，把这条写进该版的残余风险。
