# 统一制作确认界面

Git base: 9b02367。进入本轮已存在的紧凑画风组件/reader.css修改是本故事依赖并计入范围；先前队列/修订文档和版本号/CHANGELOG/Cargo修改不计入提交。
风险non-low：共享编辑跨新建/修订、确认动作释放付费队列门槛、叠加弹窗生命周期。

不改持久化结构；服务端仅补充后续发现的选题阶段归一化，其他队列语义不变。新建确认继续保存本地settings，隐藏但保留原narrativeDetail。选择/重新推荐/最终确认仍经gen.setup的幂等与generation锁。后续generation变化以服务器返回设置重置草稿；不在选择控件上触发队列。

将现有Sheet原样移入独立模块，使新建与阅读使用同一个锁集合。抽取StoryEditorTabs与StoryProductionEditor（制作要求/画风/幅数）供StoryRevisionEditor与StoryCreationSetup共用；保留修订专用分镜及影响/提交动作，新建有独立确认按钮，不伪造revision snapshot或plan。

StoryGenerationStatus允许传入既有ProductionTimeline的步骤/导航；新建将它作为唯一流程展示。选好故事后关闭候选长列表，仅通过“重新选择”弹窗展示；选择和再找一批携带当前草稿偏好。未准备完成时不开放编辑，队列仍由现有阶段管理。

StorySource支持story或待确认sessionId两种输入。已有story的补全行为不变；仅sessionId输入只GET已保存原文，失败只重读，不POST补全。标题/出处/来源说明使用同一组件，不捏造Story对象。

- [x] 首个SS probe：隔离fixture从创建到confirming，证明仅sessionId能读原文，未确认时plans/images=0；失败停止并回AR。
- [x] 提取Sheet及共享编辑内容，旧修订四标签/草稿/影响提交行为不变；保留紧凑15画风。
- [x] 将新建接到可操作的流程展示，候选重选与原文窗口复用；去掉详略UI，保留隐藏已存值和最终确认门槛。
- [x] 增加必要渲染边界断言（不出现详略和重复大表单、流程导航、待确认不提供分镜编辑）；跑相关intake/revisions/UI测试、类型与所改源码lint。
- [x] IAB隔离真实SQLite/FileMedia+受控provider验证：选故事→流程→编辑/关闭保留→重选→重推荐→最终确认才生成；原文无plan可读，旧修订可打开同一编辑，375px无横向溢出。

验证命令沿用Node24/pnpm11，完整TT用Node参数在文件列表前并限制并发；旧缓存hash golden和无关worktree lint已有失败分别记录，不放宽断言。无打包/推送；完成独立CR后TT/ET/VR/DD。

AR passed: no blocking architecture flaws.
AR risk: non-low — shared creation/revision editing, paid confirmation gates and nested dialog lifecycle.
AR review round: 1; reviewer: reused.

首个SS probe通过：reader-intake的真实队列原文先于plan、明确确认才生成场景1/1通过。抽取共享Sheet/编辑字段/标签及同一流程导航后，定向30/30（含intake12、revision16、原UI与新共享UI各1），typecheck和修改源码eslint通过。待确认采用紧凑流程展示，确认按钮放在流程后、返回书架之前，隐藏重复状态大标题；其余生成状态默认展示不变。

用户增补：初始书籍/主题页移除制作要求字段（保留原有theme默认值/已存契约）；选题窗口标题按阶段为“正在寻找故事”/“选择故事”，选定后才叫“故事制作流程”。无已选故事且choosing时，仅展示同一candidateList、批次/再找一批与稍后返回书架，不再同时展示制作流程。已有选题的重新选择仍复用同一候选内容的Sheet。discover/failed/paused保留当前恢复控制，不能为简化候选页丢失错误重试；无队列或服务端变更。
- [x] 移除书籍/主题页制作要求，分离独立候选窗口与选后流程；渲染断言覆盖候选态不出现编辑和流程、原有失败恢复保留；IAB新建入口与候选边界补验。
该增补已通过AR2并实现，见后续验证。

