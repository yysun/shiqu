# 校订并更新当前故事

Git base: d552c677c004fc4472ad80f9d94d988883e0d4dc。工作区已有大量用户改动；仅纳入此次新增校订与维护脚本，不提交已有差异。AR两轮通过，第二轮审查涵盖明确授权的3条更新。

- [x] 新增针对 shishuo 固定原件哈希和单一段落的严格校订模块，补两字，生成派生版 edition，保留原件和其他单元。校订段落的URL/provider准确说明依据。更新source-notices及catalog已知问题说明。
- [x] 在LocalBooks加载完成且建whole-book input前应用；修改现有edition断言，新增校订、其他单元不变、历史保存校验仍可用的回归验证。
- [x] 运行typecheck、lint及适用单元/集成检查；独立CR。
- [x] 审计36条可见故事（已删除12条不动）；确认3条本地书缺出处，其他本地故事匹配的历史出处和自选书固定出处保留。维护脚本核对精确3个目标、现状、备份及无运行任务；曹娥碑两条绑定校订本第3则，《尤三姐》绑定程乙本第66回26–29段并保存完整章节。CAS更新selection/doc、媒体原文；只暂停原失败任务并清除其旧原文校验失败text队列项，已完成故事状态不变。
- [x] 直接读取数据库和REST核验更新；以不调用外部模型的generator stub确认进入plan前的原文校验成功；核验3条selection/original匹配、媒体一致，其余33条可见故事及12条已删除记录无变化，所有计划/图片/修订和设置保留；记录验证与备份。

边界：原件不修改，只有运行时本则补两字；固定edition变化会使未保存原文的旧选题需重新选择，但历史已保存原文仍使用自身匹配的出处，不自动迁移。补正仅基于固定版本，不猜字。校订模块不扩展通用校勘框架。

验证场景见 .docs/tests/test-shishuo-source-correction.md。不构建或打包。浏览器在Work设置中禁用，数据库/REST证明保存结果。

风险与证据：自选书无localSource为正常，不强制迁移。红楼旧程甲本摘录转换为明确标注程乙本的同一事件，而不是给旧文本伪造新版本回执。队列currentJobs包含旧失败项，必须只移除原校验失败text项，防止旧错误继续阻塞。


## 验证证据

- AR passed: no blocking architecture flaws（第二轮，覆盖扩展范围）。
- CR passed: no major findings（第二轮，复用独立reviewer；第一轮发现的旧队列失败项已处理）。
- Node 24.22.1 / pnpm 11.25.0；pnpm typecheck、pnpm lint通过。
- pnpm test最终742/742通过；初轮两个旧版号断言已按校订派生版本修正并单独回归9/9后重跑全套。
- `.data/maintenance/update-shishuo-original.mjs` 执行成功；只更新3条记录并移除1条原文校验失败text队列项。其余45条记录和所有其它队列项逐字未变。
- 完整备份及逐条before/report：`.data/backups/story-original-update/2026-11-01T08-23-31-100Z/`。
- 真实REST核验：`.data/maintenance/story-original-rest-verification.json`；当前任务idle/paused/error=null、12幅；两篇旧故事completed、图片齐全，回执与original一致。
- 再次审计全部36条可见记录：`.data/maintenance/story-original-audit-after.json`，无缺少本地出处、回执不匹配、已知字形/缺文异常；自选书固定外部出处按正常历史记录保留。
- 浏览器在Work设置中被禁用；以真实REST与SQLite读取验证，无付费推理或绘图。

SS里程碑提交：`f5865e7`（本地；742项测试、typecheck、lint通过，数据更新和REST检查完成）。
