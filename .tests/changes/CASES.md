# 版本改动 Test Cases

Case IDs use `CHANGES-C001`, `CHANGES-C002`, and so on. Keep retired IDs; never reuse them.

## CHANGES-C001 — 手动检查更新给出明确结果

- State: READY
- Priority: P1
- Type: BUSINESS_E2E
- Requirement / Risk: RS5, `76106876`、`2ca9d691`
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
- 保持同一控制台，在联网检查后关闭网络并立即再点一次。记录提示和网络不可达的证据，再恢复网络。

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

## CHANGES-C008 — 确认后可清理无法使用的旧备份

- State: READY
- Priority: P0
- Type: INTEGRATION
- Requirement / Risk: `1fb7a75a`、`9f0e9383`，[旧备份清理](../../.docs/reqs/2026/11/27/req-legacy-backup-cleanup.md)
- Automation: AUTOMATED
- Owner: Yiyi Sun
- Target Release: 0.18.0

### Objective

确认后可清理缺少归属记录的旧升级备份。仍被回退记录引用的快照受到保护。清理短暂中断后能重试，仍有残留时给出明确结果。

### Preconditions

通过正式桌面维护入口执行，仅使用临时书库和备份目录。

### Test Data

缺少 `.origin.json` 的可识别旧快照、仍被回退引用的保护快照、模拟短暂清理错误和仍有残留的样本。

### Runner Instructions

在隔离目录列出快照并分别尝试未确认、已确认及受保护删除。用故障注入核对删除重试和残留报告，并检查目标目录及原书库。

### Expected Outcome

已确认且未受保护的旧快照完全清除。短暂文件错误触发有限重试。仍有残留时报告对应目录或文件。

### Negative Assertions

未确认删除、受保护快照的删除均被拒绝。隔离书库保持原样，残留目录存在时不会报告成功。

### Evidence Required

各类样本的维护入口结果、删除后的目录状态和异常分支的测试记录。

## CHANGES-C009 — CLI 共享书库服务与继续制作授权

- State: READY
- Priority: P0
- Type: INTEGRATION
- Requirement / Risk: RS1, RS2, `2be95ef3`、`6a3cdc21`
- Automation: AUTOMATED
- Owner: Yiyi Sun
- Target Release: 0.18.0

### Objective

书库空闲时 CLI 能启动一次服务并在并发调用间共享。已有服务在线时查询、修改和制作共用同一实例，等待授权和故障停点准确显示。

### Preconditions

通过正式命令启动，使用隔离书库、临时本机端口与受控推理回执。

### Test Data

并发冷启动、同库在线工作进程，以及已保存、等待审片和故障故事。

### Runner Instructions

核对 `tests/cli-service.test.mjs` 中的并发冷启动、共享制作、浏览器继续、终止并重启等场景。

### Expected Outcome

同一书库只有一个持锁实例。CLI 保存和有限运行保留停点，浏览器明确继续后才获得生产授权。停服中断的已授权全量制作重启后继续。

### Negative Assertions

无授权时无绘图，不重复派发同一请求。错误端点不接收业务请求。

### Evidence Required

服务实例与任务回执，受控调用记录，停止与恢复结果。

## CHANGES-C010 — 桌面接入与共享服务停服

- State: READY
- Priority: P0
- Type: INTEGRATION
- Requirement / Risk: RS1, RS2, `dedc1aaf`、`6a3cdc21`
- Automation: AUTOMATED
- Owner: Yiyi Sun
- Target Release: 0.18.0

### Objective

桌面接入同库同版服务并保留进程和地址。常规停服等待已领取步骤保存，立即停止取消在途请求，桌面准确区分正常停止和连接故障。

### Preconditions

使用正式 CLI、桌面控制通道、原生控制器测试及隔离书库。

### Test Data

常驻和短时服务，受控在途任务，外部终端停止及异常断开。

### Runner Instructions

执行共享服务接入、停服、收尾和强停测试，结合原生控制器检查重启和退出状态。

### Expected Outcome

接入保留持锁进程、阅读地址与服务设置。常规停止停止领取新任务并等待保存。立即停止能取消在途任务。正常停止后可重启同一书库。

### Negative Assertions

不中断不兼容或接入失败的已有服务。不把异常断开当作正常停止。

### Evidence Required

接入前后实例与地址，停止应答和状态投影，原生测试结果。

## CHANGES-C011 — 横图套图与横版、Letter PDF 试印

- State: READY
- Priority: P0
- Type: INTEGRATION
- Requirement / Risk: RS2, RS5, `b8337d5d`、`4c3776fc`、`014b48b5`、`ff3f9a9a`
- Automation: HYBRID
- Owner: Yiyi Sun
- Target Release: 0.18.0

### Objective

每套横图保留自己的画风与稿件；读者按套重试或删除，按指定套图导出历史稿件或保留缺图位置的试印稿。

### Preconditions

使用隔离书库、受控绘图和生产导出接口；沿用已完成的窄屏与桌面浏览器证据。

### Test Data

历史完整套图、暂停或未完成套图、横图丢失的作品、可另绘的当前版本。

### Runner Instructions

核对候选上横图丢失恢复、历史套和试印选择、独立画风、删除及在途保护的自动回归。核对既有浏览器画风确认及横版、Letter 导出证据的构建来源。

### Expected Outcome

两种 PDF 使用选中套图及对应分镜。未完成套图保留配文和缺图位置。可安全确认删除当前或历史套图。

### Negative Assertions

删除不改其他套图或竖图，不接受仍在途或过期操作。导出不启动绘图。

### Evidence Required

候选测试摘要及此前正式导出、控件和隔离场景证据。

## CHANGES-C012 — 服务在线时创建一致的书库快照

- State: READY
- Priority: P0
- Type: INTEGRATION
- Requirement / Risk: RS3, `6a3cdc21`
- Automation: AUTOMATED
- Owner: Yiyi Sun
- Target Release: 0.18.0

### Objective

CLI 和桌面能在服务在线且无在途任务时创建并校验快照。正在写入时反馈任务尚未收尾。

### Preconditions

使用由正式服务持锁的隔离书库和独立快照目录。

### Test Data

空闲的共享服务和持有未完成步骤的共享服务。

### Runner Instructions

在在线制作结束前后通过命令及桌面维护入口取备份，验证快照完整性和目录状态。

### Expected Outcome

空闲时的桌面、CLI 快照均可校验。忙碌时明确拒绝，待任务保存可重新发起。

### Negative Assertions

拒绝分支不创建备份目录。快照不含服务的私有状态。

### Evidence Required

两种入口的结果，拒绝后的目录检查和快照校验记录。
