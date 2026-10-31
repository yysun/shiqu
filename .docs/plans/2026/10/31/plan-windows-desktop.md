# Windows desktop distribution

Story base: `cc662b282652b4fc1d8c3d0938eaaaf62e832461`.

Existing work: README is modified; `.docs/development.md` and `.docs/user-guide.md` are untracked user work. Preserve it and limit changes there to Windows guidance. Scope includes only the Windows README delta, not the earlier rewrite.

Use the existing workflow as one release coordinator with native macOS arm64 and Windows x64 jobs. NSIS installs per user; its bootstrapper obtains WebView2 when missing. Both Windows editions use Gemini because the current Codex runner deliberately rejects Windows.

- [x] First SS probe: validate the Windows Tauri config against the installed CLI schema and inspect commands/test assumptions for native Windows. Stop dependent changes if NSIS configuration or runtime staging cannot support the native target.
- [x] Add automatic Windows Tauri configuration and adapt native regression tests to exercise supported Windows settings and path behavior.
- [x] Extend the release workflow with a Windows native build/test/install/smoke job, stable EXE names, and one publisher requiring all four assets. Keep the full JavaScript suite on macOS; Windows runs desktop/runtime suites because Codex CLI fixtures use Unix executables.
- [x] Update README, desktop README, and the existing user guide's Windows claims; document prerequisites, unsigned installation, provider limitation, Node paths, build commands, and publication timing.
- [x] Run local JavaScript tests, typecheck, lint, Rust format/native Lite tests where available, schema/workflow validation, and independent CR. No local desktop preparation or packaging.

Validation: `.docs/tests/test-windows-desktop.md`. Windows CI performs actual installer checks, while local review validates workflow structure and runtime contracts. Local macOS evidence cannot certify Windows execution. Current pinned tooling and Tauri docs support NSIS and native Windows x64; pinned Node staging already handles node.exe. Risk: native platform tooling and installer behavior still require the first Windows CI run. Release failures must leave a draft rather than publish partial downloads.


AR risk: non-low — native Windows packaging and coordinated release publication.
AR review round: 1; reviewer: new.
AR passed: no blocking architecture flaws.

SS probe passed: both Windows editions validate against the installed Tauri 2.12.4 CLI schema (Ajv, Unicode regexp mode disabled for Tauri's schema patterns). Tauri source confirms automatic platform config merging. Windows test assumptions were corrected for temp paths, Codex availability, and canonical executable paths. actions/node-versions copies the full official Windows archive, including LICENSE.

Implementation milestone: `cbc71e8` (`feat(desktop): add Windows x64 installer pipeline`). Verification at commit: schema/YAML/Bash parse checks, typecheck, lint, Rust format and 17 macOS native Lite tests passed. Full JavaScript test run pending at commit. README/user-guide work remains uncommitted to preserve preexisting user changes; desktop documentation is also in the working diff.


CR risk: non-low — native installer packaging and release coordination.
CR review round: 1; reviewer: reused.
CR passed: no major findings.

Review covered the complete committed implementation plus Windows-only README/user-guide deltas. Confirmed NSIS argument ordering, configuration merge/edition isolation, checked PowerShell native exits, official Node LICENSE staging, and the four-asset publisher gate. The subsequent desktop-doc clarification distinguishes bundled Node from WebView2 downloads.

Concurrent npm/CLI work appeared during verification (`package.json`, `server/index.ts`, npm/CLI files and their story documents). It is excluded from this story and was not staged or changed here.


TT: complete for the applicable local environment. Node 24.22.1 / pnpm 11.25.0: 567/567 JavaScript tests passed with `pnpm exec node --experimental-strip-types --test --test-concurrency=2 tests/*.test.mjs`. Default concurrency passed 566/567, timing out in the unchanged eighty-frame intake test; that suite passed 14/14 independently and the bounded full rerun passed. The first sandboxed run could not bind test servers; successful runs used loopback-enabled execution. `pnpm typecheck`, `pnpm lint`, `cargo fmt --manifest-path src-tauri/Cargo.toml --check`, and 17 native Lite tests passed. Native Lite test invocation used `TAURI_CONFIG` from `src-tauri/tauri.lite.conf.json`, so absent Standard Node resources were not required. No resources were prepared and no package was built locally.

ET: scenario 1 passed by schema/YAML/Bash parsing and independent automation review. Native Windows install/smoke (scenario 2) awaits the Windows CI job. Live publication (scenario 3) was reviewed structurally and not executed. Local Markdown link checks and `git diff --check` passed.

VR incomplete: native Windows installer/runtime execution remains pending CI. Implementation, release-gate configuration, documentation, local checks and CR are complete. Acceptance criteria for produced Windows installers and executed native Windows CI remain unchecked until the first native job supplies evidence; this task did not push, publish, or package locally.


GC: the user requested a commit. Stage only Windows guidance in the tracked README, desktop documentation, and this story's records. Preserve the existing README rewrite/new guides, screenshot changes and npm/CLI work. Native Windows evidence remains pending; no code was changed during this documentation delivery, so existing CR and verification conclusions remain applicable.
