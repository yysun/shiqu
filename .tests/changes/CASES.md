# 版本改动 Test Cases

Case IDs use `CHANGES-C001`, `CHANGES-C002`, and so on. Keep retired IDs; never reuse them.

## CHANGES-C001 — 手动检查更新给出明确结果

- State: READY
- Priority: P1
- Type: BUSINESS_E2E
- Requirement / Risk: RS5, `76106876`
- Automation: HYBRID
- Owner: Yiyi Sun
- Target Release: 0.18.0

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

## CHANGES-C002 — 保存修订后从所属制作步骤继续

- State: READY
- Priority: P0
- Type: BUSINESS_E2E
- Requirement / Risk: RS2, RS5, `2ef45aa5`, `e4fbed88`, `c566d274`
- Automation: HYBRID
- Owner: Yiyi Sun
- Target Release: 0.18.0

### Objective

审核中、已暂停及已完成的作品都能保存独立新版。需要重新制作时，读者明确继续后才开始。

### Preconditions

使用隔离书库和受控提供方，可模拟三个状态。

### Test Data

三篇各有四幅的作品，各做一处需要复核的配文修改。

### Runner Instructions

按 [STORY-LIFECYCLE-C045](../story-lifecycle/CASES.md#case-c045) 核对三个入口。保存后重新打开最新版本，再从对应制作行继续。

### Expected Outcome

新版保留修改并显示「已保存，等待继续」。继续后从需要复核的步骤推进。

### Negative Assertions

保存到继续前没有模型调用。原版内容和图片没有被覆盖。

### Evidence Required

三个入口的版本编号、保存与继续界面、继续前后的模型调用数。

## CHANGES-C003 — 修订前查看准确的成图影响

- State: READY
- Priority: P1
- Type: INTEGRATION
- Requirement / Risk: RS2, RS5, `7d60bd5e`, `e43742b0`, `e4fbed88`
- Automation: HYBRID
- Owner: Yiyi Sun
- Target Release: 0.18.0

### Objective

读者在批准修订前看到会失效的已有成图，换画风时可在实际执行的位置跟踪转换。

### Preconditions

使用独立书库、受控提供方和可阻塞的任务回执。

### Test Data

部分已有成图的故事、含手改画面描述的故事，以及已有图片后来丢失的故事。

### Runner Instructions

修改叙事详略、换画风，各核对预览与保存后继续。结合 [STORY-LIFECYCLE-C055](../story-lifecycle/CASES.md#case-c055)、[C057](../story-lifecycle/CASES.md#case-c057) 和 [C061](../story-lifecycle/CASES.md#case-c061) 验证实际派发。

### Expected Outcome

重编预览只把实际保存且会失效的成图计入失效提示，未知幅数提示待编排和审核确定。换画风的转换行在需复核时出现在审核之前，绘图在后。已确认丢失的图单独提示。

### Negative Assertions

未生成图片的画幅不计为原图失效。保存不派发绘图，重编经过确认才舍弃将失效的手改内容。

### Evidence Required

各分支预览、步骤顺序、保存前后原图数与受控调用顺序。

## CHANGES-C004 — 退出分镜编辑时保护手改

- State: READY
- Priority: P1
- Type: BUSINESS_E2E
- Requirement / Risk: RS2, RS5, `7d60bd5e`, `e43742b0`
- Automation: HYBRID
- Owner: Yiyi Sun
- Target Release: 0.18.0

### Objective

读者在逐幅编辑或合并分镜后能保留正在写的内容，或有意丢弃草稿后回到剧本。

### Preconditions

控制台已启动。使用至少四幅且每幅文字可辨识的隔离样本。

### Test Data

分别在单幅配文和两幅合并的预览中输入可识别的改动。

### Runner Instructions

用关闭、点击外侧、Esc 和返回离开有改动的编辑器，确认可留在编辑器继续写。再试显式取消和正式保存。

### Expected Outcome

有未保存内容时，每个离开路径都先确认；选择保留时输入仍在。剧本内取消只丢弃编辑，剧本保持打开。保存合并后幅号和留下的文字符合预览。

### Negative Assertions

放弃草稿与关闭都不会新建版本。合并预览没有确认保存前，原有分镜不被清除。

### Evidence Required

退出分支、草稿及剧本界面、保存前后版本数和幅号。

## CHANGES-C005 — 首次确认显示估算，审核显示实际幅数

- State: READY
- Priority: P1
- Type: INTEGRATION
- Requirement / Risk: RS5, `9802615d`, `2dbeb3d4`, STORY-LIFECYCLE-C069
- Automation: AUTOMATED
- Owner: Yiyi Sun
- Target Release: 0.18.0

### Objective

读者通过叙事详略设置展开程度，并在适当阶段看到估算或实际幅数。

### Preconditions

隔离书库与受控模型；审核可保持在途。

### Test Data

预计七幅、设置「简短」、实际八幅的新故事。

### Runner Instructions

按 [STORY-LIFECYCLE-C069](../story-lifecycle/CASES.md#case-c069) 运行读者回归。另用现有正式服务测试验证完整分镜未完成制作时拒绝刷新请求，支持的确认版阶段仍可刷新。

### Expected Outcome

首次确认只显示一条估算。审片中及完成后显示实际幅数。完整分镜在审片到绘图完成期间时，旧页面或 CLI 的刷新命令被拒绝。

### Negative Assertions

读者界面不显示建议刷新入口。被拒绝的刷新不产生任务，已有制作继续，估算不覆盖最终幅数。

### Evidence Required

估算与实际幅数的渲染、详略保存值、前后请求结果与准备调用次数。

## CHANGES-C006 — 对单条审片意见应用修订建议

- State: READY
- Priority: P0
- Type: BUSINESS_E2E
- Requirement / Risk: RS2, RS5, `2dbeb3d4`, `.docs/user-guide.md` 审片与修订
- Automation: HYBRID
- Owner: Yiyi Sun
- Target Release: 0.18.0

### Objective

读者可针对单条审片意见自动修改并保存新版，也可只把建议写入手动编辑草稿。

### Preconditions

使用隔离书库和受控文字提供方。准备保留局部问题的已阻断审片稿。

### Test Data

分别是画面描述、配文和结语问题，另备一份其他窗口已更新的旧草稿。

### Runner Instructions

在读者界面执行「自动修改」和「手动修改 → 应用修订建议」。结合 [正式修订调用测试](../../tests/production-dag-scenarios.test.mjs) 核对每次请求与未保存的草稿。

### Expected Outcome

自动修改一次只请求一个字段并保存新版，停在等待继续。手动路径只填写目标字段，其他草稿改动保留，点击保存才创建新版。过期的意见或草稿提示重新载入。

### Negative Assertions

应用建议不自行绘图或复核；过期请求不发起文字调用；无变化结果不产生新版本。

### Evidence Required

两条界面路径、三个字段、旧快照与无变化分支的结果、版本编号与文字、复核、绘图调用计数。

## CHANGES-C007 — 自动修订路由到事实出错的字段

- State: READY
- Priority: P1
- Type: INTEGRATION
- Requirement / Risk: RS2, RS5, `2dbeb3d4`, STORY-LIFECYCLE-C066
- Automation: AUTOMATED
- Owner: Yiyi Sun
- Target Release: 0.18.0

### Objective

画面描述中的局部事实错误用画面修订处理，有效修改后复核。

### Preconditions

使用正式制作协调器、隔离书库和受控回执。

### Test Data

二十八幅分镜，第 23 和 24 幅的画面描述含原文没有的足伤，配文正确。

### Runner Instructions

按 [STORY-LIFECYCLE-C066](../story-lifecycle/CASES.md#case-c066) 分别运行有效修订与返回原文的停机分支。

### Expected Outcome

只派目标幅的画面修订；有效修改后复核。无变化时停止自动派发，列出受影响画幅。

### Negative Assertions

没有旁白改写、隐式重编或未通过审核就发起的绘图。

### Evidence Required

审核问题、修订调用类型及目标幅、复核或停机结果、绘图调用顺序。
