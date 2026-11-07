# 启动技能安装与桌面内置 CLI

## Summary

普通 NPX/桌面服务启动成功后准备缺失的用户技能；更新复用原 autoUpdate 同意，保留定制、停用、未知与较新副本。桌面携带生产 CLI，并登记受哈希保护的绝对 Node/CLI 命令，无需系统 npm。独立安装开关、失败提示、CLI 帮助和使用说明同步更新；未引入 MCP/API 模式。

## Verification

提交 `5f3c0f6`、`5372ca7`、`ebf47fe`。最终冻结 185 文件、1537 项全部通过；typecheck、lint、cargo fmt 及原生 source 25 项通过。真实隔离启动、更新同意、桌面 start/test/upgrade、运行时保护与无 npm 的搬迁 CLI 均有证据。保留并修复首轮 manifest 漏登记失败。没有桌面打包或发布。

## Notes

共享目录并行 reader/UI 修改原样保留；全量在仓库外临时 detached worktree 中验证，证据复制到主目录后移除临时 worktree。内嵌浏览器不可用，未声称现场视觉验收。正常使用仍遵守直接开库的同库占用限制。

按用户后续要求移除 `shiqu-mcp-story-workflow` 工作树，保留 `codex/mcp-story-workflow` 分支（`a73ffbe`）；其未提交修改与 untracked 源文件先存入 stash `75a1d02e5d0f1f07cf130702e1104e5007a043db`。

## Final VR

VR risk: non-low — 用户级自动安装、既有更新授权与桌面运行时分发。
VR review round: 1; reviewer: reused

核对实现 `5f3c0f6`、隔离及文档修正 `5372ca7`、覆盖元数据修正 `ebf47fe`。AP P1–P5 已完成，独立 CR 第三轮通过；无未解决的阻断发现。

| 验收项 | 结论 | 证据 |
|---|---|---|
| AC1 | complete | 正式 CLI 成功启动与桌面 `start` 协议安装缺失技能；真实进程回归验证帮助、版本、配置、headless、失败启动及桌面 test/upgrade 不安装。维护路由提前返回、开发入口不调用 helper，由源码核对确认。 |
| AC2 | complete | 启动使用随包正文，不查询注册表；真实启动验证旧副本默认保留、保存 autoUpdate 同意后才更新。隔离回归覆盖定制、未知来源、较新副本、锁、符号链接、宿主停用和插件选择，配置文件保持原样。 |
| AC3 | complete | 独立 auto-install 查询/保存及单次环境关闭均有回归；原 autoUpdate 保留。无效宿主配置不阻止 reader 访问，安全输出不包含测试中的私密配置内容。 |
| AC4 | complete | 正式资源 helper 收集桌面与生产 CLI 依赖、技能、版本及字体。搬迁测试使用复制的绝对 Node/CLI 路径和无 npm/npx 的 PATH，实际执行 help、skill show、catalog 与离线书库读取；运行中同库仍返回 LIBRARY_BUSY。运行时哈希、修改保护及竞争中的较新版本保留均通过。 |
| AC5 | complete | CLI 帮助、技能及相关使用说明一致，明确区分桌面和 NPX 前置条件、更新授权及离线所有权。冻结最终提交的 185 文件、1537 项全部通过，退出码 0；typecheck、lint、cargo fmt 通过，原生 source 检查 25 passed、1 filtered。验证使用隔离用户目录和书库，未运行桌面 prepare/build 或发布。 |

最终全量证据：`.data/test-plans/2026-11-06T23-50-22-469Z-3f1536aa/run.json`、`test.log`；同目录保存 typecheck、lint、native 与 metadata 回归日志。记录的提交为 `ebf47fec30bee911d79f8aa94a18847c58fc61cf`，1537 passed，fail/skipped/cancelled 均为 0。

首轮冻结全量的 manifest 漏登记失败保留于 `.data/test-plans/2026-11-06T23-43-38-742Z-b434f294/`；修正只增加 covers，metadata 回归 3/3 及最终全量均通过。

验收边界：内嵌浏览器不可用，未取得现场视觉观察；技能状态文案由组件渲染测试核对，不宣称视觉验收通过。原生检查按既有 CI 排除一项需要已准备安装包资源的用例。并行 reader/UI 修改未纳入本故事结论；没有修改真实用户书库、技能或宿主配置。

**VR passed: all acceptance criteria complete**
