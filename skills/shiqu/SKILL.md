---
name: shiqu
description: 根据拾趣的数据契约与业务规则，自主编写任务程序，完成故事选题、制作、编辑、书库分析和批量整理，并预览、导出或维护作品。适用于明确使用拾趣的任务。
---

# 拾趣任务契约

根据用户目标和已保存状态决定操作，自主编写并运行本次任务需要的程序。筛选、分组、比较、报告和批量调度由你实现，不必为每种任务寻找专用命令；简单任务可以直接调用现有操作。

程序通过拾趣现有生产入口读取、保存和执行，不重写状态机、模型调用、审核、版本管理、媒体编码或导出逻辑，不直接改 SQLite 或媒体文件。当前公开入口是 CLI 子命令；没有公开 SDK，不依赖 npm 缓存路径或未导出的内部模块。无需启动 HTTP 服务、桌面或前端；不带子命令会启动浏览器服务。

## 执行环境与协议

- 独立桌面技能先检查本次加载 SKILL.md 同目录的 `.shiqu-runtime.json`：schemaVersion 为 1、source 为 `@apprun/shiqu/desktop`、appVersion 与 `.shiqu-skill.json` 的安装版本一致，文件 SHA-256 匹配安装记录的 runtimeSha256。command 是两个绝对路径组成的 Node/CLI 参数数组；确认路径存在并通过 `help --json` 核对版本后，后续命令沿用该入口，无需系统 npm/npx。不要拼接 shell 命令。记录失效时报告并正常重启桌面以重新登记，不隐式安装运行环境；只有环境已有 Node 24/npm 且用户选择该入口时才使用 npx。

- 没有有效桌面内置入口时，使用 Node 24 及随附的 npm/npx。通过发布包安装的技能默认用 `npx --yes @apprun/shiqu` 调用 CLI；版本确定后使用 `npx --yes @apprun/shiqu@<version>`，版本选择见下方“版本检查与更新”。`skill install` 只安装技能正文与版本记录，不安装 pnpm 或全局 shiqu 命令。
- 源码项目沿用该源码目录的 `pnpm cli`；用户明确已安装 `shiqu` 命令或指定 `pnpm dlx` 等入口时沿用其选择。用户指定版本和项目版本锁优先，不因安装了技能就切换启动器或要求安装 pnpm。先读取所选入口的 `help --json`，核对 appVersion、当前输入与可用操作；下面是稳定语义，不是完整输入 Schema。
- 所有书库操作使用同一绝对路径：显式 `--data-dir` 优先，其次 `SHIQU_DATA_DIR`、已保存位置和默认书库。首次访问自动建库并迁移，无需先 init；不因此更改默认位置或模型配置。书库被其他服务占用时报告占用，不绕过锁。
- 自主程序使用进程 API 的可执行文件与参数数组，JSON 经 `--input -` 的 stdin 或私有文件传入；不要把标题、路径、原文、提示词拼接成 shell 命令。沿用入口及其工作目录，处理 stdout 与 stderr，设置有限超时。同一书库的 CLI 调用串行执行，避免独占开库冲突。
- 子命令 stdout 为一个 JSON 信封：成功 `{schemaVersion:1,ok:true,data:...}`，失败 `{schemaVersion:1,ok:false,error:{code,message,details?}}`；日志在 stderr。检查退出码、信封及业务结果。`skill show` 默认是 Markdown，带 `--json` 才是信封。不要把非零退出的 JSON 丢弃，也不要把退出码 0 或 `ok:true` 当作故事完成。
- CLI 子命令无交互，所有询问、检查点和阶段选择由本技能在对话中处理；不要向 CLI 发送终端按键或等待它提问。
- 浏览器服务可在「我的 → 生成服务与模型」通过本机或可信局域网地址修改共享提供方、模型、推理和密钥，保存后用于新任务，无需重启；LAN 设备共享配置权限，互联网隧道和跨站页面不开放此入口，已存密钥不返回。CLI `config` 子命令仍通过本机生产入口操作。启动覆盖密钥与数据库已存密钥分别显示；不会自动持久化环境密钥，只有用户明确要求时才保存。新生产步骤固定同一提供方实例，修改配置不重启、取消或重跑在途步骤。
- 继续使用已保存的提供方与模型；缺配置时查当前 `config` 帮助。密钥仅经已有环境、私有 JSON 文件或 stdin 传入，不进入 argv、对话、报告或日志；不自行切换提供方或计费方式。

