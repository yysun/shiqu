# LAN 生成设置恢复

可信 LAN 原先被设置 API 的回环限制拒绝，Profile 因403隐藏入口。现在 dev、CLI 和 desktop 服务允许真实私有网络来源通过实际接口地址编辑共用提供方、模型、推理和密钥；保留同源、代理证明、字段/修订校验、已存密钥不返回及独立互联网隧道拒绝。无需改变表单保存流程、依赖或数据库。

实现提交：`75f712f`；基线：`d9005d413928184f15de1f5b20876f92fff0d57e`。没有推送或发布。

验证：聚焦36/36、真实dev探针、全量172文件1437项的原始1432通过与隔离复跑7/7合并证据、typecheck/lint、cargo fmt和原生源码24/24。日志：`/tmp/shiqu-lan-settings-tests.log`、`/tmp/shiqu-lan-settings-isolated-checks.log`、`/tmp/shiqu-lan-settings-native.log`；原始全量退出1的并行工作干扰如最终验收所述。UI截图在`.data/e2e/desktop-service-console/lan-provider-settings-{1040,390}.png`。

初次交付时用户的 Vite 进程仍加载旧规则；之后用户授权重启，完成情况见末尾。未运行推理、更改真实密钥/书库或打包。

VR passed: all acceptance criteria complete

VR risk: non-low — LAN 获得共享配置与凭据修改权限，网络访问边界需保持。

VR review round: 1; reviewer: reused

1. **完成**：真实 dev、CLI、desktop LAN 接口及 Profile 表单通过；提供方、模型、推理、合成密钥保存与重读正常。
2. **完成**：原始 peer、实际接口 Host、代理证明、同源提交、公共来源及隧道拒绝有实现和回归证据。
3. **完成**：密钥不回传、修订冲突、严格字段、共享存储及重启生效行为保持。
4. **完成**：隔离验证、文档与技能同步。全量执行的 1432 项通过可复用；另外 5 项因并行新增未注册测试失败，在稳定提交隔离复跑中全部通过。原生 24/24、fmt、typecheck、lint 通过。

证据限制：原混合工作区全量命令退出失败，不能报告为全绿。UI 使用独立 Playwright Chromium；截图已查看，1040/390px 无横向溢出。未验证第二台物理手机或实际 IPv6 链路；过滤 1 项打包资源测试，未打包。

未执行测试或修改文件。主代理可勾选四项验收标准。

用户随后明确授权中断并重启现有服务，已按原 `pnpm dev` 启动方式完成。启动环境在内存中保留，未输出或落盘密钥；重启前后 runtime 与启动覆盖名称一致。实际两个私有 LAN 地址的设置接口均 HTTP 200，表单数据存在；跨站读取仍403，reader/status为200。没有修改真实配置或追加测试套件。

交付范围说明：模型配置随后通过 [新任务热更新](provider-key-source.md) 改为保存即供新任务使用；本记录的重启步骤是历史代码升级操作。最终按钮整理见 [设置页操作交付](../06/provider-settings-actions.md)。用户已于2026-11-06请求GC，本验收记录随最终文档提交入库，未推送。
