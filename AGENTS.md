# Project Instructions

## Package Manager

- 源码项目的依赖管理、开发脚本及相关文档示例使用 pnpm。面向发布包和已安装技能的使用说明默认采用 npx，不要求用户安装 pnpm；用户明确指定启动器时沿用其选择。
- Follow the pnpm version pinned in `package.json` (`packageManager`) and the Node version in `.nvmrc`.
- Use `pnpm install --frozen-lockfile` for reproducible installs, and `pnpm add` / `pnpm remove` to change dependencies.
- Run scripts with `pnpm run <script>` (for example, `pnpm run codex:login`) or shorthand such as `pnpm dev` and `pnpm test`.
- 源码开发中已安装的命令行工具使用 `pnpm exec`；发布包和已安装技能的调用遵循上述 npx 默认入口。
- Keep `pnpm-lock.yaml` in sync with dependency changes. Do not introduce npm or Yarn lockfiles.

## Agent Test Selection

- Run `nvm use` first; test entry points warn when the Node major version differs from `engines`.
- 仅调整离线建库实验脚本时（例如 `scripts/experiment-soushen-search.mjs`），本地验证以改动的脚本为范围，用临时 SQLite 或隔离数据副本执行受影响的命令。本条优先于下文的仓库级检查要求。涉及正式运行流程、共享模块或数据库迁移的改动，以及 CI 和发布验证，仍按常规规则执行。
- While iterating, run `pnpm test:related` (or `--files <paths...>`, `--plan`) or a single file directly with `node --test tests/<file>`. It runs changed registered non-browser test files plus direct importers (the test, its `tests/` fixtures or the client/desktop components they import), path-literal references and declared `covers` consumers with `cost: fast`; standard and heavy consumers are listed as deferred, and browser E2E is always deferred. A changed non-browser test file runs directly, with its full tier only when its declared cost is standard or heavy. It does not walk through `lib/`/`server/`, so it is not an impact check; an empty selection runs nothing and proves nothing.
- Before handing off or committing, run `pnpm test:changed` once for working-tree impact checks. Preview with `pnpm test:changed --plan` (or `--json`). It includes staged, unstaged and untracked paths. Production changes run suites from directly mapped domains plus exact `covers` consumers with full provider flags. Safety and startup assurance suites, including the integrity smoke, are manual-only: use `pnpm test:safety` and `pnpm test:startup`. Tests that bind or connect to a real local loopback listener are also manual-only: use `pnpm test:loopback`. Provider contracts and model-backed generation, review and storyboard flows are manual-only; use `pnpm test:models` (also available as `pnpm test:providers`). `pnpm test:assurance` runs the safety, startup and loopback groups plus native desktop tests. Book corpus checks are manual-only; run them with `pnpm test:books`. Map new source or script files to a domain in `scripts/test-plan.mjs`, since unmapped files retain the safety, startup and tooling fallback scope but manual-only tests are excluded from automatic execution.
- Keep Playwright E2E out of routine change checks and CI. Run selected service suites with `pnpm test:e2e --files <registered paths...>`; `pnpm test:e2e:extended` is an explicit on-demand runner for the six extended model flows. Book corpus checks are manual-only: `pnpm test:books`. Change plans, pre-push, CI, release gates and `pnpm test:full` exclude manual-only suites. The desktop responsive width, phone navigation, phone readability and remaining component/browser UI suites have been retired; the registry currently has no browser E2E suites. Loopback suites are excluded from automatic tag/CI gates and run with `pnpm test:loopback`. The local `v*` tag pre-push hook runs the focused non-loopback release gate. `pnpm test:full` runs all registered non-native automatic JavaScript tests.
- In a shared checkout, inspect the preview first. Use `pnpm test:pr --files <your changed paths...>` to scope verification to your own work; do not modify or include concurrent work merely to make a check pass.
- Register new test files and their covered sources (`covers`) in `tests/manifest.json`, including every `tests/fixtures/*` file reached from the test; the registry contract checks fixture ownership through `tests/` import edges. Declare all direct consumers before scoping a shared test fixture or stylesheet to specific tests. Tests that use a source path only as planner sample data may set `relatedPathLiterals: false`; keep their actual planner sources in `covers`. Shared schemas use their affected domains. Unknown paths, dependency or toolchain changes, and failed or empty change detection retain the conservative safety/startup/tooling scope and request native coverage; safety/startup tests remain on demand.
- Run `pnpm typecheck` and `pnpm lint` for code changes. Run applicable native source checks when the plan reports `native: true`; JS runner results alone do not prove native coverage. PR, main, and manual CI run affected JS suites. Tag CI verifies native installers.
- 仅调整提示词正文时（包括 `lib/reader-prompts.ts`、`lib/reader-legacy-prompts.ts` 和 `lib/reader-styles.ts` 的画风提示词），本地验证只跑 `tests/manifest.json` 登记的直接消费者及完整性冒烟。本条优先于仓库级影响检查要求。若同时改动提示词拼装、模型调用或其他代码，按这些改动的影响计划取并集。

