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

# 拾趣 0.18.0 发布签核

## 签核记录

**0.18.0 · 候选 `73d6a181` · 9/9 项通过，待维护者签核。**

本次包含横图套图与试印、CLI 和桌面共享书库、停服与在线备份。

| 批准前看这三项 | 结果 |
| --- | --- |
| 当前失败与放行 | 已执行的用例全部通过，无待放行项。此前的测试登记问题已修正。 |
| 发布阻塞 | 测试与构件校验均已完成。待维护者填写下方结论。 |
| 剩余风险 | 3 个历史兼容夹具按条件跳过。候选的原生窗口和实体打印未手工验证。[详细说明](#残余风险) |

### P0 抽查

- 请抽查 **全量自动回归**（`REGRESSION-C002`），运行号 `20261128T042112Z-REGRESSION-C002-R3`。[通过记录](../regression/evidence/20261128-73d6a181/full.md)

### 结论

**由维护者填写。** 抽查证据后，在「结论」填 `发布` 或 `不发布`，并填写日期。批准后按此候选提交打标签。

| 项目 | 值 |
| --- | --- |
| 结论 | 未定（发布 / 不发布） |
| 决定人 | Yiyi Sun |
| 日期 | — |
| 标签 | — |

## 详细证据

维护者要求将近期提交全部纳入 0.18.0，沿用已取得的测试结果。

### 本候选范围

- 横图交付至 `ff3f9a9a`，包括缺失恢复、套图管理及横版和 Letter PDF 试印。
- 「CLI 启动并接入书库服务」和「桌面复用书库服务」随 `05af0ead` 合入，范围包含停服与重启、制作授权及在线备份。
- `05af0ead` 到本候选只更新发布说明和共享服务测试的依赖登记。旧构建及既有手工验收的结果保留原提交。

### 候选构建

| 项目 | 值 |
| --- | --- |
| 版本 | 0.18.0 |
| 候选提交 | `73d6a18149c351155945d302c2aad2e981de7117` |
| Main CI | [46106885926](https://github.com/yysun/shiqu/actions/runs/46106885926) 通过 |
| 安装包构建 | [Desktop release 46107013543](https://github.com/yysun/shiqu/actions/runs/46107013543) 双平台通过 |
| macOS 安装包 SHA-256 | `2ac0163b10e049475c6c78688d5dd6548dea667dac962ff30206b656357c82ed` |
| Windows 安装包 SHA-256 | `29deca29d615b8f3773eea43e5d9b334140c7af6b75bdb17781efb61735ae7b3` |

### 签核范围

| 套件 | 用例 | 理由 |
| --- | --- | --- |
| 自动回归 | REGRESSION-C001、C002、C003 | 新候选发布、全量自动回归与安全启动原生关卡 |
| 自动回归 | REGRESSION-C005 | 重建 macOS arm64 和 Windows x64 安装包，核对构件和两平台打包冒烟。Windows x64 安装在 GitHub Actions 验证 |
| 版本改动 | CHANGES-C008 至 C012 | 复用本候选自动关卡中实际执行的旧备份清理、共享服务、停服、横图和在线备份场景 |

维护者 Yiyi Sun 要求「除非需要不要重复测试」。既有手工验收、未受影响的业务用例和断网更新检查沿用原始证据。本次运行必跑关卡，复用其中覆盖新改动的结果，避免同一场景另外执行。标签推送由仓库钩子运行 `release:check`。

计算候选结果时使用 Test Manager 的发布范围。

```bash
node ~/.agents/skills/test-manager/scripts/test-manager.mjs status --release 0.18.0
```

### 候选测试证据

| 通过项 | 结果与证据 |
| --- | --- |
| REGRESSION-C001 | 发布门禁 15 项通过。[记录](../regression/evidence/20261128-73d6a181/release-check.md) |
| REGRESSION-C002 | 764 项通过、3 项条件跳过。[记录](../regression/evidence/20261128-73d6a181/full.md) |
| REGRESSION-C003 | 328 项 JavaScript 与 31 项 macOS 原生通过。[记录](../regression/evidence/20261128-73d6a181/assurance.md) |
| REGRESSION-C005 | 双平台安装包构建及冒烟通过，两个安装包 SHA-256 已复核。[记录](../regression/evidence/20261128-73d6a181/desktop-builds.md) |
| CHANGES-C008 | 缺少归属记录时的清理、回退保护与中断清理通过。[记录](../changes/evidence/20261128-73d6a181/backup-cleanup.md) |
| CHANGES-C009、C010、C012 | CLI 共用实例、制作授权、桌面接入与停服、在线备份通过。[正式入口](../changes/evidence/20261128-73d6a181/shared-service.md) · [macOS 包内验证](../changes/evidence/20261128-73d6a181/packaged-shared-service.md) |
| CHANGES-C011 | 横图套图、历史稿件、在途删除保护、横版与 Letter 试印通过。[记录](../changes/evidence/20261128-73d6a181/landscape.md) |

### 已修复的历史失败

| 用例 | 结果 | 处理 | 影响 | 到期版本 | 决定人 |
| --- | --- | --- | --- | --- | --- |
| [CHANGES-C001](../changes/evidence/20261127-676a5335/update-check-offline.md) | `676a5335` 失败 | 原生断网检查显示「已是最新版本」。`2ca9d691` 已绕过 HTTP 缓存并通过独立复测 | 旧候选会把缓存评估当成刚完成的更新检查 | — | Yiyi Sun |
| [CHANGES-C008](../changes/evidence/20261127-9f0e9383/backup-cleanup.md) | `1fb7a75a` 本机试用部分清理 | `9f0e9383` 增加有限重试，核对目录清除，并在仍有残留时显示实际路径。内置运行时和故障注入通过 | 旧构建会移出列表但留有部分文件，真实残留保留 | — | Yiyi Sun |
| [REGRESSION-C003](../regression/evidence/20261128-928f71d2/assurance.md) | `928f71d2` 失败 | `73d6a181` 补齐 7 条测试依赖登记，定向检查及新候选完整保障检查通过 | 依赖变更时共享服务测试可能漏选 | — | Yiyi Sun |

早期候选 `41f60106` 的原生目录锁和模型结构审查断言各失败一次，已在 `676a5335` 重跑通过。见 [回归运行记录](../regression/RUNS.md)。

### 残余风险

- `676a5335` 的安装包冒烟覆盖一篇简短故事。长篇和故障恢复依赖当时的制作流程和自动测试。
- 候选比当前正式版新，签核期间无法在正式渠道观察发现新版后定位下载入口的分支。
- Windows GitHub Actions 验证安装与运行时。Windows 控制台与书架的人工交互不在本版签核范围内。
- 备份清理通过隔离样本和故障注入验证。此前真实的部分清理没有系统错误码，完整的 10.4 GiB 备份保留。
- 横图以受控绘图、既有桌面及窄屏浏览器和试印文件验证。真实画风与实体打印未验证。

### 原范围中的草案用例

- 原计划列入的 STORY-LIFECYCLE-C046 仍是草案。其配文与画面联动的复选框缺少现行入口。`676a5335` 已用 SMOKE-C006 验证单改配文和原图保留。

### 沿用的通过项与证据

- `4e1d1af2` 通过双平台构建与安装冒烟，运行号 `20261128T001324Z-REGRESSION-C005-R3`。[构建、安装冒烟与哈希](../regression/evidence/20261128-4e1d1af2/desktop-builds.md)
- `9f0e9383` 通过备份清理和回退保护，运行号 `20261127T232404Z-CHANGES-C008-R1`。[隔离验证记录](../changes/evidence/20261127-9f0e9383/backup-cleanup.md)
- `2ca9d691` 通过两平台安装包构建，并独立通过联网、断网和恢复联网后的更新检查，运行号 `20261127T225724Z-CHANGES-C001-R3`。[构建证据](../regression/evidence/20261127-2ca9d691/desktop-builds.md) [独立复测证据](../changes/evidence/20261127-2ca9d691/update-check.md)
- `676a5335` 原签核范围 30 项，29 项通过、1 项失败。安装包与回归关卡通过，见 [自动回归记录](../regression/RUNS.md)。旧 0.17.0 书库可打开，见 [升级运行记录](../upgrade/RUNS.md)。
- macOS 安装包冒烟 9 项通过，见 [冒烟运行记录](../smoke/RUNS.md)。
- 本版改动 6 项与制作流程 8 项通过，见 [改动运行记录](../changes/RUNS.md)和 [制作流程运行记录](../story-lifecycle/RUNS.md)。

## 套件说明

- **用途**　根据候选构建、验证记录和剩余风险决定是否发布 0.18.0。每项读者可见改动对应一个用例。[发布测试范围](../RELEASES.md#0180) · [本版改动用例](../changes/SUITE.md)
- **验证环境**　候选安装包、隔离书库和受控提供方。构建使用提交哈希，运行时间记为 UTC。[冒烟套件](../smoke/SUITE.md)
- **进入与退出**　候选已包含列入范围的改动，所选用例可执行。阻塞清除后由维护者在本页填写[结论](#结论)。
- **证据留存**　发布后保留用例、构建、安装包校验值和签核结论，作为后续回归和发布追溯的依据。
