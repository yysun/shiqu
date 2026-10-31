# Installed npm CLI scenarios

1. Build with pinned Node 24.22.1 and pnpm 11.25.0. Inspect the actual tarball: name/version/bin/engines are correct, runtime dependencies are declared, original-book bytes and license notices match, and no private state, checkout symlinks, source maps, development sources, or install scripts are included.
2. Install the tarball with production dependencies into a fresh temporary directory outside the checkout. Run the installed bin from a different directory with spaces in its name. `--help` and `--version` succeed without creating data; unknown flags, missing arguments, invalid ports, and unsupported Node versions fail clearly without creating data.
3. Start with a free local port and an explicit fresh data directory. GET the reader and one compiled browser asset, books, empty shelf, reader status, and progress. Resolve all 24 bundled books using installed resources. Confirm no paid generation occurs and no files appear in the caller or package directories.
4. Reject foreign Host/Origin requests using the existing access middleware. Create a draft via the API, terminate with SIGTERM, restart against the same data directory, and confirm the saved draft survives. Confirm normal exit and immediate port reuse.
5. Exercise explicit env-file loading and CLI precedence over environment. Confirm default OS user-data directory selection and loopback host, and that relative data/env paths resolve against the caller rather than the installed package.

Automated CLI unit coverage checks argument/configuration cases and OS paths. The npm smoke command verifies the tarball and installed HTTP/persistence lifecycle. No Docker or native desktop packaging is part of this run.
