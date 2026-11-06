# 启动技能场景

全部使用隔离 HOME、设置与书库，provider=readonly，不调用付费模型。自动化入口为 `tests/agent-skill-startup.test.mjs`，无需真实用户配置或桌面安装包。

1. 首次 CLI 启动：临时 root 有随包技能与生产资源。运行正式 CLI 服务，等待监听；技能与版本记录落在临时用户目录、autoUpdate=false，reader 仍可读。停止并再次启动应幂等。无效宿主配置或技能冲突只显示安全失败，服务仍可读。
2. 更新：安装旧技能，默认启动保留旧正文；通过已有 check --auto-update on 后启动新应用，更新到随包正文。定制/未知/较新副本保留。锁、符号链接、损坏记录和运行时竞争不得覆盖外部文件或较新记录。
3. 排除与偏好：帮助、版本、配置/维护/headless 和桌面 test/upgrade 不调用启动安装。独立 auto-install off 或环境 off 跳过，原 autoUpdate 和宿主配置不变；宿主停用与启用插件跳过独立安装。
4. 桌面独立 CLI：在临时目录用生产 helper 组装 CLI 和必要依赖/资产；使用绝对 Node 路径并移除 PATH 的 npm/npx。通过真实桌面 start 协议启动、读取安全状态与运行时记录；在线时离线 CLI 保留 LIBRARY_BUSY。停止服务后按记录命令读取 catalog/书库，核对 appVersion、技能正文及退出码。验证运行时元数据哈希、被修改记录保护及失效路径保护。
5. 桌面提示：ServiceCard 显示来自 status 的技能准备结果，不暴露提供方配置内容；用隔离状态在已有内嵌浏览器预览检查。原生环境只增加 CODEX_HOME 与 SHIQU_SKILL_AUTO_INSTALL 透传，继续拒绝 NODE_OPTIONS 和密钥。