## 数据契约

以当前版本实际返回为准；缺失的可选字段表示未提供，不补造。读取结果和操作输入是不同结构，不把整个读取对象直接回写。

| 对象 | 字段与含义 |
| --- | --- |
| 制作选择 `selection` | `bookId`、`theme`；`artStyle` 使用目录中的 id；`narrativeDetail` 为 `brief\|balanced\|detailed`，表示详略而非固定幅数；`productionPrompt` 为制作要求，`acceptancePrompt` 为验收要求；`length` 默认 `auto`，固定数量范围查当前协议。`storyTitle` 是选中的源故事，`displayTitle` 是独立显示名，改显示名用 rename。 |
| 本地来源 `source` | `{edition,sectionId,firstUnit,lastUnit,continuations?}`；`edition` 是版本哈希，续段包含章节和起止单元。引用目录或候选返回的真实范围，不能按标题或摘要猜造。 |
| 故事快照 `session` | `id` 是版本 UUID；`selection`、`state`、`generationControl`、`intake?`、`revision?`、`superseded?`、`faults?`、`story`。`state` 为 `idle\|running\|failed\|completed`，`generationControl` 为 `active\|paused\|stopped`，两者分别检查。`stage` 是展示文案，逻辑判断使用结构化字段。 |
| 生产进度 | `generationProgress?` 含 `phase`、`frameCount`、`storyboardFrames?`、`reviewStatus?` 等；`productionState?` 为 `running\|queued\|paused`。正文为 null 时仍可能已有部分分镜，结合进度区分“未编排”和“编排中”；未知数量不当作 0。 |
| 选题 `intake` | `phase` 为 `discovering\|choosing\|preparing\|confirming\|confirmed`；`generation` 是动作的并发前提；`batches[].stories[]` 是已保存候选，`selected` 为 `{batch,index}`，两者从 0 开始；`draft` 是制作设置；`search.state/error` 表示提取状态。 |
| 故事正文 `story` | 编排未完成时可为 null；已有正文含 `title`、`pages[]`、`sourceText`、`original?`、`sourceReference`、`publication?`。每幅含 `caption`、`prompt`、`image`；空 image 表示缺图，非空地址仍可能不可读。`ready` 不是媒体完整性证明。书架 list 省略 original 并清空 sourceText，要查看原文需 get/source，不能据 list 判定原文丢失。 |
| 版本 | `stories current` 返回该家族当前快照；`revision` 包含 `parentId/rootId/number`。编辑前读取 `stories revisions` 返回的 `token`，输入为 `{token,changes}`；不根据时间或标题猜当前版本。 |
| 故障 | `faults[]` 含 `id`、`message`、`page`、`stage`、`state`、`retryAllowed`；恢复输入 `faultId` 取其 id。`run` 返回 `{reason,session}`，reason 表示本次停止原因。 |

## 业务规则

- 原文、候选、摘要、分镜、图片和审核历史以保存结果为依据。自由生成的内容用于分析或建议；正式故事的生成、审核和修订通过同一生产实现执行，不另建一条模型流水线或伪造完成记录。
- 保存意图不调用模型，只有显式 `run` 推进生产，可能产生费用。用户只要求查看、整理、比较、预览或导出时，不运行生产。用户要求的候选、方案确认和生图前检查点必须保留；已有授权足够时继续，缺少影响结果的选择时再询问。
- 创建、选题动作、编辑、控制和恢复等支持 requestId 的操作，发出前保存 UUID 与原始输入。重放沿用同一 requestId 及原 generation/token/faultId，不能重新取当前值。跨步骤重新读取状态；新动作使用新 UUID。CONFLICT 时停止该项并重新读取，不通过换 requestId 自动重试原动作来掩盖冲突。
- search/choose/confirm/setup 携带读取时的 `intake.generation`。编辑和重选会创建版本，后续使用操作返回的新 id 或 current 返回的 id；旧版不能继续制作或完整导出。
- 暂停保持暂停；获准继续时用 `stories resume <id>`，再 run。失败先检查 faults 和已保存依据，`retry/override` 输入针对当前 faultId；审核越过需要明确 override 意图，不能把越过说成审核通过。超时或中断后先读取保存状态，不循环重跑。
- 批量程序逐项记录目标 id、请求身份、结果和停止原因；遇到需要用户决定、冲突、暂停或故障时停止该项。其他独立项仅在原授权内继续；报告成功、失败、跳过和未处理项，不能把部分完成称为全部完成。

