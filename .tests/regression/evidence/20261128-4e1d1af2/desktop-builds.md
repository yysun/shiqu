# REGRESSION-C005 · 0.18.0 安装包构建与冒烟

`4e1d1af286d5e9f3d06a5c2a316a44913fa6ecd7` 通过 [Main CI](https://github.com/yysun/shiqu/actions/runs/46085191400)。[Desktop release 46085430409](https://github.com/yysun/shiqu/actions/runs/46085430409) 由 `workflow_dispatch` 触发，运行提交与该候选一致。共享检查和两平台构建均成功。

- [macOS arm64 作业](https://github.com/yysun/shiqu/actions/runs/46085430409/job/140794057293) 完成原生测试、打包与运行时冒烟，上传 DMG。
- [Windows x64 作业](https://github.com/yysun/shiqu/actions/runs/46085430409/job/140794057281) 完成原生测试、打包、NSIS 安装与已安装运行时冒烟，上传 EXE。
- 两个安装包均从该次运行下载，SHA-256 已在本地复核。发布作业跳过。

| 安装包 | SHA-256 |
| --- | --- |
| shiqu-standard-macos-arm64.dmg | `618db9533b1c647ad1aa3cc7367987e1fcd75186244cafcf33aa7dbfcd186ad1` |
| shiqu-standard-windows-x64-setup.exe | `56b7abd573350c4c914d79100d808cdf80325b08a972ba81a66bd1eea3f268eb` |

此运行只覆盖上述提交。后续横图和试印改动未打入这两个安装包。
