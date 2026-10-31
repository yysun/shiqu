# CLI 共享书库与取消 Lite

Story base: `800757225ea1c00faae12c5958b22c0aacceb45d`.

既有相关工作：README 精简、使用/开发指南尚未提交，继续原位更新。用户截图变更 (.docs/assets/story-reader.png 删除与 screenshots.png 新增) 保持原状，不纳入提交。

## 决策

复用 server/library-directory.ts 的桌面路径解析，提取只读“已保存目录”和平台路径供开发/CLI 使用。CLI 显式目录优先；桌面保存目录即使尚不存在也会建立。无桌面设置时使用只含 dataDirectory 的独立 cli-library.json 记录用户确认，或识别默认路径已有 shiqu.sqlite；否则通过终端询问目录，默认建议桌面路径。配置损坏报错，非 TTY 要求 --data-dir。参数相对路径按调用目录解析；帮助/版本不查库，不创建文件。CLI 不读取桌面密钥。

CLI 使用现有桌面 Node 占用协议，需覆盖并发启动、陈旧占用回收和失败清理；占用必须在 createApplication 之前取得。若现有陈旧占用回收无法保证多 CLI 并发，则用 Node SQLite 原生事务锁在同一个所有权 helper 中串行化所有权变更，保留旧 owner 文件兼容旧运行进程。

桌面始终校验内置 Node，移除 Lite feature 开关及系统 Node 检测选择；保留旧 settings.nodePath 反序列化兼容。沿用 standard 产物文件名以保持已有下载链接，只发布 macOS arm64 和 Windows x64 两个内置 Node 安装包。历史文档不改。

## 执行

- [x] 首个可行性检查：确认 pinned Node/pnpm、依赖可用，现有库路径与生命周期测试可执行；确认 Rust 本地测试可在不准备桌面资源时过滤资源依赖用例。
- [x] 实现 CLI 目录查找、询问/取消与选择保存；补充只读配置、跨平台路径、非交互和已有书库测试。
- [x] 接入共享占用保护与清理；使用临时库、真实 HTTP/SQLite 验证 CLI 和桌面切换、并发拒绝、失败释放、数据保留。
- [x] 删除 Lite 构建配置、脚本、Rust/React 分支和 CI 双版循环；保留单一内置 Node 测试和 smoke 约束，不构建桌面。
- [x] 更新 README、两份指南、npm README、发布和桌面文档，保留前面“书籍→主题→画风”和截图引用。
- [x] 执行 JS 测试、typecheck、lint、Rust 格式与可运行用例、.docs/tests/test-cli-shared-library-no-lite.md 场景；检查本地链接与活跃 Lite 引用。

## 风险与验证边界

CLI 默认目录行为有意改变；原独立库不会删除，用户可显式指定。取消 Lite 不删除已发布文件；新发布只含原 standard 命名产物。Windows/Linux 路径有单测；本机进程验证仅声称实际运行平台。Native 安装包与 registry 发布不在本次授权范围。对未提交用户文件只包含明确相关部分，不包含截图资产。

AR passed: no blocking architecture flaws

AR risk: non-low — CLI 持久目录契约、跨入口书库互斥和桌面发行流程发生变化。
AR review round: 1; reviewer: new (`review_cli_desktop`).

AR 约束：SQLite 锁保持到生成停止、业务数据库关闭和旧 owner 文件清理完成；通用 desktop-lite 测试重命名保留。用户最新优先级/非交互/取消场景均已覆盖。

SS probe passed: pinned Node 24.22.1 / pnpm 11.25.0 可用，书库路径现有测试通过。Rust 缺少桌面 Node 资源，使用测试专用 TAURI_CONFIG 去除资源映射，未准备资源或构建安装包；18 个 Rust 用例通过，1 个依赖已打包 Node 的用例过滤，留给 CI。

实现证据：CLI/桌面进程互读 SQLite、媒体、进度，互斥和端口失败释放通过。PTY 回车确认通过；Ctrl+C 取消后临时 HOME 为空。初次受限本机监听 EPERM，提升仅用于临时本地测试后通过。完整 pnpm test 581/581 通过（/tmp/shiqu-cli-no-lite-tests.log），typecheck/lint 通过。应用内浏览器 127.0.0.1:1420 使用临时书库核对设置：仅有内置 Node 24，无系统 Node 输入或 Lite 分支。

