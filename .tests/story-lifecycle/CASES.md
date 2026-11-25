# 故事流程用例

## STORY-LIFECYCLE-C001 — 新建、提取、准备与确认制作

<a id="case-c001"></a>

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

<a id="case-c002"></a>

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

<a id="case-c003"></a>

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

<a id="case-c004"></a>

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

<a id="case-c005"></a>

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

<a id="case-c006"></a>

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

<a id="case-c008"></a>

- State: RETIRED
- Priority: P0
- Type: BUSINESS_E2E
- Requirement / Risk: R1/R2；制作 DAG 场景 4、9、24
- Automation: HYBRID
- Owner: UNASSIGNED

退役依据：现行阅读器单幅重绘见 C065，首幅与横图分列 C040、C053；本用例曾要求竖图重绘连带更新横图。原运行按当时构建保留。

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

<a id="case-c009"></a>

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

<a id="case-c010"></a>

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

<a id="case-c011"></a>

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

<a id="case-c013"></a>

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

<a id="case-c014"></a>

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

<a id="case-c015"></a>

- State: RETIRED
- Priority: P0
- Type: INTEGRATION
- Requirement / Risk: R1/R3/R4；制作 DAG 场景 42、51
- Automation: AUTOMATED
- Owner: UNASSIGNED

退役依据：新版补画已确认丢图见 C061；原场景 51 已删除。原运行按当时构建保留。

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

<a id="case-c016"></a>

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

在 [生产流程回归](../../tests/production-dag-scenarios.test.mjs) 运行 `hand-editing a picture description passes` 和 `edit a caption, save, restart and continue`，分别核对实际绘图请求和配文对照的绘图调用数。按 C016 在 [RUNS](RUNS.md) 查找各构建的独立结果。

### Expected Outcome

画面描述增加的角色进入本幅入画名单，绘图读取该角色设定。配文提及不改入画名单或重绘图片。

### Negative Assertions

其他幅不重绘；本幅绘图不沿用已经过期的入画名单。

### Evidence Required

保存后的名单、实际绘图请求中出现的人物设定及各幅图片复用结果。

## STORY-LIFECYCLE-C017 — 完整稿件的审核调用失败后可人工放行

<a id="case-c017"></a>

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

## STORY-LIFECYCLE-C018 — 失败批次在修订后保留每幅的恢复授权

- State: READY
- Priority: P0
- Type: INTEGRATION
- Requirement / Risk: R1/R3/R4；制作 DAG 与生命周期
- Automation: EXPLORATORY
- Owner: UNASSIGNED

### Objective

证明无关修订保留全部故障目标；普通继续不能替代逐项恢复。

### Preconditions

隔离 SQLite 和受控生成器。先让四幅画面描述同批失败。

### Test Data

4 幅已确认作品，有两条验收要求。

### Runner Instructions

暂停，单改验收要求，查看预估并保存修订。读回新版的目标与幅号，移除受控故障，点击继续。

### Expected Outcome

新版保留四个故障幅号。普通继续只执行独立工作，本批调用数不增加。

### Negative Assertions

到达全部绘图完成时不能仍显示无幅号的必需故障。

### Evidence Required

正式会话、节点与键、预估故障数、继续前后同类调用数。

## STORY-LIFECYCLE-C019 — 修订画风保留验收条目登记的故障

<a id="case-c019"></a>

- State: RETIRED
- Priority: P0
- Type: INTEGRATION
- Requirement / Risk: R1/R3；制作 DAG 与生命周期
- Automation: EXPLORATORY
- Owner: UNASSIGNED

退役依据：场景 53、54 的逐条登记已取消。原运行按当时构建保留。

### Objective

证明逐条产物按条目身份保留故障。

### Preconditions

隔离 SQLite 和可控的条目登记回执。

### Test Data

两条验收要求、四幅分镜，首次条目登记失败。

### Runner Instructions

暂停，单改画风并预览、保存。让提供方恢复，然后继续新版。

### Expected Outcome

未发生变化的两条要求保留故障目标，明确重试前不再登记。

### Negative Assertions

改变画风不构成再次登记未改变条目的授权。

### Evidence Required

旧新版故障目标、预估、登记调用增量和新版状态。

## STORY-LIFECYCLE-C020 — 已持久化的制作建议在回执丢失后结束排队

<a id="case-c020"></a>

- State: READY
- Priority: P0
- Type: INTEGRATION
- Requirement / Risk: R1/R3；制作 DAG 与生命周期
- Automation: AUTOMATED
- Owner: UNASSIGNED

### Objective

确认已完成的准备不会留下进行中的假象。

### Preconditions

当前故事已进入确认，制作建议已保存，原任务已成功。

### Test Data

隔离书库中一个已准备就绪的候选。

### Runner Instructions

运行 story-flow-control 中 a preparation whose receipt was lost，用队列重排已完成任务来模拟该检查点，观察多个生产节拍。

### Expected Outcome

任务结算，确认动作仍可用，无运行中准备，建议调用总数仍为一次。

### Negative Assertions

轮询、重试保存或重复节拍不得再次请求制作建议。

### Evidence Required

任务状态与尝试次数、会话状态、可用动作和建议调用总数。

## STORY-LIFECYCLE-C021 — 已完成作品生成可选横图时可以暂停

- State: READY
- Priority: P1
- Type: BUSINESS_E2E
- Requirement / Risk: R1/R3；制作 DAG 与生命周期
- Automation: EXPLORATORY
- Owner: UNASSIGNED

### Objective

让读者在队列仍将继续绘制时暂停横图制作。

### Preconditions

使用应用内浏览器打开隔离服务，四幅竖图已齐，挂起受控横图调用。

### Test Data

四幅合成作品，三项任务持有租约，一幅尚未发送。

### Runner Instructions

在故事设置启动横图，核对所属步骤和书架卡片提供的控制，用同一时刻的服务动作和控制响应作对照。

### Expected Outcome

书架或制作步骤提供可用的暂停入口。暂停后保留成品及已发送结果，并阻止新付费工作。

### Negative Assertions

读者暂停可选工作不能撤销竖图完成或丢弃已付费结果。

### Evidence Required

界面截图、在途幅号、生命周期动作和控制响应。

## STORY-LIFECYCLE-C022 — 重编排后相同的首图输入仍需明确恢复

<a id="case-c022"></a>

- State: RETIRED
- Priority: P1
- Type: INTEGRATION
- Requirement / Risk: R3；普通故障的待匹配规则
- Automation: AUTOMATED
- Owner: UNASSIGNED

退役依据：场景 42 改为新版补画，见 C061；原场景 51 已删除。原运行按当时构建保留。

### Objective

重编排后相同的首图输入仍需明确恢复。

### Preconditions

独立临时书库，使用生产服务、SQLite 和受控生成器。

### Test Data

首幅绘图失败，修改叙事详略后，受控编排重新产出完全相同的绘图输入。

### Runner Instructions

对照只改详略与同时修改画风。比较前后任务中的画幅键及全部硬输入。 [复现程序](evidence/2026-11-24-dag-retest/replay.mjs)

### Expected Outcome

输入一致时新版保留恢复要求。画风变化时允许按新输入绘制。

### Negative Assertions

普通继续不能再次派发输入相同的首图。

### Evidence Required

保留 transient / changedInputs 的服务响应、调用数量或目标指纹。

## STORY-LIFECYCLE-C023 — 已付费且恢复可读的图片跨修订复用

<a id="case-c023"></a>

- State: READY
- Priority: P1
- Type: INTEGRATION
- Requirement / Risk: R3；已保存输出重试
- Automation: AUTOMATED
- Owner: UNASSIGNED

### Objective

已付费且恢复可读的图片跨修订复用。

### Preconditions

独立临时书库，使用生产服务、SQLite 和受控生成器。

### Test Data

两幅故事的首图已保存。首次核对暂时读不到文件而报错，随后恢复可读。

### Runner Instructions

分别在原版和只改验收要求的新版明确恢复，记录第一幅的额外绘图调用。 [复现程序](evidence/2026-11-24-dag-retest/replay.mjs)

### Expected Outcome

两种路径都从已存图片完成，第一幅的额外调用均为零。

### Negative Assertions

恢复新版故障不能丢弃可用的原始结果。

### Evidence Required

保留 sameRevisionReceipt / carriedReceipt 的服务响应、调用数量或目标指纹。

## STORY-LIFECYCLE-C024 — 新版继承审核故障后保留完整稿件的放行入口

