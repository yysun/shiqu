# 书库升级与回退 Test Cases

Case IDs use `UPGRADE-C001`, `UPGRADE-C002`, and so on. Keep retired IDs; never reuse them.

## UPGRADE-C001 — 用上一正式版的书库打开候选版本

- State: READY
- Priority: P0
- Type: RECOVERY
- Requirement / Risk: RS1
- Automation: MANUAL
- Owner: Yiyi Sun

### Objective

上一正式版正在使用的书库副本在候选版本中打开后，书架、作品、阅读和设置保持不变。

### Preconditions

- 已按套件说明复制上一正式版的书库，并把故事数据目录指向副本。

### Test Data

- 上一正式版的书库副本，记录复制前的作品数。

### Runner Instructions

- 启动服务并打开书架。书库格式有变化时，等待「正在升级书库」完成并记下备份路径。
- 抽查三篇作品：一篇已完成、一篇有多个版本、一篇未完成或已暂停。

### Expected Outcome

- 书架作品数与复制前一致，抽查的作品能阅读，图片完整，未完成的作品保持原来的暂停或进度。
- 格式没有变化时不出现升级提示；有变化时控制台显示已校验的备份路径。

### Negative Assertions

- 打开书库没有自动恢复已暂停的制作，也没有发起任何生成。

### Evidence Required

- 复制前后的作品数、抽查作品的编号和截图、升级提示或备份路径（如有）。

## UPGRADE-C002 — 更早格式的书库一次升级到候选版本

- State: READY
- Priority: P1
- Type: RECOVERY
- Requirement / Risk: RS1, RS3
- Automation: MANUAL
- Owner: Yiyi Sun

### Objective

格式 1 至格式 3 的书库副本在候选版本中一次升级到最新格式，作品完整。

### Preconditions

- 本版改动了 `db/library-format.json` 或 `drizzle/` 时列入签核范围。手头有一个更早格式的书库副本。

### Test Data

- 一个格式 3 或更早的书库副本，记录其来源版本与作品数。

### Runner Instructions

- 把故事数据目录指向副本，启动服务，等待升级完成，再按 UPGRADE-C001 的方式抽查。

### Expected Outcome

- 升级一次完成，控制台显示已校验的备份路径，作品数一致，抽查的作品可读。

### Negative Assertions

- 不要求先装中间版本。升级失败时书库副本和备份都还在。

### Evidence Required

- 来源版本、作品数、备份路径、抽查截图。

## UPGRADE-C003 — 用升级前备份回退到上一正式版

- State: READY
- Priority: P1
- Type: RECOVERY
- Requirement / Risk: RS3
- Automation: MANUAL
- Owner: Yiyi Sun

### Objective

书库格式变化后，用升级前的整库备份和上一正式版应用，在另一目录恢复出可用的书库。

### Preconditions

- 本版书库格式有变化，UPGRADE-C001 或 UPGRADE-C002 已产生备份。

### Test Data

- 升级时报告的备份路径；上一正式版安装包。

### Runner Instructions

- 按用户指南「数据与备份」把备份恢复到一个新目录，装回上一正式版，把故事数据目录指向该新目录。

### Expected Outcome

- 上一正式版能打开恢复出的书库，作品数与升级前一致。

### Negative Assertions

- 没有把备份恢复到使用中的目录。上一正式版没有打开升级后的书库。

### Evidence Required

- 恢复目录、作品数、上一正式版的书架截图。
