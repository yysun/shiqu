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
