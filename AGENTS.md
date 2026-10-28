# Project Instructions

## Package Manager

- Use pnpm for dependency management, scripts, documentation examples, and Docker setup.
- Follow the pnpm version pinned in `package.json` (`packageManager`) and the Node version in `.nvmrc`.
- Use `pnpm install --frozen-lockfile` for reproducible installs, and `pnpm add` / `pnpm remove` to change dependencies.
- Run scripts with `pnpm run <script>` (for example, `pnpm run codex:login`) or shorthand such as `pnpm dev` and `pnpm test`.
- Use `pnpm exec` for installed command-line tools instead of `npx`.
- Keep `pnpm-lock.yaml` in sync with dependency changes. Do not introduce npm or Yarn lockfiles.

## Docker Builds

- Build or package Docker images only when the user explicitly requests it.
- Do not automatically build Docker images after code changes or as part of routine verification. Use the applicable local checks instead.
