# npm publication from a tag

1. With the workflow on GitHub, configure Trusted Publishing for `yysun/shiqu` and `publish-npm.yml` with direct publish enabled.
2. Set a new version in the release commit and push its matching tag through the local pre-push hook. The npm build and package smoke must pass before the publish job runs.
3. Compare the uploaded tarball with the npm version's `dist.integrity`. Verify that the new version appears under `@apprun/shiqu`.
4. Locally execute the workflow's version validation with a matching and a mismatched tag. The mismatched tag must fail before dependency installation. Build and smoke-test a tarball, then pass that tarball to npm in dry-run mode.
