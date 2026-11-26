---
schema: test-manager/suite/v1
suite: smoke
title: 候选版本冒烟
risk: HIGH
state: ACTIVE
owner: Yiyi Sun
planned_start: UNPLANNED
planned_end: UNPLANNED
---

# 候选版本冒烟

## Purpose and decision

- Purpose: 在候选安装包上走一遍读者最常用的路径，确认这个版本能装、能用、不丢东西。
- Quality decision supported: 每版发布签核。全部用例都在签核范围内。

## Scope

### In scope

- macOS Apple Silicon 候选安装包：安装、启动、配置服务、做一篇短故事、阅读、修改、导出、删除与撤销、重启后保持。
- Windows x64 候选安装包的安装与启动（C010）。

### Out of scope

- 生成内容的艺术质量、所有分支与故障恢复（见 story-lifecycle）、书库升级（见 upgrade）。

## Risks and traceability

| Risk / Requirement | Impact | Required evidence | Case IDs |
| ------------------ | ------ | ----------------- | -------- |
| RS1 装不上或打不开 | 读者无法使用新版 | 控制台截图、版本号 | SMOKE-C001、SMOKE-C010 |
| RS2 核心路径中断或重复付费 | 读者做不出、读不了或导不出故事 | 制作流程、阅读页、导出文件 | SMOKE-C002 – SMOKE-C009 |

## Dependencies

- Product / service dependencies: 候选提交上手动运行 `desktop-release` 工作流得到的安装包。
- External systems: 维护者配置的文字与图片服务（会消耗额度）。
- Accounts / permissions assumed: 维护者本人的电脑和服务凭据，凭据不写入证据。

## Environment and data

- Environment: 维护者的 Mac（macOS 13.5 或更新）；C010 另需一台 Windows 10/11 x64。
- Build source: 候选提交的 8 位短哈希，与 TESTING.md 的写法一致。
- Data sets and reset: 开始前在控制台停止服务，把故事数据目录改为 `~/shiqu-signoff/<build>`（新的空目录）。结束后改回原目录，签核目录可保留到发布后。原文使用内置书目中的一章短篇。
- Time-zone or clock requirements: 运行时间记 UTC。

## Entry criteria

- 安装包已下载，SHA-256 与 REGRESSION-C005 记录的值一致。
- 已切换到签核书库，且不是日常书库。

## Exit criteria

- 每条用例在候选构建上都有 PASS，或在签核记录中有放行。

## Regression obligation

- 候选换成新提交时全部重跑。C003 – C008 可沿用 C003 做出的同一篇故事。

## Known limitations and residual risk

- 只覆盖每条路径的正常走法，故障分支不在这里证明。
- 一篇「简短」故事不能代表长篇制作的耗时和调用次数。
