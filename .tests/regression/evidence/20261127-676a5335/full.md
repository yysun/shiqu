# full

构建 `676a5335`。753 项通过，默认略过需显式历史标签的 3 项，另用 0.14.0 基线执行迁移与备份套件，28 项通过。另用 v0.17.0 标签隔离检出通过逐字节 ZIP/手改保留对照，无新生成。退出码 0。

```text
$ pnpm test:e2e --gate=full
$ node --experimental-strip-types scripts/test-story-e2e.mjs --gate=full
✔ C066: a missing local repair instruction does not mask the stalled frame-specific issues (42.172833ms)
✔ C066: a visual source issue repairs the affected prompts and re-reviews (5760.323667ms)
✔ C066: a visual source issue reports unchanged and waits (384.937375ms)
ℹ tests 756
ℹ pass 753
ℹ fail 0
ℹ cancelled 0
ℹ skipped 3
Story E2E PASS — .data/e2e/2026-11-27T21-45-24-273Z-6eeae921
```
