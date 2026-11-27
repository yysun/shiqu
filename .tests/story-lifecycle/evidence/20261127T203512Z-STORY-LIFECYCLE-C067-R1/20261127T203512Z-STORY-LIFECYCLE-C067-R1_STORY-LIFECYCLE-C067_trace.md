# Command run 20261127T203512Z-STORY-LIFECYCLE-C067-R1

- Case: STORY-LIFECYCLE-C067
- Command: node --test --test-name-pattern=C067 tests/production-reader-exit-flows.test.mjs
- Working directory (relative to the test root's workspace): .
- Started: 2026-11-27T20:35:12.781Z
- Finished: 2026-11-27T20:35:13.421Z
- Exit code: 1
- Result: FAIL

## stdout (last 40 lines)

```text
✖ C067: saved frame estimates are read-only until review, repair and portrait drawing settle (187.66725ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 613.907625

✖ failing tests:

test at tests/production-reader-exit-flows.test.mjs:144:1
✖ C067: saved frame estimates are read-only until review, repair and portrait drawing settle (187.66725ms)
  AssertionError [ERR_ASSERTION]: review 拒绝旧页面发出的更新请求

  200 !== 409

      at verifyReadOnly (file:///Users/esun/Documents/Projects/shiqu-docker/tests/production-reader-exit-flows.test.mjs:171:10)
      at async TestContext.<anonymous> (file:///Users/esun/Documents/Projects/shiqu-docker/tests/production-reader-exit-flows.test.mjs:185:3)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 200,
    expected: 409,
    operator: 'strictEqual',
    diff: 'simple'
  }
```

## stderr (last 40 lines)

```text

```
