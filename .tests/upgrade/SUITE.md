---
schema: test-manager/suite/v1
suite: upgrade
title: 书库升级与回退
risk: HIGH
state: ACTIVE
owner: Yiyi Sun
planned_start: UNPLANNED
planned_end: UNPLANNED
---

# 书库升级与回退

## Purpose and decision

- Purpose: 确认读者换装新版后，原有书库能打开、作品完整；书库格式变化时，升级前有已校验的备份，并且能回退。
- Quality decision supported: 每版发布签核。C001 每版必跑；`db/library-format.json` 或 `drizzle/` 在本版有改动时，C002 和 C003 也列入签核范围。

## Scope

### In scope

- 用上一正式版的书库副本打开候选版本。
- 格式变化时：更早格式的一次升级、整库备份、用备份与旧版应用在另一目录回退。

### Out of scope

- 迁移的逐条结构断言（见仓库的升级与恢复测试，由 REGRESSION-C002、REGRESSION-C003 运行）。

## Risks and traceability

| Risk / Requirement | Impact | Required evidence | Case IDs |
| ------------------ | ------ | ----------------- | -------- |
| RS1 打开后书架为空或作品缺失 | 读者以为作品丢失 | 升级前后的作品数与抽查结果 | UPGRADE-C001、UPGRADE-C002 |
| RS3 升级失败没有回退 | 书库无法使用 | 备份路径、回退后的书架 | UPGRADE-C003 |

## Dependencies

- Product / service dependencies: 候选安装包；回退时需要上一正式版的安装包。
- External systems: 无。
- Accounts / permissions assumed: 维护者本人的电脑。

## Environment and data

- Environment: 维护者的 Mac。
- Build source: 候选提交的 8 位短哈希。
- Data sets and reset: 先退出拾趣，再把书库复制到 `~/shiqu-signoff/<build>/upgrade-<来源版本>`，在控制台把故事数据目录指向副本。日常书库从不直接用于升级或回退，结束后把目录改回原处。证据只记作品数和抽查的作品编号，不记原文。
- Time-zone or clock requirements: 运行时间记 UTC。

## Entry criteria

- 书库副本已建好，复制时拾趣已退出。

## Exit criteria

- 范围内的用例在候选构建上都是 PASS。

## Regression obligation

- 候选换成新提交且改动涉及书库、迁移或启动时重跑。

## Known limitations and residual risk

- 只用维护者自己的书库副本，不能覆盖所有读者的历史数据组合。
