# 连续寻找故事

## Summary

选择界面每次请求一篇，保存后通过现有每秒状态轮询显示并自动寻找下一篇，不需要反复点击继续。选中即停止并拒绝迟到结果；离开释放查看者需求，后台模式不单独驱动查找。保留候选、缓存和阅读进度，支持重开续找。空结果、失败、暂停和40批上限会停止自动续找。复用 LAN HTTP 安全的 UUID 方法。

## Verification

Node 24.22.1 / pnpm 11.25.0：`pnpm test` 826/826，通过 `pnpm typecheck`、`pnpm lint`。独立 CR 三轮后无主要问题。集成测试覆盖真实前端观察循环、REST、SQLite、队列及受控 provider，包括逐篇、迟到结果、SQL竞争、多查看者、离开/重开、租约过期和缓存。

VR incomplete: required in-app browser E2E remains unexecuted because local browser use is disabled.

Implementation and controlled integration evidence satisfy the remaining criteria. Full verification passed: 826/826 tests, typecheck and lint. The first requirement and AP browser task correctly remain unchecked for actual browser display and interaction verification.

VR risk: non-low — paid discovery lifecycle and concurrent selection.
VR review round: 2; reviewer: reused

## Notes

交付机制是轮询，通常有0–1秒可见延迟，不是 SSE 推送。正常离开释放需求；断连以30秒租约兜底，已发起的本地模型调用可以完成并保留共享缓存。没有真实推理调用、Docker构建或桌面打包。

本地实现里程碑：`3e982e2`、`e51429b`。最终测试断言和验证文档留在工作区；未执行最终 GC。浏览器验证仍需可用的 in-app browser，当前设置返回 `Local browser use is disabled in Work settings`。
