# 统一制作确认界面

Git base: 9b02367。进入本轮已存在的紧凑画风组件/reader.css修改是本故事依赖并计入范围；先前队列/修订文档和版本号/CHANGELOG/Cargo修改不计入提交。
风险non-low：共享编辑跨新建/修订、确认动作释放付费队列门槛、叠加弹窗生命周期。

不改服务端或持久化结构。新建确认继续保存本地settings，隐藏但保留原narrativeDetail。选择/重新推荐/最终确认仍经gen.setup的幂等与generation锁。后续generation变化以服务器返回设置重置草稿；不在选择控件上触发队列。

将现有Sheet原样移入独立模块，使新建与阅读使用同一个锁集合。抽取StoryEditorTabs与StoryProductionEditor（制作要求/画风/幅数）供StoryRevisionEditor与StoryCreationSetup共用；保留修订专用分镜及影响/提交动作，新建有独立确认按钮，不伪造revision snapshot或plan。

StoryGenerationStatus允许传入既有ProductionTimeline的步骤/导航；新建将它作为唯一流程展示。选好故事后关闭候选长列表，仅通过“重新选择”弹窗展示；选择和再找一批携带当前草稿偏好。未准备完成时不开放编辑，队列仍由现有阶段管理。

StorySource支持story或待确认sessionId两种输入。已有story的补全行为不变；仅sessionId输入只GET已保存原文，失败只重读，不POST补全。标题/出处/来源说明使用同一组件，不捏造Story对象。

- [ ] 首个SS probe：隔离fixture从创建到confirming，证明仅sessionId能读原文，未确认时plans/images=0；失败停止并回AR。
- [ ] 提取Sheet及共享编辑内容，旧修订四标签/草稿/影响提交行为不变；保留紧凑15画风。
- [ ] 将新建接到可操作的流程展示，候选重选与原文窗口复用；去掉详略UI，保留隐藏已存值和最终确认门槛。
- [ ] 增加必要渲染边界断言（不出现详略和重复大表单、流程导航、待确认不提供分镜编辑）；跑相关intake/revisions/UI测试、类型与所改源码lint。
- [ ] IAB隔离真实SQLite/FileMedia+受控provider验证：选故事→流程→编辑/关闭保留→重选→重推荐→最终确认才生成；原文无plan可读，旧修订可打开同一编辑，375px无横向溢出。

验证命令沿用Node24/pnpm11，完整TT用Node参数在文件列表前并限制并发；旧缓存hash golden和无关worktree lint已有失败分别记录，不放宽断言。无打包/推送；完成独立CR后TT/ET/VR/DD。

AR passed: no blocking architecture flaws.
AR risk: non-low — shared creation/revision editing, paid confirmation gates and nested dialog lifecycle.
AR review round: 1; reviewer: reused.

首个SS probe通过：reader-intake的真实队列原文先于plan、明确确认才生成场景1/1通过。抽取共享Sheet/编辑字段/标签及同一流程导航后，定向30/30（含intake12、revision16、原UI与新共享UI各1），typecheck和修改源码eslint通过。待确认采用紧凑流程展示，确认按钮放在流程后、返回书架之前，隐藏重复状态大标题；其余生成状态默认展示不变。

用户增补：初始书籍/主题页移除制作要求字段（保留原有theme默认值/已存契约）；选题窗口标题按阶段为“正在寻找故事”/“选择故事”，选定后才叫“故事制作流程”。无已选故事且choosing时，仅展示同一candidateList、批次/再找一批与稍后返回书架，不再同时展示制作流程。已有选题的重新选择仍复用同一候选内容的Sheet。discover/failed/paused保留当前恢复控制，不能为简化候选页丢失错误重试；无队列或服务端变更。
- [ ] 移除书籍/主题页制作要求，分离独立候选窗口与选后流程；渲染断言覆盖候选态不出现编辑和流程、原有失败恢复保留；IAB新建入口与候选边界补验。
该增补AR待复核，依赖源代码尚未修改。

SS milestone fbf539f（包括先前待提交紧凑画风依赖）。CR passed: no major findings.
CR risk: non-low — shared creation/revision UI, paid confirmation gates and nested dialog lifecycle.
CR review round: 1; reviewer: reused.
完整TT首轮484项483通过，唯一为已知fast-first-story旧缓存hash断言；IAB最终确认4幅、隐藏brief及不提前生成、旧修订与双层弹窗锁已验证，见E2E记录。用户随后增补“书籍主题→独立选题→流程”待AR2后补实现和定向复验。

增补 AR passed: no blocking architecture flaws.
AR risk: non-low — shared UI state and paid confirmation boundaries remain in scope.
AR review round: 2; reviewer: reused.

已移除初始制作要求字段。无已选故事的候选等待态只显示候选；提取进行/失败/暂停只保留提取步骤及重试/恢复控制，避免展示尚不属于选题的后续制作阶段。已有选题仍按完整流程。增补渲染2/2、类型/lint通过；IAB从首页选择庄子/主题，书籍主题页0textarea且无“制作要求”，独立“选择故事”窗口无制作流程，选择后进入“故事制作流程”。截图book-theme-phone/candidates-phone，均375px。
