# 项目规则

本文件只列代理必须遵守的规则。工具如何工作、产品约定和历史见 `.docs/`。

## 依赖与命令

- 源码开发、脚本和文档示例用 pnpm；面向发布包和已安装技能的说明默认用 npx。用户指定启动器时沿用其选择。
- 先运行 `nvm use`。pnpm 版本以 `package.json` 的 `packageManager` 为准。安装用 `pnpm install --frozen-lockfile`，增删依赖用 `pnpm add` / `pnpm remove`，`pnpm-lock.yaml` 随之更新，不引入 npm 或 Yarn 锁文件。
- 源码中调用已安装的命令行工具用 `pnpm exec`。

## 检查

- 迭代时运行 `pnpm test:related` 或 `node --test tests/<file>`。它不是影响检查，选中为空时什么也没证明。
- 交付或提交前运行一次 `pnpm test:changed`，先用 `--plan` 预览。共享 checkout 中用 `pnpm test:pr --files <本任务的路径...>`，不为了让检查通过而修改或纳入他人的改动。
- 代码改动运行 `pnpm typecheck` 和 `pnpm lint`。计划报告 `native: true` 时运行对应的原生检查。
- 安全、启动、loopback、模型、书籍和服务 E2E 测试不在自动检查中，需要时按需运行：`pnpm test:safety`、`pnpm test:startup`、`pnpm test:loopback`、`pnpm test:models`、`pnpm test:books`、`pnpm test:e2e --files <路径...>`。
- 新测试登记到 `tests/manifest.json` 并写明 `covers`；新源码或脚本文件在 `scripts/test-plan.mjs` 中映射到责任域。细则见 `.docs/testing-triggers.md`。
- 只改离线建库实验脚本（如 `scripts/experiment-soushen-search.mjs`）时，只验证改动的脚本，使用临时 SQLite 或隔离数据副本。只改提示词正文（`lib/reader-prompts.ts`、`lib/reader-legacy-prompts.ts` 及 `lib/reader-styles.ts` 的画风提示词）时，只运行 manifest 登记的直接消费者和完整性冒烟。两种情况若同时改动了正式流程、共享模块、迁移、提示词拼装或模型调用，按常规规则合并检查范围。

## 代码与界面

- 新增或修改的代码注释用中文。
- 修改 CLI 的命令、输入、行为或流程规则时，在同一变更中同步更新 `skills/shiqu/SKILL.md` 和受影响的使用示例。
- 生成、审核和修订的改进必须经正式制作流程上线。测试和评估工具调用与生产相同的实现，使用隔离数据，不另建功能流水线。
- 桌面 UI 用 `pnpm desktop:preview` 在应用内浏览器中开发和验证，复用已有标签页。
- 只有用户明确要求时才打包或构建桌面应用，日常验证不运行桌面准备或构建命令。
- 遇到 `.DS_Store`（含大小写变体）直接删除，不移走也不备份。

## 界面

- 流程中的操作放在所属流程框或步骤内，靠右对齐。修改后的确认、重试和错误提示紧跟所属步骤，不放到页面别处。
- 流程与任务清单行内的操作（如「开始制作」「继续制作」「重试」、查看、编辑）用文字链接：复用 `StoryFlowAction`（`story-flow-link`），深色画面加 `tone="dark"`，不另写链接样式，也不用大按钮（`yu-primary`）。页面主操作（如「新建故事」「准备故事」）、对话框中的确认与取消、切换类控件、图标按钮，以及设置表单自身的保存和测试仍用按钮。首次制作的「修改故事」面板里，「开始制作」是确认当前设置的主按钮（`yu-primary`）。桌面控制台沿用自身样式。
- 已有共用组件的界面复用该组件，不另写布局，例如制作步骤用 `ProductionTimelineRow`。具体屏幕的布局见 `.docs/development.md` 的「制作流程界面约定」。
- 空间不足时操作整组靠右换行；缺少内容的行或字段不占位。窄屏可缩短可见标签，无障碍名称保留完整名称和当前值。

## 书库与数据

