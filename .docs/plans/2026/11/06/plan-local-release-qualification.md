# Local release qualification plan

Base: `c0b9ef6ffa521f5c5417764e11ae52a2e29155c5`. The test scheduler patch is already in the working tree. Keep unrelated concurrent files outside this change.

- [x] Point `release:check` at `pnpm test:pr --full`; reuse the existing tag snapshot, toolchain checks and cleanup. Keep the npm smoke and explicit release smoke commands.
- [x] On tag pushes, skip the JavaScript and Shared checks jobs in `desktop-macos.yml`. Only tags may build with skipped Shared checks; manual builds require successful Shared checks. Keep both platform artifact gates.
- [x] Exercise the real tag hook and full planner against a disposable Git remote. Include a failing file outside the old smoke subset. Verify workflow conditions and update developer instructions.
- [ ] Verify full selection, affected regression tests, static checks, and applicable native source checks. Reuse unchanged suite evidence and report any hosted validation that remains.
