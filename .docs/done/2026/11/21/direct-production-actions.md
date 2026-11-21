# 制作编辑一步提交

## 变更

编辑面板直接提交分镜、梗概和制作设置。首次开工可在设置面板确认。审核主操作使用实心按钮。提交失败保留输入，其他设备更新后可以加载书架当前版本。

## 验证

- `pnpm test:changed` 通过 213 项，修订流程通过 9 项。类型检查和 lint 通过。
- 应用内 390 px 预览验证重点路径。点击「重新审核」后，生产接口返回已创建且已激活的待审核版本。另验证批量删合、暂停时换梗概、已完成故事换画风、调整验收及制作要求、首次开工、提交故障和版本冲突。
- 选题替换、单幅重绘、任务重试和署名编辑已走查。
- CR passed: no major findings.
- CR risk: non-low — 跨面板制作流程与并发版本恢复。
- CR review round: 3; reviewer: reused

VR passed: all acceptance criteria complete.
