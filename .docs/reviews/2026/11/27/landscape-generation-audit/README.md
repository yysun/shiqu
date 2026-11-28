# 横图生成界面审核

本报告保留 `014b48b5` 的审核与修复证据。之后的画风弹窗见[弹窗复查](style-dialog-recheck.md)，最终交付见[横图交付记录](../../../../../done/2026/11/27/landscape-set-management.md)。

## 结论

**需要修订。** 暂停和已完成的两套图已经能同时看见，但「恢复生成」紧跟在已完成的套图下面，视觉归属与实际目标不同。两条记录的盒子也紧贴在一起，时间折成第二行，加重了逐项核对的负担。先把生成控制归到对应套图，再提高状态和进度的可读性。

范围为「故事设置 → 横版插图」、打印缺图时的制作入口，以及能否在打印界面认出完整套图和试印状态。主任务是辨认暂停套图，决定恢复、删除或另选画风重画，并能识别可继续打印的完整套图。证据包括用户提供的 843 × 384 裁图，以及在本地提交 `abf09d74` 上用隔离书库复现的视图。桌面为 1280 × 800，窄屏为 390 × 844，均为 CSS 像素、设备像素比 1。真实书库仅使用用户提供的截图。

## 优先修复

### F1 · 重要 · 「恢复生成」和「暂停生成」脱离所属套图

- **观察。** 暂停套图下面是「删除未完成套图」，然后是完整套图，最后才是「恢复生成」。桌面和窄屏上，删除链接盒与完整套图盒之间都相接，完整套图盒与恢复链接盒也相接。运行中同样由完整套图隔开「暂停生成」与正在生成的套图。删除确认展开时，恢复链接仍位于完整套图之后。隔离库实点「恢复生成」，原暂停的套图从 1/22 继续至 22/22，说明视觉位置与操作目标不同。 [用户截图](baseline/paused-supplied.jpg) · [桌面位置](baseline/desktop-paused.jpg) · [窄屏位置](baseline/mobile-paused.jpg) · [运行中](baseline/mobile-running.jpg) · [窄屏测量](baseline/mobile-paused.measurements.json) · [删除展开](baseline/mobile-delete.jpg) · [操作复查](baseline/live-checks.json)
- **规则与影响。** 相关内容和自己的操作应靠在一起，套图之间的间距应大于同一套图内部的间距。当前读者必须通过卡片标题推断底部操作的归属。同画风、不同时间的套图使判断尤其依赖排列。实际误判次数未知。
- **改法与复查。** 把恢复或暂停移入对应套图行并靠右，仅在允许删除的状态下并列删除链接。给套图行之间留出清楚的间距。桌面与窄屏都用同画风的两套图复查，完整行应只显示自身信息。同一操作行继续使用现有文字链接。

### F2 · 次要 · 进度和时间挤在同一行，套图信息对比偏低

- **观察。** 「白描连环画 · 已暂停 1/22 幅」和完整套图的对应文字都以 12 px、400 字重显示，跟着精确到秒的日期。两种宽度下时间都折到下一行。暂停卡片中的套图文字为 `#718064`，背景为 `#ECEFE3`，由浏览器实际颜色计算为 **3.62∶1**，低于 Playbook 对多数正文采用的 4.5∶1 基准。同卡片标题和操作链接分别为 5.06∶1 与 5.09∶1。 [窄屏](baseline/mobile-paused.jpg) · [桌面测量](baseline/desktop-paused.measurements.json)
- **规则与影响。** 决策需要的状态和进度应容易扫读，日期应提供辨识线索。视觉层级弱且对比偏低，在同画风套图中尤其容易漏看 1/22 与 22/22 的区别。覆盖同一套图列表的各行，使用频率未知。
- **改法与复查。** 让「已暂停 1/22 幅」「已完成 22/22 幅」与画风构成主信息，用现有高对比文字样式。日期放入单独的元数据区，保留完整时间以区分同画风套图。窄屏优先让整段时间一起到下一行，复测套图文字与实际底色的对比。

### F3 · 次要 · 删除确认使用了普通绿色操作样式

