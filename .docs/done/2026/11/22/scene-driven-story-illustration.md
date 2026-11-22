# 连环画场景叙事交付

正式制作现在从提纲安排环境的叙事作用，通过逐幅描述落到相对方位，再由文字审校和共用绘图指令保住这些关系。场景缺失仅影响画面时，既有构图修订只处理指定画幅。实现提交 `659e557`。 [需求](../../../../reqs/2026/11/22/req-scene-driven-story-illustration.md) · [实施方案](../../../../plans/2026/11/22/plan-scene-driven-story-illustration.md)

## 验证

- 隔离检出的 20 个测试文件含完整性冒烟，合计 171 项通过。`pnpm typecheck` 和 `pnpm lint` 通过。并行改动合入后的制作场景和调用契约复验 58 项通过。
- 单篇实测使用自拟的《渡溪送药》、正式制作调用、临时媒体目录和现有 Codex 订阅。首次按 CLI 默认文字模型调用返回生成失败，重试在本次验证中指定 `gpt-6.1-sol`。生成结果和实际请求留存在本地 `.data/evidence/scene-driven-story-illustration/`。

## 需求复核

`VR passed: all acceptance criteria complete`

- **提纲**按固定两幅安排过桥全景与交药近景，首幅承担两岸位置和去向的交代。
- **分镜**在首幅落实桥心人物、西岸巨石与东岸小屋，末幅以门槛延续屋内外关系，焦点收在交药的双手。
- **审校**在故意省略两岸线索的首幅报告局部构图问题，第二幅近景通过。画面修订在首幅补回路线、位置和取景。
- **生图**实际竖图为 `941 × 1672`，同幅参考生成的横图为 `1536 × 1024`。阅读尺寸下，两张都能辨认老人留在巨石旁、童子穿过溪流、桥头通向小屋，并能看到彩铅线条和明暗层次。受控契约也覆盖重绘调用。
- **原文与连续性**文本与成图保持原文的动作、人物关系和顺序。切换到白描的实际文字调用保留了完整的场景描述和入画名单。

```text
AR passed: no blocking architecture flaws
AR risk: low — 复用现有生产调用与字段，只调整共享提示词。
AR review round: 1; reviewer: not applicable
CR passed: no major findings
CR risk: low — 调用契约、修订路由及保存语义沿用现有实现。
CR review round: 1; reviewer: not applicable
VR risk: low — 受控调用与单篇真实竖横图覆盖本次行为。
VR review round: 1; reviewer: not applicable
```
