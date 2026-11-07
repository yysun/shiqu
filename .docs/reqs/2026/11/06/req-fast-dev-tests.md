# 开发期测试提速

方案：[plan-fast-dev-tests.md](../../../../plans/2026/11/06/plan-fast-dev-tests.md)

本文为实现后补写，记录方案“目标/非目标”所约定的要求。

## 问题

每次代码改动后，`pnpm test:changed` 都要跑大量测试，严重拖慢开发：
- 任意代码改动都会选中 83 个基线文件，受影响的文件还会开启完整提供方/重型开关。CSS 改动选中 87 个文件，`lib/reader-review.ts` 约 2 分钟。
- 改任何测试夹具都会退回全量源码测试，约 5 分钟。
- 本机默认 Node 版本与项目要求不符，导致测试误报失败。

另有 24 个测试在运行时用 esbuild 现场生成被测代码再执行，无法像普通测试那样直接导入被测组件。

## 期望结果

- 开发迭代时有一条秒级的“相关测试”命令。
- 交付前的影响检查保持与 PR CI 一致，并少触发全量。
- 组件测试可以用 `node --test <file>` 直接运行。

## 验收标准

- [x] 提供开发内循环命令 `pnpm test:related`，可按工作区改动或 `--files` 指定的路径选测，`--plan`/`--json` 只预览。
- [x] `test:related` 对 CSS 或单个组件改动 10s 内完成；对 `lib/reader-review.ts` 这类核心模块改动，墙钟不超过同一改动 `test:changed` 的 50%。
- [x] `test:related` 一律使用快速开关，不运行 Playwright 和原生测试，不写 `.data/test-plans` 证据。
- [x] `test:related` 选出 0 个文件时明确说明“未运行、不代表通过”，并按改动类型提示 `test:e2e`、`desktop:test` 或 `test:changed`。
- [x] 删除或改名导致导入分析失败的测试会被选中，不会被当作空集；有未登记测试时非零退出。
- [x] `test:changed` 与 PR CI 对非夹具改动的选测与开关保持不变，只有两处已记录的例外：`BookReferenceStar.tsx`、`StoryScript.tsx` 改为同时选中直接渲染它们的测试。
- [x] 被测试导入的 `tests/fixtures/*` 改动只选其消费者，不再退回全量；新导入夹具却未登记 `covers` 会被契约测试拦下。
- [x] 使用真实 React 的组件渲染测试直接导入被测组件，能用 `node --test tests/<file>` 单独运行，用例数与断言数不变。
- [x] 测试入口在 Node 主版本与 `engines` 不符时输出警告。
- [x] `AGENTS.md` 与测试文档说明以下内容：
  - 迭代用 `test:related`，交付前跑一次 `test:changed`；
  - 单文件直接运行的方法；
  - `test:related` 的漏选边界。

## 约束

- 测试与工具调用与生产相同的实现，不维护第二套选测或执行逻辑。
- 新增或修改的注释使用中文；新测试与其 `covers` 登记到 `tests/manifest.json`。
- 不修改用户的 Node 默认版本。

## 非目标

- 不改变 PR CI、main、手动和发布标签的资格范围、`pr:'code'` 基线、完整提供方矩阵与 Playwright 门禁。
- 不删除、合并或弱化断言；不改慢测试本身的内容。
- 不引入新的测试框架或依赖。
- 不改动以下两类测试：替换 React 或其他模块的测试；打包桌面运行时产物的测试。

## 待决问题

无。核心模块的相关口径已由用户选定为“直接导入者”（方案选项 B）。