- 绝不对用户书库运行迁移测试或破坏性探测，也不把旧备份直接恢复到使用中的目录。
- 访问书库前经正式数据库初始化调用 `ensureLibraryReady()`。历史表名只用于迁移、导入边界和显式的旧结构夹具。升级必须先有已校验的整库备份，保留其报告路径。
- 新的结构变化写成 `drizzle/` 迁移，同时更新 `db/library-format.json` 的 `latestMigration`。只有支持上一格式的应用必须拒绝新结果时才提高 `schemaVersion`。格式历史见 `.docs/development.md` 的「书库存储与格式兼容」。
- 阅读器 API 路径、Session 类型与模块以及 `session_id` 列保持不变。现行 `liaozhai` 种子行的来源地址和摘录保持为空。
- 用户授权修正书库中单篇已完成作品的标题、梗概等元数据时，若能安全直接改库，在一个事务中只改指定版本的必要字段：写入前核对当前版本、书库就绪状态和任务状态，保留可验证的回滚快照，不改动制作流程、版本、成图和任务完成记录；字段参与任务标识计算时在同一事务中同步关联，提交后读回确认。

## 导出作品

- 用户要求导出故事时，对运行中的应用执行 `pnpm export:story '<故事名或已下载的 ZIP>'`（默认 `http://localhost:3000`，用 `--url` 覆盖），默认保存到 `../awesome-shiqu/works/yysun`。不手工重建故事，不另写渲染器。
- 每篇只保留一个 ZIP。更新的作品替换原路径并保留文件名，即使标题已改；ZIP 输入的故事 ID 变化时，用 `--output` 指定原 ZIP。校验后删除临时文件和替换备份。
- 公开 ZIP 的结构以 `官渡之战.zip` 为准：保留原文和来源、作者及 AI 披露，不含提示词；生产导出的 WebP 保持原样，ZIP 输入不重新编码。
- 有画幅缺图时报告缺失，不省略画幅，也不改导旧版本。核对幅数、图片可读、ZIP 完整以及目标仓库解析器的兼容，并按该仓库的说明校验内容。
- 修改导出脚本时复用生产导出器的运行时，以及 ZIP、文件名、署名、WebP 哈希和 XMP 工具，不在脚本中另写一套。
- 保存导出不代表可以提交、推送或发布。

## 发布

- 发布由维护者决定。代理执行测试、准备签核请求，不填写签核结论、放行或批准。签核记录在 `.tests/release-<版本>/SUITE.md`，规则见 `.tests/TESTING.md`。
- 发布顺序：
  1. 在 `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 和 `src-tauri/Cargo.lock` 的 `shiqu-desktop` 中设置同一版本，更新 `CHANGELOG.md`；书库格式变化时补充用户指南的升级说明。提交到 `main` 并推送。
  2. 等 Main CI 通过；失败就修复、提交、再等。通过的提交即候选。
  3. 经维护者同意后，对候选手动运行 `desktop-release` 工作流取得安装包，并运行 `pnpm release:check`、`pnpm test:full`、`pnpm test:assurance`。
  4. 按 `.tests/changes/SUITE.md` 的「整理改动清单」补齐改动用例，执行签核范围内的用例并登记运行。执行者不得是实现该改动的会话；真实生成先征得维护者同意。
  5. 仍有未运行、INVALID 或构建带后缀的用例时继续测试。全部有结果后提交签核请求：先列失败、阻塞、待放行项、未执行分支和残余风险，再给一条随机选取、请维护者复核的已通过 P0 用例，最后列通过项和证据链接。
  6. 维护者在签核记录中为该候选提交写下发布结论后，执行 `git tag vX.Y.Z <候选>` 并推送标签（pre-push 会再跑 `release:check`）。
  7. 确认 `desktop-release` 与 `publish-npm` 都成功，核对发布页的安装包与 `SHA256SUMS.txt`，在签核记录中填写标签。
- 候选之后只允许 `.tests/` 的提交；其他改动产生新候选，签核范围内的用例重跑。
- 标签一经推送不得删除或重推。标签后的工作流失败时，修复后发布下一个补丁版本。
- 维护者明确要求跳过签核时，在签核记录中写明理由和要求人。
