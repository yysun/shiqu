# 拾趣 · Shiqu

用拾趣，把中国古典故事变成你自己的连环画。支持电脑与手机阅读，以及 PDF、PNG 长图和 ZIP 导出。故事、图片和阅读进度保存在你的电脑上。

[在线阅读拾趣好故事 →](https://yysun.github.io/awesome-shiqu/)

## 快速开始制作

三种方式，任选一种：

### 1. npx：一条命令启动

需要 **Node 24**：

```bash
npx @apprun/shiqu
```

按提示选择书库和生成服务，打开终端打印的网址即可使用。同一可信 Wi-Fi 下，手机可扫描终端二维码接着读。保持终端运行，按 Ctrl+C 停止。[CLI 使用说明](https://github.com/yysun/shiqu/blob/main/.docs/user-guide.md#cli-启动)

在本机或可信局域网地址打开「我的 → 生成服务与模型」，可修改与桌面/CLI/技能共用的提供方、模型、推理和 API 密钥。页面区分已保存值与新任务配置；保存后用于新任务，无需重启，显式环境/配置文件覆盖仍优先。已保存密钥不会返回浏览器，手机也可通过可信局域网地址编辑；互联网隧道和跨站页面不提供此能力。局域网设备共享配置权限，新输入密钥经 HTTP 提交，仅在可信网络使用。

### 2. Desktop：下载安装

内置 Node，无需另装运行环境。支持 Apple Silicon Mac（macOS 13.5+）和 Windows 10/11 x64。

[下载 macOS DMG](https://github.com/yysun/shiqu/releases/latest/download/shiqu-standard-macos-arm64.dmg) · [下载 Windows 安装程序](https://github.com/yysun/shiqu/releases/latest/download/shiqu-standard-windows-x64-setup.exe) · [版本与校验文件](https://github.com/yysun/shiqu/releases/latest)

打开拾趣，在「设置」中选择生成服务，保存并启动，再点击「在浏览器打开」。安装包未签名，首次打开的系统提示见[桌面版入门](https://github.com/yysun/shiqu/blob/main/.docs/user-guide.md#桌面版入门)。

### 3. Skill：让 Codex 帮你制作

普通 NPX 服务或桌面「启动服务」成功后会自动准备当前用户的技能。桌面内置 CLI，无需系统 Node/npm；NPX 使用需要 **Node 24**。也可手动安装：

```bash
npx @apprun/shiqu skill install --scope global
```

安装后，Codex 优先使用已登记的桌面内置 Node/CLI，其他安装通过 `npx --yes @apprun/shiqu@<技能版本>` 调用，无需 pnpm。启动仅按已有自动更新同意同步随包技能，保留用户修改和宿主停用选择。`skill auto-install off` 关闭启动集成；`SHIQU_SKILL_AUTO_INSTALL=off` 仅跳过本次，不改变更新同意。不会全局安装 `shiqu` 命令；源码开发仍使用 `pnpm cli`。

然后在 Codex 中说：

```text
$shiqu 从《庄子》中找一个关于善意与误解的故事，用水墨写意。
先给我候选和制作方案，确认后再生成插图，完成后导出离线预览和公开 ZIP。
```

独立 CLI 无需服务；操作同一书库前先安全停止占用它的服务。[提示词示例](https://github.com/yysun/shiqu/blob/main/.docs/use-as-skill.md) · [技能安装与配置](https://github.com/yysun/shiqu/blob/main/.docs/user-guide.md#无服务-cli-与-codex-技能)

生成服务可选 Codex、OpenAI API 或 Gemini，也可选择只读。Codex 需 macOS / Linux，并另行安装和登录 Codex CLI；OpenAI API 与 Gemini 使用各自 API 密钥并单独计费。[如何选择后端](https://github.com/yysun/shiqu/blob/main/.docs/user-guide.md#如何选择后端)

## CLI 命令

以下命令均加上前缀 `npx @apprun/shiqu`。不带子命令时启动浏览器服务；带子命令时直接操作本地书库。执行书库命令前，先停止占用同一书库的服务。

| 命令 | 用途 |
| --- | --- |
| `help --json` | 查看命令目录、参数、JSON 输入与示例 |
| `init`, `status` | 显式初始化书库，或检查书库完整性与数量统计 |
| `catalog`, `books`, `themes`, `styles` | 列出书籍、主题和画风 |
| `books contents BOOK_ID --query TEXT` | 浏览或搜索书籍的章节和可用的故事段落，查询条件可省略 |
| `books search TEXT [BOOK_ID] --limit 5` | 按标题、梗概、原文和可用参考向量检索故事候选。仅安装一本书的索引时可省略书名，返回原文预览与出处，无需启动服务或调用模型。加 `--brief` 只显示书名、索引中的故事标题、章节和段落 |
| `stories list`, `stories get ID`, `stories current ID` | 查看故事列表、故事详情与当前版本 |
| `stories create --input FILE` | 保存新故事的选题条件 |
| `stories setup`, `stories search`, `stories choose`, `stories confirm` | 设置要求、查找候选、选择故事与确认制作 |
| `books index-import BOOK_ID FILE --data-dir DIRECTORY` | 安装一本书的离线 SQLite 索引，核对书名、原文版次与出处后更新该书的索引 |
| `run ID`, `stories run ID` | 制作指定故事；`--until` 可选 candidates、prepared、reviewed 或 completed。该书有索引时，提取会先核对候选原文。没有可用候选时逐章阅读选定范围。自动选题的双词预设须在同一篇原文中找到两侧及其联系，例如「善意与误解」须有善举及由此产生的误解 |
| `stories edit ID --input FILE` | 使用 `stories revisions ID` 返回的 token 保存修改版本 |
| `stories pause`, `stories resume`, `stories stop` | 暂停、恢复或停止故事制作 |
| `stories retry`, `stories override` | 重试当前故障，或明确跳过审核问题 |
| `stories rename`, `stories delete`, `stories restore`, `stories favorite`, `stories reference` | 改名、删除、恢复、收藏故事，或设置本书参考图 |
| `stories revisions`, `stories prompts`, `stories review-history`, `stories source` | 查看版本、提示词、审核记录与原文 |
| `stories reselect`, `stories replace`, `stories cancel-reselection` | 发起、应用或取消重新选题 |
| `preview ID --output FILE` | 导出可独立打开的离线 HTML 预览 |
| `export ID --format FORMAT --output FILE` | 导出 json、md、zip、pdf 或 png |
| `skill show`, `skill install`, `skill check`, `skill update`, `skill auto-install` | 查看、安装、检查、更新技能或设置启动安装偏好 |
| `config get`, `config set`, `config reset` | 查看、保存或重置共享生成服务配置 |
| `backup DIR`, `verify-backup DIR`, `restore DIR`, `diagnostics FILE` | 备份、校验、恢复书库，或导出脱敏诊断 |
| `api METHOD reader/ROUTE` | 在当前进程调用允许的 reader 接口 |

源码工作树可为单本书制备索引。《聊斋志异》《世说新语》《战国策》《子不语》《喻世明言》沿用已有篇目边界，其他书先用模型判断故事边界。《喻世明言》按整卷生成主故事摘要，并用片段向量覆盖全卷。制备脚本使用本机 Ollama 生成向量。以《世说新语》为例，单独调用 `cards` 可指定 Codex 订阅的 Luna 生成摘要。

```bash
node scripts/experiment-soushen-search.mjs build --raw --book 世说新语
node scripts/experiment-soushen-search.mjs cards --book 世说新语 --model gpt-6-luna
node scripts/experiment-soushen-search.mjs refs --book 世说新语
pnpm run cli books index-import 世说新语 .data/story-index-build/shishuo.sqlite --data-dir .data/dev-local
```

需要语义切分的书可在 `build --raw` 上加 `--boundary-model gpt-6-luna`。例如 `node scripts/experiment-soushen-search.mjs build --raw --book 庄子 --volume 3 --boundary-model gpt-6-luna` 只制备《养生主》。同一个索引后续建库须沿用切分模型。

只有显式 `run` 执行 AI 生成，其他命令只查看或保存状态。故事操作需传入故事 ID；选题操作还需 `--generation N`。JSON 输入使用 `--input FILE`，或用 `--input -` 从标准输入读取。各命令的必填字段与恢复规则见 `help --json`。

用 `--data-dir DIR` 指定书库。ZIP、PDF、PNG 要求当前版本全部图片完成，导出路径必须尚不存在。恢复书库需显式指定尚不存在的 `--data-dir DIR`。[完整命令流程](https://github.com/yysun/shiqu/blob/main/.docs/user-guide.md#直接使用命令) · [备份、恢复与诊断](https://github.com/yysun/shiqu/blob/main/.docs/user-guide.md#书库维护命令)

### 浏览器服务启动参数

| 参数 | 用途 |
| --- | --- |
| `--port PORT`, `--host ADDRESS` | HTTP 端口（默认 3000）与监听地址（默认 0.0.0.0）；仅限本机访问时使用 `--host 127.0.0.1` |
| `--data-dir DIR`, `--config FILE` | 指定书库目录，或加载指定的环境配置文件 |
| `--configure`, `--reset-providers` | 配置或清除已保存的生成服务设置与密钥 |
| `--backup DIR`, `--verify-backup DIR`, `--restore DIR`, `--diagnostics FILE` | 维护命令的参数形式，每次单独执行一项 |
| `--help`, `--version` | 查看启动帮助或当前版本 |

## 更多说明

[使用指南](https://github.com/yysun/shiqu/blob/main/.docs/user-guide.md) · [手机阅读](https://github.com/yysun/shiqu/blob/main/.docs/user-guide.md#在手机上阅读) · [制作与导出](https://github.com/yysun/shiqu/blob/main/.docs/user-guide.md#制作与阅读故事) · [常见问题](https://github.com/yysun/shiqu/blob/main/.docs/user-guide.md#常见问题)

## 开发者

源码开发使用 **Node 24.22.1** 与 **pnpm 11.25.0**：

```bash
nvm install
nvm use
corepack enable pnpm
pnpm run setup
pnpm dev
```

桌面 UI 预览用 `pnpm desktop:preview`，源码目录的 CLI 帮助用 `pnpm cli help --json`。[开发指南](https://github.com/yysun/shiqu/blob/main/.docs/development.md) · [桌面开发与打包](https://github.com/yysun/shiqu/blob/main/desktop/README.md)

## 来源与许可

项目原创代码与文档采用 [Apache-2.0](https://github.com/yysun/shiqu/blob/main/LICENSE)，另见 [NOTICE](https://github.com/yysun/shiqu/blob/main/NOTICE)。古典原文遵循各自的[来源许可](https://github.com/yysun/shiqu/blob/main/data/library/source-notices.md)。生成的故事与插图不会自动适用代码许可，分享前请检查[署名与转载说明](https://github.com/yysun/shiqu/blob/main/.docs/user-guide.md#署名与转载)及 [ZIP 内容](https://github.com/yysun/shiqu/blob/main/.docs/user-guide.md#zip-内容与提示词分享)。
