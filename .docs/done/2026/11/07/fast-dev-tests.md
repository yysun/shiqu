# 开发期测试提速

需求：[req-fast-dev-tests.md](../../../reqs/2026/11/06/req-fast-dev-tests.md)。方案：[plan-fast-dev-tests.md](../../../plans/2026/11/06/plan-fast-dev-tests.md)。

## Summary

- 新增 `pnpm test:related`，用于开发迭代。它选出这些测试，全部以快速开关运行，不写证据：
  - 改动的已登记测试；
  - 直接导入改动文件的测试，包括测试文件本身、它的 `tests/` 夹具，以及经由它们导入的 `client/`、`desktop/` 组件；
  - 源码中引用改动路径的测试，识别仓库相对路径和 `./`、`../` 写法；
  - `covers` 消费者。

  不沿 `lib/`、`server/` 传递。选出 0 个文件时明确说明不代表通过；导入分析失败的测试仍会被选中。
- 被测试导入的 18 个夹具和 2 个按路径读取的 JSON 夹具登记了消费者，并由 `tests/` 导入边上的所有权契约约束。夹具改动按消费者选测，不再退回全量。
- 新增 `tests/fixtures/tsx.mjs` 加载钩子：
  - 只为 `client/`、`desktop/` 下的导入方解析 `@/` 别名并补全扩展名；
  - `.tsx` 按 automatic JSX 转译，`.css` 作为空模块加载。

  11 个真实 React 渲染测试和 `book-reference-star` 的渲染部分改为直接导入组件，可用 `node --test` 单独运行。
- `test-pr`、`run-tests`、`test-providers` 在 Node 主版本与 `engines` 不符时输出警告。
- 已更新的文档：
  - 规则与开发说明：`AGENTS.md`、`.docs/development.md`、`.docs/testing-triggers.md`、`.docs/testing-inventory.md`；
  - 本地检查命令：`desktop/README.md`；
  - 变更记录：`CHANGELOG.md` 新增 `[Unreleased]` 条目。

## Verification

- Node 24.22.1：`pnpm typecheck`、`pnpm lint` 通过。
- 全量源码测试（176 个文件，1505 个用例，309s）初次有 4 个失败，均在 `release-pre-push`：它的临时 checkout 缺少新增的 `scripts/node-version.mjs`。补入复制清单并登记 `covers` 后，修复后受影响的 90 个用例全部通过；随后规划器与发布 hook 契约 28/28 通过。修复后未再重跑全量源码。
- `test:related` 实测：

  | 改动 | 选中文件 | 墙钟 |
  | --- | ---: | ---: |
  | `desktop.css` | 1 | 0.9–1.2s |
  | `ReaderShelf.tsx` | 5 | 1.5–2.2s |
  | `lib/reader-review.ts` | 19 | 13–14s（同一改动 `test:changed` 为 146.5s） |

- AR 3 轮、CR 2 轮、VR 1 轮均由独立审查者完成并通过。
- 未运行 Playwright 浏览器测试和原生测试，未打包桌面应用。

## Notes

- **CI 选测有两处已接受的变宽。** 改动 `client/ui/BookReferenceStar.tsx`（87→118 个文件）或 `client/ui/StoryScript.tsx`（87→101 个文件）时，现在会同时选中直接渲染它们的测试。其余非夹具路径的选测与 base `1d427c6` 逐一比较后完全一致。
- **核心模块采用“直接导入者”口径（用户选定）。** 按传递导入图，核心模块的相关集接近全量：`lib/reader-review.ts` 选中 116 个文件，耗时 149s。
- **`server/app.ts`、`tests/fixtures/production.mjs` 仍会选中约 90–100 个测试**，因为它们被共享夹具直接导入或直接使用。
- **已知漏选：**
  - 只经 `lib/`、`server/` 中间模块受影响的测试；
  - 用模板字符串拼出的路径（如 `desktop-css-scope`）。

  这两类由交付前的 `test:changed` 与 CI 兜底。`--plan`、`--json` 须放在 `--files` 之前。
- **以下测试保留运行时打包：**
  - 替换 React 或其他模块的测试，包括 `recent-stories-ui` 和 `book-reference-star` 的 hook 部分；
  - 打包桌面运行时产物的测试。
- **提交：** `aacb898`、`948e31d`，以及本次文档提交。并发工作 `84eeb98` 与未提交的 `scripts/desktop-smoke.mjs` 不属于本次变更；未推送远端。