## 可用操作与停止条件

按任务和当前快照组合操作，不机械执行整条流程。具体参数、可编辑字段和输入示例查同版本 help；`api` 仅提供已有持久化/观察白名单，不是任意 HTTP 或推理入口。

| 目的 | 生产入口与判断 |
| --- | --- |
| 发现数据 | `catalog` 或 `books/themes/styles` 查目录，`books contents <bookId> --query <关键词>` 按关键词查章节和可用的故事段落；`books search <查询> [书名] --limit 5` 用标题、梗概、原文和可用参考向量在独立索引里找故事候选，返回原文预览和出处，无需调用生成模型。用 `--brief` 只显示书名、索引中的故事标题、章节和段落，默认输出 JSON。安装索引用 `books index-import <书名> <离线 SQLite 文件> --data-dir <数据目录>`，核对版本后只更新该书。多本书已安装索引时，搜索需指定书名。实验源码 worktree 中的 `node bin/shiqu.mjs books search` 可自动使用 `.data/dev-local` 下的索引，显式数据目录优先；`stories list/get/current` 查书库与当前版本；`stories source/prompts/review-history/revisions <id>` 查保存依据。`status` 查本地书库完整性、数量与运行元信息，不检测云端服务是否就绪；`init` 可显式建库，但普通书库操作已自动初始化。 |
| 配置 | `config get` 返回 settings、revision 和 keyPresent，不返回密钥；`config set` 输入 `{settings:<修改字段>,expectedRevision:<读取到的revision>}`，API密钥按 help 的 key 输入。`config reset` 清除提供方设置和保存的API密钥，保留书库及网络设置；它不是临时切换只读模式。 |
| 新建或选题 | `stories create` 接收 selection 或 `{selection,intake:true}`，默认进入选题；`--no-intake` 或 `intake:false` 使用旧的直接制作入口。search 保存提取意图，choose 保存候选索引，confirm 保存制作确认，setup 保存其他选题动作。它们不执行生成。 |
| 执行生产 | `run <id> --until candidates\|prepared\|reviewed\|completed`（也可 `stories run <id>`）。candidates 后按用户目标选择或等待；prepared 后检查原文、摘要和方案并确认；reviewed 在审核通过时停止，不再启动图片生成，但已有图片不会被撤销；默认 completed。每次检查返回 reason 和 session，不假定达到了请求边界。 |
| 解释停止原因 | `choice` 需选题；`frame_count_required` 是旧故事等待幅数确认，按 help 的 frameCount 输入处理；`already_prepared/already_selected` 表示已越过该边界，改用下一步；`paused` 保持暂停，`blocked` 检查故障，`superseded` 查当前版本。不能在同一停止边界空转。 |
| 修改与控制 | `stories edit` 使用 token/changes 创建新版；changes 支持 productionPrompt、acceptancePrompt、artStyle、narrativeDetail、length、plan 或仅换图的 redrawPages。需要暂停新版时显式传 `paused:true`，默认 active，但 CLI 仍只在 run 时生成。rename 仅改显示名。pause/resume/stop 控制制作；retry/override 输入 `{faultId}`。 |
| 替换选题 | `stories reselect <父id>` 保存重选草稿，返回草稿 id；在草稿上 search/run 找候选，再用 `stories replace <父id> <草稿id>` 和输入 `{batch,index}` 明确提交。`stories cancel-reselection <父id> <草稿id>` 取消草稿；浏览草稿不替换书架当前版本。 |
| 书架整理 | `stories delete <id>` 可恢复地隐藏，`stories restore <id>` 撤销删除；`api GET reader/deletions` 列出已删除记录。`stories favorite <id>` 输入 `{saved:true\|false}`，不生图。 |
| 本书参考图 | `stories reference <id>` 输入 `{page,starred:true}`；page 从 0 开始，每本书保留一个参考图，只影响后续绘图。取消用 `{page,starred:false,token}`，token 沿用设置星标时返回的 reference.token；缺少该 token 时说明缺失，不猜造。它与故事收藏不同，也不同于 redrawPages 的从 1 开始页码。 |
| 仅换图 | `stories edit` 输入 `changes:{redrawPages:[1,3]}`，页码从 1 开始、不得重复；仅用于已完成且有有效审核记录、全部原图可读的当前版本。保留文字、审核及未选图片，不与画风、制作设置或分镜修改混合提交。缺图先按故障恢复流程处理。 |
| 跨库复制 | `stories copy <来源故事id> --from-data-dir <来源书库> --data-dir <目标书库>` 默认仅复制已通过且未越过审核的文本与审核记录，新故事初始暂停。显式 `--draft` 或输入 `draft:true` 可复制尚未通过审核、但已有完整原文、分镜与审核检查点的文本；保留原审核状态、不复制图片，也不允许再用 copy-images 补图。`stories copy-images <目标故事id>` 用同一对书库及输入 `{sourceId:"来源故事id"}` 给普通文本副本补充图片，不创建另一个故事。`copy` 也支持显式 `--copy-images` / `--no-copy-images` 或输入 `copyImages`；仅在用户已决定时使用。换画风时不能复制旧图片。 |
| 署名与转载 | 默认值通过 `api GET/POST reader/publication-defaults` 读取/保存；单篇通过 `stories get <id>` 读取 story.publication，再 `api POST reader/sessions/<id>/publication` 保存。输入均为 `{publication:<完整署名对象>,expected:<原对象或null>}`，保留未修改字段，expected 必须沿用原始读取结果；修改全局默认与单篇设置是不同操作。 |
| 预览与交付 | preview 输出独立离线 HTML；export 支持 zip/pdf/png/json/md，使用共享序列化、图片编码、水印和元数据规则。自主程序可组织导出清单，不能自己重建作品包。 |
| 维护 | backup 创建完整私有快照，verify-backup 验证；restore 仅恢复到新的 data-dir，不覆盖原库或自动切换默认位置。diagnostics 输出脱敏诊断；它与私有完整备份用途不同。 |

