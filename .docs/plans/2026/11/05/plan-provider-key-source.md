# 按生产任务读取保存配置

Base: `75f712f`。独立worktree `/tmp/shiqu-provider-key-source`，保留主工作区其他任务与LAN验收文档。Risk: non-low — 生产调度、模型/凭据快照及共享配置热更新。

## 设计

现有settings handler在内部提供有效变量读取方法，复用shared store+effectiveProviderVariables+原启动覆盖。dev/CLI与desktop将该读取函数传给createApplication；固定路径/端口/所有权/SQLite与协调器不重启。完全显式启动配置仍可在store损坏时使用原显式配置；普通新任务在配置不可读时安全拒绝，不默默用旧配置计费。

app以有效providerSignature缓存当前不可变提供方（含withLocalBooks），每次新任务capture读取同一保存配置与启动覆盖，签名改变才构建新提供方。所有代际共用同一StoryDiscoveryCache，使busy/settle保留旧代际在途发现。稳定ReaderProvider门面通过属性读取绑定当时的实例，capture返回不可变实例；status与直接generator/推荐调用也绑定一次。safeError及busy/settle不触发新的配置读取。

ReaderProvider增加可选capture（返回null表示同一代际不能生成，capture只读取一次配置）。生产coordinator在discover/script/image处理器入口、任何await前capture；以job id保留实例，超时/错误使用同一实例，队列结算后通过现有onSettled清理。无需改ProductionQueue契约。新任务canRun通过capture作提前门控；处理器入口再capture，以同一个代际判断可生成与固定实例，返回null时JobYield不消费计费尝试。只读/缺key不关闭coordinator，故保存可用配置后下一tick即可继续；本地image-publish不受该闸影响。headless/显式autoStart=false与静态generation夹具行为保持。直接付费API在requireProvider处固定实例，普通书架读取不访问生成设置库。

settings view保留keyPresent，增加keyOverrides布尔与appliesToNewJobs布尔；正式热更新服务runtime表示下一任务的配置，restartRequired保留兼容字段但这些入口恒false。普通handler测试/无live源保留旧静态runtime语义。UI正式入口不再显示待重启/重启文案，摘要命名新任务配置；未支持热更新的旧响应仅显示保存值而不伪称已应用。取消未落地launchMode/restartAvailable/restart方案。keep验证启动覆盖优先，不写环境key；用户要求保存的Geminikey已显式持久化，不能当作一般自动持久化规则。

## 任务

- [x] 已完成的密钥有界探针：隔离无已存Gemini key+有效启动key，正式handler保存Codex文本/Gemini图片成功，数据库key仍空；无覆盖时keep失败（1/1）。
- [x] 首项新SS探针：隔离正式app和生产协调器，保持一项旧配置任务在途，修改保存值后下一项任务使用新实例，旧任务不变；若无法固定快照则停止并回AR。
- [x] 实现handler变量源、app门面/共享发现cache、coordinator每任务capture与只读可恢复调度；移除未落地重启方案。
- [x] 更新UI密钥来源/新任务配置/保存反馈与重新读取含义，同步文档/技能与既有测试覆盖清单。
- [x] 独立worktree预览pnpm test:changed --plan，按实际影响执行JS/typecheck/lint/native及匹配E2E；CR/VR按skill独立审查，不绕过full回退。
- [ ] 合入主工作区并核对生产API的Codex/Gemini下一任务配置与Gemini key存在，不测试真实推理。

场景：`.docs/tests/test-provider-key-source.md`。IAB已知被Work设置禁用，自动化必要时采用隔离Chromium并披露；不触碰用户浏览器、不打包。工作区node_modules软链接只供依赖复用，须从本地git exclude排除，不能导致未知路径回退。

## 阶段

需求以用户“Apply to new jobs without restarting”及“Remove code for restarting”补充为准。原手动重启/新restartAPI方案AR作废；没有实施新的restart handler/应用重建容器。AR passed: no blocking architecture flaws
AR risk: non-low — 生产任务按代际固定提供方与凭据，新任务读取共享配置。
AR review round: 2; reviewer: reused (`lan_settings_review`)。

