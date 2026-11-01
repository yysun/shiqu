# 连续寻找故事

Git base: `891aa94bf13792c2a52b5d66b38efa44e539cbf2`

风险：non-low，涉及付费查找的生命周期、独立查看者需求、迟到结果与选择操作的并发保护。

设计：复用现有查找任务和查看者租约。选择界面的观察循环在一轮成功后自动提交下一轮，不在服务器创建无限循环；自动请求带标记，由服务端拒绝选中之后的迟到启动。查找必须有真实查看者需求，后台生成意图不算查找需求。单篇上限通过现有阅读上下文传给本地扫描及远程选题适配器，旧批次与直接选章接口保持兼容。

选择操作原子地令搜索 idle，旧轮次结果不能写回。离开后释放当前查看者租约，正在进行的本地模型调用可完成并保存共享缓存，但不再发起后续原文扫描；断连依赖已有租约过期。旧候选格式不迁移，保留 40 批上限。

- [x] 为选题阅读上下文加入单篇模式；本地扫描及缓存响应遵守上限，远程 payload 指定数量且适配器返回遵守数量。
- [x] 在服务端将查找限定为真实查看者需求，选中停止并拒绝迟到自动启动；保留显式重新选择时的手动查找。
- [x] 观察循环在选择阶段续租、逐篇自动继续；离开释放需求，失败、空结果、暂停及上限停止自动循环。
- [x] 更新选择界面状态与 README；已有候选可直接选择，不因自动查找锁住选择。
- [ ] 增加生命周期、并发、单篇缓存与恢复测试；运行 typecheck、lint、完整 unit/integration suites。
- [ ] 在 in-app browser 验证逐篇增加、选择停止、离开停止与重开恢复，执行 `.docs/tests/test-continuous-story-discovery.md`。

验证使用 Node 24.22.1、pnpm 11.25.0。浏览器使用隔离数据及受控生成服务，避免真实推理费用。无需桌面源码变更；如验证桌面壳使用 pnpm desktop:preview，不准备或打包桌面。SS 首次浏览器可行性探测：`cua.getState()` 返回 `Local browser use is disabled in Work settings`，没有可用浏览器；不改变用户设置。浏览器 E2E 保留未完成，使用真实观察循环 + SQLite + 受控 provider 集成验证生命周期，不能替代视觉验证。

AR passed: no blocking architecture flaws

AR risk: non-low — 付费查找生命周期、查看者租约及选择与自动继续的并发保护。
AR review round: 1; reviewer: new

主要风险：轮次重试重复付费、自动请求和选择竞争、一个查看者离开误停另一个、空结果自旋。通过服务端轮次保护、自动请求前置条件、真实查看者计数、空结果终止与受控集成测试覆盖。

SS evidence：8 个相关测试文件共 114 项通过；`pnpm typecheck`、`pnpm lint` 通过。逐篇发布复用每秒快照轮询，通常 0–1 秒可见延迟，不是 SSE；前端收到本轮结果后请求下一轮。所有推理验证使用受控 provider，无真实付费调用。

SS milestone: `3e982e2` (`feat: discover stories continuously while the picker is open`)，上述局部验证通过，完整 TT 和浏览器 E2E 尚未完成。

CR 第一轮发现 LAN HTTP 缺少 `crypto.randomUUID` 会中断续找。修复：将已有 getRandomValues 兼容实现移到 lib/reader-random-id.ts 并保留 shared.tsx 重导出；新增缺少 randomUUID 的自动续找回归。局部 27 项测试通过。

CR fixed: automatic continuation now uses the existing LAN-safe UUID implementation; rerun result passed.

CR risk: non-low — discovery lifecycle and browser compatibility.
CR review round: 2; reviewer: reused
