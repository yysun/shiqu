# 版本改动 Test Cases

Case IDs use `CHANGES-C001`, `CHANGES-C002`, and so on. Keep retired IDs; never reuse them.

## CHANGES-C001 — 手动检查更新给出明确结果

- State: READY
- Priority: P1
- Type: BUSINESS_E2E
- Requirement / Risk: RS5, `76106876`
- Automation: HYBRID
- Owner: Yiyi Sun
- Target Release: UNPLANNED

### Objective

在桌面控制台页脚点「检查更新」后，读者看到明确的结果：联网时显示已是最新，断网时显示暂时无法检查。发现新版的分支签核前无法观察，记在签核记录的残余风险中，不属于本用例。

### Preconditions

- SMOKE-C001 已通过。

### Test Data

- 候选安装包。签核时 GitHub 上的最新正式版应为 0.17.x，低于候选版本。

### Runner Instructions

- 联网时在候选安装包的控制台点页脚「检查更新」。
- 关闭网络后再点一次，记录提示后恢复网络。

### Expected Outcome

- 联网：显示「已是最新版本。」。
- 断网：显示「暂时无法检查更新，请稍后重试。」。

### Negative Assertions

- 断网时不显示「已是最新版本。」。两种情况下都不出现下载入口。

### Evidence Required

- 两次点击后的控制台截图。
