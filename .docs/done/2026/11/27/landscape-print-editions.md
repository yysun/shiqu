# 横图套图与试印

## 变更

- 首次绘制和另绘整套各自选择画风。横图重试沿用原套绘图输入，仅重绘竖图可继续使用原套横图。
- 故事设置显示各套横图，包括暂停和未画齐的套图。已暂停的套图收尾后可删除，随后可换画风另绘。
- 横版和 Letter PDF 可按套导出，历史套图使用保存的分镜，未完成套图可在原位置保留配文和缺图占位。默认选最新的完整套图。

## 验证

- 共享检出范围检查覆盖 60 个测试文件。716 项通过，3 项按条件跳过。类型检查和 lint 通过，macOS 原生 27 项通过。 [影响检查记录](../../../../../.data/test-plans/2026-11-28T02-48-29-451Z-d9bcf79c/run.json)
- 10 项横图专项测试通过。独立复核修正了同版分镜更新后的历史标记，以及没有排队任务的旧暂停套图。 [专项测试](../../../../../.data/landscape-editions-focused.log)
- 应用内浏览器用隔离书库验证首次选水彩、另绘水墨，从「作品与导出」下载缺第 2、4 幅的 Letter 试印稿。四页 PDF 的正文正面为第 1、3 幅，反面保留第 2、4 幅配文和缺图占位。 [试印文件](../../../../../.data/landscape-editions-pdf/browser-letter-preview.pdf)
- 《画壁》隔离复现同时显示水彩 4/4 和暂停水墨 1/4，可确认删除水墨并另绘剪纸 4/4。打印仍可选择水彩或剪纸。验证使用受控绘图，真实成图画风和纸张打印待实测。

## 独立复核

CR fixed: both findings resolved; rerun result passed.  
CR risk: non-low — historical print accuracy and discard concurrency.  
CR review round: 2; reviewer: reused.

VR passed: all acceptance criteria complete.  
VR risk: non-low — suite persistence and exact printing across revisions.  
VR review round: 1; reviewer: reused.
