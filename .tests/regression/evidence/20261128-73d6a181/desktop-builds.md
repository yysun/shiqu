# REGRESSION-C005 · 0.18.0 双平台候选安装包

候选 `73d6a18149c351155945d302c2aad2e981de7117`，版本 0.18.0。[Main CI](https://github.com/yysun/shiqu/actions/runs/46106885926) 已通过。[Desktop release 46107013543](https://github.com/yysun/shiqu/actions/runs/46107013543) 的运行提交与候选一致，2026-11-28T04:34:17Z 完成，结果为成功。

- [macOS arm64 构建](https://github.com/yysun/shiqu/actions/runs/46107013543/job/140862250894) 通过原生检查、打包和运行时冒烟，并上传 DMG。
- [Windows x64 构建](https://github.com/yysun/shiqu/actions/runs/46107013543/job/140862250883) 通过原生检查、打包、NSIS 安装与已安装运行时冒烟，并上传 EXE。
- 两个安装包从该运行下载，SHA-256 已在本地计算并复核。事件为 `workflow_dispatch`，[发布作业](https://github.com/yysun/shiqu/actions/runs/46107013543/job/140865496154) 跳过，远端无 `v0.18.0` 标签。
- macOS 包内正式 CLI 和桌面控制通道另验证了同一进程、在线快照和常规停服。[包内共享服务](../../../changes/evidence/20261128-73d6a181/packaged-shared-service.md)

| 安装包 | SHA-256 |
| --- | --- |
| shiqu-standard-macos-arm64.dmg | `2ac0163b10e049475c6c78688d5dd6548dea667dac962ff30206b656357c82ed` |
| shiqu-standard-windows-x64-setup.exe | `29deca29d615b8f3773eea43e5d9b334140c7af6b75bdb17781efb61735ae7b3` |