最后收尾增加 XDG 相对路径过滤与精确的两个安装包上传 allowlist，待针对性检查和 CR。

实现里程碑：`c234a84` CLI 目录/询问/互斥及测试；`df357c8` 桌面移除 Lite。两次提交均不包含用户截图或既有 README 改动。完整 JS 581/581、定向目录回归 7/7、Rust 18/18（1 个资源用例过滤）及 typecheck/lint 已有上述证据；原生安装包/真实 registry 未验证、未发布。

CR fixed: shutdown waited for active HTTP requests before terminating Codex; the final implementation closes HTTP connections and terminates Codex processes in parallel, then closes the application database and releases library ownership. The focused rerun passed.

CR risk: non-low — CLI persistence, shared-library concurrency, and desktop release behavior change.
CR review round: 2; reviewer: reused (`review_cli_desktop`).

最终退出回归：tests/cli-library.test.mjs 11/11 通过，挂起假 Codex + 子孙进程的 HTTP 状态请求在 628 ms 测试内结束，并确认正常退出及书库锁再获取。CR 无剩余重大问题。完整 JS 最终轮次增加此用例后待完成。

退出修复里程碑：`f6fa9e1`，回归与 CR 通过。

TT 最终默认并发运行：582 项中 581 通过、1 失败，为既有 tests/reader-intake.test.mjs 的 80 幅分镜用例 15 秒资源竞争超时（/tmp/shiqu-cli-no-lite-tests-final.log）。该用例单独重跑通过，耗时 4.2 秒，无断言或超时修改。随后以 --test-concurrency=2 执行所有测试，结果待回填。最终 typecheck/lint、Rust 格式、46 个文档链接/锚点、Desktop CI YAML/Bash 静态检查均通过。CLI 无写入的依赖图验证不包含 server/desktop.ts 或 Tauri。

TT passed: 最终 Node 24.22.1 / pnpm 11.25.0 下使用 `pnpm exec node --experimental-strip-types --test --test-concurrency=2 tests/*.test.mjs`，582 项全部通过，0 失败/跳过/取消，85.5 秒（/tmp/shiqu-cli-no-lite-tests-bounded.log）。原默认并发的 80 幅分镜超时已单跑和全量低并发复核通过，未修改测试。

ET passed: .docs/tests/test-cli-shared-library-no-lite.md 的本机场景完成。新 tests/cli-library.test.mjs 11/11 涵盖真实 SQLite 配置、进程初始化/重启、两入口媒体和进度互读、占用拒绝、端口失败释放和挂起 Codex 正常退出；既有桌面运行时套件保留并通过。PTY 回车、Ctrl+C 与 EOF 通过。应用内浏览器使用 pnpm desktop:preview 和临时目录，设置页只显示内置运行时。跨 Windows/Linux 路径为单测覆盖，未声称原生运行；安装包/registry 未构建或发布。

最终检查：pnpm typecheck、pnpm lint、cargo fmt --check、46 个文档本地链接/锚点、CI YAML 与 Bash 语法通过。Rust 用测试专用资源映射覆盖跑 18 个用例通过，过滤 1 个需已准备 Node bundle 的用例；无桌面资源准备、安装包或 Docker 构建。新增独立 SQLite 事务占用文件位于书库，既有 owner JSON 为旧进程互斥保留，不改变业务 schema。

VR passed: all acceptance criteria complete

VR risk: non-low — CLI persistence, cross-entry concurrency and desktop distribution behavior change.
VR review round: 1; reviewer: reused (`review_cli_desktop`).

独立评估逐条确认 7 项验收完成；完整原文保存在 .docs/done/2026/10/31/cli-shared-library-no-lite.md。DD complete，按自然语言请求流程在 GC 前结束；代码已有三个实现里程碑，文档保留工作区供审阅，没有 push 或发布。用户后续询问 npm 输出位置：保留 npm/ 为维护源文件、outputs/npm/package/ 为生成包、outputs/npm/*.tgz 为待发布产物，未请求改路径，未作改动。
