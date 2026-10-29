# 拾趣

将中国古典故事改编为配有插图的故事。功能包括阅读、分镜和制作说明、美术风格选择、PDF 和单页 PNG 导出、阅读历史、软删除与恢复。前端使用 React + Vite，后端是 Node REST API。SQLite 数据和媒体文件保存在普通文件夹中。

全部插图生成后，可在「阅读偏好设置」或故事末页导出 PDF，或选择 **一页输出（PNG）**。PNG 会将全部图片、页码、说明文字和结尾感悟排在一张总览图中；十页故事采用五列两行布局，八页和十二页故事会自动调整。导出在浏览器本地完成，不会发起新的 AI 请求。

运行应用无需 Cloudflare、Wrangler、workerd、Next.js 或托管服务账户。AI 生成功能默认使用 Google Gemini，也可选择使用 Codex 订阅。即使没有 API 密钥，也可以阅读内置的《种梨》示例。

插图会随着阅读按每组三张生成：先生成第 1–3 页，到达第 4 页时再生成第 4–6 页。最后一组不会超出故事末尾。第一张图片会单独生成，作为角色参考；之后缺失的图片每次最多生成三张，可使用 Gemini 或 Codex。每张图片完成后都会立即保存，因此重试时会保留已完成的内容，只补生成缺失场景。

新一批故事候选会同时给出适合该篇内容的画风和一句推荐理由，选中故事后默认采用。可以手动改选，或点击「采用推荐」恢复；切换故事时使用新故事的推荐。推荐随选题一并生成，不增加一次模型调用，也不生成图片。旧选题缓存没有推荐时，仍可自行选画风。开始生成后，分镜与整篇插图沿用已确定的画风。

阅读时轻点画面即可进入下一页，也可继续使用上下或左右滑动、滚轮和翻页箭头。拖动、长按或滑动结束不会额外触发一次点击翻页，原文、收藏、设置等按钮仍只执行各自操作。

## 书目目录：24 部候选作品

可供选择的目录包含 24 部作品。优先采用的原文下载文件、来源链接、哈希值和已知质量问题均纳入版本管理，位于
[`data/library/`](data/library/catalog.json). Download research and duplicate copies
则保留在已忽略的 `.data/research/book-source-research/` 目录中。

| 类别 | 书目 |
| --- | --- |
| 志怪与博物（8） | 聊斋志异、山海经、搜神记、阅微草堂笔记、子不语、酉阳杂俎、太平广记、博物志 |
| 古典小说（5） | 西游记、三国演义、红楼梦、水浒传、儒林外史 |
| 白话小说（5） | 喻世明言、警世通言、醒世恒言、初刻拍案惊奇、二刻拍案惊奇 |
| 诸子典籍（2） | 庄子、列子 |
| 历史与策论（2） | 史记、战国策 |
| 笔记小说（1） | 世说新语 |
| 日常生活（1） | 浮生六记 |

目录中的 24 部作品都使用本地原文建立故事索引并核验来源。首次索引按原文顺序分批读取，每批最多 40,000 字符，同时最多两个请求；保留能放进预算的边界上下文，并覆盖全部正文单元。索引任务每次最多等待 180 秒；每批提取至多 12 个可独立改编的故事候选，合并去重后再按主题选择至多 5 篇。索引保存的是候选，不是穷举所有可能的改编切法。首次索引耗时较长，页面按完成索引的原文字数更新进度；完成的批次会立即保存，中断后可继续。

后续换主题、换一批只读取故事索引，不重新发送整书原文。较大的索引按每次至多 30,000 个 JSON 字符分组筛选并递归合并，所有分组（包括尾部）都会参与。服务器只接受当前输入中已有且本地可核对的出处。按“书籍版本—主题—故事”保存结果，同主题优先直接返回未看过的缓存；候选不足或耗尽时会明确提示，不偷偷重读原文。

