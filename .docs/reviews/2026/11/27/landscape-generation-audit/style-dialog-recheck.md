# 横图画风弹窗复查

首次制作和另绘套图都使用项目现有的弹窗与画风卡片。原有三组共 15 个选项集中在弹窗内，当前画风和说明随选择更新，取消与确认固定在底部。旧式下拉框与新弹窗按相同视口和操作阶段等比例对照。 [前后对照 PDF](landscape-style-dialog-before-after.pdf)

| 入口和状态 | 复查结果 | 原始截图 |
| --- | --- | --- |
| 故事设置 · 另绘一套 · 390 × 844 | 三组卡片和确认按钮同屏。剪纸选中后，卡片有边框和勾，底部同步显示画风。 | [改前](after-compact-picker/mobile-redraw-default.jpg) · [改后](after-style-dialog/mobile-redraw-default.jpg) · [已选剪纸](after-style-dialog/mobile-redraw-paper-cut.jpg) |
| 作品与导出 · 首次制作 · 390 × 844 | 复用相同布局，默认沿用竖图画风。当前选择和确认位于底部。 | [改前](after-compact-picker/mobile-print-default.jpg) · [改后](after-style-dialog/mobile-print-default.jpg) |
| 故事设置 · 短屏 · 320 × 480 | 卡片内容高 348 CSS px，滚动区域高 233 CSS px。滚至剪纸卡片后，底部操作区下边缘仍在视口 y452。 | [改后](after-style-dialog/short-redraw.jpg) |
| 桌面侧栏 · 另绘一套 · 1280 × 800 | 15 张卡片和底部操作均可见。取消后焦点返还给「另绘一套横版插图」。 | [改前](after-compact-picker/desktop-redraw.jpg) · [改后](after-style-dialog/desktop-redraw.jpg) |

在两个移动端入口按 Escape，画风弹窗关闭，焦点返回原入口。提交剪纸后，剪纸套图以 0/4 进入生成，已完成的白描 4/4 仍在套图列表。打印入口确认默认白描后，首套横图以 0/4 进入生成。 [另绘提交](after-style-dialog/mobile-redraw-submitted.jpg) · [打印入口提交](after-style-dialog/mobile-print-submitted.jpg) · [测量与状态记录](after-style-dialog/measurements.json)

独立复查确认了手机弹窗、短屏布局和提交结果，桌面截图已在入场动画结束后重拍。类型检查、lint 和 170 项影响测试通过。浏览器使用隔离书库和受控绘图，实体手机、读屏及最终成图未验证。