- State: READY
- Priority: P1
- Type: INTEGRATION
- Requirement / Risk: R3；C017 审核失败的人工出口
- Automation: AUTOMATED
- Owner: UNASSIGNED

### Objective

新版继承审核故障后保留完整稿件的放行入口。

### Preconditions

独立临时书库，使用生产服务、SQLite 和受控生成器。

### Test Data

四幅稿件齐备，首次审核失败。暂停并仅修改梗概。

### Runner Instructions

继续到独立工作结束，再暂停，核对故障阶段、稿件幅数、可见动作及放行响应。 [复现程序](evidence/2026-11-24-dag-retest/replay.mjs)

### Expected Outcome

新版保留逐幅审核故障的审核分类和跳过入口，针对当前稿件确认后可保存放行。

### Negative Assertions

稿件齐备时不得因修订丢失审核故障的身份。

### Evidence Required

保留 carriedReview 的服务响应、调用数量或目标指纹。

## STORY-LIFECYCLE-C025 — 升级已保存坏修订时恢复原有目标和授权

- State: READY
- Priority: P1
- Type: INTEGRATION
- Requirement / Risk: R3/R4；既有书库升级
- Automation: AUTOMATED
- Owner: UNASSIGNED

### Objective

升级已保存坏修订时恢复原有目标和授权。

### Preconditions

独立临时书库，使用生产服务、SQLite 和受控生成器。

### Test Data

在 0.15.0 与修复前构建各生成一篇视觉批次失败和一篇条目登记失败的故事，保存无关修订。

### Runner Instructions

正常关闭旧服务，把隔离书库复制到当前版本，通过正式初始化打开后点击继续，记录派发及状态。 [复现程序](evidence/2026-11-24-dag-retest/replay.mjs)

### Expected Outcome

四幅或两个条目的原故障均可定向恢复。未获授权前没有重复调用。

### Negative Assertions

升级后的书架不得把全图齐备的作品卡在失败，也不得丢弃登记故障。

### Evidence Required

保留 oldVisual / oldItems 的服务响应、调用数量或目标指纹。

## STORY-LIFECYCLE-C026 — 修订后仍可重试被拦截的横图

<a id="case-c026"></a>

- State: RETIRED
- Priority: P1
- Type: INTEGRATION
- Requirement / Risk: R3；故障恢复、付费输出及界面状态
- Automation: AUTOMATED
- Owner: UNASSIGNED

退役依据：独立套图的故障和重试归原版，竖图导出与原版横图恢复见 C064。保留下文供解读旧构建记录。

### Objective

修订后仍可重试被拦截的横图。

### Preconditions

使用独立临时书库、正式协调器及受控生成器。

### Test Data

四幅作品已完成，第三幅横图被提供方拦截。

### Runner Instructions

修改验收要求，继续并重启服务，比较当前版的故障、活动、横图状态和设置操作。 [复现程序](evidence/2026-11-24-dag-recovery-verification/edges.mjs)

### Expected Outcome

第三幅保留横图失败原因和重试入口，完整竖图仍可导出。

### Negative Assertions

无任务时不得显示横图仍在生成。

### Evidence Required

保留 optionalFault 的结果，包括状态、调用或恢复入口。

## STORY-LIFECYCLE-C027 — 恢复可读的横图输出不重复付费

- State: READY
- Priority: P1
- Type: INTEGRATION
- Requirement / Risk: R3；故障恢复、付费输出及界面状态
- Automation: AUTOMATED
- Owner: UNASSIGNED

### Objective

恢复可读的横图输出不重复付费。

### Preconditions

使用独立临时书库、正式协调器及受控生成器。

### Test Data

第三幅横图有付费回执，首次文件核对失败。

### Runner Instructions

让原文件恢复可读，通过正式入口重试。核对回执、像素和绘图请求数。 [复现程序](evidence/2026-11-24-dag-recovery-verification/edges.mjs)

### Expected Outcome

直接采用记录在回执中的原文件，四幅横图完整。

### Negative Assertions

文件确认可读时，重试的额外绘图请求数为零。

### Evidence Required

保留 paidLandscape 的结果，包括状态、调用或恢复入口。

## STORY-LIFECYCLE-C028 — 未配置模型时仍可从界面恢复已付费图片

- State: READY
- Priority: P2
- Type: INTEGRATION
- Requirement / Risk: R3；故障恢复、付费输出及界面状态
- Automation: AUTOMATED
- Owner: UNASSIGNED

### Objective

未配置模型时仍可从界面恢复已付费图片。

### Preconditions

使用独立临时书库、正式协调器及受控生成器。

### Test Data

两幅作品，末幅在祖先版本留有可读取的付费图片。

### Runner Instructions

修订后移除测试提供方配置并重启，比较书架、故事设置、动作清单及当前故障的恢复响应。 [复现程序](evidence/2026-11-24-dag-recovery-verification/edges.mjs)

### Expected Outcome

书架与故事设置提供可用的本地恢复操作，作品完成并保留两幅图。

### Negative Assertions

本地恢复不依赖模型配置或额外绘图。

### Evidence Required

保留 offlineReceipt 的结果，包括状态、调用或恢复入口。

## STORY-LIFECYCLE-C029 — 换画风后的横图状态与 PDF

- State: READY
- Priority: P1
- Type: INTEGRATION
- Requirement / Risk: R4
- Automation: AUTOMATED
- Owner: UNASSIGNED

### Objective

换画风后的横图状态与 PDF。

### Preconditions

独立临时书库、正式应用、生产队列与受控绘图服务。

### Test Data

原版四幅横图已齐全，新版换用水彩画风。

### Runner Instructions

继续新版，挂起所有新版横图，比较状态、逐幅输入有效性、两版文件字节及 PDF 实际取图。 [复现程序](evidence/2026-11-24-landscape-independent-review/replay.mjs)

### Expected Outcome

就绪计数只包含当前输入有效的横图。

### Negative Assertions

PDF 不选用旧画风的失效横图。

### Evidence Required

保留正式接口、调用记录及对应断言的结果。

## STORY-LIFECYCLE-C030 — 可选横图故障的通用重试

- State: READY
- Priority: P2
- Type: INTEGRATION
- Requirement / Risk: R3
- Automation: AUTOMATED
- Owner: UNASSIGNED

### Objective

可选横图故障的通用重试。

### Preconditions

独立临时书库、正式应用、生产队列与受控绘图服务。

### Test Data

第三幅横图被拦截，只修改验收要求并重启。

### Runner Instructions

把当前可选故障号提交给通用恢复接口，等待队列排空并重启，再读横图状态和任务。 [复现程序](evidence/2026-11-24-landscape-independent-review/replay.mjs)

### Expected Outcome

通用恢复成功完成该幅，或拒绝命令并保留专用重试入口。

### Negative Assertions

不得记录成功后留下无任务、无重试入口的进行中状态。

### Evidence Required

保留正式接口、调用记录及对应断言的结果。

## STORY-LIFECYCLE-C031 — 未配置模型时恢复本版的绘图回执

<a id="case-c031"></a>

- State: READY
- Priority: P2
- Type: INTEGRATION
- Requirement / Risk: R3
- Automation: AUTOMATED
- Owner: UNASSIGNED

### Objective

未配置模型时恢复本版的绘图回执。

### Preconditions

独立临时书库、正式应用、生产队列与受控绘图服务。

### Test Data

两幅竖图的第二幅、四幅横图的第三幅各有本版可读取的绘图回执。

### Runner Instructions

模拟首次文件核对缺失，恢复文件后断开模型并重启。检查动作和恢复响应，再接回模型作对照。 [复现程序](evidence/2026-11-24-landscape-independent-review/replay.mjs)

### Expected Outcome

离线操作能够将可读回执保存为当前画幅。

### Negative Assertions

恢复文件不增加绘图调用。

### Evidence Required

保留正式接口、调用记录及对应断言的结果。

## STORY-LIFECYCLE-C032 — 普通画风修订的可选横图授权

- State: READY
- Priority: P1
- Type: INTEGRATION
- Requirement / Risk: R1
- Automation: AUTOMATED
- Owner: UNASSIGNED

### Objective

普通画风修订的可选横图授权。

### Preconditions

独立临时书库、正式应用、生产队列与受控绘图服务。

### Test Data

原版已生成四幅横图，随后只保存画风修改。

### Runner Instructions

仅提交继续制作，允许竖图完成并记录已进入提供方的可选横图调用。 [复现程序](evidence/2026-11-24-landscape-independent-review/replay.mjs)

### Expected Outcome

原横图失效后等待读者明确授权重绘。

