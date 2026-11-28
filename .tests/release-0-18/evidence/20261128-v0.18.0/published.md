# 拾趣 0.18.0 发布核对

远端标签 `v0.18.0` 指向已签发的 `73d6a18149c351155945d302c2aad2e981de7117`。标签推送前在隔离检出通过发布门禁，15 项通过、0 项失败。

## 桌面安装包

[桌面发布工作流](https://github.com/yysun/shiqu/actions/runs/46108573227) 成功。[GitHub 公开发布页](https://github.com/yysun/shiqu/releases/tag/v0.18.0) 于 2026-11-28T04:53:06Z 发布。两个安装包及 `SHA256SUMS.txt` 从公开发布页下载，`shasum -a 256 -c SHA256SUMS.txt` 两项均通过。

| 公开安装包 | SHA-256 |
| --- | --- |
| shiqu-standard-macos-arm64.dmg | `8e596e5d08de5781b5c98c3f3355bf8e2da1b6bd93985b5eec98b1e5dd9eb102` |
| shiqu-standard-windows-x64-setup.exe | `0f1d468a831c3ea479d09f8f03b21d4e7a0c4faa2aaa400b90874512b635aa90` |

## npm

[npm 发布工作流](https://github.com/yysun/shiqu/actions/runs/46108573109) 于 2026-11-28T04:41:14Z 完成，结果为成功。[发布日志](https://github.com/yysun/shiqu/actions/runs/46108573109/job/140867021090) 返回 `+ @apprun/shiqu@0.18.0`。下载该工作流提交给 registry 的 tarball，核对包名及版本，SHA-1 `7e74c312b590159946eeed216746ebe9c70ab8e6` 与发布日志一致。

截至公开发布核对时，独立读取公共 npm Registry 的精确版本仍返回 404。外部索引可见性未确认。

工作流构件完整性为 `sha512-coAwnzqOs7qd2xGwHEbRZ2R+LSOgfXVvZIXATnulkw63iiQNwU3UBkBU2EQnGFmTc8oQJ4Ib8OzTJ9vr0kbBUg==`。
