---
schema: test-manager/root/v1
title: 拾趣发布签核
status: ACTIVE
created: "2026-11-03"
---
# Test Strategy

## 质量目标与发布决定

每个版本发布前，维护者在这里查看候选构建承诺了什么、验了什么、哪里失败、放行了什么、还剩什么风险，据此决定能否发布。

- 每次改动的回归由仓库测试负责（`tests/manifest.json`、`pnpm test:changed`、CI）。本目录只记录签核需要的结论和证据，不复制源码测试。
- 支持的决定：候选构建能否打 `v<版本>` 标签发布。代理执行用例并提交签核请求，守门流程见仓库根目录 `AGENTS.md` 的「发布签核」。
- 决定人：Yiyi Sun（维护者），同时是各风险的负责人。只有决定人能在签核记录中放行未通过的用例。
- 读者可见的改动在准备签核时从 Git 记录和用户指南的改动中整理，在 changes 套件中各有一条用例，`Target Release` 记录随哪个版本发布，未决定时为 `UNPLANNED`。每个计划中的版本有一个 `release-<版本>` 套件，只放该版的签核记录。签核记录是唯一的批准依据。

## 套件

| 套件 | 作用 | 签核范围 |
| --- | --- | --- |
| [smoke](smoke/SUITE.md) | 在候选安装包上执行的核心使用路径 | 每版全部 |
| [regression](regression/SUITE.md) | 仓库自动检查，每个关卡一条用例，证据是该次运行的输出 | 每版全部；C004 按需 |
| [upgrade](upgrade/SUITE.md) | 用旧书库副本验证打开、升级、备份与回退 | 书库格式不变时只跑 C001；格式变化时全部 |
| [changes](changes/SUITE.md) | 读者可见改动的承诺，`Target Release` 标明所属版本 | `Target Release` 为该版本的用例 |
| `release-<版本>` | 该版的签核记录（范围、结果、放行、结论），不放用例 | — |
| [story-lifecycle](story-lifecycle/SUITE.md) | 故事制作与制作 DAG 的详细验收目录及历史证据 | 按影响选取：本版改动涉及的用例列入签核范围，并在签核记录中写明理由 |

## 范围

- 范围内：macOS Apple Silicon 安装包（必须）、Windows x64 安装包（是否必须由每版签核记录决定）、浏览器中的书架、制作与阅读、书库升级、CLI 与发布包的自动检查。
- 范围外：真实模型生成内容的艺术质量、Linux、Intel Mac、Windows ARM64、签名与公证（安装包本就未签名）、Docker 部署。

## 测试层次

- 人工业务端到端：smoke、upgrade、本版新功能。看界面结果，API 和 SQLite 只作只读旁证。
- 自动检查：regression。用仓库自己的命令运行，不另写测试。
- 详细验收：story-lifecycle，用隔离书库与受控模型，必要时用 Playwright 或应用内浏览器。

## 候选构建

- 候选构建是一个干净提交：工作区无改动，`package.json` 已是目标版本。Build 列一律写该提交的 8 位短哈希（`git rev-parse --short=8 HEAD`）。写法不同，`status --build` 就匹配不到。
- 安装包由 GitHub Actions 的 `desktop-release` 工作流对该提交手动运行（workflow_dispatch）产生，只上传构件，不发布。下载后核对 SHA-256，并在证据中记录该次 Actions 运行链接。
- 推送 `v<版本>` 标签会立即构建并公开发布，所以签核必须在打标签之前完成，标签必须指向已签核的候选提交。
- Build 带 `+ working tree` 或其他后缀的运行只算开发证据，不计入签核。
- 候选修复后形成新提交，签核范围内的用例在新构建上重跑。旧运行保留。

## 风险

| 编号 | 风险 | 级别 | 覆盖 |
| --- | --- | --- | --- |
| RS1 | 新版装不上、打不开，或打开后书架为空 | HIGH | smoke、upgrade |
| RS2 | 核心制作、阅读、导出路径中断，或重复发起付费生成 | HIGH | smoke、story-lifecycle |
| RS3 | 升级失败，或没有可用的回退 | HIGH | upgrade |
| RS4 | 自动检查没有在候选提交上全部通过 | HIGH | regression |
| RS5 | 本版改动没有按承诺工作 | MEDIUM | changes |

## 环境与数据

- Node 与 pnpm 版本按 `.nvmrc` 和 `package.json` 的 `packageManager`。
- smoke 使用独立的签核书库：在控制台停止服务后，把故事数据目录改为 `~/shiqu-signoff/<build>`，结束后改回原目录。不在日常书库上执行写操作。
- smoke 的制作会调用维护者配置的真实服务并消耗额度，只做一篇「简短」故事。
- upgrade 只用书库副本，从不对日常书库运行迁移或破坏性操作。回退恢复到另一目录。
- story-lifecycle 的数据规则见其 SUITE.md。
- 时间用 UTC 记录，业务时区为 America/Toronto。证据中不存密钥、令牌或个人原文。

## 进入与退出

进入：候选构建满足上节要求；签核范围内的用例为 READY；安装包已下载并核对。

退出（可以签核）：

1. 签核记录中的 `status --build <候选> --case ...` 命令列出的每条用例，在候选构建上都有 PASS，或有决定人写明的放行。
2. P0 用例没有 FAIL、BLOCKED 或未运行。
3. P1 的 FAIL 或 BLOCKED 要么修复后重跑，要么由决定人放行，并写明影响和最迟修复版本。
4. 残余风险已写入签核记录。

gate 指示只是计算结果，不代表批准。批准只看签核记录中决定人写下的结论。

## 缺陷、放行与证据

- Major：阻断核心路径，或可能丢数据、重复付费。Minor：有可行的绕过办法。
- 缺陷记为 GitHub issue，或写在该次运行的证据文件里，Defect / Blocker 列写链接。
- 失败保留，重跑追加新运行，不改旧行。
- 放行只写在签核记录中，写明用例、理由、影响和到期版本。
- 证据存放在各套件的 `evidence/<run-id>/` 下，随仓库保留。

## 汇报

签核时向决定人汇报：结论、候选构建、范围内用例的结果、失败与放行、残余风险及证据链接。

## 与开发流程的关系

本目录与开发流程（需求、计划、开发文档）各自独立，只互相引用、不互相改写：开发工具不编辑 `.tests`，Test Manager 不编辑 `.docs`。用例可以引用提交或需求文档作为追溯依据。

唯一的例外是 `tests/production-dag-registry.test.mjs`，它读取 `story-lifecycle` 的 SUITE.md 和 CASES.md，防止制作 DAG 原编号 1–59 失去归宿。制作 DAG 验收目录连续一个版本没有改动后，把这项检查改为 Test Manager 一侧的项目规则，或删除。

## 已知限制

- 根目录的 STATUS.md 汇总全部套件和全部历史构建。story-lifecycle 里未运行的用例会让它一直显示 NOT_READY，签核只看签核记录中按构建计算的结果。
- 自动检查的结果目前需要手动登记为运行记录。
