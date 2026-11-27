# 清理无法使用的旧书库备份

默认目录中可识别、缺少归属记录的旧升级快照可以手动确认后删除，清单内容损坏时也能清理。控制台显示选中的实际路径和回退提醒。服务在锁内重新核对已知回退来源、共享目录、使用状态和确认身份。

## 验证

- 桌面预览以模拟 Tauri 接口验证了真实 React 确认框、焦点、取消、Esc、删除请求和受保护行。
- 隔离维护入口验证了损坏快照、活动回退引用、共享目录别名、快照占用、归属变动与同路径替换。
- 影响范围测试 248 项通过，3 项既有条件跳过。27 项 macOS 原生测试通过，类型检查和 lint 通过。
- 真实书库与备份未改动。未生成新安装包，0.18.0 发布仍暂停。

## VR

VR passed: all acceptance criteria complete. The isolated suite verified deletion and rollback protection. The desktop preview used a mock Tauri bridge to verify the visible path, origin warning, cancellation, and confirmation request. Affected tests reported 248 passes and 3 existing skips. Native tests reported 27 passes. Typecheck and lint passed. The 0.18.0 release remains paused.

VR risk: non-low — irreversible deletion and rollback dependencies.
VR review round: 1; reviewer: reused.

## 本机试用后的清理重试

实际试用留下了部分清理的 `.deleted-…` 目录。旧构建没有记录系统错误码。后续提交 `9f0e9383` 在原锁内重试并核对目录是否消失，清理失败时报告剩余目录或归属文件。

三项定向回归、243 项影响范围测试、27 项 macOS 原生测试、类型检查和 lint 通过。三个既有条件用例跳过。安装包通过隔离烟测，且内置运行时清理了包含 4,608 个文件的临时备份并正确保护登记的回退备份。用户机器上已有的残留仅只读定位。
