# 太平广记文渊阁本接入

Git base: 5b753fd
风险：non-low，改变500卷书源的引用版本及无标点正文核对边界。保留已存会话的原文检查点，不迁移其正文；旧候选引用不能套入新版本。

决策：保存上游Readme.org、提要_000及001–500原始TXT，不再重复保存ZIP或转换件。不引入解压依赖。catalog记录原始文件有序清单与每件SHA256，版本为清单中“相对文件名+tab+hash”的换行串SHA256。运行时全部校验后只解析001–500；每卷出处为固定Git提交的TXT链接。

- [x] 首个SS有界探针：检查500卷元数据/卷题、四全角空格故事标题边界、目录与正文分离及尾题变体。若无法可靠分离目录或有内容丢失，停止依赖工作，修订计划回AR。
- [x] 替换data原件与catalog；新增文渊阁解析模块，只移除包装/页码/行尾¶/卷首目录/卷尾卷题，保留正文用字；以原行确定引用单元，对来源标识及每卷正文完整性校验。
- [x] LocalBooks接入原始文件集合完整校验与版本、每卷URL；无标点放行仅限此解析出的叙事单元，标题/目录不能独立通过；移除旧太平补界及重复目录逻辑；候选缓存版本更新。
- [x] 更新回归测试及来源说明；覆盖500卷全部单元分批、昔日缺卷首篇、原字、错卷与原件篡改、目录和旧版引用拒绝、其他书和出处先存再分镜。
- [x] 运行完整pnpm test、typecheck、lint、pnpm build；完成真实模型全书选题→核对→8页简体分镜以及应用页面检查。

无RAG，无Docker构建，无正文简繁转换或自动校勘。长书真实全量选题成本与等待时间较高，使用既有并发2/10万字符批次，不缩小测试范围冒充全书。已存会话原文保持原样，重新选题使用新版本。

AR round1（独立复用reviewer）：AR passed: no blocking architecture flaws。SS probe .data/taiping-wyg-probe.json：500卷全部有正文起点、首尾卷题和叙事行，正文边界无未处理包装，203/437/446尾题变体匹配。

TT：pnpm test 102/102，typecheck、lint、pnpm build通过；.data/taiping-wyg-test.log与build.log。真实模型全书ET正在运行。

实施里程碑08c9015（原件、解析、回归及来源说明）。独立CR round1: CR passed: no major findings；risk non-low；reviewer reused。IAB现有localhost:3000页已重载，太平/聪明与糊涂选中，无旧候选，入口可用；截图taiping-wyg-selection.png。全书真实ET仍待结束。

ET通过：.data/taiping-wyg-live/evidence.json，真实gemini-3.8-flash顺序36批（500卷81982单元），一次候选汇总保留5个本地已核对候选，最终8页简体分镜《斗量人间》，原字原文先存SQLite/media再发分镜；38次文本请求，无图片/音频/外部古籍请求。保留499卷候选，321旧缺卷候选也通过。无RAG/Docker。
