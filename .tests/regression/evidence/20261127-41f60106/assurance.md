# assurance

构建 `41f60106`。安全、启动和 loopback 共 308 项通过。原生 26 项通过，1 项失败。随后同提交的失败用例单独复跑 1 项通过，仍需完整复跑。

```text
failures:

---- runtime::tests::exclusive_directory_lock_releases_with_owner stdout ----

thread 'runtime::tests::exclusive_directory_lock_releases_with_owner' (125072668) panicked at src/runtime.rs:605:31:
called `Result::unwrap()` on an `Err` value: "此数据目录已由另一个桌面实例使用。"
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace


failures:
    runtime::tests::exclusive_directory_lock_releases_with_owner

test result: FAILED. 26 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 5.44s

error: test failed, to rerun pass `--lib`
[ELIFECYCLE] Command failed with exit code 101.
[ELIFECYCLE] Command failed with exit code 101.
```
