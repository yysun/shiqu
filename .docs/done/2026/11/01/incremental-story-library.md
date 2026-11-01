# 增量故事库、主题匹配与摘要职责

## Summary

故事识别与主题匹配分层缓存，匹配项保存理由及完整摘要；主题/原典两种准备流程依据真实原文核对摘要。所有首次编排入口缺摘要时先生成并保存，重试复用检查点。故事、提纲、版本、接口、展示和ZIP统一summary，旧hook经升级迁移，保留数据及付费回执。

最新修正恢复原文驱动编排：短篇、提纲、批次、标题/结语及定向修订不接收独立或嵌套摘要；审核先按原文独立判断，再用摘要查范围、阶段和结局遗漏。第一页直接从原文提取必要背景。摘要保留准备、缓存、归档及审核用途。

## Verification

- `pnpm test` 857/857，约38.7秒；服务E2E16/16；三provider及受影响流程定向69/69。日志分别为`/tmp/shiqu-source-all-tests.log`、`/tmp/shiqu-source-e2e.log`、`/tmp/shiqu-source-focused.log`。
- typecheck、lint、diff检查通过。Node24.22.1/pnpm11.25.0；独立AR7、完整CR5、VR4通过。
- 实际书库升级复用一致性备份及逐表逐文件审计`/tmp/shiqu-summary-live-migration.json`，本轮不再执行迁移。
- VR后，用户授权再次比较《黛玉剪香囊》：同一原文、章节上下文和制作设置，gpt-6.1-sol生成16幅文字分镜、结语候选及独立审核，共3次调用，审核一次通过、0修订。请求记录证实编排无摘要，审核复用同一355字符核对摘要；三版逐幅对照48条配文。单次质量比较不代表普遍提升。

## Notes

- Git base `e51429b`；实现里程碑包括`5efcd26`、`83f87cb`、`a41b0d6`、`c12499b`及本轮`3b4c6e9`。按用户“DD GC”提交本故事收尾文档；不push，既有continuous-story-discovery文档未纳入。
- 原《黛玉剪香囊》和上一份摘要对照版保持原样；追加原文编排副本`d11aae9b-38be-4a28-a5fb-8f7d1f4bbd3a`暂停保存在书架，16幅、0图片/语音，未增加生产作业。原版旧引子仅改名为summary，不冒充语义补全。
- 实测记录、三版对照与验证文件位于本地书库外备份目录`daiyu-source-comparison-20261101T235102Z`，不把书库或私有原文快照提交Git。
- 受控推理证明契约和恢复行为，不证明真实模型质量提升；浏览器因设置禁用，未做视觉验收。没有打包。

## Final VR

以下为追加真实模型比较前的最终验收原文；后续比较未修改实现或验收条件。

VR passed: all acceptance criteria complete

对照当前REQ、AP、E2E、`e51429b..3b4c6e9`实现、CR5及最终证据，14项验收标准全部complete：

1. **中性提取：complete。** catalog不接收主题或制作偏好，保存完整摘要和可核对出处；包含主/子故事，拒绝重复范围及交叉碎片。
2. **增量发现：complete。** 优先匹配已有库，必要时共享续读，找到匹配即返回；游标、未完事件、选中停止和离开取消均有回归。
3. **主题判断：complete。** 严格验证yes/no/review及匹配ID；yes资料完整，review使用真实原文，失败不当作no且保留库。
4. **缓存复用与隔离：complete。** 提取和主题回执分层持久化，配置及原文变化正确隔离；匹配契约变化不重扫中性库，旧布尔回执不冒充完整摘要。
5. **历史缓存和并发：complete。** 不沿用无法证明覆盖的旧主题游标；并发主题共享提取，单个读者取消不终止其他读者所需工作。
6. **三provider支持：complete。** Codex、Gemini、OpenAI具备提取、丰富主题回执和摘要核对；沿用suggest/frames及既有凭证配置，四篇匹配上限和输出预算有契约回归。
7. **两种模式摘要准备：complete。** 主题候选、直接原典和旧式推荐均按真实原文核对或补齐摘要；缺结果阻止确认，重选、重启及重试保持来源绑定。
8. **原文编排、摘要审核：complete。** 三provider短篇及共享outline/batch、标题/结语和repair不发送storyBrief或匹配理由；嵌套plan/draft/outline投影去掉summary。原文、节点、已有分镜及其余元数据保留，原对象不变。审核保留完整摘要，先独立检查原文，再借摘要查范围、阶段和结局遗漏；错误摘要服从原文。显式未核对brief仍在模型调用前拒绝。
9. **开场与叙事规则：complete。** 第一页直接依据原文提取必要背景、人物关系和处境，不把全篇概述当开场、不提前泄露结局；无独立设局字段。既有节奏、因果、静态画面及连续性要求保留。
10. **最终验证：complete。** `pnpm test`857/857通过，约38.7秒；独立服务E2E16/16通过；定向69/69、typecheck、lint及diff检查通过。最新输入隔离由三provider请求捕获和服务回归共同验证。
11. **summary字段统一：complete。** 类型、模型输出、SQLite、API、编辑展示、版本保护和ZIP统一summary，无运行时hook别名；已核对摘要继续由engine保存为归档元数据。
12. **迁移与付费回执安全：complete。** SQL9、媒体JSON、幂等重试、失败回滚及旧库导入的有效证据继续适用。图片身份和依赖同步迁移，已付费未发布回执复用，碰撞中止而不丢弃回执；本轮未修改这些边界。
13. **实际书库升级：complete。** 备份及审计证明72任务、3故事、2118作业数量不变，828作业身份映射、4份JSON转换、1144个二进制文件大小及mtime不变、9篇中性摘要保留，无新增verified标记。本轮没有再次迁移或改写实际故事。
14. **首次编排缺摘要兜底：complete。** 共享准备函数先保存核对摘要，再调用plan/outline；失败不进入编排或绘图，重试复用检查点。确认状态及幅数保持；已有提纲恢复不重复提纲，已有成品和普通读取不自动生成。

全部AP任务已完成，CR5无未解决发现。最终日志为`/tmp/shiqu-source-all-tests.log`、`/tmp/shiqu-source-e2e.log`、`/tmp/shiqu-source-focused.log`及typecheck/lint日志；实际迁移复用`/tmp/shiqu-summary-live-migration.json`。

受控测试证明阶段契约与恢复行为，不证明真实模型质量提升。浏览器仍禁用，未做视觉验收；未额外付费重跑《黛玉剪香囊》、打包或自动重做历史故事。历史旧引子迁移为summary仍不等于完整摘要的语义补写。

VR risk: non-low — coordinated provider contracts, production/review isolation, source-bound preparation, persistent migrations and paid-receipt preservation.
VR review round: 4; reviewer: reused