### Negative Assertions

普通换画风并继续不应派发可选横图。

### Evidence Required

保留正式接口、调用记录及对应断言的结果。

## STORY-LIFECYCLE-C033 — 删除书架作品应停止旧版本横图派发

- State: READY
- Priority: P1
- Type: INTEGRATION
- Requirement / Risk: R1
- Automation: AUTOMATED
- Owner: UNASSIGNED

### Objective

删除书架作品应停止旧版本横图派发。

### Preconditions

隔离 SQLite 书库、生产协调器和受控绘图提供方。

### Test Data

旧版四幅横图已发送第一幅；书架只显示已完成的修订版。

### Runner Instructions

删除修订版卡片，释放已发送的第一幅，排空队列并读取绘图调用。 [复现程序](evidence/2026-11-24-independent-print-review/replay.mjs)

### Expected Outcome

允许第一幅收尾，删除后不再派发其余三幅。

### Negative Assertions

书架清空后不能继续产生新的绘图调用。

### Evidence Required

记录返回状态、动作入口和实际绘图调用。

## STORY-LIFECYCLE-C034 — 横图使用的模型失效后可以恢复或替换套图

- State: READY
- Priority: P2
- Type: INTEGRATION
- Requirement / Risk: R3
- Automation: AUTOMATED
- Owner: UNASSIGNED

### Objective

横图使用的模型失效后可以恢复或替换套图。

### Preconditions

隔离 SQLite 书库、生产协调器和受控绘图提供方。

### Test Data

四幅套图已发出一幅，旧模型不可用，新模型可用。

### Runner Instructions

暂停横图，切换到新配置，尝试恢复并应用当前模型，重启后检查任务。 [复现程序](evidence/2026-11-24-independent-print-review/replay.mjs)

### Expected Outcome

有可用的恢复或替换操作，读者可以完成这套横图或重新发起。

### Negative Assertions

不得在进度停于一幅时长期占用唯一的新建入口。

### Evidence Required

记录返回状态、动作入口和实际绘图调用。

## STORY-LIFECYCLE-C035 — 旧横图控制不得暂停新版竖图

- State: READY
- Priority: P2
- Type: INTEGRATION
- Requirement / Risk: R3
- Automation: AUTOMATED
- Owner: UNASSIGNED

### Objective

旧横图控制不得暂停新版竖图。

### Preconditions

隔离 SQLite 书库、生产协调器和受控绘图提供方。

### Test Data

旧版套图完整；新版仅已启动竖图制作。

### Runner Instructions

向新版横图控制接口提交旧版真实套图编号，读取 HTTP 返回和新版制作控制。 [复现程序](evidence/2026-11-24-independent-print-review/replay.mjs)

### Expected Outcome

服务拒绝不匹配的套图编号，竖图保持制作中。

### Negative Assertions

不能把针对旧横图的暂停转交给新版主制作流程。

### Evidence Required

记录返回状态、动作入口和实际绘图调用。

## STORY-LIFECYCLE-C036 — 只在配文提及人物时核对编辑器入画提示

<a id="case-c036"></a>

- State: DRAFT
- Priority: P2
- Type: BUSINESS_E2E
- Requirement / Risk: DAG 35；编辑器可能把配文里的提及显示成入画人物。
- Automation: MANUAL
- Owner: UNASSIGNED

### Objective

核对读者看到的入画提示与已保存的入画名单一致。

### Preconditions

在隔离书库打开可编辑的完成稿，选择一幅原本没有曹操的画面。记录当前入画提示和图片。

就绪条件：先在现行阅读器确认可见入画提示的具体位置，以便修改前后取同一视图。

### Test Data

只在本幅配文加入「此时曹操尚在许都」，保留原画面描述。

### Runner Instructions

在阅读器打开修订编辑器，更改配文，比较修改前、保存并重开后的入画提示。点击继续并核对绘图次数。

### Expected Outcome

提示和入画名单保持原样，绘图调用数为零。

### Negative Assertions

配文提及不能把曹操加入画面。正式请求的断言不能证明编辑器显示正确。

### Evidence Required

同一画幅两次编辑器截图、该次修订及受控绘图计数。尚缺此 UI 对照的运行证据。

## STORY-LIFECYCLE-C037 — 重选时隔离旧结果，重新确认制作

<a id="case-c037"></a>

- State: READY
- Priority: P1
- Type: BUSINESS_E2E
- Requirement / Risk: 制作 DAG 1, 7
- Automation: MANUAL
- Owner: UNASSIGNED

### Objective

重选时隔离旧结果，重新确认制作。各分支按原编号分别取证。

### Preconditions

使用隔离书库与受控提供方。已暂停的旧故事与两个查找范围，受控查找可延迟返回。

### Test Data

重选后等待确认; 查找范围变化与晚到结果。数量、位置与对照输入见下列原编号。

### Runner Instructions

从选题界面改范围、选候选、刷新和恢复；交付旧查找结果，打开旧版历史。可复用的自动化见[story-generation-state-machine-reselection](../../tests/story-generation-state-machine-reselection.test.mjs)、[reader-intake](../../tests/reader-intake.test.mjs)。

### Expected Outcome

- DAG 1 · 暂停制作后，把《管晏列传》替换为「管鲍之交」。新选题准备好后显示本篇的两项建议，等候确认。旧版仍可从历史查看，新版在确认前的分镜与绘图调用数为零。
- DAG 7 · 在候选查找中改范围。让旧查找晚于新查找返回，确认新版只接收新条件适用的结果。选择有效候选后，测试待确认时恢复也不会开工。

### Negative Assertions

旧查找结果不得覆盖新条件，恢复不能越过制作确认。

### Evidence Required

保存新旧选题、建议、当前版本和确认前的两类调用数。记录构建和实际执行的原编号；缺一个分支时注明缺口。

## STORY-LIFECYCLE-C038 — 确认前编辑草稿并重做准备

<a id="case-c038"></a>

- State: READY
- Priority: P1
- Type: BUSINESS_E2E
- Requirement / Risk: 制作 DAG 2, 14
- Automation: MANUAL
- Owner: UNASSIGNED

### Objective

确认前编辑草稿并重做准备。各分支按原编号分别取证。

### Preconditions

使用隔离书库与受控提供方。准备中的独立故事，建议尚未返回；准备调用可分别成功或失败。

### Test Data

清空验收要求后收到准备结果; 确认前保存与刷新。数量、位置与对照输入见下列原编号。

### Runner Instructions

明确清空验收要求，保存刷新；依次尝试继续准备与开始制作。失败分支单独重试。可复用的自动化见[reader-intake](../../tests/reader-intake.test.mjs)、[story-flow-control](../../tests/story-flow-control.test.mjs)。

### Expected Outcome

- DAG 2 · 准备期间明确清空验收要求，再收到建议。制作要求可用本篇建议，验收要求保持「已留空」。准备失败时则显示可重试的失败状态。
- DAG 14 · 初次制作确认前保存修改，刷新后能读回新设置，继续显示「待制作确认」。修改导致建议待更新时，「继续准备」只跑准备，正式制作仍等待「开始制作」。

### Negative Assertions

空字段不回填；继续准备不启动正式制作。

### Evidence Required

保存刷新读回、准备失败的可用动作，以及各阶段分镜和绘图计数。记录构建和实际执行的原编号；缺一个分支时注明缺口。

## STORY-LIFECYCLE-C039 — 在审片和分镜在途时变更制作设置

<a id="case-c039"></a>

- State: READY
- Priority: P1
- Type: INTEGRATION
- Requirement / Risk: 制作 DAG 3, 6, 8
- Automation: HYBRID
- Owner: UNASSIGNED

### Objective

在审片和分镜在途时变更制作设置。各分支按原编号分别取证。

### Preconditions

使用隔离书库与受控提供方。分别保留完整稿、只有部分批次的稿、审片回执被挂起的稿。

### Test Data

只改验收要求; 放回过期审片; 部分分镜时同时修改两项设置。数量、位置与对照输入见下列原编号。

### Runner Instructions

从修订入口依次独立试验只改验收、改制作要求、改画风及组合；保存后放回旧回执，再继续。可复用的自动化见[story-requirements](../../tests/story-requirements.test.mjs)、[production-dag-scenarios](../../tests/production-dag-scenarios.test.mjs)。

### Expected Outcome