- **观察。** 确认在选中行内出现，解释这套图会从制作和打印列表移除。「取消」在左，确认在右。两个动作和普通「恢复生成」共用绿色下划线样式。确认文字只写「确认删除」。桌面测得三者均为 12 px、400 字重，颜色均为 `#526B43`。桌面用 Enter 展开后，下一次 Tab 到「取消」，取消后的下一次 Tab 回到原删除入口。 [桌面确认](baseline/desktop-delete.jpg) · [窄屏确认](baseline/mobile-delete.jpg) · [确认控件测量](baseline/desktop-delete.measurements.json) · [键盘复查](baseline/live-checks.json)
- **规则与影响。** 删除的后果应由具体标签和可辨认的强调共同传达。这里已有二次确认和清楚的退出路径，主要缺口是最终动作缺少危险提示。实际误删未观测。
- **改法与复查。** 继续在套图行内确认，沿用左取消、右确认。用项目现有危险色区分「确认删除这套横图」的文字链接。键盘复查确认与取消都可达，恢复链接维持常规样式。

### F4 · 次要 · 打开画风选择时确认被推到首屏外

- **观察。** 窄屏从「另绘一套横版插图」打开后直接展开 15 项。表单高约 440 px，确认链接上缘在视口底部以下约 205 px。已有选择在摘要中可见，选中的卡片和确认仍需下滚。打印入口的展开截图也看不到确认，未测该入口的偏移。 [刚打开](baseline/mobile-picker-open.jpg) · [滚至确认](baseline/mobile-picker-end.jpg) · [打印入口展开](baseline/mobile-print-picker.jpg) · [测量](baseline/mobile-picker.measurements.json)
- **规则与影响。** 决定输入的控件和确认动作应容易一起找到。15 项按类别排列，选项可以直接选择；沿用默认画风时仍需下滚到列表末尾。
- **改法与复查。** 先让打开表单后的滚动位置对准画风标题和已选摘要，再在同一步骤内调整确认区的位置，使它与画风列表一同可见。保留现有选项分组、已选反馈及直接选择。用同一滚动起点验证沿用默认、选择水彩和取消三条路径。

## 组件核对

以 UXPeak《The UI/UX Playbook》目录为检查范围，并查看原书关于邻近分组、文字对比和删除确认的示例。下表记录可直接核对的结果。

