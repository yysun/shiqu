# npm release

The public package is **`@apprun/shiqu`**, with command **`shiqu`**. The checkout remains private; publish the generated tarball, which contains only the browser runtime and book resources.

## Build and verify

Use the versions pinned by `.nvmrc` and `package.json`:

```bash
nvm use
pnpm install --frozen-lockfile
pnpm build:npm
pnpm npm:smoke
```

`build:npm` creates `outputs/npm/package/` and `outputs/npm/apprun-shiqu-<version>.tgz`. The staged manifest derives its public name from root `publishConfig.name`, version/engines from the root manifest, and dependencies from the backend bundle's external imports. It has no development dependencies or install/build hooks. The book sources and their notices are included; `.env`, local databases/media, source maps, desktop resources, and checkout metadata are excluded. The build does not package Docker or the desktop app.

`npm:smoke` installs the actual tarball into a temporary directory using pnpm, then invokes the installed executable directly from an unrelated directory. It needs access to the npm registry or a populated pnpm store. It checks the packaged assets/book sources, HTTP/API, configuration, persistence after restart, access boundaries, and clean shutdown without invoking a generation provider. Pass a tarball path to check a specific artifact:

```bash
pnpm npm:smoke /absolute/path/to/apprun-shiqu-0.3.2.tgz
```

Use `pnpm npm:smoke --offline` when the dependencies are already in the pnpm store.

## Publish

Set the intended release version in the root `package.json`, rebuild, and rerun the smoke check. Authenticate to npm with an account authorized to publish under `@apprun`, then publish the reviewed tarball:

```bash
pnpm publish ./outputs/npm/apprun-shiqu-0.3.2.tgz --access public
```

Replace `0.3.2` with the actual release version. Package-name ownership, existing registry versions, and npm authentication must be checked by the publisher; this build does not upload anything. Root `pnpm publish` is intentionally blocked by `private: true`.

Consumer commands and configuration are in [the npm README](../npm/README.md), which becomes the release package's README. After publication, users can run `npx @apprun/shiqu` or `pnpm dlx @apprun/shiqu` with Node 24.
