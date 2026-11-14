# 更新默认主题及检索定义

## Summary

发现页、选题页和 CLI 共用八个预设。向量检索按整句定义召回相似故事卡；没有可用向量时，文字模型按同一条定义判断情节关系。同名自定义按原句检索。保留已有候选、主题名和制作要求，也无需重建故事卡向量。

## Verification

定向检查 31 项、最终影响检查 429 项、桌面原生测试 26 项均通过；类型和 lint 通过。[验收记录](../../../tests/test-theme-update.md) 包含浏览器操作、真实模型输入、候选顺序和原文定位。

## Notes

向量候选表示相似度。《王六郎》在文字模型对照中符合「命运与选择」，但未进《聊斋志异》语义召回前 200；同一查询首屏第 10 条《柳生》可追溯到原文。

## VR

`VR passed: all acceptance criteria complete`. 1 complete — browser confirms eight ordered presets, Other, and actual candidate-to-preparation; real Ollama trace distinguishes full definition from same-name input. 2 complete — real 495-card index, one full request per preset, 《柳生》 #10, 《连城》 #1, semantically ranked four-card contrasts and unchanged vector compatibility. 3 complete — same definition drives the production Codex card path with true examples; controlled integration confirms unavailable-vector fallback, ten-card batches and unchanged input requirements. 4 complete — old saved candidates and authorship preserved by isolated reload and regression tests; effective query+prompt hashes separate current and old judgments, repeated current query reuses cache. 5 complete — 《王六郎》/《尸变》 for fate and 《连城》/《狐嫁女》 for romance have source positions, true vector rankings and independent model decisions documented. Final AP checked, 429 scoped tests, 26 native, lint/typecheck 0. `STAGE risk: non-low — shared discovery and persisted intake cross production and client paths.` `STAGE review round: 1; reviewer: reused`.
