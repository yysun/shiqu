# 拾趣首次制作 · 界面设计复审

## 结论

修复前需要调整，修复后满足本次抽查范围的设计预期。验收要求最后一项与开工按钮间缺少组间留白，这是上次复审漏查的布局问题。各设置页的底部操作区现与上方内容组留 16 CSS px。窄屏选材从书籍、检索方式到候选与准备动作，制作确认从原文到设置再到开工。四个设置页共用右对齐的操作区和实色主按钮。

**F2 · 次要问题，多个设置页重复，高置信度。** 原复审核对了右对齐与主次层级，漏掉最后一项内容和整个操作区之间的边界。验收要求的最后一项折叠标题与「开始制作」的框相接，按钮容易被读成上方内容的附属操作。制作要求、叙事详略和准备阶段也缺少独立组间留白。按内容分组应有留白（WS01，24–25）、重复间距按角色保持节奏（WS03，27–28）以及用邻近关系区分所属组（PX01，12），给首次制作的共用底部操作区增加 16 CSS px。右对齐、控件尺寸和状态均在浏览器中复测。 [验收要求间距修复前](initial-production-before-spacing/10-acceptance-requirements.jpg) · [间距修复后](initial-production-after/10-acceptance-requirements.jpg)

**F1 · 次要问题，四页重复，高置信度。** 首次制作的「修改故事」面板底部用实色主按钮「开始制作」，复用准备阶段「保存设置」的组件样式和右侧对齐。制作要求与叙事详略页的「按当前要求重新准备」仍是次要链接。外层「制作确认」步骤里的同名操作沿用流程链接。原样式容易让读者漏看开工确认，这是视觉判断，尚无用户行为数据。规则为主次动作按任务重要性区分（VH01，印刷页 6–7）、同角色跨屏一致（CS02，39–40）、主动作靠近影响结果的设置（IC09，106–107）。[画风面板底部修复前](initial-production-before/13-art-style-footer.jpg) · [修复后](initial-production-after/13-art-style-footer.jpg)

## 方法与范围

用 `audit-ui-design` 复核 UXPeak《The UI/UX Playbook》。先检查布局、间距、分组和对齐，再检查主次层级，最后复核文字、颜色与组件状态。通过应用内浏览器走实际入口，以隔离书库的《庄子》样本和固定回执复现。首轮修复前为 `c566d274`，修复后为本地变更。间距补查以实色按钮已上线到本地预览的版本作基线。主题主路径与面板为 390 × 844 CSS px，章节和故事目录分支为 1280 × 720 CSS px。每对截图视口和显示比例相同。默认截图在清除焦点后采集，键盘示例专门保留焦点。运行时计时、滚动条与生成阶段提示可能有自然差异。

## 逐屏证据

