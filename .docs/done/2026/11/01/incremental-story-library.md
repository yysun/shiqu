# 增量故事库与主题匹配

## Summary

过去换主题会重新通读原文。现在本地书籍逐篇收录与主题无关的完整故事摘要和出处，再独立匹配主题；当前不匹配的故事也保留，换主题和重启都可复用。正反判断均缓存，摘要不足时按真实原文复核。匹配失败不丢通用库或已完成判断，选中和离开仍停止后续工作。制作阶段继续读取已选故事原文与章节上下文，内部摘要不进入候选响应或分镜事实输入。

## Verification

Node 24.22.1 / pnpm 11.25.0：`pnpm test` 846/846；服务级 E2E 3/3；`pnpm typecheck`、`pnpm lint` 通过。独立AR、CR、VR均通过。

VR passed: all acceptance criteria complete

1. **Complete — Neutral story extraction.** Catalog payload omits the theme; required summaries and source ranges are validated. Tests cover retained nonmatches, nested stories, duplicate ranges, and crossing fragments.
2. **Complete — Incremental discovery and stopping.** Cached candidates are matched first; extraction resumes only when needed. Existing lifecycle tests cover selection fencing, departure, lease expiry, and cross-chapter recovery.
3. **Complete — Theme judgment and review.** Strict yes/no/review receipts require exact story IDs. Original-text review, unresolved uncertainty, budget rejection, retry, and completed-receipt persistence are covered.
4. **Complete — Independent durable caches.** Cross-theme and restart tests prove reuse, including negative judgments and incremental additions. Source/configuration namespaces and separate matching-contract keys provide isolation.
5. **Complete — Legacy and concurrency safety.** Old theme cursors cannot advance the new catalog; historical files remain intact. Shared extraction, independent theme decisions, differing matching batches, and cancellation are covered.
6. **Complete — Provider compatibility.** Codex, Gemini, and OpenAI expose extraction and matching contracts. Matching uses the existing suggest effort; remote discovery remains supported without new dependencies or configuration.
7. **Complete — Original-based production.** Service E2E verifies selected source preparation, chapter context, confirmation gates, and storyboard inputs containing originals rather than catalog summaries.
8. **Complete — Verification and documentation.** All AP tasks are complete. Node 24.22.1 / pnpm 11.25.0: 846/846 unit/integration tests and 3/3 service E2E tests passed; typecheck and lint passed. Independent CR passed.

Evidence covers backend behavior with controlled inference. No browser interaction or real-model semantic accuracy is claimed; this story changes no UI.

VR risk: non-low — persistent catalog semantics, paid judgments, concurrent readers, and source integrity.
VR review round: 1; reviewer: reused

## Notes

通用库限本地可信原文，非本地书名/URL仍沿用既有推荐。旧主题缓存文件及历史候选保留，但旧游标不作为完整故事库的覆盖证明。使用现有 suggest 档位，无新依赖、配置或数据库迁移。未进行真实付费推理、浏览器实测、Docker构建或桌面打包。

实现里程碑：`5efcd26`。最终提交只包含本故事验证文档；前一故事连续查找的未提交文档保持原状。
