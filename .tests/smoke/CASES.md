# 候选版本冒烟 Test Cases

Case IDs use `SMOKE-C001`, `SMOKE-C002`, and so on. Keep retired IDs; never reuse them.

## SMOKE-C001 — 在 Mac 上安装并启动候选版本

- State: READY
- Priority: P0
- Type: BUSINESS_E2E
- Requirement / Risk: RS1
- Automation: MANUAL
- Owner: Yiyi Sun

### Objective

候选安装包能在 Mac 上安装、启动服务，并在浏览器打开书架。

### Preconditions

- 已退出正在运行的拾趣。安装包已核对 SHA-256。

### Test Data

- 候选 DMG；签核书库 `~/shiqu-signoff/<build>`（空目录）。

### Runner Instructions

- 用 DMG 安装到「应用程序」，替换旧版本。
- 打开控制台，停止服务后把故事数据目录改为签核书库，再点「启动服务」和「在浏览器打开」。

### Expected Outcome

- 控制台显示的版本号与候选版本一致，运行状态为运行中，故事目录是签核书库。
- 浏览器打开空书架，没有错误提示。

### Negative Assertions

- 日常书库没有被打开或改动。控制台没有报告升级或恢复失败。

### Evidence Required

- 控制台截图（版本号、运行状态、故事目录）、空书架截图、安装包的 SHA-256。

## SMOKE-C002 — 配置生成服务并测试连接

- State: READY
- Priority: P0
- Type: BUSINESS_E2E
- Requirement / Risk: RS2
- Automation: MANUAL
- Owner: Yiyi Sun

### Objective

在「设置 → 生成服务与模型」中保存文字与图片服务，测试连接成功，且不发起生成。

### Preconditions

- SMOKE-C001 已通过。

### Test Data

- 维护者自己的服务凭据（不写入证据）。

### Runner Instructions

- 在本机浏览器打开「设置 → 生成服务与模型」，选择服务和模型并保存，点「测试连接」。

### Expected Outcome

- 保存后重新打开设置，所选服务和模型仍在，密钥只显示“已保存”状态。
- 「测试连接」成功。

### Negative Assertions

- 页面和网络响应中不出现密钥原文。测试连接没有产生故事或生成任务。

### Evidence Required

- 设置页截图（密钥打码），测试连接的结果。

## SMOKE-C003 — 新建一篇简短故事并完成制作

- State: READY
- Priority: P0
- Type: BUSINESS_E2E
- Requirement / Risk: RS2
- Automation: MANUAL
- Owner: Yiyi Sun

### Objective

从内置书目选一章短篇，经准备、确认到制作完成，书架出现一篇所有画幅都有图的故事。

### Preconditions

- SMOKE-C002 已通过。签核书库中没有故事。

### Test Data

- 内置书目中的一章短篇。叙事详略选「简短」。

### Runner Instructions

- 按用户指南「做一本故事书」操作，选定故事后在「故事流程」检查原文与要求，再点「开始制作」。
- 制作过程中可以离开阅读页，等待完成。会消耗服务额度，只做这一篇。

### Expected Outcome

- 点「开始制作」之前没有生成分镜或图片。
- 制作完成后，制作流程各步骤显示完成，书架卡片有封面，每一幅都有图。

### Negative Assertions

- 书架只有一张卡片。没有步骤因为刷新页面而被重复执行。

### Evidence Required

- 开始制作前后的制作流程截图、完成后的书架截图、幅数和耗时。

## SMOKE-C004 — 暂停后恢复生成

- State: READY
- Priority: P0
- Type: BUSINESS_E2E
- Requirement / Risk: RS2
- Automation: MANUAL
- Owner: Yiyi Sun

### Objective

制作途中「暂停生成」会让新任务停止，「恢复生成」后从原处接着完成。

### Preconditions

- 在 SMOKE-C003 的制作途中执行（还有画幅未绘制）。

### Test Data

- SMOKE-C003 的故事。

### Runner Instructions

- 有画幅正在生成时点「暂停生成」，等一分钟并刷新页面，再点「恢复生成」。

### Expected Outcome

- 暂停后刷新，仍显示已暂停，已完成的画幅保留，等待期间没有新画幅开始。
- 恢复后从未完成的画幅继续，直至完成。

### Negative Assertions

- 暂停期间刷新或重开页面不会自动恢复。已完成的画幅不会重画。

### Evidence Required

- 暂停时与恢复后的进度截图（已完成幅数）。

## SMOKE-C005 — 阅读完成的故事

- State: READY
- Priority: P0
- Type: BUSINESS_E2E
- Requirement / Risk: RS2
- Automation: MANUAL
- Owner: Yiyi Sun

### Objective

从书架打开故事，翻完全部画幅，查看原文和分镜，阅读进度在重开后保留。

### Preconditions

- SMOKE-C003 已完成。

### Test Data

- SMOKE-C003 的故事。

### Runner Instructions

