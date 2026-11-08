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

`build:npm` creates `outputs/npm/package/` and `outputs/npm/apprun-shiqu-<version>.tgz`. The staged manifest derives its public name from root `publishConfig.name`, version/engines from the root manifest, and dependencies from the backend bundle's external imports. It has no development dependencies or install/build hooks. The book sources and their notices are included; `.env`, local databases/media, source maps, desktop resources, and checkout metadata are excluded. The build does not package the desktop app.

`npm:smoke` installs the actual tarball into a temporary directory using pnpm, then invokes the installed executable directly from an unrelated directory. It needs access to the npm registry or a populated pnpm store. It checks the packaged assets/book sources, HTTP/API, configuration, persistence after restart, desktop-compatible library discovery, first-run non-interactive errors, access boundaries, and clean shutdown without invoking a generation provider. Pass a tarball path to check a specific artifact:

```bash
pnpm npm:smoke /absolute/path/to/apprun-shiqu-0.9.0.tgz
```

Use `pnpm npm:smoke --offline` when the dependencies are already in the pnpm store.

## Publish from GitHub Actions

Set the intended release version in the root `package.json` and update `CHANGELOG.md`. For a shared CLI / desktop release, keep `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and the `shiqu-desktop` entry in `src-tauri/Cargo.lock` at the same version.

Once [the workflow](../.github/workflows/publish-npm.yml) is on GitHub, a maintainer can configure **Trusted publishing** in the npm settings for `@apprun/shiqu`. Select GitHub Actions, enter owner `yysun`, repository `shiqu`, and workflow filename `publish-npm.yml`. Leave the environment field blank and enable direct publishing with `npm publish`. Complete the first successful publish within two days of creating the binding. See [npm's setup instructions](https://docs.npmjs.com/trusted-publishers/).

Push a new `vX.Y.Z` tag from a checkout with the local pre-push hook installed. The hook runs the full regression, including Playwright, before Git transfers the tag. GitHub Actions checks the tag against the package version, builds and smoke-tests the CLI tarball, then publishes that same artifact with OIDC. The npm and desktop workflows run independently, so check both results for a shared release. After the first publish, verify `npm view @apprun/shiqu@X.Y.Z dist.integrity` against the SHA-512 digest of the tarball uploaded by the workflow.

## Publish locally

Commit the release changes and use the configured publication branch (pnpm defaults to `main`). The release command retains pnpm's clean-working-tree and branch checks, including for dry runs. Authenticate to npm with an account authorized to publish under `@apprun`, then use the local release command:

```bash
pnpm run npm:publish
```

It runs `npm:check` (typecheck, lint and seven critical smoke files), builds a fresh tarball, smoke-tests that exact tarball, then publishes it. The smoke selection covers one complete browser creation-to-reading flow, production recovery/replay, headless CLI/export/backup, CLI startup, system settings, settings faults and publication guards. Each selected file runs once. Exhaustive matrices, PTY onboarding, all-book scans and the remaining browser/CLI edge cases stay available through `pnpm test:full`; they no longer block every npm publication. Any smoke failure stops the sequence before publication. The tarball path comes from the current package name/version; an older manually selected artifact is not reused. The checks use temporary databases/homes and fake provider keys, never the user's existing library or settings. The full suite needs Python 3.9+ for terminal tests on Linux/macOS; POSIX PTY tests are explicitly skipped on Windows.

To run only the checks, without building or publishing:

```bash
pnpm run npm:check
```

To perform the complete preparation and an npm publish dry run:

```bash
pnpm run npm:publish --dry-run
```

Package-name ownership, existing registry versions, and npm authentication remain the local publisher's responsibility. Root `pnpm publish` is intentionally blocked by `private: true`; publishing the generated tarball directly bypasses this local release command. The consumer package contains no release/install hooks.

Consumer commands and configuration are in [the npm README](../npm/README.md), which becomes the release package's README. After publication, users can run `npx @apprun/shiqu` with Node 24; `pnpm dlx @apprun/shiqu` is an equivalent option for pnpm users. Library selection follows the shared desktop/CLI settings database, migrating a prior CLI directory JSON when needed, otherwise finding or asking. First provider setup saves a profile with hidden API-key input; `--configure` and `--reset-providers` manage the shared settings. Non-interactive fresh runs require an explicit library and complete provider environment (or read-only).