| 屏幕或状态 | 规则与观察 | 修复前 | 修复后 |
|---|---|---|---|
| 选书 | LY02 信息先于动作（31），先显示书名，再显示检索方式；PX01 相关内容靠近（12），标题和书籍网格成组。通过。 | [选书](initial-production-before/01-book.jpg) | [选书](initial-production-after/01-book.jpg) |
| 按主题 | AL01 共同对齐线（16–17），检索标题与主题区左边缘一致；VH01 主动作和选项分层（6–7），主题用可选项，未满足条件的「准备故事」置灰。通过。 | [按主题](initial-production-before/02-theme.jpg) | [按主题](initial-production-after/02-theme.jpg) |
| 查找中 | CL01 状态与下一步清楚（13），等待反馈靠近检索结果与底部动作；CO04 状态用文字表达（69），可见查找进度和取消入口。通过。 | [查找中](initial-production-before/03-search.jpg) | [查找中](initial-production-after/03-search.jpg) |
| 候选已选 | LY03 选项提供比较线索（32），勾选、书名与梗概同组；VH01 主次动作分层（6–7），实色准备按钮与行内「查看原文」形成区分。通过。 | [候选](initial-production-before/04-candidates.jpg) | [候选](initial-production-after/04-candidates.jpg) |
| 准备中 | LY02 按制作顺序呈现（31），选原文之后才准备建议；PX01 操作贴近所属步骤（12），设置、等待和暂停集中在活动步骤。通过。 | [准备中](initial-production-before/05-preparing.jpg) | [准备中](initial-production-after/05-preparing.jpg) |
| 准备阶段编辑 | WS03 控件间距保持节奏（27–28），底部组间距见 F2。VH01 保存为唯一实色操作（6–7），等待建议、留空、预览和展开各有次要层级。 | [保存设置](initial-production-before/06-preparing-editor.jpg) | [保存设置](initial-production-after/06-preparing-editor.jpg) |
| 外层制作确认 | AL03 同类动作右对齐（18–19），四个设置链接集中在所属步骤，尾端与「开始制作」对齐；CS02 相同角色用相同样式（39–40），行内「开始制作」为透明底、无边框、下划线。通过。 | [确认时间线](initial-production-before/07-confirmation.jpg) | [确认时间线](initial-production-after/07-confirmation.jpg) |
| 查看原文 | PX01 把来源与正文归组（12）；TY05 以段落和小标题区分原文及补充信息（80–81）。通过。 | [原文](initial-production-before/08-original.jpg) | [原文](initial-production-after/08-original.jpg) |
| 制作要求 | AL01 编辑器和操作尾端用共同右缘（16–17）；VH01 确认应高于重新准备链接（6–7）。修复前不通过，修复后通过。组间距见 F2。 | [制作要求](initial-production-before/09-production-requirements.jpg) | [制作要求](initial-production-after/09-production-requirements.jpg) |
| 验收要求 | PX01 标签靠近所属输入框（12）；VH01 面板应有明确的主动作（6–7）。修复前层级不通过，修复后通过。组间距见 F2。 | [验收要求](initial-production-before/10-acceptance-requirements.jpg) | [验收要求](initial-production-after/10-acceptance-requirements.jpg) |
| 叙事详略 | LY03 选项附解释（32）；CO04 勾选表明当前值（69）；VH01 确认应高于重新准备链接（6–7）。修复前层级不通过，修复后通过。组间距见 F2。 | [叙事详略](initial-production-before/11-narrative-detail.jpg) | [叙事详略](initial-production-after/11-narrative-detail.jpg) |
| 画风选项 | WS01 分组之间留白（24–25），分类标题和卡片产生稳定节奏；CO04 选中态有勾选（69）。通过。 | [画风上部](initial-production-before/12-art-style-top.jpg) | [画风上部](initial-production-after/12-art-style-top.jpg) |
| 画风面板底部 | IC09 主动作紧邻影响结果的设置（106–107）；VH01 单一主动作应可辨认（6–7）。主按钮复用 132 × 48 CSS px，右缘为 361 CSS px，与底部操作组一致。修复前层级不通过，修复后通过。组间距见 F2。 | [画风底部](initial-production-before/13-art-style-footer.jpg) | [画风底部](initial-production-after/13-art-style-footer.jpg) |
| 键盘焦点 | CT01 聚焦应清楚可辨（20–21）。Tab 聚焦后有 2 CSS px 实线焦点环，空格在新按钮上启动制作；前后常态截图均已清焦。通过。 | [焦点对照](initial-production-before/14-art-style-keyboard.jpg) | [焦点对照](initial-production-after/14-art-style-keyboard.jpg) |
| 分镜运行 | CL01 状态和当前步骤清楚（13）；CO04 用文字与状态来表达执行中（69）。通过。 | [启动分镜](initial-production-before/15-storyboard-running.jpg) | [启动分镜](initial-production-after/15-storyboard-running.jpg) |
| 制作完成 | VH05 关键结果在步骤中可扫读（11），分镜数量与绘图完成数归入相应行；CO04 完成包含状态文字和勾选（69）。通过。 | [制作完成](initial-production-before/16-completed.jpg) | [制作完成](initial-production-after/16-completed.jpg) |
| 按章节 | PX01 筛选与章节列表相邻（12）；AL01 勾选和原文操作在同一行使用各自对齐线（16–17）。通过。 | [章节列表](initial-production-before/17-chapter-mode.jpg) | [章节列表](initial-production-after/17-chapter-mode.jpg) |
| 按故事空态 | CL01 给出当前状态和准备条件（13）；BP16 空态应帮助下一步（135–136），同区可切换检索方式，样本明确表示暂无可选故事。通过。 | [故事目录空态](initial-production-before/18-story-mode.jpg) | [故事目录空态](initial-production-after/18-story-mode.jpg) |

## 补查 · 内容与底部操作区

滚至页尾，先检查最后一项是否在视觉上归于设置内容，再分别量内容组下缘到操作组上缘、最后可见文字块下缘到主按钮上缘。验收要求按折叠与展开两个状态复测。距离为浏览器元素边界读数，单位为 CSS px。修复前列为主按钮已改、组间距尚未修复的版本。

