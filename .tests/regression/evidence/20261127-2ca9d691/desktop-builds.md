# REGRESSION-C005 · 0.18.0 安装包构建与冒烟

候选 `2ca9d69138809e66cac1800eab821af2b73dbcaa`，版本 0.18.0。该提交的 [Main CI](https://github.com/yysun/shiqu/actions/runs/46077620570) 成功。手动运行 [Desktop release 46077863287](https://github.com/yysun/shiqu/actions/runs/46077863287)，确认事件为 `workflow_dispatch`，运行提交与候选完全一致，共享检查成功。

- [macOS arm64 作业](https://github.com/yysun/shiqu/actions/runs/46077863287/job/140770394760) 通过打包与运行时冒烟，上传 DMG。
- [Windows x64 作业](https://github.com/yysun/shiqu/actions/runs/46077863287/job/140770394814) 通过打包、NSIS 安装和已安装运行时冒烟，上传 EXE。
- 两个安装包从这次运行下载并分别计算 SHA-256。发布作业为 `skipped`，没有创建 GitHub Release。

| 安装包 | SHA-256 |
| --- | --- |
| shiqu-standard-macos-arm64.dmg | `e9647a51496c876da98c7b87c5a0ad1028b0ded2dd5f3bc7ab22cbef655f1dfc` |
| shiqu-standard-windows-x64-setup.exe | `9a7b9c077e72dfc15562eddfcfeb32de4a0deaa5b950aef7fe3c19553b5ad382` |
