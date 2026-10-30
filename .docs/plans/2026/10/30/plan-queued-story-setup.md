# 排队选题与统一制作确认

风险 non-low：持久化生命周期、选题的付费文本调度、并发与确认门槛。原修订故事1123072是依赖；其 switchVersion 失败恢复修复继续验证，不回退新队列8db844d/5277e90及结束页书架入口。
Git base: 1123072（原修订里程碑）；进入SS时已有的Reader失败恢复属于后续第三阶段依赖。

## 设计

继续使用 reader_sessions 和 production_jobs，无迁移。创建 session 的请求增加 intake:true（旧请求不变），Document.intake 保存 phase、generation、候选批次和进度。先创建再调度；UI 的选题请求不再直接调用页面 streaming suggestions。

新阶段：discovering → choosing → preparing → confirming → confirmed。discover job 使用现有 provider.suggestions / local-book 缓存与来源校验，文本池1个工作位，按既有租约/中断恢复；结果和批次保存后选择阶段不持锁、不执行后续。max40批，保存排除项及出处回执，已选候选只从服务器保存的批次索引提取，不接受客户端伪造 source。候选附带已有画风建议，缺少建议可手选默认，不伪造推荐。

选择后 preparing 使用现有 prepareOriginal/recommend，保存原文与幅数建议后转 confirming。复用画风和幅数控件，提供故事重选/书籍主题回显/原文查看/制作要求/叙事详略。一条 confirm 请求持久化最终画风、要求、详略、准确幅数并释放 confirmed 门槛。要求或详略变更可主动重新推荐数量（新 generation），也可以采用明确自定义的幅数直接确认；画风不改变候选或幅数建议。初始书籍/主题不就地改，另建任务。

每个意图动作携带 expected generation（CAS），同一动作重放匹配已保存 lastAction/requestId 返回当前状态；不匹配的并发请求409。选择/重新推荐仅允许非running、尚未confirmed、未产生plan的状态；旧prepare晚回执受session token保护。generation纳入该intake专有的scriptVersion，避免重选同一故事复用错误的prepare收据。候选增批入队后允许回看已保存批次，运行中不切换故事（明确提示先暂停并等当前任务保存）。队列已批准的失败重试/丢图与优先级机制保持。

视图增加 intake（有限候选、phase/generation/progress），现有generationProgress phase增加discover/story-choice/production-confirmation；nextStep 对 choosing/confirming阻断后续，discover由coordinator专用handler执行。legacy advance对intake统一走production coordinator，并且engine对不能处理的discover不误走audio。frame-count旧入口不得绕过intake的完整确认。

## 执行任务

- [x] 首个 probe：受控provider完整suggestions返回持久化候选、离开重启仍待选择且image/plan调用为0；失败停止依赖实现并回AR。
- [x] 实现 intake 类型、视图和repo原子动作/CAS，API创建flag和setup动作，封堵旧frame-count/advance绕过确认。
- [x] coordinator增加discover handler、完整进度与候选检查点，原文/幅数准备及scriptVersion世代隔离；不占用等待用户的文本池。
- [ ] 新建UI先选书籍主题再创建队列任务，替换页面临时选题流程；制作确认页复用样式/幅数/要求/原文内容；状态卡和书架正确展示与恢复，关闭不取消后台任务。
- [ ] 队列/REST测试覆盖失败重试、崩溃保存、重启、同动作重放、并发选择、推荐更新、旧客户端绕过、空候选/40批边界、明确确认才绘图，保留旧队列与修订测试。
- [ ] IAB隔离服务验证书籍主题先入书架、离开/刷新后继续、候选选择及统一确认；适用完整TT、类型/lint、独立CR/VR和DD，不打包。

## !! 顺序与并发隔离修订

用户明确顺序：1) 后端队列生命周期与确认门槛；2) 新流程显示及制作确认UI；3) 故事修订兼容新流程、恢复失败路径修复和统一验收。现有1123072保留，switchVersion失败回退修复已写入并经IAB验证 page=1/saved=true，但在第三阶段最终审查交付。

每个 intake job payload 带 setupGeneration；coordinator 对 dispatch、snapshot、失败聚合、lease最终保存及中断恢复统一筛选当前generation，历史失败/排队任务保留但不控制新世代。provider结果保存同时检查session token和document.intake.generation；新动作仅在非running时CAS变更generation。priority/yield查询中的旧失败也不得阻止当前世代。确认后的图片任务同样标记generation。旧session无intake时保持原行为。

旧frame-count入口对intake一律拒绝；legacyadvance统一进coordinator，不可绕过选择或制作确认。source GET 在已保存original且无plan时仍可读。创建requestId须比较已保存的创作意图指纹，不被进度改变；setupaction另有独立requestId/hash，重放不再次生成。等待阶段不能因为nextStep=null被标记completed。选择新候选只换故事依赖，保留已手动设置的画风/要求/详略，不默默应用新画风建议。

新增验证：旧queued/failed job在换generation后不派发、不阻塞、不污染状态；late结果不能写入新generation；空候选和待确认不完成；旧入口不能触发后续；制作页读原文不依赖plan。

AR passed: no blocking architecture flaws.
AR risk: non-low — durable paid discovery, generation transitions and confirmation gates.
AR review round: 2; reviewer: reused.

阶段1 SS证据：reader-intake+reader-production 29/29；新建/重启待选/完整确认门槛、CAS选择、幂等、旧queued/failed世代隔离、失败准备替换、来源预览、40批/空结果均通过。新旧队列与修订联合71项曾有managed外部owner契约回归，已恢复原false行为，并以29项覆盖复测通过；其余70项当轮通过。后端typecheck和所改文件eslint通过。
