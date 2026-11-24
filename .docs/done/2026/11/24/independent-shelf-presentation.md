# 独立作品管理

## Summary

书架新增「作品与导出」，可独立调整封面与署名并下载已保存的作品。封面保存于故事家族根记录，新版本沿用手动选择，正文继续从第一幅开始。

## Verification

- 应用内浏览器在生成服务未配置时选第二幅为书架封面、编辑署名并下载竖版 PDF。
- 隔离测试核对修订前后、删除和恢复、旧版图片、整库备份与恢复。迁移 0028 先校验整库备份，已有作品沿用首幅封面。
- 变更门禁 643 项通过，原生库 27 项通过，类型检查及 lint 通过。

## Notes

CR fixed: invalid uploads clear the pending selection, and historical image references follow the existing media routes; rerun result passed in focused tests and the final source check.

CR risk: non-low — library persistence and media ownership. CR review round: 2; reviewer: reused, with a local final check after the independent reviewer became unavailable.

VR passed: all acceptance criteria complete.

- 书架入口复用署名和下载交互，不开启制作。
- 可选用已有画幅、上传或恢复默认。封面独立于制作状态与绘图输入，新版本保留手动封面。
- 无生成服务时仍可保存封面与署名并导出已就绪作品。
- 旧书库升级使用首幅默认封面；封面读取通过读者和可见版本核对，最新版本删除后旧链接不可读。

VR risk: non-low — library persistence and media ownership. VR review round: 1; reviewer: independent evidence and local final check.