| 区域与状态 | 检查 | 所见与结果 |
| --- | --- | --- |
| 故事设置时间线，桌面与窄屏 | 共享对齐与边界 | 通过。横图标题、说明沿同一左边缘，状态框使该阶段可辨。桌面侧栏从上方步骤进入，滚动后可完整查看横图区。 [桌面入口](baseline/desktop-paused-entry.jpg) · [桌面滚动后](baseline/desktop-paused.jpg) · [窄屏](baseline/mobile-paused.jpg) |
| 横图标题，运行、暂停、失败 | 不依赖颜色的状态线索 | 通过。标题状态文字与运行、暂停、失败图标互相印证。 [运行中](baseline/mobile-running.jpg) · [暂停](baseline/mobile-paused.jpg) · [失败](baseline/mobile-failed-detail.jpg) |
| 横图步骤，首次与已完成 | 当前条件及下一步 | 通过。首次有尺寸和用途说明，已完成提示可打印，动作分别写「生成横版插图」与「另绘一套横版插图」。 [首次](baseline/mobile-empty.jpg) · [已完成](baseline/mobile-completed.jpg) |
| 跟随错误的恢复操作 | 告知受影响幅号并保留恢复路径 | 通过。失败区显示已保存 3/4、待重试第 2 幅和恢复操作。受控错误覆盖绘图失败这一种。 [失败](baseline/mobile-failed-detail.jpg) |
| 套图列表，展开和收起 | 分组、动作归属和信息层级 | 未通过。采样中两套处于展开状态，名称、状态、时间均有文字，但对应关系和可读性见 F1、F2。 [两套展开](baseline/mobile-paused.jpg) · [一套收起](baseline/mobile-completed.jpg) |
| 删除确认，桌面与窄屏 | 指明后果和安全退出 | 通过。后果放在选中套图内，可取消，排列次序明确。 [窄屏确认](baseline/mobile-delete.jpg) |
| 删除确认，桌面与窄屏 | 最终动作的破坏性提示 | 未通过。文字样式与常规动作相同，见 F3。 [桌面确认](baseline/desktop-delete.jpg) |
| 画风卡片，窄屏 | 选择线索与输入反馈 | 通过。分组、已选文字、实测单选状态及卡片边界共同表达选择。从白描切换水彩后界面即时更新。打印入口截图中选中项还带对勾，故事设置截图主要以边框强调，两处均有选中文字。 [故事设置](baseline/mobile-picker-end.jpg) · [打印入口](baseline/mobile-print-picker.jpg) · [选择复查](baseline/live-checks.json) |
| 画风表单，两个入口 | 首屏和确认位置 | 未通过。首次打开后确认需要继续下滚，见 F4。 [故事设置](baseline/mobile-picker-open.jpg) · [打印恢复](baseline/mobile-print-picker.jpg) |
| 打印缺图提示，窄屏 | 恢复入口贴近所影响的格式 | 通过。「缺 4 幅横图」和「开始制作横图」同排显示，位于横版和 Letter 入口上方。 [初始恢复](baseline/mobile-print-recovery.jpg) |
| 打印套图选择，窄屏 | 完整和暂停的输出状态可辨 | 通过。横版和 Letter 的入口均打开选择界面，默认选水彩 4/4。在 Letter 切到暂停水墨 1/4 后显示缺图说明，仅可选已保存的第 1 幅作封面，主操作变为「导出试印稿」。此处核对到确认界面。 [横版完整](baseline/mobile-print-complete.jpg) · [Letter 暂停](baseline/mobile-print-draft.jpg) · [状态记录](baseline/mobile-print-state.json) |
| 键盘与触控 | 到达确认及真实设备操作 | 桌面确认的 Enter、Tab 和取消已验证。暂停卡内两个操作的 CSS 实测高度均为 26 px，窄屏可见且未裁切。屏幕阅读器、系统放大、实体手机点击与其他键盘路径未测。 [键盘复查](baseline/live-checks.json) · [窄屏测量](baseline/mobile-paused.measurements.json) |
| 外围样式与系统状态 | 额外主题、图片质感与服务异常 | 深色阅读末页、跨版本旧分镜、画幅正收尾、服务不可用和请求断线未采集。图片裁切、支付与账户模式不适用于此卡片。 |

## 证据索引

| 视图 | 状态和锚点 | 原始截图 |
| --- | --- | --- |
| 用户裁图 | 暂停与已完成套图。原视口和比例未知，文件 843 × 384 | [用户图](baseline/paused-supplied.jpg) |
| 桌面 1280 × 800 | 书架和故事设置入口、滚至套图、行内删除确认 | [进入](baseline/desktop-paused-entry.jpg) · [暂停](baseline/desktop-paused.jpg) · [确认](baseline/desktop-delete.jpg) |
| 窄屏 390 × 844 | 故事设置下半区，同画风的暂停与完成、删除和恢复后的进度 | [暂停](baseline/mobile-paused.jpg) · [确认](baseline/mobile-delete.jpg) · [恢复后](baseline/mobile-running.jpg) |
| 窄屏 390 × 844 | 首次和已完成、失败从上方至恢复操作 | [首次](baseline/mobile-empty.jpg) · [完成](baseline/mobile-completed.jpg) · [失败入口](baseline/mobile-failed.jpg) · [失败详情](baseline/mobile-failed-detail.jpg) |
| 窄屏 390 × 844 | 整套重绘时刚打开及滚至确认，打印缺图提示与展开选画风 | [打开选画风](baseline/mobile-picker-open.jpg) · [确认](baseline/mobile-picker-end.jpg) · [打印缺图](baseline/mobile-print-recovery.jpg) · [打印选画风](baseline/mobile-print-picker.jpg) |
| 窄屏 390 × 844 | 打印确认，完整套图默认选中，暂停套图输出试印稿 | [横版完整默认](baseline/mobile-print-complete.jpg) · [Letter 暂停试印](baseline/mobile-print-draft.jpg) |

