# 按任务分配推理预算与《大葫芦》真实审核对比

## Summary

文本任务不再共用一个全局推理档位。选题和画幅建议默认 medium，画风 low，提纲/详细分镜/审核与复核/修订 high；Node/Docker 的七个 SHIQU_REASONING_* 变量及桌面设置可分别覆盖。Codex 每次调用独立配置并核验线程实际档位；Gemini 传对应 thinkingLevel，不支持值拒绝而非降档。旧桌面设置补默认，新增档位保留于生成用量记录，选题和画风缓存按各自档位隔离。旧 Codex 全局档位保留给未分类/图片工具请求。

修稿前《大葫芦》原版20幅分镜使用同一 gpt-6.1-sol、新审核规则及相同应用层请求，依次真实运行 medium/high/xhigh 各一次。三档均发现14幅机械转述；耗时31.798/55.391/87.427秒。medium/high还错误要求把独立reflection总结塞入第20幅caption，xhigh没有；三档均未澄清第4幅“无处容纳”的含混表达。本例不支持普遍升到xhigh。详见 [完整比较](../../../../reports/2026/10/30/gourd-reasoning-comparison.md)。

## Verification

- Node24.22.1/pnpm11.25.0：定向任务/缓存30/30，既有适配器/审片/生成75/75，typecheck/lint通过。
- 原生：使用已安装Rust1.93，`TAURI_CONFIG='{"bundle":{"resources":{"../desktop/resources/node/":null}}}' cargo +1.93.0-aarch64-apple-darwin test --locked --manifest-path src-tauri/Cargo.toml`，17/17通过；资源覆盖与Lite一致，未准备资源或打包。
- 完整受控套件采用4进程及60秒超时重跑：387项、386通过、1失败。仅余基线已存在的legacy缓存黄金常量断言不一致；原先卡住的development-access独立2/2通过且在完整重跑正常退出。未放宽或修改旧断言。
- IAB验证pnpm desktop:preview设置页七项默认值、Gemini范围、预览只读，截图保存于 `.data/evidence/task-reasoning-effort/desktop-task-efforts.png`。
- 三次真实请求的input/request哈希、实际模型与档位、用量、耗时及schema报告全部落盘，rubric未注入请求；成功结果复用验证不增加调用。修好的配文、提示与20张原图哈希均未变。原始证据在 `.data/evidence/task-reasoning-effort/`，未提交私有数据。

## Notes

本地实施里程碑 `a147e55`，未推送。已有版本号调整及queue-interruption任务文档未纳入本任务。打包桌面应用需要更新后才采用新增设置；新字段可能不被旧版程序接受，升级/回退应保留对应设置备份。真实比较没有运行repair/image，没有改写现有故事。新增规则的效果与推理档位的效果不能混为一谈；这次没有重跑旧规则做双因素对照。

## Prompt follow-up

后续按用户要求，只调整审核/修订系统提示词：独立reflection不塞进末幅，语义歧义与重复标签分别检查，同幅多项问题全部覆盖。固定原版输入、模型和high复测62.016秒，余味误报消失，第4幅器具/容器关系、第9幅“卖方”及第20幅含混表达均得到具体检出；14幅重复转述仍被发现。32/32相关测试、typecheck/lint及本地CR通过。已确认当前系统审核指令与这次真实high回执完全一致，原图与现有配文未变。完整结果见比较报告末节；下面保留原分任务推理配置的独立验收结论。

## Final acceptance review

VR passed: all acceptance criteria complete

VR risk: non-low — 涉及两提供方请求预算、桌面设置持久化及缓存身份，关键边界已有实现和验证证据。  
VR review round: 1; reviewer: reused (`review_reasoning`)

源码自 `a147e55` 后未变化；此次仅核对新增验证结果，原 CR 结论 `CR passed: no major findings` 继续有效。

| 验收项 | 状态 | 证据 |
| --- | --- | --- |
| 七类任务采用推荐默认档位并显式传递任务身份 | Complete | `lib/reader-reasoning.ts` 定义默认映射；两提供方七类任务及 `planBatch` 的请求边界测试通过。 |
| Node/Docker 与桌面分别配置，旧设置可读且密钥不变 | Complete | `SHIQU_REASONING_<TASK>` 与桌面 `taskReasoningEfforts` 桥接完整；TS/Rust 缺省、迁移、保存及原子拒绝测试通过。 |
| Codex 单次配置及并发隔离，Gemini 不静默降档，连接检查不推理 | Complete | 独立子进程配置与线程实际档位核验；并发覆盖及后备档位测试通过；Gemini 不支持值在发出请求前拒绝。 |
| 生成检查点保存档位及原用量，相关缓存不混用 | Complete | `Generated` 和 `Document.usage` 保留可选档位；队列检查点测试保留原用量；选题/画风缓存按对应档位隔离，审核改档不触发无关重新通读，旧无档位缓存不回填。 |
| 修改前《大葫芦》三档真实审核，变量固定，不写书库、不绘图 | Complete | 三份成功回执均为 `gpt-6.1-sol`，实际档位符合请求；应用层输入及请求 SHA-256 一致；正式 review 入口、独立会话、无媒体接口；成功 medium 回执复用不增加调用。 |
| 保存报告、耗时、用量和失败机制，比较检出与误报并限制结论 | Complete | 专用脚本保留输入、请求、独立 rubric、成功/失败回执；可读报告与三档原始结果一致，区分实际问题检出与幅号覆盖，指出总结句误报。 |
| 受控测试、类型/lint、原生配置与应用内预览通过，无打包或推送 | Complete | 定向 30/30、原生 17/17、类型检查及 lint 通过；IAB 截图确认七任务默认值、Gemini 允许范围和预览只读。最新完整套件为 **387 项、386 通过、1 失败**；唯一失败为已证明存在于基线的旧缓存黄金常量断言。`development-access` 独立 2/2 通过，并在完整受限并发重跑中正常退出。 |

保留的验证限制：完整套件不能记为全过。唯一剩余失败中，基线和当前 `legacyDiscoveryNamespace` 均产生 `ed2dea...`，测试旧常量为 `39814a...`；该函数及相关输入依赖未被本任务改动，未通过放宽断言掩盖失败。

质量证据边界：真实比较只有一个故事、每档一次，比较的是审核报告及修改建议；没有验证真实自动修订后的语言质量，也没有跨题材稳定性或显著性结论。

配文与媒体保护：已核验修好后的 20 幅配文、全部画面提示、原文与生成历史保持一致，20 张原图哈希一致。
