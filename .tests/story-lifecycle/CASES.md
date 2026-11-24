# 故事流程用例

## STORY-LIFECYCLE-C001 — 新建、提取、准备与确认制作

- State: READY
- Priority: P0
- Type: BUSINESS_E2E
- Requirement / Risk: R1
- Automation: AUTOMATED
- Owner: UNASSIGNED

### Objective

UI中完成新建至成品，验证手动启动、条件保留与确认门槛。

### Preconditions

全新独占书库，受控原文和模型可用。

### Test Data

合成原文A/主题/标题、3幅受控图片。

### Runner Instructions

使用Playwright语义定位操作UI；C006允许正式协议命令，C007允许启动子进程。其余API/SQLite仅只读核对。禁止访问真实书库。失败先留证，不能用隐藏写接口替代缺失UI。

### Expected Outcome

刷新前后条件及草稿一致，确认前零分镜/绘图，确认后分镜/审核/首图/余图/完成均有记录，阅读可用。

### Negative Assertions

切换标题或打开窗口不启动；未确认不绘图。

### Evidence Required

Run ID、构建、数据库位置、实际状态序列及断言；UI例含截图和trace，协议例含日志和具体对象状态。失败保存异常及分类。

## STORY-LIFECYCLE-C002 — 已生成故事的各编辑入口

- State: READY
- Priority: P0
- Type: BUSINESS_E2E
- Requirement / Risk: R2
- Automation: AUTOMATED
- Owner: UNASSIGNED

### Objective

UI改名及制作要求、验收、画风、叙事、分镜、结语编辑可提交，验证复用和历史。

### Preconditions

通过UI创建完成的同一家族故事。

### Test Data

编辑标记、另一画风、简短/详细、修改旁白和结语。

### Runner Instructions

使用Playwright语义定位操作UI；C006允许正式协议命令，C007允许启动子进程。其余API/SQLite仅只读核对。禁止访问真实书库。失败先留证，不能用隐藏写接口替代缺失UI。

### Expected Outcome

改名不生成；草稿丢弃不改版本；每类提交保留单卡片及历史，保存后刷新可读，结语/旁白无绘图输入变化时复用图。

### Negative Assertions

未提交不生成；旧版本/原文不变，不多一张卡片。

### Evidence Required

Run ID、构建、数据库位置、实际状态序列及断言；UI例含截图和trace，协议例含日志和具体对象状态。失败保存异常及分类。

## STORY-LIFECYCLE-C003 — 暂停、恢复与检查点

- State: READY
- Priority: P0
- Type: BUSINESS_E2E
- Requirement / Risk: R3
- Automation: AUTOMATED
- Owner: UNASSIGNED

### Objective

UI挂起首图时暂停，完成在途后不派后续；刷新保持暂停，明确恢复才继续。

### Preconditions

UI确认制作后，首图受控挂起。

### Test Data

3幅故事，首图独立闸门。

### Runner Instructions

使用Playwright语义定位操作UI；C006允许正式协议命令，C007允许启动子进程。其余API/SQLite仅只读核对。禁止访问真实书库。失败先留证，不能用隐藏写接口替代缺失UI。

### Expected Outcome

暂停持久且在途结果保存，后续等待；恢复后复用首图最终完成。

### Negative Assertions

只读观察/刷新不恢复、不重复首图。

### Evidence Required

Run ID、构建、数据库位置、实际状态序列及断言；UI例含截图和trace，协议例含日志和具体对象状态。失败保存异常及分类。

## STORY-LIFECYCLE-C004 — 失败与显式恢复

- State: READY
- Priority: P0
- Type: BUSINESS_E2E
- Requirement / Risk: R3
- Automation: AUTOMATED
- Owner: UNASSIGNED

### Objective

UI显示失败，刷新不重试，显式恢复只执行失败工作；审核无变化阻断后，分别验证手动修订重审和明确放行绘图。

### Preconditions

首图模型人为报错，其他生产流程真实。

### Test Data

一次失败、一次成功回执。

### Runner Instructions