SS milestone fbf539f（包括先前待提交紧凑画风依赖）。CR passed: no major findings.
CR risk: non-low — shared creation/revision UI, paid confirmation gates and nested dialog lifecycle.
CR review round: 1; reviewer: reused.
完整TT首轮484项483通过，唯一为已知fast-first-story旧缓存hash断言；IAB最终确认4幅、隐藏brief及不提前生成、旧修订与双层弹窗锁已验证，见E2E记录。用户随后增补“书籍主题→独立选题→流程”随后通过AR2并补齐实现与定向复验。

增补 AR passed: no blocking architecture flaws.
AR risk: non-low — shared UI state and paid confirmation boundaries remain in scope.
AR review round: 2; reviewer: reused.

已移除初始制作要求字段。无已选故事的候选等待态只显示候选；提取进行/失败/暂停只保留提取步骤及重试/恢复控制，避免展示尚不属于选题的后续制作阶段。已有选题仍按完整流程。增补渲染2/2、类型/lint通过；IAB从首页选择庄子/主题，书籍主题页0textarea且无“制作要求”，独立“选择故事”窗口无制作流程，选择后进入“故事制作流程”。截图book-theme-phone/candidates-phone，均375px。

增补SS milestone250b080。CR passed: no major findings.
CR risk: non-low — shared UI state and paid confirmation boundaries.
CR review round: 2; reviewer: reused.

ET已完成全部场景，详见test记录：新建与旧修订共用三字段，分镜只在修订可编辑；原文GET-only；待确认编辑不付费；隐藏brief在最终POST和保存selection保留；选题批次/重选与三段窗口正确。375px无溢出，所有临时窗口/服务已关闭，未操作真实书库。最终完整TT执行中，首轮484项483通过/1既有缓存hash失败。

新增统一入口（用户进一步决定，已通过AR3并实现）：已有生成故事的流程标题旁也显示重新选择。处理器先GET本篇已保存selection，调用既有gen.start(intake=true)，只清除storyTitle/source并重置length=auto，沿用book/customBook/theme/style/prompt/隐藏detail。同步ref防重复，Sheet忙时不能关闭或版本导航。请求成功后才清空当前阅读界面并显示新任务；失败不调用gen.leave，不清原story/page/saved/seen。沿用start的创建requestId重放机制；不暂停或改写原故事，不生成跨故事revision关系。无后端接口变更。
- [x] 实现已有故事统一重新选择入口、成功后切换/失败保留原阅读；IAB注入创建503验证第2幅/收藏不变，再次点击恢复后沿用同requestId建立一个新任务，候选窗口不重复新建。验证原版仍可从书架打开。

卡片补充（用户新增）：删除pending卡片内重复行动文字/箭头，保留原整块button与aria-label、收藏/删除/暂停兄弟按钮；清理单卡布局为该CTA保留的第二行。该独立局部样式/文案低风险，无队列或点击行为改动。

状态缺陷新证据：只读真实API确认599dd00e…（贾雨村误认回眸为知己）phase=choosing/generation2/selected batch0 index0/batches2，sourceReady=true，frameRecommendation.count=28。原因是more后的discover无条件写回choosing。已通过AR4并实现：lib/reader-intake新增纯有效阶段函数（仅choosing且合法selected、original、frameRecommendation齐备时视为confirming）；view与changeIntake采用同一归一化，discover完成保存正确阶段。nextStep两种都是用户门槛，不新增付费调度。旧记录只计算视图，不读时改写数据库；后续明确setup动作再持久化。桌面共享SQL使用同等条件生成有效intakePhase/phase，避免阅读已修而桌面仍待选。未准备齐时仍choosing，由用户明确选择，不自动重试失败准备。
- [x] 真实队列覆盖已准备→more→恢复confirming，推荐/原文/绘图调用不增加；旧choosing+已准备fixture在view/setup与桌面SQL一致，可直接确认，半准备保持choosing，不自动重试。

新增AR3 passed: no blocking architecture flaws.
AR risk: non-low — durable task creation, paid discovery and failure-safe reader transitions.
AR review round: 3; reviewer: reused.

新增AR4 passed: no blocking architecture flaws.
AR risk: non-low — persisted lifecycle recovery, provenance and paid confirmation gates.
AR review round: 4; reviewer: reused.

