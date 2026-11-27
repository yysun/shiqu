# release-check

构建 `676a5335`。Node 24.22.1 和 Rust 1.93（适用时）。测试使用隔离数据和受控回执。退出码 0。

```text
$ pnpm typecheck && pnpm lint && pnpm test:e2e --gate=release && cargo fmt --manifest-path src-tauri/Cargo.toml --check
$ tsc --noEmit
$ eslint .
$ node --experimental-strip-types scripts/test-story-e2e.mjs --gate=release
ℹ tests 15
ℹ pass 15
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
Story E2E PASS — .data/e2e/2026-11-27T21-45-13-420Z-398102fe
```