- 在电脑浏览器用方向键或翻页箭头翻到中间一幅，关闭后从书架重开。再翻到结尾页。

### Expected Outcome

- 每一幅的图片和配文都能显示，结尾页可返回书架。
- 重开后回到上次读到的画幅。原文和分镜可以打开。

### Negative Assertions

- 没有空白或加载失败的画幅。阅读不触发任何生成。

### Evidence Required

- 中间一幅与结尾页截图，重开后的位置。

## SMOKE-C006 — 修改一幅配文后继续

- State: READY
- Priority: P0
- Type: BUSINESS_E2E
- Requirement / Risk: RS2
- Automation: MANUAL
- Owner: Yiyi Sun

### Objective

改一幅配文保存为新版，原图保留，不重画任何画幅，原版仍可查看。

### Preconditions

- SMOKE-C003 已完成。

### Test Data

- SMOKE-C003 的故事，任选一幅改动配文中的一句。

### Runner Instructions

- 在「故事设置 → 制作流程」修改该幅配文，查看保存前显示的预计影响，提交后按提示继续。

### Expected Outcome

- 预计影响显示重绘 0 幅。保存后书架显示新版，阅读时该幅是新配文、原图。

### Negative Assertions

- 没有发起绘图。书架没有多出卡片。原版没有被覆盖。

### Evidence Required

- 预计影响截图、改动后该幅的阅读截图。

## SMOKE-C007 — 导出 ZIP 与 PDF

- State: READY
- Priority: P0
- Type: BUSINESS_E2E
- Requirement / Risk: RS2
- Automation: MANUAL
- Owner: Yiyi Sun

### Objective

从书架「作品与导出」下载 ZIP 和 PDF，文件完整，内容是最新版本。

### Preconditions

- SMOKE-C006 已完成。

### Test Data

- SMOKE-C006 之后的故事。

### Runner Instructions

- 署名为空时按提示选择处理方式。下载 ZIP 和竖版 PDF，解压 ZIP 查看。

### Expected Outcome

- ZIP 含 `故事.json`、`分镜.md` 和 `图片/` 下与幅数相同的 WebP，图片可打开且带署名水印。
- PDF 页数与幅数对应，C006 修改过的那幅是新配文。

### Negative Assertions

- 导出不发起生成。没有缺图却仍导出的情况。

### Evidence Required

- ZIP 文件清单与图片数量、PDF 中改动那幅的截图。

## SMOKE-C008 — 删除并撤销书架卡片

- State: READY
- Priority: P1
- Type: BUSINESS_E2E
- Requirement / Risk: RS2
- Automation: MANUAL
- Owner: Yiyi Sun

### Objective

删除故事前有确认，删除后可撤销，撤销后故事和图片都在。

### Preconditions

- SMOKE-C007 已完成。

### Test Data

- SMOKE-C003 的故事。

### Runner Instructions

- 在书架删除该故事，确认后立即撤销，再打开阅读。

### Expected Outcome

- 删除前出现确认。撤销后卡片回到书架，阅读正常，所有画幅有图。

### Negative Assertions

- 撤销后没有重新发起生成，也没有出现两张卡片。

### Evidence Required

- 确认框、撤销后的书架和阅读截图。

## SMOKE-C009 — 退出并重新打开后数据保持

- State: READY
- Priority: P0
- Type: BUSINESS_E2E
- Requirement / Risk: RS1, RS2
- Automation: MANUAL
- Owner: Yiyi Sun

### Objective

用「退出拾趣」退出再重新打开，服务、书库、故事和设置都保持。

### Preconditions

- SMOKE-C008 已完成。

### Test Data

- 签核书库。

### Runner Instructions

- 点「退出拾趣」，确认进程已退出后重新打开应用，启动服务并打开书架。

### Expected Outcome

- 故事目录仍是签核书库，书架仍有该故事和 C006 的修改，生成服务设置仍在。

### Negative Assertions

- 重启没有自动发起生成，没有提示书库升级或恢复。

### Evidence Required

- 重启后的控制台与书架截图。

## SMOKE-C010 — 在 Windows 上安装并启动候选版本

- State: READY
- Priority: P1
- Type: COMPATIBILITY
- Requirement / Risk: RS1
- Automation: MANUAL
- Owner: Yiyi Sun

### Objective

候选 Windows 安装包能安装、启动服务并在浏览器打开书架。

### Preconditions

- 有一台 Windows 10/11 x64。安装包已核对 SHA-256。是否必须由该版签核记录决定。

### Test Data

- 候选 `-setup.exe`；新的空书库目录。

### Runner Instructions

- 运行安装程序，打开控制台，停止服务后把故事数据目录改为新的空目录，启动服务并在浏览器打开。端口冲突时按用户指南改端口。

### Expected Outcome

- 控制台显示候选版本号且服务运行，浏览器打开空书架。

### Negative Assertions

- 没有打开或改动这台电脑上已有的书库。

### Evidence Required

- 控制台截图（版本号、运行状态、故事目录）、空书架截图。