实施约束已纳入：capture同一代际门控；safeError/timeout/退出固定；同一cache跨代际；只读可恢复；只有CLI既有完整显式启动分支设置explicitSettingsBypass；原生路径/端口保持启动值。

新SS探针1/1通过：同一正式协调器里旧image步骤保持old模型及111秒超时；切readonly后原图片完成发布而新image attempts=0；保存可用new模型后剩余6幅继续并使用new实例，无重启。首轮断言误用8幅，正式夹具按推荐7幅完成；修正夹具期望后通过，快照方案成立。

SS 实现完成：新任务源/固定代际/只读门控/来源UI已落到正式工作流。聚焦44/44（保存/覆盖/生产快照/旧错误/退出cache/配置故障读取）；实际dev+完整LAN浏览器2/2；typecheck/lint通过。没有新增restart handler、重启容器或配置热更新之外的启停权限。

影响计划：172文件，full=true、native=true。触发项是必需的共享 `lib/reader-api.ts` 请求内快照绑定（不再是仅提示文字），此外生产调度接口本身也有变更。按现有规则执行，不绕过回退。独立worktree无并行手机修改或未登记测试。

TT 首轮全量稳定80eea3f已完成：172文件、1445项，1443通过、2失败；失败均是全显式CLI且没有settings文件时，热读取误创建DB，违反原启动契约（/tmp/shiqu-live-provider-full.log）。已将内部变量源改为existingOnly，只有原显式分支回退启动变量；public settings GET保留既有显式访问行为。

CR round1 blocked于capture=null直接API回退、旧响应UI误承诺热更新、残留文档重启说明。修正了null直接503与live status readiness，添加null/非法key直接API零调用及旧响应浏览器回归，文档统一。原全量中不受这些修正影响的通过证据复用；下一轮针对所有直接app/API消费者及CLI/UI/元数据测试验证，不重复已通过的无关生产矩阵。

CR修正已完成：null capture不再回退live门面，直接付费请求立即503；live status把同次快照ready与提供方状态合并。内部变量读取existingOnly，缺/坏store仅原显式启动分支允许旁路。旧响应UI中性显示，不承诺热更新。剩余指南的重启规则已删除。typecheck/lint复核通过；完整CLI启动矩阵、local-server新null/非法key零调用与完整UI旧响应兼容回归通过（/tmp/shiqu-live-provider-corrections.log）。

原生源码24/24与fmt已通过（1打包资源用例按既定source规则过滤），源不涉及Rust/IPC/存储格式。UI使用已知IAB禁用后的隔离Chromium；390/1040截图已查看，密钥来源、保存反馈及按钮无横溢。

TT 修正闭环：完整CLI启动+direct API+旧响应UI 27/27通过；按manifest直接消费者20文件full flags复核218项，217通过，1个fresh-desktop断言只因提示文字不含既有“配置生成服务”短语失败。保留既有错误文案后，最终desktop/local-server/完整UI 26/26通过；UI同时补旧响应reset中性反馈，删除密钥文案不承诺旧服务热更新。最终typecheck/lint通过，原生24/24与fmt证据不受这些TS/文案修正影响。日志：/tmp/shiqu-live-provider-corrections.log、/tmp/shiqu-live-provider-consumers.log、/tmp/shiqu-live-provider-final.log。合并复用原全量1443个未受影响pass、已修复启动矩阵和所有修正受影响消费者；不声称原full命令退出0，也不重复未受影响的全书/提供方矩阵。

CR round2：CR fixed: 已修正null快照门控、旧响应宣称、显式启动DB副作用及冲突文档；rerun result passed。CR risk: non-low；CR review round: 2; reviewer: reused。最后仅调整错误提示兼容及旧响应reset中性反馈，待最终复核。
