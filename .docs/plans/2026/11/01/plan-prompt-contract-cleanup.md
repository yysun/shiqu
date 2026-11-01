# 提示词职责与契约清理计划

Story: `prompt-contract-cleanup`
Git base: `5470c7e3d9d73044c8b07c9aaa58d250f51f8343`
Risk: non-low — 跨阶段、跨提供方的生产行为重构，会影响选题缓存指纹及模型输出质量，需要独立复核和实际文字对比。

## 设计边界

使用一个小型分段格式函数和职责明确的共享规则片段；不引入提示词 DSL 或新框架。规则与原文继续分别通过 instructions 和 JSON payload 传入。角色/任务、事实边界、质量规则、输出契约有可见标题。固定 JSON schema 和运行时判断继续承担结构验证。

- `lib/reader-prompts.ts`：集中事实/叙事/配文/场景/结语的规范，精简重复的流程指挥；分镜规范不再内嵌结语规范。旧自动预设文本保留作识别，新的默认制作要求使用简明的正面描述。
- `lib/reader-generation-contract.ts`、`lib/reader-storyboard.ts`、`lib/reader-review.ts`：按实际阶段组织提示词，取消“先要求完整输出、再声明覆盖”的拼装方式。正常配文目标 8–55 字，必要时仍可到 schema 硬上限 90 字。
- `lib/reader-local-contract.ts`：保留 schema 和范围逻辑；活跃选题分段，先区分普通选题、顺序扫描、主故事/子故事，再加入相应规则。将既有 v2 缓存文本冻结，防止整理活跃文本改坏旧缓存读取。
- 幅数/画风推荐、`imagePrompt` 和 Codex 原生绘图指令、`lib/server.ts` 旧管理端：同样整理，保留各自接口和安全边界。旧管理端仍一次返回其原有 10 页及结语。
- `server/generation.ts`、`server/openai-provider.ts`、`lib/reader-gemini.ts`：只统一提示词构建调用，不改 transport、鉴权、模型/推理参数、资源访问或外部计费路径。

## 执行任务

- [x] 建立提示词入口清单、规则保留映射及重构前的实际发送快照；冻结兼容指纹并建立有判定依据的文字评测输入。
- [x] 首个 SS 探针：通过现有 Codex 订阅 runner 在隔离输出目录完成一次代表性文字调用；无图片或书库写入。不能运行时记录原因，停止依赖该运行能力的验证，先完成可独立开展的契约整理。
- [x] 整理共享规则和主生成/提纲/批次/结语/审核/修订提示词；保留不同阶段真正需要的约束。
- [x] 整理其它活跃选题、幅数、画风、图像及旧管理端提示词；确认遗留缓存/预设文本独立冻结，并更新提供方拼装调用。
- [x] 增加实际请求级别的回归检查，覆盖阶段隔离、输入边界、schema 一致、提供方一致、兼容指纹、用户自写要求保留；只调整因等价重述失效的文字断言。
- [x] 运行受影响和全量本地测试、`pnpm typecheck`、`pnpm lint`；不构建应用包。
- [x] 完成相同输入/模型/档位的前后文字对比和人工判读，覆盖短篇、复杂故事、对白寓言、开放结尾/节选边界；记录旧稿截断拒绝、正常稿不过度误报、幅数不被机械压小的证据与局限。

## 验证与交付

E2E spec: `.docs/tests/test-prompt-contract-cleanup.md`。真实调用只走本会话既有 Codex 订阅配置，不使用或更改 API key。测试提供方使用已有受控 transport，不触发外部 API。

AR passed: no blocking architecture flaws

AR risk: non-low — 跨阶段及三个提供方的提示词契约重构，影响选题缓存指纹与模型行为。
AR review round: 1; reviewer: new

复核要求：冻结 legacyLocalReadingPrompt 的全部传递文本；旧管理端显式保留结语规范；自写要求逐字保留；真实对比证据与本地测试分开。
Implementation milestones: `f8fe1aa`（阶段契约重构；147项定向与3项契约测试通过）；`5113573`（结束页计数澄清与回归断言；817项全量、typecheck/lint通过）。

## 风险

重构不能只按字数删规则；建立规则保留映射并独立审查。选题提示词参与当前缓存哈希，改变后会建立新命名空间，保留 v2 查找及不改写旧进度。模型输出具有随机性，单例通过不能代表普遍质量提升；前后同模型对比仅支撑所测样本。

## 提示词入口与规则保留映射

