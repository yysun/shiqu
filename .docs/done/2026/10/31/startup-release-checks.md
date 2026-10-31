# Startup configuration and local npm release checks

## Summary

Add automated startup configuration, PTY and SQLite recovery coverage, then run it locally before npm publication. The final flow is `pnpm run npm:check` for validation only, or `pnpm run npm:publish` for checks → fresh tarball build → exact-artifact smoke test → publication. The hosted startup workflow is removed.

## Verification

Node 24.22.1 / pnpm 11.25.0 on macOS. Current `npm:check` passed typecheck/lint, 126 startup/database cases, six Python PTY flows and six release-gate regression tests. The complete regression suite passed 701 cases before the release wrapper was added; the six new wrapper tests passed afterward. Documentation links and diff checks passed. Publication/build/smoke ordering and failure paths use a fake runner and a disposable tarball; no actual publish or new package build was run.

CR passed: no major findings

CR risk: low — local release orchestration; runtime and storage behavior are unchanged.
CR review round: 1; reviewer: not applicable.

## Notes

Startup matrix/PTY milestone: `76f7a2e`. This delivery preserves that commit and removes its hosted workflow following the user's correction. Tests never open or copy the existing user database. No release/install hook is added to the consumer package. Direct tarball publication bypasses the local release wrapper, as documented. Windows/Linux native runtime, native GUI, real API access and registry publication remain unverified. Earlier README, screenshot and other story-document changes remain outside this commit.

## Final acceptance result (verbatim)

1. **Complete — Startup configuration matrix.** The committed table-driven tests cover saved/explicit provider and key combinations, flags/environment/config-file precedence, first-use behavior and library discovery. The current local startup suite passed 126 cases.
2. **Complete — Automated terminal flows.** The checked-in Python PTY suite passed all six flows: fresh provider setup/restart, configure before library selection, library cancellation, credential/model cancellation, key retention/switching/reset, and invalid or missing setup input.
3. **Complete — Database safety and recovery.** Temporary fixtures cover lock timeouts, failed writes, permission denial, migration rollback and abrupt termination after uncommitted migration DDL. Tests use isolated homes, fake keys and generated databases; the existing user settings/library database was neither opened nor modified.
4. **Complete — Local pre-publish gate.** `npm:check` runs typecheck, lint, startup/database tests, PTY tests and six release-gate tests. `npm:publish` runs that gate before building and smoke-testing the exact fresh tarball, then publishing. Regression tests prove failures stop publication and dry-run mode reaches only a mocked publish runner.
5. **Complete — Final delivery scope and documentation.** The hosted startup workflow is removed at the user's request. Release/testing instructions describe the local commands, isolation and platform limits. Existing README/screenshot work is excluded from this delivery. No registry publication, hosted run, Docker/desktop packaging or push was performed.

VR passed: all acceptance criteria complete

VR risk: low — isolated tests and local release orchestration; application storage/runtime behavior is unchanged.
VR review round: 1; reviewer: not applicable.
