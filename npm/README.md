# 拾趣 · Shiqu

Turn Chinese classics into your own illustrated storybooks. Read in your browser, generate with a logged-in Codex CLI or a Gemini API key, and keep stories and images on your computer.

## Run

Requires **Node 24** (recommended: 24.22.1). After this package is published:

```bash
pnpm dlx @apprun/shiqu
```

Open the printed URL, normally `http://127.0.0.1:3000`. Stop with Ctrl+C. No checkout, build, Docker, or desktop app is needed.

For a permanent command:

```bash
pnpm add -g @apprun/shiqu
shiqu --help
```

## First-run provider setup

No environment variables are required for interactive setup. After finding or choosing a library, the CLI reuses saved settings. If none are configured, choose **Codex / OpenAI API / Gemini / Read only**. Enter API keys at the hidden terminal prompt; model prompts accept the saved/default value on Enter. Codex needs an installed, logged-in CLI instead of an API key. Windows supports the API providers and read-only mode.

Settings and provider-specific keys are shared with the desktop app in the separate private `desktop.sqlite`, outside story libraries. Saved configurations do not prompt again. Keys are plaintext protected by local filesystem permissions (0700 directory / 0600 database on Unix); do not share settings backups. Keys never appear in HTTP responses or settings views.

```bash
shiqu --configure
shiqu --reset-providers
```

`--configure` selects/edits a profile, retains that profile's saved key on blank input, saves only a completed setup, and exits. Switching profiles preserves other providers' models/keys. `--reset-providers` removes saved provider settings and keys, preserving libraries/network settings and all stories. It reopens setup in a terminal, or exits with guidance when non-interactive. Already-running servers keep their startup snapshot until restarted.

OpenAI uses the official Responses API for text and Images API for illustrations, including saved reference images. Defaults: `gpt-6.1-sol` / `gpt-image-2.5-sunburst`; access/quota depend on your API project. OpenAI API billing is separate from Codex subscription quota. Public webpage URL discovery remains Gemini-only. Read-only never dispatches generation.

### Invocation-only overrides

Environment variables or an explicitly selected env file override saved configuration without being imported or persisted:

```dotenv
SHIQU_AI_PROVIDER=openai
OPENAI_API_KEY=your-key
# Optional model overrides:
OPENAI_TEXT_MODEL=gpt-6.1-sol
OPENAI_IMAGE_MODEL=gpt-image-2.5-sunburst
```

Other choices: `SHIQU_AI_PROVIDER=codex` after `codex login`, `SHIQU_AI_PROVIDER=gemini` with `GEMINI_API_KEY`, or `SHIQU_AI_PROVIDER=readonly` with no key.

```bash
shiqu --config /path/to/shiqu.env
```

No `.env` is loaded automatically. Existing shell variables beat the selected file; CLI flags beat both. Non-interactive startup requires saved settings or a complete provider override, and a discoverable/explicit library path. No prompt waits indefinitely. The package includes `.env.example` with optional settings.

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
| `--data-dir` | `SHIQU_DATA_DIR` | Saved desktop library; otherwise find or ask below |
| `--config` | — | No env file |

Library selection:

1. An explicit `--data-dir` wins over `SHIQU_DATA_DIR` from the shell or selected env file.
2. Otherwise reuse the desktop app's saved library directory, creating it if necessary. Only the directory setting is read; desktop credentials remain private.
3. Without shared saved settings, import a prior CLI `cli-library.json` directory if present, otherwise look for an existing database in the desktop default library directory.
4. If none is found, ask which directory to use or create. Enter accepts the suggested desktop default. Cancel/EOF creates no library; non-interactive first use must supply `--data-dir`.

Suggested desktop-compatible defaults:

- macOS: `~/Library/Application Support/com.shiqu.desktop/library`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/com.shiqu.desktop/library`
- Windows: `%APPDATA%\com.shiqu.desktop\library`

Confirmed library choices now live in the shared settings database; legacy `cli-library.json` choices are imported when needed and the old file is retained. Desktop and CLI use the same directory when either configures it first. Explicit `--data-dir` / `SHIQU_DATA_DIR` overrides are invocation-only. New settings databases created by `--configure` do not treat the unconfirmed default library path as a saved choice.
Relative paths resolve from the launch directory. Both entries use the same SQLite/media format; use matching versions and stop one before starting the other. A busy library is rejected even on a different port. Database and media survive package updates and npm-cache cleanup. Back up the entire library while stopped.

Older CLI releases used `shiqu/library` rather than `com.shiqu.desktop/library` (Windows used LOCALAPPDATA, falling back to APPDATA). Existing data is never moved or merged automatically; pass the old directory with `--data-dir` to continue using it. CLI and desktop now share saved credentials; explicit invocation overrides remain separate and are not saved.

Loopback is the default. `--host 0.0.0.0` enables access from other devices on a trusted LAN; every connected device shares the library and generation permissions. Keep the computer awake while reading from a phone. This CLI does not provide the desktop app's internet tunnel or native control window.

## Sources and license

The package includes all 24 classical texts, their catalog, and source notices, so first use needs no separate book download. Original project code is Apache-2.0; book sources retain their applicable terms. See `LICENSE`, `NOTICE`, `data/library/source-notices.md`, and `data/library/catalog.json`. Generated stories and illustrations do not inherit the code license automatically.

[Project and full documentation](https://github.com/yysun/shiqu)
