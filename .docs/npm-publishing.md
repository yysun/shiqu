# npm release

The public package is **`@apprun/shiqu`**, with command **`shiqu`**. The checkout remains private; publish the generated tarball, which contains only the browser runtime and book resources.

## Build and verify

Use the versions pinned by `.nvmrc` and `package.json`:

```bash
nvm use
pnpm install --frozen-lockfile
pnpm run npm:check
pnpm build:npm
pnpm npm:smoke
```

`build:npm` creates `outputs/npm/package/` and `outputs/npm/apprun-shiqu-<version>.tgz`. The staged manifest derives its public name from root `publishConfig.name`, version/engines from the root manifest, and dependencies from the backend bundle's external imports. It has no development dependencies or install/build hooks. The book sources and their notices are included; `.env`, local databases/media, source maps, desktop resources, and checkout metadata are excluded. The build does not package Docker or the desktop app.

`npm:smoke` installs the actual tarball into a temporary directory using pnpm, then invokes the installed executable directly from an unrelated directory. It needs access to the npm registry or a populated pnpm store. It checks the packaged assets/book sources, HTTP/API, configuration, persistence after restart, desktop-compatible library discovery, first-run non-interactive errors, access boundaries, and clean shutdown without invoking a generation provider. Pass a tarball path to check a specific artifact:

```bash
pnpm npm:smoke /absolute/path/to/apprun-shiqu-0.5.0.tgz
```

Use `pnpm npm:smoke --offline` when the dependencies are already in the pnpm store.

## Publish

Set the intended release version in the root `package.json` and update `CHANGELOG.md`. For a shared CLI / desktop release, keep `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and the `shiqu-desktop` entry in `src-tauri/Cargo.lock` at the same version.

Commit the release changes and use the configured publication branch (pnpm defaults to `main`). The release command retains pnpm's clean-working-tree and branch checks, including for dry runs. Authenticate to npm with an account authorized to publish under `@apprun`, then use the local release command:

```bash
pnpm run npm:publish
```

It runs `npm:check` (typecheck, lint, startup/database tests, PTY tests and release-gate regressions), builds a fresh tarball, smoke-tests that exact tarball, then publishes it. Any failure stops the sequence before publication. The tarball path comes from the current package name/version; an older manually selected artifact is not reused. The checks use temporary databases/homes and fake provider keys, never the user's existing library or settings. Python 3.9+ is needed for real terminal tests on Linux/macOS; POSIX PTY tests are explicitly skipped on Windows.

To run only the checks, without building or publishing:

```bash
pnpm run npm:check
```

To perform the complete preparation and an npm publish dry run:

```bash
pnpm run npm:publish --dry-run
```

There is no hosted startup CI requirement. Package-name ownership, existing registry versions, and npm authentication remain the publisher's responsibility. Root `pnpm publish` is intentionally blocked by `private: true`; publishing the generated tarball directly bypasses this local release command. The consumer package contains no release/install hooks.

Consumer commands and configuration are in [the npm README](../npm/README.md), which becomes the release package's README. After publication, users can run `npx @apprun/shiqu` with Node 24; `pnpm dlx @apprun/shiqu` is an equivalent option for pnpm users. Library selection follows the shared desktop/CLI settings database, migrating a prior CLI directory JSON when needed, otherwise finding or asking. First provider setup saves a profile with hidden API-key input; `--configure` and `--reset-providers` manage the shared settings. Non-interactive fresh runs require an explicit library and complete provider environment (or read-only).