浏览器图片由拾趣真实界面渲染，模型回执和故事是隔离夹具。保留截图原始尺寸。审阅只覆盖上述状态。用户误判的频率仍需通过实际使用观察。未生成状态实点横版入口后出现缺图恢复；该状态下 Letter 入口的实际点击反馈未单独走查。本次打印复核停在导出确认，未重新下载文件。

## 修订复查

代码为 `014b48b5`，与前一轮相同的视口和交互状态配对。桌面书架多了一篇「参考竖图缺失」的隔离样本，对照图按横图步骤裁取。 [前后对照 PDF](landscape-before-after.pdf)

| 项目 | 结果 | 核对依据 |
| --- | --- | --- |
| F1 操作归属 | 已解决 | 两种宽度下，暂停、恢复与重试都位于相应套图。套图之间的盒间距实测为 8 px。「横图套图」直接显示单套和多套，完整套图可在本行删除。 [桌面](after/desktop-paused.jpg) · [窄屏](after/mobile-paused.jpg) · [生成中](after/mobile-running.jpg) · [缺图重试](after/mobile-failed-detail.jpg) · [桌面测量](after/desktop-paused.measurements.json) · [窄屏测量](after/mobile-paused.measurements.json) |
| F2 状态、幅数与时间 | 已解决 | 状态和幅数加重并放在首行，时间独立显示。暂停状态中元数据与底色实测为 5.06∶1，核心进度为 7.24∶1。 [修订后](after/mobile-paused.jpg) |
| F3 删除确认 | 已解决 | 「确认删除这套横图」以危险色呈现，取消仍在左侧。实际验证可删除完整旧套并保留暂停套，删掉唯一的完整套图后打印入口提示「缺 4 幅横图」。 [窄屏确认](after/mobile-delete.jpg) · [桌面确认](after/desktop-delete.jpg) · [确认测量](after/mobile-delete.measurements.json) · [单套直显](after/mobile-completed.jpg) · [删完后的打印入口](after/mobile-print-after-delete.jpg) |
| F4 画风确认位置 | 已解决 | 窄屏从故事设置和打印打开时，所选摘要和确认同屏，确认底部分别在 y808.2 和 y807.9。在完整样本的整套重绘面板选到剪纸并取消。在另一篇首次生成样本上选剪纸、确认并看到套图入队。 [故事设置](after/mobile-picker-open.jpg) · [打印入口](after/mobile-print-picker.jpg) · [底部选择](after/mobile-picker-selected.jpg) · [提交后](after/mobile-picker-confirmed.jpg) · [设置测量](after/mobile-picker.measurements.json) · [打印测量](after/mobile-print-picker.measurements.json) |

单套已完成且参考竖图缺失时，错误和重新核对仍可在横图步骤内读到。 [错误恢复](after/mobile-missing-reference.jpg) · [浏览器操作记录](after/live-checks.json)

复查覆盖上述视口、状态和受控工作。屏幕阅读器、实体手机和实际纸张验证仍未执行。关于“当前界面是否太复杂”，见[横图生成界面简化审核](complexity-audit.md)。

## 独立复核

独立审阅人先查看 15 张原始截图、4 份布局测量与规则目录，独立给出判断，再核对报告。主次顺序保持一致。按复核意见补充删除展开时的操作归属证据，并把画风建议收窄到滚动锚点与确认位置。随后复核了两张新增的打印截图及状态记录，确认可辨识完整套图和暂停试印。原书示例、现场键盘操作和受控流程走查由主审完成。

## 编号说明

| 编号 | 含义 |
| --- | --- |
| F1 | 恢复和暂停脱离所属套图 |
| F2 | 套图状态、进度及时间的可读性 |
| F3 | 删除确认与普通链接样式相同 |
| F4 | 画风确认在打开后落在首屏之外 |
