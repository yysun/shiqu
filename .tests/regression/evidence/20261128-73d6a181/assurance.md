# REGRESSION-C003 · 0.18.0 保障检查

提交 `73d6a18149c351155945d302c2aad2e981de7117`，macOS arm64，Node 24.22.1，Rust 1.93.0。独立服务 QA 在干净检出执行 `pnpm test:assurance`，于 2026-11-28T04:20:43Z 退出 0。

| 范围 | 结果 |
| --- | --- |
| 安全、启动和 loopback | 29 个 JavaScript 文件，328 项通过、0 失败、0 跳过 |
| macOS Rust | 31 项通过、0 失败 |
| 先前失败的依赖声明检查 | 原有两项断言均通过 |

测试使用隔离书库、本机临时端口及受控提供方。此轮同时验证 [CLI 共享服务、桌面接入与在线备份](../../../changes/evidence/20261128-73d6a181/shared-service.md)。执行日志 `shiqu-018-73d6a181-assurance.log` 保存在验证机器的临时目录。
