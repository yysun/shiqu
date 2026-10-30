# task-reasoning-effort

Git base: `276b772e16073ba1a55dd22b98d6a49ec1c6b348`。进入时无本任务源码未提交修改；CHANGELOG、package.json、Cargo.lock、Cargo.toml、tauri.conf.json 的版本调整属于已有无关修改，保留且不提交。

AR passed: no blocking architecture flaws

AR risk: non-low — 跨提供方配置、桌面设置与缓存身份协调验证。
AR review round: 1; reviewer: new (`review_reasoning`)

共享七类文本任务及默认配置（suggest/art/frames/outline/plan/review/repair）。环境变量采用 SHIQU_REASONING_<TASK>，桌面 taskReasoningEfforts 保存完整映射；缺失字段填推荐默认值。文本任务明确覆盖 Codex 全局档位，原全局字段仅用于未分类/图片调用。Gemini 仅接受 low/medium/high，跨提供方切换后的不支持值明确提示调整，不静默降档。初审与复核统一 review。

CodexJob 增加单次 reasoningEffort，execute 为该次计算 CLI 覆盖并检查 config/read 与 thread/start；不修改进程全局配置。返回实际 thread.reasoningEffort，沿 Generated 的可选字段存入 usage。Gemini 保存发出的档位（不宣称响应确认了内部计算量）。选题与画风缓存身份包含对应档位，旧无档位缓存不回填到新配置。

- [x] 首个 SS 探针：现有 CLI 0.165.0 的订阅状态及单次配置校验可用；真实 medium 审核作为首个付费探针，成功后继续 high/xhigh；失败保留证据，先定位协议/支持问题。
- [x] lib/reader-reasoning.ts 定义默认值、严格配置和环境解析；共享 storyboard/review 回调显式传递任务；两提供方路由所有文本任务。
- [x] Codex runner 单次配置/生效校验和用量记录；Gemini thinkingLevel 与不支持档位错误；缓存按对应档位隔离。
- [x] 桌面 TS/Rust 设置缺省、验证、保存/桥接及七任务选择器；现有全局字段改为说明清楚的后备设置。更新环境示例与文档。
- [x] 增加跨任务/并发请求、两适配器、非法/不支持值、旧桌面配置与密钥原子保存、缓存隔离的行为测试。完整 pnpm test、typecheck、lint，Rust cargo test --locked；桌面仅 pnpm desktop:preview，复用应用内浏览器验证。
- [x] 专用审核比较脚本读取用户指定的备份，使用正式 review 入口和同一模型；输出独立目录、固定输入/提示哈希、三档真实报告和元数据，不调用 repair/image、不写书库。每档一次，已成功结果不重复请求。
- [x] 逐条比较结果，保存可读报告及明确结论，核验书库当前配文与 20 张原图保持不变。

资料：OpenAI App Server 文档说明 CLI 支持生成协议 schema、线程实际 reasoningEffort；本项目继续使用已有的 CLI config 覆盖 + 线程响应核验。Gemini 官方 thinking 文档确认 3.8 Flash 支持 low/medium/high。选定档位不受支持应失败，不能静默换档。实际低延迟、用量与检出质量由试验记录，不凭高档位推断。

比较 rubric 在调用前独立保存，不传给模型：跨幅机械转述为主要已知缺陷；第4幅含混表达为具体观察项；第14幅仅概括“有新用处”为可选清晰度改进，不强制认定漏检。逐条看证据、改法和误报，不按 issues 数量排名。新桌面字段会被旧版 deny_unknown_fields 拒绝，文档要求回退前备份设置数据库。

实施/验证：Node24.22.1、pnpm11.25.0。75项原有适配器/审片/生成检查通过；新增与缓存定向30/30通过，typecheck/lint通过。原生使用已安装Rust1.93并按Lite相同的TAURI_CONFIG资源覆盖运行cargo test --locked，17/17通过；未准备资源/打包。IAB1420设置页核验七任务默认值、Gemini可用范围及浏览器只读，截图在 .data/evidence/task-reasoning-effort/。

TT完整执行汇总386/388：一项现有legacy缓存哈希断言失败，基线函数与当前结果同为ed2dea...，与测试旧常量39814a...不符，证据preexisting-cache-test.json；未修改旧缓存算法或放宽该断言。另一项development-access用例110秒不退出，定向结束该测试子进程以收集完整汇总；源码无本任务修改，保留运行限制，不将完整套件声明为通过。额外30项任务/缓存检查全过。

真实ET：medium31.798秒、high55.391秒、xhigh87.427秒，实际档位及模型均确认，三次requestSha256一致；保存独立结果，无图片或书库写入。20图SHA及当前修好配文/提示均未变。已成功medium结果重跑验证直接复用，不增加调用。详见 .docs/reports/2026/10/30/gourd-reasoning-comparison.md。
