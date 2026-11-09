# 轻量书架交付

## 变更

书架使用摘要接口，阅读和制作设置打开单篇后再取完整会话。后台根据版本只应用变化的卡片和移除项。书架按版本家族计算可见成员，删除最新版本不会暴露历史版本。

## 验证

同一真实书库的 63 条故事，在应用内浏览器分别刷新三次。首屏卡片中位数 3001 → 383 毫秒，列表响应体 1919507 → 64888 字节。浏览器点开一篇后只请求一次详情并恢复到第 20 幅。空增量响应为 27 字节。详见 [验证记录](../../../../tests/test-lightweight-shelf.md)。

类型检查、lint、隔离生产构建、5 项浏览器回归、25 项 Rust 库测试通过。首轮影响计划的唯一失败是测试清单缺少摘要模块登记，修复后清单检查 4 项通过。

## 验收

VR passed: all acceptance criteria complete.

VR risk: non-low — owner and revision visibility, and concurrent reader and production state.  
VR review round: 1; reviewer: reused.

The 63-story benchmark showed median card-ready time falling from 3,001 ms to 383 ms and the list payload from 1,919,507 bytes to 64,888 bytes. The browser fetched one story detail only after selection and resumed at frame 20. An unchanged poll returned 27 bytes. Regression evidence covered revision visibility, deletion and restore, incremental updates, and stale detail responses.
