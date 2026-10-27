# 拾趣 · 本地版

把古典故事改编成图文故事，支持阅读、分镜与制作要求查看、画风选择、PDF 导出、最近阅读、软删除与恢复。前端使用 React + Vite，后端使用 Node REST API；SQLite 和媒体文件保存在普通文件夹中。

运行不需要 Cloudflare、Wrangler、workerd、Next.js 或任何托管账号。AI 生成通过服务端连接 Google Gemini；不填密钥也可以阅读内置《种梨》样篇。

## Docker 启动

需要 Docker Engine / Docker Desktop 和 Docker Compose。首次构建需要下载镜像和依赖。

```bash
cp .env.example .env
mkdir -p data
docker compose up --build -d
```

打开 **http://localhost:3000**。在 `.env` 中填写 `GEMINI_API_KEY` 后，执行 `docker compose up -d --force-recreate` 启用生成。费用计入你的 Gemini 项目；模型可用性取决于账号权限与配额。

Windows PowerShell：

```powershell
Copy-Item .env.example .env
New-Item -ItemType Directory -Force data
docker compose up --build -d
```

Linux 上先将 `.env` 中的 `SHIQU_UID`、`SHIQU_GID` 分别设为 `id -u`、`id -g` 的结果。挂载目录应由该用户拥有且可写。容器默认以非 root 的 `1000:1000` 运行，不会修改宿主目录的所有者，也不需要 `chmod 777`。macOS/Windows 的 Docker Desktop 通常可直接使用默认值。

这是供本人电脑使用的单用户版本：服务端固定使用本地所有者身份，忽略调用者提供的身份头。Compose 只发布到 `127.0.0.1`；本版本不提供公网登录或多人隔离。不要直接对公网开放。

## 数据目录与挂载

默认将项目旁边的 **`./data`** 挂到容器内 `/data`：

```text
data/
├── shiqu.sqlite       # 故事、生成检查点、阅读进度、删除记录
├── shiqu.sqlite-wal   # 运行期间可能存在的 SQLite 日志
├── shiqu.sqlite-shm
└── media/
    ├── <上传文件>.png
    └── reader/<故事ID>/
        ├── 0.png      # 也可能是 jpg/webp
        └── source.json
```

首次启动自动执行迁移并加入样篇。重复启动不会覆盖已有故事或进度，也不会自动重试付费生成。

换一个宿主目录，只需先创建目录，再修改 `.env`：

```dotenv
SHIQU_HOST_DATA_DIR="/absolute/path/to/拾趣 data"
```

支持绝对路径与含空格的目录。`SHIQU_HOST_DATA_DIR` 控制宿主路径，容器内仍固定为 `/data`。目录必须提前存在，以免 Docker 默默创建 root 所有的目录。

同一个数据目录只供一个应用实例使用。更换目录后运行：

```bash
docker compose up -d --force-recreate
```

`.env` 配置：

| 变量 | 用途 |
| --- | --- |
| `GEMINI_API_KEY` | 服务端 Gemini 密钥，可留空 |
| `GEMINI_TEXT_MODEL` | 文本模型，默认 `gemini-3.8-flash` |
| `GEMINI_IMAGE_MODEL` | 图片模型，默认 `gemini-nano-banana-2.1` |
| `SHIQU_PORT` | 宿主端口，默认 `3000` |
| `SHIQU_HOST_DATA_DIR` | Docker 挂载的宿主数据目录，默认 `./data` |
| `SHIQU_UID` / `SHIQU_GID` | 容器运行身份，默认 `1000:1000` |

密钥只在服务端读取，不写入前端包、镜像或媒体目录。

## 从旧 Docker 版升级

旧版使用本地 D1/R2 兼容存储，不能直接把旧文件夹当成新的 `data` 使用。保留旧源码、镜像和数据；先停止旧服务，再导出旧卷并转换到一个新目录。

在**旧项目目录**执行（旧命名卷仍挂在 `/data`）：

```bash
docker compose stop
docker compose run --rm --no-deps --entrypoint tar shiqu -czf - -C /data . > legacy-data.tar.gz
```

在**新项目目录**执行：

```bash
mkdir -p legacy-data
tar -xzf /path/to/legacy-data.tar.gz -C legacy-data
docker compose build
docker run --rm --user "$(id -u):$(id -g)" \
  --mount "type=bind,source=$(pwd)/legacy-data,target=/legacy,readonly" \
  --mount "type=bind,source=$(pwd),target=/output" \
  shiqu:local node dist/server/import-legacy.js /legacy /output/data
```

