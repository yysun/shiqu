# 二刻同源四十卷

Git base: 08c901509eb76d27983f946c59ffde805fa5a899
Risk: non-low。扩展既有原始文件集合加载边界并更换引用版本；保留其他23本原文及已存会话检查点。

选源：xp44mm/hanchuancaolu提交889b8873e34419ce9d519f50482f60d913a4ac20，二刻拍案惊奇目录40TXT。README指最初来源漢川草廬，未标具体所据刊本；不称已确认同古刻本。Gutenberg26729缺第四十卷，不能替代。40卷转录为简体原字，原样保留；未收序/小引。第四十卷属杂剧九折，首行重复题名、问号等原件现象不改写。

- [x] 首SS有界探针：核验40文件blob与GitHub清单一致，逐文件首题/序号、非空且不重复、可由标题剥离+既有localLines完整切分；末卷九折1–9和终句存在。失败停止依赖实施，改计划回AR。
- [x] 保存40原始TXT并更新catalog/来源说明；旧MD及HTML移至忽略研究档案。复用originalFiles清单及file+TAB+sha256换行串SHA版本，不新增依赖。
- [x] 扩展LocalBooks集合到二刻，严格40卷有序文件名/卷题校验及realpath；独立解析每卷，复用localLines（仅BOM/CRLF包装处理），仅显示标题去掉末卷重复题名并标杂剧，正文不改。每卷URL指向实际固定提交文件；不改变太平解析或无标点边界。cache升版使旧候选重读。
- [x] 增加40卷逐字正文/九折尾部/全文覆盖/哈希破坏/错卷/旧引用回归；改原补件测试为统一原件测试，保留24本HTTP原文先存合同和太平回归。更新数据说明。
- [x] 完整pnpm test、typecheck、lint及pnpm build；真实Gemini全书通读与8页分镜，第四十卷单卷另验8页分镜。截图只需在确有UI变化时；此次缓存键回归由代码及测试覆盖，不额外触发图片请求。

不新建RAG、不添标点或简繁转换、不自动校勘，不做Docker。转录本未知刊本且有错字/残问号，保留并明确标注。目录卷数和章节末文完整不证明逐字无讹。

AR round1（复用独立reviewer）：AR passed: no blocking architecture flaws。SS probe：40个下载blob与GitHub逐件一致，40卷题号相符，localLines字符完整等价，末卷九折与终句均在；证据研究档案parsing-probe.json。

TT：针对性20/20、完整105/105测试通过；typecheck、lint、pnpm build通过（.data/erke-unified-focused.log、test.log、build.log）。ET真实全书5批已完成读取和汇总，分镜/末卷探针进行中，尚不记完成。

实施里程碑516da14。独立CR round1：CR passed: no major findings；risk non-low；reviewer reused。实现无后续变更。

ET完成：.data/erke-unified-live/evidence.json为passed，真实gemini-3.8-flash。全书5批覆盖40卷1718单元、一次汇总、5核对候选；王朝议故事原文6670字符生成8页。第四十卷单卷独立输入12376字符，3核对候选；第五折《柴进智潜睿思殿》原文2250字符，另生成8页。共6读取/1汇总/2分镜请求；两次分镜前均断言SQLite/media已存原文，caption简体且原文逐字一致，无图像/语音/外部古籍请求。无RAG、无Docker。
