# 候选故事就地核对

## 改动

索引查找先展示最多 50 篇候选。每行显示梗概、原文核对状态和主题贴合度，通过后可以立即选择。无索引时同一列表随着原文阅读追加候选。未设主题或按标题提取时显示核对状态。

实施提交 `5d66882`。评分与核对在同一次模型调用中返回。评分规则参与主题判断缓存键，各入口共享结果。旧回执缺少分数时保留原判定。

## 验证

隔离 Chrome 预览显示索引候选的 86% 和 24%，以及无索引候选的 79%。验证了 50 条候选初始显示、提前选择、保留中断状态和共用补核。类型检查、Lint 和 25 项原生源码检查通过。

影响测试执行 1,530 项，1,523 项通过。四项相关失败修复后在定向回归中通过，三项在基线 `5ede298` 上复现。三项为手动提取初始状态、章节进度事件和原文故事命名。预览使用受控模型回执。

## 验收

VR passed: all acceptance criteria complete.

The browser preview and controlled tests cover both discovery paths, per-story scores, early selection, and resume. Four impact failures passed after fixes. The remaining three reproduced on baseline `5ede298`.

VR risk: non-low — persisted shortlist and scoring compatibility.  
VR review round: 2; reviewer: reused.