- DAG 3 · 暂停后只改验收要求，再确认重新审核。原分镜和图可查，先执行审片；审核通过且绘图输入不变时，绘图调用数为零。
- DAG 6 · 在受控测试中挂起旧版审片，分别提交新制作要求和新画风。在两种情况下放回旧审核结果，确认新版仍待审核。改制作要求后按新范围核对一次梗概，并重新编排提纲。只改画风的第一项新生成任务是转换画面描述，提纲、叙事分镜和结语的生成调用数为零。
- DAG 8 · 在分镜只完成一部分时提交两项修改。改画风和验收只更新画面描述与审核，已有叙事批次可复用；若同时改制作要求，则从一份新提纲编排。按步骤调用记录验证没有重复任务。

### Negative Assertions

旧审核结果不能批准新版；未变输入的步骤不重复派发。

### Evidence Required

逐版比对回执归属、审片输入、提纲数和分步派发数。记录构建和实际执行的原编号；缺一个分支时注明缺口。

## STORY-LIFECYCLE-C040 — 只改普通幅或替换首幅时限定重绘范围

<a id="case-c040"></a>

- State: READY
- Priority: P1
- Type: BUSINESS_E2E
- Requirement / Risk: 制作 DAG 4, 9
- Automation: MANUAL
- Owner: UNASSIGNED

### Objective

只改普通幅或替换首幅时限定重绘范围。各分支按原编号分别取证。

### Preconditions

使用隔离书库与受控提供方。独立准备一个部分出图的故事和一篇有首图及后续图的完成稿。

### Test Data

单幅、首幅及重排; 暂停改普通幅、按授权替换首幅。数量、位置与对照输入见下列原编号。

### Runner Instructions

在阅读器取消后再确认普通幅重绘，核对返回位置与重放；在修订预览改描述。另分别上传首图、只确认首图及选择整篇重绘，等待完成。按身份重排在规则层另验。可复用的自动化见[production-dag-scenarios](../../tests/production-dag-scenarios.test.mjs)、[production-dag-engine](../../tests/production-dag-engine.test.mjs)。重排按画幅身份验规则；手动重排入口未证实。 部分出图稿的编辑与完成稿的首幅整篇重绘分开执行。

### Expected Outcome

- DAG 4 · 一张普通画幅仅换图时，沿用文字与审片结论。修改画面描述时，本幅和相邻画幅的逐幅结论及全篇结论重新核对。重绘首幅时，确认界面允许上传替换首幅，并提供按新首幅重绘其余画幅的选项。只确认首幅时，其余画幅保持有效。用分镜重排验证复用按画幅身份判断，重排本身的绘图调用数为零。
- DAG 9 · 在已出部分图片时暂停，修改普通画幅的画面描述。保存时新任务数为零，继续后只重绘修改画幅。在完成稿重绘首幅并选中同时重绘其余画幅时，其他画幅等新首幅保存后再开始。

### Negative Assertions

取消单幅重绘后无派发；确认后立刻可见重绘状态，返回时仍在原幅，同一请求重放不会再绘一次。未获授权的其余画幅不得跟随首幅重绘。

### Evidence Required

保留取消/确认界面、画幅身份、审片范围、派发次序和每幅调用数。记录构建和实际执行的原编号；缺一个分支时注明缺口。

## STORY-LIFECYCLE-C041 — 跨修订采用输入相同的已付费图片

<a id="case-c041"></a>

- State: READY
- Priority: P0
- Type: INTEGRATION
- Requirement / Risk: 制作 DAG 5, 26
- Automation: HYBRID
- Owner: UNASSIGNED

### Objective

跨修订采用输入相同的已付费图片。各分支按原编号分别取证。

### Preconditions

使用隔离书库与受控提供方。同一家族的旧绘图请求在途，新版分别缺图、已有图或输入已变。另备新身份但绘图硬输入相同的画幅。

### Test Data

旧绘图在修订后返回; 同输入的新幅复用旧图。数量、位置与对照输入见下列原编号。

### Runner Instructions

提交修订后交付旧结果；继续制作并检查实际读取的文件，再用改了人物设定的样本对照。可复用的自动化见[production-dag-scenarios](../../tests/production-dag-scenarios.test.mjs)、[production-dag-engine](../../tests/production-dag-engine.test.mjs)。

### Expected Outcome

- DAG 5 · 绘图在修订提交后才返回。同家族的新版输入相同且仍缺这一幅时，直接采用可读结果。输入不同或新版已采用结果时，只保存该付费结果供有相同输入的后续版本取用。
- DAG 26 · 重新编排后，有一幅的画面描述、入画人物设定、画风和绘图参数与旧图完全一致。该幅沿用旧图，绘图调用数为零。

### Negative Assertions

输入不匹配或新版已采用结果时，不得覆盖新版或重复付费。

### Evidence Required

记录两版任务归属、输入指纹、文件可读性以及是否多付一次。记录构建和实际执行的原编号；缺一个分支时注明缺口。

## STORY-LIFECYCLE-C042 — 文件写入失败后只重试保存

<a id="case-c042"></a>

- State: READY
- Priority: P0
- Type: INTEGRATION
- Requirement / Risk: 制作 DAG 10
- Automation: HYBRID
- Owner: UNASSIGNED

### Objective

文件写入失败后只重试保存。各分支按原编号分别取证。

### Preconditions

使用隔离书库与受控提供方。准备已有受控绘图回执的稿件；可分别阻断保存、暂时拒绝读文件、移除或恢复参考图。

### Test Data

保存失败与文件可读性。数量、位置与对照输入见下列原编号。

### Runner Instructions

从恢复入口重试；依次观察待核对、明确丢失、恢复原文件后的状态。可复用的自动化见[production-dag-scenarios](../../tests/production-dag-scenarios.test.mjs)、[production-dag-faults](../../tests/production-dag-faults.test.mjs)。

### Expected Outcome

- DAG 10 · 在已有模型结果但保存失败时，重试保存，绘图调用数为零。参考图暂时不可读、确认丢失、原文件恢复分别产生待核对、待重绘、恢复复用三种结果。

### Negative Assertions

临时不可读不得当作永久丢失；重试保存不得重新绘图。

### Evidence Required

记录回执、文件哈希、读者可用动作及恢复期间的绘图次数。记录构建和实际执行的原编号；缺一个分支时注明缺口。

## STORY-LIFECYCLE-C043 — 单幅故障期间继续独立工作

<a id="case-c043"></a>

- State: READY
- Priority: P1
- Type: INTEGRATION
- Requirement / Risk: 制作 DAG 11, 50, 55
- Automation: HYBRID
- Owner: UNASSIGNED

### Objective

单幅故障期间继续独立工作。各分支按原编号分别取证。

### Preconditions

使用隔离书库与受控提供方。为同一隔离稿准备两个故障幅和其他获授权的普通幅；第 5 幅须能够成为唯一在途工作。

### Test Data

只恢复两个故障中的一个; 内容拦截时其余幅继续; 单幅故障期间任务继续领取。数量、位置与对照输入见下列原编号。

### Runner Instructions

受控拦截第 5 幅；先让其他已授权任务领取、结束，再暂停并仅恢复一个故障幅。可复用的自动化见[story-generation-state-machine-flow](../../tests/story-generation-state-machine-flow.test.mjs)、[production-dag-scenarios](../../tests/production-dag-scenarios.test.mjs)。

### Expected Outcome

- DAG 11 · 同时留下两个失效画幅，只恢复其中一个，另一个仍等待。故障与暂停同时出现时，恢复生成不能代替针对故障的恢复操作。
- DAG 50 · 第 5 幅绘图被内容拦截时，其余已获授权的画幅继续绘制；第 5 幅等待其恢复动作，整篇不判定完成。
- DAG 55 · 第 5 幅是唯一在途任务时绘图被内容拦截，会话进入 failed。其余已获授权且依赖就绪的画幅随后取得锁，会话进入 running，第 5 幅的故障记录保留；其余画幅完成后会话回到 failed，整篇不判定完成。

### Negative Assertions

其余画幅完成不得掩盖仍未恢复的故障。

### Evidence Required

按时间记录 failed、running、failed、任务号、故障幅号与其他获授权幅的结果。记录构建和实际执行的原编号；缺一个分支时注明缺口。

## STORY-LIFECYCLE-C044 — 双窗口提交与请求重放

<a id="case-c044"></a>

- State: READY
- Priority: P1
- Type: BUSINESS_E2E
- Requirement / Risk: 制作 DAG 12
- Automation: MANUAL
- Owner: UNASSIGNED

### Objective

双窗口提交与请求重放。各分支按原编号分别取证。

### Preconditions

使用隔离书库与受控提供方。两个独立阅读器窗口打开同一版本与编辑令牌。

