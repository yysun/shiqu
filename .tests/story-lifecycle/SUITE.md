---
schema: test-manager/suite/v1
suite: story-lifecycle
title: 故事新建、编辑与状态机
risk: HIGH
state: ACTIVE
owner: UNASSIGNED
planned_start: UNPLANNED
planned_end: UNPLANNED
---
# 故事新建、编辑与状态机

目的：验证开发数据库上新建、编辑、重选、失败恢复的真实用户流程和状态机边界。风险R1/R2/R3/R4/R5分别由C001/C002/C003-C004/C005/C007覆盖，协议C006补充幂等、重启、竞态与媒体核对。

依赖：Node24、pnpm、Playwright Chromium、生产SQLite/媒体和受控模型adapter；无外部账号/密钥。构建6c791fa起的工作区，实现完成后记录hash/diff。

数据：独占`.data/e2e/<run>`，两段合成原文及控制图片；例外C007启动真实.data/dev-local，以readonly提供方禁用生成，允许正常初始化/迁移，不提交故事命令、不清空已有数据。UI状态由真实命令生成，不直接伪造持久状态来证明UI路径。媒体丢失等故障只在协议场景注入。UTC记录时间。

进入测试须用例就绪、隔离服务可用。验收须适用用例在待验构建上通过，且 P0/P1 无未解决缺陷。早期制作 DAG 回归保留原用例 ID。从下方[制作 DAG 验收索引](#制作-dag-验收索引)按原编号定位；已退役用例只保留原构建的结论。C001–C007 的旧运行只作为对应构建的历史证据。每次复跑追加记录。测试使用合成书库和受控生成器。

回归使用仓库登记的源码测试。C008 和 C013 的阅读器验证用应用内浏览器，在隔离 Vite 服务上执行。制作状态及授权用正式 API、协调器和 SQLite 验证。修改启动目录时复测 local、默认目录兼容性和私有文件。修改制作状态时复测重试、版本隔离以及界面状态与队列一致性。

已知限制：受控回执不能证明真实AI内容/图片质量；Playwright是独立会话。UI没有停止按钮时以协议覆盖，不声称UI支持停止。

## 制作 DAG 验收索引

原编号固定。按用例查看操作、预期和证据要求；按用例 ID 在 [RUNS](RUNS.md) 查构建和结果。一个分支的运行只证明该分支。多条用例并列时，首项给出验收步骤，其余项可提供已有的分支证据。「现行」是产品承诺；候选构建是否通过须查对应运行。「待复验」保留已知缺口，「部分入口待核」区分规则断言与读者操作。已删除编号可查[当时的决定](../../.docs/reqs/2026/11/24/req-production-spec-simplification.md#受影响的现有场景)。

| 原编号 | 读者操作或风险 | 处置 | 受管用例或历史依据 |
| --- | --- | --- | --- |
| <a id="dag-1"></a>1 | 重选后等待确认 | 现行 | [C037](CASES.md#case-c037)、[C005](CASES.md#case-c005) |
| <a id="dag-2"></a>2 | 清空验收要求后收到准备结果 | 现行 | [C038](CASES.md#case-c038)、[C020](CASES.md#case-c020) |
| <a id="dag-3"></a>3 | 只改验收要求 | 现行 | [C039](CASES.md#case-c039) |
| <a id="dag-4"></a>4 | 单幅、首幅及重排 | 部分入口待核 | [C040](CASES.md#case-c040) · 重排按画幅身份验规则；手动重排入口未证实。 |
| <a id="dag-5"></a>5 | 旧绘图在修订后返回 | 现行 | [C041](CASES.md#case-c041)、[C023](CASES.md#case-c023) |
| <a id="dag-6"></a>6 | 放回过期审片 | 现行 | [C039](CASES.md#case-c039) |
| <a id="dag-7"></a>7 | 查找范围变化与晚到结果 | 现行 | [C037](CASES.md#case-c037)、[C001](CASES.md#case-c001)、[C005](CASES.md#case-c005) |
| <a id="dag-8"></a>8 | 部分分镜时同时修改两项设置 | 现行 | [C039](CASES.md#case-c039) |
| <a id="dag-9"></a>9 | 暂停改普通幅、按授权替换首幅 | 现行 | [C040](CASES.md#case-c040) · 部分出图稿的编辑与完成稿的首幅整篇重绘分开执行。 |
| <a id="dag-10"></a>10 | 保存失败与文件可读性 | 现行 | [C042](CASES.md#case-c042)、[C006](CASES.md#case-c006)、[C023](CASES.md#case-c023)、[C031](CASES.md#case-c031) |
| <a id="dag-11"></a>11 | 只恢复两个故障中的一个 | 现行 | [C043](CASES.md#case-c043)、[C004](CASES.md#case-c004)、[C011](CASES.md#case-c011) |
| <a id="dag-12"></a>12 | 并发提交及重放 | 现行 | [C044](CASES.md#case-c044)、[C006](CASES.md#case-c006) |
| <a id="dag-13"></a>13 | 三种状态保存后等待继续 | 现行 | [C045](CASES.md#case-c045)、[C003](CASES.md#case-c003) |
| <a id="dag-14"></a>14 | 确认前保存与刷新 | 现行 | [C038](CASES.md#case-c038)、[C001](CASES.md#case-c001) |
| <a id="dag-15"></a>15 | 在途改名或提交等价设置 | 现行 | [C009](CASES.md#case-c009)、[C010](CASES.md#case-c010)、[C013](CASES.md#case-c013) |
| <a id="dag-16"></a>16 | 配文与画面联动 | 部分入口待核 | [C046](CASES.md#case-c046) · 配文回归可执行；历史所述「同时更新画面描述」复选框缺少现行入口证据。 |
| <a id="dag-17"></a>17 | 只改一人的外观 | 现行 | [C047](CASES.md#case-c047) |
| <a id="dag-18"></a>18 | 放行在相应输入变化后失效 | 现行 | [C048](CASES.md#case-c048)、[C014](CASES.md#case-c014)、[C017](CASES.md#case-c017) · 当前读者操作统一放行本轮所有阻断或待定结论，之后各自按输入失效。 |
| <a id="dag-19"></a>19 | 保护手改配文 | 现行 | [C049](CASES.md#case-c049) |
| <a id="dag-20"></a>20 | 绘图内容拦截 | 现行 | [C050](CASES.md#case-c050) |
| <a id="dag-21"></a>21 | 两篇共用图片服务凭据 | 待复验 | [C051](CASES.md#case-c051) · 早期两篇图片服务故障核查出现逐篇故障；共享文字服务或横图快照阻断的结果不能证明此分支。待隔离复验。 |
| <a id="dag-22"></a>22 | 模型快照与全局设置 | 现行 | [C052](CASES.md#case-c052) |
| <a id="dag-23"></a>23 | 提示词模板升级 | 现行 | [C052](CASES.md#case-c052) |
| <a id="dag-24"></a>24 | 竖图重绘与横图套图 | 现行 | [C053](CASES.md#case-c053) · 旧核查表及 C008 当时要求连带重绘横图；现行独立套图只归原版。 |
| <a id="dag-25"></a>25 | 确认后改重点或更新建议 | 现行 | [C054](CASES.md#case-c054) |
| <a id="dag-26"></a>26 | 同输入的新幅复用旧图 | 现行 | [C041](CASES.md#case-c041) |
| <a id="dag-27"></a>27 | 把历史版设为当前 | 不提供 | 历史版保持可读，不能设为当前；[现行场景矩阵](../../.docs/story-production-dag.md#完整场景矩阵) · [旧核查](../../.docs/tests/test-data-driven-production-dag.md#逐场景路径与验收) |
| <a id="dag-28"></a>28 | 换画风时保留手改 | 现行 | [C055](CASES.md#case-c055) |
| <a id="dag-29"></a>29 | 编排内容拦截 | 现行 | [C050](CASES.md#case-c050) |
| <a id="dag-30"></a>30 | 40 幅中的局部审片 | 现行 | [C056](CASES.md#case-c056) · 旧核查看作建议；当前丢弃超出允许清单的判断。 |
| <a id="dag-31"></a>31 | 多幅一次审片 | 现行 | [C056](CASES.md#case-c056) |
| <a id="dag-32"></a>32 | 条目依据复核 | 已删除 | 按条目依据单独复核；[取消依据](../../.docs/reqs/2026/11/24/req-production-spec-simplification.md#受影响的现有场景) · [旧核查](../../.docs/tests/test-data-driven-production-dag.md#逐场景路径与验收) |
| <a id="dag-33"></a>33 | 预览手改损失 | 现行 | [C057](CASES.md#case-c057)、[C002](CASES.md#case-c002) |
| <a id="dag-34"></a>34 | 合并拆分后的身份 | 现行 | [C057](CASES.md#case-c057) · 旧核查保留合并首幅和拆分首段身份；目前新幅均获新身份。 |
| <a id="dag-35"></a>35 | 描述入画与配文提及 | 现行 | [C016](CASES.md#case-c016) 正式绘图与配文对照；[C036](CASES.md#case-c036) 编辑器提示待验 |
| <a id="dag-36"></a>36 | 15 幅批量修改 | 现行 | [C056](CASES.md#case-c056) |
| <a id="dag-37"></a>37 | 用尽 20 次修复额度 | 现行 | [C058](CASES.md#case-c058)、[C014](CASES.md#case-c014) |
| <a id="dag-38"></a>38 | 多类旧作品同次升级 | 现行 | [C059](CASES.md#case-c059) · 原编号 44–46 退役；整库备份、恢复与零推理仍须按现行升级规则实测。 |
| <a id="dag-39"></a>39 | 清理建议 | 已删除 | 范围外建议的清理；[取消依据](../../.docs/reqs/2026/11/24/req-production-spec-simplification.md#受影响的现有场景) · [旧核查](../../.docs/tests/test-data-driven-production-dag.md#逐场景路径与验收) |
| <a id="dag-40"></a>40 | 画风转换的输入指纹 | 现行 | [C055](CASES.md#case-c055) |
| <a id="dag-41"></a>41 | 首批及后续编排 | 现行 | [C060](CASES.md#case-c060) |
| <a id="dag-42"></a>42 | 丢失第 2 幅时只改第 20 幅 | 现行 | [C061](CASES.md#case-c061) · 旧核查及 C015/C022 要求同输入继承丢图故障等待授权；现行新版补缺图，原版保留故障。 |
| <a id="dag-43"></a>43 | 结构修订遇到手改 | 现行 | [C049](CASES.md#case-c049) |
| <a id="dag-44"></a>44 | 旧规则升级后重绘 | 已删除 | 旧规则升级后重绘门槛；[取消依据](../../.docs/reqs/2026/11/24/req-production-spec-simplification.md#受影响的现有场景) · [旧核查](../../.docs/tests/test-data-driven-production-dag.md#逐场景路径与验收) |
| <a id="dag-45"></a>45 | 旧规则放行 | 已删除 | 转换旧规则放行；[取消依据](../../.docs/reqs/2026/11/24/req-production-spec-simplification.md#受影响的现有场景) · [旧核查](../../.docs/tests/test-data-driven-production-dag.md#逐场景路径与验收) |
| <a id="dag-46"></a>46 | 旧 0025 升级演练 | 已删除 | 单独验证旧 0025 升级路径；[取消依据](../../.docs/reqs/2026/11/24/req-production-spec-simplification.md#受影响的现有场景) · [旧核查](../../.docs/tests/test-data-driven-production-dag.md#逐场景路径与验收) |
| <a id="dag-47"></a>47 | 把身份揭示移到开头 | 部分入口待核 | [C062](CASES.md#case-c062) · 受控结构修订可重排；读者手动重排入口未证实。 |
| <a id="dag-48"></a>48 | 读者改写结语 | 现行 | [C062](CASES.md#case-c062) |
| <a id="dag-49"></a>49 | 叙事、人物与画面描述依赖 | 现行 | [C060](CASES.md#case-c060) · 现行首批合并编排；单幅描述的就绪由依赖断言验证，不能据此要求额外的独立派发。 |
| <a id="dag-50"></a>50 | 内容拦截时其余幅继续 | 现行 | [C043](CASES.md#case-c043)、[C011](CASES.md#case-c011) |
| <a id="dag-51"></a>51 | 按输入继承故障 | 已删除 | 按输入继承待匹配故障；[取消依据](../../.docs/reqs/2026/11/24/req-production-spec-simplification.md#受影响的现有场景) · [旧核查](../../.docs/tests/test-data-driven-production-dag.md#逐场景路径与验收) |
| <a id="dag-52"></a>52 | 超出允许清单的审片返回 | 现行 | [C056](CASES.md#case-c056) · 旧核查保留范围外建议；现行直接丢弃。 |
| <a id="dag-53"></a>53 | 首次登记结语条目 | 已删除 | 先登记结语条目再审核；[取消依据](../../.docs/reqs/2026/11/24/req-production-spec-simplification.md#受影响的现有场景) · [旧核查](../../.docs/tests/test-data-driven-production-dag.md#逐场景路径与验收) |
| <a id="dag-54"></a>54 | 追加登记条目 | 已删除 | 追加或重新登记条目；[取消依据](../../.docs/reqs/2026/11/24/req-production-spec-simplification.md#受影响的现有场景) · [旧核查](../../.docs/tests/test-data-driven-production-dag.md#逐场景路径与验收) |
| <a id="dag-55"></a>55 | 单幅故障期间任务继续领取 | 现行 | [C043](CASES.md#case-c043)、[C011](CASES.md#case-c011) |
| <a id="dag-56"></a>56 | 三类文字调用的输入契约 | 现行 | [C063](CASES.md#case-c063) · 旧核查曾列条目登记；现行核对的第三类请求是审片。 |
| <a id="dag-57"></a>57 | 原版横图输入与打印 | 现行 | [C053](CASES.md#case-c053) · 旧核查要求该横图失效；现行原稿套图可打印。 |
| <a id="dag-58"></a>58 | 首次选择标题结语并放行 | 现行 | [C048](CASES.md#case-c048)、[C017](CASES.md#case-c017) · 旧核查只放行目标结论；现行操作放行所有待定或阻断项，各自绑定输入。 |
| <a id="dag-59"></a>59 | 横图失败时仍可导出 | 现行 | [C064](CASES.md#case-c064)、[C026](CASES.md#case-c026) |