使用Playwright语义定位操作UI；C006允许正式协议命令，C007允许启动子进程。其余API/SQLite仅只读核对。禁止访问真实书库。失败先留证，不能用隐藏写接口替代缺失UI。

### Expected Outcome

失败及故障标识持久；点击恢复后完成，已保存分镜/审核不重做。审核阻断时零图片；手动修订提交新版本重审，人工放行保留overridden记录。

### Negative Assertions

刷新和重复观察不买重试，旧失败回执不会被迟到保存清除。

### Evidence Required

Run ID、构建、数据库位置、实际状态序列及断言；UI例含截图和trace，协议例含日志和具体对象状态。失败保存异常及分类。

## STORY-LIFECYCLE-C005 — 重选取消与提交

- State: READY
- Priority: P0
- Type: BUSINESS_E2E
- Requirement / Risk: R4
- Automation: AUTOMATED
- Owner: UNASSIGNED

### Objective

UI打开重选等待，取消保留原版；明确提取并选择后切换同一家族新版本。

### Preconditions

已完成的UI故事和第二原文候选。

### Test Data

原文B、独立标题。

### Runner Instructions

使用Playwright语义定位操作UI；C006允许正式协议命令，C007允许启动子进程。其余API/SQLite仅只读核对。禁止访问真实书库。失败先留证，不能用隐藏写接口替代缺失UI。

### Expected Outcome

取消不改变当前版/控制，提交后需确认制作且完成，单卡片与旧版本历史保留。

### Negative Assertions

打开不提取，替换不复用旧故事图片。

### Evidence Required

Run ID、构建、数据库位置、实际状态序列及断言；UI例含截图和trace，协议例含日志和具体对象状态。失败保存异常及分类。

## STORY-LIFECYCLE-C006 — 状态机协议及媒体恢复

- State: READY
- Priority: P0
- Type: CONTRACT
- Requirement / Risk: R1/R2/R3/R4
- Automation: AUTOMATED
- Owner: UNASSIGNED

### Objective

复用正式REST/生产测试验证停止、重放、过期命令、重启、并发、图片丢失/恢复。

### Preconditions

独占数据库及既有状态机测试可执行。

### Test Data

受控失败、同命令ID、过期token、缺失媒体。

### Runner Instructions

使用Playwright语义定位操作UI；C006允许正式协议命令，C007允许启动子进程。其余API/SQLite仅只读核对。禁止访问真实书库。失败先留证，不能用隐藏写接口替代缺失UI。

### Expected Outcome

被拒绝状态转换不产生新工作；明确授权后恢复；媒体失效不会冒充完成，恢复原文件可核对复用。

### Negative Assertions

旧版本/旧回执不激活当前任务，不产生多余家族卡片。

### Evidence Required

Run ID、构建、数据库位置、实际状态序列及断言；UI例含截图和trace，协议例含日志和具体对象状态。失败保存异常及分类。

## STORY-LIFECYCLE-C007 — 开发入口与库隔离

- State: READY
- Priority: P0
- Type: BUSINESS_E2E
- Requirement / Risk: R5
- Automation: AUTOMATED
- Owner: UNASSIGNED

### Objective

实际启动pnpm dev local，证明local独立目录和默认兼容、私有文件拒绝访问。

### Preconditions

独立端口可用，readonly模型不调用外部。

### Test Data

开发空库；冲突SHIQU_DATA_DIR指向未创建哨兵目录。

### Runner Instructions

使用Playwright语义定位操作UI；C006允许正式协议命令，C007允许启动子进程。其余API/SQLite仅只读核对。禁止访问真实书库。失败先留证，不能用隐藏写接口替代缺失UI。

### Expected Outcome

local使用.data/dev-local；E2E每运行独占.data/e2e；原dev解析行为保留，退出释放服务。

### Negative Assertions

不读取桌面凭据、不写哨兵目录；HTTP不暴露SQLite。

### Evidence Required

Run ID、构建、数据库位置、实际状态序列及断言；UI例含截图和trace，协议例含日志和具体对象状态。失败保存异常及分类。

## STORY-LIFECYCLE-C008 — 阅读器确认单幅重新生图