### Test Data

并发提交及重放。数量、位置与对照输入见下列原编号。

### Runner Instructions

同时保存两份不同草稿；暂停胜出的版本，重放原成功请求。可复用的自动化见[paused-editing-versions](../../tests/paused-editing-versions.test.mjs)、[story-revision-flow](../../tests/story-revision-flow.test.mjs)。

### Expected Outcome

- DAG 12 · 两个窗口同时提交同一个旧版本，再重放成功提交的请求。只形成一次切换，不重新启动已经暂停的准备或制作。

### Negative Assertions

重放不能再次切换版本或解除暂停。

### Evidence Required

保存两份回包、失败方草稿、唯一当前版本与暂停后的新任务数。记录构建和实际执行的原编号；缺一个分支时注明缺口。

## STORY-LIFECYCLE-C045 — 从三个入口保存后都等待继续

<a id="case-c045"></a>

- State: READY
- Priority: P1
- Type: BUSINESS_E2E
- Requirement / Risk: 制作 DAG 13
- Automation: MANUAL
- Owner: UNASSIGNED

### Objective

从三个入口保存后都等待继续。各分支按原编号分别取证。

### Preconditions

使用隔离书库与受控提供方。分别打开正在审核、已暂停及已完成的故事，并记录其版本号。

### Test Data

三种状态保存后等待继续。数量、位置与对照输入见下列原编号。

### Runner Instructions

在三个阅读器入口分别提交影响制作的修改，刷新读取状态，最后点击继续。可复用的自动化见[paused-editing-versions](../../tests/paused-editing-versions.test.mjs)、[production-dag-scenarios](../../tests/production-dag-scenarios.test.mjs)。

### Expected Outcome

- DAG 13 · 分别从正在审片、已暂停和整篇完成的故事保存一次影响制作的修改。三个入口都显示「已保存，等待继续」。从保存成功到点击「继续制作」，新版模型调用数为零。

### Negative Assertions

点击继续前，新版模型调用数必须为零。

### Evidence Required

逐个记录显示文字、可用动作、新版本号、保存到继续间的模型调用数。记录构建和实际执行的原编号；缺一个分支时注明缺口。

## STORY-LIFECYCLE-C046 — 手改配文触发审片，按读者选择更新画面

<a id="case-c046"></a>

- State: DRAFT
- Priority: P1
- Type: BUSINESS_E2E
- Requirement / Risk: 制作 DAG 16
- Automation: MANUAL
- Owner: UNASSIGNED

### Objective

手改配文触发审片，按读者选择更新画面。各分支按原编号分别取证。

### Preconditions

使用隔离书库与受控提供方。已有完整故事、相邻幅及全篇结论。

就绪条件：先确认现行编辑器是否提供配文联动更新描述的入口。配文单改已有正式流程回归。

### Test Data

配文与画面联动。数量、位置与对照输入见下列原编号。

### Runner Instructions

在编辑器只改配文，保存并继续；单独查找并试用原编号所述联动选项。可复用的自动化见[production-dag-scenarios](../../tests/production-dag-scenarios.test.mjs)、[production-dag-review](../../tests/production-dag-review.test.mjs)。配文回归可执行；历史所述「同时更新画面描述」复选框缺少现行入口证据。

### Expected Outcome

- DAG 16 · 手改一幅配文时，一次审片复核本幅、相邻画幅和全篇结论。未要求更新画面描述时不发起绘图。勾选「同时更新画面描述」后重做本幅描述和竖图。

### Negative Assertions

单改配文不能隐式要求重绘。

### Evidence Required

各记审片范围、次数、画面描述和图像哈希；无法操作的 UI 分支单列缺口。记录构建和实际执行的原编号；缺一个分支时注明缺口。

## STORY-LIFECYCLE-C047 — 改一个人物外观只重绘其出场画幅

<a id="case-c047"></a>

- State: READY
- Priority: P1
- Type: INTEGRATION
- Requirement / Risk: 制作 DAG 17
- Automation: HYBRID
- Owner: UNASSIGNED

### Objective

改一个人物外观只重绘其出场画幅。各分支按原编号分别取证。

### Preconditions

使用隔离书库与受控提供方。完成稿中同一人物只在部分画幅入画，另有只在配文提及的人物。

### Test Data

只改一人的外观。数量、位置与对照输入见下列原编号。

### Runner Instructions

仅修改该人物的一项外观设定，保存继续，逐幅比对原图与新请求。可复用的自动化见[production-dag-scenarios](../../tests/production-dag-scenarios.test.mjs)、[production-dag-engine](../../tests/production-dag-engine.test.mjs)。

### Expected Outcome

- DAG 17 · 修改一个人物的外观。继续后只有出现该人物的画幅重绘，其余图片沿用。

### Negative Assertions

不入画人物的修改不能触发本幅绘图。

### Evidence Required

保留人物身份、入画名单、图像哈希与实际派发幅号。记录构建和实际执行的原编号；缺一个分支时注明缺口。

## STORY-LIFECYCLE-C048 — 放行绑定结论，修改受影响输入后重新复核

<a id="case-c048"></a>

- State: READY
- Priority: P1
- Type: INTEGRATION
- Requirement / Risk: 制作 DAG 18, 58
- Automation: HYBRID
- Owner: UNASSIGNED

### Objective

放行绑定结论，修改受影响输入后重新复核。各分支按原编号分别取证。

### Preconditions

使用隔离书库与受控提供方。准备至少 20 幅的完整稿，第 5 幅结论阻断；另一份稿件尚未选定标题和结语且缺少结论。

### Test Data

放行在相应输入变化后失效; 首次选择标题结语并放行。数量、位置与对照输入见下列原编号。

### Runner Instructions

选择「仍然绘图」并首次选定标题、结语。另按两个独立修订先改第 20 幅，再改第 5 幅。可复用的自动化见[production-dag-review](../../tests/production-dag-review.test.mjs)、[production-dag-scenarios](../../tests/production-dag-scenarios.test.mjs)。当前读者操作统一放行本轮所有阻断或待定结论，之后各自按输入失效。 旧核查只放行目标结论；现行操作放行所有待定或阻断项，各自绑定输入。

### Expected Outcome

- DAG 18 · 第 5 幅的逐幅结论阻断后被明确放行并开始绘图。随后手改第 20 幅画面描述，第 5 幅的放行仍有效；手改第 5 幅画面描述后，放行失效，第 5 幅需要重新复核才可绘图。
- DAG 58 · 第 5 幅审片阻断，读者选择「仍然绘图」并首次选定标题与结语。本轮未通过和缺少的结论按当前输入分别放行。

### Negative Assertions

改无关画幅不能撤销原放行；输入已变不能沿用原放行。

### Evidence Required

按幅记录输入指纹、原放行、重新审核和再次获准绘图的时点。记录构建和实际执行的原编号；缺一个分支时注明缺口。

## STORY-LIFECYCLE-C049 — 自动修复遇到手改内容时停下

<a id="case-c049"></a>

- State: READY
- Priority: P1
- Type: BUSINESS_E2E
- Requirement / Risk: 制作 DAG 19, 43
- Automation: MANUAL
- Owner: UNASSIGNED

### Objective

自动修复遇到手改内容时停下。各分支按原编号分别取证。

### Preconditions

使用隔离书库与受控提供方。有手改配文的稿件；为结构修复样本准备含手改的第 12、13 幅。

### Test Data

保护手改配文; 结构修订遇到手改。数量、位置与对照输入见下列原编号。

### Runner Instructions

让受控审核只提出会覆盖手改的修复，再返回合并建议；观察读者处理入口，另在手动修改中确认损失。可复用的自动化见[production-dag-hand-edits](../../tests/production-dag-hand-edits.test.mjs)、[production-dag-scenarios](../../tests/production-dag-scenarios.test.mjs)。

### Expected Outcome

- DAG 19 · 手改一幅配文后，审片问题只能通过改动该配文解决。自动修订不覆盖手改，故事停在「需读者处理」。
- DAG 43 · 自动结构修订要把含手改的第 12 幅与第 13 幅合并。修订结果不提交，故事停在「需读者处理」并显示将受影响的手改；读者可以另发手动结构修改并确认手改损失。

### Negative Assertions

未确认损失前不能改写手改字段或保存自动合并。

### Evidence Required

保存前后读回手改内容、幅号、故障提示、确认动作和版本号。记录构建和实际执行的原编号；缺一个分支时注明缺口。

## STORY-LIFECYCLE-C050 — 内容拦截后从正确一步恢复

