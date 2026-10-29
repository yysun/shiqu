# 三书本地原件替换

## Summary

《山海经》换为维基文库18经，《酉阳杂俎》换为识典JINANLIB02203前20卷续10卷及35份原字形PNG，《史记》换为维基文库《史記三家註》130卷，十表保存实际数据。原始下载件逐件固定SHA与来源身份；运行时静态解析原字、注释和表格，不存重复MD/TXT。旧原件退出应用，标题与版式元数据不能独立用作故事出处。

## Verification

完整测试112/112、针对性7/7、typecheck、lint及普通build通过。当前Codex订阅真实完成三书1/2/21批全读、出处核对及各8页简体分镜，重开当前解析器/SQLite/media后原文仍一致。无RAG、Docker构建、图像生成或音频请求。

## Notes

同一电子作品不等于已确认同一古刻本，具体刊本信息未完整注明。酉阳51处图片字原PNG已留本地，阅读时明确占位；酉阳2处、史记5处原有□保留，相关原段拒选，不猜补。所选正文无旧字库私用字，不代表已经逐字校勘。超时重试及验证器续跑缓存如实记录，不改变产品行为。

本地里程碑：33cca48cefdc137991bfd8758cb258d0b74bc85d、5a3b022d9c48ef5d9f468b74f5a7eccd14c0a213；未推送。保留进入任务前的其他文档修改及并行提示词工作。

后续书架整理：已将6个独立真实验证目录中的13篇故事连同原文、分镜和模型记录补入当前本地书架，并标记收藏；原有4篇记录保持不变，核对时共17篇。13篇均未生成插图，保留待继续状态。导入前已备份SQLite，按UUID幂等导入；当前应用API逐篇核对13份原文成功。证据见`.data/backups/bookshelf-import/latest.json`及`verification.json`；SQLite、媒体、备份和验证器脚本继续留在忽略目录，不纳入Git。

## Final VR result

VR passed: all acceptance criteria complete

审查范围：基线 `516da14`，本故事实现提交 `33cca48`、`5a3b022`。CR2后相关实现未变；无关提示词提交不计入本故事。

| REQ验收项 | 状态 | 具体证据 |
|---|---|---|
| 三书原件、范围、版本与来源完整 | complete | 山海18经、酉阳前20续10卷、史记130篇均已加载；原件集合分别20/65/131件，逐件SHA和来源身份固定。旧原件退出应用，无跨来源补字；史记十表含实际数据。 |
| 无旧字库编码，图片字及阙字明确保留和拒选 | complete | 所选正文无PUA、KR代号或残IDS。SSR全部行型和原字顺序保留；51处图片字对应35份原PNG，共同参与版本，原段明确占位并拒选。酉阳2处、史记5处原有□保留，不猜字。 |
| 正文、注释及表格结构保留，元数据不能充当故事 | complete | 全Wiki原字顺序和SSR原文比较通过；十表1581行、18555格及4203空格位保留，跨度fixture通过。全部1581个版式单元、空表行、卷题组合及印刷目录范围拒选回归通过。网页家具排除及注释处理范围已说明。 |
| 文件、路径、篇卷及引用版本严格校验，旧数据兼容 | complete | 精确清单、SHA、realpath、页面revision、SSR身份及史记18/19重定向核对有效；缺件、错卷、篡改、坏图和路径逃逸失败关闭。缓存v7使旧候选失效，已存原文检查点继续复用。 |
| 三书穷尽通读并真实完成原文先存、简体分镜 | complete | 当前Codex订阅分别完成1/2/21批，覆盖938/1387/9117单元，生成《夸父逐日》《三足乌的祥瑞之争》《管鲍之交》各8页。请求原文与SQLite/media保存件相等，简体旁白及尾部覆盖复核通过；无RAG或外部书源回退。 |
| 说明准确，测试及构建通过，遵守非目标 | complete | 底本未明、校注/OCR、图片字及阙字限制公开。完整测试112/112、针对性7/7，typecheck、lint、普通build通过，其他21本回归有效。未构建Docker、请求图像生成或音频，字形PNG不在运行时外取。 |

证据：[真实流程结果](/Users/esun/Documents/Projects/shiqu-docker/.data/evidence/clean-three-live/evidence.json)、[最终原文与持久化复核](/Users/esun/Documents/Projects/shiqu-docker/.data/evidence/clean-three-live/final-source-recheck.json)、[完整测试日志](/Users/esun/Documents/Projects/shiqu-docker/.data/evidence/clean-three-test.log)、[针对性测试日志](/Users/esun/Documents/Projects/shiqu-docker/.data/evidence/clean-three-source-tests.log)、[构建日志](/Users/esun/Documents/Projects/shiqu-docker/.data/evidence/clean-three-build.log)。

AP全部任务完成，无遗留阻塞。真实调用曾超时：酉阳复用原文检查点重试；史记21个当前输入哈希逐一对应21份真实Codex成功响应。缓存仅用于验证续跑，未改变产品行为，未以部分阅读冒称全书完成。

VR risk: non-low — 三书来源版本、HTML/SSR、表格及图片字解析影响正文完整性和引用资格。  
VR review round: 1; reviewer: reused

本次只读核对，未重复测试或修改文件。
