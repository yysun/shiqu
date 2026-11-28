# CLI 启动并接入书库服务

CLI 通过书库锁关联的本机 URL 连接已有实例。书库空闲时自动启动只监听本机的短时服务。Skill 可在桌面继续运行时使用完整制作流程。保存命令与有限制作复用正式调度器，审片停点跨支持同一协议的服务重启保留。

阅读器把 CLI 保存或有限运行留下、正阻止排队工作的等待显示为「已保存，等待继续」，所属步骤提供「继续制作」，继续后解除等待；CLI 读取仍是原状态，`run` 直接推进。有故障或暂停时保留重试与恢复。

在线备份由持锁实例在空闲时验证并创建，跨库复制读取已就绪来源的只读快照。备份在有进行中的任务时拒绝。停止、重启和退出改为等候：停收新请求与新派发，中断执行中的 CLI 命令并取消可续跑的流式任务，等已领取的步骤保存后自行停止或退出；控制台提供「立即停止」与「立即退出」。托盘、控制台和 macOS ⌘Q 走同一流程，启动或书库维护期间的退出先等其结束再进入同一等候，只有「立即退出」强停；程序坞退出、注销、关机和 SIGTERM 立即释放。浏览器服务第一次 Ctrl-C 等候，npm/npx 转发的重复信号不计，再按一次立即停止。停服中断的 CLI `run --until completed` 在服务重启后按原授权续跑，`--until reviewed` 等有限运行、用户中断和超时保留停点，中断回执带 `resumesAfterRestart`。等候开始后才登记的可取消任务立即取消。桌面在控制台忙时保留重启意图、退出优先于重启，等候中服务以非零码退出时显示为失败。

## 验证

- 首轮：`pnpm test:changed` 与按故事范围的 `pnpm test:pr --files` 通过，影响计划 69 个文件 749 项通过、3 项跳过。[影响计划运行记录](../../../../../.data/test-plans/2026-11-28T00-43-50-234Z-b68389a1/run.json)；最终源码提交 `2fe83e3c` 的 10 项专门验收通过；macOS 27 项原生测试和隔离安装 npm 冒烟通过。
- 修正轮（`18241edc`、`0e12310f`、`7b3866f5`、`7d903cb8`）：`pnpm test:pr --files <故事文件>` 749 通过、3 跳过、0 失败；`pnpm test:loopback` 174/174，其中 [专门验收](../../../../../tests/cli-service.test.mjs) 12 项覆盖阅读器等待投影与继续、故障保留重试、停服中断 CLI `run`、桌面 stdin 等候与强制停止、浏览器服务 Ctrl-C；`pnpm test:startup` 206/206；Rust 原生测试 16/16（CI 的 `TAURI_CONFIG` 前端覆盖，跳过配置与安装包资源用例）；类型检查、lint、`cargo fmt --check` 通过。
- 停服交接轮（`3fe1f3c2`）：`pnpm test:pr --files <故事文件>` 750 通过、3 跳过、0 失败；`pnpm test:loopback` 173/174，唯一失败为 `tests/diagnostics.test.mjs` 在夹具选定端口上 `EADDRINUSE`，与本改动无关，单独重跑 5/5 通过；`pnpm test:startup` 206/206；Rust 原生 17/17，连续 5 次无失败；`tests/cli-service.test.mjs` 12/12 覆盖全量运行重启续跑、有限运行保留等待、迟到取消与等候中崩溃；`tests/desktop-console.test.mjs` 覆盖重启判定。
- 未执行：Windows 与 Linux 上的 JS 和原生运行、真实终端中的 npx 启动、已构建应用里的 ⌘Q 与退出监视线程、控制台「正在停止」界面的目视检查、经桌面重启（而非进程内重开）的续跑、真实付费生成。CI 的 Windows 原生作业只在 pull request 上运行 `cargo test --lib`，JS 用例只在 macOS 运行。

- 第三轮（`134de730`）：已通过校验并获准派发的全量运行才在停服后释放等待，校验前中断保留审片等待并返回 `INTERRUPTED`；立即停止、立即退出与第二次 Ctrl-C 中止进行中的模型请求；退出等候期间拒绝新维护，最终状态保留退出标记。`pnpm test:pr` 750 通过、3 跳过；`pnpm test:loopback` 175/175；`pnpm test:startup` 207/207；原生 17/17。CR 第 5 轮通过；这一轮的 VR 尚未运行，下方为上一轮的验收结果。

