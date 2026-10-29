# 二刻拍案惊奇统一四十卷原件

## Summary

用xp44mm/hanchuancaolu固定提交的40卷原始TXT替代前三十九卷MD加独立HTML的方案；逐件校验文件、卷序、卷题与引用版本，第四十卷九折杂剧完整保留，正文原字不改。实施里程碑516da14。

## Verification

20/20针对性、105/105完整测试以及typecheck、lint、常规build通过。真实Gemini全书5批通读与一次汇总、8页简体分镜；第四十卷另以单卷选题核对并生成8页。两次分镜前均确认原文已存，未请求图片/音频/外部古籍资料。

## Notes

具体所据刊本未注明、未收序/小引、未逐字校勘；同一电子来源不等于确认同一古刻本。末卷重复题名仅在展示中去重，原文件及正文11个问号不猜补。无RAG和Docker。旧候选需重读，既有会话原文检查点继续复用。保留入口旧文档/AGENTS的未提交修改，未推送或做最终GC。

## Final VR (verbatim)

VR passed: all acceptance criteria complete

审查范围：`08c9015 → 516da14`。CR后实现无变化，复用有效AR、CR及测试证据。

| REQ验收项 | 状态 | 具体证据 |
|---|---|---|
| 固定来源，保存40卷原始TXT，移除旧拼补件 | complete | 原件固定至提交 `889b8873e34419ce9d519f50482f60d913a4ac20`；40份下载字节及哈希保留，旧MD和第四十卷HTML退出应用，无派生转换正文。 |
| 校验完整集合、卷序、卷题、版本及路径，保留九折正文 | complete | 40卷逐字正文、非空不重复、九折顺序及终句断言通过；缺卷、篡改、错卷、重排和路径逃逸失败关闭。仅展示题名去重，正文原字及11个问号保留，末卷标注杂剧。 |
| 全文通读、有效出处、旧引用处理及原文先存合同 | complete | 真实全书5批覆盖40卷1718单元，全部候选使用固定提交TXT出处。旧版本及无效范围回归通过，缓存升至v6；已存检查点复用路径保持。两次真实分镜前均核验SQLite/media已保存原文，payload只携带相等的已核对片段。 |
| 真实全书及末卷独立流程、其他书回归和常规检查 | complete | 全书汇总5候选，以6670字符原文生成8页；第四十卷独立输入12376字符，得到3候选，以第五折2250字符原文另生成8页。原文相等、caption简体断言通过。针对性20/20、全套105/105及typecheck、lint、build通过，包含太平和其他书回归。 |
| 更新说明、清除旧候选、不构建Docker并准确报告限制 | complete | catalog及data说明明确“同一电子来源≠已确认同底本”、刊本未明、未收序/小引、未逐字校勘。缓存失效已落实。全书与单卷证据分开记录；无外部古籍、图片、音频请求，无RAG或Docker构建。 |

证据：[真实验证结果](/Users/esun/Documents/Projects/shiqu-docker/.data/evidence/erke-unified-live/evidence.json)、[验证脚本](/Users/esun/Documents/Projects/shiqu-docker/.data/tools/verify-erke-unified-live.mjs)、[针对性测试日志](/Users/esun/Documents/Projects/shiqu-docker/.data/evidence/erke-unified-focused.log)、[全套测试日志](/Users/esun/Documents/Projects/shiqu-docker/.data/evidence/erke-unified-test.log)、[构建日志](/Users/esun/Documents/Projects/shiqu-docker/.data/evidence/erke-unified-build.log)。

AP全部任务完成，无遗留阻塞。真实验证使用Gemini，共6次读取、1次汇总、2次分镜；未将单卷验证冒称全书验证。

VR risk: non-low — 扩展文件集合加载边界并更换出处版本。  
VR review round: 1; reviewer: reused

本次只读核对，未重复测试或修改REQ。
