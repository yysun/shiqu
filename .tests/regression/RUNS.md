# 自动回归关卡 Test Runs

Append one immutable row per run. A retest receives a new Run ID.

| Run ID | Case ID | Environment | Build | Data | Result | Evidence | Defect / Blocker | Executed At | Executor |
| ------ | ------- | ----------- | ----- | ---- | ------ | -------- | ---------------- | ----------- | -------- |
| 20261127T214431Z-REGRESSION-C003-R1 | REGRESSION-C003 | macOS arm64 / Node 24 / Rust 1.93 | 41f60106 | 命令自带隔离目录 | FAIL | evidence/20261127-41f60106/assurance.md | 原生目录锁在释放后未立即重新取得 | 2026-11-27T21:44:31.068Z | Codex |
| 20261127T214431Z-REGRESSION-C004-R1 | REGRESSION-C004 | macOS arm64 / Node 24 / 受控提供方 | 41f60106 | 模型套件隔离样本 | FAIL | evidence/20261127-41f60106/models.md | 结构无变化时的旧状态断言超时 | 2026-11-27T21:44:31.108Z | Codex |
| 20261127T214742Z-REGRESSION-C001-R1 | REGRESSION-C001 | macOS arm64 / Node 24 / Rust 1.93 | 676a5335 | 发布门禁隔离样本 | PASS | evidence/20261127-676a5335/release-check.md | — | 2026-11-27T21:47:42.539Z | Codex |
| 20261127T214742Z-REGRESSION-C003-R2 | REGRESSION-C003 | macOS arm64 / Node 24 / Rust 1.93 | 676a5335 | 安全、启动、loopback 和原生隔离样本 | PASS | evidence/20261127-676a5335/assurance.md | — | 2026-11-27T21:47:42.582Z | Codex |
| 20261127T215034Z-REGRESSION-C002-R1 | REGRESSION-C002 | macOS arm64 / Node 24 | 676a5335 | 全部自动测试及历史格式隔离样本 | PASS | evidence/20261127-676a5335/full.md | — | 2026-11-27T21:50:34.955Z | Codex |
| 20261127T215035Z-REGRESSION-C004-R2 | REGRESSION-C004 | macOS arm64 / Node 24 / 受控模型 | 676a5335 | 67 个受控模型与生成流程套件文件 | PASS | evidence/20261127-676a5335/models.md | — | 2026-11-27T21:50:35.000Z | Codex |
| 20261127T221019Z-REGRESSION-C005-R1 | REGRESSION-C005 | GitHub Actions macOS arm64 和 Windows x64 | 676a5335 | 构建 46072460303 的两个安装包 | PASS | evidence/20261127-676a5335/desktop-builds.md | — | 2026-11-27T22:10:19.674Z | Codex |
