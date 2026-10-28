# Shiqu · Local Edition

Turn classical Chinese stories into illustrated stories. Features include reading, storyboards and production notes, art style selection, PDF export, reading history, soft deletion, and restoration. The frontend uses React + Vite, with a Node REST API backend. SQLite data and media files live in an ordinary folder.

Running the app requires no Cloudflare, Wrangler, workerd, Next.js, or hosting account. AI generation uses Google Gemini by default, with optional Codex subscription support. Without an API key, you can still read the included *Planting Pears* sample.

## Start with Docker

Install Docker Engine or Docker Desktop, plus Docker Compose. The first build downloads the base image and dependencies.

```bash
cp .env.example .env
mkdir -p data
docker compose up --build -d
```

Open **http://localhost:3000**. To enable generation, set `GEMINI_API_KEY` in `.env`, then run `docker compose up -d --force-recreate`. Usage is billed to your Gemini project; model availability depends on your account permissions and quota.

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
New-Item -ItemType Directory -Force data
docker compose up --build -d
```

On Linux, set `SHIQU_UID` and `SHIQU_GID` in `.env` to the output of `id -u` and `id -g`, respectively. The mounted directory should be owned by that user and writable. The container runs as the non-root user `1000:1000` by default. It does not change ownership of host directories or require `chmod 777`. Docker Desktop on macOS and Windows can usually use the defaults.

This is a single-user edition for your own computer. The server uses a fixed local owner identity and ignores identity headers supplied by callers. Compose publishes only on `127.0.0.1`; this edition provides no public login or multi-user isolation. Do not expose it directly to the internet.

## Choose Gemini or a Codex subscription

Gemini remains the default. To use your Codex subscription for story suggestions, planning, and scene images, set this in `.env`:

```dotenv
SHIQU_AI_PROVIDER=codex
```

On macOS or Linux, install the tested CLI and sign in with your ChatGPT account on the same machine and user that runs Shiqu. On Windows, use the Docker setup below or Gemini mode:

```bash
pnpm add -g @openai/codex@0.165.0
pnpm run codex:login
pnpm run codex:status
pnpm dev
```

If `pnpm` is not found, run `nvm use` and `corepack enable pnpm` first. If pnpm reports that its global binary directory is missing, run `(cd /tmp && pnpm setup)` so this project's own `setup` script does not intercept it, then run `source ~/.zshrc` (or reopen your terminal) and repeat the install. `pnpm setup` configures PATH; Corepack provides the pnpm executable. If Codex is already installed, you can skip installation.

Restart Shiqu after changing `.env`. Codex mode requires ChatGPT sign-in, not API-key login; it never falls back to Gemini or API billing. Text and images consume your shared Codex subscription limits. Image generation can consume those limits faster than text requests. Plan/workspace access and available quota still apply. See the official [authentication](https://learn.chatgpt.com/docs/auth), [app-server](https://learn.chatgpt.com/docs/app-server), and [image generation](https://learn.chatgpt.com/docs/image-generation) documentation.

Optional settings:

| Variable | Purpose |
| --- | --- |
| `CODEX_BIN` | Codex executable or absolute path; defaults to `codex` |
| `CODEX_MODEL` | Optional text-model override; blank uses the Codex default |
| `SHIQU_CODEX_HOME` | Optional dedicated CLI login directory; blank reuses the CLI default |
| `SHIQU_CODEX_HOST_HOME` | Host login folder used by the Docker override below |

The pnpm login/status commands read `.env` and automatically use `CODEX_BIN` and `SHIQU_CODEX_HOME`, matching the app. For a machine without a browser, run `pnpm run codex:login -- --device-auth`. No subscription tokens are placed in `.env` or passed to the browser.

Codex mode supports book-name sources. Custom webpage URL sources require Gemini mode because the isolated Codex runner has no browser or web-fetch access. Original classical passages still use Shiqu's checked source retrieval. Existing stories, image references, art styles, production instructions, checkpoints, and the current retry behavior remain available.

For Docker, use the optional Codex runtime and a **separate** writable login folder so the CLI can refresh its session:

```bash
mkdir -p data .data/codex-home
docker compose -f compose.yaml -f compose.codex.yaml build
docker compose -f compose.yaml -f compose.codex.yaml run --rm --no-deps shiqu pnpm run codex:login -- --device-auth
docker compose -f compose.yaml -f compose.codex.yaml up -d
```

Device login must be enabled for your ChatGPT account/workspace. If it is unavailable, use the official [headless login alternatives](https://learn.chatgpt.com/docs/auth#login-on-headless-devices). Use the same two Compose files for later stop/start/update commands. Set Linux UID/GID as described above, and make both host folders writable by that identity. Override `SHIQU_CODEX_HOST_HOME` for another login-folder location.

The login folder contains credentials: keep it private and separate from `/data`, never commit it or bake it into an image, and do not share it with other users. The runner disables command/file tools and inherited integrations, sends prompts over local stdio, and accepts only native image-result bytes. Requests are bounded; slow or unavailable generations return a recoverable error without changing providers.

## Data directory and mounts

By default, **`./data`** in the project directory is mounted at `/data` inside the container:

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

The first startup applies database migrations and adds the sample story. Subsequent startups preserve existing stories and progress and do not automatically retry paid generation requests.

To use another host directory, create it first, then update `.env`:

```dotenv
SHIQU_HOST_DATA_DIR="/absolute/path/to/shiqu data"
```

Absolute paths and paths containing spaces are supported. `SHIQU_HOST_DATA_DIR` selects the host folder; the container path remains `/data`. Create the directory beforehand so Docker does not silently create a root-owned folder.

Use each data directory with only one application instance. After changing the directory, run:

```bash
docker compose up -d --force-recreate
```

Settings in `.env`:

| Variable | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Server-side Gemini API key; may be left blank |
| `GEMINI_TEXT_MODEL` | Text model; defaults to `gemini-3.8-flash` |
| `GEMINI_IMAGE_MODEL` | Image model; defaults to `gemini-nano-banana-2.1` |
| `SHIQU_PORT` | Host port; defaults to `3000` |
| `SHIQU_HOST_DATA_DIR` | Host data directory mounted by Docker; defaults to `./data` |
| `SHIQU_UID` / `SHIQU_GID` | Container user and group IDs; default to `1000:1000` |

API keys are read only on the server. They are not included in the frontend bundle, container image, or media directory.

## Upgrade from the previous Docker edition

The previous edition used local D1/R2-compatible storage. Its data folder cannot be used directly as the new `data` directory. Keep the old source, image, and data. Stop the old service, export its volume, and convert the data into a new directory.

Run these commands in the **old project directory**, with the old named volume still mounted at `/data`:

```bash
docker compose stop
docker compose run --rm --no-deps --entrypoint tar shiqu -czf - -C /data . > legacy-data.tar.gz
```

In the **new project directory**, run:

```bash
mkdir -p legacy-data
tar -xzf /path/to/legacy-data.tar.gz -C legacy-data
docker compose build
docker run --rm --user "$(id -u):$(id -g)" \
  --mount "type=bind,source=$(pwd)/legacy-data,target=/legacy,readonly" \
  --mount "type=bind,source=$(pwd),target=/output" \
  shiqu:local node dist/server/import-legacy.js /legacy /output/data
