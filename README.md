# 拾趣

用拾趣，把中国古典故事变成你自己的连环画。内置 24 部书籍、15 种画风，支持电脑与手机阅读，以及 PDF、PNG 长图和 ZIP 导出。故事、图片和阅读进度保存在你的电脑上。

[![拾趣作品《黛玉葬花与宝黛释疑》第 15–18 幅：宝玉兜着落花走近花冢，黛玉葬花吟诗、掩面落泪](.docs/assets/hero-story.webp)](https://yysun.github.io/awesome-shiqu/books/红楼梦/黛玉葬花与宝黛释疑/)

[在线阅读拾趣好故事 →](https://yysun.github.io/awesome-shiqu/)


## 快速开始制作

AI 生成服务可选 Codex 订阅、OpenAI API 或 Gemini。Codex 订阅需 macOS / Linux 并安装和登录 Codex CLI；OpenAI API 与 Gemini 使用各自 API 密钥并单独计费。[如何选择后端](.docs/user-guide.md#如何选择后端)

三种方式开始制作你的连环画，任选一种：

### 1. npx：一条命令启动

安装 **Node 24** 后，在终端运行：

```bash
npx @apprun/shiqu
```

按提示选择书库和生成服务，打开终端打印的网址即可使用。同一 Wi-Fi 下，手机可扫描终端二维码接着读；保持终端运行，按 Ctrl+C 停止。

> 默认对局域网开放，所有可连接设备共享书架和生成权限，可信局域网设备也可修改共享模型与服务配置，仅限可信网络使用；只允许本机访问时加 `--host 127.0.0.1`。API 密钥以明文保存在本机设置数据库中。详见[使用前了解](.docs/user-guide.md#使用前了解)。

[CLI 使用说明](.docs/user-guide.md#cli-启动)

### 2. Desktop：下载安装

内置 Node，无需另装运行环境。支持 Apple Silicon Mac（macOS 13.5+）和 Windows 10/11 x64。

[下载 macOS DMG](https://github.com/yysun/shiqu/releases/latest/download/shiqu-standard-macos-arm64.dmg) · [下载 Windows 安装程序](https://github.com/yysun/shiqu/releases/latest/download/shiqu-standard-windows-x64-setup.exe) · [所有版本与校验文件](https://github.com/yysun/shiqu/releases/latest)

安装后打开拾趣，在「设置」中选择生成服务，保存并启动，再点击「在浏览器打开」。安装包未签名，首次打开的系统提示见[桌面版入门](.docs/user-guide.md#桌面版入门)。

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

独立 CLI 无需服务；操作同一书库前先安全停止占用它的服务。[提示词示例](.docs/use-as-skill.md)



## 制作与阅读界面

以《黛玉葬花与宝黛释疑》为例：发现 → 制作流程 → 书架 → 阅读。

[![拾趣手机界面：《黛玉葬花与宝黛释疑》的发现、制作流程、书架与阅读](.docs/assets/daiyu-phone-screens.webp)](.docs/user-guide.md#制作与阅读故事)

[制作与阅读指南 →](.docs/user-guide.md#制作与阅读故事)

## 五模型实作对比

同一段《西游记·路阻火焰山》原文、适中详略、自动幅数，Gemini Flash、Gemini 4 Argon 与 Codex 分别通过 **16、41、70 幅**；DeepSeek 与 Claude 分别保存 **50、67 幅待审稿**。对比具体情节、静态画面、审核修订及完成度；已有插图均由 Gemini 生成。

[阅读中文对比：制作条件、审核差异与五版完整 244 幅配文（含待审稿） →](.docs/reports/2026/11/05/model-comparison-huoyanshan.md)

## 导出与发布

全部插图生成后，在「故事设置」或故事末页导出：

- **PDF**：逐幅阅读，适合打印或发送。
- **PNG**：全部插图排成一张总览长图，适合社交分享。
- **ZIP**：原文、分镜、全部 WebP 原图及制作提示词，可用于投稿。

导出在本地完成，不再调用 AI。先在「我的 → 署名与转载」设置制作署名和转载条件；各格式都保留署名与 AI 披露，WebP 另带可见署名水印。[导出说明](.docs/user-guide.md#阅读和导出) · [署名与转载](.docs/user-guide.md#署名与转载)

想让更多人读到？下载 ZIP，按[贡献指南](https://github.com/yysun/awesome-shiqu/blob/main/CONTRIBUTING.md)向 [awesome-shiqu · 拾趣好故事](https://github.com/yysun/awesome-shiqu) 提交 PR，审核通过后收录到[在线作品集](https://yysun.github.io/awesome-shiqu/)。ZIP 中的提示词也会随投稿公开，投稿前请检查整个存档。[发布你的拾趣作品](.docs/user-guide.md#发布你的拾趣作品)

## 更多说明

[使用指南](.docs/user-guide.md) · [使用前了解](.docs/user-guide.md#使用前了解) · [升级到 0.12.0](.docs/user-guide.md#升级到-0120) · [书库说明](data/README.md) · [画风](.docs/user-guide.md#画风) · [手机阅读](.docs/user-guide.md#在手机上阅读) · [常见问题](.docs/user-guide.md#常见问题)

## 开发者

React + Vite 前端、Node REST API 与生产核心、SQLite 与本地媒体目录，无需独立数据库。源码开发使用 **Node 24.22.1** 与 **pnpm 11.25.0**：

```bash
nvm install
nvm use
corepack enable pnpm
pnpm run setup
pnpm dev
```

桌面 UI 预览用 `pnpm desktop:preview`，CLI 命令用 `pnpm cli help --json`。配置与检查见[开发指南](.docs/development.md)，桌面开发与打包见[桌面文档](desktop/README.md)。[更新记录](CHANGELOG.md)

## 许可

项目原创代码与文档采用 [Apache License 2.0](LICENSE)，允许商业使用、修改与再分发，具体条件见许可全文及 [NOTICE](NOTICE)。

古典原文与第三方资料遵循各自适用的权利要求，见[来源说明](data/library/source-notices.md)和[书目清单](data/library/catalog.json)。

拾趣不主张用户生成的故事或插图的著作权；其权利归属取决于适用法律，用户仍须遵守素材权利要求和 AI 生成服务条款。生成内容不会自动适用项目代码的 Apache-2.0 许可。分享前请检查[署名与转载说明](.docs/user-guide.md#署名与转载)及 [ZIP 内容](.docs/user-guide.md#zip-内容与提示词分享)。
