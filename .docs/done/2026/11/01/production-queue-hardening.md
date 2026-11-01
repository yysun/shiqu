# 生产队列加固

## Summary

- 在 `main` 完成六个实现里程碑：最新版本启动保护、原子修订提交、独立查找池、部分检查点保留、失败隔离、调度与书架优化。
- 新版本写入后，旧版本不再开始生成；已开始的旧任务可以保存至旧版，已付费图片仍可发布。
- 样式修改保留符合条件的已保存分镜和草稿；查找不再占用文本制作名额。
- 修复 VR 发现的并发恢复漏洞：新版在检查后、控制写入前发布时，旧版恢复/后台请求返回 409，且不更改旧版。
- 更新[中文流程与队列图解](../../../../story-creation-editing-queue.md)。

## Verification

- SS 记录的环境：Node 24.22.1、pnpm 11.25.0；复用现有依赖。
- 最终全量 TT：805 项通过、0 失败、0 跳过；最终受控 ET/回归运行：250 项通过。`pnpm typecheck`、`pnpm lint` 通过。
- 全量测试最终使用并发 2、每文件 60 秒超时；一次默认并发运行停在无关的 Vite 测试，该文件随后单独通过，并在全量运行中通过。未放宽断言或修改应用规避问题。
- 最终独立审查结论：`CR passed: no major findings`。风险为 non-low，审查第 3 轮，复用独立审查者。
- 实际 Reader 浏览器 ET 通过：裁剪书架数据后的首图审核恢复、503 错误在面板内可见、无图卡片失败后再次请求、原文读取、PDF/ZIP 产物校验。使用隔离数据与正常自动点击，不是手工设备测试；浏览器代理的附带写请求 403 不计作写接口验证，写接口由真实 HTTP 测试覆盖。
- 五次预热测量的中位数：AC21 暂停场景 9 条 SQL、5.263 ms，为稳定基线的 6.53%；AC22 活跃场景 28 条 SQL，为基线条数的 0.84%。测量使用内存 SQLite 与受控数据，基线选择及波动见[计划证据](../../../../plans/2026/11/01/plan-production-queue-hardening.md#evidence)。
- 本记录最初按 DD、GC 指令提前归档；用户随后要求继续 RPD，现已补齐 TT、ET。最终独立 VR 第 4 轮通过，25 项验收条件及全部可执行计划任务完成；完整结论如下。

## Notes

- 六个实现提交：`25ed11a`、`a2f8d2d`、`28bbec9`、`a06a628`、`6ea16fd`、`080b61a`；当前证据及流程文档提交：`4246e7e`。
- 并发控制修复与回归提交：`482d016`；原交付记录提交：`682fc55`。
- 历史较重的受阻故事场景仍有家族资格查询成本：周期 62.877 ms，高于 37.671 ms 基线；不声称所有场景均加速。
- 自动修复覆盖手工修改及由此产生的额外重绘仍是本次非目标。
- 未调用付费提供方、写入真实书库、构建 Docker、打包桌面应用或推送；SS 的预览辅助进程与临时验证文件已清理。
- 并行 ZIP 导出工作不纳入本次队列修复提交；最终提交包含队列验收场景及更新后的需求、计划、场景和交付证据。
- 范围与后续验收以[需求](../../../../reqs/2026/11/01/req-production-queue-hardening.md)、[计划](../../../../plans/2026/11/01/plan-production-queue-hardening.md)及[场景](../../../../tests/test-production-queue-hardening.md)为准。

## Final VR

### Review and verification

Affected CR conclusions reassessed for the added held-search regression and reconciled documentation; no new material findings.

CR passed: no major findings

CR risk: non-low — paid-work eligibility, concurrency, persistence and public API contracts.

CR review round: 3; reviewer: reused

Final evidence: pinned Node 24.22.1/pnpm 11.25.0; full bounded-concurrency TT **805/805**, selected ET harnesses **250/250**, zero failures/skips; typecheck and lint passed. Actual Reader browser scenarios used normal automated clicks and controlled providers. The default-concurrency hang and fixture proxy limitations are explicitly documented.

References below are repository-relative; test references are under `tests/`.

| AC | Outcome | Evidence |
|---|---|---|
| 1 | Complete | Repository acquisition and coordinator/API eligibility guards; `production-queue-hardening.test.mjs`. |
| 2 | Complete | Atomic text-lock predicate, final image eligibility check and attempt refund; hardening/queue regressions. |
| 3 | Complete | Deleted-inclusive family eligibility; hardening and paused-version restore/resume tests. |
| 4 | Complete | Superseded unfinished snapshots report paused; hardening tests. |
| 5 | Complete | Fenced control UPDATE, 409/no-change HTTP races, stale override/retry guards and old-version UI note. |
| 6 | Complete | JSON-safe family expressions and row containment; hardening/revision tests. |
| 7 | Complete | Single conditional revision INSERT establishes eligibility atomically; revision crash tests. |
| 8 | Complete | Active/paused control written during INSERT; atomic-fork tests and route wake. |
| 9 | Complete | Stable request replay and preserved later controls; revision/paused-version concurrent replay tests. |
| 10 | Complete | Version-local checkpoint and media publication fencing; revision/hardening/production tests. |
| 11 | Complete | Legacy handoff replay/resume retained; hardening tests. |
| 12 | Complete | Held-search HTTP regression: own preparation and another story finish while second search waits. |
| 13 | Complete | Independent bounded pools; `production-queue.test.mjs`. |
| 14 | Complete | Migration 0008 and queued/interrupted search migration regression. |
| 15 | Complete | Saved checkpoint, image receipt, publication and revision reuse; production/revision/review/interruption tests. |
| 16 | Complete | Storyboard/draft preservation predicate, saved next-step tests and rendered preview wording. |
| 17 | Complete | Requirement/count edits discard partial script checkpoints; hardening tests. |
| 18 | Complete | Four orphan-job kinds contained and logged once; hardening/queue tests. |
| 19 | Complete | Deleted successful checkpoint resumes without replay; genuine failures remain retryable; deletion regressions. |
| 20 | Complete | Repeated revisions, paused controls, repair cap/no-op and override; flow-control/review/paused-version tests. |
| 21 | Complete | Candidate exclusion/publication exemption; hardening tests. Recorded warm result: 9 statements, 6.53% baseline time. |
| 22 | Complete | Unchanged/renewal rebuild suppression; hardening tests. Recorded 28/3,327 statements: 0.84% baseline. |
| 23 | Complete | Late obsolete failure triggers pruning; hardening regression. |
| 24 | Complete | Trimmed shelf tests; actual Reader fallback/error/retry clicks, opened source and verified PDF/ZIP exports. |
| 25 | Complete | Expiry-only cleanup preserves live viewers; hardening regression. |

All 25 acceptance criteria and all executable AP tasks are complete. Evidence remains controlled-fixture verification, not paid-provider or manual-device certification.

VR passed: all acceptance criteria complete

VR risk: non-low — changes affect paid-work eligibility, concurrent scheduling, persistence, migration and public-reader behavior.

VR review round: 4; reviewer: reused
