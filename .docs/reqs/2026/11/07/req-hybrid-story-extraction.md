# 拾趣古籍故事混合检索 REQ

## 目标

读者能用人物、标题、主题或白话情节寻找古籍故事。检索负责召回相关原文范围。应用的提取模型再读原文，核对完整情节、匹配条件和出处。读者要求「求雨」时，应核对是否有人为此采取行动。要求「求雨成功」时，还要核对实际降雨。

## 索引制备与数据边界

- 试点在独立 worktree 的 `codex/soushen-semantic-search` 分支上运行。制备写入 `.data/soushen-search.sqlite`。运行时从当前数据目录读取 `story-search.sqlite`。正式书库 `shiqu.sqlite` 无需迁移，也无需存储检索数据。
- 以原文版本、章节和起止单元定位故事。切分程序给千问连续原文和可选起点，验证起点及范围覆盖。排版用作辅助，模型负责判断故事边界。当前索引里的全书范围先前已建好，新切分在《搜神记》卷八和《世说新语·谗险》做过样本验证。
- Ollama 制备入口是 `scripts/experiment-soushen-search.mjs`，默认用本机 `qwen3.5:latest` 制卡，摘要模型可通过 `cards --model` 指定，使用 `qwen3-embedding:0.6b` 生成向量。运行时读取已制备的索引，无需 Ollama。

| 数据 | 制备方式和用途 |
| --- | --- |
| 原文范围、整篇向量 | `build` 读取本地原典，记录版次与单元范围，并为可读原文生成向量 |
| 原文片段向量 | `build` 为较长故事生成重叠片段，片段命中后回到完整故事范围 |
| 故事卡与摘要向量 | `cards` 复用现有切分，生成现代中文情节摘要与向量。已生成的摘要卡直接跳过，可用 `--volume` 或条目编号限定范围 |
| 事件卡与事件向量 | `events` 让千问分别记录行动者、行动、对象、目的、结果、状态及白话检索词。模型引用片段编号，程序从原文取回证据。难解条目可离线用已登录的 Codex 订阅复核 |
| 查询参考向量 | `refs` 从现有主题、故事标题、事件词和显式传入的查询制备参考表，使用与文档向量相同的模型 |

在实验 worktree 运行。`build --raw` 只制备原文与片段向量。`cards` 与 `events` 省略范围时处理所有符合条件的条目。旧的 `build` 和 `build --pilot` 仍可连续制备原文与摘要。摘要模型可指定 Ollama 模型名、Codex 订阅的 `gpt-6-luna` 或 `gpt-6.1-sol`，以及读取 `DEEPSEEK_API_KEY` 的 `deepseek-flash`。向量始终使用原索引的本地千问模型。

```sh
node scripts/experiment-soushen-search.mjs build --raw
node scripts/experiment-soushen-search.mjs cards --volume 11 --model gpt-6-luna
node scripts/experiment-soushen-search.mjs cards --model qwen3.5:latest soushen-016-182
node --env-file=../shiqu-docker/.env scripts/experiment-soushen-search.mjs cards --model deepseek-flash soushen-008-004
node scripts/experiment-soushen-search.mjs events soushen-016-182 soushen-008-004
node scripts/experiment-soushen-search.mjs refs 复生 险些复生 即将复生 下雨 止雨
```

将制备好的 SQLite 快照安装到独立的运行目录。操作示例和更新已有副本的注意事项见 [试点验证步骤](../../../../tests/test-hybrid-story-extraction.md)。

## 混合检索与提取

实验脚本的 `search --light-cards` 合并标题与梗概的文字排名、原查询的向量排名，以及短主题扩写后的向量排名。整篇原文与梗概向量直接复用。短查询没有精确标题命中时，由本地千问扩写至多两条，失败时继续用原查询。回执包含扩写文本与各路排名。仅由扩写找到的高排名候选另列在 `expansionCandidates`，避免挤掉原查询的靠前结果。`--no-expand` 可对照原有两路结果。`search --text-only` 只跑轻量卡文字匹配。这些模式都只检索已有轻量卡的篇章，跳过事件卡、片段向量和故事提取，可用 `eval` 对照。

```sh
node scripts/experiment-soushen-search.mjs search --light-cards '谈生与鬼妻'
node scripts/experiment-soushen-search.mjs search --light-cards --no-expand '谈生与鬼妻'
node scripts/experiment-soushen-search.mjs eval --text-only
node scripts/experiment-soushen-search.mjs eval --light-cards
```

1. **确定书籍和原文版本。** 应用按当前书籍和用户选择的原文范围过滤。CLI 可以显式指定书名，省略时读取索引记录的书籍。候选须能解析到当前版本的原文。
2. **JavaScript 全文匹配。** 对原文、故事标题、轻量卡梗概和白话事件描述做繁简及标点归一化。轻量卡文字排名与实验脚本共用，也能在查询没有参考向量时召回候选。缺向量的故事仍可走文字通道。
3. **离线向量召回。** 输入命中参考表时，比较故事摘要、整篇原文、原文片段和事件向量。同一故事的多个表示取最相近的一项参与语义排名。未知参考词仍可走文字通道。
4. **合并与去重。** 两路各自排名后按名次融合，保留排名靠前的精确命中和语义命中。按原文范围去重，同一故事命中多个片段仍只占一个候选。
5. **应用按原文提取。** 用候选的出处从本地原典读取原文，按输入预算分批交给现有模型。原文引用必须落在提供的范围内。标题提取发现未完线索、候选不足或索引不可用时，沿用现有的顺序阅读流程。

CLI 查询候选并返回 JSON，包含排名、原文预览和出处。命令无需启动服务，也无需调用提取模型。

```sh
shiqu books search '险些复生' --data-dir .data/dev-local --limit 5
shiqu books search '求雨' 搜神记 --data-dir .data/dev-local --limit 5
```

## 当前验收

- [x] 独立索引已收录《搜神记》463 条原文范围、450 条整篇向量、976 个片段向量和 30 张故事摘要卡。新增事件卡在 4 篇样本上保存了 14 条事件，参考表已制备 109 条查询向量。
- [x] 应用正式提取入口已用「卖鬼赚钱」「宋定伯卖鬼」「爱情」「求雨」「下雨」「险些复生」核对原文。「险些复生」提取到《搜神记》卷十六谈生故事，出处从 `soushen-016-182` 开始。
- [x] CLI 在省略和指定书名时都把「险些复生」的谈生故事排在第 1。更新索引后，「复生」排第 4，「即将复生」排第 1。千问第一轮曾漏掉或误读复生状态，此样本经 Codex 复核补齐。
- [ ] 验证更广的事件卡覆盖和召回质量。「止雨」的候选仍会混入求雨故事，现有结果不足以确认该查询能稳定找到主动止雨的故事。
- [ ] 将试点的单书版次索引扩展到一个按书籍和版本管理的统一检索库。当前快照只覆盖《搜神记》，尚未进入发布包。
