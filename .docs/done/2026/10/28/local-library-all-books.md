# 全书库本地全文

## Summary

全部24目录书接入本地全文按主题选题、本地核对出处、先保存原文再生成简体分镜。短书整本输入，长书按原顺序分批全部通读，所有候选经本地核对后再汇总；不做RAG、不调用公共书籍API回退。原字保留，原件不重复转存简体。

史记改用固定GitHub提交的130篇原始JSON；太平25卷及二刻40原始HTML补件分别校验并标注真实来源。候选缓存v4、长书等待提示和旧史记篇名补全均已落实。本地里程碑提交`5b753fd`，未推送。用户原有AGENTS.md及上一故事验证文档变更保留。

## Verification

最终99/99测试、typecheck/lint/build通过；开发bundle已恢复。真实Gemini列子整书、儒林分批与汇总各5候选+8页，二刻40单卷补件3候选+8页；全部24本为模拟HTTP集成验证。IAB当前localhost验证候选本地出处。未调用插画/音频，未构建或运行Docker。

## Notes

史记十表主要为表序，含115个私用区字形，选择不可读范围会被拒绝；其余转录本已知问题留在catalog。浮生仅存四记。长书需要多次文本请求，会增加等待与调用量。原文存在性校验不等于全量校勘。

以下为完整最终VR结果：

VR passed: all acceptance criteria complete

审查范围：`9d5b1a5 → 5b753fd`。实现提交后的变化仅为 AP 追加提交信息；入口已有的上一故事文档及 AGENTS.md 变更不属于本故事。

| REQ 验收项 | 状态 | 具体证据 |
|---|---|---|
| 24本加载本地原件、保留原字及版本范围 | complete | 逐书章数、全部单元及原件哈希验证通过。《史记》130篇标题唯一、正文非空且不重复；太平25补卷、二刻40、浮生四记和红楼前80/后40范围均落实。无重复简体全文。 |
| 短书完整输入、长书有界通读后汇总 | complete | 每批输入≤100000字符、并发≤2；全部单元覆盖、超过五批时尾批入选、批失败停止派发且不返回部分成功的测试通过。 |
| 候选出处与批次可见范围核对 | complete | 服务端校验版本、同章连续范围、可读字形及批次可见单元；汇总仅接受已有候选 receipt。补卷引用使用实际来源 URL。浏览器截图显示候选本地出处。 |
| 原文保存后生成简体分镜，错误失败关闭 | complete | 全部24本模拟HTTP集成验证 SQLite/media 原文先存、再请求分镜；缺件、坏哈希、错误引用与范围均失败关闭。真实模型证据包含原字原文及简体分镜，无公共书籍API回退。 |
| 保持旧引用、补全与检查点重试合同 | complete | 庄子/世说旧编号及 raw edition 回归通过；保存原文复用、分镜失败重试、旧补全测试通过。新增《史记·陈涉世家》唯一篇名补全回归通过。Gemini/Codex共用本地包装路径，契约测试通过。 |
| 完整性、错误路径及24本集成覆盖，区分真实与模拟 | complete | 全部24本选题至8页分镜为模拟HTTP验证。真实Gemini：列子整书、儒林全书分批与汇总各5候选及8页；二刻40单卷补件3候选及8页，来源URL正确。Codex仅模拟契约，未称真实验证。 |
| test/typecheck/lint/build通过，遵守非目标 | complete | 最终测试99/99，typecheck/lint/build成功，开发bundle恢复。无RAG、向量库、Docker构建或运行；真实验证仅调用文本，未调用图片或音频。 |

证据：[最终测试日志](/Users/esun/Documents/Projects/shiqu-docker/.data/evidence/local-library-test.log)、[构建日志](/Users/esun/Documents/Projects/shiqu-docker/.data/evidence/local-library-build.log)、[整书真实模型证据](/Users/esun/Documents/Projects/shiqu-docker/.data/evidence/local-library-all-live/evidence.json)、[补卷单卷真实模型证据](/Users/esun/Documents/Projects/shiqu-docker/.data/evidence/local-supplement-live/evidence.json)、[浏览器截图](/Users/esun/.codex/visualizations/2026/10/28/01a183af-85d1-7e92-9d75-31b17b3c0a66/all-books-local-candidates.png)。

AP全部任务完成；AR第5轮、CR第4轮通过，无遗留阻塞。《史记》十表主要为表序、115个私用区字符及转录本未经逐字校勘的限制已公开，未宣称足本。

VR risk: non-low — 涉及多来源全文解析、长书并发及引用持久化与旧故事兼容。  
VR review round: 1; reviewer: reused

本次只读核对，未重复执行有效测试，未修改REQ。
