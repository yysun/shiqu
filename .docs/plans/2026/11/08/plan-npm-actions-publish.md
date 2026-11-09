# Publish Shiqu to npm from GitHub Actions

Base commit `03a2c22f2de753f66bfc1b3b1c23e0f9023fa3b6`.

- [x] Verify that the pinned Node distribution supplies an npm CLI with OIDC support. Node 24.22.1 bundles npm 11.19.1.
- [x] Add a tag-only workflow. Validate the version, install with pinned pnpm, and run the existing build and tarball smoke commands without npm write access.
- [x] Publish the uploaded artifact by ID from a separate job using npm OIDC. Keep the package's local release wrapper and desktop workflow in place.
- [x] Document the npm trust binding, tag qualification, and registry verification.
- [x] Validate the workflow and tag rejection, execute an isolated tarball build, smoke and npm dry run, and run the required repository impact checks. Actionlint, typecheck, lint, 804 affected JS cases, and 25 native source tests passed.

The local tag hook covers the browser gate. The workflow's authentication can only be verified when npm has the trust binding and GitHub runs a new release tag.

Implementation commit `35eb309`. CR passed with no major findings. VR remains open for the first hosted publish.