- State: READY
- Priority: P0
- Type: BUSINESS_E2E
- Requirement / Risk: R1/R2；制作 DAG 场景 4、9、24
- Automation: HYBRID
- Owner: UNASSIGNED

### Objective

确认阅读器只重绘读者选中的一幅。验证取消、立即开始、返回阅读及同一请求重放。

### Preconditions

隔离 Vite 服务和正式生产 API 可用。受控生成器能挂起竖图结果。使用一篇已审核、已完成的合成作品。

### Test Data

6 幅可读竖图，选择第 2 幅。另用已有横图的样本验证首幅重绘。

### Runner Instructions

在应用内浏览器以手机宽度打开阅读器。先打开「重新生图」再取消，随后确认选中的第 2 幅。用对应服务集成用例验证请求重放和横图，API 与 SQLite 仅读取浏览器运行证据。

### Expected Outcome

确认后保留第 2 幅阅读位置并立即展示重绘状态，生成完成后可阅读新图。已有对应横图时仅更新该幅横图。其他画幅、分镜和审核结果沿用，旧版仍可读。

### Negative Assertions

取消后零提交、零绘图。确认后无需第二次「继续制作」。同一请求重放不再创建版本或调用模型。其他幅号零重绘，文字与审片零调用。

### Evidence Required

构建、数据标识、确认前后的可见状态、实际竖横图任务幅号、版次及复用断言。

## STORY-LIFECYCLE-C009 — 展示信息与阅读状态独立于制作

- State: READY
- Priority: P0
- Type: INTEGRATION
- Requirement / Risk: R1/R2/R3；制作 DAG 场景 15 的展示动作
- Automation: AUTOMATED
- Owner: UNASSIGNED

### Objective

证明只改展示名、署名或个人书架状态时，变更落到对应字段，制作任务继续按原授权运行。

### Preconditions

正式 API 使用隔离 SQLite 与受控生成器。覆盖重绘进行中、已保存待继续和已完成。

### Test Data

在途单幅重绘、等待继续的画风修订、已完成作品及未开工书架项。

### Runner Instructions

运行制作 DAG 的重绘、改名测试以及 story-title、story-publication、shelf-favorites 和 reader-production-client。对在途任务核对任务 ID、尝试次数和领取时间。

### Expected Outcome

标题出现在当前版及书架。改名保留版本、已存产物、编辑令牌、审片、绘图进度和授权。署名、收藏和观察阅读状态按各自接口更新。

### Negative Assertions

展示动作不额外创版、启动审片或绘图。阅读页报告可调整绘图优先级，查看暂停或故障故事不自动恢复。

### Evidence Required

前后会话、任务尝试、绘图及文字调用数和当前版记录，附测试名称与结果。

## STORY-LIFECYCLE-C010 — 等价制作设置保持在途任务

- State: READY
- Priority: P0
- Type: INTEGRATION
- Requirement / Risk: R1/R3/R4；制作 DAG 场景 15 的等价设置
- Automation: AUTOMATED
- Owner: UNASSIGNED

### Objective

证明界面预估和正式保存都按有效设置识别无变化的提交。

### Preconditions

隔离书库的当前版正在绘制首幅，受控生成器挂起结果，制作要求有效值为空。

### Test Data

空制作要求与仅含空格的变更。两者规范化后均为空串。

### Runner Instructions

用正式修订预估和保存 API 提交等价设置，读回当前版本和任务尝试。运行 production-dag-scenarios 中的 normalized-equivalent 用例。

### Expected Outcome

预估为无内容变更。处理提交后继续使用原版本、授权、运行状态、已存幅数和任务尝试。

### Negative Assertions

零新增修订、零额外调用。当前任务不被切换到等待继续。

### Evidence Required

预估结果、保存响应、当前版、授权与前后任务记录。

## STORY-LIFECYCLE-C011 — 并发故障与运行幅号一致

- State: READY
- Priority: P1
- Type: INTEGRATION
- Requirement / Risk: R3；制作 DAG 场景 50、55 的状态接口
- Automation: AUTOMATED
- Owner: UNASSIGNED

