# 太平广记统一文渊阁本

## Summary

使用Kanripo固定提交的500卷文渊阁本原始TXT替代旧MD及25HTML补卷。运行时逐件校验502原件并剥离目录和版面包装；无标点叙事可核对，原字不变，故事用简体。实施里程碑08c9015。

## Verification

真实Gemini全书36批通读、一次汇总产生5个核对候选，卷31李珏原文生成8页《斗量人间》，原文先存再分镜。102/102测试、typecheck、lint及常规build通过。IAB验证选题入口及旧候选失效。

## Notes

无RAG、Docker、图片或音频请求。转录本未逐字校勘。旧候选需重新选题，已存会话复用其原文检查点。Codex为模拟契约验证；真实文本流程使用Gemini。保留入口已有旧故事文档及AGENTS改动；不作最终GC或推送。

## Final VR (verbatim)

VR passed: all acceptance criteria complete

审查范围：`5b753fd → 08c9015`。实现无后续变化，复用已通过的AR、CR及测试证据。

| REQ验收项 | 状态 | 具体证据 |
|---|---|---|
| 统一保存WYG原件，移除旧件及补界逻辑，其他23本不受影响 | complete | Git变更保存500卷、提要及Readme共502件；旧太平MD、25份HTML和专用补界模块已移除。其他书及全部24本HTTP集成回归通过。 |
| 500卷顺序加载、逐件校验、排除包装且保留原字 | complete | 精确文件集合、逐件SHA、清单版本、卷元数据与首尾卷题均校验。500卷正文逐行完整性测试通过；缺件、篡改、额外文件及错卷失败关闭。目录、页码和包装不进入引用正文，不转换字形或添加标点。 |
| 无标点故事可引用，旧版及目录范围拒绝，出处对应固定分卷 | complete | WYG专属叙事标记支持无标点范围，标题独立引用、旧版本、跨卷和倒序引用回归通过。真实原文URL指向固定提交的 `KR3l0118_031.txt`。 |
| 全文通读覆盖尾卷，保持本地核对和原文先存合同 | complete | 真实模型36批覆盖500卷、81982个单元，随后一次候选汇总。最终5候选包含卷321和499；尾卷覆盖另有自动化断言。分镜请求前SQLite及media已保存核对原文；无RAG或外部古籍API请求。 |
| 真实全书选题、核对及8页简体分镜，回归和常规检查通过 | complete | `gemini-3.8-flash`完成36次读取、1次汇总和1次分镜。卷31李珏故事原文770字符逐字相等，生成8页《斗量人间》，caption简体断言通过。针对性测试17/17、完整测试102/102；typecheck、lint、build通过。 |
| 更新说明、不构建Docker，准确报告验证范围与限制 | complete | catalog、data说明及来源处理说明已更新，公开转录本未逐字校勘的限制。IAB截图确认太平和主题选中、新缓存无旧候选；选题及生成由真实HTTP流程验证。未调用图片、音频或构建Docker。 |

证据：[真实全书验证](/Users/esun/Documents/Projects/shiqu-docker/.data/evidence/taiping-wyg-live/evidence.json)、[验证脚本](/Users/esun/Documents/Projects/shiqu-docker/.data/tools/verify-taiping-wyg-live.mjs)、[测试日志](/Users/esun/Documents/Projects/shiqu-docker/.data/evidence/taiping-wyg-test.log)、[构建日志](/Users/esun/Documents/Projects/shiqu-docker/.data/evidence/taiping-wyg-build.log)、[IAB截图](/Users/esun/.codex/visualizations/2026/10/28/01a183af-85d1-7e92-9d75-31b17b3c0a66/taiping-wyg-selection.png)。

AP全部任务完成，无遗留阻塞。真实全书模型验证为Gemini；Codex沿用有效的模拟契约证据。旧候选版本失效，已保存会话的原文检查点继续复用。

VR risk: non-low — 改变多文件原件版本、正文分界及无标点出处校验边界。  
VR review round: 1; reviewer: reused

本次只读核对，未重复测试或修改REQ。
