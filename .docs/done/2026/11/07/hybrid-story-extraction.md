# 混合检索辅助故事提取

- 《搜神记》试点索引保留 463 条原文范围、976 个片段向量及 47 个预制查询向量。正式提取入口使用内存文字匹配与已匹配的参考向量召回，再读所选范围内的原文。独立索引可重建，正式书库不迁移。
- 索引现有格式只含一个原文版本。未命中参考表的标题或主题走文字通道。无可核对候选时继续顺序阅读。试点索引没有加入发布包。
- 正式入口通过 Codex 提取了「卖鬼赚钱」「宋定伯卖鬼」和「爱情」对应的故事并校验原文，均为单次提取。另用《谈生与鬼妻》检查「复生」。当前候选中没有该条，临时加入「复生」向量也未召回，原文短语「垂生」排名第一。
- `pnpm typecheck`、`pnpm lint` 和 `pnpm test:changed` 通过，变更检查 1515 项通过。Rust 格式检查通过，原生库测试 25 项通过，排除依赖正式桌面包的一项。

AR passed: no blocking architecture flaws

CR passed: no major findings

VR passed: all acceptance criteria complete