## CLI 与技能同步

- 修改 CLI 命令、输入、行为或流程规则时，必须在同一次变更中同步更新内置的 `skills/shiqu/SKILL.md` 及受影响的使用示例，确保技能与 CLI 的实际帮助和生产行为一致。

## 代码注释

- 今后新增或修改的代码注释使用中文。

## Desktop Development

- Develop and verify the desktop UI in the in-app browser using `pnpm desktop:preview` (Vite). Reuse the relevant existing tab.
- Bundle or package the desktop application only when the user explicitly requests it. Do not run desktop preparation or build commands as routine verification; use local checks and browser verification instead.

## Repository Hygiene

- Delete `.DS_Store` files whenever encountered, including capitalization variants such as `.DS_store`. Do not move them aside or keep backups.

## Production Workflow

- Improvements to generation, review, or revision must ship through the production workflow; do not stop at an implementation that only works in an evaluation tool.
- Tests and evaluation tools must call the same workflow implementation as production. Use isolated data for verification, without maintaining a separate functional pipeline.

## Story Export

- When the user asks to output/export stories, default to ZIP archives saved in `../awesome-shiqu/works/yysun`.
- When the user names a story to export, run `pnpm export:story '<story name>'` against the running app (default `http://localhost:3000`, override with `--url`). The script reads the latest complete bookshelf revision through the app API, calls the production Node exporter, then verifies and saves the public archive in awesome-shiqu. No browser or Playwright is required. It also accepts an already downloaded ZIP. Do not manually reconstruct the story or create a separate renderer.
- Match the public structure of `官渡之战.zip`: `故事.json`, `分镜.md`, `署名与转载.txt`, and numbered WebP files under `图片/`, with no production/acceptance prompts, per-frame prompts, or internal prompt-history files. Preserve the production exporter's WebPs byte for byte during public conversion, including their visible signature/watermark and XMP metadata; the script verifies image hashes and metadata. ZIP-input mode must not re-encode images. Node and browser encoding need not produce identical bytes.
- Reuse the app's production Node export runtime and shared ZIP serialization, filename, credit, WebP hash and XMP helpers in export scripts. Image encoding and watermarking stay in the shared production exporters; do not maintain a second implementation of those rules in a script.
- Export the latest selected bookshelf revisions using the reader ZIP layout: `故事.json`, `分镜.md`, and all numbered WebP images under `图片/`. Include the saved original text and retain source, author, and AI disclosures.
- Require every selected frame to have an image for a complete export. Report missing frames instead of silently omitting them or exporting an older revision.
- Keep one ZIP per story in the output directory. For an updated work, replace its existing ZIP path and keep the filename to preserve sharing links, even if the story title changed. Use temporary backups during replacement, then remove temporary ZIPs and backups after verification; do not retain duplicate story exports elsewhere.
- Verify frame counts, image readability, ZIP integrity, and compatibility with the destination collection's archive parser. Follow that repository's instructions for content validation.
- Remove temporary exports/downloads and replacement backups after verification, retaining only the canonical story ZIP in the output directory. Story-name mode resolves existing archive IDs through the app's current-version API to preserve filenames across revisions and title changes. For ZIP-input mode with a changed story ID, use `--output` with the existing ZIP path.
- Saving exports does not authorize Git commits, pushes, or publication.

## Canonical Story Storage

- `stories` stores the current production model and every revision for every owner. `production_jobs`, `books` and the other support tables retain their separate responsibilities. Keep reader API paths, Session types/modules and `session_id` columns stable.
- 用户授权修正本地书库中单篇已完成作品的标题、梗概等元数据时，如果能安全地直接改库，优先在数据库事务中修改指定版本的必要字段。写入前核对当前版本、书库就绪状态和任务状态，保留可验证的回滚快照。保留原有制作流程、版本、成图和任务完成记录；如果字段参与任务标识计算，在同一事务中同步关联，提交后重新读回确认。
- Use `ensureLibraryReady()` through the production database initializer before accessing a library. Version checks precede ownership/diagnostic writes; desktop reads and mutations use the shared brief upgrade gate. Historical table names belong only to migration/import boundaries and explicit old-schema fixtures.
- Upgrades require a verified whole-library safety backup. Keep its reported path; pending-journal recovery finishes before access. Never run migration tests or destructive probes against the user's library, and never restore an old backup directly into an active directory.
- Later schema changes are ordinary `drizzle/` migrations that `ensureLibraryReady()` applies in place after a verified backup. Update `latestMigration` in `db/library-format.json` with each new migration so native reads wait for it, and bump `schemaVersion` only when apps that support the previous version must refuse the result.
- Consolidated libraries require desktop and CLI 0.8.0 or later. The `books_refuse_pre_consolidation_seed` trigger makes released 0.2–0.7 seeds abort with `BACKUP_APP_TOO_OLD`; keep the current `liaozhai` seed row's source URL and excerpt empty. Older binaries are incompatible; rollback requires the pre-upgrade backup and its matching application.