## 制片流程控制

本技能负责决定下一阶段，CLI 负责执行明确动作。根据用户目标和已保存状态推进；用户指定的选题、原文、方案、文本或生图前检查点，必须先报告结果并取得所需选择，再运行后续命令。文本与图片是分别可交付的结果，文本完成不代表已获准处理图片。

- `run --until candidates` 会在已有独立检索索引时优先读取命中的本地原文，再用配置的模型提取故事。常用主题和标题查预制向量，其余输入仍可按原文匹配。候选不足时继续顺序阅读。以返回的故事与出处为准。
- 自动选题时，「欲望与代价」「善意与误解」等双词预设优先召回两侧都命中的候选，也保留只命中一侧或由语义检索找到的故事。推荐前核对同一篇原文是否支持两个要素及其情节联系。例如「欲望与代价」要求人物因追求某物而付出代价。
- 新的主题复核候选可带 `matchScore`，表示该篇故事的主题贴合度（0 到 100）。旧回执和按标题提取的候选可能没有这个字段。选故事仍使用返回的候选批次和序号。
- 在源码工作树制备离线索引时，《聊斋志异》《世说新语》《战国策》《子不语》《太平广记》及三言二拍沿用原文篇目边界。三言二拍按卷生成主故事摘要，片段向量覆盖通过原文校验的整卷。《酉阳杂俎》《山海经》《博物志》《浮生六记》切分后只给可独立成篇的叙事制卡。先运行 `node scripts/experiment-soushen-search.mjs build --raw --book <书名>`，再运行同脚本的 `cards --book <书名> --model <模型>` 和 `refs --book <书名>`。用 `stats --book <书名>` 核对覆盖、原文校验拒绝和筛选结果，再用 `books index-import` 安装。
- 语义切分可通过 `build --raw --boundary-model gpt-6-luna` 使用 Codex 订阅。同一索引的各卷须沿用切分模型。该参数只控制故事边界，摘要模型由 `cards --model` 指定。
- 制作时按需要使用 `run --until candidates|prepared|reviewed|completed`，核对实际返回的 `reason/session` 后再选下一步。审核通过、生图尚未开始时可预览文本并处理反馈；不要为检查文本而直接运行到 `completed`。用户已经明确授权的阶段可以继续，不重复询问；未授权的生图、恢复或越过审核不自动执行。
- 全篇审片会核对人名和称呼。姓名、字、号或别名切换容易误导时，定位到受影响的画幅，统一旁白或简短交代同一人的不同称呼。保留有叙事作用的对白称呼和身份揭示。
- 复制故事时，先调用不含图片的 `stories copy`，记录来源书库、来源 id、目标书库、返回的目标 id，以及原创建 requestId 和输入。核对目标文本与审核记录后，先向用户说明“文本已复制”，再在对话中询问是否复制来源已有图片；展示已有图片数/总幅数，不能用图片生成代替图片复制。
- 用户同意复制图片后，调用 `stories copy-images <目标id> --from-data-dir <来源书库> --data-dir <目标书库>`，输入 `{sourceId:"来源id"}`。这是给同一文本副本补图的独立动作，不修改原创建请求、不重新复制文本。用户拒绝或尚未回答时，保留文本并等待；用户此前已明确要求连图片一起复制时，沿用该授权，无需再问。
- 更换画风或来源没有图片时，说明不能沿用旧图或没有可复制图片。若用户想制作新图，先确认画风和制作范围，再通过目标故事的恢复与 `run` 生产流程执行。复制文本和图片均不重新审核、不调用模型；图片复制失败保留文本，沿用相同目标 id 与来源输入重试，遇到输入冲突时停止并重新核对。
- 用户明确要求复制未审核文本时使用 `copy --draft`，不要伪造 passed 或改用普通复制。该模式停在暂停的文本副本，不进入上述已有图片复制步骤；获准继续制作后，resume/run 会按保存的检查点继续审核，再生成图片。