```

On Windows, use the local Node import method below, or adapt the Docker command's absolute mount paths and UID/GID values for your machine.

Alternatively, install Node 24, run `pnpm run setup` and `pnpm build`, then import locally:

```bash
pnpm import:legacy /absolute/path/to/legacy-data /absolute/path/to/new-data
```

The previous development data directory, `.data/dev`, can also be used as input. The destination must not exist or must be empty; importing never overwrites existing data. The importer copies the database and media, preserving story IDs, media URLs, local user IDs, progress, and generation state. It publishes the destination directory only after conversion completes. The old runtime is not required, and the source folder is left unchanged.

Import supports this project's single-database, single-media-bucket layout. It stops with an explanation if it encounters a nonempty SQLite WAL, missing files, incomplete migrations, or multipart media objects. Do not delete WAL files to bypass the check: shut down the old service cleanly so it can checkpoint its database. Keep the original volume so you can return to the old image if needed.

After importing, point `SHIQU_HOST_DATA_DIR` in `.env` to the new directory and start the new service. Verify your existing stories, images, and reading progress before deciding how to retain the old backup.

## Daily operation and backups

```bash
docker compose ps
docker compose logs -f shiqu
docker compose down
docker compose up -d
```

Stopping or removing containers does not delete the host data directory. After updating the source, run `docker compose up --build -d`.

Before backing up, stop the service. Copy the entire data directory, including any SQLite journal files and media, then restart:

```bash
docker compose stop
tar -czf shiqu-data-backup.tar.gz -C data .
docker compose up -d
```

If you use a custom directory, replace `data` in the command with its actual path. To restore, stop the service, extract the backup into an empty directory, and switch the mount path. Keep `.env` separately. Do not copy only `shiqu.sqlite` while the service is running.

To distribute the image:

```bash
docker save -o shiqu-image.tar shiqu:local
# On the destination machine, load the image and prepare compose.yaml, .env, and the data directory.
docker load -i shiqu-image.tar
docker compose up -d --no-build
```

## Local development and project structure

Use Node 24 (`.nvmrc` specifies 24.22.1) and pnpm 11.25.0. The app uses Node's built-in SQLite support; no separate database service or native database addon is required.

```bash
nvm install
nvm use
corepack enable pnpm
pnpm run setup
pnpm dev
```

Open **http://localhost:3000**. Vite proxies `/api` to the local Node API, which uses port `3002` by default, keeping browser requests on the same origin. Development data defaults to `.data/dev`, separate from Docker's `./data` directory.

```bash
pnpm dev --port 3001
# If the API port is already in use:
SHIQU_API_PORT=3003 pnpm dev
```

Press Ctrl+C to stop the service. Restart after changing `.env`. Setup preserves existing configuration.

```text
client/       React entry point, UI, and styles
components/   Reusable UI components
lib/          Story generation, reading, validation, and application service interfaces
server/       Node HTTP, configuration, SQLite, file storage, and legacy import
db/           Drizzle SQLite schema
drizzle/      SQL migrations
public/       Sample assets, fonts, and icons
scripts/      Development and build entry points
docker/       Sample initialization SQL and health check
```

The frontend and backend build separately and share models and validation code. Production runs in one Node process. Application logic accesses the database, media, and model requests through explicit service interfaces, without hosting-platform globals.

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm start
```

`pnpm start` binds to `127.0.0.1:3000` and uses `./data` by default. Override these with the server-side variables `PORT`, `SHIQU_BIND_IP`, and `SHIQU_DATA_DIR`. Compose supplies the container settings.

Automated tests cover generation checkpoints, paid-call deduplication and retries, original-source retrieval, SQLite persistence, media uploads, HTTP boundaries, and legacy import. Tests use simulated model responses and do not make paid Gemini calls.

## Sites deployment boundary

This edition targets Docker and regular Node hosts. Sites runs its backend on Cloudflare Workers and cannot directly run this Node process or mount local directories. Deploying the full application to Sites requires separate Worker, identity, and D1/R2 adapters. Deploying only the static frontend does not provide the current generation and persistence features. The shared UI and application logic can be reused, but this branch does not include that deployment target.
