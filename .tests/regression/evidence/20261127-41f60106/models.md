# models

构建 `41f60106`。491 项通过，1 项失败。结构修订返回无变化后已停止派发，读者状态为「需要重新编排」。旧用例等待「上次修订没有实际变化」，在单独复现时也超时。后续提交同步测试断言，并保留停机、显式放行与请求重放的验证。

```text
ℹ tests 492
ℹ suites 0
ℹ pass 491
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 194515.222542

✖ failing tests:

test at tests/unified-story-review.e2e.mjs:109:1
✖ explicit draw-anyway remains marked, paused and idempotent at the count gate (15138.683791ms)
  AssertionError [ERR_ASSERTION]: Timed out waiting for controlled production work
      at until (file:///Users/esun/Documents/Projects/shiqu-docker/tests/fixtures/production-data.mjs:11:119)
      at async TestContext.<anonymous> (file:///Users/esun/Documents/Projects/shiqu-docker/tests/unified-story-review.e2e.mjs:112:19)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: false,
    expected: true,
    operator: '==',
    diff: 'simple'
  }
[ELIFECYCLE] Command failed with exit code 1.
```