| 组件或状态 | 规则与观察 | 结果 | 同尺度证据 |
|---|---|---|---|
| 验收要求，最后一项折叠 · 390 × 844 | WS01 内容和操作应有清楚的组间留白（24–25）。最后的折叠标题到按钮 0 → 16。 | 修复前不通过，修复后通过 | [前](initial-production-before-spacing/10-acceptance-requirements.jpg) · [后](initial-production-after/10-acceptance-requirements.jpg) |
| 制作要求、叙事详略 · 390 × 844 | PX01 用距离表达归属（12）。重新准备说明到整个操作组 0 → 16，次要链接和主操作仍在同一组。 | 修复前不通过，修复后通过 | [制作要求前](initial-production-before-spacing/09-production-requirements.jpg) · [后](initial-production-after/09-production-requirements.jpg) · [叙事详略前](initial-production-before-spacing/11-narrative-detail.jpg) · [后](initial-production-after/11-narrative-detail.jpg) |
| 准备阶段的保存设置 · 390 × 844 | WS03 相同位置使用一致组间距（27–28）。提示词区下缘到保存操作组 0 → 16。 | 修复前不通过，修复后通过 | [前](initial-production-before-spacing/06-preparing-editor.jpg) · [后](initial-production-after/06-preparing-editor.jpg) |
| 画风提示词底部 · 390 × 844 | WS03 保留字段组内部节奏（27–28）。内容组下缘到操作组 0 → 16，说明文字到按钮 12 → 28，其中 12 来自字段原有留白。 | 修复后通过 | [前](initial-production-before-spacing/13-art-style-footer.jpg) · [后](initial-production-after/13-art-style-footer.jpg) |
| 验收要求，最后一项折叠 · 320 × 720 | WS02 在实际尺寸检查拥挤与滚动（26）。最后一个标题到按钮 0 → 16，页尾可完整显示按钮。 | 修复前不通过，修复后通过 | [前](initial-production-before-spacing/acceptance-320-collapsed.jpg) · [后](initial-production-after-spacing/acceptance-320-collapsed.jpg) |
| 验收要求，最后一项展开 · 320 × 720 | WS02、AL03 按状态复核留白和对齐（26、18–19）。正文到按钮 12 → 28，按钮右缘仍在操作组右缘，页面无横向溢出。 | 修复后通过 | [前](initial-production-before-spacing/acceptance-320-expanded.jpg) · [后](initial-production-after-spacing/acceptance-320-expanded.jpg) |

## 补查 · 独立复核发现的三个局部问题

本轮前图已包含上轮底部操作区留白。使用同一隔离样本和视口重新拍摄，常态图均清焦。

| 检查 | 证据、修复与复测 | 同尺度截图 |
|---|---|---|
| F3 · 制作确认行的设置链接过密 | PX01 邻近关系与 IC02 控件间隔（12、99）。首屏 390 px 的三个相邻间隔实测约 3.8 px，320 px 的长画风名状态为 2 px。修复后同排间隔均为 8 px。常用宽度的一行与窄屏的两对操作均靠右。四个完整无障碍名称与当前值保留，320 px 逐项点击进入正确页签。 | [390 px 前](initial-production-before-recheck/01-confirmation-390.jpg) · [后](initial-production-after-recheck/01-confirmation-390.jpg) · [320 px 前](initial-production-before-recheck/02-confirmation-320.jpg) · [后](initial-production-after-recheck/02-confirmation-320.jpg) |
| F4 · 画风提示词标签离字段过远 | PX01 标签贴近所属输入框与 WS03 间距一致（12、27–28）。共享字段的标签额外继承了 20 px 外边距，实测总间距 26 px。修复后间距回到字段内部的 6 px。「编辑提示词」仍聚焦对应输入框。 | [画风前](initial-production-before-recheck/04-art-prompt-390.jpg) · [后](initial-production-after-recheck/04-art-prompt-390.jpg) |
| F5 · 验收说明难以扫读 | TY05 按语义分段与 IC04 信息分组（80–81、100–101）。原说明把录入、审核影响与停止条件放在一段，整段还出现在输入框名称中。修复后分三段，输入框名称为「验收要求」，说明通过描述关联。条数上限、逐条审核、复用分镜和图片及停审条件均保留。 | [验收前](initial-production-before-recheck/03-acceptance-390.jpg) · [后](initial-production-after-recheck/03-acceptance-390.jpg) |

独立复核员核对四组前后图。320 px 换行增加一行，四个入口与「开始制作」均完整显示。浏览器另行验证四个入口及空格开工，同一隔离样本完成 8 幅。

## 行为复核与边界

从「按主题」选择候选，进入准备和确认，从画风页选择「白描连环画」，按空格触发一次确认。隔离服务返回成功，制作设置应用到本篇，分镜启动后完成 8 幅。初始视图、禁用准备按钮、查找中、准备中、候选选中、故事目录空态、焦点态与完成状态都有证据。字体观察限于截图可读性。修复后按钮文字与实底的实测色值对应 7.20∶1 的对比度（TY11，92、94–96）。外层流程继续使用共用链接，面板复用共用实色确认按钮。

间距补查从 320 × 720 的验收要求展开态按空格触发一次确认，同一隔离路径再次完成 8 幅。本次样本范围为本地书籍的主题主路径及章节列表、故事目录空态两个分支。导入、自填故事、联网兜底、真实模型的等待或失败、绘图中间态及不同系统字体缩放没有单独收集成对证据。
