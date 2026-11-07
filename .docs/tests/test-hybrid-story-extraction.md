# 混合检索辅助故事提取验证

在实验 worktree 里准备独立索引。应用从运行数据目录读取 `story-search.sqlite`。`refs` 使用现有主题、常见词和已制故事卡的标题。Ollama 只在制备索引和参考向量时使用。命令在目标不存在时安装独立索引。重新制备后，已安装的副本需要单独更新。

```sh
node scripts/experiment-soushen-search.mjs refs
mkdir -p .data/dev-local
if [ ! -e .data/dev-local/story-search.sqlite ]; then
  sqlite3 .data/soushen-search.sqlite '.backup .data/dev-local/story-search.sqlite'
  sqlite3 .data/dev-local/story-search.sqlite 'PRAGMA journal_mode=DELETE; PRAGMA quick_check;'
fi
pnpm dev local
```

1. 打开《搜神记》，输入「葛由」或「卖鬼赚钱」，触发自动提取。候选分别包含精确文字和语义命中，最终故事携带可解析的原文出处。
2. 选择「爱情与错过」或输入「爱情」。运行时从 SQLite 读取参考向量。选择章节后重复，章节外的候选不进入模型。
3. 对无参考向量的查询，运行时使用 JavaScript 文字匹配。候选不足或缺少独立索引时，顺序阅读从原有进度继续。