<a id="case-c050"></a>

- State: READY
- Priority: P1
- Type: INTEGRATION
- Requirement / Risk: 制作 DAG 20, 29
- Automation: HYBRID
- Owner: UNASSIGNED

### Objective

内容拦截后从正确一步恢复。各分支按原编号分别取证。

### Preconditions

使用隔离书库与受控提供方。两篇隔离稿件分别在普通幅绘图和编排阶段，受控提供方返回内容拦截。

### Test Data

绘图内容拦截; 编排内容拦截。数量、位置与对照输入见下列原编号。

### Runner Instructions

重启后先观察队列，再分别改本幅描述或制作要求并继续。可复用的自动化见[production-dag-faults](../../tests/production-dag-faults.test.mjs)、[production-dag-scenarios](../../tests/production-dag-scenarios.test.mjs)。

### Expected Outcome

- DAG 20 · 绘图返回内容拦截。中断恢复不自动重试；修改本幅画面描述并重新审片后可以绘制。
- DAG 29 · 编排步骤被内容拦截。中断恢复不自动重试；修改制作要求后继续，编排从提纲开始。

### Negative Assertions

重启不能代替读者授权。

### Evidence Required

列出重启后未授权调用数、首次新调用、重审结果与最终图。记录构建和实际执行的原编号；缺一个分支时注明缺口。

## STORY-LIFECYCLE-C051 — 两篇故事遇到同一个图片服务凭据故障

<a id="case-c051"></a>

- State: DRAFT
- Priority: P1
- Type: INTEGRATION
- Requirement / Risk: 制作 DAG 21
- Automation: HYBRID
- Owner: UNASSIGNED

### Objective

两篇故事遇到同一个图片服务凭据故障。各分支按原编号分别取证。

### Preconditions

使用隔离书库与受控提供方。在隔离服务内为两篇在途故事设置同一受控图片服务，另备配置正常的对照。

就绪条件：备好可对两篇在制作品共享注入、解除图片凭据故障的隔离配置，并验证两篇都指向该服务。

### Test Data

两篇共用图片服务凭据。数量、位置与对照输入见下列原编号。

### Runner Instructions

移除测试凭据，分别读两篇故事的状态、故障与任务；恢复配置，观察队列。可复用的自动化见[settings-faults](../../tests/settings-faults.test.mjs)、[production-dag-scenarios](../../tests/production-dag-scenarios.test.mjs)。早期两篇图片服务故障核查出现逐篇故障；共享文字服务或横图快照阻断的结果不能证明此分支。待隔离复验。

### Expected Outcome

- DAG 21 · 移除当前图片服务的密钥。所有进行中的故事显示同一服务故障，不产生逐篇步骤故障；恢复密钥后无需逐篇重试即可继续。

### Negative Assertions

不同服务的故障或单篇故障不能充当共享凭据故障的证明。

### Evidence Required

保留两篇状态、服务故障归属、重试次数和恢复后派发记录，标出服务类型。记录构建和实际执行的原编号；缺一个分支时注明缺口。

## STORY-LIFECYCLE-C052 — 模型配置与模板更新对旧作品的影响

<a id="case-c052"></a>

- State: READY
- Priority: P1
- Type: INTEGRATION
- Requirement / Risk: 制作 DAG 22, 23
- Automation: HYBRID
- Owner: UNASSIGNED

### Objective

模型配置与模板更新对旧作品的影响。各分支按原编号分别取证。

### Preconditions

使用隔离书库与受控提供方。已确认故事含可读产物和旧图片快照，另备新故事及不同模板输入。

### Test Data

模型快照与全局设置; 提示词模板升级。数量、位置与对照输入见下列原编号。

### Runner Instructions

分别修改全局图片设置、文字模型和推理档位；对旧故事应用当前设置。单独以新模板打开旧稿。可复用的自动化见[production-dag-provider-snapshot](../../tests/production-dag-provider-snapshot.test.mjs)、[production-dag-engine](../../tests/production-dag-engine.test.mjs)、[production-dag-scenarios](../../tests/production-dag-scenarios.test.mjs)。

### Expected Outcome

- DAG 22 · 制作确认后修改全局图片模型。该故事继续使用快照里的模型；新建故事使用新模型；对该故事「应用当前模型设置」后，已有图片沿用，只有之后的绘图使用新图片模型。修改全局文字模型或推理档位后，接下来发出的文字调用使用新设置。
- DAG 23 · 应用升级改变提示词模板后，已有产物仍有效，模型调用数为零。

### Negative Assertions

模板与全局设置变动不能让已付费的可读图失效。

### Evidence Required

记录旧图哈希、快照、后续文字/图片请求的实际设置与打开旧稿的调用数。记录构建和实际执行的原编号；缺一个分支时注明缺口。

## STORY-LIFECYCLE-C053 — 重绘竖图后仍能打印原横图套图

<a id="case-c053"></a>

- State: READY
- Priority: P1
- Type: INTEGRATION
- Requirement / Risk: 制作 DAG 24, 57
- Automation: HYBRID
- Owner: UNASSIGNED

### Objective

重绘竖图后仍能打印原横图套图。各分支按原编号分别取证。

### Preconditions

使用隔离书库与受控提供方。完成稿至少 8 幅，独立生成第 8 幅横图，保存原版与导出文件。

### Test Data

竖图重绘与横图套图; 原版横图输入与打印。数量、位置与对照输入见下列原编号。

### Runner Instructions

捕获横图请求，重绘第 8 幅竖图，从新版导出并回原稿打印横图。可复用的自动化见[production-dag-call-contract](../../tests/production-dag-call-contract.test.mjs)、[production-dag-scenarios](../../tests/production-dag-scenarios.test.mjs)。旧核查表及 C008 当时要求连带重绘横图；现行[生命周期动作](../../.docs/story-production-lifecycle.md)与独立套图交付规则一致。 旧核查要求该横图失效；现行原稿套图可打印。

### Expected Outcome

- DAG 24 · 重绘一幅已有横图的竖图。先前的横图套图保存在原版，新版导出与竖图重绘均不会发出横图调用。
- DAG 57 · 为第 8 幅生成横图，调用只读取本幅竖图、画面描述、入画人物设定、画风和绘图参数，不读取配文或制作要求。重绘第 8 幅竖图后，该套横图仍按原稿可打印。

### Negative Assertions

竖图重绘及新版导出不能隐式授权横图调用。

### Evidence Required

保存实际横图输入、两版图片哈希、打印/导出文件及竖图重绘伴随的横图调用数。记录构建和实际执行的原编号；缺一个分支时注明缺口。

## STORY-LIFECYCLE-C054 — 确认后修改改编重点或重新准备建议

<a id="case-c054"></a>

- State: READY
- Priority: P1
- Type: INTEGRATION
- Requirement / Risk: 制作 DAG 25
- Automation: HYBRID
- Owner: UNASSIGNED

### Objective

确认后修改改编重点或重新准备建议。各分支按原编号分别取证。

### Preconditions

使用隔离书库与受控提供方。已确认并有分镜和图片的稿件，准备建议可被再次请求。

### Test Data

确认后改重点或更新建议。数量、位置与对照输入见下列原编号。

### Runner Instructions

分别只改改编重点、从正式入口请求刷新建议；等准备完成再打开原稿。可复用的自动化见[production-dag-scenarios](../../tests/production-dag-scenarios.test.mjs)、[production-dag-engine](../../tests/production-dag-engine.test.mjs)。

### Expected Outcome

- DAG 25 · 确认制作后修改改编重点，或让建议重新生成。已确认的设置、分镜和图片保持有效，制作调用数为零。

### Negative Assertions

刷新建议不能覆盖已确认的设置或触发制作。

### Evidence Required

核对确认设置、原分镜与图片、建议调用与正式制作调用的各自计数。记录构建和实际执行的原编号；缺一个分支时注明缺口。

## STORY-LIFECYCLE-C055 — 换画风时转换并保留手改描述

<a id="case-c055"></a>

- State: READY
- Priority: P1
- Type: INTEGRATION
- Requirement / Risk: 制作 DAG 28, 40
- Automation: HYBRID
- Owner: UNASSIGNED

### Objective

换画风时转换并保留手改描述。各分支按原编号分别取证。

### Preconditions

使用隔离书库与受控提供方。完成稿内有读者手改画面描述、旧画风、可读图及已通过的审片。

### Test Data

换画风时保留手改; 画风转换的输入指纹。数量、位置与对照输入见下列原编号。

### Runner Instructions

