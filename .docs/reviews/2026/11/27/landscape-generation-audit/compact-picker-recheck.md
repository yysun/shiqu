# 横图画风选择复查

此记录保留当时的下拉框基线。当前界面见[卡片弹窗复查](style-dialog-recheck.md)。

**已解决。** 故事设置和打印缺图共用一个分组下拉框。三组共 15 个预设，打开时用竖版画风作默认。说明只跟随当前选项，3D 和黏土定格另提示输出静态画面。取消和确认沿用步骤内靠右的文字链接。 [前后对照 PDF](landscape-picker-before-after.pdf)

| 入口 | 核对结果 | 等比例原图 |
| --- | --- | --- |
| 故事设置 · 另绘一套 | 390 × 844 时，完整表单高 103.8 CSS px。切换剪纸后仍同时看到选择和确认。确认后新增剪纸 0/4 套图，原白描 4/4 继续显示。 | [修改前](after/mobile-picker-open.jpg) · [修改后](after-compact-picker/mobile-redraw-default.jpg) · [剪纸已选](after-compact-picker/mobile-redraw-paper-cut.jpg) · [提交后](after-compact-picker/mobile-redraw-submitted.jpg) |
| 打印缺图 · 开始制作 | 390 × 844 时，完整表单高 121.8 CSS px。直接确认默认白描后，实际状态为生成中 0/4。 | [修改前](after/mobile-print-picker.jpg) · [修改后](after-compact-picker/mobile-print-default.jpg) · [提交后](after-compact-picker/mobile-print-submitted.jpg) |
| 桌面侧栏 · 另绘一套 | 1280 × 800 时下拉框可见并获得焦点，取消及确认留在同一步。 | [修改后](after-compact-picker/desktop-redraw.jpg) |

分组、选中项下方的说明及位置经过独立复核。前后沿用同一视口和对应状态，面板打开后的滚动位置各依实际界面。两个窄屏入口现在只展示一个 44 CSS px 高的下拉控件，已移除原先表单内部的画风滚动区。 [实际测量](after-compact-picker/measurements.json)

验证使用隔离书库及受控绘图。类型检查和 lint 通过，横图专项 4 项、任务范围影响检查 170 项通过。此次核查覆盖浏览器窄屏提交、入队和旧套图保留。实体手机的原生选单呈现、读屏与最终成图未验证。
