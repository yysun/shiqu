# 拾趣开发指南

[返回 README](../README.md) · [使用指南](user-guide.md) · [桌面开发与打包](../desktop/README.md)

- [本地启动](#本地启动)
- [服务与数据目录](#服务与数据目录)
- [生成服务配置](#生成服务配置)
- [本地检查与桌面开发](#本地检查与桌面开发)
- [故事生成机制](#故事生成机制)
- [图片请求与展示](#图片请求与展示)

## 本地启动

前端为 React + Vite，后端为 Node REST API，数据使用 Node 内置 SQLite 和本地媒体目录。开发只需 **Node 24.22.1** 与 **pnpm 11.25.0**，无需独立数据库。

```bash
nvm install
nvm use
corepack enable pnpm
pnpm run setup
pnpm dev
```

## 服务与数据目录

发布的 CLI 使用 `pnpm dlx @apprun/shiqu`，入口 `server/cli.ts → server/start.ts`，不导入或启动 `server/desktop.ts` / Tauri。CLI 与桌面共用系统配置数据库 `desktop.sqlite`（协议版本 2），包含独立非密钥设置 JSON、revision 和按提供方分开的凭据；故事数据库不保存全局密钥。CLI 目录选择与服务首次问答、`--configure`、`--reset-providers` 见[使用指南](user-guide.md#cli-启动)。环境/显式配置文件仅覆盖本次调用，不自动持久化。原 CLI 的目录 JSON 只作迁移输入，之后两端使用同一个已确认书库。

打开终端打印的本机访问地址；手机使用同一终端中的局域网二维码。默认前端端口为 `3000`，API 为 `3002`。与桌面版同时运行时可用：

```bash
SHIQU_API_PORT=3003 pnpm dev --port 3001
```

开发版从 `.env` 读取 AI 配置，**不读取桌面保存的密钥**。默认书架跟随桌面版的数据目录；可用 `SHIQU_DATA_DIR` 显式覆盖。两端共享书架时均需使用当前版本，两端均无需配对。私有书库及备份不得放入 Vite 的 `public` 目录。

## 生成服务配置

CLI 和桌面普通运行无需预设环境变量：首次问答/设置页面保存后复用。下面变量用于开发入口或本次调用覆盖。

OpenAI API 示例：

```dotenv
SHIQU_AI_PROVIDER=openai
OPENAI_API_KEY=your-key
OPENAI_TEXT_MODEL=gpt-6.1-sol
OPENAI_IMAGE_MODEL=gpt-image-2.5-sunburst
```

提供方使用固定官方域名：文本走 [Responses Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)，图片走 [Images generation/edits](https://developers.openai.com/api/docs/guides/image-generation)。文本设置 `store:false`、按任务发送推理档位；图片后续幅使用本地已保存首幅作参考，只接收校验后的 base64 图片。错误不回显提供方正文或密钥，无自动降级计费。`readonly` 阻断阅读队列及历史 admin 生成。

系统配置迁移与校验由 `server/system-settings.ts` 和 `src-tauri/src/config.rs` 共同遵循，TypeScript/Rust 测试实际互读同一数据库。版本 1 迁移保留旧设置与 Gemini 密钥；桌面保存以 revision 拒绝过期快照，CLI 事务 patch 保留其他入口的新值。真实密钥不进入 tests、打包输入或浏览器。

Codex 配置示例（先安装并登录 CLI）：

```bash
pnpm add -g @openai/codex@0.165.0
pnpm run codex:login
pnpm run codex:status
```

```dotenv
SHIQU_AI_PROVIDER=codex
CODEX_MODEL=gpt-6.1-sol
CODEX_REASONING_EFFORT=low
```

### 文本任务推理预算

文本任务独立分配推理预算：`SHIQU_REASONING_SUGGEST=medium`（选题）、`SHIQU_REASONING_ART=low`（画风）、`SHIQU_REASONING_FRAMES=medium`（画幅数）、`SHIQU_REASONING_OUTLINE=high`（提纲）、`SHIQU_REASONING_PLAN=high`（分镜）、`SHIQU_REASONING_REVIEW=high`（初审/复核）、`SHIQU_REASONING_REPAIR=high`（修订）。结语撰写沿用分镜档位，结语修订沿用修订档位。这些也是缺省值，可逐项覆盖；不自动升档。Codex 支持 low/medium/high/xhigh/max，具体取决于模型和 CLI；Gemini 支持 low/medium/high，不支持值报错，不静默降档。旧 `CODEX_REASONING_EFFORT` 仍用于未分类及图片工具调用，不再覆盖已分类文本任务，也不代表图片质量。已生成步骤不因改档重做；新选题和画风缓存按对应档位隔离。生成检查点用量记录中的 `reasoningEffort` 对 Codex 是线程确认值，对 Gemini / OpenAI API 是请求值。

### 真实审核对比

显式真实审核对比（会使用现有 Codex 订阅；普通测试不会运行）：

```bash
pnpm exec node --env-file-if-exists=.env --experimental-strip-types scripts/compare-storyboard-reasoning.mjs --input /absolute/path/to/before-row.json --out .data/evidence/reasoning-comparison --model gpt-6.1-sol --effort medium
```

将 `--effort` 依次改为 high、xhigh，保持相同输入、模型和输出目录。输入为含 `selection`、`document` JSON 字符串的单条故事备份；脚本只审核，输出完整报告、实际档位、输入及请求哈希、用量和耗时，不生成图片、不写书库。成功结果再次运行直接复用；失败单独留档。各档一次只提供案例观察，不代表稳定优劣。

其他变量见 [.env.example](../.env.example)，修改后重启服务。无浏览器设备可用 `pnpm run codex:login -- --device-auth`。

## 本地检查与桌面开发

常用检查：

```bash
pnpm test
pnpm typecheck
pnpm lint
```

测试使用模拟模型响应，不发起付费生成。桌面 UI 使用 Vite 开发服务器验证；只有需要打包时才运行构建命令。桌面开发、平台依赖和打包说明见 [desktop/README.md](../desktop/README.md)。主要代码位于 `client/`（界面）、`lib/`（业务逻辑）、`server/`（HTTP 与存储）、`db/` 与 `drizzle/`（数据库）、`desktop/` 与 `src-tauri/`（桌面版）。

桌面版只保留内置 Node 的一个发行，不再提供系统 Node 版本；构建脚本与 CI 也只打包这一版本。桌面 UI 使用 `pnpm desktop:preview`，在应用内浏览器验证。Docker 镜像和桌面应用只在明确需要构建或打包时执行相应命令。

## 故事生成机制

超过 20 幅时先制定全篇提纲，再按每批最多 20 幅编排分镜；每批完成即保存，失败或暂停后复用已保存批次。

新生成分镜全部保存后，再结合已核原文和完整分镜，一次生成三个有实际区别的结语候选；候选保存后，由全篇审核显式接收主题和制作要求，对照原文择优：原文决定是否成立，主题参与合格句之间的取舍，不为套题曲解事实或强造反转；记录所选编号与理由，并原样采用该句，不增加单独的择优请求。没有合格候选时才修订所选句，再复核。结语失败只重试结语，不重新编排已保存分镜。

之后进入文本队列全篇审片，一起检查分镜的动作、画面、递进、连续性、原文事实，以及结语的立意是否符合完整因果与最终结局、表达是否只是重复情节或人物动机。结语采用独立提示词，生成与审核共享标准：理解必须完整，表达可以简洁抽象；能用于别的生活处境不等于空泛，写入更多故事细节也不等于更有余味。审核会对照全篇尤其是末幅，要求将剧情注解重新提炼为一层认识或感受。

审核还会检查是否存在明显更好的结语：有原文依据的意味损失或表达弱化，即使不构成事实错误也可要求改善，但须说明保留什么、改进方向及具体收益；同等成立的另一种读法不触发改写。

按需修订问题画幅，每批最多 20 幅；结语有问题则在问题画幅修好后单独重写，再复核全篇。只改结语不触发重绘。审核、修复、复核组成闭环，最多自动修复 3 轮；修复没有实际变化或到上限仍未通过时保留问题、批次进度和历史并停止，可手动继续；审片通过后才开始绘图。旧故事已有完整分镜不自动追加审片调用。

### 请求次数与缓存

画风推荐随选题给出，不单独增加模型调用；插图数量建议会增加一次文本请求，分镜后的三个结语候选合用一次文本请求，择优并入原有全篇审核，不额外增加请求。建议会保存在书架，稍后继续无需重复推荐。详略不对应固定幅数，短故事不会强行凑页。

应用使用单一本地书架，不设用户计费、Token 扣减或生成次数配额。模型输入分块、输出长度、并发和自动重试保护用于保证生成稳定；上游服务的权限、计费和额度仍由提供方决定。

暂停、恢复、失败重试与版本修改对用户的影响见[使用指南](user-guide.md#制作与阅读故事)。

## 图片请求与展示

新生成插图按 **9:16 竖幅**构图。Codex 通过提示词请求 864 × 1536，OpenAI API 直接请求该尺寸；Gemini 请求原生 9:16 / 1K。返回图片只检查格式与尺寸元数据是否有效，不设置分辨率、比例或最低尺寸的拒收门槛，也不裁切、拉伸或补边。手机阅读页在 9:16 范围内等比完整展示原图。后台兼容图片接口的 `IMAGE_SIZE` 默认 `864x1536`；自定义请求尺寸仅按[官方支持规则](https://developers.openai.com/api/docs/guides/image-generation#size-and-quality-options)校验（9:16、宽高为 16 的倍数、最长边不超过 3840 像素、总像素为 655,360–8,294,400），不将请求尺寸用作返回图片的保存门槛。
