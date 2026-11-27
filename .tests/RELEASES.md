---
schema: test-manager/releases/v1
---

# Releases

## 0.18.0

- Candidate: UNDEFINED
- Decision owner: Yiyi Sun
- Decision: UNDECIDED
- Decided at: —
- Sign-off record: [0.18.0 签核记录](release-0-18/SUITE.md#签核记录)

### Scope

| Target | Scope | Reason |
| --- | --- | --- |
| smoke | IN | 候选安装包与核心使用路径 |
| regression | IN | 提示词、模型调用和制作流程均有改动，纳入模型回归 |
| UPGRADE-C001 | IN | 验证 0.17.0 的格式 4 书库能打开并保持已有作品和进度 |
| UPGRADE-C002 | OUT | 书库格式和迁移未变 |
| UPGRADE-C003 | OUT | 书库格式和迁移未变 |
| CHANGES-C001 | IN | 手动检查更新后的结果提示 |
| CHANGES-C002 | IN | 保存为新版后从所属步骤继续 |
| CHANGES-C003 | IN | 成图影响预览与画风转换 |
| CHANGES-C004 | IN | 未保存分镜与合并草稿保护 |
| CHANGES-C005 | IN | 首次预计幅数、实际幅数与刷新边界 |
| CHANGES-C006 | IN | 按条自动修改和向草稿应用建议 |
| CHANGES-C007 | IN | 局部事实问题按出错字段修订 |
| STORY-LIFECYCLE-C044 | IN | 保存修订的窗口并发与重放 |
| STORY-LIFECYCLE-C045 | IN | 各入口统一保存新版后等待继续 |
| STORY-LIFECYCLE-C046 | IN | 手改配文后复核与成图决策 |
| STORY-LIFECYCLE-C049 | IN | 自动修复仍保护手改内容 |
| STORY-LIFECYCLE-C055 | IN | 换画风时转换并保留手改描述 |
| STORY-LIFECYCLE-C057 | IN | 结构重编披露影响并正确复用 |
| STORY-LIFECYCLE-C061 | IN | 已确认丢图在新版单独处理 |
| STORY-LIFECYCLE-C066 | IN | 自动修订按实际出错的字段派发 |
| STORY-LIFECYCLE-C069 | IN | 首次估算、实际幅数和准备调用边界 |

### Waivers

| Case ID | Reason | Impact | Expiry | Decision owner |
| --- | --- | --- | --- | --- |

### Residual risk

- 候选比最新正式版新，桌面检查发现更新后自动定位下载入口的分支要等更新的正式版可用才可直接观察。
- 安装包冒烟覆盖一篇简短故事。长篇、多批次与故障恢复由受控模型测试覆盖。
