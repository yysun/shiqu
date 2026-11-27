# 自动回归关卡 Test Runs

Append one immutable row per run. A retest receives a new Run ID.

| Run ID | Case ID | Environment | Build | Data | Result | Evidence | Defect / Blocker | Executed At | Executor |
| ------ | ------- | ----------- | ----- | ---- | ------ | -------- | ---------------- | ----------- | -------- |
| 20261127T214431Z-REGRESSION-C003-R1 | REGRESSION-C003 | macOS arm64 / Node 24 / Rust 1.93 | 41f60106 | 命令自带隔离目录 | FAIL | evidence/20261127-41f60106/assurance.md | 原生目录锁在释放后未立即重新取得 | 2026-11-27T21:44:31.068Z | Codex |
| 20261127T214431Z-REGRESSION-C004-R1 | REGRESSION-C004 | macOS arm64 / Node 24 / 受控提供方 | 41f60106 | 模型套件隔离样本 | FAIL | evidence/20261127-41f60106/models.md | 结构无变化时的旧状态断言超时 | 2026-11-27T21:44:31.108Z | Codex |
