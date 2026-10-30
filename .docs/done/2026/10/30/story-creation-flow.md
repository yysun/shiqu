# 故事创建流程收敛

## Summary

创建路径统一为「选书籍和主题 → 选择故事 → 故事流程」。查找候选和等待选择共用选择窗口，不再提前渲染制作进度，避免候选返回前闪出流程。选定故事后进入故事流程，准备建议、等待确认和开始制作后保持同一窗口标题。

移除独立的「制作故事」确认面板。画风和建议幅数回到流程步骤中，制作要求保留为可选编辑入口；「开始制作」在流程内确认，不额外打开窗口。保留候选重选、草稿、暂停恢复、失败重试和查找状态。

入口最终排列为：标题右侧保留「原文」，流程内依次显示「重新选择故事」「制作要求（可选）」。统一重选入口文案，底部不再重复放置制作要求链接。

## Verification

使用 Node 24.22.1 / pnpm 11.25.0。复用实施完成后的有效验证：

- `pnpm exec node --experimental-strip-types --test tests/unified-story-setup-ui.test.mjs tests/reader-intake.test.mjs tests/storyboard-ui.test.mjs`：16/16 通过。覆盖查找时无制作流程、各准备阶段的稳定标题、流程内设置入口、确认后进度、暂停/失败恢复，以及真实持久化和制作确认边界。
- `pnpm typecheck` 通过；本次三个修改文件的 ESLint 和 `git diff --check` 通过。
- 应用内浏览器从真实 `Reader` 页面依次操作选书与主题、查找、选择故事、准备建议和开始制作。查找时直接显示「选择故事」，候选返回后仍为同一选择窗口；选定后进入「故事流程」，确认制作后继续在该流程中更新。
- 浏览器使用隔离的受控 API 响应，没有调用模型或修改用户书架。预览位于 `work/story-flow-preview/`；截图位于 `.data/evidence/story-flow-correction/picker.png` 和 `flow.png`。这些忽略目录中的验证材料不纳入提交。
- 后续入口文案和位置调整通过 `tests/unified-story-setup-ui.test.mjs` 的真实组件渲染回归与 ESLint；上述浏览器截图用于验证窗口路径，不代表最终链接位置。

CR risk: low — 仅调整窗口标题、展示条件和流程内入口。
CR review round: 1; reviewer: not applicable
CR passed: no major findings

## Notes

没有修改后端制作、Token 分割、数据库或依赖，没有构建 Docker 镜像、打包桌面应用或推送远程。本次未重跑全量测试；上述相关验证覆盖最终界面变更。

已有发布日志、版本及原生打包配置，以及并行修改中的故事提示词、审片和分镜逻辑保留在提交之外。
