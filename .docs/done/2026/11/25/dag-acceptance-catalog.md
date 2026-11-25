# 制作 DAG 验收目录迁移

## Summary

从[受管目录](../../../../../.tests/story-lifecycle/SUITE.md#制作-dag-验收索引)按旧编号进入用例、执行指令与历史记录。59 个编号中 46 项为现行、3 项有公开入口待核、1 项待复验、1 项明确不提供、8 项已删除。产品规范保留行为与原目录锚点；旧核查表保留其构建与时间边界。

## Verification

- AR risk: non-low — 关乎既有验收承诺、执行入口和历史证据的兼容性。AR review round: 1; reviewer: new. AR passed: no blocking architecture flaws.
- CR risk: non-low — 分组用例在执行入口漏掉断言会造成误判。CR review round: 2; reviewer: reused. CR fixed: restored complete runner prompts, reader redraw guarantees, and landscape ownership rules; rerun result passed.
- 先试行 35 号（`c5db2b88`），再迁移 59 项（`cba659c9`），复审修正执行提示与保留的保证（`d48a9fae`）。场景 35 的两次历史失败、一次历史通过与待验的编辑器提示分开追踪。一次取消、一次确认与重放分别检查提交数、版本数、调用数及新旧图是否可读。
- 97 条历史运行的 Git 对象为 `c8ffa178ef1dc098630786f03835fd4465ed0902`，46 个证据文件的 Git 树为 `f12ac29400d2c9a14730e617999edbf9676a3d66`，均与故事基线一致。受管用例就绪只表示可执行。

## Notes

本次迁移的范围是拾趣。项目执行模板现在投影每个分支的完整预期与禁止副作用。生命周期表中「竖图重绘连带更新横图」的旧表述已按独立套图交付记录和正式回归纠正。产品发布指标仍为 `NOT_READY`；尚缺 30 个新增用例在候选构建上的整例运行。测试目录迁移可分别撤回，各里程碑不涉及书库格式或数据变换。

## Final VR

VR risk: non-low — 验收规则和执行证据。VR review round: 1; reviewer: reused.

VR passed: all acceptance criteria complete. Round 1, material catalog/evidence risk, through d48a9fae plus completed AP. (1) Independently walked 59 unique numbered destinations: 46 current, 3 partial entry, 1 awaiting retest, 1 unsupported, 8 withdrawn; source/evidence links resolve. (2) Git shows zero changes to RUNS and all 46 evidence files (97 historical rows), C016 retains two FAIL and one PASS; installed CLI independently projected complete expected/negative/evidence/preconditions for 57 READY cases and rejected 3 DRAFT + 5 RETIRED. (3) c5db2b88 trial precedes cba659c9; actual regression log covers description request and caption zero draw; registered guard and four adverse fixtures cover gaps/duplicates/bad references. (4) Spec anchor and historical audit route to managed suite; product test entry points are retained, 10 change checks and 8 focused production assertions passed, typecheck/lint passed. All four AP tasks checked, CR round 2 passed. Residual quality gate NOT_READY is correctly distinct from completion of the catalog migration; 30 new cases have no candidate product run.
