# 三书更换原件与HTML解析

Git base: 516da148905c2f4ed342e8dff55fc37a66b34611
Risk: non-low。扩展已存书源集合格式、解析HTML正文及史记表格、改变三书引用版本。保留其他21本和已有会话原文检查点，不改检索或生成架构。

候选来源与决策：
- 山海经：维基文库同一作品18经原始HTML、郭璞序和索引，逐页面revision存档。正文已扫描无旧字库/组字占位，部分篇夹注不一，不称已确认统一古刻本。另行排除组字残符的四库全览、含私用字的JSON及明显OCR失真的识典候选。
- 酉阳杂俎：识典JINANLIB02203一本书的30卷原始HTML，济南市图书馆供图，具体刊刻信息未标。页面公开SSR内有bookVersion、chapterId及完整paragraphList；全部30卷已下载并与目录paragraphCount核对。无私用字/组字残符，卷6/18共两处原有□；另有51处图片字（35独立PNG）不具Unicode，全部原图下载保留，阅读时原位置明确标“□〔原件字形图：ID〕”，相关范围拒选，不声称无讹。不能将其说成已证实古刻足本。
- 史记：维基文库《史記三家註》130卷原始HTML，包含实际十表；卷14表及卷117先前坏字处抽样无私用字。全130卷下载/最终扫描完成，0私用字/KR/残IDS；卷17/18/23的原有□保留（共5处）。普通版130卷117仍有一私用字、Kanripo TLS三私用字、正义和文库镜像均缺表/缺字，已排除。
- 只保存上游原始HTML、必要字形PNG及原有说明/索引，不另存转换MD/TXT。运行时在内存解析，沿用原始集合逐件SHA及有序file+TAB+sha256换行串版本。新增文件格式为wikisource-html/shidian-html，catalog有实际URL、revision或bookVersion/chapterId及分卷标题。新原文不具备现代标点的部分只按解析出的叙事单元放行，不全局放宽旧书。

- [x] 首SS有界可行性探针：完整扫描三书解析候选的全部正文/文件及身份；史记130卷全部无私用字/缺字代号/残组字符且十表均有非空表数据；山海18经和酉阳30卷逐件完整、两处□及51处图片字不丢失。检查Wikisource正文容器、导航/注释/图片标识、表格行列跨度及Shidian目录paragraphCount/版本与全部lineType原字。任一不成立，停止对应实施并修订来源/计划回AR。
- [x] 迁移原件至data/library，原件清单固定页面版本/哈希；旧三书原件移入忽略研究档案。扩展LocalBooks集合到此三书，精确文件清单、卷序/标题、SHA、realpath及来源身份校验，逐件失败关闭。不新增依赖。
- [x] 增加原始HTML解析模块，利用已有htmlparser2只读解析，不执行脚本。Wikisource按mw-parser-output中的正文块提取；隐藏页面家具排除、br保留分隔、郭注/三家注身份不抹去。史记表格逐行输出原单元格文字及来自rowspan/colspan的布局标记，保留所有空单元格与行列位置，不把布局标记当古文。Shidian仅JSON.parse公开window._ROUTER_DATA赋值内数据，核验30卷目录/段数/原字及所有lineType；同一原件article含网站字形转换且省略部分小字，不能作为逐字基准，也不能覆写SSR原字。按paragraphList原段拼接行内容（保留所有类型文字，lineType2小字显式版式标注），网页目录/界面不入正文，印刷目录和卷题仅作不可独立引用的版面资料。charPic原图35件归档，HTML与PNG均参与精确清单/SHA/edition；SSR全51处出现及35唯一ID与PNG双向匹配、未知/空ID/错图失败关闭。字图位置以明确处理标记□〔原件字形图：ID〕留在原段，不用variants/components猜补，不把标记独立成可绕过单元，不在运行时取图。
- [x] 每卷引用稳定ID、真实页面版本URL；以正文单元标签排除标题/布局元数据，保持坏编码和□范围拒绝。山海原来的所有【】拒绝改为针对真正组字占位，不能误拒新原件夹注；不改其他21本。cache升版，正文明确区分经文与注释异说。
- [x] 增加三书的原字/全文/尾卷/十表单元格和跨度完整性回归、目录/坏编码/旧版本/缺件错卷/篡改路径拒绝、其他21本与source-before-plan集成回归；更新数据来源、规模、原件未识字/OCR/注本说明，移除过时旧三书断言。
- [x] 运行完整pnpm test、typecheck、lint、pnpm build。真实当前已配置Codex订阅分别穷尽阅读三书并汇总候选、核对原文、8页简体分镜；记录各书批次覆盖/原文先存/无图像生成和外部原文请求。无UI流程改变，不为验证文本触发图片。

