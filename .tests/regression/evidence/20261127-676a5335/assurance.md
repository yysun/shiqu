# assurance

构建 `676a5335`。Node 24.22.1 和 Rust 1.93（适用时）。测试使用隔离数据和受控回执。退出码 0。 全套复跑通过，前一个提交登记的目录锁故障没有重现。

```text
$ node scripts/test-assurance.mjs safety startup loopback && pnpm desktop:test
ℹ tests 308
ℹ pass 308
$ cd src-tauri && cargo test --locked
test runtime::tests::exclusive_directory_lock_releases_with_owner ... ok
test result: ok. 27 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 5.94s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```