### Objective

验证故障幅的提示和另一幅正在运行的状态可同时成立。

### Preconditions

隔离书库、可阻塞的绘图提供方、正式协调器和状态接口可用。

### Test Data

6 幅稿件，第 2 幅有待处理故障，第 5 幅可独立绘制，其他画幅已保存。

### Runner Instructions

运行 production-dag-scenarios 中的 running status names 用例。对照替身生成器的实际幅号、书架和会话 API。界面复核时使用同一隔离样本检查书架和故事设置。

### Expected Outcome

第 2 幅显示待处理故障，第 5 幅显示正在绘制。故障保留，已授权的其他可运行任务能够继续。

### Negative Assertions

第 2 幅不被重试，不显示正在绘制。必需画幅故障尚在时，整篇不判定完成。

### Evidence Required

实际派发幅号、待处理故障幅号和会话、书架的可见状态文案。

## STORY-LIFECYCLE-C012 — 新设置的进度只统计新版分镜

- State: READY
- Priority: P1
- Type: INTEGRATION
- Requirement / Risk: R2/R3；制作 DAG 的详略与画风组合
- Automation: AUTOMATED
- Owner: UNASSIGNED

### Objective

证明新版重新编排时，旧稿仍可读，制作状态只统计新版有效产物。

### Preconditions

有一篇已完成作品，受控生成器可依次挂起提纲、分镜和画幅数审核。

### Test Data

旧稿 6 幅，新版使用详细叙事和新画风，自动幅数产出 9 幅。

### Runner Instructions

运行 production-dag-scenarios 中的 changing detail and style 用例，在各受控检查点读取 API 和时间线状态。

### Expected Outcome

保存后等待继续，继续后按实际步骤更新提纲、分镜和画幅数审核状态。新版 9 幅叙事分镜保存后，时间线才标记分镜完成。

### Negative Assertions

已有旧稿可读期间，时间线不提前打勾。绘图不提前启动。

### Evidence Required

版本、设置、各检查点状态、有效分镜数及审核开始时的断言。

## STORY-LIFECYCLE-C013 — 展示名保存回包保留在途状态

- State: READY
- Priority: P1
- Type: BUSINESS_E2E
- Requirement / Risk: R3；制作 DAG 场景 15 的即时状态
- Automation: HYBRID
- Owner: UNASSIGNED

### Objective

验证改名成功的同一时刻，制作状态和计时仍对应已经领取的绘图任务。

### Preconditions

使用隔离 Vite 服务和受控生成器挂起第 2 幅重绘，确认此前阅读器显示正在重绘。

### Test Data

6 幅作品在第 2 幅重绘期间写入新展示名。

### Runner Instructions

在应用内浏览器从故事设置保存展示名。读取保存后的第一帧界面状态，再比对写入回包和会话查询。运行 DAG 集成用例里的 display-only write 子断言。

### Expected Outcome

名称更新。写入回包和会话查询都显示第 2 幅运行，尝试开始时间保持一致。

### Negative Assertions

期间不出现排队、暂停或重新计时的状态。不会多一次模型调用。

### Evidence Required

提交前、刚保存和下一次轮询的文案，实际领取的幅号及开始时间。

## STORY-LIFECYCLE-C014 — 审片阻断与修复额度续授权

- State: READY
- Priority: P0
- Type: INTEGRATION
- Requirement / Risk: R1/R3；制作 DAG 场景 18、19、37、43
- Automation: AUTOMATED
- Owner: UNASSIGNED

### Objective

证明正式接口返回审片具体问题和可执行动作，额度耗尽后重新授权可开启有限修复。

### Preconditions

经过正式协调器的受控审核持续指出同一幅配文问题，直到自动修复额度耗尽。

### Test Data

第 2 幅配文问题，审核故障标识，暂停编辑的制作版本。

### Runner Instructions

运行 exhausted DAG review 用例并核对会话、暂停后的编辑快照和恢复请求。界面重测用同一配置检查编辑、继续修复与适用的放行入口。

### Expected Outcome