缓存保存在运行数据目录的 `media/reader-cache/`，重启仍可复用；默认开发目录为 `.data/dev/media/reader-cache/`，Docker 为 `/data/media/reader-cache/`。索引命名空间包含原始版本、带编号正文、有效索引规则与结构、提供方和配置文本模型；主题缓存另包含合并索引与有效选题规则/结构，选题简介规则改变只使主题结果失效，不重建索引。这些缓存变化不会影响已生成故事。Codex 使用 CLI 配置的文本模型参与隔离，未配置时保留缺省标识，不保证检测提供方静默升级。同一 Node 进程中的并发请求会共享构建任务；单个读者取消不影响其他等待者，无人等待则停止派发后续批次，已完成批次仍保存。

原文字符会原样保留，包括繁体字；模型生成的故事使用简体中文。服务器会先保存选定的原文，再请求生成分镜；分镜请求只会收到已核验的对应原文段落。目录书目不会使用 RAG、嵌入索引、语义检索、静默截断或公开书籍 API 作为备用来源。未知自定义书目仍沿用现有的服务提供方行为。

版本哈希和段落范围会随每个选定的故事及其保存的原文一起记录。无效、过期、跨章节、不可读或来自未读取批次的范围都会明确报错。重试时会使用已保存的原文。现有故事仍可正常阅读；旧数据回填必须能够明确对应到本地章节或具名的《聊斋》故事。

《史记》使用固定到特定 GitHub 提交版本的单份原始 JSON 下载：共 130 篇互不重复且内容非空的章节，不存在正文重复，并包含此前缺失的赵、魏和陈涉相关章节。十表大多只保留表序；无法辨认的字符会明确标记。二十五卷受损或缺失的《太平广记》内容已由独立存档的完整卷册替换。《二刻拍案惊奇》第四十卷也作为单独补充内容收录。每份补充内容均保留实际来源 URL 和字节哈希；合并版本包含所有来源哈希。我们不会将不同来源混称为同一校勘本。《浮生六记》仅收录现存的四篇；《红楼梦》章节标签会区分前八十回和后四十回。本地核验只能证明某个范围存在于存档转录文本中，并不代表该文本已完成全面校对。

服务器会从应用根目录读取随应用发布的书库，该目录与 SQLite/媒体目录分开。Docker 将书库放在 `/app/data/library`，而 `/data` 仍是可写的运行时挂载目录。目录元数据位于 `lib/reader-books.ts`。

## 使用 Docker 启动

请安装 Docker Engine 或 Docker Desktop，以及 Docker Compose。首次构建时会下载基础镜像和依赖项。

```bash
cp .env.example .env
mkdir -p data
docker compose up --build -d
```

打开 **http://localhost:3000**。如需启用生成，请在 `.env` 中设置 `GEMINI_API_KEY`，然后运行 `docker compose up -d --force-recreate`。费用计入你的 Gemini 项目；模型是否可用取决于账户权限和配额。

Windows PowerShell：

```powershell
Copy-Item .env.example .env
New-Item -ItemType Directory -Force data
docker compose up --build -d
```

在 Linux 上，请将 `.env` 中的 `SHIQU_UID` 和 `SHIQU_GID` 分别设为 `id -u` 和 `id -g` 的输出。挂载目录应归该用户所有且可写。容器默认以非 root 用户 `1000:1000` 运行，不会更改主机目录的所有权，也不需要执行 `chmod 777`。macOS 和 Windows 上的 Docker Desktop 通常可以使用默认值。

这是供个人电脑使用的单用户版本。服务器使用固定的本地所有者身份，并忽略调用方提供的身份标头。Compose 只在 `127.0.0.1` 上发布服务；本版本不提供公开登录或多用户隔离功能。请勿将其直接暴露到互联网。

## 选择 Gemini 或 Codex 订阅

默认仍使用 Gemini。如需使用 Codex 订阅生成故事建议、规划和场景图片，请在 `.env` 中设置：

