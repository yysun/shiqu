# Publish Shiqu to npm from GitHub Actions

Publishing the CLI currently requires an interactive local npm session. A qualified version tag should also publish the CLI tarball through the repository's GitHub Actions identity.

- [ ] A new `vX.Y.Z` tag in `yysun/shiqu` can publish the matching `@apprun/shiqu` version through npm Trusted Publishing.
- [x] The build checks the tag against the package version and smoke-tests the exact tarball before the job with publish permission receives it.
- [x] The tag hook retains full regression coverage, including Playwright. GitHub Actions verifies the npm artifact and the existing desktop jobs verify the installers.
- [x] The release guide records the npm-side configuration and the first-release verification.

The workflow change does not itself create or push a release tag. The first criterion stays open until a future tag verifies live npm authentication and publication.
