# 版本改动 Test Runs

Append one immutable row per run. A retest receives a new Run ID.

| Run ID | Case ID | Environment | Build | Data | Result | Evidence | Defect / Blocker | Executed At | Executor |
| ------ | ------- | ----------- | ----- | ---- | ------ | -------- | ---------------- | ----------- | -------- |
| 20261127T214742Z-CHANGES-C005-R1 | CHANGES-C005 | macOS / Node 24 / 真实读者组件与隔离 SQLite | 676a5335 | 首次确认、各阶段与 CLI 服务动作 | PASS | evidence/20261127-676a5335/frame-count.md | — | 2026-11-27T21:47:42.816Z | Codex |
| 20261127T214742Z-CHANGES-C007-R1 | CHANGES-C007 | macOS / Node 24 / 隔离 SQLite 和受控模型 | 676a5335 | 28 幅画面事实错误及无变化对照 | PASS | evidence/20261127-676a5335/issue-routing.md | — | 2026-11-27T21:47:42.877Z | Codex |
| 20261127T215035Z-CHANGES-C006-R1 | CHANGES-C006 | Chrome / Node 24 / 正式 API / 隔离 SQLite | 676a5335 | 三个修订字段、过期草稿与无变化 | PASS | evidence/20261127-676a5335/reader-suggestions.md | — | 2026-11-27T21:50:35.041Z | Codex |
| 20261127T215543Z-CHANGES-C002-R1 | CHANGES-C002 | macOS / Chrome 或 Node 24 / 正式服务 / 隔离 SQLite | 676a5335 | continue | PASS | evidence/20261127-676a5335/continue.md | — | 2026-11-27T21:55:43.291Z | Codex |
| 20261127T215543Z-CHANGES-C003-R1 | CHANGES-C003 | macOS / Chrome 或 Node 24 / 正式服务 / 隔离 SQLite | 676a5335 | art-impact | PASS | evidence/20261127-676a5335/art-impact.md | — | 2026-11-27T21:55:43.405Z | Codex |
| 20261127T215543Z-CHANGES-C004-R1 | CHANGES-C004 | macOS / Chrome 或 Node 24 / 正式服务 / 隔离 SQLite | 676a5335 | draft-exits | PASS | evidence/20261127-676a5335/draft-exits.md | — | 2026-11-27T21:55:43.515Z | Codex |
| 20261127T222434Z-CHANGES-C001-R1 | CHANGES-C001 | macOS arm64 候选安装包 / 隔离 Chromium 受控断网 | 676a5335 | GitHub 最新正式发行版 | BLOCKED | evidence/20261127-676a5335/update-check.md, evidence/20261127-676a5335/changes-c001-online.jpg, evidence/20261127-676a5335/changes-c001-network-fixture.png | 安装包原生 WebView 离线分支待验，独立 Chromium 受控界面已通过 | 2026-11-27T22:24:34.191Z | Codex |
| 20261127T223308Z-CHANGES-C001-R2 | CHANGES-C001 | macOS arm64 候选安装包 / 维护者断网复核 | 676a5335 | GitHub 最新正式发行版；旁证为隔离缓存复现 | FAIL | evidence/20261127-676a5335/update-check-offline.md | 断网后显示已是最新版本；隔离 Chromium 复现默认 HTTP 缓存可导致误报 | 2026-11-27T22:33:08.232Z | Yiyi Sun |
| 20261127T225724Z-CHANGES-C001-R3 | CHANGES-C001 | macOS 26.5.1 arm64 / 候选 DMG 原生 WebView | 2ca9d691 | 正式版 v0.17.0；同一原生窗口联网、断网、恢复 | PASS | evidence/20261127-2ca9d691/update-check.md, evidence/20261127-2ca9d691/changes-c001-online.jpg, evidence/20261127-2ca9d691/changes-c001-offline.jpg, evidence/20261127-2ca9d691/changes-c001-recovered.jpg, evidence/20261127-2ca9d691/changes-c001-connectivity.log | — | 2026-11-27T22:57:24.208Z | Codex 独立复测；Yiyi Sun 操作断网与离线点击 |
| 20261127T232404Z-CHANGES-C008-R1 | CHANGES-C008 | macOS arm64 / 本地 0.18.0 内置运行时及源码维护入口 | 9f0e9383 | 隔离书库、4,608 个合成文件、登记回退快照和故障注入 | PASS | evidence/20261127-9f0e9383/backup-cleanup.md | — | 2026-11-27T23:24:04.000Z | Codex 已有隔离验证 |
| 20261128T042043Z-CHANGES-C009-R1 | CHANGES-C009 | macOS arm64 / Node 24.22.1 / CLI 与正式受控服务 | 73d6a181 | 并发冷启动、等待授权、全量与有限运行 | PASS | evidence/20261128-73d6a181/shared-service.md | — | 2026-11-28T04:20:43Z | Codex 独立服务 QA |
| 20261128T042043Z-CHANGES-C010-R1 | CHANGES-C010 | macOS arm64 / 正式桌面控制通道 / 原生控制器 | 73d6a181 | 同库同版接入、停服、强停和重启 | PASS | evidence/20261128-73d6a181/shared-service.md | — | 2026-11-28T04:20:43Z | Codex 独立服务 QA |
| 20261128T042043Z-CHANGES-C012-R1 | CHANGES-C012 | macOS arm64 / CLI 和桌面在线维护 | 73d6a181 | 隔离书库的任务活动与空闲快照 | PASS | evidence/20261128-73d6a181/shared-service.md | — | 2026-11-28T04:20:43Z | Codex 独立服务 QA |
| 20261128T042112Z-CHANGES-C008-R2 | CHANGES-C008 | macOS arm64 / Node 24.22.1 / 正式维护入口 | 73d6a181 | 旧快照、回退引用、隔离故障注入 | PASS | evidence/20261128-73d6a181/backup-cleanup.md | — | 2026-11-28T04:21:12.073Z | Codex 独立读者 QA |
| 20261128T042112Z-CHANGES-C011-R1 | CHANGES-C011 | macOS arm64 / 正式制作和导出 / 受控提供方 | 73d6a181 | 历史和未完成套图、过期操作、丢失参考图 | PASS | evidence/20261128-73d6a181/landscape.md | — | 2026-11-28T04:21:12.073Z | Codex 独立读者 QA |
