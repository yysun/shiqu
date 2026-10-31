# paused-editing-latest-version

Git base: `3e3f2f0d7d37d9557835f2234a6f626444f2bf4b`

风险：non-low。涉及生成调度、修订持久化、并发提交、阅读端与桌面书架的一致行为。沿用现有记录和版本族，不扩大为独立版本管理系统。

进入时未提交变更：Reader.tsx 的刷新错误提示、useStoryGeneration.ts 的后台刷新状态、reader-request.ts 与其测试的读取超时。备份 `/tmp/shiqu-paused-editing-entry.patch`，本故事提交排除这些原有改动。

## 设计决定
- 允许修订快照没有完整分镜；只有暂停的已确认制作可在此阶段修订，清除部分编排后从新设置重新编排。已存在完整分镜的修订复用规则保留。
- 准备阶段设置仍使用 intake 草稿，开放暂停时编辑，不改运行中步骤输入。更换候选须等当前持有锁的调用收尾。
- 修订 POST 增加可选 `paused` 参数；旧调用默认延续现行为。UI 明确保存暂停版；幂等指纹包含保存意图，重试不改变用户后来选择的状态。暂停旧版再发布新版，后续任务不再启动，迟到保存隔离。
- 最新版按同 owner、`revision.rootId || id`、最大版本号判定，与完成情况、访问时间、删除状态无关。删掉最新版不会回退旧版。API 列表和桌面 SQL 一致；旧版单独读取保留。
- 新版继承收藏与合理范围内阅读位置；隐藏前端缓存的过期版本；不展示历史切换入口。重选另一篇另建独立流程。

## 任务
- [x] SS 首个有界探针：使用 `.nvmrc` 指定 Node 24.22.1、检查依赖与本地预览服务可用性；浏览器不可用时记录限制并选择可用的隔离 UI 验证方式，不触碰真实生成。
- [x] 扩展 reader-revision / reader-revision-images / reader-revisions / reader-api，支持暂停的未完成分镜快照、明确暂停保存、幂等与安全接替；增加受控真实 SQLite/文件/队列回归。
- [x] 更新 StoryCreationSetup、StoryRevisionEditor、useStoryRevision、Reader，开放暂停编辑并保留草稿，统一确认后重选入口、明确保存与继续；去掉历史版本列表。
- [x] 更新 reader-repository 列表、阅读端缓存筛选和 desktop/library.sql：每族只显示最新提交，保存收藏，删除/恢复无旧版回退；增加 API/桌面/渲染回归。
- [ ] TT：运行 pnpm typecheck、pnpm lint、完整 pnpm test，必要时原生 Rust 测试验证共享 SQL。排除 Docker 与桌面准备/打包。
- [ ] ET：执行 `.docs/tests/test-paused-editing-latest-version.md`，受控生成及隔离数据库验证关键流程，浏览器验证 UI。

## 验证与风险
覆盖准备阶段暂停草稿、分镜调用未结束时提交新版、暂停保存后重放、显式恢复、样式/要求/幅数失效规则、同名独立故事、历史访问不改变最新版、最新失败/暂停不回退、删除恢复、重启及双端一致。旧分镜晚到导致草稿冲突应明确提示，不自动覆盖。

应用内浏览器的运行时可用性尚待探针；如不可用，记录替代会话与验证范围。不得声称真实模型生成或本机桌面二进制已验证。

## AR / SS 证据
AR passed: no blocking architecture flaws
AR risk: non-low — 修订持久化、并发与双端一致性。
AR review round: 1; reviewer: new（独立 reviewer）

SS 探针：Node 24.22.1、pnpm 11.25.0、已安装 Vite 可执行；本地现有阅读预览 HTTP 200。IAB inventory 返回 Local browser use is disabled in Work settings，浏览器验证将尝试独立隔离会话并明确披露。

AR 边界：空分镜使用 IS 做 NULL 安全 CAS；未确认 intake 禁止修订；paused:false 保留旧请求指纹格式；paused:true 接替也必须暂停父版，重放不能恢复新版。

SS 局部验证：pnpm typecheck / pnpm lint 通过；既有修订、intake、桌面摘要与真实组件渲染 35 项通过；新增暂停编辑/版本回归 6 项通过，新增 UI 断言通过。尚未运行完整 TT / ET。