VR risk: non-low — 测试选择是基础设施边界，PR CI、发布前 hook 与 `test:changed` 共用 `scripts/test-plan.mjs` 和 `tests/manifest.json`。选漏的回归要到 CI 才会暴露。
VR review round: 1; reviewer: new

已核验范围：story base `1d427c6`，story 提交 `aacb898`、`948e31d`。`84eeb98` 和工作区里的并发改动（`scripts/desktop-smoke.mjs`、CHANGELOG 等）未纳入。全部检查在 Node 24.22.1 下运行，未跑全量套件，未跑 Playwright。

1. **complete** — 提供 `pnpm test:related`，支持工作区改动或 `--files`，`--plan`/`--json` 只预览
   - 实现位置：`package.json`，`"test:related": "node scripts/test-pr.mjs --related"`；`scripts/test-pr.mjs:67`，未传 `--files` 时调用 `workingTreeFiles()`，传入路径会做规范化。
   - 实测 `pnpm test:related --plan`：读取了工作区 6 个改动路径。
   - 实测 `--json`：输出合法 JSON，`related:true`。
   - 两次预览前后 `.data/test-plans` 都是 37 个，没有执行测试，也没有写证据。

2. **complete** — CSS/单个组件 ≤10s；核心模块不超过 `test:changed` 的 50%
   - 实测 `pnpm test:related --files <path>`，墙钟（`/usr/bin/time -p`）：

     | 改动 | 选中文件 | 用例 | 墙钟 |
     | --- | ---: | ---: | ---: |
     | `client/ui/desktop.css` | 1 | 3/3 通过 | 0.91s |
     | `client/ui/ReaderShelf.tsx` | 5 | 17/17 通过 | 2.16s |
     | `client/ui/StoryScript.tsx` | 1 | 5/5 通过 | 1.77s |
     | `lib/reader-review.ts` | 19 | 142/142 通过 | 14.24s |

   - 对照：同一改动 `test:changed` 选中 131 个文件（`test-pr.mjs --plan --files lib/reader-review.ts`，`"files": 131`）。实测墙钟沿用 TT 记录的 146.5s，14.24s 约为其 9.7%。

3. **complete** — 一律快速开关，不跑 Playwright 和原生测试，不写 `.data/test-plans`
   - `scripts/test-plan.mjs:84`：过滤掉 `native` 与 `browser-e2e`。
   - `createRelatedPlan` 中所有条目都是 `mode:'fast'`。
   - `scripts/test-pr.mjs:44-45`：先删除 `SHIQU_TEST_TIER`，只有 full 模式才会设置。
   - `scripts/test-pr.mjs:74`：以 `executePlan(plan,{evidence:false})` 运行。
   - 实测四次真实运行前后 `.data/test-plans` 都是 37 个。
   - `--files tests/desktop-responsive-layout.playwright.e2e.mjs` 没有运行该 E2E，只提示“浏览器用例请运行 pnpm test:e2e”。
   - 契约测试 `tests/test-pr.test.mjs` 断言了全部为 fast 模式且不生成 `.data`。

4. **complete** — 0 个文件时明确说明，并按改动类型提示
   - `client/ui/DeletedStories.tsx`：输出“没有直接相关的测试：0 个文件被运行，间接受影响的测试未检查，这不代表通过。”和“请运行 pnpm test:changed 检查完整影响面”，exit 0。
   - `src-tauri/src/config.rs`：额外提示“原生代码请运行 pnpm desktop:test”。
   - Playwright 文件：提示 `pnpm test:e2e`。
   - 代码位置：`scripts/test-plan.mjs:88-91`。

5. **complete** — 导入分析失败的测试会被选中，未登记测试时非零退出
   - `scripts/test-graph.mjs:20-23`：整体构建失败时逐个入口重建，失败的入口记为相关；全部入口失败时报错，不返回空集。
   - 契约测试删除 `lib/b.ts` 后，仍断言选中 `tests/graph.test.mjs`。
   - 写入未登记的 `tests/new.test.mjs` 后，断言退出码非零。
   - 实测 `node --test tests/test-pr.test.mjs tests/test-tiers.test.mjs tests/ci-scope.test.mjs`：18/18 通过，输出中可见“1 个测试无法解析导入，已视为相关”。