```dotenv
SHIQU_AI_PROVIDER=codex
```

在 macOS 或 Linux 上，请安装经过测试的 CLI，并使用运行 Shiqu 的同一台电脑和同一用户登录 ChatGPT 账户。在 Windows 上，请使用下方的 Docker 配置或 Gemini 模式：

```bash
pnpm add -g @openai/codex@0.165.0
pnpm run codex:login
pnpm run codex:status
pnpm dev
```

如果找不到 `pnpm`，请先运行 `nvm use` 和 `corepack enable pnpm`。如果 pnpm 提示缺少全局二进制目录，请运行 `(cd /tmp && pnpm setup)`，避免被本项目自己的 `setup` 脚本拦截；然后运行 `source ~/.zshrc`（或重新打开终端），再重复安装步骤。`pnpm setup` 会配置 PATH；Corepack 提供 pnpm 可执行文件。如果已经安装 Codex，可以跳过安装步骤。

修改 `.env` 后请重启 Shiqu。Codex 模式要求通过 ChatGPT 登录，而不是使用 API 密钥登录；它不会回退到 Gemini 或 API 计费。文本和图片生成共用 Codex 订阅额度，图片生成消耗额度的速度可能比文本请求更快。仍需满足套餐/工作区访问权限和可用配额要求。请参阅官方的[身份验证](https://learn.chatgpt.com/docs/auth)、[应用服务器](https://learn.chatgpt.com/docs/app-server)和[图片生成](https://learn.chatgpt.com/docs/image-generation)文档。

可选设置：

| 变量 | 用途 |
| --- | --- |
| `CODEX_BIN` | Codex 可执行文件或其绝对路径；默认为 `codex` |
| `CODEX_MODEL` | 可选的文本模型覆盖值；留空时使用 Codex 默认模型 |
| `SHIQU_CODEX_HOME` | 可选的 CLI 专用登录目录；留空时使用 CLI 默认目录 |
| `SHIQU_CODEX_HOST_HOME` | 下方 Docker 配置使用的主机登录文件夹 |

pnpm 登录/状态命令会读取 `.env`，并自动使用 `CODEX_BIN` 和 `SHIQU_CODEX_HOME`，与应用保持一致。对于没有浏览器的设备，请运行 `pnpm run codex:login -- --device-auth`。订阅令牌不会写入 `.env`，也不会传给浏览器。

Codex 模式支持书名来源。自定义网页 URL 来源需要使用 Gemini 模式，因为隔离的 Codex 运行器无法访问浏览器或网页抓取功能。古典原文段落仍通过 Shiqu 已核验的来源检索获取。现有故事、图片参考、美术风格、制作说明、检查点和当前重试行为均可继续使用。

在 Docker 中使用 Codex 时，请启用可选的 Codex 运行环境，并使用一个**独立的**可写登录文件夹，以便 CLI 刷新会话：

```bash
mkdir -p data .data/codex-home
docker compose -f compose.yaml -f compose.codex.yaml build
docker compose -f compose.yaml -f compose.codex.yaml run --rm --no-deps shiqu pnpm run codex:login -- --device-auth
docker compose -f compose.yaml -f compose.codex.yaml up -d
```

你的 ChatGPT 账户/工作区必须启用设备登录。如果无法使用，请参阅官方的[无头设备登录替代方案](https://learn.chatgpt.com/docs/auth#login-on-headless-devices)。之后执行停止、启动或更新命令时，请继续使用相同的两个 Compose 文件。按上文说明设置 Linux UID/GID，并确保该身份可以写入两个主机文件夹。若要更换登录文件夹位置，可覆盖 `SHIQU_CODEX_HOST_HOME`。

登录文件夹包含凭据：请妥善保管，并与 `/data` 分开；切勿将其提交到版本库、打包进镜像或与其他用户共享。运行器会禁用命令/文件工具和继承的集成，通过本地标准输入输出发送提示词，并且只接受原生图片结果字节。请求设有时限；生成缓慢或不可用时会返回可恢复的错误，不会切换服务提供方。

## 数据目录与挂载

默认情况下，项目目录中的 **`./data`** 会挂载到容器内的 `/data`：

```text
data/
├── shiqu.sqlite       # Stories, generation checkpoints, reading progress, deletion records
├── shiqu.sqlite-wal   # SQLite journal files that may exist while the app is running
├── shiqu.sqlite-shm
└── media/
    ├── <uploaded-file>.png
    └── reader/<story-id>/
        ├── 0.png      # May also be jpg or webp
        └── source.json
```

首次启动时会应用数据库迁移并添加示例故事。之后的启动会保留已有故事和阅读进度，也不会自动重试会产生费用的生成请求。

如需使用其他主机目录，请先创建该目录，然后更新 `.env`：

```dotenv
SHIQU_HOST_DATA_DIR="/absolute/path/to/shiqu data"
```

支持绝对路径和包含空格的路径。`SHIQU_HOST_DATA_DIR` 用于选择主机文件夹；容器内路径仍为 `/data`。请提前创建目录，以免 Docker 悄悄创建由 root 所有的文件夹。

每个数据目录只能供一个应用实例使用。更改目录后，请运行：

```bash
docker compose up -d --force-recreate
```

`.env` 中的设置：

| 变量 | 用途 |
| --- | --- |
| `GEMINI_API_KEY` | 服务器端 Gemini API 密钥；可以留空 |
| `GEMINI_TEXT_MODEL` | 文本模型；默认为 `gemini-3.8-flash` |
| `GEMINI_IMAGE_MODEL` | 图片模型；默认为 `gemini-nano-banana-2.1` |
| `SHIQU_PORT` | 主机端口；默认为 `3000` |
| `SHIQU_HOST_DATA_DIR` | Docker 挂载的主机数据目录；默认为 `./data` |
| `SHIQU_UID` / `SHIQU_GID` | 容器用户和组 ID；默认为 `1000:1000` |

API 密钥只会在服务器端读取，不会包含在前端构建产物、容器镜像或媒体目录中。

## 从旧版 Docker 版本升级

旧版本使用本地兼容 D1/R2 的存储。其数据文件夹不能直接用作新版的 `data` 目录。请保留旧版源码、镜像和数据。停止旧服务，导出其卷，并将数据转换到新目录。

在旧命名卷仍挂载到 `/data` 时，于**旧项目目录**中运行以下命令：

```bash
docker compose stop
docker compose run --rm --no-deps --entrypoint tar shiqu -czf - -C /data . > legacy-data.tar.gz
```

在**新项目目录**中运行：

```bash
mkdir -p legacy-data
tar -xzf /path/to/legacy-data.tar.gz -C legacy-data
docker compose build
docker run --rm --user "$(id -u):$(id -g)" \
  --mount "type=bind,source=$(pwd)/legacy-data,target=/legacy,readonly" \
  --mount "type=bind,source=$(pwd),target=/output" \
  shiqu:local node dist/server/import-legacy.js /legacy /output/data
```

在 Windows 上，请使用下方的本地 Node 导入方式，或根据你的电脑调整 Docker 命令中的绝对挂载路径和 UID/GID 值。

或者，安装 Node 24，运行 `pnpm run setup` 和 `pnpm build`，然后在本地导入：

```bash
pnpm import:legacy /absolute/path/to/legacy-data /absolute/path/to/new-data
```

也可以使用旧版开发数据目录 `.data/dev` 作为输入。目标目录必须不存在或为空；导入过程绝不会覆盖已有数据。导入器会复制数据库和媒体文件，并保留故事 ID、媒体 URL、本地用户 ID、阅读进度和生成状态。只有转换完成后才会发布目标目录。无需运行旧版运行环境，源文件夹也不会被修改。

导入功能支持本项目的单数据库、单媒体存储桶布局。如果遇到非空 SQLite WAL、文件缺失、迁移未完成或分片媒体对象，导入器会停止并说明原因。请勿删除 WAL 文件来绕过检查：应正常关闭旧服务，让它完成数据库检查点操作。请保留原始卷，以便需要时恢复使用旧镜像。

导入后，将 `.env` 中的 `SHIQU_HOST_DATA_DIR` 指向新目录并启动新服务。请先确认现有故事、图片和阅读进度无误，再决定如何保留旧备份。

## 日常操作与备份

```bash
docker compose ps
docker compose logs -f shiqu
docker compose down
docker compose up -d
```

停止或移除容器不会删除主机数据目录。更新源码后，请运行 `docker compose up --build -d`。

备份前请先停止服务。复制整个数据目录，包括可能存在的 SQLite 日志文件和媒体文件，然后重新启动服务：

```bash
docker compose stop
tar -czf shiqu-data-backup.tar.gz -C data .
docker compose up -d
```

如果使用自定义目录，请在命令中将 `data` 替换为实际路径。恢复时，先停止服务，将备份解压到空目录，再切换挂载路径。请单独保管 `.env`。服务运行时不要只复制 `shiqu.sqlite`。

分发镜像：

```bash
docker save -o shiqu-image.tar shiqu:local
# 在目标机器上加载镜像，并准备 compose.yaml、.env 和数据目录。
docker load -i shiqu-image.tar
docker compose up -d --no-build
```

## 本地开发与项目结构

请使用 Node 24（`.nvmrc` 指定 24.22.1）和 pnpm 11.25.0。应用使用 Node 内置的 SQLite 支持，无需单独的数据库服务或原生数据库扩展。

```bash
nvm install
nvm use
corepack enable pnpm
pnpm run setup
pnpm dev
```

打开 **http://localhost:3000**。Vite 会将 `/api` 代理到本地 Node API，该 API 默认使用端口 `3002`，因此浏览器请求仍来自同一源。开发数据默认位于 `.data/dev`，与 Docker 使用的 `./data` 目录分开。

```bash
pnpm dev --port 3001
# 如果 API 端口已被占用：
SHIQU_API_PORT=3003 pnpm dev
```

按 Ctrl+C 停止服务。修改 `.env` 后请重启。Setup 会保留现有配置。

```text
client/       React 入口、界面和样式
components/   可复用的界面组件
lib/          故事生成、阅读、校验和应用服务接口
server/       Node HTTP、配置、SQLite、文件存储和旧版数据导入
db/           Drizzle SQLite 架构
drizzle/      SQL 迁移
public/       示例资源、字体和图标
scripts/      开发和构建入口
docker/       示例初始化 SQL 和健康检查
```

前端和后端分别构建，并共用模型和校验代码。生产环境在单个 Node 进程中运行。应用逻辑通过明确的服务接口访问数据库、媒体和模型请求，不依赖托管平台的全局变量。

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm start
```

`pnpm start` 默认绑定到 `127.0.0.1:3000` 并使用 `./data`。可通过服务器端变量 `PORT`、`SHIQU_BIND_IP` 和 `SHIQU_DATA_DIR` 覆盖这些设置。容器设置由 Compose 提供。

自动化测试覆盖生成检查点、付费调用去重与重试、原文检索、SQLite 持久化、媒体上传、HTTP 边界和旧版数据导入。测试使用模拟模型响应，不会发起需付费的 Gemini 调用。

## Sites 部署限制

此版本面向 Docker 和常规 Node 主机。Sites 在 Cloudflare Workers 上运行后端，无法直接运行此 Node 进程或挂载本地目录。要将完整应用部署到 Sites，需要单独实现 Worker、身份验证和 D1/R2 适配器。仅部署静态前端无法提供当前的生成和持久化功能。共享的界面和应用逻辑可以复用，但此分支不包含该部署目标。