| 入口 | 当前职责与保留的关键判断 |
| --- | --- |
| reader-prompts | 范围/开场、核心与轻重、现代对白与条件、潜台词/类比、相邻画面、结语事实与表达功能分别共享；sourceFidelity 区分事实与主观判断 |
| reader-generation-contract / 三个提供方 plan | 全篇草稿的单一任务与 schema，正常配文8–55/硬上限90，独立场景、人物身份、画风、原文与用户要求边界 |
| reader-storyboard | outline 仅 beats 与元数据；batch 仅指定 pages、前批衔接；标题/结语单独生成及候选、定向结语修订 |
| reader-review | 完整性与 requiresReplan、局部修复分流；有证据的标题/分镜/余味审核与候选择优；repair 自有任务，不继承全篇生成任务 |
| reader-local-contract | 本地普通选题、按需扫描、章节 main/episodes、pendingEvents 合并/完成凭证、原文编号与异常限定；扫描不提前做画风推荐 |
| reader-frame-recommendation | 1–80内按实际叙事需要估算，保留关键回应停顿，不绑定常见数量或字符比；隐藏详略偏好行为不改 |
| reader-art-recommendation | 同一选择标准、已有画风数据、按具体故事说明理由；单篇顶层输出与候选内嵌输出分别声明，不用替换文本变任务 |
| imagePrompt / studioImagePrompt | 一瞬间与动作可读、计划景别、空间支点、角色身份与参考图用途，读者要求和场景作为引用资料；不实际绘图 |
| studio-prompts / lib/server | 旧管理端保留10页请求、8–65目标、原有解析硬上限和固定画风；显式独立结语规范 |
| reader-legacy-prompts | 重构前 v2 普通/扫描完整字符串与旧自动预设正文冻结，固定 SHA-256 测试；不发送给模型 |

Codex runner 的工具权限/协议、URL读取与原文保存、朗读 caption、风格/尺寸常量均是运行边界或资料，未改写协议、安全限制及数据。三个提供方的鉴权、transport、模型、推理档位、超时、token额度和 schema 保持原有逻辑。

首个 SS 探针：现有 Codex 订阅 gpt-6.1-sol / frames=medium，连环计幅数推荐13秒成功；后续 before/after 同输入文字证据在 outputs/prompt-contract-cleanup-2026-11-01。测试和探针均无书库写入及真实绘图。

定向验证：147项现有受影响测试通过；新增3项真实提供方请求拼装/兼容指纹/管理端契约测试通过。测试覆盖16种请求、3个提供方；测试桩不代表模型质量。


TT第一轮817项：811通过，6项失败均为旧措辞字面断言（main/episodes、auto、片段边界、例外上下文），已改为保留相同语义的新断言；42项相关复跑全部通过。没有放宽运行时验证。

ET发现幅数推荐理由曾提到给“独立结束页”留画幅；已明确 count 只计算故事画幅，结束页不计入，沿用现有运行时计数契约。最终真实复跑须覆盖幅数推荐；本地章节规则精简后，复跑复杂提纲和旧截断审核以确保请求对应最终文本。


最终 TT：pnpm test 全量817/817通过（full-test-final.log）；pnpm typecheck 和 pnpm lint 通过（*-final.log）。未构建 Docker 或桌面应用。

CR passed: no major findings
CR risk: non-low — 提示词行为及跨提供方契约兼容。
CR review round: 2; reviewer: reused

第一轮审查覆盖全部实现；第二轮复核旧措辞断言与独立结束页计数澄清。最终真实请求复跑和人工判读已完成，证据见下方ET记录。


ET：9对最终请求完成同输入、同模型 gpt-6.1-sol、同档位对比；frames=medium，outline/plan/review=high。原文和逻辑输入哈希一致；current-code-replay.log 逐项证明最终代码发出的请求与已验证收据完全相同，无再次推理。受影响请求重新执行，初次结果保存在 after/superseded。人工判读及完整哈希收据：outputs/prompt-contract-cleanup-2026-11-01/evaluation.json。

- 复杂故事：幅数建议46→58，自动提纲49→46，两个调用互相独立；均讲出计谋、决意与诛董结果。新提纲首幅交代司徒王允及府中歌伎；最终新提纲停于诛董宣诏，基线另有取貂蝉，人物去向余波较弱，不能称所有叙事方面均改善。
- 旧截断稿：前后均要求 requiresReplan；开场信息不足仍是可局部处理问题，不把所有缺陷升级重编。
- 短篇、长对白、明确节选：4/8/4幅，前后审核均无问题；保留因果、说话归属、条件及最后回答，节选止于指定位置，不补后续。新节选稿称“桃林”，树种并非所给片段明说，依据标题补了背景且未被审核报告；记录为事实边界的样本局限，不宣称零误差。

本次证明阶段契约整理、兼容性及所测文字路径保持可用，不能由一次样本推出总体胜率提高。没有真实绘图、书库改写、打包或推送。


VR passed: all acceptance criteria complete
VR risk: non-low — 跨阶段及跨提供方的生成行为变化，涉及缓存兼容与模型质量证据。
VR review round: 1; reviewer: reused

独立VR逐项确认8条验收完成；最终报告见 .docs/done/2026/11/01/prompt-contract-cleanup.md。GC交付范围为最终验收、DD与token估算记录，保留代码里程碑 f8fe1aa、5113573；不推送。


DD补充token对比：o200k_base本地估算，整篇分镜/提纲/普通审核规则分别减少37.9%/40.7%/39.9%；幅数规则增加64 token。9组完整输入合计减少25.3%，包含各版生成稿资料差异，不作为计费或严格单变量结论。原始token-comparison.json留在本地忽略目录，DD保留可审阅的数字和口径。此次仅补充文档，沿用已完成的CR/VR/TT/ET证据。