变更画风并继续，截取转换回执，审核前后分别读取有效性及绘图。可复用的自动化见[production-dag-engine](../../tests/production-dag-engine.test.mjs)、[production-dag-scenarios](../../tests/production-dag-scenarios.test.mjs)。

### Expected Outcome

- DAG 28 · 手改一幅画面描述后换画风。转换自动以手改内容为基准，结果仍标为手改。
- DAG 40 · 换画风后，转换产出的新画面描述记录新画风的指纹，立即有效，复核通过后即可绘图；旧画面描述和旧画风只作为来源保存。

### Negative Assertions

不得用旧画风标记新描述，也不得抹去读者手改来源。

### Evidence Required

保留手改来源、新描述、风格指纹、手改标识和审核前后的调用顺序。记录构建和实际执行的原编号；缺一个分支时注明缺口。

## STORY-LIFECYCLE-C056 — 限制一轮审片的调用次数与写回范围

<a id="case-c056"></a>

- State: READY
- Priority: P1
- Type: INTEGRATION
- Requirement / Risk: 制作 DAG 30, 31, 36, 52
- Automation: HYBRID
- Owner: UNASSIGNED

### Objective

限制一轮审片的调用次数与写回范围。各分支按原编号分别取证。

### Preconditions

使用隔离书库与受控提供方。准备 40 幅已通过的故事，部分结论曾明确放行；受控审片可以返回超出允许清单的判断。

### Test Data

40 幅中的局部审片; 多幅一次审片; 15 幅批量修改; 超出允许清单的审片返回。数量、位置与对照输入见下列原编号。

### Runner Instructions

分别只改第 10 幅或批量修改 15 幅；在本轮回执夹带第 30 幅问题。比较请求清单、写回和其后的修复任务。可复用的自动化见[production-dag-review](../../tests/production-dag-review.test.mjs)、[production-dag-call-contract](../../tests/production-dag-call-contract.test.mjs)、[production-dag-scenarios](../../tests/production-dag-scenarios.test.mjs)。旧核查看作建议；当前丢弃超出允许清单的判断。 旧核查保留范围外建议；现行直接丢弃。

### Expected Outcome

- DAG 30 · 在 40 幅已通过的故事中手改第 10 幅画面描述。审片复核第 9–11 幅以及全篇结论；模型另报第 30 幅的局部问题时丢弃该判断。
- DAG 31 · 多幅描述失效时，一次审片处理受影响的逐幅结论与全篇结论。
- DAG 36 · 手改 15 幅的画面描述后，审片只调用一次，未受影响的逐幅结论与放行原样沿用。
- DAG 52 · 一次审片调用的允许清单只含第 9–11 幅结论。返回结果另含第 30 幅的不通过判断，该判断直接丢弃，不更改第 30 幅的结论或触发修订。

### Negative Assertions

范围外结论不能改变已有判断、触发修订或以建议保留。

### Evidence Required

保存每轮调用计数、允许清单、未改幅结论与放行及丢弃范围外判断的证据。记录构建和实际执行的原编号；缺一个分支时注明缺口。

## STORY-LIFECYCLE-C057 — 重编预览披露手改损失并按身份复用

<a id="case-c057"></a>

- State: READY
- Priority: P1
- Type: INTEGRATION
- Requirement / Risk: 制作 DAG 33, 34
- Automation: HYBRID
- Owner: UNASSIGNED

### Objective

重编预览披露手改损失并按身份复用。各分支按原编号分别取证。

### Preconditions

使用隔离书库与受控提供方。完成稿有手改配文、重绘说明和可比较输入的图片。

### Test Data

预览手改损失; 合并拆分后的身份。数量、位置与对照输入见下列原编号。

### Runner Instructions

在预览取消一次，再确认一次；用受控结构修订合并第 3、4 幅并拆分第 7 幅。可复用的自动化见[production-dag-runner](../../tests/production-dag-runner.test.mjs)、[production-dag-scenarios](../../tests/production-dag-scenarios.test.mjs)。旧核查保留合并首幅和拆分首段身份；目前新幅均获新身份。

### Expected Outcome

- DAG 33 · 手改一幅配文后修改制作要求。预览列出将移除的原幅号和手改内容，读者确认一次后保存，也可取消。
- DAG 34 · 结构修订把第 3、4 幅合并、把第 7 幅拆成两幅。合并所得一幅和拆分所得两幅均取得新身份。原样保留的画幅保留手改与重绘说明。绘图输入相同的新增画幅复用已保存的图。

### Negative Assertions

不得把被拆分或合并的旧身份赋给新幅，取消不能丢手改。

### Evidence Required

列出原幅号、新旧身份、确认前后的原稿、手改和说明及图片复用。记录构建和实际执行的原编号；缺一个分支时注明缺口。

## STORY-LIFECYCLE-C058 — 修复额度用完后重新授权

<a id="case-c058"></a>

- State: READY
- Priority: P1
- Type: BUSINESS_E2E
- Requirement / Risk: 制作 DAG 37
- Automation: MANUAL
- Owner: UNASSIGNED

### Objective

修复额度用完后重新授权。各分支按原编号分别取证。

### Preconditions

使用隔离书库与受控提供方。已有完整稿和仍需修复的问题，通过受控调用消耗本版 20 次额度。

### Test Data

用尽 20 次修复额度。数量、位置与对照输入见下列原编号。

### Runner Instructions

从界面继续自动修复，重放同一授权；另存新修订后读取新额度。可复用的自动化见[production-dag-review](../../tests/production-dag-review.test.mjs)、[production-dag-scenarios](../../tests/production-dag-scenarios.test.mjs)。

### Expected Outcome

- DAG 37 · 自动修订用完 20 次后点击「继续自动修复」，获得新的 20 次；保存新修订后额度重新从 20 次开始。

### Negative Assertions

同一次授权重放不能叠加修复额度。

### Evidence Required

记录各版已用/剩余额度、授权回包和审核通过前的绘图计数。记录构建和实际执行的原编号；缺一个分支时注明缺口。

## STORY-LIFECYCLE-C059 — 用旧书库副本演练升级后的首次使用

<a id="case-c059"></a>

- State: READY
- Priority: P0
- Type: INTEGRATION
- Requirement / Risk: 制作 DAG 38
- Automation: HYBRID
- Owner: UNASSIGNED

### Objective

用旧书库副本演练升级后的首次使用。各分支按原编号分别取证。

### Preconditions

使用隔离书库与受控提供方。选用兼容的旧格式夹具副本，含完成稿、绘图在途、放行、旧阅读模式和已有横图请求。

### Test Data

多类旧作品同次升级。数量、位置与对照输入见下列原编号。

### Runner Instructions

从正式书库初始化打开每个副本；检查备份，再打开、继续或恢复各类故事，对照已存产物。可复用的自动化见[production-dag-convert](../../tests/production-dag-convert.test.mjs)、[production-dag-migration](../../tests/production-dag-migration.test.mjs)。原编号 44–46 退役；整库备份、恢复与零推理仍须按现行升级规则实测。

### Expected Outcome

- DAG 38 · 在同一次升级中核对已完成、绘图中、明确放行、原阅读模式及已有横图请求的作品。已完成作品可读；绘图只补缺幅；放行随绑定输入失效；未完成的原阅读模式和横图请求等待读者恢复。迁移模型调用数为零。

### Negative Assertions

升级本身不得调用模型，也不得擅自继续原来未完成的工作。

### Evidence Required

保存前后格式、备份校验、可读文件、缺幅、放行失效点和迁移调用计数。记录构建和实际执行的原编号；缺一个分支时注明缺口。

## STORY-LIFECYCLE-C060 — 分批编排时验证叙事、人物与描述依赖

<a id="case-c060"></a>

- State: READY
- Priority: P1
- Type: INTEGRATION
- Requirement / Risk: 制作 DAG 41, 49
- Automation: HYBRID
- Owner: UNASSIGNED

### Objective

分批编排时验证叙事、人物与描述依赖。各分支按原编号分别取证。

### Preconditions

使用隔离书库与受控提供方。跨批次故事含至少第 7 幅；受控编排提供方允许逐批交付。

### Test Data

首批及后续编排; 叙事、人物与画面描述依赖。数量、位置与对照输入见下列原编号。

### Runner Instructions

截取首批与续批请求和结果，按引擎规则另对照缺少叙事或人物的第 7 幅。可复用的自动化见[production-dag-scenarios](../../tests/production-dag-scenarios.test.mjs)、[production-dag-engine](../../tests/production-dag-engine.test.mjs)。现行首批合并编排；单幅描述的就绪由依赖断言验证，不能据此要求额外的独立派发。