## 独立验收

AR passed: no blocking architecture flaws（停服交接 round 4, reused reviewer）。CR passed: no major findings（round 4, reused reviewer）。CR risk: non-low — the change alters process lifecycle across Node and Rust and changes when a CLI hold is released; the quit watcher and native Windows/Linux behaviour are verified only by reasoning.

VR round 2 at 3fe1f3c2: I re-checked the reopened stop criterion and it is complete, so I checked its box. All 10 REQ boxes are now checked. The REQ file is the only file I edited, and I made no commits.

**What the code and tests show for the stop criterion**
- **Quit during startup or library maintenance:** `quit()` in `src-tauri/src/lib.rs` sets `quit_pending`, waits for startup or maintenance to finish without holding the lock (`wait_until_ready`), then takes the same waiting stop as a normal quit. Only 「立即退出」 (force) stops at once. Rust test: `quit_waits_for_startup_or_maintenance_without_holding_the_lock`.
- **Full run resumes, limited run keeps its hold:** a stop now aborts CLI commands with a `service-stop` reason. In `server/headless-cli.ts`, a `--until completed` run then releases its hold and its receipt carries `resumesAfterRestart:true`. Limited runs, Ctrl-C and timeouts keep the hold. In `tests/cli-service.test.mjs`, the full run completes after restart with no manual step, and the `--until reviewed` run still holds and is not completed.
- **Late cancellable work:** in `server/app.ts`, work registered with a cancel callback after the wait began is cancelled right away. The same test checks this.
- **Restart intent and quit priority:** `restartStep` in `desktop/console-state.ts` keeps a pending restart while the console is busy and drops it while quitting. `start_refusal` refuses a start once `quit_pending` is set. Covered by `tests/desktop-console.test.mjs` and the Rust test.
- **Abnormal exit during the wait:** `server/desktop.ts` exits non-zero on `uncaughtException` or a failed stop. `settle_exit` records a failure unless the process exited cleanly after a wait. The desktop test's crash phase asserts a non-zero exit; a Rust test covers the failure record.
- **Docs:** CHANGELOG 0.18.0, `.docs/user-guide.md` and `skills/shiqu/SKILL.md` now say full runs resume after a stop and limited runs keep their hold. The other criteria are unaffected and their boxes stay checked.

**AP tasks**
- Every 「修正二：停服交接」 task is implemented in 3fe1f3c2.
- Its seven boxes are still unchecked in the plan. The owner needs to tick them; I may edit only the REQ.
- `.docs/done/2026/11/27/cli-service-discovery.md` has uncommitted changes.

**Residual risks**
- **Windows/Linux are unverified.** JavaScript tests in CI run only on macos-15. The windows-2022 job runs only on pull requests and only Rust unit tests. Nothing runs on Linux. Never run on Windows or Linux:
  - the detached auto-start;
  - the environment fingerprint check;
  - Ctrl-C through npx's `.cmd` wrapper;
  - the Windows tray quit;
  - the waiting stop.
- **No console force-quit during the maintenance wait:** while quit waits for startup or maintenance, the console shows startup progress and no 「立即退出」.
- **Not run at all:** a built app with the ⌘Q menu item, the Rust quit watcher thread, a visual check of the console 'stopping' UI, a real npx terminal launch, and real paid generation.
- **Restart test is in-process:** the "resumes after restart" test closes and restarts the service inside one process, not through a desktop restart.
- **Unrelated flaky test:** `tests/diagnostics.test.mjs` failed once in test:loopback with EADDRINUSE on a fixture-picked port.

VR passed: all acceptance criteria complete

## 说明

- 上一轮 VR 指出的维护期退出回归先由 `7d903cb8` 恢复为等待后退出，维护者审查后由 `3fe1f3c2` 改为等维护结束再进入等候停服。VR 第 2 轮提到的计划复选框已在交付时勾选。
- 阅读器投影等待时隐藏重新准备与继续自动修复，读者先继续即可；停服等候没有时限，由「立即停止」「立即退出」或第二次 Ctrl-C 兜底。
- 回执与解除等待分属两个事务，其间崩溃时故事保持等待，读者再次继续即可。