SS状态修复：有效阶段要求已选候选存在、标题匹配selection、无plan、原文非空和有效幅数建议；本地出处比较edition与全部篇章范围。视图与setup/discover共用纯函数，桌面SQL按同等叶值比较，忽略对象字段顺序。17/17验证包括more后无额外推荐、旧记录只读不写库直接确认、本地跨章回执顺序/范围校验、不完整记录保持choosing。已有故事重选的503在服务端已成功创建后注入：失败原版仍page=1/saved=true，解除故障后同UUID重试任务数仍3（基线2+独立新建1），未多绘原图；错误在原设置窗口内展示。卡片去除行动行后主体点击、独立收藏及暂停/恢复均IAB通过。

SS milestone4f48d67覆盖统一旧故事重选、卡片与状态恢复。CR passed: no major findings.
CR risk: non-low — persisted lifecycle recovery, provenance, durable task creation and paid confirmation gates.
CR review round: 3; reviewer: reused.

全部实现/ET任务已完成，最终typecheck及本次源码eslint通过，当前full-test-recovery.log为最终完整TT；早先完整TT484/483/1旧hash失败，最新增加两项状态恢复回归。真实599dd00e…仅通过GET及临时只读标签复核，显示制作确认；无真实确认/推荐/绘图。隔离服务和验证标签已关闭，故障文件已清除，保留用户原有页面。

最新UI增补（已通过AR5与CR4）：StoryCreationSetup去掉batch本地状态、切批effect和select。将保存batches.flatMap成{candidate,batchIndex,index}列表，key和choose使用原二元索引，选择高亮仍匹配intake.selected。服务器批次、排除和40批上限不变；按钮改“继续找故事”，新结果追加而非替换，不客户端去重不同出处同名。列表显示找到总数；内部“本批不足5”提示不再混入，空/没有更多时用面向候选的说明。首次与重选继续共用candidateList，不改队列/确认/原文准备语义。
- [x] 合并全部候选列表并移除批次下拉；真实组件渲染两批候选均出现且无select，IAB验证追加后第一批仍可见、点击第二批项提交batch1/index0并准备正确原文。

上一稳定版本完整TT已结束：486项485通过，唯一同一既有fast-first-story缓存hash断言；新增候选UI增补随后定向复验。

新增AR5 passed: no blocking architecture flaws.
AR risk: non-low — shared candidate identity, source provenance and paid confirmation boundaries remain in scope.
AR review round: 5; reviewer: reused.

候选累计列表已实现：SSR同时显示两批3项并保留同名不同出处选项，select=0。IAB逐次找到庄周梦蝶、佝偻承蜩，同列保留两项；点击后者准确提交batch1/index0，原文为庄子·达生（仲尼适楚），只推荐一次，无新增分镜/图片；再继续查找无新增仍保留选中及confirming。证据all-candidates.json和all-candidates-phone.png。首次/重新选择共用列表，后端批次及200项上限不变。

间距补充（用户截图明确）：compact流程增加专用class，顶部padding35→0，卡片margin-top22→10，仅影响待确认简洁布局。375px实测标题底部到流程卡片26px，无横向溢出，截图tighter-flow-phone.png。其余生成状态页留白不变。

SS milestone b854bfb。CR passed: no major findings.
CR risk: non-low — candidate identity and shared confirmation UI remain in scope.
CR review round: 4; reviewer: reused.

用户最后的局部UI调整：删除制作确认页两条重复的“确认前不会生成”说明，保留确认按钮和生成/暂停后的说明；“继续找故事”从点击请求开始到服务端discovering结束持续显示Loader2旋转图标、“正在查找…”及aria-busy，期间禁用按钮。本地finding只覆盖more请求，finally清理；查找结果与付费门槛不变。两项是可逆局部UI修改，无新架构决定。
- [x] 删除两条重复说明，补充持续查找指示并验证375px显示及完成恢复。IAB临时增加网络延迟验证请求尚未返回已出现spin图标、aria-busy=true、disabled=true；原两项仍保留。证据find-loading-phone.png；临时网络设置随后恢复。
