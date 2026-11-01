# 校订原文验证

1. 加载真实本地书库：shishuo-11-003谜面含“黃絹幼婦，外孫齏臼”，释义含“齏臼，受辛也”；其他1128单元逐字不变，原文件SHA仍匹配catalog，版号与原件哈希不同。
2. 新选择并保存本则：selection.source与original.localSource一致，读取媒体原文与数据库一致。用stub经过withLocalBooks.plan验证可到达stub，不请求模型。
3. 精确3条目标更新：保留12幅、画风、主题、revision和其他文档字段；state idle、control paused、无旧校验错误；已完成父故事和红楼故事保持completed及其全部计划/媒体，仅原文与出处更新。REST读取也显示新出处与暂停、原校验错误消失，旧失败text队列项不再阻塞。其余可见及已删除记录逐条未变。
4. 历史匹配的旧edition原文与selection仍可经过withLocalBooks生成校验；错误的edition或段落仍被拒绝。
