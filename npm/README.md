# 拾趣 · Shiqu

Turn Chinese classics into your own illustrated storybooks. Read in your browser, generate with a logged-in Codex CLI or a Gemini API key, and keep stories and images on your computer.

## Run

Requires **Node 24** (recommended: 24.22.1). After this package is published:

```bash
npx @apprun/shiqu
```

Or use pnpm:

```bash
pnpm dlx @apprun/shiqu
```

Open the printed URL, normally `http://127.0.0.1:3000`. Stop with Ctrl+C. No checkout, build, Docker, desktop app, or pnpm installation is needed when using npx.

For a permanent command:

```bash
pnpm add -g @apprun/shiqu
shiqu --help
```

## Generation

Reading an existing library needs no AI credentials. For new stories, configure one provider in your shell or an explicitly selected env file:

```dotenv
SHIQU_AI_PROVIDER=codex
# Install Codex separately and run codex login first.
```

Or:

```dotenv
SHIQU_AI_PROVIDER=gemini
GEMINI_API_KEY=your-key
```

```bash
shiqu --env-file /path/to/shiqu.env
```

No `.env` is loaded automatically; existing shell variables take precedence over the file. CLI flags take precedence over both. The package includes `.env.example` with further model and reasoning settings. Codex generation uses your existing login and subscription quota; Gemini uses your API quota. Codex generation currently supports macOS and Linux; use Gemini on native Windows.

## Options and data

```bash
shiqu --port 3100 --data-dir ./my-library
shiqu --host 0.0.0.0
shiqu --version
```

| Option | Environment | Default |
| --- | --- | --- |
| `--port` | `PORT` | `3000` |
| `--host` | `SHIQU_BIND_IP` | `127.0.0.1` |
| `--data-dir` | `SHIQU_DATA_DIR` | OS user-data directory below |
| `--env-file` | — | No file |

Default library locations:

- macOS: `~/Library/Application Support/shiqu/library`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/shiqu/library`
- Windows: `%LOCALAPPDATA%\shiqu\library` (falls back to `%APPDATA%` if set instead)

Relative paths resolve from the directory you launch from. Database and media survive package updates and npm-cache cleanup. Back up the entire library directory while the service is stopped. This CLI has its own library and does not import desktop settings or credentials. Use only one running service per library directory.

Loopback is the default. `--host 0.0.0.0` enables access from other devices on a trusted LAN; every connected device shares the library and generation permissions. Keep the computer awake while reading from a phone. This CLI does not provide the desktop app's internet tunnel or native control window.

## Sources and license

The package includes all 24 classical texts, their catalog, and source notices, so first use needs no separate book download. Original project code is Apache-2.0; book sources retain their applicable terms. See `LICENSE`, `NOTICE`, `data/library/source-notices.md`, and `data/library/catalog.json`. Generated stories and illustrations do not inherit the code license automatically.

[Project and full documentation](https://github.com/yysun/shiqu)
