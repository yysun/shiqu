# Codex reasoning effort

模型已可配置，但推理档位仍隐式继承本机 Codex，导致项目中的 Sol 意外使用 high。读者需要从环境配置和桌面设置明确控制这一项。

## Acceptance

- [ ] Node/Docker 支持 `CODEX_REASONING_EFFORT`：空或未设置时继承 Codex；显式支持 low/medium/high/xhigh/max，非法值在模型调用前拒绝。
- [ ] 显式值实际进入 Codex 子进程配置，核对有效配置和新线程档位；不被忽略或回退。未指定时保留继承行为，认证和工具隔离不变。
- [ ] 桌面版 Codex 设置提供推理档位选择；保存、关闭、重新打开后保持选择，启动/检查连接时传入同一值；服务运行或操作进行中不能修改。
- [ ] 旧版 SQLite 设置和旧 `settings.json` 缺少新字段仍能读取，默认继承；非法新值不会覆盖既有配置或密钥。
- [ ] 更新 env 示例与 Node/桌面说明，区分 env 和原生桌面配置的入口，说明值的模型兼容性与重启要求。

## Boundaries

仅配置推理强度；不改变全局 Codex 配置、应用的默认模型、超时、会话锁、图片模型或缓存策略。不重生成书架故事，不构建 Docker 或桌面安装包。
