# 自备书籍导入为本地书

## Summary

新增本地书导入流程，支持 TXT、HTML、无 DRM EPUB 和公网网页。导入后可确认章节结构、逐章生成可回查原文的故事卡，并用于现有按章节、按故事、按主题、向量建库、CLI、书库备份及故事导出流程。删除、替换、取消和崩溃恢复均保护当前有效版本。

## Verification

- 重基到 `main` 的 `928229c` 后，`git diff --name-only main...HEAD | xargs pnpm test:pr --files` 通过：48 个自动选择文件、434 项通过、0 失败。新增 URL 抓取、导入书生命周期和故事卡生成测试直接运行，13/13 通过。
- `pnpm typecheck`、`pnpm lint`、`cargo fmt --manifest-path src-tauri/Cargo.toml --check` 通过。main CI 资源覆盖下 Rust library tests 为 13 passed、0 failed、13 filtered。首次目录锁用例失败后，单测和完整 CI 覆盖重跑均通过。
- Node 24.22.1 下浏览器与 CLI 隔离导入流程通过；均识别两章、确认结构并显示本地调用预算估算，没有发送模型推理。
- `pnpm test:changed` 选择了 0 个文件，因为实现已提交且剩余工作区改动仅为文档；完整分支测试由显式传入故事路径的 `pnpm test:pr --files` 完成。

## Notes

本地故事库、浏览器预览服务和临时导入文件均已清理。main 的慢速书籍、模型、安全与启动套件仍保持按需运行，没有把整套手动验证重新并入常规测试门禁。分支已 rebase 到 `928229c`，未推送、未合并。

VR passed: all acceptance criteria complete

- TXT、HTML、EPUB、字符编码、章节结构、质量标记、版次与资源上限由解析和导入测试覆盖；URL 的公网地址、重定向边界、DNS 截止时间及抓取限制由安全测试覆盖。
- 故事卡使用生产 provider 的 cards 输入约定；预算、章节窗口、出处核对、取消与 teardown、续跑、失败重试、版次更新和缓存清理由测试覆盖。无向量和向量的既有查找路径继续复用生产实现。
- 书库 API、用户导入书目、旧版 `other` 任务、备份、损坏隔离、删除、替换及崩溃恢复由回归测试覆盖；来源授权元数据和故事导出由导出测试覆盖。
- 浏览器与 CLI 隔离导入旅程完成；CLI 帮助、`skills/shiqu/SKILL.md` 与使用示例已同步。所有验收条目在 REQ 中保持勾选。
- 重基后自动影响计划为 434 项通过，13 项手动导入专项测试通过，类型检查、Lint 和原生检查通过；main 的慢速与保障套件仍按需运行。
