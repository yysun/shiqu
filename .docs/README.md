# 文档索引

先读本页。下表列出每个领域**当前有效**的长期文档。两份文档冲突时，以表中标为「权威」的为准，并把冲突报告给用户，不自行选一份照做。

## 怎么读

- **长期文档**（本目录顶层）描述系统现在怎样工作，随行为变化同步更新。
- **按日期存放的文档是历史记录**：`reqs/`、`plans/`、`done/`、`reports/` 记录当时的需求、决策和交付，不随后续变化更新。需要了解某个决定的来由时再读，不要把其中的规则当作现行规则。
- 页首标明整篇「已被取代」时，按链接查阅现行文档。若只标明某个条款或候选方案被取代，说明仅适用于该项。

**查历史时按问题选目录。** [需求](reqs/)保存当时要解决的问题与验收条件，[计划](plans/)保存当时选择的做法、未决项与检查点，[交付记录](done/)保存特定构建的结果。按故事名查三处，日期可能不同。读到旧清单中的未勾项，先核对后续交付和发布记录，再判断今天是否仍有待办。

## 当前文档

| 领域 | 权威文档 | 补充文档 | 状态 |
| --- | --- | --- | --- |
| 制作生命周期：阶段、读者动作、授权、故障 | [故事制作生命周期](story-production-lifecycle.md) | — | 0.17.0 当前 |
| 制作产物：有效性、就绪、复用、调用契约 | [故事制作与编辑 DAG](story-production-dag.md) | — | 0.17.0 当前 |
| 选题、候选查找、准备、首次确认与替换选题 | [故事生成状态机](story-generation-state-machine.md) | [从候选故事到文字分镜](story-creation-flow.md) | 0.17.0 当前 |
| 分镜审核方法 | [分镜审核方法与执行约束](storyboard-editorial-review.md) | — | 当前 |
| 使用说明（读者与 CLI） | [使用指南](user-guide.md) | [通过 SKILL 使用](use-as-skill.md) | 当前；CLI 行为以 `skills/shiqu/SKILL.md` 和实际帮助为准 |
| 开发、配置与本地检查 | [开发指南](development.md) | — | 当前，含制作调用与故障恢复的排查入口 |
| 测试选择与成本 | [测试触发与成本](testing-triggers.md) | [启动配置测试](startup-testing.md) | 当前 |
| npm 发布 | [npm 发布](npm-publishing.md) | — | 当前 |
| 制作 DAG 验收（原编号 1–59） | [Test Manager 受管目录](../.tests/story-lifecycle/SUITE.md#制作-dag-验收索引) | [按构建的运行记录](../.tests/story-lifecycle/RUNS.md) | 当前 |
| 其他故事的验收场景 | `tests/test-*.md` | — | 各场景对应其故事，随故事更新 |

## 已被取代

| 文档 | 取代者 | 说明 |
| --- | --- | --- |
| [故事创建、编辑与队列管理](story-creation-editing-queue.md) | 生命周期、DAG、状态机三份文档 | 按 0.13.4 代码写成，确认后的制作、修订与队列已改变；保留作概览与历史参考 |

### 制作流程中已核实的变更

下表只列出已找到后续决定的旧规则。需求和计划页首标明变更范围，原文保留当时的取舍与验收条件。

| 历史记录 | 被取代的部分 | 现行依据 |
| --- | --- | --- |
| 后台生成（[需求](reqs/2026/10/29/req-background-generation.md)、[计划](plans/2026/10/29/plan-background-generation.md)） | 读者选择前台或后台模式 | [后台制作与授权](story-production-dag.md#保存暂停与继续) |
| 暂停编辑与重选（[需求](reqs/2026/10/31/req-paused-editing-latest-version.md)、[计划](plans/2026/10/31/plan-paused-editing-latest-version.md)） | 确认后重选另建独立故事 | [替换当前选题](story-generation-state-machine.md#替换当前选题) |
| 早期制作状态机（[需求](reqs/2026/11/02/req-story-generation-state-machine.md)、[计划](plans/2026/11/02/plan-story-generation-state-machine.md)） | 确认后的修订提交即恢复、原有引擎继续编排 | [保存、暂停与继续](story-production-dag.md#保存暂停与继续) |
| 编辑一步提交（[需求](reqs/2026/11/21/req-direct-production-actions.md)、[计划](plans/2026/11/21/plan-direct-production-actions.md)） | 提交普通修订就开始下一步 | [保存、暂停与继续](story-production-dag.md#保存暂停与继续) |
| 早期制作 DAG（[需求](reqs/2026/11/21/req-data-driven-production-dag.md)、[计划](plans/2026/11/21/plan-data-driven-production-dag.md)） | 跨版本延续故障、验收条目单独登记、文字模型随版固定、事后提示重绘其余画幅 | [现行制作 DAG](story-production-dag.md) |
| 格式 3 制作生命周期（[需求](reqs/2026/11/24/req-production-lifecycle-state.md)、[计划](plans/2026/11/24/plan-production-lifecycle-state.md)） | 修订继承故障和「待匹配」状态 | [版本与故障归属](story-production-dag.md#版本与并发约束) |
| 独立横图（[需求](reqs/2026/11/24/req-standalone-landscapes.md)） | 旧横图通过旧流程手动接续 | [独立横图与升级](story-production-dag.md#节点目录) |

### 交付记录与最终发布有差异时

`done/` 的测试结果属于当时执行的构建。候选方案在发布前改变时，在原交付记录页首写明受影响的条款、正式版行为和发布依据，并在下表登记。原构建的通过项、失败项和缺口保留原文。

| 当时记录了什么 | 最终发布了什么 |
| --- | --- |
| [定向精简交付记录](done/2026/11/25/production-targeted-cuts.md)验证了候选构建拒绝格式 1–3，并测试了经 0.17 过渡的路径。 | 发布前撤回该方案。0.17.0 核验整库备份后，可将格式 1、2、3 直接升到格式 4。[C-3 最终需求](reqs/2026/11/25/req-production-targeted-cuts.md#c-3) · [读者升级说明](user-guide.md#升级到-0170) |
| [制作规范精简交付记录](done/2026/11/25/production-spec-simplification.md)记录了开发预览迁移 `0029` 及候选迁移 `0030` 的测试。 | 两者在发布前并入 `0028`。最终格式和迁移号可从[发布标签中的书库清单](https://github.com/yysun/shiqu/blob/v0.17.0/db/library-format.json)核对。 |

## 维护规则

- 故事改变了某领域的规则时，DD 在同一变更中更新该领域的权威文档，必要时更新本页。
- 故事推翻了此前的决定时，其需求写明被取代的文档；被取代的需求、计划或长期文档顶部加一行「已被取代：见 …」，并在本页「已被取代」登记。只改变部分规则时，写明受影响的条款。普通故事不需要标注。
- 审查行为变更时，指出权威文档中哪一条承诺变了，用生产入口的回归用例、可复现结果或 CLI 实际帮助核对新表述。补充文档引用这条规则，只保留读者所需的操作说明。
- 发布准备时，从上一发布标签以来的行为变更逐项核对对应文档，更新受影响的索引状态和取代关系。