会话可读回第 2 幅问题。暂停后可修改审核意见。继续修复接受当前故障标识、按新额度继续，重复请求只重放原授权。

### Negative Assertions

待处理时零绘图。过期的故障标识不授权新结论。额度耗尽时页面不能报完成。

### Evidence Required

审核问题、故障标识、修订额度、授权响应和实际模型调用。

## STORY-LIFECYCLE-C015 — 重编时按照新绘图输入匹配故障

- State: READY
- Priority: P0
- Type: INTEGRATION
- Requirement / Risk: R1/R3/R4；制作 DAG 场景 42、51
- Automation: AUTOMATED
- Owner: UNASSIGNED

### Objective

保留重编前已确认的丢图故障，等新输入就绪后按绘图指纹决定继承或清除。

### Preconditions

正式队列已经完成隔离作品。第 2 幅文件丢失，经媒体接口确认。修改制作要求将生成新的画幅身份。

### Test Data

受控重编使绘图输入重新与旧幅相同；另准备产物输入不同的对照分支。

### Runner Instructions

运行 replanning matches 用例核对相同输入分支；改变受控入画人物或画面描述复跑对照。用真实队列接续和读取故障。

### Expected Outcome

相同输入的故障绑定到对应新幅，明确恢复前零绘图。不同输入不继承，按新版授权正常制作。

### Negative Assertions

不留下指向已不存在的画幅故障。不得为输入相同的故障幅提前调用模型。

### Evidence Required

新旧画幅身份及绘图输入、实际领取幅号、最终故障和完成状态。

## STORY-LIFECYCLE-C016 — 手改描述和配文分别影响入画人物

- State: READY
- Priority: P1
- Type: INTEGRATION
- Requirement / Risk: R2；制作 DAG 场景 35
- Automation: AUTOMATED
- Owner: UNASSIGNED

### Objective

验证手改画面描述加入角色后，正式绘图读取新的入画设定，配文里的提及仍按文字更改处理。

### Preconditions

合成成稿有两名已登记角色。所测画幅最初只画一人。

### Test Data

在第 2 幅画面描述加入鲍叔牙。另在未改画面描述的配文中单独提及鲍叔牙。

### Runner Instructions

运行 hand-editing a picture description 用例，以正式修订、继续和绘图请求核对入画集合。另执行配文对照，比较复用范围。

### Expected Outcome

画面描述增加的角色进入本幅入画名单，绘图读取该角色设定。配文提及不改入画名单或重绘图片。

### Negative Assertions

其他幅不重绘；本幅绘图不沿用已经过期的入画名单。

### Evidence Required

保存后的名单、实际绘图请求中出现的人物设定及各幅图片复用结果。

## STORY-LIFECYCLE-C017 — 完整稿件的审核调用失败后可人工放行

- State: READY
- Priority: P0
- Type: INTEGRATION
- Requirement / Risk: R1/R3；审核调用失败后的授权；v0.14.0 暂停稿件放行对等
- Automation: HYBRID
- Owner: UNASSIGNED

### Objective

验证审核模型未产出结论时，稿件齐备的故事能进入明确的人工处理路径。

### Preconditions

隔离书库已保存原文、完整分镜和结语。仅全篇审核调用失败，正式队列已记录该次任务故障，绘图尚未开始。

### Test Data

受控 4 幅作品，审片调用失败且无结论。另用画面描述失败、分镜不齐的作品作对照。

### Runner Instructions

运行 paused complete draft 与 failed task before 两个用例。界面复跑时，用同一隔离稿从审核步骤查看重试和人工放行入口，确认暂停后的单次授权及重复请求结果。

### Expected Outcome

审核失败落在审核步骤，可重试或在稿件齐备、已暂停时显式放行当前失败。保存放行标记且仍暂停，明确恢复后才能绘图。

### Negative Assertions

缺原文、分镜或结语时拒绝放行。其他制作故障、历史版和过期故障不能用审核放行解除。查看、暂停、放行及重放在未恢复前均产生零绘图调用。

### Evidence Required

稿件齐备证据、失败的审核任务及故障号、界面入口、授权响应、放行记录、暂停状态与绘图调用数。
