# 拾趣 · Docker 本地版

将古典故事改编为图文故事，支持阅读、分镜剧本与提示词查看、14 种画风、PDF 导出、最近 10 篇首页滑动展示，以及列表软删除。

这是当前系统的独立源码包，基于线上 v20（源码提交 `5793e1d747a2c9f6e4aae7a55356a262909ba001`）制作。包含完整源码、内置《种梨》样篇图片、数据库迁移和 Docker 配置；**不包含 API 密钥、线上生成的故事、阅读记录或线上数据库**。

## 1. 启动

先安装并启动 Docker Desktop，或在 Linux 安装 Docker Engine 和 Docker Compose。首次构建需要联网下载 Node 镜像和 npm 依赖，AI 生成需要能连接 Google Gemini 服务。

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

Docker 使用 Node 24，依赖由 `pnpm-lock.yaml` 锁定。主要目录：

- `app/`、`components/`：页面和交互。
- `lib/`：故事生成、阅读、画风、软删除和数据访问。
- `db/`、`drizzle/`：数据结构与迁移。
- `public/`：内置样篇和字体等静态资源。
- `docker/`：启动、健康检查和幂等样篇初始化。

容器运行后可执行已有测试和类型检查：

```bash
docker compose exec shiqu node --experimental-strip-types --test tests/*.test.mjs
docker compose exec shiqu node node_modules/typescript/bin/tsc --noEmit
```

打包前已通过：43 项自动测试、TypeScript 检查、独立生产构建、自动数据库迁移、首页与样篇 API、阅读进度保存、图片上传读取，以及重启后的数据库/媒体持久化和样篇幂等初始化。

打包环境没有 Docker 引擎，因此没有执行真实的 `docker compose build/up`；已直接运行与容器相同的 Node 启动入口验证上述功能。新 Gemini 账号的模型权限和真实计费生成不在本次验证范围内。