### 仅重绘选定图片

用户要求重新画已有图片、同时保留文本与画风时，先读 `stories current <id>` 和该当前 id 的 `stories revisions`，核对页码与现有状态。通过 `stories edit <当前id> --request-id <UUID> --input <私有JSON文件>` 提交：

```json
{"token":"读取到的修订token","paused":true,"changes":{"redrawPages":[1,3]}}
```

- 编辑只保存暂停的新版，不生图；记录返回的新 id。已获用户授权继续时，对新 id 执行 `stories resume`，再 `run <新id> --until completed`；仅保存草稿的任务停在 edit，不能把 run 当作隐式恢复。
- 仅生成选中的图片，不重新编排或审核；即使第 1 幅被选中，其余未选图片仍保留。原版本保留；后续预览、检查与导出使用新 id。
- 完成后重读新版本，核对实际停止原因和全部画幅。重放使用原 requestId、token 和页码；发生冲突、暂停或故障时按既有停止规则处理，不另建重复新版。

## 验收与交付

- 整理报告：说明使用的书库、筛选范围与当前版本；缺图数量来自实际 pages，尚无分镜时报告“未编排”，部分分镜报告“编排中”，不当作 0 幅完成。分析字段不全时补读 get/current/source，仍缺失则标注未知。
- 制作完成：重新读取当前版本，核对状态、审核/故障与所有预期画幅。ZIP/PDF/PNG 要求 state 为 completed 且每幅都有图，还必须由现有导出入口验证图片全部可读；不因有 image 地址就宣称可完整导出。预览和 JSON/Markdown 可以交付已有完整分镜的中间稿，明确未完成部分；preview 和所有 export 格式都只接受当前版本。
- 公开 ZIP 默认只含 `故事.json`、`分镜.md`、`署名与转载.txt` 和 `图片/` 下编号 WebP。保留已保存原文、来源、作者与 AI 披露；不包含内部提示词，只有用户明确需要内部记录时使用 `--include-prompts`。
- 使用用户署名；未提供时说明，只有明确选择不署名才用 `--allow-unsigned`。不伪造作者、不跳过缺图、不改用旧版。产物放在私有书库和应用静态目录之外；普通导出写新路径，不覆盖已有文件。项目若有专用导出约定，沿用其生产导出脚本。
- 交付实际文件路径和已核实结果；报告未完成项及原因，不承诺尚未验证的生成或媒体完整性。临时程序和私有输入保存在临时目录，清理本次临时输入；保留用户要求的报告和作品。导出、整理或备份不代表授权 Git 提交、推送或发布；不把私有备份存到公开作品目录。