Windows 可先使用下方本地 Node 导入方式，或将上述 Docker 的绝对挂载路径与 UID/GID 改为适合本机的值。

也可以安装 Node 24、执行 `pnpm run setup` 和 `pnpm build` 后导入：

```bash
pnpm import:legacy /absolute/path/to/legacy-data /absolute/path/to/new-data
```

旧开发数据目录 `.data/dev` 同样可作为输入。目标必须不存在或为空；导入不会覆盖已有数据。导入器复制数据库与媒体，保留故事 ID、媒体地址、本地用户 ID、进度与生成状态，完成后才发布目标目录；它不需要安装旧运行时。源文件夹不会被改动。

导入只支持本项目的单数据库、单媒体桶布局；遇到非空 SQLite WAL、缺失文件、未完成迁移或 multipart 媒体会停止并说明原因。不要删除 WAL 来绕过检查：先正常停止旧服务，让它完成数据库检查点。保留原卷，可随时用旧镜像恢复运行。

导入完成后把 `.env` 的 `SHIQU_HOST_DATA_DIR` 指向新目录，再启动新服务。验证原故事、图片和阅读进度后，再决定如何保留旧备份。

## 日常操作与备份

```bash
docker compose ps
docker compose logs -f shiqu
docker compose down
docker compose up -d
```

停止或删除容器不会删除宿主数据目录。更新源码后运行 `docker compose up --build -d`。

备份前停止服务，复制整个数据目录（包含可能存在的 SQLite 日志及媒体文件），随后重新启动：

```bash
docker compose stop
tar -czf shiqu-data-backup.tar.gz -C data .
docker compose up -d
```

使用自定义目录时，将命令中的 `data` 换成实际路径。恢复时先停止服务，将备份解压到一个空目录，再切换挂载路径。`.env` 需单独保管。不要在服务运行时只复制 `shiqu.sqlite`。

分发镜像：

```bash
docker save -o shiqu-image.tar shiqu:local
# 目标机器：加载镜像，并准备 compose.yaml、.env 和数据目录
docker load -i shiqu-image.tar
docker compose up -d --no-build
```

## 本地开发与结构

需要 Node 24（`.nvmrc`：24.22.1）和 pnpm 11.25.0。应用使用 Node 内置 SQLite；无需额外数据库服务或原生数据库插件。

```bash
nvm install
nvm use
corepack enable pnpm
pnpm run setup
pnpm dev
```

开发入口为 **http://localhost:3000**。Vite 将 `/api` 转发到本机 Node API（默认端口 `3002`），保持同源请求。默认开发数据保存在 `.data/dev`，与 Docker 的 `./data` 分开。

```bash
pnpm dev --port 3001
# API 端口冲突时：
SHIQU_API_PORT=3003 pnpm dev
```

停止服务使用 Ctrl+C。修改 `.env` 后重启；已有配置不会被 setup 覆盖。

```text
client/       React 入口、界面与样式
components/   可复用界面组件
lib/          故事生成、阅读、验证与应用服务接口
server/       Node HTTP、配置、SQLite、文件存储与旧数据导入
db/          Drizzle SQLite 数据结构
drizzle/     SQL 迁移
public/       样篇、字体和图标
scripts/      开发与构建入口
docker/       样篇初始化 SQL、健康检查
```

前端与后端分开构建、共用模型与验证代码，生产只需一个 Node 进程。应用逻辑通过显式服务接口访问数据库、媒体和模型请求，不依赖托管平台全局对象。

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm start
```

`pnpm start` 默认绑定 `127.0.0.1:3000` 并读取 `./data`；可用服务端 `PORT`、`SHIQU_BIND_IP`、`SHIQU_DATA_DIR` 覆盖。Docker 内的值由 Compose 配置。

自动测试覆盖生成检查点、付费调用去重与重试、原文检索、SQLite 持久化、媒体上传、HTTP 边界和旧数据导入。测试使用模拟模型服务，不会调用付费 Gemini。

## Sites 部署边界

此版本针对 Docker 和普通 Node 主机。Sites 的服务端运行于 Cloudflare Workers，不能直接运行这里的 Node 进程或挂载本地目录。完整应用重新部署到 Sites 需要独立的 Worker、身份及 D1/R2 适配器；静态前端单独部署不能提供当前的生成与持久化功能。共享界面和应用逻辑可以复用，但此分支不包含该部署目标。
