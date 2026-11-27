# Command run 20261127T200650Z-STORY-LIFECYCLE-C066-R1

- Case: STORY-LIFECYCLE-C066
- Command: node --test --test-name-pattern=C066 tests/production-dag-runner.test.mjs tests/production-dag-scenarios.test.mjs
- Working directory (relative to the test root's workspace): .
- Started: 2026-11-27T20:06:50.239Z
- Finished: 2026-11-27T20:06:51.139Z
- Exit code: 1
- Result: FAIL

## stdout (last 40 lines)

```text
  + actual - expected

  + []
  - [
  -   23,
  -   24
  - ]

      at TestContext.<anonymous> (file:///Users/esun/Documents/Projects/shiqu-docker/tests/production-dag-scenarios.test.mjs:297:9)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: [],
    expected: [ 23, 24 ],
    operator: 'deepStrictEqual',
    diff: 'simple'
  }

test at tests/production-dag-scenarios.test.mjs:262:41
✖ C066: a visual source issue reports unchanged and waits (164.118333ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected

  + []
  - [
  -   23,
  -   24
  - ]

      at TestContext.<anonymous> (file:///Users/esun/Documents/Projects/shiqu-docker/tests/production-dag-scenarios.test.mjs:297:9)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: [],
    expected: [ 23, 24 ],
    operator: 'deepStrictEqual',
    diff: 'simple'
  }
```

## stderr (last 40 lines)

```text

```