## 版本检查与更新

普通 NPX 服务及桌面「启动服务」成功后会尝试安装随包的用户级技能到 `~/.agents/skills/shiqu`。启动只使用随包内容，不查询 npm 或下载新包；已有副本仅按原 auto-update 同意更新，不覆盖修改、未知来源或较新副本。尊重 Codex 宿主停用和已启用插件，不修改宿主配置；失败不阻止服务。帮助、配置、维护、独立子命令、开发服务和桌面测试/升级不隐式安装。

`skill auto-install [on|off]` 查询/保存启动安装偏好；`SHIQU_SKILL_AUTO_INSTALL=off` 仅跳过本次启动。它们不删除技能、不改变 auto-update 同意，也不要求停服。插件包由宿主管理更新，不在插件缓存执行独立技能安装或更新。

- 每次启用技能，用上述入口执行 `skill check`。它自动发现当前项目祖先目录（截至 Git 根）或全局安装；确认返回的 path 是本次加载的技能。返回 `not_installed` 时，说明未发现安装副本，沿用已读取的正文和当前入口，不为原任务隐式安装技能。若同名副本并存而发现结果不匹配，明确指定 `--scope project|global` 和安装根目录，不更新其他副本。查询缓存 24 小时，用户要求立即检查时加 `--refresh`。离线、旧 CLI 不支持检查或检查失败时简短说明，沿用可用版本继续原任务，不循环重试。
- 默认只报告新版。仅用户明确要求开启/关闭自动更新时，执行 `skill check --auto-update on|off`（必要时指定范围）；不要从一次故事任务推断自动更新授权。
- 桌面内置入口没有系统 npm/npx 时，新版通过更新桌面应用并重新启动来同步，保留自动更新同意；报告注册表发现的新版，不执行依赖 npx 的 updateCommand，也不自行安装 npm。其余无版本锁且 `autoUpdateReady` 为 true 时，以返回的 updateCwd 为工作目录执行 updateCommand 参数数组；它固定 npm 正式发布版本并带 `--automatic`，更新时会再次检查偏好。本地修改或未知来源副本不自动覆盖。用户明确要求单次更新但未开启自动更新时，也可执行返回的 updateCommand。
- 更新成功后重新读取返回 path 的技能；有有效桌面运行时记录时继续使用同版本绝对命令，其余默认用 `npx --yes @apprun/shiqu@<version> help --json` 核对返回 version 对应的 CLI，后续任务沿用该固定版本。未更新且无用户/项目版本锁、非桌面/源码入口时，已管理副本使用 `npx --yes @apprun/shiqu@<installedVersion>`，不随 latest 漂移；未获知安装版本时先通过 help/skill check 核对版本，再执行书库任务。用户明确指定其他启动器时保留启动器并固定相同版本；自定义副本或源码入口沿用用户选择并核对兼容性。更新失败保留现状，不手工覆盖或删除状态以绕过保护。
- `skill update --scope project|global` 只安装正在运行的 CLI 包自带技能，不自行寻找最新包。安装记录缺失时，仅与运行包正文完全相同的旧副本可用该版本 `skill install` 建立记录；不同内容需人工比较合并。检查/更新不操作书库或生成配置。
