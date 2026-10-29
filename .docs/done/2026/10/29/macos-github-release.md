# Apple Silicon GitHub releases

## Summary

Replace the three-platform desktop workflow with `Desktop macOS`, building unsigned Standard and Lite DMGs on native Apple Silicon runners. Stable `vX.Y.Z` tags must match the application versions. Both builds must pass before the workflow uploads the installers and SHA-256 checksums to a draft and publishes it. Manual runs and matching pull requests upload test artifacts only.

README downloads use fixed asset names under `/releases/latest/download/`. Desktop documentation covers versioning, tag-based release commands, unsigned-app installation, and resuming a failed draft. Published downloads are never overwritten. Only the release job receives `contents: write`; no Apple credentials are required.

## Verification

- `pnpm lint` and `pnpm typecheck` passed using Node 24.22.1 and pnpm 11.25.0 during implementation.
- actionlint 1.7.7 passed for the final workflow; all embedded shell blocks passed Bash syntax checks and ShellCheck.
- Thirteen focused checks passed: Apple Silicon-only edition matrix, tag-only publishing after both builds, token permissions, accepted/mismatched/prerelease versions, manual/PR branch handling, architecture rejection, installer naming and README URLs, missing/ambiguous installers, checksum verification, missing editions, draft-before-upload ordering, draft resumption/published-release refusal, and upload-failure publication prevention. Release API calls were mocked; temporary fixtures were removed.
- CR passed: no major findings. CR risk: low — localized workflow and documentation changes. CR review round: 1; reviewer: not applicable.
- Existing verification remains applicable to the unchanged workflow. Final delivery stages only release-related documentation hunks and preserves the unrelated README rewrite, preview documentation, and application changes.

## Final VR

VR passed: all acceptance criteria complete.

- Complete: only Apple Silicon macOS builds are configured; Standard and Lite each produce an unsigned DMG.
- Complete: matching stable tags trigger builds and publish only after both builds and the asset checks succeed; manual and PR runs cannot publish.
- Complete: both README download URLs match the stable filenames uploaded by the workflow, with latest-release/checksum navigation and unsigned-installation guidance.
- Complete: release permissions, checksums, partial-upload handling, and version/tag instructions are covered by the reviewed configuration and focused checks.

VR risk: low — localized, reversible release configuration and documentation; no application behavior changes or external publication in this task.
VR review round: 1; reviewer: not applicable.

## Notes

This delivery verifies pipeline setup, not a completed hosted build or release. No desktop/Docker builds, native application launch, GitHub workflow dispatch, tag creation, push, or publication were performed. Download links become live after the first successful published release. Unsigned, unnotarized apps may require approval in macOS Privacy & Security. Intel, Windows, Linux, and prerelease tags are outside scope.

Base commit: `04af02a`. The delivery commit excludes all earlier unrelated changes, including the broader README rewrite and desktop preview paragraph.
