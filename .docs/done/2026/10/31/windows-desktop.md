# Windows desktop distribution

## Summary

Added automatic Windows x64 NSIS configuration for Standard/Lite and a native Windows build/install/smoke job to the existing desktop workflow. The single publisher now requires two DMGs and two EXEs with SHA-256 checksums. Windows continues to use Gemini; existing Codex rejection is preserved. Updated README, desktop build/release documentation, and the existing user guide's Windows guidance without replacing prior edits.

Implementation commit: `cbc71e8` (`feat(desktop): add Windows x64 installer pipeline`). The follow-up documentation commit includes the Windows README changes separately from the user's preexisting README rewrite, plus desktop documentation and this story's records. The new user/development guides and screenshot work remain outside this commit.

## Verification

- 567/567 JavaScript tests passed with two workers. The default run's unrelated eighty-frame intake timeout passed both independently (14/14 suite) and in the bounded full run.
- 17/17 native Lite tests passed on macOS with the Lite `TAURI_CONFIG`; typecheck, lint, Rust formatting, installed Tauri schema checks, workflow YAML/Bash parsing and local documentation link checks passed.
- CR risk: non-low — native installer packaging and release coordination.
- CR review round: 1; reviewer: reused.
- CR passed: no major findings.

VR incomplete: native Windows installer/runtime execution remains pending CI. Implementation, release-gate configuration, documentation, local checks and CR are complete. Acceptance criteria for produced Windows installers and executed native Windows CI remain unchecked until the first native job supplies evidence; this task did not push, publish, or package locally.

## Notes

The Windows job installs each edition to a path with spaces and smoke-tests its installed runtime before collecting artifacts. These checks have been configured and reviewed, not observed on Windows. Windows download links activate only when a release containing this workflow succeeds. No paid model requests, dependency changes, Docker images, desktop preparation, local desktop bundles, pushes or release publication were performed. Concurrent npm/CLI work is excluded and preserved.
