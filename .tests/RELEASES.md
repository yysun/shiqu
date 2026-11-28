---
schema: test-manager/releases/v1
---

# Releases

## 0.18.0

- Candidate: 73d6a18149c351155945d302c2aad2e981de7117
- Decision owner: Yiyi Sun
- Decision: UNDECIDED
- Decided at: —
- Sign-off record: [0.18.0 签核记录](release-0-18/SUITE.md#签核记录)

### Scope

| Target | Scope | Reason |
| --- | --- | --- |
| smoke | OUT | 核心路径已在 `676a5335` 验证。维护者要求本轮沿用已有结果 |
| SMOKE-C010 | OUT | 维护者指定在 GitHub Actions 验证 Windows x64 安装和运行时，由 REGRESSION-C005 记录 |
| regression | OUT | 逐项列出新候选必跑关卡，沿用与本次改动无关的历史验收 |
| REGRESSION-C001 | IN | 新候选包含生产调度、CLI 和原生桌面变更，执行发布门禁 |
| REGRESSION-C002 | IN | 新候选执行正式回归关卡，复用同一次运行的横图和备份清理结果 |
| REGRESSION-C003 | IN | 新候选执行启动、同库进程、loopback 和原生必跑关卡，同时取共享服务与在线备份结果 |
| REGRESSION-C004 | OUT | 沿用初始候选模型契约验证。此次派发授权及取消由 REGRESSION-C002、REGRESSION-C003 的受控模型场景验证 |
| REGRESSION-C005 | IN | 为冻结候选构建 macOS arm64 和 Windows x64 安装包，记录工作流自带的安装与运行时冒烟 |
| UPGRADE-C001 | OUT | 0.17.0 书库已在上一候选验证，本次差异未涉及书库 |
| UPGRADE-C002 | OUT | 书库格式和迁移未变 |
| UPGRADE-C003 | OUT | 书库格式和迁移未变 |
| CHANGES-C001 | OUT | 联网、断网和恢复联网已在 `2ca9d691` 独立通过，更新检查代码未变 |
| CHANGES-C002 | OUT | 上一候选已验证保存为新版后从所属步骤继续 |
| CHANGES-C003 | OUT | 上一候选已验证成图影响预览与画风转换 |
| CHANGES-C004 | OUT | 上一候选已验证未保存分镜与合并草稿保护 |
| CHANGES-C005 | OUT | 上一候选已验证首次预计幅数、实际幅数与刷新边界 |
| CHANGES-C006 | OUT | 上一候选已验证按条自动修改和向草稿应用建议 |
| CHANGES-C007 | OUT | 上一候选已验证局部事实问题按出错字段修订 |
| CHANGES-C008 | IN | 共享服务改动触及桌面维护入口，复用本候选回归关卡中的旧备份清理断言及既有内置运行时证据 |
| CHANGES-C009 | IN | CLI 冷启动、共享实例和制作授权为本候选新改动 |
| CHANGES-C010 | IN | 桌面接入、常规停服、强停与重启为本候选新改动 |
| CHANGES-C011 | IN | 横图套图、历史稿件和试印为本候选新改动 |
| CHANGES-C012 | IN | CLI 和桌面在线快照及在途任务拒绝为本候选新改动 |
| STORY-LIFECYCLE-C044 | OUT | 上一候选已验证保存修订的窗口并发与重放 |
| STORY-LIFECYCLE-C045 | OUT | 上一候选已验证各入口统一保存新版后等待继续 |
| STORY-LIFECYCLE-C046 | OUT | 草案中的配文联动画面选项没有现行入口，配文单改与成图复用由 SMOKE-C006 覆盖 |
| STORY-LIFECYCLE-C049 | OUT | 上一候选已验证自动修复仍保护手改内容 |
| STORY-LIFECYCLE-C055 | OUT | 上一候选已验证换画风时转换并保留手改描述 |
| STORY-LIFECYCLE-C057 | OUT | 上一候选已验证结构重编披露影响并正确复用 |
| STORY-LIFECYCLE-C061 | OUT | 上一候选已验证已确认丢图在新版单独处理 |
| STORY-LIFECYCLE-C066 | OUT | 上一候选已验证自动修订按实际出错的字段派发 |
| STORY-LIFECYCLE-C069 | OUT | 上一候选已验证首次估算、实际幅数和准备调用边界 |

### Waivers

| Case ID | Reason | Impact | Expiry | Decision owner |
| --- | --- | --- | --- | --- |

### Residual risk

- 候选比最新正式版新，桌面检查发现更新后自动定位下载入口的分支要等更新的正式版可用才可直接观察。
- 安装包冒烟覆盖一篇简短故事。长篇、多批次与故障恢复由受控模型测试覆盖。
- Windows GitHub Actions 验证安装与运行时。Windows 控制台与书架的人工交互不在本版签核范围内。
- 按维护者要求沿用已完成的验收。原制作、阅读和书库兼容证据来自 `676a5335`，断网检查来自 `2ca9d691`，旧备份内置运行时来自 `9f0e9383`。新候选的受影响行为由本次用例覆盖。各项结果仍绑定实际构建。
- 中断清理结果来自隔离样本和故障注入。此前真实备份的部分清理未留下系统错误码，完整备份保留。
- 横图使用受控绘图和已有浏览器、PDF 证据。真实画风效果及纸张打印未验证。
