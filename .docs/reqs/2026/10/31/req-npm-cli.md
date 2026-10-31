# Publish 拾趣 as @apprun/shiqu

The desktop download and source checkout require installation steps that a Node user should not need. Ship the existing browser application as an npm CLI: install or execute one package, then open the local reader.

## Acceptance criteria

- [x] A release build produces a publishable `@apprun/shiqu` tarball with the `shiqu` executable, compiled reader/server, all 24 book sources, migrations, seed SQL, and license notices.
- [x] The installed CLI runs on Node 24 from an unrelated working directory without the checkout, pnpm, development dependencies, or a build at install time.
- [x] Default persistent data lives in a per-user application directory outside the package/cache and working directory; explicit data directories and environment configuration work.
- [x] Help/version, port, host, data-directory, and explicit env-file options are documented; invalid options and unsupported Node versions fail clearly before opening the library.
- [x] Packed-package verification covers real HTTP assets/API, bundled-book integrity, persistent writes and restart, graceful termination, and exclusion of private/build/development files.
- [x] Publishing and consumer commands are documented. No registry publication, Docker build, desktop packaging, paid generation, or unrelated edits occur.

The package name is explicitly selected by the user. Node 24 and the existing provider requirements remain. The CLI opens a browser-served app, not a native desktop window. Bind to loopback by default; LAN access requires an explicit host. Desktop settings/credentials are not imported. Existing source, Docker, and desktop entry points retain their behavior.
