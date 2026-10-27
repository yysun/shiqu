# 拾趣 · Docker 本地版

将古典故事改编为图文故事，支持阅读、分镜剧本与提示词查看、14 种画风、PDF 导出、最近 10 篇首页滑动展示，以及列表软删除。

这是当前系统的独立源码包，基于线上 v20（源码提交 `5793e1d747a2c9f6e4aae7a55356a262909ba001`）制作。包含完整源码、内置《种梨》样篇图片、数据库迁移和 Docker 配置；**不包含 API 密钥、线上生成的故事、阅读记录或线上数据库**。

## 1. 启动

先安装并启动 Docker Desktop，或在 Linux 安装 Docker Engine 和 Docker Compose。首次构建需要联网下载 Node 镜像和包依赖，AI 生成需要能连接 Google Gemini 服务。

解压后进入 `shiqu` 文件夹，在终端执行：

```bash
cp .env.example .env
```

Windows PowerShell 使用：

```powershell
Copy-Item .env.example .env
```

用文本编辑器打开 `.env`，填写自己的 `GEMINI_API_KEY`，保存后执行：

```bash
docker compose up --build -d
```

打开 **http://localhost:3000**。第一次构建可能需要几分钟，可运行 `docker compose logs -f shiqu` 查看启动进度。

不填写密钥也可以阅读内置样篇；生成新故事和图片需要有效的 Gemini 密钥、对应模型访问权限及配额。调用费用计入你的 Gemini 项目。

## 2. 配置

`.env` 中的设置：

| 变量 | 用途 |
| --- | --- |
| `GEMINI_API_KEY` | 你的 Gemini API 密钥，仅在服务端使用 |
| `GEMINI_TEXT_MODEL` | 文本模型，默认沿用当前系统的 `gemini-3.8-flash` |
| `GEMINI_IMAGE_MODEL` | 图片模型，默认沿用当前系统的 `gemini-nano-banana-2.1` |
| `SHIQU_PORT` | 本机端口，默认 `3000` |

模型名称沿用源码配置，实际可用性取决于你的 Gemini 项目。若收到模型不存在或无权限错误，请将上述模型名称改为自己项目可用的模型 ID。

修改 `.env` 后运行：

```bash
docker compose up -d --force-recreate
```

如果端口 3000 已被使用，把 `SHIQU_PORT` 改为例如 `3001`，重新启动后访问 http://localhost:3001。

这是供本人电脑使用的单用户版本，启动后自动使用本地所有者身份，不需要登录。默认只绑定 `127.0.0.1`；没有公网或多人访问的身份认证机制。不要直接把它发布到公网。

## 3. 数据与日常操作

容器内使用 Wrangler / workerd 提供本地 D1 数据库和 R2 文件存储兼容环境，**不需要 Cloudflare 账号**。所有本地故事、进度、删除记录和上传/生成图片保存在 Docker 命名卷 `shiqu_shiqu_data`，挂载于 `/data`。首次启动会自动执行数据库迁移并加入样篇，重复启动不会覆盖已有内容。

查看状态和日志：

```bash
docker compose ps
docker compose logs -f shiqu
```

停止或再次启动：

```bash
docker compose down
docker compose up -d
```

`docker compose down` 会保留数据。**`docker compose down -v` 会删除数据卷及其中的数据，请勿用于日常停止。**

更新源码后重新构建：

```bash
docker compose up --build -d
```

本地软删除仍会保留原故事、图片和删除时间；列表与阅读入口会隐藏已删除内容，没有垃圾箱和恢复页面。后台查询删除记录可使用：

```bash
docker compose exec shiqu node node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to /data --command "SELECT * FROM library_deletions ORDER BY deleted_at DESC;"
```

备份前先停止服务，防止写入中的数据库不一致。以下命令适用于 macOS/Linux 终端，以及支持二进制重定向的 PowerShell 7.4+：

```bash
docker compose stop
docker compose run --rm --no-deps --entrypoint tar shiqu -czf - -C /data . > shiqu-backup.tar.gz
docker compose up -d
```

