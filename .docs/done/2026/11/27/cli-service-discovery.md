# CLI 启动并接入书库服务

CLI 通过书库锁关联的本机 URL 连接已有实例。书库空闲时自动启动只监听本机的短时服务。Skill 可在桌面继续运行时使用完整制作流程。保存命令与有限制作复用正式调度器，审片停点跨支持同一协议的服务重启保留。

在线备份由持锁实例在空闲时验证并创建，跨库复制读取已就绪来源的只读快照。常规停服和备份先暂停新派发，有在途工作时提示等待。备份完成恢复派发，允许停服后继续拦截请求直至退出。

## 验证

- 初期的 `pnpm test:changed --plan` 和 `pnpm test:changed`、其后按故事范围运行的 `pnpm test:pr --files` 通过。最后一个影响计划覆盖 69 个文件，749 项通过、3 项由测试条件跳过。[影响计划运行记录](../../../../../.data/test-plans/2026-11-28T00-43-50-234Z-b68389a1/run.json)
- 启动、普通 CLI 与桌面入口相关回归 72/72。最终源码提交 `2fe83e3c` 的 10 项[专门验收](../../../../../tests/cli-service.test.mjs)通过，覆盖启动失败和取消、同库接入、完整故事制作、审片停点、在线维护及桌面 stdin 确认。
- Node 24 类型检查、lint、Rust 格式检查、macOS 27 项原生测试和隔离安装 npm 冒烟通过。桌面控制台在应用内浏览器完成预览。Windows、Linux 原生运行和真实付费生成未执行。

## 独立验收

CR passed: no major findings.

CR risk: non-low. Review round 5, reused reviewer.

VR passed: all acceptance criteria complete.

The final startup fix lets a stalled launcher exit without terminating a service that another caller can use. Independent checks found zero drawings during failed validation or after an idle restart, then exactly three after explicit continuation. Online copy preserved all three image hashes and made zero SQLite commits to the source.