### Expected Outcome

- DAG 41 · 检查编排调用记录：首批同时给出提纲、人物、配文和画面描述，后续批次沿用全篇设定；各产物按各自硬输入保存。
- DAG 49 · 新编排时，第 7 幅叙事分镜尚未完成，第 7 幅画面描述不启动。叙事分镜和人物设定就绪后，画面描述参考全篇人物设定并产出入画人物。

### Negative Assertions

不拆出额外付费调用来证明依赖关系；缺输入时不能把描述当作有效。

### Evidence Required

保存每批实际调用、各产物绑定、依赖就绪顺序与生成的入画名单。记录构建和实际执行的原编号；缺一个分支时注明缺口。

## STORY-LIFECYCLE-C061 — 只改另一幅时在新版补画已确认丢失的图

<a id="case-c061"></a>

- State: READY
- Priority: P1
- Type: INTEGRATION
- Requirement / Risk: 制作 DAG 42
- Automation: HYBRID
- Owner: UNASSIGNED

### Objective

只改另一幅时在新版补画已确认丢失的图。各分支按原编号分别取证。

### Preconditions

使用隔离书库与受控提供方。20 幅完成稿的第 2 幅已确认丢图，第 20 幅可编辑。

### Test Data

丢失第 2 幅时只改第 20 幅。数量、位置与对照输入见下列原编号。

### Runner Instructions

只改第 20 幅描述，预览、保存并继续；再次打开原版本。可复用的自动化见[production-dag-scenarios](../../tests/production-dag-scenarios.test.mjs)、[story-requirements](../../tests/story-requirements.test.mjs)。旧核查及 C015/C022 要求同输入继承丢图故障等待授权；现行新版补缺图，原版保留故障。

### Expected Outcome

- DAG 42 · 第 2 幅已确认丢图。只修改第 20 幅画面描述并保存，预览列出两幅并标明第 2 幅已确认丢失。点击「继续制作」后两幅绘制，原版本仍显示丢图故障。

### Negative Assertions

原版故障不应消失，也不能把新版同一幅永久留在等待恢复。

### Evidence Required

保存预览中的两个幅号及原因、实际绘图幅号、原版故障和新版状态。记录构建和实际执行的原编号；缺一个分支时注明缺口。

## STORY-LIFECYCLE-C062 — 重排揭示位置或改结语时复核对应结论

<a id="case-c062"></a>

- State: READY
- Priority: P1
- Type: INTEGRATION
- Requirement / Risk: 制作 DAG 47, 48
- Automation: HYBRID
- Owner: UNASSIGNED

### Objective

重排揭示位置或改结语时复核对应结论。各分支按原编号分别取证。

### Preconditions

使用隔离书库与受控提供方。已验收的稿件末尾才揭示身份，结语呼应开篇，并有逐幅结论及原图。

### Test Data

把身份揭示移到开头; 读者改写结语。数量、位置与对照输入见下列原编号。

### Runner Instructions

通过结构修订调整揭示位置。独立试验由读者改写结语；两次均检查全篇和逐幅结论。可复用的自动化见[production-dag-review](../../tests/production-dag-review.test.mjs)、[production-dag-scenarios](../../tests/production-dag-scenarios.test.mjs)。受控结构修订可重排；读者手动重排入口未证实。

### Expected Outcome

- DAG 47 · 把揭示身份的一幅移到开头。复核全篇结论里的「结尾才揭示身份」和位置变化处的逐幅结论。图片内容不变。
- DAG 48 · 读者改写结语后复核全篇结论，包括「结语呼应开篇」；沿用逐幅结论及读者选定的结语。

### Negative Assertions

改结语不得覆盖读者所选结语，不得无故重绘。

### Evidence Required

保存相关结论、未改幅指纹、结语原文、图片哈希及派发数。记录构建和实际执行的原编号；缺一个分支时注明缺口。

## STORY-LIFECYCLE-C063 — 逐项核对结构、结语及审片的请求输入

<a id="case-c063"></a>

- State: READY
- Priority: P1
- Type: INTEGRATION
- Requirement / Risk: 制作 DAG 56
- Automation: HYBRID
- Owner: UNASSIGNED

### Objective

逐项核对结构、结语及审片的请求输入。各分支按原编号分别取证。

### Preconditions

使用隔离书库与受控提供方。准备会分别触发幅数与结构核对、结语修订和审片的三份受控输入。

### Test Data

三类文字调用的输入契约。数量、位置与对照输入见下列原编号。

### Runner Instructions

经正式调用构造器截取三种请求，逐项与制作规范的调用契约比对。可复用的自动化见[production-dag-call-contract](../../tests/production-dag-call-contract.test.mjs)、[production-dag-requests](../../tests/production-dag-requests.test.mjs)。旧核查曾列条目登记；现行核对的第三类请求是审片。

### Expected Outcome

- DAG 56 · 检查幅数与结构核对、结语修订和审片的调用记录，读取内容符合调用契约。

### Negative Assertions

请求不能夹带契约未声明的输入。

### Evidence Required

保存三份请求的实读字段、输入来源和每条契约的差异。记录构建和实际执行的原编号；缺一个分支时注明缺口。

## STORY-LIFECYCLE-C064 — 单幅横图失败后仍能导出完成稿

<a id="case-c064"></a>

- State: READY
- Priority: P1
- Type: BUSINESS_E2E
- Requirement / Risk: 制作 DAG 59
- Automation: MANUAL
- Owner: UNASSIGNED

### Objective

单幅横图失败后仍能导出完成稿。各分支按原编号分别取证。

### Preconditions

使用隔离书库与受控提供方。至少 8 幅的完成稿，竖图均可读，受控横图调用只在第 8 幅失败。

### Test Data

横图失败时仍可导出。数量、位置与对照输入见下列原编号。

### Runner Instructions

发起横图，失败后查看第 8 幅、书架和其他画幅，随后从生产导出入口导出作品。另保存一次验收要求修订：回到原套图明确重试，记录重试归属和新版的竖图导出。可复用的自动化见[production-dag-scenarios](../../tests/production-dag-scenarios.test.mjs)、[production-reader-exit-flows](../../tests/production-reader-exit-flows.test.mjs)。

### Expected Outcome

- DAG 59 · 已完成作品为第 8 幅生成横图失败。横图故障只显示在第 8 幅横图上，作品仍判定完成并可以导出。

### Negative Assertions

可选横图故障不能阻断竖图导出、取消完成状态或污染其他幅。修改验收要求不能把旧套图的故障或重试转给新版；明确重试只恢复原套图的失败幅。

### Evidence Required

保存逐幅与整篇状态、导出文件及图片清单，标明仅横图的失败。记录构建和实际执行的原编号；缺一个分支时注明缺口。

## STORY-LIFECYCLE-C065 — 阅读器取消、确认和重放单幅重绘

<a id="case-c065"></a>

- State: READY
- Priority: P0
- Type: BUSINESS_E2E
- Requirement / Risk: 制作 DAG 4、9、24；读者可能被重复扣费或产生无用修订。
- Automation: HYBRID
- Owner: UNASSIGNED

### Objective

保留 C008 仍适用的阅读器承诺。独立横图的原版打印、请求字段和导出由 C053 验收。

### Preconditions

隔离书库有已完成的六幅故事，竖图均可读；记录版本列表、图像标识与调用计数。在应用内浏览器以手机宽度打开第 2 幅。

### Test Data

同一画幅先取消，再确认。保留确认请求的标识，用于服务层重放。

### Runner Instructions

在阅读器选择「重新生图」并取消，检查提交和版本计数；再次打开并确认。观察当前幅位置和进行中状态，等图片可读，回原版核对旧图。用[正式流程回归](../../tests/production-dag-scenarios.test.mjs)的 `confirming a reader redraw starts one frame immediately` 检验相同请求的重放。

### Expected Outcome

取消后保留原版。确认后只建一个新版并立即开始第 2 幅的重绘，界面保持在第 2 幅。完成后新版新图与原版旧图都可读，其他幅、分镜与审核沿用。重放返回同一修订。

### Negative Assertions

取消产生零提交、零新版、零绘图；确认后无需再点继续。同一请求重放产生零额外修订与模型调用。其他竖图、横图、文字和审片的新增调用均为零。

### Evidence Required

保存取消前后的提交、版本及调用数，确认后与完成后的阅读器状态、图像可读性，两次请求返回的版本 ID，以及全部实际派发幅号。C008 的旧构建记录只供追溯。