限制：版本身份和无旧编码不证明逐字校勘无讹；识典OCR残阙保留，注本异说不能混为正文事件。Wikisource表格不能采用旧的过滤所有table策略，必须保留数据与跨度关系。不得用多个电子版本补缺凑齐，也不得修订古文字形。无RAG，无Docker。

审查及实施证据：
- 首SS发现SSR/article字形差异，以及51处图片字，已在实施前修订来源处理并通过AR4。SSR不被DOM覆写；35原PNG与HTML同列清单，未知结构失败。
- AR fixed: 图片字留存、版本校验和拒选边界已纳入REQ/AP/ET；rerun result passed。
  AR risk: non-low — 图片字完整性与占位处理影响版本及可引用范围。
  AR review round: 4; reviewer: reused
- 探针：.data/book-source-research/2026-10-28/clean-three/feasibility.json及youyang-glyphs-manifest.json。149件Wiki原件所选正文0PUA/KR/残IDS；十表1581行18555格/4203空格；识典1390段/51处35字图。
- 本地里程碑33cca48cefdc137991bfd8758cb258d0b74bc85d：原件迁移、解析、版本与测试；5a3b022d9c48ef5d9f468b74f5a7eccd14c0a213：明确标题及表格版式非叙事，拒绝元数据范围。均未推送。
- CR fixed: 标题与表格版式不能再作为独立故事原文；rerun result passed。
  CR risk: non-low — 解析角色决定原文引用及分镜资格。
  CR review round: 2; reviewer: reused
- TT：.data/clean-three-test.log，112/112；.data/clean-three-source-tests.log，7/7；typecheck/lint/普通build通过，build后恢复dist/dev/server.js供本地开发服务使用。
- ET：当前已配置Codex订阅，runner观测原文先保存与全文覆盖，不切换API计费。山海1批938单元及酉阳2批1387单元已各完成8页简体分镜；酉阳超时后复用原文检查点成功。史记21批9117单元及汇总→《管鲍之交》8页完成；三书全数成功。
- 验证器对成功阅读响应按完整job哈希存于忽略目录verified-reading-cache，用于超时后避免重复验证调用；产品仍按原顺序处理全批次，未增加产品缓存/RAG。实际Codex响应、输入哈希和完成状态见.data/clean-three-live/evidence.json，最终21个独立输入哈希与21份真实响应缓存精确对应，未以部分阅读声称全书成功。

ET最终：.data/clean-three-live/evidence.json result=passed；独立重开当前解析器/SQLite/media核对见final-source-recheck.json，三书全单元覆盖938/1387/9117、输入批次1/2/21、8页简体及先存原文均通过，无图片/音频或外部书源请求。史记及酉阳曾遇Codex超时，保留原文/验证成功响应后继续，未将部分结果当全书成功。实际产品仍有120秒Codex等待上限，未为验证改动产品超时。

VR passed: all acceptance criteria complete。独立验收6项均complete、AP全完成，无遗留阻塞；完整逐项结果原样保存于.docs/done/2026/10/28/clean-three-originals.md。VR risk: non-low；VR review round: 1; reviewer: reused。