备份包含完整数据库和媒体文件，请妥善保存；`.env` 需单独保管。

## 4. 开发与验证

本地开发和 Docker 构建使用 Node 24（`.nvmrc` 指定 24.22.1），依赖由 pnpm 11.25.0 和 `pnpm-lock.yaml` 锁定。开发不需要 Docker 或 VS Code 插件。主要目录：

- `app/`、`components/`：页面和交互。
- `lib/`：故事生成、阅读、画风、软删除和数据访问。
- `db/`、`drizzle/`：数据结构与迁移。
- `public/`：内置样篇和字体等静态资源。
- `docker/`：启动、健康检查和幂等样篇初始化。

### 本地开发

安装 Node 24。使用 nvm 的 macOS/Linux 环境可直接在项目根目录运行：

```bash
nvm install
nvm use
corepack enable pnpm
corepack install
```

首次准备开发环境：

```bash
pnpm run setup
```

Corepack 使用 `package.json` 指定的 pnpm 11.25.0。[Corepack 使用说明](https://github.com/nodejs/corepack#readme)。`pnpm run setup` 检查 Node 版本，仅在 `.env` 不存在时从 `.env.example` 创建，并使用冻结锁文件安装依赖。应用依赖位于项目的 `node_modules/`，pnpm 缓存位于 `.sites-runtime/`，已有 `.env` 不会被覆盖。使用完整的 `pnpm run setup` 命令调用本项目的初始化脚本。

启动开发服务：

```bash
pnpm dev
```

打开 **http://localhost:3000**。启动时自动执行数据库迁移并幂等初始化样篇，源码修改支持热更新。无需 Gemini 密钥即可阅读样篇；填写或修改 `.env` 后重启服务即可启用对应配置。需要其他端口时运行 `pnpm dev --port 3001`；`.env` 中的 `SHIQU_PORT` 仅用于 Docker Compose。

开发数据库和媒体文件保存在 `.data/dev/`，工具日志位于 `.wrangler/`，均不进入 Git 或 Docker 构建。开发数据与 Docker 的 `/data` 命名卷分开。停止开发服务使用 Ctrl+C，已有数据会保留。`wrangler.json` 统一定义开发服务、数据库迁移和生产构建使用的绑定，无需 Cloudflare 账号。

日常验证和本地构建：

```bash
pnpm test
pnpm typecheck
pnpm build
```

拉取依赖变更后重新执行 `pnpm run setup`。新增依赖使用 `pnpm add <包名>`，开发工具使用 `pnpm add -D <包名>`，并提交更新后的 `package.json` 与 `pnpm-lock.yaml`。

### 构建和运行分发镜像

安装并启动 Docker 后，构建自包含的 `shiqu:local` 运行镜像：

```bash
pnpm build:runtime
docker compose up -d
```

也可直接执行 `docker compose up --build -d`，不需要先在宿主机安装 Node 或项目依赖。镜像构建在 Docker 内完成，包含编译结果、生产依赖、迁移、样篇和启动脚本；不包含开发工具、应用源码目录、测试、`.env` 或本地数据。Wrangler/workerd 是本地 D1/R2 的运行时依赖，会随镜像保留。镜像启动时从外部读取环境变量，并将数据保存在 `/data`。

分发到另一台同架构机器可使用：

```bash
docker save -o shiqu-image.tar shiqu:local
# 在目标机器加载，再准备 .env 与 compose.yaml：
docker load -i shiqu-image.tar
docker compose up -d --no-build
```

镜像对应构建时的源码快照。源码更新后重新构建并执行 `docker compose up -d`，容器会使用新镜像，数据卷保留。

已验证：43 项自动测试、TypeScript 检查、本地生产构建、本地开发服务的首次初始化与换端口重启，以及真实 Docker 镜像构建、非 root 运行、健康检查、样篇与图片读取、阅读进度保存和容器重启后的数据保留。真实 Gemini 计费生成需自行验证账号的模型权限与配额。