6. **complete** — `test:changed`/PR CI 对非夹具改动的选测不变，只有 2 处例外
   - 方法：把 `1d427c6` 和 `948e31d` 的 `scripts`、`tests`、`src-tauri/src`、`package.json` 分别解出到临时目录。对两棵树并集中的全部 2992 个路径，各用该树自己的 `changeScope` + `createPlan`（darwin）计算计划，比较 `full`、`native`、测试文件:模式、`deferredBrowser`。
   - 结果共 23 处差异：
     - 19 处是 `tests/fixtures/*`，都从 full(176) 变为按消费者选测；
     - 2 处是新脚本 `scripts/node-version.mjs`、`scripts/test-graph.mjs`；
     - 其余只有 `client/ui/BookReferenceStar.tsx`（87→118）和 `client/ui/StoryScript.tsx`（87→101），与文档记录的例外一致。
   - 其他路径的计划完全相同，包括 `84eeb98` 改动的组件。
   - `scripts/ci-scope.mjs` 与 `.github` 不在 story diff 中。

7. **complete** — 被测试导入的夹具只选消费者；漏登记 `covers` 会被契约拦下
   - 探针：测试经 `tests/` 导入边可达的夹具共 18 个，在当前 HEAD 计划下都不是 full。
   - 仍为 full 的只有 `.py`、`images/`，以及 `story-discovery-preview.mjs`、`story-requirements-preview.mjs`。它们不被任何测试导入。
   - `tests/test-tiers.test.mjs` 末尾新增的契约测试通过。
   - 变异探针：从 `storyboard-ui` 的 `covers` 中去掉 `tests/fixtures/tsx.mjs` 后，同一检查报出 `tests/storyboard-ui.test.mjs -> tests/fixtures/tsx.mjs`。

8. **complete** — 真实 React 组件渲染测试直接导入，可单独 `node --test`，用例数与断言数不变
   - 静态比较 `1d427c6`→`aacb898` 的 12 个文件，`test(` 数与 `assert*(` 数逐个相同，例如 `unified-story-setup-ui` 1/147→1/147，`story-stage-feedback` 16/129→16/129。
   - 在 HEAD 上逐个 `node --test tests/<file>`，12 个文件都是 exit 0、0 失败。`story-stage-feedback` 为 17 个，多出的 1 个由并发提交 `84eeb98` 新增。
   - 说明：`recent-stories-ui` 仍在运行时用 esbuild 打包。它有 1 个用例复用同一打包结果并替换了 `react` hooks，属于非目标中“替换 React 的测试”，按 REQ 不改。`book-reference-star` 的 `useBookReference` 部分同理保留原状。这两个文件本来也能直接用 `node --test` 运行。

9. **complete** — Node 主版本与 `engines` 不符时警告
   - `warnNodeVersion()` 接入 `scripts/test-pr.mjs:61`、`scripts/run-tests.mjs:5`、`scripts/test-providers.mjs:5`。
   - 实测用 Node 22.17.0 运行 `test-pr.mjs --related --plan`，stderr 输出“提示：当前 Node 22.17.0，项目要求 >=24 <25（见 .nvmrc）。先运行 nvm use…”，之后继续执行。
   - 契约测试 `node version warning compares the engines major version` 通过。

10. **complete** — `AGENTS.md` 与测试文档说明了三项内容
    - 迭代用 `test:related`、交付前跑一次 `test:changed`：`AGENTS.md:14-16`、`.docs/development.md:116-124`、`.docs/testing-triggers.md:8,15`。
    - 单文件直接运行：`AGENTS.md:15` 写了 `node --test tests/<file>`，`.docs/development.md:117` 也有。
    - 漏选边界：三份文档都说明不沿 `lib/`/`server/` 传递、不是影响检查、模板字符串拼出的路径无法识别、空集不代表通过。`.docs/testing-triggers.md` 还更新了夹具消费者规则。

**已修改的文件**：只改了 `/Users/esun/Documents/Projects/shiqu-docker/.docs/reqs/2026/11/06/req-fast-dev-tests.md`，10 条验收标准全部勾选。没有提交。临时解出的 base/head 树已删除。

**非阻断观察**（不影响结论）：
- 路径字面量会少量多选。例如 `--files README.md` 选中了 `ci-scope` 和 `test-pr` 两个契约测试，因为它们的源码里出现了该路径。设计文档已注明这一点。
- 当前工作区出现了新的并发改动（`.docs/testing-inventory.md`、`CHANGELOG.md`、`desktop/README.md`），不属于本 story。

VR passed: all acceptance criteria complete
