# 故事生成状态机验收

本次验收以[当时的状态机第 9 节](https://github.com/yysun/shiqu/blob/80787e0df86ea90628c6a2bab0297d1aaefcbea8/.docs/story-generation-state-machine.md#9-必须成立的验收场景)为基准。现行选题规则见[故事生成状态机](../story-generation-state-machine.md)，确认后的规则见[制作生命周期](../story-production-lifecycle.md)。

所有执行使用临时SQLite/FileMedia、正式readerApi/ReaderProductionCoordinator/advanceStory与受控provider；禁止写真实书架或调用真实模型。现有`tests/fixtures/production.mjs`为基础夹具。新增可执行场景集中`tests/story-generation-state-machine*.test.mjs`，必要时增强既有title/revision/queue/client/UI用例。

1. 从旧故事打开替换草稿，搜索/关闭/重开均不增加书架卡片。后台原任务推进或另一窗口替换/删除时取消，刷新展示真实当前版本，不恢复旧快照。首次提交新候选才切换卡片并保留历史；重复/过期/并发提交与普通修订交错只允许合法一个版本。
2. active/paused/stopped/failed/completed各类原版替换，核对继承提交时控制、偏好与收藏，阅读归零、旧产物不复用；明确恢复准备→准备成功→制作确认之前无分镜或绘图。旧在途结果只存历史。
3. 绘图中改名完成后总调用数等于所需图片数；失败后改名/刷新/暂停恢复调用数不变。修改元信息不改变任务ID。
4. 已完成后删除/损坏非首幅，客户端失败报告只核对并显示故障；明确重绘仅恢复对应幅；文件已恢复不付费。两幅失效逐幅恢复、首幅依赖、存储临时异常、在途保存、暂停/重启、旧版报告、过期图片身份逐项验证。
5. 图片模型成功、发布失败时保留回执，“重试保存图片”不增加模型调用；与另一幅失效并存时可独立发布。局部成功不清其他故障或提前完成。
6. 恢复请求R响应丢失→调用再次普通失败F2→重放R，不入队或重置额度；新R2才恢复F2。两个命令同时领取F1只启动一次；F1历史退出待处理。已受理后服务退出、登记中断及3次中断上限验证可接续且不增加授权。
7. 审核limit/unchanged续修、requirements/replan拒绝普通重试、显式放行、暂停叠加和请求重放；20轮额度只能由新有效续修命令建立一次。旧版或删除目标的命令及回执不可越权。
8. 真实UI动作核验：替换选题/选择并替换/恢复准备/开始制作/应用修改并恢复/重试准备/重试保存图片/重新检查图片/按幅重绘；打开只读入口及关闭编辑器不付费或提交。390px布局正常，暂停及其他故障同时可见，双击、丢失响应、加载错误和草稿冲突可处理。

执行记录后续写入本文件，标明真实命令、结果与证据边界；未执行不能勾选完成。

## 执行记录（2026-11-03）

环境：Node24.22.1、pnpm11.25.0；临时SQLite/FileMedia、受控正式provider适配器，无真实书架写入、无真实模型调用。所有故障及并发测试使用正式API、迁移、队列与引擎；前端恢复另通过真实hook调度与同一REST/queue验证。

- `pnpm exec node --experimental-strip-types --test tests/story-generation-state-machine*.test.mjs tests/reader-image-health.test.mjs tests/reader-revisions.test.mjs tests/unified-story-setup-ui.test.mjs`：61/61（复审中后续追加场景再纳入最终全量）。
- `pnpm exec node --experimental-strip-types --test tests/story-generation-state-machine.e2e.mjs`：1/1。真实loopback HTTP证明丢弃恢复响应、再次普通失败、重启和旧命令重放零追加调用；修订重放不恢复后来暂停。
- 像素解码有界探针与`reader-image-health.test.mjs`：本地WASM离线读取；正常PNG/JPEG/WebP、结构完整但压缩数据损坏、坏图后正常图和内容hash缓存均验证。资源初始化在损坏判定之外。
- `pnpm test`第三轮：1074/1074；复审追加跨表写时约束、付费发布回执继承、无需求完成收束及reader前端需求后，最终全量另行记录，不沿用旧总数声明完成。
- `pnpm typecheck`、`pnpm lint`：通过。未运行Docker或桌面安装包构建。

| 验收范围 | 主要可执行证据 |
| --- | --- |
| 替换、取消、历史与并发提交 | `story-generation-state-machine-reselection`、`reader-revisions`、`paused-editing-versions`、`production-queue-hardening` |
| 故障实例、授权幂等、跨动作与两连接竞争 | `story-generation-state-machine-commands`、`story-generation-state-machine-flow`、真实HTTP `.e2e.mjs` |
| 丢图、临时读错、首幅依赖、多故障、发布回执与恢复完成 | `story-generation-state-machine-flow`、`queue-image-recovery`、`queue-image-versions` |
| 原文件恢复、不清普通失败、旧显示名升级及零追加绘图 | `story-generation-state-machine-flow`、`story-generation-state-machine-commands`、`reader-image-health` |
| 中断额度、暂停重启、检查点写错 | `queue-interruption`、`background-generation`、`story-generation-state-machine-commands` |
| 20轮修复、要求阻断、放行与暂停 | `storyboard-review`、`story-requirements`、`story-completeness`、`story-flow-control` |
| reader首图失败后前端恢复需求 | `story-generation-state-machine-client`（真实hook/REST/SQLite/queue） |
| 按钮名称与只读/编辑/提交边界 | `unified-story-setup-ui`、`storyboard-ui`、`reader-production-client`、`story-revision-flow` |

**尚未执行：第8项真实浏览器操作与390px视觉验收。** `cua.getState()`和后续`cua.listBrowsers()`均返回`Local browser use is disabled in Work settings`，没有可用应用内浏览器。该报错仅证明当前工具拒绝访问，用户已明确没有禁用，实际设置／连接原因未明；不以静态组件渲染或hook测试替代真实视觉证据，也未切换到其他浏览器绕过设置。布局、真实按钮连点／窗口操作／网络错误的UI验收保留未完成，不能据此宣布完整RPD或VR通过。

最终TT：`pnpm test` **1083/1083**，0失败、0跳过（129.2秒）；类型检查、lint通过。真实HTTP ET最终再跑1/1通过。代码审查round2独立通过。第8项IAB与390px视觉操作仍未执行，保持验收缺口。

最终参考预检异常回归补齐后：`pnpm test` **1084/1084**，0失败、0跳过（127.6秒）；`pnpm typecheck`、`pnpm lint`通过；CR第3轮通过，其他全量CR结论继续有效。该新增场景证明参考读取异常不会被provider独立可读句柄掩盖后启动付费，也不会误标丢图。IAB与390px缺口不变。
